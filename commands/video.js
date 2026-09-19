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


async function videoCommand(sock, chatId, message) {

    let filePath = null;

    try {

        // =========================
        // REACTIONS
        // =========================

        for (const emoji of ["📥", "⏳", "🎥"]) {

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
        // MESSAGE
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
            .replace(/^\.video\s*/i, "")
            .trim();


        if (!query) {

            await sock.sendMessage(
                chatId,
                {
                    text:
                        "🎥 *Video Downloader*\n\n" +
                        "Usage:\n" +
                        ".video <video name or YouTube link>"
                },
                {
                    quoted: message
                }
            );

            return;
        }


        // =========================
        // SEARCH
        // =========================

        let url;
        let title = "YouTube Video";
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

                title =
                    info.title ||
                    title;

                thumbnail =
                    info.thumbnail ||
                    "";

                duration =
                    info.duration_string ||
                    "Unknown";

            } catch (err) {

                console.log(
                    "[VIDEO INFO ERROR]",
                    err.message
                );
            }

        } else {

            const search =
                await yts(query);


            if (!search?.videos?.length) {

                await sock.sendMessage(
                    chatId,
                    {
                        text:
                            "❌ No video found."
                    },
                    {
                        quoted: message
                    }
                );

                return;
            }


            const video =
                search.videos[0];


            url = video.url;

            title =
                video.title;

            thumbnail =
                video.thumbnail || "";

            duration =
                video.timestamp ||
                "Unknown";
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
                        `🎥 *${title}*\n` +
                        `⏱️ *${duration}*\n\n` +
                        `📥 Downloading video...`
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
                        `🎥 *${title}*\n` +
                        `⏱️ *${duration}*\n\n` +
                        `📥 Downloading video...`
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
            `video_${Date.now()}.mp4`
        );


        console.log(
            "[VIDEO] Downloading:",
            url
        );


        // =========================
        // DOWNLOAD
        // =========================

        await ytdlp(url, {

            ...YTDLP_COMMON,

            format:
                "bestvideo+bestaudio/best",

            mergeOutputFormat:
                "mp4",

            output:
                filePath,

            ffmpegLocation:
                ffmpeg,

            extractorArgs:
                "youtube:player_client=web_safari"
        });


        // =========================
        // CHECK
        // =========================

        if (!fs.existsSync(filePath)) {

            throw new Error(
                "MP4 file was not created."
            );
        }


        const stats =
            fs.statSync(filePath);


        if (stats.size < 10000) {

            throw new Error(
                "Downloaded video file is too small."
            );
        }


        const videoBuffer =
            fs.readFileSync(filePath);


        // =========================
        // SAFE NAME
        // =========================

        const safeTitle =
            title
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
                .replace(/\s+/g, " ")
                .trim()
                .substring(0, 80) ||
            "video";


        // =========================
        // SEND
        // =========================

        await sock.sendMessage(
            chatId,
            {

                video:
                    videoBuffer,

                mimetype:
                    "video/mp4",

                fileName:
                    `${safeTitle}.mp4`,

                caption:
                    `🎥 *${title}*\n` +
                    `⏱️ *Duration:* ${duration}\n\n` +
                    `> *Downloaded by SALMAN KHAN*`
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
            "[VIDEO] Successfully sent"
        );


    } catch (error) {

        console.error(
            "[VIDEO ERROR]",
            error
        );


        await sock.sendMessage(
            chatId,
            {
                text:
                    `❌ *Video Download Failed*\n\n` +
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


module.exports = videoCommand;
