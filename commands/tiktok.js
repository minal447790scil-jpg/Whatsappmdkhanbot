const { ttdl } = require("ruhend-scraper");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DIR = path.join(__dirname, "tmp_tiktok");

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}


// ==========================================
// GET MESSAGE TEXT
// ==========================================

function getText(message) {

    let msg = message?.message;

    if (!msg) return "";

    if (msg.ephemeralMessage?.message) {
        msg = msg.ephemeralMessage.message;
    }

    if (msg.viewOnceMessage?.message) {
        msg = msg.viewOnceMessage.message;
    }

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
    );
}


// ==========================================
// EXTRACT VIDEO URL
// ==========================================

function extractVideoUrl(data) {

    if (!data) return null;

    if (typeof data === "string") {
        return /^https?:\/\//i.test(data) ? data : null;
    }

    const urls = [

        data.video,
        data.video_url,
        data.videoUrl,

        data.download,
        data.download_url,
        data.downloadUrl,

        data.url,

        data.play,
        data.nowm,

        data.no_watermark,
        data.noWatermark,

        data.data?.video,
        data.data?.video_url,
        data.data?.videoUrl,

        data.data?.download,
        data.data?.download_url,
        data.data?.downloadUrl,

        data.data?.url,

        data.data?.play,
        data.data?.nowm,

        data.data?.no_watermark,
        data.data?.noWatermark,

        data.result?.video,
        data.result?.video_url,
        data.result?.videoUrl,

        data.result?.download,
        data.result?.download_url,
        data.result?.downloadUrl,

        data.result?.url,

        data.result?.play,
        data.result?.nowm,

        data.result?.data?.video,
        data.result?.data?.video_url,
        data.result?.data?.videoUrl,

        data.result?.data?.download,
        data.result?.data?.download_url,
        data.result?.data?.downloadUrl,

        data.result?.data?.url,

        data.result?.data?.play,
        data.result?.data?.nowm
    ];

    for (const url of urls) {

        if (
            typeof url === "string" &&
            /^https?:\/\//i.test(url)
        ) {
            return url;
        }
    }

    return null;
}


// ==========================================
// RESOLVE FUNCTION
// ==========================================

async function resolveValue(value) {

    if (typeof value === "function") {
        return await value();
    }

    return value;
}


// ==========================================
// DOWNLOAD VIDEO
// ==========================================

async function downloadVideo(url, filePath) {

    const response = await axios({
        method: "GET",
        url,

        responseType: "stream",

        timeout: 120000,

        maxRedirects: 10,

        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 " +
                "(KHTML, like Gecko) " +
                "Chrome/140.0.0.0 Safari/537.36",

            "Accept": "*/*",

            "Referer": "https://www.tiktok.com/"
        },

        validateStatus: status =>
            status >= 200 && status < 400
    });

    return new Promise((resolve, reject) => {

        const writer = fs.createWriteStream(filePath);

        response.data.pipe(writer);

        writer.on("finish", () => {
            writer.close(resolve);
        });

        writer.on("error", reject);

        response.data.on("error", reject);
    });
}


// ==========================================
// TIKTOK COMMAND
// ==========================================

async function tiktokCommand(sock, chatId, message) {

    let filePath = null;

    try {

        const text = getText(message);

        console.log("========== RAW TIKTOK MESSAGE ==========");
        console.log(text);

        // ==========================================
        // FIXED COMMAND PARSING
        // Supports:
        //
        // .tt URL
        // .tiktok URL
        // Tiktok URL
        // TikTok URL
        // tt URL
        // ==========================================

        let query = text
            .trim()
            .replace(
                /^(?:\.(?:tiktok|tt)|tiktok|tt)\s*:?\s*/i,
                ""
            )
            .trim();

        // ==========================================
        // IF USER JUST SENT URL
        // ==========================================

        if (!query) {

            const urlMatch = text.match(
                /https?:\/\/(?:www\.)?(?:vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.com|www\.tiktok\.com)\/[^\s]+/i
            );

            if (urlMatch) {
                query = urlMatch[0];
            }
        }

        // ==========================================
        // REMOVE EXTRA TEXT AROUND URL
        // ==========================================

        const urlMatch = query.match(
            /https?:\/\/(?:www\.)?(?:vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.com)\/[^\s]+/i
        );

        if (urlMatch) {
            query = urlMatch[0];
        }

        // Remove punctuation accidentally attached
        query = query.replace(/[)\]}>,.!?]+$/g, "");

        console.log("FINAL TIKTOK QUERY:", query);


        // ==========================================
        // EMPTY
        // ==========================================

        if (!query) {

            return await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ TikTok link do.\n\n" +
                        "Example:\n" +
                        "Tiktok https://vt.tiktok.com/xxxxx/"
                },
                { quoted: message }
            );
        }


        // ==========================================
        // VALIDATE TIKTOK URL
        // ==========================================

        const validTikTok =
            /^https?:\/\/(?:www\.)?(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)\//i
                .test(query);

        if (!validTikTok) {

            return await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ Valid TikTok link do.\n\n" +
                        "Example:\n" +
                        "https://vt.tiktok.com/xxxxx/"
                },
                { quoted: message }
            );
        }


        // ==========================================
        // DOWNLOADING REACTION
        // ==========================================

        await sock.sendMessage(chatId, {
            react: {
                text: "📥",
                key: message.key
            }
        });


        console.log("\n========== TIKTOK DOWNLOAD ==========");
        console.log("URL:", query);


        // ==========================================
        // CALL TTDL
        // ==========================================

        let result = await Promise.race([

            ttdl(query),

            new Promise((_, reject) =>
                setTimeout(
                    () => reject(
                        new Error(
                            "TikTok downloader timeout after 60 seconds"
                        )
                    ),
                    60000
                )
            )
        ]);


        result = await resolveValue(result);


        console.log("TTDL RESULT:");
        console.dir(result, {
            depth: 10
        });


        // ==========================================
        // FIND VIDEO URL
        // ==========================================

        let videoUrl = extractVideoUrl(result);


        // ==========================================
        // DEEP SEARCH
        // ==========================================

        if (!videoUrl && result && typeof result === "object") {

            const queue = [result];

            const visited = new Set();

            while (queue.length && !videoUrl) {

                const current = queue.shift();

                if (
                    !current ||
                    typeof current !== "object" ||
                    visited.has(current)
                ) {
                    continue;
                }

                visited.add(current);

                for (const key of Object.keys(current)) {

                    let value;

                    try {
                        value = await resolveValue(current[key]);
                    } catch {
                        continue;
                    }


                    if (
                        typeof value === "string" &&
                        /^https?:\/\//i.test(value)
                    ) {

                        if (
                            /\.(mp4|m3u8)(\?|$)/i.test(value) ||
                            /video|play|download|nowm/i.test(key)
                        ) {
                            videoUrl = value;
                            break;
                        }
                    }


                    if (
                        value &&
                        typeof value === "object"
                    ) {
                        queue.push(value);
                    }
                }
            }
        }


        console.log("FINAL VIDEO URL:", videoUrl);


        // ==========================================
        // NO URL
        // ==========================================

        if (!videoUrl) {

            await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ TikTok video download link nahi mili."
                },
                { quoted: message }
            );

            await sock.sendMessage(chatId, {
                react: {
                    text: "❌",
                    key: message.key
                }
            });

            return;
        }


        // ==========================================
        // DOWNLOAD TO LOCAL FILE
        // ==========================================

        const filename =
            "tiktok_" +
            Date.now() +
            "_" +
            crypto.randomBytes(4).toString("hex") +
            ".mp4";

        filePath = path.join(
            TMP_DIR,
            filename
        );


        console.log("Downloading video...");

        await downloadVideo(
            videoUrl,
            filePath
        );


        // ==========================================
        // CHECK FILE
        // ==========================================

        if (!fs.existsSync(filePath)) {
            throw new Error(
                "Downloaded video file not found"
            );
        }


        const stats =
            fs.statSync(filePath);


        console.log(
            "Video size:",
            (
                stats.size /
                1024 /
                1024
            ).toFixed(2),
            "MB"
        );


        if (stats.size < 5000) {

            throw new Error(
                "Downloaded file is invalid or empty"
            );
        }


        // ==========================================
        // SEND VIDEO
        // ==========================================

        console.log(
            "Sending video to WhatsApp..."
        );


        await sock.sendMessage(
            chatId,
            {
                video: {
                    url: filePath
                },

                mimetype: "video/mp4",

                caption:
                    "✅ TIKTOK DOWNLOADED BY SALMAN"
            },
            {
                quoted: message
            }
        );


        console.log(
            "✅ TIKTOK SENT SUCCESSFULLY"
        );


        await sock.sendMessage(chatId, {
            react: {
                text: "✅",
                key: message.key
            }
        });


    } catch (error) {

        console.error(
            "\n========== TIKTOK ERROR =========="
        );

        console.error(
            error?.message || error
        );

        console.error(
            error?.stack || ""
        );


        try {

            await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ TikTok download failed.\n\n" +
                        "Reason: " +
                        (error?.message ||
                            "Unknown error")
                },
                {
                    quoted: message
                }
            );


            await sock.sendMessage(chatId, {
                react: {
                    text: "❌",
                    key: message.key
                }
            });

        } catch (sendError) {

            console.error(
                "Error sending error message:",
                sendError
            );
        }

    } finally {

        // ==========================================
        // DELETE TEMP FILE
        // ==========================================

        if (filePath) {

            try {

                if (
                    fs.existsSync(filePath)
                ) {
                    fs.unlinkSync(filePath);
                    console.log(
                        "🗑️ Temporary file deleted"
                    );
                }

            } catch (cleanupError) {

                console.error(
                    "Cleanup error:",
                    cleanupError.message
                );
            }
        }
    }
}


module.exports = tiktokCommand;
