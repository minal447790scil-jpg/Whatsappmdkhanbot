// ============================================================
// View-Once Cache (v2)
// ------------------------------------------------------------
// Masla: reply ke waqt quoted view-once message mein media ka
// url/directPath AUR mediaKey nahi hota — download mumkin hi
// nahi, reupload bhi Baileys ke andar crash hota hai. Hal sirf
// ye hai: media ko usi waqt save kar lo jab message bot ko
// AATA hai (us waqt asal message complete hota hai).
//
// v2 mein:
// - Detection PURE message tree ko recursively dhoondhti hai —
//   view-once jis wrapper mein bhi chhupa ho (V1/V2/V2Extension/
//   ephemeral/deviceSent), mil jayega.
// - Har media walay message ka record data/viewonce/stats.json
//   mein rehta hai, taake .hm ke error se hi pata chal jaye ke
//   cache hook chal raha hai ya nahi, aur aane wala message kis
//   shape mein aaya tha.
// ============================================================

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'viewonce');
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');
const STATS_FILE = path.join(CACHE_DIR, 'stats.json');
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 ghante

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];
const VO_WRAPPERS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
const EXT = { imageMessage: '.jpg', videoMessage: '.mp4', audioMessage: '.ogg' };

function ensureDir() {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
}
ensureDir();

// Poore message tree mein view-once media dhoondo.
// viaVO = kisi view-once wrapper ke andar se guzre hain ya nahi.
function findViewOnceMedia(root) {
    const stack = [{ node: root, viaVO: false, depth: 0 }];
    while (stack.length) {
        const { node, viaVO, depth } = stack.pop();
        if (!node || typeof node !== 'object' || depth > 7) continue;
        for (const key of Object.keys(node)) {
            const value = node[key];
            if (!value || typeof value !== 'object') continue;
            if (MEDIA_TYPES.includes(key)) {
                if (viaVO || value.viewOnce) {
                    return { media: value, vType: key };
                }
                continue; // aam media hai, is ke andar mazeed nahi jana
            }
            stack.push({ node: value, viaVO: viaVO || VO_WRAPPERS.includes(key), depth: depth + 1 });
        }
    }
    return null;
}

function hasAnyMedia(root) {
    const stack = [{ node: root, depth: 0 }];
    while (stack.length) {
        const { node, depth } = stack.pop();
        if (!node || typeof node !== 'object' || depth > 7) continue;
        for (const key of Object.keys(node)) {
            if (MEDIA_TYPES.includes(key)) return true;
            const value = node[key];
            if (value && typeof value === 'object') stack.push({ node: value, depth: depth + 1 });
        }
    }
    return false;
}

// .hm command ke liye bhi yehi detection chahiye hoti hai
function unwrapMessage(message) {
    let current = message;
    for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
        const inner =
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message ||
            current.viewOnceMessageV2Extension?.message ||
            current.ephemeralMessage?.message ||
            null;
        if (!inner) break;
        current = inner;
    }
    return current;
}

function sanitizeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function loadJson(file, fallback) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) || fallback;
    } catch (_) {}
    return fallback;
}

function saveJson(file, data) {
    try {
        ensureDir();
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (_) {}
}

function recordStats(patch) {
    const stats = loadJson(STATS_FILE, { calls: 0, saved: 0 });
    const { saved, ...rest } = patch;
    Object.assign(stats, rest);
    stats.calls = (stats.calls || 0) + 1;
    if (saved) stats.saved = (stats.saved || 0) + 1;
    stats.at = new Date().toISOString();
    saveJson(STATS_FILE, stats);
}

// vv.js ke error mein dikhane ke liye ek line ki cache report
function getCacheStatus() {
    try {
        if (!fs.existsSync(STATS_FILE)) {
            return 'cache hook kabhi nahi chala — index.js replace nahi hua ya bot restart nahi hua';
        }
        const s = loadJson(STATS_FILE, {});
        const index = loadJson(INDEX_FILE, {});
        return `hook calls=${s.calls || 0}, saved=${s.saved || 0}, cache mein kul=${Object.keys(index).length}, ` +
            `aakhri message keys=[${s.lastKeys || '?'}], aakhri nateeja=${s.lastResult || '?'}` +
            (s.lastError ? `, aakhri error=${s.lastError}` : '');
    } catch (e) {
        return 'status nahi parha gaya: ' + (e?.message || e);
    }
}

function prune(index) {
    const now = Date.now();
    for (const id of Object.keys(index)) {
        if (now - (index[id].ts || 0) > MAX_AGE_MS) {
            try { fs.unlinkSync(path.join(CACHE_DIR, index[id].file)); } catch (_) {}
            delete index[id];
        }
    }
    const sorted = Object.keys(index).sort((a, b) => (index[a].ts || 0) - (index[b].ts || 0));
    while (sorted.length > MAX_ENTRIES) {
        const id = sorted.shift();
        try { fs.unlinkSync(path.join(CACHE_DIR, index[id].file)); } catch (_) {}
        delete index[id];
    }
    return index;
}

// Har aane wale message par index.js (handler ke sab se oopar se)
// isay call karta hai. Kabhi throw nahi karta.
async function cacheViewOnceMessage(msg) {
    try {
        const id = msg?.key?.id;
        if (!id || !msg.message) return false;

        const found = findViewOnceMedia(msg.message);
        if (!found) {
            // Sirf media walay messages ka record rakho (diagnostics)
            if (hasAnyMedia(msg.message)) {
                recordStats({
                    lastKeys: Object.keys(msg.message).join(','),
                    lastResult: 'media tha lekin view-once nahi'
                });
            }
            return false;
        }

        const { media, vType } = found;
        const index = loadJson(INDEX_FILE, {});
        const existing = index[id];
        if (existing?.file && fs.existsSync(path.join(CACHE_DIR, existing.file))) {
            return true;
        }

        const stream = await downloadContentFromMessage(media, vType.replace('Message', ''));
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        if (!buffer.length) {
            recordStats({
                lastKeys: Object.keys(msg.message).join(','),
                lastResult: 'view-once mila lekin download khali buffer',
                lastError: 'empty buffer'
            });
            return false;
        }

        ensureDir();
        const file = sanitizeId(id) + (EXT[vType] || '.bin');
        fs.writeFileSync(path.join(CACHE_DIR, file), buffer);

        index[id] = {
            file,
            vType,
            caption: media.caption || '',
            mimetype: media.mimetype || '',
            ptt: media.ptt || false,
            gifPlayback: media.gifPlayback || false,
            ts: Date.now()
        };
        saveJson(INDEX_FILE, prune(index));
        recordStats({
            saved: true,
            lastKeys: Object.keys(msg.message).join(','),
            lastResult: 'view-once cache ho gaya',
            lastError: ''
        });
        return true;
    } catch (e) {
        try {
            recordStats({
                lastKeys: msg?.message ? Object.keys(msg.message).join(',') : '?',
                lastResult: 'view-once download fail',
                lastError: String(e?.message || e).slice(0, 200)
            });
        } catch (_) {}
        console.error('[ViewOnceCache] save failed:', e?.message || e);
        return false;
    }
}

// .hm command ke waqt stanzaId se cached copy nikalo
function getCachedViewOnce(id) {
    try {
        if (!id) return null;
        const index = loadJson(INDEX_FILE, {});
        const entry = index[id];
        if (!entry?.file) return null;
        const filePath = path.join(CACHE_DIR, entry.file);
        if (!fs.existsSync(filePath)) return null;
        const buffer = fs.readFileSync(filePath);
        if (!buffer.length) return null;
        return {
            buffer,
            vType: entry.vType,
            media: {
                caption: entry.caption || '',
                mimetype: entry.mimetype || '',
                ptt: entry.ptt || false,
                gifPlayback: entry.gifPlayback || false
            }
        };
    } catch (_) {
        return null;
    }
}

module.exports = { cacheViewOnceMessage, getCachedViewOnce, getCacheStatus, findViewOnceMedia, unwrapMessage };
