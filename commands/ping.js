async function pingCommand(sock, from, msg) {
    const start = Date.now();
    const { key } = await sock.sendMessage(from, { text: '🏓 *Pinging*' }, { quoted: msg });
    const end = Date.now();
    const speed = end - start;

    // Animated dots while the result card is prepared
    for (const dots of ['.', '..', '...']) {
        await sock.sendMessage(from, { text: `🏓 *Pinging${dots}*`, edit: key }).catch(() => {});
        await new Promise(r => setTimeout(r, 450));
    }

    const rating = speed < 200 ? '🚀 Blazing Fast'
        : speed < 500 ? '⚡ Fast'
        : speed < 1000 ? '✅ Normal'
        : '🐢 Slow';

    const up = Math.floor(process.uptime());
    const uptime = `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m ${up % 60}s`;

    const text = `╭━━━〔 🏓 𝗣𝗢𝗡𝗚 〕━━━┈⊷\n` +
        `┃ ⚡ *Speed:* ${speed}ms\n` +
        `┃ 📶 *Status:* ${rating}\n` +
        `┃ ⏱️ *Uptime:* ${uptime}\n` +
        `╰━━━━━━━━━━━━━━━━━━┈⊷\n` +
        `> ⚡ *SALMAN KHAN BOT*`;

    await sock.sendMessage(from, { text, edit: key });
}

module.exports = pingCommand;
