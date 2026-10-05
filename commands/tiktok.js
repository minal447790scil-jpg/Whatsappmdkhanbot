const { ttdl } = require("ruhend-scraper");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DIR = path.join(__dirname, "tmp_tiktok");

// Create temp folder
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

function getText(message) {
    let msg = message?.message;

    if (!msg) return "";

    // Ephemeral
    if (msg.ephemeralMessage?.message) {
        msg = msg.ephemeralMessage.message;
    }

    // View once
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

function extractVideoUrl(data) {
    if (!data) return null;

    // Direct string
    if (typeof data === "string") {
        return data;
    }

    // Function response
    if (typeof data === "function") {
        return null;
    }

    // Common direct fields
    const possible = [
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

        // nested data
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

        // result
        data.result?.video,
        data.result?.video_url,
        data.result?.videoUrl,
        data.result?.download,
        data.result?.url,
        data.result?.play,
        data.result?.nowm,

        // result.data
        data.result?.data?.video,
        data.result?.data?.video_url,
        data.result?.data?.videoUrl,
        data.result?.data?.download,
        data.result?.data?.url,
        data.result?.data?.play,
        data.result?.data?.nowm
    ];

    for (let url of possible) {
        if (typeof url === "string" && /^https?:\/\//i.test(url)) {
            return url;
        }
    }

    return null;
}

async function resolveValue(value) {
    if (typeof value === "function") {
        return await value();
    }

    return value;
}

async function downloadVideo(url, filePath) {
    const response = await axios({
        method: "GET",
        url,
        responseType: "stream",
        timeout: 120000,

        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/140.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Referer": "https://www.tiktok.com/"
        },

        maxRedirects: 10,
        validateStatus: status => status >= 200 && status < 400
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

async function tiktokCommand(sock, chatId, message) {
    let filePath = null;

    try {
        const text = getText(message);

        const query = text
            .replace(/^\.(tiktok|tt)\s+/i, "")
            .trim();

        if (!query) {
            return await sock.sendMessage(
                chatId,
                {
                    text: "❌ TikTok link do.\n\nExample:\n.tt https://www.tiktok.com/..."
                },
                { quoted: message }
            );
        }

        // Validate TikTok URL
        if (
            !/^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\//i.test(
                query
            )
        ) {
            return await sock.sendMessage(
                chatId,
                {
                    text: "❌ Valid TikTok link do."
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, {
            react: {
                text: "📥",
                key: message.key
            }
        });

        console.log("\n========== TIKTOK ==========");
        console.log("URL:", query);

        // ==============================
        // TTDL
        // ==============================

        let result = await Promise.race([
            ttdl(query),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error("TTDL timeout after 60 seconds")),
                    60000
                )
            )
        ]);

        console.log("TTDL RESULT:");
        console.dir(result, {
            depth: 10
        });

        // Resolve function if package returns function
        result = await resolveValue(result);

        let videoUrl = extractVideoUrl(result);

        // ==============================
        // Search deeper if necessary
        // ==============================

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
                        /^https?:\/\//i.test(value) &&
                        /\.(mp4|m3u8)(\?|$)/i.test(value)
                    ) {
                        videoUrl = value;
                        break;
                    }

                    if (value && typeof value === "object") {
                        queue.push(value);
                    }
                }
            }
        }

        console.log("FINAL VIDEO URL:", videoUrl);

        if (!videoUrl) {
            console.log("❌ No video URL found");

            await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ TikTok video download link nahi mili.\n\n" +
                        "TikTok ya downloader response change ho sakta hai."
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

        // ==============================
        // Download locally
        // ==============================

        const filename =
            "tiktok_" +
            Date.now() +
            "_" +
            crypto.randomBytes(4).toString("hex") +
            ".mp4";

        filePath = path.join(TMP_DIR, filename);

        console.log("Downloading:", filePath);

        await downloadVideo(videoUrl, filePath);

        if (!fs.existsSync(filePath)) {
            throw new Error("Downloaded file does not exist");
        }

        const stats = fs.statSync(filePath);

        console.log(
            "Downloaded size:",
            (stats.size / 1024 / 1024).toFixed(2),
            "MB"
        );

        if (stats.size < 5000) {
            throw new Error("Downloaded file is too small / invalid");
        }

        // ==============================
        // Send to WhatsApp
        // ==============================

        await sock.sendMessage(
            chatId,
            {
                video: {
                    url: filePath
                },

                mimetype: "video/mp4",

                caption: "✅ TIKTOK DOWNLOADED BY SALMAN"
            },
            { quoted: message }
        );

        console.log("✅ TikTok sent successfully");

        await sock.sendMessage(chatId, {
            react: {
                text: "✅",
                key: message.key
            }
        });

    } catch (error) {
        console.error("\n========== TIKTOK ERROR ==========");
        console.error(error);
        console.error(error?.stack);

        try {
            await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ TikTok download failed.\n\n" +
                        `Reason: ${error?.message || "Unknown error"}`
                },
                { quoted: message }
            );

            await sock.sendMessage(chatId, {
                react: {
                    text: "❌",
                    key: message.key
                }
            });
        } catch (sendError) {
            console.error(
                "Failed to send error message:",
                sendError
            );
        }

    } finally {
        // ==============================
        // Delete temporary file
        // ==============================

        if (filePath) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log("🗑️ Temp file deleted");
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
