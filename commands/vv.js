const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');

const MESSAGE_DB_PATH = path.join(__dirname, '../data/messages.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');

async function vvCommand(sock, from, msg) {
    const owner = "923416647737@s.whatsapp.net";

    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (!contextInfo?.quotedMessage) {
        return sock.sendMessage(from, { text: "Please reply to a View-Once message." }, { quoted: msg });
    }

    const quotedId = contextInfo.stanzaId;
    const quoted = contextInfo.quotedMessage;

    // ========== METHOD 1: Antidelete store se check karo (Most Reliable) ==========
    try {
        if (fs.existsSync(MESSAGE_DB_PATH) && quotedId) {
            const db = JSON.parse(fs.readFileSync(MESSAGE_DB_PATH, 'utf8'));
            const saved = db[quotedId];

            if (saved && saved.mediaPath && fs.existsSync(saved.mediaPath)) {
                const buffer = fs.readFileSync(saved.mediaPath);

                if (saved.mediaType === 'image') {
                    await sock.sendMessage(owner, {
                        image: buffer,
                        caption: "Downloaded By Salman (from store)"
                    });
                } else if (saved.mediaType === 'video') {
                    await sock.sendMessage(owner, {
                        video: buffer,
                        caption: "Downloaded By Salman (from store)"
                    });
                } else if (saved.mediaType === 'audio') {
                    await sock.sendMessage(owner, {
                        audio: buffer,
                        mimetype: 'audio/mp4',
                        ptt: false
                    });
                    await sock.sendMessage(owner, { text: "Downloaded By Salman (from store)" });
                }

                return sock.sendMessage(from, { text: "✅ View-Once downloaded from store!" }, { quoted: msg });
            }
        }
    } catch (e) {
        console.log("Store method failed:", e.message);
    }

    // ========== METHOD 2: Normal ViewOnce download ==========
    try {
        let realMsg = quoted.viewOnceMessage?.message ||
                      quoted.viewOnceMessageV2?.message ||
                      quoted.viewOnceMessageV2Extension?.message ||
                      quoted;

        const type = Object.keys(realMsg)[0];

        if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) {
            return sock.sendMessage(from, { text: "This is not a View-Once media message." }, { quoted: msg });
        }

        const media = realMsg[type];

        // Check mediaKey
        if (!media.mediaKey || media.mediaKey.length === 0) {
            return sock.sendMessage(from, {
                text: "❌ Media key missing.\n\nSolution: Antidelete ON rakho, phir View-Once aane do (open mat karo), phir `.vv` karo."
            }, { quoted: msg });
        }

        let buffer;

        // Try downloadContentFromMessage first
        try {
            const stream = await downloadContentFromMessage(media, type.replace('Message', ''));
            buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
        } catch (err1) {
            // Fallback to downloadMediaMessage
            const mediaMessage = {
                key: {
                    remoteJid: from,
                    id: quotedId,
                    fromMe: false,
                    participant: contextInfo.participant
                },
                message: realMsg
            };

            buffer = await downloadMediaMessage(
                mediaMessage,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: sock.updateMediaMessage
                }
            );
        }

        if (type === 'imageMessage') {
            await sock.sendMessage(owner, {
                image: buffer,
                caption: "Downloaded By Salman"
            });
        } else if (type === 'videoMessage') {
            await sock.sendMessage(owner, {
                video: buffer,
                caption: "Downloaded By Salman"
            });
        } else if (type === 'audioMessage') {
            await sock.sendMessage(owner, {
                audio: buffer,
                mimetype: media.mimetype || 'audio/mp4',
                ptt: media.ptt || false
            });
            await sock.sendMessage(owner, { text: "Downloaded By Salman" });
        }

        await sock.sendMessage(from, { text: "✅ View-Once downloaded successfully!" }, { quoted: msg });

    } catch (e) {
        console.error("VV Error:", e);
        await sock.sendMessage(from, {
            text: "❌ Failed to download.\n\nError: " + e.message + "\n\nTip: Antidelete ON rakh ke try karo."
        }, { quoted: msg });
    }
}

module.exports = vvCommand;
