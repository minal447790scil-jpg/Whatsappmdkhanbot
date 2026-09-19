const axios = require("axios");
const yts = require("yt-search");

// ===============================
// SSAVE.CC DIRECT API (No MCP Server)
// ===============================
async function ssaveExtract(videoUrl) {
    const res = await axios.post(
        "https://api.ssave.cc/open/v1/extract",
        { url: videoUrl },
        {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Content-Type': 'application/json'
            }
        }
    );
    return res.data;
}

async function ssaveDownload(token, type = "hd") {
    const res = await axios.get(
        `https://api.ssave.cc/open/v1/download?id=${token}&type=${type}`,
        {
            responseType: "arraybuffer",
            timeout: 60000,
            maxContentLength: 200 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }
    );
    return Buffer.from(res.data);
}

async function getSsaveVideo(youtubeUrl) {
    const extract = await ssaveExtract(youtubeUrl);
    const token = extract?.id || extract?.token;
    
    if (!token) {
        throw new Error("Ssave extract failed - no token");
    }
    
    const buffer = await ssaveDownload(token, "hd");
    return { buffer, title: extract.title || "Video" };
}

// ===============================
// VIDEO COMMAND
// ===============================
async function videoCommand(sock, chatId, message) {
    try {
        const loadEmojis = ['📥', '⏳', '🎥'];
        for (const emoji of loadEmojis) {
            await sock.sendMessage(chatId, { react: { text: emoji, key: message.key } });
        }

        const messageContent = message.message?.ephemeralMessage?.message ||
                             message.message?.viewOnceMessage?.message ||
                             message.message?.viewOnceMessageV2?.message ||
                             message.message;
        const text = (messageContent.conversation ||
                     messageContent.extendedTextMessage?.text ||
                     messageContent.imageMessage?.caption ||
                     messageContent.videoMessage?.caption || '').trim();
        const query = text.replace(/^\.video\s+/i, '').trim();

        if (!query || query.toLowerCase() === '.video') {
            await sock.sendMessage(chatId, { text: 'Usage: .video <name or link>' }, { quoted: message });
            return;
        }

        let videoUrl = '';
        let videoTitle = '';
        let videoThumbnail = '';

        if (query.includes('youtube.com') || query.includes('youtu.be')) {
            videoUrl = query;
            videoTitle = 'YouTube Video';
        } else {
            const { videos } = await yts(query);
            if (!videos || videos.length === 0) {
                await sock.sendMessage(chatId, { text: 'No videos found!' }, { quoted: message });
                return;
            }
            videoUrl = videos[0].url;
            videoTitle = videos[0].title;
            videoThumbnail = videos[0].thumbnail;
        }

        await sock.sendMessage(chatId, {
            image: { url: videoThumbnail || 'https://i.postimg.cc/y6GV9P3H/file-000000004c307206bc366893b817568c-(1).png' },
            caption: `🎥 Downloading: *${videoTitle}*`
        }, { quoted: message });

        // 🔥 Ssave se download
        const result = await getSsaveVideo(videoUrl);

        await sock.sendMessage(chatId, {
            video: result.buffer,
            mimetype: 'video/mp4',
            caption: `*${videoTitle}*\n\n> *DOWNLOADED BY SALMAN*`
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('Video error:', error);
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: message });
    }
}

module.exports = videoCommand;
