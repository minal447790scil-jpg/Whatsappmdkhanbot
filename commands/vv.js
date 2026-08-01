const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function vvCommand(sock, from, msg) {

    const owner = "923416647737@s.whatsapp.net";

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (!quoted) {
        return await sock.sendMessage(from, {
            text: "Please reply to a View-Once message."
        }, { quoted: msg });
    }

    const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage;
    const message = viewOnce ? viewOnce.message : quoted;

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

            if (vType === 'imageMessage') {
                await sock.sendMessage(owner, {
                    image: buffer,
                    caption: "Downloaded By Salman"
                });
            }

            else if (vType === 'videoMessage') {
                await sock.sendMessage(owner, {
                    video: buffer,
                    caption: "Downloaded By Salman"
                });
            }

            else if (vType === 'audioMessage') {
                await sock.sendMessage(owner, {
                    audio: buffer,
                    mimetype: message[vType].mimetype || 'audio/mp4',
                    ptt: message[vType].ptt || false
                });

                await sock.sendMessage(owner, {
                    text: "Downloaded By Salman"
                });
            }

        } catch (e) {
            await sock.sendMessage(from, {
                text: "Failed to download View-Once media."
            }, { quoted: msg });
        }

    } else {
        await sock.sendMessage(from, {
            text: "This is not a View-Once media message."
        }, { quoted: msg });
    }
}

module.exports = vvCommand;