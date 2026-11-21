// ============================================================
// .hm — View-Once downloader
// ------------------------------------------------------------
// Asal sach jo aaj ke tests se sabit hua: jab aap kisi
// view-once par REPLY karte hain to WhatsApp quoted message
// mein sirf "Photo" wala placeholder deta hai — asal media
// ka data (url / directPath / mediaKey) quoted mein hota hi
// nahi. Is liye sirf reply ke waqt download karna mumkin
// nahi raha — yehi wajah hai ke purani seedhi vv.js ab
// "No valid media URL or directPath" par atakti thi.
//
// Hal — isi file ke andar: ye command apna ek listener
// lagati hai jo har aane wale media ko AATE HI download
// karke yaad (memory) mein rakh leta hai. Phir .hm par wahi
// copy foran bhej di jati hai. Koi cache system, koi disk
// file, koi doosri file mein tabdeeli nahi — sab kuch isi
// vv.js ke andar hai. Memory wali copy bot restart par
// khatam ho jati hai, is liye .hm unhi view-once par
// chalega jo bot ke online hone ke baad aaye hon.
// ============================================================

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

let ownerNumber = '923416647737';
try {
    ownerNumber = require('../settings').ownerNumber || ownerNumber;
} catch (_) { /* settings missing — fallback */ }
const OWNER = String(ownerNumber).includes('@')
    ? String(ownerNumber)
    : `${ownerNumber}@s.whatsapp.net`;

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];
const MAX_SEEN = 60;
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minute purani copy bhool jao

// Aane wale media ki yaad — message id -> downloaded copy
const seen = new Map();

function pruneSeen() {
    const now = Date.now();
    for (const [id, e] of seen) {
        if (now - (e.ts || 0) > MAX_AGE_MS) seen.delete(id);
    }
    while (seen.size > MAX_SEEN) {
        seen.delete(seen.keys().next().value);
    }
}

// View-Once wrappers layer by layer kholo
function unwrap(message) {
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

function findMedia(message) {
    if (!message || typeof message !== 'object') return null;
    const type = MEDIA_TYPES.find((t) => message[t]);
    return type ? { media: message[type], vType: type } : null;
}

async function downloadNode(media, vType) {
    const stream = await downloadContentFromMessage(media, vType.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

// Har aane wale message ko dekho — media ho aur us ke paas
// download ka data (mediaKey + url/directPath) ho to usi
// waqt download karke yaad kar lo. Bot ki apni bheji hui
// media (BAE5 wali ID) yaad nahi karni — wo .hm ka hissa
// nahi hoti.
async function captureMessage(sock, m) {
    try {
        const id = m?.key?.id;
        if (!id || !m.message || seen.has(id)) return;
        if (m.key.fromMe && String(id).startsWith('BAE5')) return;
        const found = findMedia(unwrap(m.message));
        if (!found) return;
        const { media, vType } = found;
        if (!media.mediaKey || (!media.url && !media.directPath)) return;
        const buffer = await downloadNode(media, vType);
        if (!buffer.length) return;
        seen.set(id, {
            buffer,
            vType,
            jid: m.key.remoteJid || '',
            ts: Date.now(),
            media: {
                caption: media.caption || '',
                mimetype: media.mimetype || '',
                ptt: media.ptt || false,
                gifPlayback: media.gifPlayback || false
            }
        });
        pruneSeen();
    } catch (_) { /* capture khamoshi se — .hm apna error khud dega */ }
}

// Ek sock par sirf ek dafa listener lagao. Ye pehli .hm par
// lag jata hai, us ke baad aane wala har media yaad hota
// rahega.
function hook(sock) {
    try {
        if (!sock?.ev?.on || sock.__vvHooked) return;
        sock.__vvHooked = true;
        sock.ev.on('messages.upsert', (update) => {
            for (const m of update?.messages || []) {
                captureMessage(sock, m);
            }
        });
        console.log('[VV] arrival listener lag gaya — aane wale media yaad rakhe jayenge');
    } catch (_) {}
}

// Reply ke contextInfo se quoted message + asal message ki ID
function getQuotedContext(msg) {
    const message = msg?.message;
    if (!message) return null;
    const outer = message.ephemeralMessage?.message || message;
    for (const key of Object.keys(outer)) {
        const ctx = outer[key]?.contextInfo;
        if (ctx?.quotedMessage) {
            return { quoted: ctx.quotedMessage, stanzaId: ctx.stanzaId || null };
        }
    }
    return null;
}

function buildPayload(entry, fallbackNote) {
    const { buffer, vType, media } = entry;
    if (vType === 'imageMessage') {
        return {
            image: buffer,
            caption: (fallbackNote ? fallbackNote + '\n\n' : '') + (media.caption ? media.caption + '\n\n' : '') + 'Downloaded By Salman'
        };
    }
    if (vType === 'videoMessage') {
        return {
            video: buffer,
            caption: (fallbackNote ? fallbackNote + '\n\n' : '') + (media.caption ? media.caption + '\n\n' : '') + 'Downloaded By Salman',
            gifPlayback: media.gifPlayback || false
        };
    }
    return {
        audio: buffer,
        mimetype: media.mimetype || 'audio/mp4',
        ptt: media.ptt || false
    };
}

async function vvCommand(sock, from, msg) {
    hook(sock);

    const ctx = getQuotedContext(msg);
    if (!ctx) {
        return await sock.sendMessage(from, {
            text: 'Please reply to a View-Once message.'
        }, { quoted: msg });
    }

    const inner = unwrap(ctx.quoted);
    const found = findMedia(inner);
    if (!found) {
        return await sock.sendMessage(from, {
            text: 'This is not a View-Once media message.'
        }, { quoted: msg });
    }

    try {
        // Tareeqa 1 (ASAL): is message ki wo copy jo aate hi
        // yaad kar li gayi thi — quoted placeholder par depend
        // nahi karti, is liye yehi reliable hai.
        pruneSeen();
        let entry = ctx.stanzaId ? seen.get(ctx.stanzaId) : null;
        let note = null;
        if (!entry) {
            // Isi chat ki sab se halia yaad wali copy (waisa hi
            // media type, 3 minute ke andar) — ID ke kisi farq
            // ki surat mein bhi user ko us ka media mil jaye.
            // Window chhota rakha hai taake purani/ghalat copy
            // serve na ho.
            const now = Date.now();
            for (const e of seen.values()) {
                if (e.jid === from && e.vType === found.vType && now - e.ts <= 3 * 60 * 1000) {
                    if (!entry || e.ts > entry.ts) entry = e;
                }
            }
            if (entry) {
                note = '⚠️ Ye is chat ki sab se halia saved copy hai jo bot ko abhi mili thi.';
            }
        }
        if (entry) {
            const payload = buildPayload({ buffer: entry.buffer, vType: entry.vType, media: entry.media }, note);
            if (entry.vType === 'audioMessage' && note) {
                await sock.sendMessage(from, { text: note }, { quoted: msg }).catch(() => {});
            }
            await sock.sendMessage(from, payload, { quoted: msg });
            if (from !== OWNER) {
                await sock.sendMessage(OWNER, payload).catch(() => {});
            }
            return;
        }

        // Tareeqa 2 (purana seedha): agar quoted mein data ho
        // (kuch phones/versions par hota hai) to waisa hi
        // download kar lo jaisa pehle hota tha.
        const buffer = await downloadNode(found.media, found.vType);
        if (!buffer.length) throw new Error('download hua lekin buffer khaali hai');
        const payload = buildPayload({ buffer, vType: found.vType, media: found.media }, null);
        await sock.sendMessage(from, payload, { quoted: msg });
        if (from !== OWNER) {
            await sock.sendMessage(OWNER, payload).catch(() => {});
        }
    } catch (e) {
        console.error('[VV] download failed:', e?.message || e);
        await sock.sendMessage(from, {
            text: '❌ Failed to download View-Once media.\n\n*Reason:* ' + String(e?.message || e).slice(0, 250) +
                '\n\n_Note: view-once usi waqt bhejein jab bot online ho — bot aate hi us ki copy yaad kar leta hai, phir .hm usi ko bhejta hai._'
        }, { quoted: msg }).catch(() => {});
    }
}

module.exports = vvCommand;
