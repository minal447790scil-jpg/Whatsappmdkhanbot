const settings = require('../settings');

async function ownerCommand(sock, from, msg) {
    const ownerText = `╭━━━〔 👑 𝗢𝗪𝗡𝗘𝗥 〕━━━┈⊷\n` +
        `┃ 👤 *Name:* ${settings.ownerName}\n` +
        `┃ 📱 *Number:* +${settings.ownerNumber}\n` +
        `┃ 🤖 *Bot:* SALMAN KHAN\n` +
        `╰━━━━━━━━━━━━━━━━━━┈⊷\n` +
        `🔗 *OFFICIAL WHATSAPP CHANNEL:*\n` +
        `> *https://whatsapp.com/channel/0029Vb8JgHGLikg6VXF58S3g*`;
    await sock.sendMessage(from, { text: ownerText }, { quoted: msg });
}

module.exports = ownerCommand;
