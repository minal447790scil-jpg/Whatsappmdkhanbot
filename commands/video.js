const axios = require("axios");
const yts = require("yt-search");

const APIFY_TOKEN = process.env.APIFY_TOKEN || "apify_api_TwoTejauOK2ur2cAKYwrOUAiE5wIcC2IcAKU";

console.log(
    "APIFY TOKEN:",
    APIFY_TOKEN ? APIFY_TOKEN.slice(0, 10) : "MISSING"
);

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
// APIFY DOWNLOAD
// ===============================
async function downloadWithApify(youtubeUrl, sock, chatId, message) {
    try {
        if (!APIFY_TOKEN) {
            throw new Error("APIFY_TOKEN missing");
        }

        // 🔥 Use the YouTube-specific Actor with guaranteed downloadUrl
        const response = await axios.post(
            `https://api.apify.com/v2/acts/memo23~youtube-video-downloader/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
            {
                videoUrls: [youtubeUrl]
            },
            { timeout: 180000 }
        );

        // 🔥 Debug: Send full response to WhatsApp
        await sock.sendMessage(
            chatId,
            {
                text: "📦 APIFY RESPONSE:\n\n" +
                    JSON.stringify(response.data, null, 2).slice(0, 3000)
            },
            { quoted: message }
        );

        const data = response.data?.[0];

        if (!data) {
            throw new Error("Apify returned empty response");
        }

        // 🔥 Check for error in response
        if (data.error || data.status === "FAILED") {
            throw new Error(data.error || "Apify actor failed");
        }

        // 🔥 Try all possible fields for download URL
        const downloadUrl =
            data.downloadUrl ||
            data.download_url ||
            data.videoUrl ||
            data.video_url ||
            data.url ||
            data.fileUrl ||
            data.file_url ||
            data.selectedDownload?.publicUrl ||
            data.selectedDownload?.downloadUrl ||
            (data.formats && data.formats[0]?.downloadUrl) ||
            (data.links && data.links[0]?.url);

        if (!downloadUrl) {
            throw new Error("Download URL not found in Apify response");
        }

        return downloadUrl;

    } catch (error) {
        // 🔥 Send full error to WhatsApp
        await sock.sendMessage(
            chatId,
            {
                text: "❌ APIFY ERROR:\n\n" +
                    (error.response?.data
                        ? JSON.stringify(error.response.data, null, 2).slice(0, 3000)
                        : error.message)
            },
            { quoted: message }
        );
        return null;
    }
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
                caption: `🎥 *${video.title}*\n\n📥 Downloading from Apify...`
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, {
            react: {
                text: "⏳",
                key: message.key
            }
        });

        const url = await downloadWithApify(video.url, sock, chatId, message);

        if (!url) {
            throw new Error("Apify URL missing");
        }

        await sock.sendMessage(
            chatId,
            {
                text: "⬇️ Download URL received, downloading video..."
            },
            { quoted: message }
        );

        const file = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 180000,
            maxContentLength: 200 * 1024 * 1024,
            maxBodyLength: 200 * 1024 * 1024
        });

        const buffer = Buffer.from(file.data);

        if (!buffer.length) {
            throw new Error("Downloaded file is empty");
        }

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
        console.log("VIDEO ERROR:", error?.response?.data || error.message);

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
