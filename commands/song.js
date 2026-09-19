const yts = require("yt-search");
const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ffmpeg = require("ffmpeg-static");

const YTDLP_COMMON = {
    jsRuntimes: "deno",
    remoteComponents: "ejs:github",
    noPlaylist: true,
    noWarnings: false,
    socketTimeout: 60,
    retries: 2
};

async function songCommand(sock, chatId, message) {

    let filePath = null;

    try {

        // =========================
        // REACTIONS
        // =========================

        for (const emoji of ["📥", "⏳", "🎵"]) {

            try {
                await sock.sendMessage(chatId, {
                    react: {
                        text: emoji,
                        key: message.key
                    }
                });
            } catch {}
        }


        // =========================
        // MESSAGE TEXT
        // =========================

        const messageContent =
            message.message?.ephemeralMessage?.message ||
            message.message?.viewOnceMessage?.message ||
            message.message?.viewOnceMessageV2?.message ||
            message.message;

        const text = (
            messageContent?.conversation ||
            messageContent?.extendedTextMessage?.text ||
            messageContent?.imageMessage?.caption ||
            messageContent?.videoMessage?.caption ||
            ""
        ).trim();


        const query = text
            .replace(/^\.song\s*/i, "")
            .trim();


        if (!query) {

            await sock.sendMessage(
                chatId,
                {
                    text:
                        "🎵 *Song Downloader*\n\n" +
                        "Usage:\n" +
                        ".song <song name or YouTube link>"
                },
                {
                    quoted: message
                }
            );

            return;
        }


        // =========================
        // SEARCH / URL
        // =========================

        let url;
        let title = "YouTube Song";
        let thumbnail = "";
        let duration = "Unknown";


        if (
            query.includes("youtube.com") ||
            query.includes("youtu.be")
        ) {

            url = query;

            try {

                const info = await ytdlp(url, {
                    ...YTDLP_COMMON,
                    dumpSingleJson: true,
                    skipDownload: true
                });

                title = info.title || title;
                thumbnail = info.thumbnail || "";
                duration = info.duration_string || "Unknown";

            } catch (err) {

                console.log(
                    "[SONG INFO ERROR]",
                    err.message
                );

            }

        } else {

            const search = await yts(query);

            if (!search?.videos?.length) {

                await sock.sendMessage(
                    chatId,
                    {
                        text: "❌ No song found."
                    },
                    {
                        quoted: message
                    }
                );

                return;
            }


            const video = search.videos[0];

            url = video.url;
            title = video.title;
            thumbnail = video.thumbnail || "";
            duration = video.timestamp || "Unknown";
        }


        // =========================
        // PREVIEW
        // =========================

        if (thumbnail) {

            await sock.sendMessage(
                chatId,
                {
                    image: {
                        url: thumbnail
                    },
                    caption:
                        `🎵 *${title}*\n` +
                        `⏱️ *${duration}*\n\n` +
                        `📥 Downloading...`
                },
                {
                    quoted: message
                }
            );

        } else {

            await sock.sendMessage(
                chatId,
                {
                    text:
                        `🎵 *${title}*\n` +
                        `⏱️ *${duration}*\n\n` +
                        `📥 Downloading...`
                },
                {
                    quoted: message
                }
            );
        }


        // =========================
        // TEMP FILE
        // =========================

        filePath = path.join(
            os.tmpdir(),
            `song_${Date.now()}.mp3`
        );


        console.log("[SONG] Downloading:", url);


        // =========================
        // DOWNLOAD MP3
        // =========================

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


        // =========================
        // CHECK FILE
        // =========================

        if (!fs.existsSync(filePath)) {

            throw new Error(
                "MP3 file was not created."
            );
        }


        const stats = fs.statSync(filePath);

        if (stats.size < 10000) {

            throw new Error(
                "Downloaded audio file is too small."
            );
        }


        const audio =
            fs.readFileSync(filePath);


        // =========================
        // SAFE FILE NAME
        // =========================

        const safeTitle =
            title
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
                .replace(/\s+/g, " ")
                .trim()
                .substring(0, 80) ||
            "song";


        // =========================
        // SEND AUDIO
        // =========================

        await sock.sendMessage(
            chatId,
            {
                audio: audio,

                mimetype:
                    "audio/mpeg",

                fileName:
                    `${safeTitle}.mp3`,

                ptt: false,

                contextInfo: {

                    externalAdReply: {

                        title: title,

                        body:
                            "🎵 Song Downloader",

                        thumbnailUrl:
                            thumbnail || undefined,

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


        // =========================
        // SUCCESS
        // =========================

        await sock.sendMessage(chatId, {
            react: {
                text: "✅",
                key: message.key
            }
        });


        console.log(
            "[SONG] Successfully sent"
        );


    } catch (error) {

        console.error(
            "[SONG ERROR]",
            error
        );


        await sock.sendMessage(
            chatId,
            {
                text:
                    `❌ *Song Download Failed*\n\n` +
                    `${error.message}`
            },
            {
                quoted: message
            }
        );


    } finally {

        if (
            filePath &&
            fs.existsSync(filePath)
        ) {

            try {
                fs.unlinkSync(filePath);
            } catch {}
        }
    }
}


module.exports = songCommand;
