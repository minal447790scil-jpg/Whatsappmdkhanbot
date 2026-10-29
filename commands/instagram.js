
const dns = require("dns");
const { igdl: abIgdl } = require("ab-downloader");

let ruhendIgdl = null;

try {
    ruhendIgdl = require("ruhend-scraper").igdl;
} catch {
    // Optional fallback package is not installed.
}

const PREFIX = "[INSTAGRAM]";
const MAX_LOG_LENGTH = 3000;
const MAX_MEDIA_ITEMS = 10;
const TIMEOUT_MS = 45000;

function log(level, message, extra = "") {
    const time = new Date().toISOString();
    console.log(
        `[${time}] ${PREFIX} [${level}] ${message}`,
        extra || ""
    );
}

function getErrorDetails(err) {
    return [
        `Message: ${err?.message || String(err)}`,
        `Code: ${err?.code || "N/A"}`,
        `Name: ${err?.name || "Error"}`,
        err?.stack ? `Stack:\n${err.stack}` : ""
    ].filter(Boolean).join("\n");
}

async function sendWhatsAppLog(sock, chatId, message) {
    const text = String(message || "Unknown error");

    for (let i = 0; i < text.length; i += MAX_LOG_LENGTH) {
        const chunk = text.slice(i, i + MAX_LOG_LENGTH);

        try {
            await sock.sendMessage(chatId, {
                text: `🛠️ INSTAGRAM BOT LOG\n\n${chunk}`
            });
        } catch (err) {
            log("ERROR", "Could not send log to WhatsApp", err.message);
        }
    }
}

function extractText(message) {
    const root = message?.message || {};

    // Handle common WhatsApp message wrappers.
    const msg =
        root.ephemeralMessage?.message ||
        root.viewOnceMessage?.message ||
        root.viewOnceMessageV2?.message ||
        root;

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        root.conversation ||
        root.extendedTextMessage?.text ||
        ""
    ).trim();
}

function getInstagramUrl(text) {
    const match = text.match(
        /https?:\/\/(?:www\.|m\.)?instagram\.com\/[^\s]+/i
    );

    if (match) {
        return match[0].replace(/[),.!]+$/, "");
    }

    return text.replace(
        /^\.(?:insta|ig|instagram)\s+/i,
        ""
    ).trim();
}

function validateInstagramUrl(value) {
    let url;

    try {
        url = new URL(value);
    } catch {
        throw new Error("Invalid URL. Please provide a valid Instagram link.");
    }

    const host = url.hostname.toLowerCase();

    if (!["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host)) {
        throw new Error("Only public Instagram links are supported.");
    }

    if (!/^\/(p|reel|reels|tv|stories)\//i.test(url.pathname)) {
        throw new Error("Unsupported Instagram URL type.");
    }

    url.hash = "";
    return url.toString();
}

function withTimeout(promise, ms, label) {
    let timer;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`${label} timed out after ${ms} ms`);
            err.code = "ETIMEDOUT";
            reject(err);
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timer);
    });
}

async function getMediaData(url) {
    const errors = [];
    const providers = [
        ["ab-downloader", abIgdl],
        ...(typeof ruhendIgdl === "function"
            ? [["ruhend-scraper", ruhendIgdl]]
            : [])
    ];

    for (const [name, downloader] of providers) {
        log("INFO", `Trying provider: ${name}`);

        try {
            const result = await withTimeout(
                Promise.resolve().then(() => downloader(url)),
                TIMEOUT_MS,
                name
            );

            if (result) {
                log("INFO", `${name} returned a response`);
                return { result, provider: name, errors };
            }

            errors.push(`${name}: empty response`);
        } catch (err) {
            const details = getErrorDetails(err);
            errors.push(`${name}:\n${details}`);
            log("ERROR", `${name} failed`, details);
        }
    }

    const error = new Error("All Instagram downloader providers failed.");
    error.providerErrors = errors;
    throw error;
}

function normalizeMedia(data) {
    const output = [];
    const visited = new Set();

    function walk(value, depth = 0) {
        if (!value || depth > 7 || output.length >= MAX_MEDIA_ITEMS) {
            return;
        }

        if (typeof value === "string") {
            if (/^https?:\/\//i.test(value)) {
                output.push({ url: value, type: "" });
            }
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                walk(item, depth + 1);
            }
            return;
        }

        if (typeof value !== "object" || visited.has(value)) {
            return;
        }

        visited.add(value);

        const type = String(
            value.type ||
            value.media_type ||
            value.mime_type ||
            ""
        ).toLowerCase();

        const urlKeys = [
            "url",
            "download_url",
            "downloadUrl",
            "video_url",
            "videoUrl",
            "image_url",
            "display_url",
            "src",
            "download",
            "video",
            "image",
            "link"
        ];

        let found = false;

        for (const key of urlKeys) {
            const item = value[key];

            if (typeof item === "string" && /^https?:\/\//i.test(item)) {
                output.push({ url: item, type });
                found = true;

                if (output.length >= MAX_MEDIA_ITEMS) return;
            }
        }

        // Traverse common response wrappers.
        for (const key of [
            "data",
            "result",
            "results",
            "urls",
            "media",
            "items",
            "images",
            "videos",
            "resources"
        ]) {
            if (value[key] && typeof value[key] === "object") {
                walk(value[key], depth + 1);
            }
        }

        if (!found && !output.length) {
            log("WARN", "Response object has no recognized media URL");
        }
    }

    walk(data);

    // Deduplicate URLs.
    const unique = new Map();

    for (const item of output) {
        if (!unique.has(item.url)) {
            unique.set(item.url, item);
        }
    }

    return [...unique.values()].slice(0, MAX_MEDIA_ITEMS);
}

function detectMediaType(item) {
    const type = String(item.type || "").toLowerCase();
    const url = item.url.toLowerCase();

    if (
        type.includes("image") ||
        /\.(jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url)
    ) {
        return "image";
    }

    if (
        type.includes("video") ||
        /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(url)
    ) {
        return "video";
    }

    // Instagram Reels are usually videos, but extensionless
    // URLs cannot always be classified reliably.
    return "video";
}

async function instagramCommand(sock, chatId, message) {
    const started = Date.now();
    let currentStage = "initialization";
    let cleanUrl = "";

    const reportFailure = async (err) => {
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);

        const report = [
            "❌ INSTAGRAM COMMAND FAILED",
            `Stage: ${currentStage}`,
            `Time: ${new Date().toISOString()}`,
            `Duration: ${elapsed}s`,
            `URL: ${cleanUrl || "Not extracted"}`,
            "",
            getErrorDetails(err),
            "",
            ...(err?.providerErrors || []),
            "",
            "Troubleshooting:",
            "1. Check internet and DNS.",
            "2. Check whether the scraper API is available.",
            "3. Update the downloader package.",
            "4. Private/deleted posts may not be accessible.",
            "5. Check whether Instagram changed its response."
        ].join("\n");

        log("ERROR", "Command failed", report);

        try {
            await sock.sendMessage(chatId, {
                text: "❌ Instagram download failed.\nCheck the diagnostic report below."
            }, { quoted: message });
        } catch (sendErr) {
            log("ERROR", "Could not send user error", sendErr.message);
        }

        // Send diagnostics to the same chat where the command was used.
        await sendWhatsAppLog(sock, chatId, report);

        try {
            await sock.sendMessage(chatId, {
                react: { text: "❌", key: message.key }
            });
        } catch (reactErr) {
            log("WARN", "Could not add failure reaction", reactErr.message);
        }
    };

    try {
        currentStage = "extracting URL";

        const text = extractText(message);
        const query = getInstagramUrl(text);

        if (!query) {
            return await sock.sendMessage(chatId, {
                text:
                    "❌ Instagram link do.\n\n" +
                    "Example:\n" +
                    ".ig https://www.instagram.com/reel/XXXXXXXX/"
            }, { quoted: message });
        }

        currentStage = "validating URL";
        cleanUrl = validateInstagramUrl(query);

        log("INFO", "Command received", cleanUrl);

        try {
            await sock.sendMessage(chatId, {
                react: { text: "📥", key: message.key }
            });
        } catch (err) {
            log("WARN", "Download reaction failed", err.message);
        }

        currentStage = "checking DNS";

        // DNS diagnostic only. It does not block the downloader:
        // some libraries use different API hosts.
        dns.lookup("api.videodropper.app", (err, address) => {
            if (err) {
                log("WARN", "videodropper DNS lookup failed", {
                    code: err.code,
                    message: err.message
                });
            } else {
                log("INFO", "videodropper DNS lookup succeeded", address);
            }
        });

        currentStage = "fetching media";
        const { result, provider, errors } = await getMediaData(cleanUrl);

        log("INFO", `Provider succeeded: ${provider}`);

        currentStage = "normalizing media";
        const mediaList = normalizeMedia(result);

        log("INFO", `Media URLs found: ${mediaList.length}`);

        if (!mediaList.length) {
            const err = new Error(
                "Scraper returned no recognizable media URLs."
            );
            err.providerErrors = errors;
            throw err;
        }

        currentStage = "sending media";

        let sent = 0;
        const sendErrors = [];

        for (let i = 0; i < mediaList.length; i++) {
            const item = mediaList[i];

            try {
                const mediaType = detectMediaType(item);

                log("INFO", `Sending ${i + 1}/${mediaList.length}`, {
                    type: mediaType,
                    url: item.url
                });

                const payload = mediaType === "image"
                    ? {
                        image: { url: item.url },
                        caption: "✅ DOWNLOADED BY SALMAN"
                    }
                    : {
                        video: { url: item.url },
                        caption: "✅ DOWNLOADED BY SALMAN"
                    };

                await sock.sendMessage(chatId, payload, {
                    quoted: message
                });

                sent++;
            } catch (err) {
                const detail =
                    `Media ${i + 1}: ${getErrorDetails(err)}`;

                sendErrors.push(detail);
                log("ERROR", "Media send failed", detail);
            }
        }

        if (sent === 0) {
            const err = new Error(
                "All media sends failed. The media URL may be expired, " +
                "blocked, or unsupported by the WhatsApp connection."
            );
            err.providerErrors = [...errors, ...sendErrors];
            throw err;
        }

        currentStage = "completed";

        log("INFO", `Success: sent ${sent} item(s)`);

        if (sendErrors.length) {
            await sendWhatsAppLog(
                sock,
                chatId,
                "⚠️ PARTIAL SUCCESS\n" +
                `Sent: ${sent}\n` +
                `Failed: ${sendErrors.length}\n\n` +
                sendErrors.join("\n\n")
            );
        }

        try {
            await sock.sendMessage(chatId, {
                react: { text: "✅", key: message.key }
            });
        } catch (err) {
            log("WARN", "Success reaction failed", err.message);
        }

    } catch (err) {
        await reportFailure(err);
    }
}

module.exports = instagramCommand;
