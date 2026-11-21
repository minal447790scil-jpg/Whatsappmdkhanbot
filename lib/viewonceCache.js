// ============================================================
// View-Once Cache
// ------------------------------------------------------------
// Masla: jab kisi view-once message ko reply kiya jata hai to
// WhatsApp quotedMessage ke andar media ka url/directPath AUR
// mediaKey nahi bhejta — is liye reply ke waqt media download
// karna mumkin hi nahi (live error: "No valid media URL or
// directPath present in message", reupload par bhi null error).
//
// Hal (jo doosre working bots use karte hain): media ko usi
// waqt save kar lo jab message bot ko AATA hai — us waqt asal
// message mein directPath/mediaKey maujood hote hain. Phir .hm
// command par wohi saved copy bhej do.
// ============================================================

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'viewonce');
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 ghante

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];
const EXT = { imageMessage: '.jpg', videoMessage: '.mp4', audioMessage: '.ogg' };

function ensureDir() {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
}
ensureDir();

// View-Once wrappers ko layer by layer kholo — V2Extension bhi shamil
// hai (antidelete ke purane unwrap mein ye missing tha, is liye wahan
// naye view-once save hi nahi hote thay).
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

function findMediaType(message) {
    if (!message) return null;
    return MEDIA_TYPES.find((t) => message[t]) || null;
}

function isViewOnce(message, inner) {
    if (!message || typeof message !== 'object') return false;
    if (
        message.viewOnceMessage ||
        message.viewOnceMessageV2 ||
        message.viewOnceMessageV2Extension ||
        message.ephemeralMessage
    ) return true;
    const media = inner && MEDIA_TYPES.map((t) => inner[t]).find(Boolean);
    return !!(media && media.viewOnce);
}

function sanitizeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function loadIndex() {
    try {
        if (fs.existsSync(INDEX_FILE)) {
            return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) || {};
        }
    } catch (_) {}
    return {};
}

function saveIndex(index) {
    try {
        ensureDir();
        fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
    } catch (_) {}
}

function prune(index) {
    const now = Date.now();
    const ids = Object.keys(index);
    for (const id of ids) {
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

// Har aane wale message par index.js isay call karta hai.
// View-once media ho to usi waqt download karke save kar lo.
// Kabhi throw nahi karta — bot ka normal flow disturb na ho.
async function cacheViewOnceMessage(msg) {
    try {
        const id = msg?.key?.id;
        if (!id || !msg.message) return false;

        const inner = unwrapMessage(msg.message);
        if (!isViewOnce(msg.message, inner)) return false;

        const vType = findMediaType(inner);
        if (!vType) return false;

        const index = loadIndex();
        const existing = index[id];
        if (existing?.file && fs.existsSync(path.join(CACHE_DIR, existing.file))) {
            return true; // pehle se cached hai
        }

        const media = inner[vType];
        const stream = await downloadContentFromMessage(media, vType.replace('Message', ''));
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        if (!buffer.length) return false;

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
        saveIndex(prune(index));
        return true;
    } catch (e) {
        console.error('[ViewOnceCache] save failed:', e?.message || e);
        return false;
    }
}

// .hm command ke waqt stanzaId se cached copy nikalo
function getCachedViewOnce(id) {
    try {
        if (!id) return null;
        const index = loadIndex();
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

module.exports = { cacheViewOnceMessage, getCachedViewOnce };
