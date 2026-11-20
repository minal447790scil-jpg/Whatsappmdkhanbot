const { downloadMediaMessage } = require('@whiskeysockets/baileys');

async function vvCommand(sock, from, msg) {

    const owner = "923416647737@s.whatsapp.net";

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (!quoted) {
        return await sock.sendMessage(from, {
            text: "Please reply to a View-Once message."
        }, { quoted: msg });
    }

    // View-Once wrapper ko kholne ke liye
    const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage;
    const rawMessage = viewOnce ? viewOnce.message : quoted;
    
    const vType = Object.keys(rawMessage)[0];

    if (['imageMessage', 'videoMessage', 'audioMessage'].includes(vType)) {
        try {
            // downloadMediaMessage use kar rahe hain jo empty key ko khud handle karta hai
            const buffer = await downloadMediaMessage(
                { message: rawMessage }, 
                'buffer',
                {},
                { 
                    logger: console,
                    reuploadRequest: sock.updateMediaMessage // Expired media ko dobara mangwata hai
                }
            );

            if (buffer.length === 0) {
                throw new Error("Media expire ya server par available nahi hai");
            }

            const caption = "Downloaded By Salman";

            if (vType === 'imageMessage') {
                await sock.sendMessage(owner, {
                    image: buffer,
                    caption: caption
                });
            }

            else if (vType === 'videoMessage') {
                await sock.sendMessage(owner, {
                    video: buffer,
                    caption: caption
                });
            }

            else if (vType === 'audioMessage') {
                await sock.sendMessage(owner, {
                    audio: buffer,
                    mimetype: rawMessage[vType].mimetype || 'audio/mp4',
                    ptt: rawMessage[vType].ptt || false
                });

                await sock.sendMessage(owner, {
                    text: caption
                });
            }

        } catch (e) {
            await sock.sendMessage(from, {
                text: "Failed to download View-Once media.\n\n*Reason:* " + (e?.message || e)
            }, { quoted: msg });
        }

    } else {
        await sock.sendMessage(from, {
            text: "This is not a View-Once media message."
        }, { quoted: msg });
    }
}

module.exports = vvCommand;
