// ============================================================
// Media Cache (v7) — .hm ke liye
// ------------------------------------------------------------
// Sach jo live tests se sabit hua:
// 1) View-once bot ko AAM imageMessage ki shakal mein aata hai
//    (na wrapper, na flag) — is liye HAR aane wala media aate hi
//    save hota hai, pehchan ki koi shart nahi.
// 2) Reply ke waqt quoted message mein media ka data (url /
//    directPath / mediaKey) NAHI hota — download sirf arrival
//    par mumkin hai.
// 3) v6 ka masla: stats sirf media milne par likhe jate thay,
//    aur handler ka pehla guard (messages[0].message na ho to
//    return) poori batch ka media chhod deta tha — offline /
//    sync batches mein yahi hota hai. v7 mein:
//    - hook handler mein SAB SE PEHLE chalta hai (guard se bhi
//      pehle), batch ke har message par
//    - har call record hoti hai (calls counter), taake status
//      hamesha sach bole ke hook chala ya nahi
//    - koi error chhupa nahi rehta: write fail ho to log banta
//      hai, aur data/ folder likhne ke qabil na ho to cache
//      khud tmp folder par shift ho jata hai
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    downloadContentFromMessage,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

// Cache folder: pehle bot ke data/viewonce ko try karo. Agar
// wahan likhna mumkin na ho (permissions waghera), to OS ke
// tmp folder par gir jao — warna cache khamoshi se fail hota
// rahega aur pata bhi nahi chalega.
function pickCacheDir() {
    const primary = path.join(__dirname, '..', 'data', 'viewonce');
    try {
        fs.mkdirSync(primary, { recursive: true });
        const probe = path.join(primary, '.write-test');
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return primary;
    } catch (e) {
        const fallback = path.join(os.tmpdir(), 'mano-viewonce-cache');
        try { fs.mkdirSync(fallback, { recursive: true }); } catch (_) {}
        console.error('[MediaCache] data/ folder mein likhna fail (' + (e?.message || e) + ') — cache yahan shift ho gaya: ' + fallback);
        return fallback;
    }
}

const CACHE_DIR = pickCacheDir();
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
        return true;
    } catch (e) {
        // v7: khamoshi khatam — write fail Railway logs mein
        // nazar aana chahiye, warna diagnosis mumkin nahi.
        console.error('[MediaCache] file write fail (' + path.basename(file) + '):', e?.message || e);
        return false;
    }
}

// Har hook call par sirf counter barhao — history sirf media
// walay outcomes ki banti hai, warna text messages history
// bhar denge aur asal record ghayab ho jayega.
function recordCall() {
    const stats = loadJson(STATS_FILE, { calls: 0, saved: 0, history: [] });
    stats.calls = (stats.calls || 0) + 1;
    if (!Array.isArray(stats.history)) stats.history = [];
    saveJson(STATS_FILE, stats);
}

function recordHistory(entry) {
    const stats = loadJson(STATS_FILE, { calls: 0, saved: 0, history: [] });
    if (entry.saved) stats.saved = (stats.saved || 0) + 1;
    stats.history = Array.isArray(stats.history) ? stats.history : [];
    stats.history.push({ at: new Date().toISOString(), ...entry });
    stats.history = stats.history.slice(-6);
    saveJson(STATS_FILE, stats);
}

function getCacheStatus() {
    try {
        if (!fs.existsSync(STATS_FILE)) {
            return 'cache hook is restart ke baad abhi tak ek bhi dafa nahi chala';
        }
        const s = loadJson(STATS_FILE, {});
        const index = loadJson(INDEX_FILE, {});
        const hist = (s.history || [])
            .map((h) => `[${h.topKeys || '?'} -> ${h.result || '?'}${h.found ? ', media=' + h.found : ''}${h.found ? ', path=' + (h.hasDirectPath ? 'hai' : 'NAHI') : ''}]`)
            .join(' ');
        return `hook calls=${s.calls || 0}, saved=${s.saved || 0}, cache mein kul=${Object.keys(index).length} | aakhri records: ${hist || 'abhi tak koi media nahi aaya'}`;
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
    // Pehle downloadMediaMessage (poora message object use
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

// Har aane wale message par index.js (handler ke sab se oopar,
// kisi guard se pehle) isay call karta hai. HAR media cache
// hota hai — view-once ho ya aam. Kabhi throw nahi karta.
async function cacheViewOnceMessage(msg, sock) {
    // v7: call SAB SE PEHLE record karo — taake status line
    // hamesha ye bata sake ke hook asal mein chala ya nahi,
    // chahe is message mein media ho ya na ho.
    try { recordCall(); } catch (_) {}
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

        // Agar media ke paas na key hai, na path, na url —
        // download mumkin hi nahi (ye aksar sync/placeholder
        // copies hoti hain). Baileys ko call hi mat karo, warna
        // "Cannot derive from empty media key" wala error logs
        // mein bharta rahega. Saaf skip record kar do.
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
        // v7: exception bhi record karo — khamoshi khatam.
        try {
            recordHistory({ result: 'exception', error: String(e?.message || e).slice(0, 160) });
        } catch (_) {}
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

const VERSION = 'v7-hook-first';

module.exports = { cacheViewOnceMessage, getCachedViewOnce, getCacheStatus, findMedia, findViewOnceMedia: findMedia, unwrapMessage, VERSION };
