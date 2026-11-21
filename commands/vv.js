const fs = require('fs');
const path = require('path');
const {
    downloadContentFromMessage,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

// Owner JID settings.js se lo, warna purana hardcoded number fallback rakho
let ownerNumber = '923416647737';
try {
    ownerNumber = require('../settings').ownerNumber || ownerNumber;
} catch (_) { /* settings missing — fallback use hoga */ }
const OWNER_JID = String(ownerNumber).includes('@')
    ? String(ownerNumber)
    : `${ownerNumber}@s.whatsapp.net`;

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];

// Reply jis bhi message type par ho (text, image caption, video caption...),
// uske contextInfo se quoted message + stanzaId + participant nikalo.
// Purana code sirf quotedMessage leta tha — stanzaId/participant ke baghair
// WhatsApp se media dobara mangwaya (reupload) nahi ja sakta, aur view-once
// media aksar pehli direct koshish par hi fail ho jata hai.
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

// View-Once wrappers ko layer by layer kholo:
// viewOnceMessage / viewOnceMessageV2 / viewOnceMessageV2Extension / ephemeralMessage
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

// Object.keys(message)[0] par kabhi trust nahi karna — naye WhatsApp clients
// pehli key 'messageContextInfo' bhej dete hain.
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

// Teen tareeqon se download ki koshish — pehla jo kamyab ho, wahi buffer.
// Har tareeqay ki asal error jama hoti hai taake aakhir mein asli wajah
// user ko batayi ja sake (purana code har error ko "expired" keh deta tha,
// halanke aksar wajah kuch aur hoti hai).
async function downloadViewOnce(sock, from, quotedCtx, inner, vType) {
    const errors = [];
    const media = inner[vType];

    // Tareeqa 1 (sab se reliable): downloadMediaMessage — poora quoted
    // message (key + stanzaId + participant ke saath) do. Agar media server
    // se pehli dafa na mile to ye sock.updateMediaMessage ke zariye sender
    // se media dobara upload mangwata hai. Bot ki sticker command bhi
    // quoted media isi tareeqay se download karti hai.
    try {
        const fakeMsg = {
            key: {
                remoteJid: from,
                fromMe: false,
                id: quotedCtx.stanzaId || undefined,
                participant: quotedCtx.participant || undefined
            },
            message: quotedCtx.quoted
        };
        const buffer = await downloadMediaMessage(
            fakeMsg,
            'buffer',
            {},
            {
                logger: getLogger(sock),
                reuploadRequest: sock.updateMediaMessage
            }
        );
        if (buffer && buffer.length) return buffer;
        errors.push('mediaMessage: empty buffer');
    } catch (e) {
        errors.push('mediaMessage: ' + (e?.message || e));
    }

    // Tareeqa 2: direct stream download (purana tareeqa, backup ke tor par)
    try {
        const stream = await downloadContentFromMessage(
            media,
            vType.replace('Message', '')
        );
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        if (buffer.length) return buffer;
        errors.push('direct: empty buffer');
    } catch (e) {
        errors.push('direct: ' + (e?.message || e));
    }

    // Tareeqa 3: bot ke apne antidelete store se — agar antidelete ON hai
    // to har aane wale message ka media pehle se disk par save hota hai
    // (data/messages.json + tmp folder). Ye WhatsApp server par depend
    // hi nahi karta.
    try {
        if (quotedCtx.stanzaId) {
            const dbPath = path.join(__dirname, '..', 'data', 'messages.json');
            if (fs.existsSync(dbPath)) {
                const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                const entry = db[quotedCtx.stanzaId];
                if (entry?.mediaPath && fs.existsSync(entry.mediaPath)) {
                    const buffer = fs.readFileSync(entry.mediaPath);
                    if (buffer.length) return buffer;
                }
            }
        }
        errors.push('store: media not found locally');
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

        const media = inner[vType];
        const buffer = await downloadViewOnce(sock, from, quotedCtx, inner, vType);

        let payload;
        if (vType === 'imageMessage') {
            payload = {
                image: buffer,
                caption: (media.caption ? media.caption + '\n\n' : '') + '👁️ *View-Once saved — Downloaded By Salman*'
            };
        } else if (vType === 'videoMessage') {
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
        // Asli wajah console mein bhi aur user ko bhi — taake masla expire
        // hai, download hai ya kuch aur, ye andaza na lagana pare.
        console.error('[VV] Error:', e);
        await sock.sendMessage(from, {
            text: '❌ View-Once download failed.\n\n*Reason:* ' + String(e?.message || e).slice(0, 500) +
                '\n\n_Agar ye error dobara aaye to ye wala text mujhe bhej dein, isi se asal masla pakra jayega._'
        }, { quoted: msg }).catch(() => {});
    }
}

module.exports = vvCommand;
