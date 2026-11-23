async function hidetagCommand(sock, from, msg, isAdmin, q) {
    try {

        // Only group
        if (!from.endsWith("@g.us")) {
            return;
        }

        const groupMetadata = await sock.groupMetadata(from);

        const participants = groupMetadata.participants.map(p => p.id);

        await sock.sendMessage(
            from,
            {
                text: q || "Hi Everyone!",
                mentions: participants
            },
            { quoted: msg }
        );

    } catch (e) {
        console.log("HIDETAG ERROR:", e);

        await sock.sendMessage(
            from,
            {
                text: "❌ " + e.message
            },
            { quoted: msg }
        );
    }
}

module.exports = hidetagCommand;