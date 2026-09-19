const yts = require("yt-search");
const ytdl = require("yt-direct");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ===============================
// GET TEXT
// ===============================
function getText(message) {
    const msg = message?.message || {};

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
    ).trim();
}

// ===============================
// VIDEO COMMAND
// ===============================
async function videoCommand(sock, chatId, message) {
    try {
        const text = getText(message);

        const query = text
            .replace(/^\.video\s*/i, "")
            .trim();

        if (!query) {
            return sock.sendMessage(
                chatId,
                {
                    text: "🎥 Usage:\n.video video name"
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, {
            react: {
                text: "🔎",
                key: message.key
            }
        });

        const search = await yts(query);

        if (!search.videos.length) {
            throw new Error("No video found");
        }

        const video = search.videos[0];

        await sock.sendMessage(
            chatId,
            {
                image: { url: video.thumbnail },
                caption: `🎥 *${video.title}*\n\n📥 Downloading...`
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, {
            react: {
                text: "⏳",
                key: message.key
            }
        });

        // 🔥 yt-direct se download
        const videoResult = await ytdl(video.url, {
            quality: "720p",
            format: "mp4",
            filter: "audioandvideo",
            timeout: 30000,
            retries: 3
        });

        const outputPath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);

        await videoResult.download(outputPath);

        const buffer = fs.readFileSync(outputPath);

        try {
            fs.unlinkSync(outputPath);
        } catch (e) {}

        await sock.sendMessage(
            chatId,
            {
                video: buffer,
                mimetype: "video/mp4",
                fileName: `${video.title}.mp4`,
                caption: "> DOWNLOADED BY SALMAN"
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, {
            react: {
                text: "✅",
                key: message.key
            }
        });

    } catch (error) {
        console.log("VIDEO ERROR:", error.message);

        await sock.sendMessage(
            chatId,
            {
                text: `❌ *Video Download Failed*\n\n${error.message}`
            },
            { quoted: message }
        );
    }
}

module.exports = videoCommand;
