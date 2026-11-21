// ============================================================
// .hm — View-Once downloader
// ------------------------------------------------------------
// Asal sach jo tests se sabit hua: jab aap kisi view-once
// par REPLY karte hain to WhatsApp quoted message mein sirf
// "Photo" wala placeholder deta hai — asal media ka data
// (url / directPath / mediaKey) quoted mein hota hi nahi.
// Is liye sirf reply ke waqt download karna mumkin nahi
// raha — yehi wajah hai ke purani seedhi vv.js ab
// "No valid media URL or directPath" par atakti thi.
//
// Hal — isi file ke andar: ye command apna ek listener
// lagati hai jo har aane wale media ko AATE HI download
// karke yaad (memory) mein rakh leta hai. Phir .hm par wahi
// copy foran bhej di jati hai. Koi cache system, koi disk
// file nahi — sab kuch isi vv.js ke andar hai. Memory wali
// copy bot restart par khatam ho jati hai, is liye .hm
// unhi view-once par chalega jo bot ke online hone ke baad
// aaye hon.
//
// Har qadam Railway logs mein [VV] ke saath likha jata hai
// taake koi bhi nakami khamosh na rahe — media aaya ya
// nahi, us ke paas download data tha ya nahi, download hua
// ya kis wajah se ruka, sab nazar aata hai.
// ============================================================

const { downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');

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

const silentLogger = {
    debug() {}, info() {}, warn() {}, error() {}, trace() {},
    child() { return this; }
};
const log = (...args) => console.log('[VV]', ...args);

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

// Har aane wale message ko dekho — media ho to logs mein
// likho ke us ke paas download ka data hai ya nahi, aur ho
// to usi waqt download karke yaad kar lo. Pehle wo tareeqa
// jo is bot ke antidelete mein chalta hai (downloadMedia-
// Message, sock ke zariye), phir seedha stream wala.
async function captureMessage(sock, m, via) {
    const id = m?.key?.id;
    if (!id || !m.message) return;
    const found = findMedia(unwrap(m.message));
    if (!found) return;
    const { media, vType } = found;

    const hasKey = !!media.mediaKey;
    const hasPath = !!(media.url || media.directPath);
    log(`media dekha: id=${id} type=${vType} via=${via || '?'} fromMe=${!!m.key.fromMe} key=${hasKey ? 'hai' : 'NAHI'} path=${hasPath ? 'hai' : 'NAHI'}`);

    if (seen.has(id)) return;
    if (m.key.fromMe && String(id).startsWith('BAE5')) {
        log(`skip ${id}: bot ki apni bheji media hai (BAE5)`);
        return;
    }
    if (!hasKey || !hasPath) {
        log(`skip ${id}: is copy ke paas download data nahi (key=${hasKey}, path=${hasPath})`);
        return;
    }

    const errors = [];
    try {
        const fakeMsg = { key: m.key, message: unwrap(m.message) };
        const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {}, {
            logger: silentLogger,
            reuploadRequest: sock.updateMediaMessage
        });
        if (buffer && buffer.length) {
            saveSeen(id, m, found, buffer);
            log(`saved ${id}: ${buffer.length} bytes (downloadMediaMessage)`);
            return;
        }
        errors.push('downloadMediaMessage: khaali buffer');
    } catch (e) {
        errors.push('downloadMediaMessage: ' + (e?.message || e));
    }
    try {
        const buffer = await downloadNode(media, vType);
        if (buffer && buffer.length) {
            saveSeen(id, m, found, buffer);
            log(`saved ${id}: ${buffer.length} bytes (direct stream)`);
            return;
        }
        errors.push('direct: khaali buffer');
    } catch (e) {
        errors.push('direct: ' + (e?.message || e));
    }
    log(`FAILED ${id}: ` + errors.join(' | ').slice(0, 300));
}

function saveSeen(id, m, found, buffer) {
    const { media, vType } = found;
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
}

// Ek sock par sirf ek dafa listener lagao. Ye bot ke start
// par index.js se lag jata hai (neeche export dekho), taake
// pehle .hm ka intezar hi na karna pare — bot online hote
// hi aane wala har media yaad hona shuru ho jata hai.
function hook(sock) {
    try {
        if (!sock?.ev?.on || sock.__vvHooked) return;
        sock.__vvHooked = true;
        sock.ev.on('messages.upsert', (update) => {
            for (const m of update?.messages || []) {
                captureMessage(sock, m, update?.type).catch((e) => log('capture error:', e?.message || e));
            }
        });
        log('arrival listener lag gaya — aane wale media yaad rakhe jayenge');
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
        log(`.hm lookup: stanza=${ctx.stanzaId || '?'} seen=${seen.size} exact=${entry ? 'HIT' : 'miss'}`);
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
                log('.hm lookup: fallback (isi chat ki halia copy) mili');
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

        // Tareeqa 2: quoted message ko sock ke zariye download
        // karo — agar quoted node ke paas mediaKey ho lekin
        // URL na ho to reupload se taza path mil sakta hai.
        try {
            const fakeQuoted = {
                key: {
                    remoteJid: from,
                    fromMe: false,
                    id: ctx.stanzaId || undefined,
                    participant: msg.key?.participant
                },
                message: inner
            };
            const buffer = await downloadMediaMessage(fakeQuoted, 'buffer', {}, {
                logger: silentLogger,
                reuploadRequest: sock.updateMediaMessage
            });
            if (buffer && buffer.length) {
                const payload = buildPayload({ buffer, vType: found.vType, media: found.media }, null);
                await sock.sendMessage(from, payload, { quoted: msg });
                if (from !== OWNER) {
                    await sock.sendMessage(OWNER, payload).catch(() => {});
                }
                return;
            }
            throw new Error('downloadMediaMessage: khaali buffer');
        } catch (e2) {
            log('.hm quoted downloadMediaMessage fail:', e2?.message || e2);
        }

        // Tareeqa 3 (purana seedha): agar quoted mein data ho
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
        log('download failed:', e?.message || e);
        await sock.sendMessage(from, {
            text: '❌ Failed to download View-Once media.\n\n*Reason:* ' + String(e?.message || e).slice(0, 250) +
                '\n\n_Note: view-once usi waqt bhejein jab bot online ho — bot aate hi us ki copy yaad kar leta hai, phir .hm usi ko bhejta hai._'
        }, { quoted: msg }).catch(() => {});
    }
}

module.exports = vvCommand;
// index.js har session ke sock par ye call karta hai taake
// capture bot ke online hote hi shuru ho jaye — pehli .hm
// ka intezar khatam.
module.exports.hookCapture = hook;
