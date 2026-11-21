const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

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
// uske contextInfo se quoted message nikalo — purana code sirf
// extendedTextMessage check karta tha, is liye aksar quoted milta hi nahi tha.
function getQuotedMessage(msg) {
    const message = msg?.message;
    if (!message) return null;
    const outer = message.ephemeralMessage?.message || message;
    for (const key of Object.keys(outer)) {
        const quoted = outer[key]?.contextInfo?.quotedMessage;
        if (quoted) return quoted;
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
// pehli key 'messageContextInfo' bhej dete hain, jis se purana code media
// type ghalat pehchanta tha. Hamesha asal media keys dhoondo.
function findMediaType(message) {
    if (!message) return null;
    return MEDIA_TYPES.find((t) => message[t]) || null;
}

async function vvCommand(sock, from, msg) {
    try {
        const quoted = getQuotedMessage(msg);

        if (!quoted) {
            return await sock.sendMessage(from, {
                text: '❌ Please reply to a View-Once photo / video / voice note with *.hm*'
            }, { quoted: msg });
        }

        const inner = unwrapMessage(quoted);
        const vType = findMediaType(inner);

        if (!vType) {
            return await sock.sendMessage(from, {
                text: '❌ This is not a View-Once media message. Reply to a View-Once photo, video or voice note.'
            }, { quoted: msg });
        }

        const media = inner[vType];

        const stream = await downloadContentFromMessage(
            media,
            vType.replace('Message', '')
        );

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer.length) {
            throw new Error('Downloaded media buffer is empty (media expired?)');
        }

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

        // 1) Usi chat mein wapas bhejo jahan command chali — taake requester ko
        //    foran result nazar aaye (purana code sirf owner DM mein bhejta tha,
        //    is liye group/dosre number par "kuch hua hi nahi" lagta tha).
        await sock.sendMessage(from, payload, { quoted: msg });

        // 2) Purana behaviour bhi barqarar: owner ko bhi ek copy forward karo
        //    (agar command owner ki apni chat mein nahi chali).
        if (from !== OWNER_JID) {
            await sock.sendMessage(OWNER_JID, payload)
                .catch((e) => console.error('[VV] Owner forward failed:', e.message));
        }
    } catch (e) {
        console.error('[VV] Error:', e);
        await sock.sendMessage(from, {
            text: '❌ Failed to download View-Once media. It may have expired — ask the sender to send it again.'
        }, { quoted: msg }).catch(() => {});
    }
}

module.exports = vvCommand;
