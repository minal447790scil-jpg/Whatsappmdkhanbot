// ============================================================
// Media Cache (v4) — .hm ke liye
// ------------------------------------------------------------
// Live diagnostics ne sabit kiya: is WhatsApp version mein
// view-once bot ko AAM imageMessage ki shakal mein aata hai —
// na koi viewOnce wrapper, na viewOnce flag. Is liye "view-once
// pehchan kar save karna" har dafa miss ho raha tha.
//
// FINAL HAL: pehchan ki shart hi khatam. Bot ko aane wala HAR
// media (photo / video / voice note) aate hi save kar lo.
// .hm par stanzaId se wohi copy nikaal kar bhej do — media
// view-once tha ya aam, is se koi farq nahi parta.
// (Bot ka apna antidelete bhi bilkul yahi karta hai.)
// ============================================================

const fs = require('fs');
const path = require('path');
const {
    downloadContentFromMessage,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'viewonce');
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');
const STATS_FILE = path.join(CACHE_DIR, 'stats.json');
const MAX_ENTRIES = 150;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 ghante
const MAX_SIZE = 50 * 1024 * 1024; // 50MB se bara media skip

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];
const VO_WRAPPERS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
const EXT = { imageMessage: '.jpg', videoMessage: '.mp4', audioMessage: '.ogg' };

function ensureDir() {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
}
ensureDir();

// Message tree mein pehla media dhoondo — kisi bhi wrapper ke
// andar ho. 'contextInfo' ke andar nahi jana (wahan quoted
// message hota hai, is message ka apna media nahi).
function findMedia(root) {
    const stack = [{ node: root, depth: 0 }];
    while (stack.length) {
        const { node, depth } = stack.pop();
        if (!node || typeof node !== 'object' || depth > 7) continue;
        for (const key of Object.keys(node)) {
            if (key === 'contextInfo') continue;
            const value = node[key];
            if (!value || typeof value !== 'object') continue;
            if (MEDIA_TYPES.includes(key)) {
                return { media: value, vType: key };
            }
            stack.push({ node: value, depth: depth + 1 });
        }
    }
    return null;
}

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

function recordHistory(entry) {
    const stats = loadJson(STATS_FILE, { calls: 0, saved: 0, history: [] });
    stats.calls = (stats.calls || 0) + 1;
    if (entry.saved) stats.saved = (stats.saved || 0) + 1;
    stats.history = Array.isArray(stats.history) ? stats.history : [];
    stats.history.push({ at: new Date().toISOString(), ...entry });
    stats.history = stats.history.slice(-6);
    saveJson(STATS_FILE, stats);
}

function getCacheStatus() {
    try {
        if (!fs.existsSync(STATS_FILE)) {
            return 'cache hook kabhi nahi chala — index.js replace nahi hua ya bot restart nahi hua';
        }
        const s = loadJson(STATS_FILE, {});
        const index = loadJson(INDEX_FILE, {});
        const hist = (s.history || [])
            .map((h) => `[${h.topKeys || '?'} -> ${h.result || '?'}${h.found ? ', media=' + h.found : ''}${h.found ? ', path=' + (h.hasDirectPath ? 'hai' : 'NAHI') : ''}]`)
            .join(' ');
        return `hook calls=${s.calls || 0}, saved=${s.saved || 0}, cache mein kul=${Object.keys(index).length} | aakhri records: ${hist || 'koi nahi'}`;
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

async function downloadArrivalMedia(msg, media, vType, sock) {
    // v6: pehle downloadMediaMessage (poora message object use
    // karta hai — mediaKey/directPath handling is mein sab se
    // reliable hai), phir direct stream fallback.
    let lastErr = null;
    try {
        const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            {
                logger: sock?.logger || undefined,
                reuploadRequest: sock?.updateMediaMessage
            }
        );
        if (buffer && buffer.length) return buffer;
        lastErr = new Error('mediaMessage: empty buffer');
    } catch (e) {
        lastErr = e;
    }
    try {
        const stream = await downloadContentFromMessage(media, vType.replace('Message', ''));
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        if (buffer.length) return buffer;
        lastErr = new Error('direct: empty buffer');
    } catch (e) {
        lastErr = e;
    }
    throw lastErr || new Error('download failed');
}

// Har aane wale message par index.js (handler ke sab se oopar se)
// isay call karta hai. HAR media cache hota hai — view-once ho
// ya aam. Kabhi throw nahi karta.
async function cacheViewOnceMessage(msg, sock) {
    try {
        const id = msg?.key?.id;
        if (!id || !msg.message) return false;

        const topKeys = Object.keys(msg.message).join(',');
        const found = findMedia(msg.message);

        if (!found) {
            if (VO_WRAPPERS.some((w) => msg.message[w]) || msg.message.ephemeralMessage) {
                const inner = unwrapMessage(msg.message);
                recordHistory({
                    topKeys,
                    result: 'wrapper tha lekin media nahi mila',
                    innerKeys: inner && typeof inner === 'object' ? Object.keys(inner).join(',') : '?'
                });
            }
            return false;
        }

        const { media, vType } = found;
        const flags = {
            found: vType,
            hasDirectPath: !!media.directPath,
            hasUrl: !!media.url,
            hasMediaKey: !!media.mediaKey
        };

        // v6: agar media ke paas na key hai, na path, na url —
        // download mumkin hi nahi (ye aksar sync/placeholder
        // copies hoti hain). Baileys ko call hi mat karo, warna
        // wahi "Cannot derive from empty media key" wala error
        // logs mein bharta rahega. Saaf skip record kar do.
        if (!flags.hasMediaKey && !flags.hasDirectPath && !flags.hasUrl) {
            recordHistory({ topKeys, ...flags, result: 'media key/path kuch nahi — skip (sync copy)' });
            return false;
        }

        const size = Number(media.fileLength || 0);
        if (size && size > MAX_SIZE) {
            recordHistory({ topKeys, ...flags, result: 'media bohat bara hai, skip' });
            return false;
        }

        const index = loadJson(INDEX_FILE, {});
        const existing = index[id];
        if (existing?.file && fs.existsSync(path.join(CACHE_DIR, existing.file))) {
            return true;
        }

        let buffer;
        try {
            buffer = await downloadArrivalMedia(msg, media, vType, sock);
        } catch (e) {
            recordHistory({
                topKeys,
                ...flags,
                result: 'media mila lekin ARRIVAL par bhi download fail',
                error: String(e?.message || e).slice(0, 160)
            });
            console.error('[MediaCache] arrival download failed:', e?.message || e);
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
        recordHistory({ topKeys, ...flags, saved: true, result: 'media cache ho gaya' });
        return true;
    } catch (e) {
        console.error('[MediaCache] save failed:', e?.message || e);
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

const VERSION = 'v6-railway';

module.exports = { cacheViewOnceMessage, getCachedViewOnce, getCacheStatus, findMedia, findViewOnceMedia: findMedia, unwrapMessage, VERSION };
