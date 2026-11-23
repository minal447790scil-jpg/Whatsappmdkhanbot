const { downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');
const vvStore = require('../lib/vvStore');

// Recursively unwraps every known WhatsApp wrapper (ephemeral / view-once in
// all its forms) and returns the underlying media message, if any.
// Newer WhatsApp clients nest view-once media differently depending on the
// app version (viewOnceMessage, viewOnceMessageV2, viewOnceMessageV2Extension,
// sometimes inside an ephemeralMessage too), so we unwrap in a loop instead
// of checking just one or two fixed keys.
function extractMedia(message) {
    if (!message) return null;

    const wrapperKeys = [
        'ephemeralMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'documentWithCaptionMessage'
    ];

    let current = message;
    let changed = true;

    while (changed) {
        changed = false;
        for (const key of wrapperKeys) {
            if (current?.[key]?.message) {
                current = current[key].message;
                changed = true;
            }
        }
    }

    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage'];
    const vType = mediaTypes.find((t) => current?.[t]);

    return vType ? { vType, media: current[vType] } : null;
}

async function vvCommand(sock, from, msg) {
    const owner = "923416647737@s.whatsapp.net";

    const top = vvStore.unwrap(msg.message) || msg.message;
    const ctx =
        top?.extendedTextMessage?.contextInfo ||
        top?.imageMessage?.contextInfo ||
        top?.videoMessage?.contextInfo ||
        top?.audioMessage?.contextInfo;

    const quotedMessage = ctx?.quotedMessage;
    const stanzaId = ctx?.stanzaId;

    if (!quotedMessage) {
        return await sock.sendMessage(from, {
            text: "Please reply to a View-Once message."
        }, { quoted: msg });
    }

    // WhatsApp strips the mediaKey/url out of a view-once message when it's
    // embedded as a quotedMessage. The original message (cached the moment
    // it was first received, see lib/vvStore.js + index.js) still has the
    // full media info, so prefer that. Fall back to the quoted copy itself
    // in case the cache doesn't have it (e.g. bot restarted meanwhile).
    const cached = vvStore.get(stanzaId);

    const result =
        extractMedia(cached?.message) ||
        extractMedia(quotedMessage);

    if (!result) {
        return await sock.sendMessage(from, {
            text: "This is not a View-Once media message."
        }, { quoted: msg });
    }

    const { vType, media } = result;

    try {
        if (!media.mediaKey || !(media.url || media.directPath)) {
            throw new Error(
                "Is message ke saath WhatsApp ne decryption key (mediaKey) nahi bheji.\n" +
                "Wajah: ya to bot ke online hone se pehle message aaya, ya bot ka linked-device Android identity par nahi hai.\n" +
                "Hal: Telegram bot se number dobara bhej kar naya pairing karein (WA_BROWSER=android), phir NAYA view-once bhejwa kar test karein."
            );
        }

        let buffer = Buffer.from([]);
        try {
            const stream = await downloadContentFromMessage(media, vType.replace('Message', ''));
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
        } catch (firstErr) {
            // Fallback: poora message + re-upload request (expired url ke liye)
            if (!cached?.message) throw firstErr;
            buffer = await downloadMediaMessage(
                cached,
                'buffer',
                {},
                { reuploadRequest: sock.updateMediaMessage }
            );
        }

        if (!buffer.length) {
            throw new Error("Download khaali aaya, dobara try karein.");
        }

        if (vType === 'imageMessage') {
            await sock.sendMessage(owner, {
                image: buffer,
                caption: "Downloaded By Salman"
            });
        } else if (vType === 'videoMessage') {
            await sock.sendMessage(owner, {
                video: buffer,
                caption: "Downloaded By Salman"
            });
        } else if (vType === 'audioMessage') {
            await sock.sendMessage(owner, {
                audio: buffer,
                mimetype: media.mimetype || 'audio/mp4',
                ptt: media.ptt || false
            });

            await sock.sendMessage(owner, {
                text: "Downloaded By Salman"
            });
        }

        // Confirm back in the chat where the command was used, so success is
        // visible without needing to check the owner's chat separately.
        await sock.sendMessage(from, {
            text: "✅ View-once media downloaded and sent to owner."
        }, { quoted: msg }).catch(() => {});

    } catch (e) {
        console.error("VV ERROR:", e);
        await sock.sendMessage(from, {
            text: "Failed to download View-Once media.\n" + e.message
        }, { quoted: msg });
    }
}

module.exports = vvCommand;
