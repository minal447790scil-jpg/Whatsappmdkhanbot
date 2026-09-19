const yts = require("yt-search");
const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ffmpeg = require("ffmpeg-static");

// ===============================
// YT-DLP OPTIONS
// ===============================
const YTDLP_COMMON = {
    jsRuntimes: "deno",
    remoteComponents: "ejs:github",
    noPlaylist: true,
    socketTimeout: 60,
    retries: 2
};

// ===============================
// GET TEXT FROM BAILEYS MESSAGE
// ===============================
function getText(message) {
    let msg = message?.message || message;

    if (!msg) return "";

    // Ephemeral
    if (msg.ephemeralMessage?.message) {
        msg = msg.ephemeralMessage.message;
    }

    // View once
    if (msg.viewOnceMessage?.message) {
        msg = msg.viewOnceMessage.message;
    }

    // View once v2
    if (msg.viewOnceMessageV2?.message) {
        msg = msg.viewOnceMessageV2.message;
    }

    // View once v2 extension
    if (msg.viewOnceMessageV2Extension?.message) {
        msg = msg.viewOnceMessageV2Extension.message;
    }

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        msg.buttonsResponseMessage?.selectedButtonId ||
        msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
        msg.templateButtonReplyMessage?.selectedId ||
        ""
    ).trim();
}

// ===============================
// SAFE FILE NAME
// ===============================
function safeFileName(name) {
    return name
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 100);
}

// ===============================
// SONG COMMAND
// ===============================
async function songCommand(sock, chatId, message) {

    let filePath = null;

    try {

        // ===============================
        // GET COMMAND TEXT
        // ===============================
        const text = getText(message);

        console.log("SONG COMMAND TEXT:", text);

        // Remove .song from beginning
        const query = text
            .replace(/^\.song\b/i, "")
            .trim();

        // ===============================
        // NO QUERY
        // ===============================
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
        // SEARCH REACTION
        // ===============================
        await sock.sendMessage(chatId, {
            react: {
                text: "🔎",
                key: message.key
            }
        });

        // ===============================
        // YOUTUBE SEARCH
        // ===============================
        const result = await yts(query);

        if (!result?.videos?.length) {

            return await sock.sendMessage(
                chatId,
                {
                    text: `❌ No song found for:\n*${query}*`
                },
                { quoted: message }
            );
        }

        const video = result.videos[0];

        const title = video.title;
        const url = video.url;
        const thumbnail = video.thumbnail;
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
            {
                quoted: message
            }
        );

        // ===============================
        // DOWNLOAD REACTION
        // ===============================
        await sock.sendMessage(chatId, {
            react: {
                text: "⏳",
                key: message.key
            }
        });

        // ===============================
        // TEMP FILE
        // ===============================
        const fileName =
            `song_${Date.now()}.mp3`;

        filePath = path.join(
            os.tmpdir(),
            fileName
        );

        // ===============================
        // DOWNLOAD MP3
        // ===============================
        await ytdlp(url, {

            ...YTDLP_COMMON,

            extractAudio: true,

            audioFormat: "mp3",

            audioQuality: "128K",

            output: filePath,

            ffmpegLocation: ffmpeg,

            extractorArgs:
                "youtube:player_client=web_safari"
        });

        // ===============================
        // CHECK FILE
        // ===============================
        if (!fs.existsSync(filePath)) {
            throw new Error(
                "MP3 file was not created."
            );
        }

        const stats = fs.statSync(filePath);

        if (stats.size < 1000) {
            throw new Error(
                "Downloaded MP3 is empty."
            );
        }

        // ===============================
        // SEND AUDIO
        // ===============================
        const audio = fs.readFileSync(filePath);

        await sock.sendMessage(
            chatId,
            {
                audio: audio,

                mimetype: "audio/mpeg",

                fileName:
                    `${safeTitle}.mp3`,

                ptt: false,

                contextInfo: {
                    externalAdReply: {
                        title: title,

                        body:
                            "🎵 Song Downloader",

                        thumbnailUrl:
                            thumbnail,

                        mediaType: 2,

                        renderLargerThumbnail:
                            true,

                        sourceUrl: url
                    }
                }
            },
            {
                quoted: message
            }
        );

        // ===============================
        // SUCCESS
        // ===============================
        await sock.sendMessage(chatId, {
            react: {
                text: "🎵",
                key: message.key
            }
        });

        // ===============================
        // DELETE FILE
        // ===============================
        try {
            fs.unlinkSync(filePath);
        } catch {}

    } catch (error) {

        console.error(
            "SONG ERROR:",
            error
        );

        // Cleanup
        try {
            if (
                filePath &&
                fs.existsSync(filePath)
            ) {
                fs.unlinkSync(filePath);
            }
        } catch {}

        await sock.sendMessage(
            chatId,
            {
                text:
                    "❌ *Song Download Failed*\n\n" +
                    `${error?.message || "Unknown error"}`
            },
            {
                quoted: message
            }
        );
    }
}

module.exports = songCommand;
