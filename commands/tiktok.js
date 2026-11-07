const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DIR = path.join(__dirname, "tmp_tiktok");
const TIKWM_API = "https://www.tikwm.com/api/";

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
// EXTRACT TIKTOK URL
// ==========================================

function extractTikTokUrl(text) {
    let query = String(text || "")
        .trim()
        .replace(/^(?:\.(?:tiktok|tt)|tiktok|tt)\s*:?\s*/i, "")
        .trim();

    const match = query.match(
        /https?:\/\/(?:www\.)?(?:vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.com)\/[^\s]+/i
    );

    if (match) query = match[0];
    return query.replace(/[)\]}>,.!?]+$/g, "");
}

// ==========================================
// TIKWM DIRECT POST API
// POST form-data is used instead of GET query params.
// Response is read as text before JSON.parse to handle
// empty/invalid upstream responses safely.
// ==========================================

async function requestTikWM(url) {
    const form = new URLSearchParams();
    form.append("url", url);
    form.append("hd", "1");

    const response = await axios.post(
        TIKWM_API,
        form.toString(),
        {
            timeout: 30000,
            responseType: "text",
            transformResponse: [data => data],
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                    "AppleWebKit/537.36 (KHTML, like Gecko) " +
                    "Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": "https://www.tikwm.com",
                "Referer": "https://www.tikwm.com/"
            },
            validateStatus: status => status >= 200 && status < 500
        }
    );

    const raw = String(response.data || "").trim();

    if (response.status < 200 || response.status >= 300) {
        throw new Error(
            `TikWM HTTP ${response.status}: ${raw.slice(0, 180) || "empty response"}`
        );
    }

    if (!raw) {
        throw new Error(`TikWM returned an empty response (HTTP ${response.status})`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(
            `TikWM returned invalid JSON: ${raw.slice(0, 180)}`
        );
    }

    if (!parsed || typeof parsed !== "object") {
        throw new Error("TikWM returned an invalid JSON structure");
    }

    if (Number(parsed.code) !== 0 || !parsed.data) {
        throw new Error(
            parsed.msg || parsed.message || `TikWM API error (code ${parsed.code})`
        );
    }

    return parsed.data;
}

// ==========================================
// GET VIDEO URL WITH RETRIES
// ==========================================

async function getTikTokVideo(url) {
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`[TIKTOK] TikWM POST attempt ${attempt}/3`);

            const data = await requestTikWM(url);

            const videoUrl =
                data.hdplay ||
                data.play ||
                data.wmplay ||
                null;

            if (!videoUrl || typeof videoUrl !== "string") {
                throw new Error("TikWM response has no playable video URL");
            }

            return {
                videoUrl,
                title: data.title || "",
                author: data.author?.nickname || ""
            };

        } catch (error) {
            lastError = error;
            console.error(
                `[TIKTOK] Attempt ${attempt} failed: ${error.message}`
            );

            if (attempt < 3) {
                await new Promise(resolve =>
                    setTimeout(resolve, attempt * 2000)
                );
            }
        }
    }

    throw new Error(
        `TikTok provider failed after 3 attempts: ${lastError?.message || "Unknown error"}`
    );
}

// ==========================================
// DOWNLOAD VIDEO FILE
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
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Referer": "https://www.tiktok.com/"
        },
        validateStatus: status => status >= 200 && status < 400
    });

    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", error => {
            response.data.destroy();
            reject(error);
        });
        response.data.on("error", error => {
            writer.destroy();
            reject(error);
        });
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

        const query = extractTikTokUrl(text);
        console.log("FINAL TIKTOK QUERY:", query);

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

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        });

        console.log("========== TIKTOK DOWNLOAD ==========");
        console.log("URL:", query);

        const result = await getTikTokVideo(query);
        console.log("TikTok video URL resolved:", Boolean(result.videoUrl));

        const filename =
            "tiktok_" +
            Date.now() +
            "_" +
            crypto.randomBytes(4).toString("hex") +
            ".mp4";

        filePath = path.join(TMP_DIR, filename);

        console.log("Downloading video...");
        await downloadVideo(result.videoUrl, filePath);

        if (!fs.existsSync(filePath)) {
            throw new Error("Downloaded video file not found");
        }

        const stats = fs.statSync(filePath);

        console.log(
            "Video size:",
            (stats.size / 1024 / 1024).toFixed(2),
            "MB"
        );

        if (stats.size < 5000) {
            throw new Error("Downloaded file is invalid or too small");
        }

        console.log("Sending video to WhatsApp...");

        await sock.sendMessage(
            chatId,
            {
                video: { url: filePath },
                mimetype: "video/mp4",
                caption: "✅ TIKTOK DOWNLOADED BY SALMAN"
            },
            { quoted: message }
        );

        console.log("✅ TIKTOK SENT SUCCESSFULLY");

        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        });

    } catch (error) {
        console.error("========== TIKTOK ERROR ==========");
        console.error(error?.message || error);
        console.error(error?.stack || "");

        try {
            await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ TikTok download failed.\n\n" +
                        "Reason: " +
                        (error?.message || "Unknown error")
                },
                { quoted: message }
            );

            await sock.sendMessage(chatId, {
                react: { text: "❌", key: message.key }
            });

        } catch (sendError) {
            console.error("Error sending error message:", sendError);
        }

    } finally {
        if (filePath) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log("🗑️ Temporary file deleted");
                }
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError.message);
            }
        }
    }
}

module.exports = tiktokCommand;
