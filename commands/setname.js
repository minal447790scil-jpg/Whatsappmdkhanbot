async function setnameCommand(
    sock,
    from,
    msg,
    isAdmin,
    botData,
    saveBotData,
    userId,
    q
) {
    try {
        if (!msg.key.fromMe) {
            return await sock.sendMessage(
                from,
                { text: "❌ Only owner can use this command." },
                { quoted: msg }
            );
        }

        const name = q?.trim();

        if (!name) {
            return await sock.sendMessage(
                from,
                { text: "❌ Please provide a name.\nUsage: .setname Salman Khan" },
                { quoted: msg }
            );
        }

        if (!botData.userNames) {
            botData.userNames = {};
        }

        botData.userNames[userId] = name;

        saveBotData();

        return await sock.sendMessage(
            from,
            { text: `✅ Name set to: ${name}` },
            { quoted: msg }
        );

    } catch (error) {
        console.error("SetName Error:", error);

        await sock.sendMessage(
            from,
            { text: `❌ Error: ${error.message}` },
            { quoted: msg }
        );
    }
}

module.exports = setnameCommand;