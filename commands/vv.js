const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function vvCommand(sock, from, msg) {
    const owner = "923416647737@s.whatsapp.net";

    try {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo?.quotedMessage) {
            return sock.sendMessage(from, { text: "❌ Please reply to a View-Once message." }, { quoted: msg });
        }

        let quoted = contextInfo.quotedMessage;

        // Unwrap ViewOnce
        if (quoted.viewOnceMessage) quoted = quoted.viewOnceMessage.message;
        else if (quoted.viewOnceMessageV2) quoted = quoted.viewOnceMessageV2.message;
        else if (quoted.viewOnceMessageV2Extension) quoted = quoted.viewOnceMessageV2Extension.message;

        const type = Object.keys(quoted)[0];

        if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) {
            return sock.sendMessage(from, { text: "❌ Ye View-Once media nahi hai." }, { quoted: msg });
        }

        // Remove viewOnce flag
        if (quoted[type].viewOnce) {
            delete quoted[type].viewOnce;
        }

        const stream = await downloadContentFromMessage(
            quoted[type],
            type.replace('Message', '')
        );

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (type === 'imageMessage') {
            await sock.sendMessage(owner, {
                image: buffer,
                caption: "✅ Downloaded By Salman"
            });
        } else if (type === 'videoMessage') {
            await sock.sendMessage(owner, {
                video: buffer,
                caption: "✅ Downloaded By Salman"
            });
        } else if (type === 'audioMessage') {
            await sock.sendMessage(owner, {
                audio: buffer,
                mimetype: quoted[type].mimetype || 'audio/mp4',
                ptt: quoted[type].ptt || false
            });
            await sock.sendMessage(owner, { text: "✅ Downloaded By Salman" });
        }

        await sock.sendMessage(from, { text: "✅ View-Once successfully downloaded!" }, { quoted: msg });

    } catch (error) {
        console.error("VV Error:", error);
        await sock.sendMessage(from, {
            text: `❌ Download failed\n\nError: ${error.message}`
        }, { quoted: msg });
    }
}

module.exports = vvCommand;
