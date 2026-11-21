const { downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');

async function vvCommand(sock, from, msg) {
    const owner = "923416647737@s.whatsapp.net";

    // Quoted message nikalna
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
                   msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (!quoted) {
        return await sock.sendMessage(from, {
            text: "Please reply to a View-Once message."
        }, { quoted: msg });
    }

    // ViewOnce structure handle karna (purane + naye versions)
    let message = quoted;
    
    if (quoted.viewOnceMessage) {
        message = quoted.viewOnceMessage.message;
    } else if (quoted.viewOnceMessageV2) {
        message = quoted.viewOnceMessageV2.message;
    } else if (quoted.viewOnceMessageV2Extension) {
        message = quoted.viewOnceMessageV2Extension.message;
    }

    const vType = Object.keys(message)[0];

    if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(vType)) {
        return await sock.sendMessage(from, {
            text: "This is not a View-Once media message."
        }, { quoted: msg });
    }

    try {
        // Method 1: downloadContentFromMessage
        let buffer;
        try {
            const stream = await downloadContentFromMessage(
                message[vType],
                vType.replace('Message', '')
            );

            buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
        } catch (err) {
            // Agar pehli method fail ho to doosri method try karo
            console.log("Method 1 failed, trying downloadMediaMessage...");
            
            const mediaMsg = {
                key: msg.message.extendedTextMessage.contextInfo.stanzaId 
                    ? { id: msg.message.extendedTextMessage.contextInfo.stanzaId }
                    : msg.key,
                message: message
            };

            buffer = await downloadMediaMessage(
                mediaMsg,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: sock.updateMediaMessage
                }
            );
        }

        // Media bhejna owner ko
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

        // Success message bhejo
        await sock.sendMessage(from, {
            text: "✅ View-Once media downloaded successfully!"
        }, { quoted: msg });

    } catch (e) {
        console.error("VV Download Error:", e);
        await sock.sendMessage(from, {
            text: "❌ Failed to download View-Once media.\nError: " + e.message
        }, { quoted: msg });
    }
}

module.exports = vvCommand;
