// ============================================================
// .hm — View-Once downloader (PURANA SIMPLE METHOD)
// ------------------------------------------------------------
// Ye wahi tareeqa hai jo is bot mein 20 Nov se pehle chalta
// tha: reply kiye gaye view-once ke quoted message se media
// node nikalo aur downloadContentFromMessage se seedha
// download kar lo. Na cache, na koi doosra system.
//
// Sirf itni si behtari original ke muqable mein rakhi hai jo
// method nahi badalti:
// - quoted message sirf text reply se nahi, kisi bhi message
//   type ke contextInfo se mil sakta hai
// - naye wrappers (viewOnceMessageV2Extension, ephemeral)
//   bhi khul jate hain — pehle V2/V1 thay
// - result owner ke saath saath usi chat mein bhi jata hai
//   jahan command chali
// - fail ho to asal wajah ek line mein nazar aati hai
// ============================================================

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

let ownerNumber = '923416647737';
try {
    ownerNumber = require('../settings').ownerNumber || ownerNumber;
} catch (_) { /* settings missing — fallback */ }
const OWNER = String(ownerNumber).includes('@')
    ? String(ownerNumber)
    : `${ownerNumber}@s.whatsapp.net`;

// Reply jis message par bhi ho, uske contextInfo se quoted
// message nikalo.
function getQuoted(msg) {
    const message = msg?.message;
    if (!message) return null;
    const outer = message.ephemeralMessage?.message || message;
    for (const key of Object.keys(outer)) {
        const ctx = outer[key]?.contextInfo;
        if (ctx?.quotedMessage) return ctx.quotedMessage;
    }
    return null;
}

// View-Once wrappers layer by layer kholo — andar asal media
// message milega.
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

async function vvCommand(sock, from, msg) {
    const quoted = getQuoted(msg);

    if (!quoted) {
        return await sock.sendMessage(from, {
            text: 'Please reply to a View-Once message.'
        }, { quoted: msg });
    }

    const message = unwrap(quoted);
    const vType = Object.keys(message)[0];

    if (['imageMessage', 'videoMessage', 'audioMessage'].includes(vType)) {
        try {
            const stream = await downloadContentFromMessage(
                message[vType],
                vType.replace('Message', '')
            );

            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            if (!buffer.length) throw new Error('download hua lekin buffer khaali hai');

            let payload;
            if (vType === 'imageMessage') {
                payload = { image: buffer, caption: 'Downloaded By Salman' };
            } else if (vType === 'videoMessage') {
                payload = { video: buffer, caption: 'Downloaded By Salman', gifPlayback: message[vType].gifPlayback || false };
            } else {
                payload = {
                    audio: buffer,
                    mimetype: message[vType].mimetype || 'audio/mp4',
                    ptt: message[vType].ptt || false
                };
            }

            // Usi chat mein bhejo jahan command chali
            await sock.sendMessage(from, payload, { quoted: msg });

            // Owner ko bhi copy (agar command kahin aur chali ho)
            if (from !== OWNER) {
                await sock.sendMessage(OWNER, payload).catch(() => {});
            }
        } catch (e) {
            console.error('[VV] download failed:', e?.message || e);
            await sock.sendMessage(from, {
                text: '❌ Failed to download View-Once media.\n\n*Reason:* ' + String(e?.message || e).slice(0, 300)
            }, { quoted: msg }).catch(() => {});
        }
    } else {
        await sock.sendMessage(from, {
            text: 'This is not a View-Once media message.'
        }, { quoted: msg });
    }
}

module.exports = vvCommand;
