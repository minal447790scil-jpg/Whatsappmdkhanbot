async function autoreactsCommand(
    sock,
    from,
    msg,
    isAdmin,
    botData,
    saveBotData,
    userId,
    args
) {
    try {
        if (!msg.key.fromMe) {
            return await sock.sendMessage(
                from,
                { text: "❌ Only owner can use this command." },
                { quoted: msg }
            );
        }

        const action = args?.[0]?.toLowerCase();

        if (!botData.autoReactSettings) {
            botData.autoReactSettings = {};
        }

        if (!botData.autoReactSettings[userId]) {
            botData.autoReactSettings[userId] = {
                enabled: false
            };
        }

        if (action === 'on') {
            botData.autoReactSettings[userId].enabled = true;
            saveBotData();

            return await sock.sendMessage(
                from,
                { text: "✅ Auto-React Enabled!" },
                { quoted: msg }
            );
        }

        if (action === 'off') {
            botData.autoReactSettings[userId].enabled = false;
            saveBotData();

            return await sock.sendMessage(
                from,
                { text: "❌ Auto-React Disabled!" },
                { quoted: msg }
            );
        }

        return await sock.sendMessage(
            from,
            { text: "❌ Usage: .autoreacts on/off" },
            { quoted: msg }
        );

    } catch (error) {
        console.error("AutoReact command error:", error);
    }
}

module.exports = autoreactsCommand;