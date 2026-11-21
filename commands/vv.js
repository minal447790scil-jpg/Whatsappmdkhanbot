const fs = require('fs');
const path = require('path');
const {
    downloadContentFromMessage,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

// View-once cache: media us waqt save hota hai jab message bot ko
// AATA hai (lib/viewonceCache.js + index.js). Reply ke waqt quoted
// message mein media ka data hota hi nahi, is liye ye cache hi
// asal aur reliable tareeqa hai.
let getCachedViewOnce = null;
try {
    getCachedViewOnce = require('../lib/viewonceCache').getCachedViewOnce;
} catch (_) { /* lib missing — baaki strategies try hongi */ }

// Owner JID settings.js se lo, warna purana hardcoded number fallback rakho
let ownerNumber = '923416647737';
try {
    ownerNumber = require('../settings').ownerNumber || ownerNumber;
} catch (_) { /* settings missing — fallback use hoga */ }
const OWNER_JID = String(ownerNumber).includes('@')
    ? String(ownerNumber)
    : `${ownerNumber}@s.whatsapp.net`;

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];

// Reply jis bhi message type par ho, uske contextInfo se quoted message
// + stanzaId (asal message ki ID) + participant (bhejne wala) nikalo.
function getQuotedContext(msg) {
    const message = msg?.message;
    if (!message) return null;
    const outer = message.ephemeralMessage?.message || message;
    for (const key of Object.keys(outer)) {
        const ctx = outer[key]?.contextInfo;
        if (ctx?.quotedMessage) {
            return {
                quoted: ctx.quotedMessage,
                stanzaId: ctx.stanzaId || null,
                participant: ctx.participant || ctx.remoteJid || null
            };
        }
    }
    return null;
}

// View-Once wrappers ko layer by layer kholo
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

function getLogger(sock) {
    if (sock?.logger) return sock.logger;
    try {
        return require('pino')({ level: 'silent' });
    } catch (_) {
        return undefined;
    }
}

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Kuch WhatsApp versions mein reupload ka jawab updateMediaMessage ke
// return ki bajaye 'messages.update' event se aata hai — dono suno.
function waitForMediaUpdate(sock, stanzaId, ms) {
    return new Promise((resolve) => {
        if (!sock?.ev?.on || !stanzaId) return resolve(null);
        const timer = setTimeout(() => { cleanup(); resolve(null); }, ms);
        const cleanup = () => {
            clearTimeout(timer);
            try {
                if (typeof sock.ev.removeListener === 'function') {
                    sock.ev.removeListener('messages.update', handler);
                    sock.ev.removeListener('messages.upsert', handler);
                } else if (typeof sock.ev.off === 'function') {
                    sock.ev.off('messages.update', handler);
                    sock.ev.off('messages.upsert', handler);
                }
            } catch (_) {}
        };
        const handler = (data) => {
            const list = Array.isArray(data) ? data : (data?.messages || []);
            for (const item of list) {
                const key = item?.key;
                const message = item?.update?.message || item?.message;
                if (key?.id === stanzaId && message && findMediaType(unwrapMessage(message))) {
                    cleanup();
                    return resolve({ key, message });
                }
            }
        };
        try {
            sock.ev.on('messages.update', handler);
            sock.ev.on('messages.upsert', handler);
        } catch (_) {
            cleanup();
            resolve(null);
        }
    });
}

// SAB SE AHEM TAREEQA — REUPLOAD:
// Live test se confirm hua hai ke jab kisi view-once ko reply kiya jata
// hai to quotedMessage ke andar media ka url/directPath HOTA HI NAHI
// (error: "No valid media URL or directPath present in message").
// Is liye quoted se direct download mumkin hi nahi. Hal ye hai ke
// sock.updateMediaMessage se sender se asal media dobara upload
// mangwaya jaye — us ke jawab mein jo message milta hai us mein
// url/directPath maujood hota hai, phir download ho sakta hai.
async function downloadViaReupload(sock, from, quotedCtx, fakeMsg) {
    if (typeof sock.updateMediaMessage !== 'function') {
        throw new Error('updateMediaMessage not available on this socket');
    }
    if (!quotedCtx.stanzaId) {
        throw new Error('stanzaId missing — original message cannot be identified');
    }

    let updated = await withTimeout(
        Promise.resolve().then(() => sock.updateMediaMessage(fakeMsg)),
        25000,
        'reupload request'
    );

    if (updated && !updated.message) {
        updated = await waitForMediaUpdate(sock, quotedCtx.stanzaId, 10000);
    }
    if (!updated?.message) {
        throw new Error('sender did not re-upload the media (sender offline hai ya view-once pehle khul chuka hai)');
    }

    const updatedInner = unwrapMessage(updated.message);
    const updatedType = findMediaType(updatedInner);
    if (!updatedType) {
        throw new Error('re-uploaded message has no media');
    }

    // Pehle downloadMediaMessage, phir direct stream
    try {
        const buffer = await downloadMediaMessage(
            updated,
            'buffer',
            {},
            { logger: getLogger(sock), reuploadRequest: sock.updateMediaMessage }
        );
        if (buffer && buffer.length) return { buffer, media: updatedInner[updatedType], vType: updatedType };
    } catch (_) { /* neeche wala tareeqa try hoga */ }

    const stream = await downloadContentFromMessage(
        updatedInner[updatedType],
        updatedType.replace('Message', '')
    );
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    if (!buffer.length) throw new Error('re-uploaded media buffer is empty');
    return { buffer, media: updatedInner[updatedType], vType: updatedType };
}

async function downloadViewOnce(sock, from, quotedCtx, inner, vType) {
    const errors = [];
    const media = inner[vType];

    // Tareeqa 0 (ASAL HAL): View-once cache — media jab bot ko aaya
    // tha, usi waqt save ho gaya tha. Quoted message par depend hi
    // nahi karta, is liye ye hamesha kaam karta hai un view-once
    // ke liye jo is fix ke baad bot ko mile hon.
    try {
        if (getCachedViewOnce && quotedCtx.stanzaId) {
            const cached = getCachedViewOnce(quotedCtx.stanzaId);
            if (cached?.buffer?.length) {
                return { buffer: cached.buffer, media: { ...media, ...cached.media }, vType: cached.vType || vType };
            }
        }
        errors.push('cache: is view-once ki copy cache mein nahi mili (ye fix lagane se pehle aaya hoga, ya 48 ghante se purana hai)');
    } catch (e) {
        errors.push('cache: ' + (e?.message || e));
    }

    const botIds = [sock?.user?.id, sock?.user?.lid]
        .filter(Boolean)
        .map((x) => String(x).split('@')[0].split(':')[0]);
    const partNum = String(quotedCtx.participant || '').split('@')[0].split(':')[0];
    const fakeMsg = {
        key: {
            remoteJid: from,
            fromMe: botIds.length && partNum ? botIds.includes(partNum) : false,
            id: quotedCtx.stanzaId || undefined,
            participant: quotedCtx.participant || undefined
        },
        message: quotedCtx.quoted
    };

    // Tareeqa 1: downloadMediaMessage (quoted mein url ho to yehi chalega —
    // aam photos/videos ke liye ye tareeqa bot mein pehle se kaam karta hai)
    try {
        const buffer = await downloadMediaMessage(
            fakeMsg,
            'buffer',
            {},
            { logger: getLogger(sock), reuploadRequest: sock.updateMediaMessage }
        );
        if (buffer && buffer.length) return { buffer, media, vType };
        errors.push('mediaMessage: empty buffer');
    } catch (e) {
        errors.push('mediaMessage: ' + (e?.message || e));
    }

    // Tareeqa 2: direct stream
    try {
        const stream = await downloadContentFromMessage(media, vType.replace('Message', ''));
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        if (buffer.length) return { buffer, media, vType };
        errors.push('direct: empty buffer');
    } catch (e) {
        errors.push('direct: ' + (e?.message || e));
    }

    // Tareeqa 3: REUPLOAD — view-once ke liye asal hal (upar tafseel dekho)
    try {
        return await downloadViaReupload(sock, from, quotedCtx, fakeMsg);
    } catch (e) {
        errors.push('reupload: ' + (e?.message || e));
    }

    // Tareeqa 4: bot ka antidelete store (sirf jab antidelete ON ho —
    // media pehle se disk par save hota hai, server ki zaroorat nahi)
    try {
        if (quotedCtx.stanzaId) {
            const dbPath = path.join(__dirname, '..', 'data', 'messages.json');
            if (fs.existsSync(dbPath)) {
                const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                const entry = db[quotedCtx.stanzaId];
                if (entry?.mediaPath && fs.existsSync(entry.mediaPath)) {
                    const buffer = fs.readFileSync(entry.mediaPath);
                    if (buffer.length) return { buffer, media, vType };
                }
            }
        }
        errors.push('store: media not found locally (antidelete OFF hai to ye tareeqa kaam nahi karega)');
    } catch (e) {
        errors.push('store: ' + (e?.message || e));
    }

    throw new Error(errors.join(' | '));
}

async function vvCommand(sock, from, msg) {
    try {
        const quotedCtx = getQuotedContext(msg);

        if (!quotedCtx) {
            return await sock.sendMessage(from, {
                text: '❌ Please reply to a View-Once photo / video / voice note with *.hm*'
            }, { quoted: msg });
        }

        const inner = unwrapMessage(quotedCtx.quoted);
        const vType = findMediaType(inner);

        if (!vType) {
            return await sock.sendMessage(from, {
                text: '❌ This is not a View-Once media message. Reply to a View-Once photo, video or voice note.'
            }, { quoted: msg });
        }

        const { buffer, media, vType: finalType } =
            await downloadViewOnce(sock, from, quotedCtx, inner, vType);

        let payload;
        if (finalType === 'imageMessage') {
            payload = {
                image: buffer,
                caption: (media.caption ? media.caption + '\n\n' : '') + '👁️ *View-Once saved — Downloaded By Salman*'
            };
        } else if (finalType === 'videoMessage') {
            payload = {
                video: buffer,
                caption: (media.caption ? media.caption + '\n\n' : '') + '👁️ *View-Once saved — Downloaded By Salman*',
                gifPlayback: media.gifPlayback || false
            };
        } else {
            payload = {
                audio: buffer,
                mimetype: media.mimetype || 'audio/mp4',
                ptt: media.ptt || false
            };
        }

        // 1) Usi chat mein wapas bhejo jahan command chali
        await sock.sendMessage(from, payload, { quoted: msg });

        // 2) Owner ko bhi ek copy (agar command owner ki apni chat mein nahi chali)
        if (from !== OWNER_JID) {
            await sock.sendMessage(OWNER_JID, payload)
                .catch((e) => console.error('[VV] Owner forward failed:', e.message));
        }
    } catch (e) {
        console.error('[VV] Error:', e);
        await sock.sendMessage(from, {
            text: '❌ View-Once download failed.\n\n*Reason:* ' + String(e?.message || e).slice(0, 600) +
                '\n\n_Note: .hm sirf un view-once par kaam karega jo is updated bot ke chalne ke BAAD bot ko mile hon — purane view-once ki copy bot ke paas save nahi hoti. Ek fresh view-once bhej kar try karein._'
        }, { quoted: msg }).catch(() => {});
    }
}

module.exports = vvCommand;
