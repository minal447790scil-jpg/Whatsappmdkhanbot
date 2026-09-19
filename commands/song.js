const yts = require("yt-search");
const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ffmpeg = require("ffmpeg-static");

// ===============================
// YT-DLP COMMON OPTIONS
// ===============================
const YTDLP_COMMON = {
    jsRuntimes: "deno",
    remoteComponents: "ejs:github",
    noPlaylist: true,
    socketTimeout: 60,
    retries: 2
};

// ===============================
// SAFE FILENAME
// ===============================
function safeFileName(name) {
    return name
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 100);
}

// ===============================
// GET MESSAGE TEXT
// ===============================
function getMessageText(message) {
    return (
        message?.conversation ||
        message?.extendedTextMessage?.text ||
        message?.imageMessage?.caption ||
        message?.videoMessage?.caption ||
        message?.documentMessage?.caption ||
        message?.ephemeralMessage?.message?.conversation ||
        message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        message?.viewOnceMessage?.message?.conversation ||
        message?.viewOnceMessage?.message?.extendedTextMessage?.text ||
        ""
    );
}

// ===============================
// SONG COMMAND
// ===============================
async function songCommand(sock, chatId, message) {
    try {
        const text = getMessageText(message);
        const args = text.trim().split(/\s+/).slice(1);
        const query = args.join(" ").trim();

        if (!query) {
            return await sock.sendMessage(
                chatId,
                {
                    text:
                        "🎵 *Song Downloader*\n\n" +
                        "Usage:\n" +
                        "`.song song name`\n\n" +
                        "Example:\n" +
                        "`.song Tum Hi Ho`"
                },
                { quoted: message }
            );
        }

        // ===============================
        // SEARCH YOUTUBE
        // ===============================
        await sock.sendMessage(
            chatId,
            {
                react: {
                    text: "🔎",
                    key: message.key
                }
            }
        );

        const searchResult = await yts(query);

        if (!searchResult || !searchResult.videos || !searchResult.videos.length) {
            return await sock.sendMessage(
                chatId,
                {
                    text: "❌ *No song found.*\n\nTry another song name."
                },
                { quoted: message }
            );
        }

        const video = searchResult.videos[0];

        const title = video.title || "Unknown Song";
        const url = video.url;
        const thumbnail = video.thumbnail || "";
        const duration = video.timestamp || "Unknown";

        const safeTitle = safeFileName(title);

        // ===============================
        // PREVIEW
        // ===============================
        await sock.sendMessage(
            chatId,
            {
                image: {
                    url: thumbnail
                },
                caption:
                    `🎵 *${title}*\n\n` +
                    `⏱️ *Duration:* ${duration}\n\n` +
                    `📥 *Downloading...*`
            },
            { quoted: message }
        );

        // ===============================
        // REACTION
        // ===============================
        await sock.sendMessage(
            chatId,
            {
                react: {
                    text: "⏳",
                    key: message.key
                }
            }
        );

        // ===============================
        // TEMP FILE
        // ===============================
        const tempDir = os.tmpdir();

        const fileName =
            `song_${Date.now()}_${Math.random()
                .toString(36)
                .substring(2, 8)}.mp3`;

        const filePath = path.join(tempDir, fileName);

        // ===============================
        // DOWNLOAD MP3
        // ===============================
        await ytdlp(
            url,
            {
                ...YTDLP_COMMON,

                extractAudio: true,

                audioFormat: "mp3",

                audioQuality: "128K",

                output: filePath,

                ffmpegLocation: ffmpeg,

                extractorArgs:
                    "youtube:player_client=web_safari"
            }
        );

        // ===============================
        // CHECK FILE
        // ===============================
        if (!fs.existsSync(filePath)) {
            throw new Error("MP3 file was not created.");
        }

        const stats = fs.statSync(filePath);

        if (stats.size < 1000) {
            throw new Error("Downloaded MP3 file is empty or invalid.");
        }

        // ===============================
        // READ AUDIO
        // ===============================
        const audioBuffer = fs.readFileSync(filePath);

        // ===============================
        // SEND AUDIO
        // ===============================
        await sock.sendMessage(
            chatId,
            {
                audio: audioBuffer,

                mimetype: "audio/mpeg",

                fileName: `${safeTitle}.mp3`,

                ptt: false,

                contextInfo: {
                    externalAdReply: {
                        title: title,

                        body: "🎵 Song Downloader",

                        thumbnailUrl: thumbnail,

                        mediaType: 2,

                        renderLargerThumbnail: true,

                        sourceUrl: url
                    }
                }
            },
            {
                quoted: message
            }
        );

        // ===============================
        // SUCCESS REACTION
        // ===============================
        await sock.sendMessage(
            chatId,
            {
                react: {
                    text: "🎵",
                    key: message.key
                }
            }
        );

        // ===============================
        // DELETE TEMP FILE
        // ===============================
        try {
            fs.unlinkSync(filePath);
        } catch (e) {
            console.log("Temp file cleanup failed:", e.message);
        }

    } catch (error) {

        console.error("SONG DOWNLOAD ERROR:", error);

        // ===============================
        // DELETE FILE IF ERROR
        // ===============================
        try {
            if (
                typeof filePath !== "undefined" &&
                fs.existsSync(filePath)
            ) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            console.log("Cleanup error:", e.message);
        }

        await sock.sendMessage(
            chatId,
            {
                text:
                    "❌ *Song Download Failed*\n\n" +
                    `${error?.message || "Unknown error"}`
            },
            { quoted: message }
        );
    }
}

module.exports = songCommand;
