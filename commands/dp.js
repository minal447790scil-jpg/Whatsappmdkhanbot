const { jidNormalizedUser } = require('@whiskeysockets/baileys');

async function dpCommand(sock, from, msg) {
    try {
        // Only allow in groups
        if (!from.endsWith('@g.us')) {
            return await sock.sendMessage(
                from,
                { text: "❌ This command can only be used in groups." },
                { quoted: msg }
            );
        }

        const messageContent =
            msg.message?.ephemeralMessage?.message ||
            msg.message?.viewOnceMessage?.message ||
            msg.message?.viewOnceMessageV2?.message ||
            msg.message;

        const quoted = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage;
        const mentionedJid = messageContent?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

        let targetJid = "";

        if (quoted) {
            targetJid = messageContent.extendedTextMessage.contextInfo.participant;
        } else if (mentionedJid) {
            targetJid = mentionedJid;
        } else {
            targetJid = msg.key.participant || msg.participant;
        }

        if (!targetJid) {
            return await sock.sendMessage(
                from,
                { text: "❌ Reply to a user's message or mention someone to get their profile picture." },
                { quoted: msg }
            );
        }

        await sock.sendMessage(from, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        let profilePicUrl;

        try {
            profilePicUrl = await sock.profilePictureUrl(targetJid, "image");
        } catch (e) {
            return await sock.sendMessage(
                from,
                { text: "❌ User has no profile picture or privacy settings prevent access." },
                { quoted: msg }
            );
        }

        await sock.sendMessage(
            from,
            {
                image: { url: profilePicUrl },
                caption: "📸 *Profile Picture*"
            },
            { quoted: msg }
        );

        await sock.sendMessage(from, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (err) {
        console.error("DP command error:", err);

        await sock.sendMessage(
            from,
            { text: `❌ Error: ${err.message}` },
            { quoted: msg }
        );
    }
}

module.exports = dpCommand;