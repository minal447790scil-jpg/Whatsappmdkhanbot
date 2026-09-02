async function kickCommand(sock, from, msg, isAdmin) {
    if (!isAdmin) {
        return await sock.sendMessage(
            from,
            { text: "❌ Only admin can use this command." },
            { quoted: msg }
        );
    }

    if (!from.endsWith('@g.us')) {
        return await sock.sendMessage(
            from,
            { text: "❌ This command can only be used in groups." },
            { quoted: msg }
        );
    }

    try {
        const contextInfo =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.documentMessage?.contextInfo ||
            {};

        // Mentioned user first
        let target =
            contextInfo?.mentionedJid?.[0] ||
            contextInfo?.participantPn ||
            contextInfo?.participant;

        if (!target) {
            return await sock.sendMessage(
                from,
                {
                    text: "❌ Please reply to a message or tag someone to kick."
                },
                { quoted: msg }
            );
        }

        // Some WhatsApp/Baileys versions can return a LID.
        // Prefer the phone JID when available.
        if (target.endsWith('@lid') && contextInfo?.participantPn) {
            target = contextInfo.participantPn;
        }

        console.log(`👢 Kick target: ${target}`);

        await sock.groupParticipantsUpdate(
            from,
            [target],
            "remove"
        );

        await sock.sendMessage(
            from,
            {
                text: "✅ User kicked successfully."
            },
            { quoted: msg }
        );

    } catch (e) {
        console.log("❌ Kick error:", e);

        await sock.sendMessage(
            from,
            {
                text: `❌ Failed to kick user.\n\n${e.message || "Make sure I am a group admin."}`
            },
            { quoted: msg }
        );
    }
}

module.exports = kickCommand;
