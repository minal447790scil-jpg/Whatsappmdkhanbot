async function tagallCommand(sock, from, msg, isAdmin, q) {
    try {
        if (!from.endsWith("@g.us")) return;

        const groupMetadata = await sock.groupMetadata(from);
        const participants = groupMetadata.participants;

        let tagText = `📢 *TAG ALL*\n\n*Message:* ${q || "No message"}\n\n`;

        for (const mem of participants) {
            tagText += `🔹 @${mem.id.split("@")[0]}\n`;
        }

        await sock.sendMessage(
            from,
            {
                text: tagText,
                mentions: participants.map(p => p.id)
            },
            { quoted: msg }
        );

    } catch (e) {
        console.log("TAGALL ERROR:", e);
        await sock.sendMessage(
            from,
            { text: "❌ " + e.message },
            { quoted: msg }
        );
    }
}

module.exports = tagallCommand;