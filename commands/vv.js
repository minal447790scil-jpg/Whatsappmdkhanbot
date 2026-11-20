const {
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

async function vvCommand(sock, from, msg) {
    const owner = "923416647737@s.whatsapp.net";

    const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo;

    const quoted = contextInfo?.quotedMessage;

    if (!quoted) {
        return await sock.sendMessage(from, {
            text: "Please reply to a media message."
        }, { quoted: msg });
    }

    // Check owner
    const sender =
        msg.key?.participant || msg.key?.remoteJid;

    if (sender !== owner) {
        return;
    }

    try {
        let rawMessage = quoted;

        // Handle ephemeral wrapper
        while (rawMessage.ephemeralMessage?.message) {
            rawMessage = rawMessage.ephemeralMessage.message;
        }

        // View-Once protection check
        if (
            rawMessage.viewOnceMessage ||
            rawMessage.viewOnceMessageV2 ||
            rawMessage.viewOnceMessageV2Extension
        ) {
            return await sock.sendMessage(from, {
                text: "View-Once media is not supported."
            }, { quoted: msg });
        }

        const vType = Object.keys(rawMessage).find(type =>
            [
                'imageMessage',
                'videoMessage',
                'audioMessage'
            ].includes(type)
        );

        if (!vType) {
            return await sock.sendMessage(from, {
                text: "This is not a supported media message."
            }, { quoted: msg });
        }

        const quotedMsg = {
            key: {
                remoteJid: from,
                id: contextInfo.stanzaId,
                participant: contextInfo.participant
            },
            message: rawMessage
        };

        const buffer = await downloadMediaMessage(
            quotedMsg,
            'buffer',
            {},
            {
                logger: console,
                reuploadRequest: sock.updateMediaMessage
                    ? sock.updateMediaMessage.bind(sock)
                    : undefined
            }
        );

        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw new Error("Media buffer is empty or unavailable.");
        }

        const caption = "Downloaded By Salman";
        const media = rawMessage[vType];

        if (vType === 'imageMessage') {
            await sock.sendMessage(owner, {
                image: buffer,
                caption
            });
        }

        else if (vType === 'videoMessage') {
            await sock.sendMessage(owner, {
                video: buffer,
                caption
            });
        }

        else if (vType === 'audioMessage') {
            await sock.sendMessage(owner, {
                audio: buffer,
                mimetype: media.mimetype || 'audio/mp4',
                ptt: media.ptt || false
            });

            await sock.sendMessage(owner, {
                text: caption
            });
        }

    } catch (e) {
        console.error("Download Error:", e);

        await sock.sendMessage(from, {
            text: "Failed to download media.\n\n*Reason:* " +
                (e?.message || String(e))
        }, { quoted: msg });
    }
}

module.exports = vvCommand;
