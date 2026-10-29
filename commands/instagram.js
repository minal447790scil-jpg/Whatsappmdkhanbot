
const util = require("util");
const dns = require("dns");
const { igdl: abIgdl } = require("ab-downloader");

let ruhendIgdl;

try {
    ruhendIgdl = require("ruhend-scraper").igdl;
} catch (err) {
    ruhendIgdl = null;
}

const TAG = "[INSTAGRAM]";
const TIMEOUT_MS = 45000;
const MAX_MEDIA = 10;
const MAX_LOG = 2500;

function log(level, message, details) {
    const timestamp = new Date().toISOString();

    console.log(
        `[${timestamp}] ${TAG} [${level}] ${message}`,
        details === undefined
            ? ""
            : typeof details === "string"
                ? details
                : util.inspect(details, {
                    depth: 5,
                    colors: false
                })
    );
}

function inspect(value, depth = 8) {
    return util.inspect(value, {
        depth,
        colors: false,
        maxArrayLength: 50,
        maxStringLength: 3000,
        compact: false
    });
}

async function sendLog(sock, chatId, text) {
    const message = String(text || "No diagnostic details");

    for (let i = 0; i < message.length; i += MAX_LOG) {
        try {
            await sock.sendMessage(chatId, {
                text:
                    "🛠️ INSTAGRAM DIAGNOSTICS\n\n" +
                    message.slice(i, i + MAX_LOG)
            });
        } catch (err) {
            log("ERROR", "Could not send diagnostic to WhatsApp", err.message);
        }
    }
}

function extractText(message) {
    const root = message?.message || {};

    const content =
        root.ephemeralMessage?.message ||
        root.viewOnceMessage?.message ||
        root.viewOnceMessageV2?.message ||
        root.documentWithCaptionMessage?.message ||
        root;

    return (
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
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
        /^\.(?:ig|insta|instagram)\s+/i,
        ""
    ).trim();
}

function validateUrl(value) {
    let url;

    try {
        url = new URL(value);
    } catch {
        throw new Error("Invalid Instagram URL.");
    }

    const hostname = url.hostname.toLowerCase();

    if (
        ![
            "instagram.com",
            "www.instagram.com",
            "m.instagram.com"
        ].includes(hostname)
    ) {
        throw new Error("Only Instagram URLs are supported.");
    }

    if (!/^\/(p|reel|reels|tv|stories)\//i.test(url.pathname)) {
        throw new Error("Unsupported Instagram post URL.");
    }

    // Preserve Instagram query parameters because some shared
    // URLs include them. Remove the fragment only.
    url.hash = "";

    return url.toString();
}

function withTimeout(promise, ms, provider) {
    let timer;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error(
                `${provider} timed out after ${ms} ms`
            );
            error.code = "ETIMEDOUT";
            reject(error);
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timer);
    });
}

async function fetchInstagram(url) {
    const providers = [
        ["ab-downloader", abIgdl],
        ["ruhend-scraper", ruhendIgdl]
    ].filter(([, fn]) => typeof fn === "function");

    const errors = [];

    for (const [name, downloader] of providers) {
        log("INFO", `Trying ${name}`);

        try {
            const result = await withTimeout(
                Promise.resolve().then(() => downloader(url)),
                TIMEOUT_MS,
                name
            );

            log("DEBUG", `${name} raw response`, inspect(result));

            if (result === null || result === undefined) {
                throw new Error("Provider returned null or undefined.");
            }

            return {
                result,
                provider: name,
                errors
            };
        } catch (error) {
            const details = {
                provider: name,
                message: error.message,
                code: error.code || "N/A",
                stack: error.stack
            };

            errors.push(details);

            log("ERROR", `${name} failed`, details);
        }
    }

    const error = new Error("All Instagram providers failed.");
    error.providerErrors = errors;

    throw error;
}

// Handles URLs in strings, arrays, and nested objects.
// Keeps response metadata for debugging.
function normalizeMedia(response) {
    const found = [];
    const visited = new Set();

    const urlFields = [
        "url",
        "urls",
        "download_url",
        "downloadUrl",
        "video_url",
        "videoUrl",
        "image_url",
        "imageUrl",
        "display_url",
        "displayUrl",
        "src",
        "download",
        "video",
        "image",
        "link",
        "href",
        "thumbnail_url",
        "thumbnailUrl",
        "contentUrl",
        "media_url",
        "mediaUrl"
    ];

    const childFields = [
        "data",
        "result",
        "results",
        "items",
        "media",
        "medias",
        "urls",
        "images",
        "videos",
        "resources",
        "carousel",
        "edges",
        "node",
        "content",
        "post",
        "response"
    ];

    function addUrl(url, type, source) {
        if (
            typeof url !== "string" ||
            !/^https?:\/\//i.test(url)
        ) {
            return;
        }

        found.push({
            url,
            type: String(type || "").toLowerCase(),
            source
        });
    }

    function walk(value, depth = 0, source = "root") {
        if (
            value === null ||
            value === undefined ||
            depth > 12 ||
            found.length >= 100
        ) {
            return;
        }

        if (typeof value === "string") {
            // Some APIs return a JSON-encoded response.
            const trimmed = value.trim();

            if (/^https?:\/\//i.test(trimmed)) {
                addUrl(trimmed, "", source);
                return;
            }

            if (
                (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                (trimmed.startsWith("[") && trimmed.endsWith("]"))
            ) {
                try {
                    walk(JSON.parse(trimmed), depth + 1, source + ".json");
                } catch {
                    // Ordinary text, not JSON.
                }
            }

            return;
        }

        if (typeof value !== "object") {
            return;
        }

        if (visited.has(value)) {
            return;
        }

        visited.add(value);

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                walk(item, depth + 1, `${source}[${index}]`);
            });

            return;
        }

        const type =
            value.type ||
            value.media_type ||
            value.mediaType ||
            value.mime_type ||
            value.mimeType ||
            "";

        for (const key of urlFields) {
            const candidate = value[key];

            if (typeof candidate === "string") {
                addUrl(candidate, type, `${source}.${key}`);
            }
        }

        for (const key of childFields) {
            if (value[key] !== undefined) {
                walk(value[key], depth + 1, `${source}.${key}`);
            }
        }
    }

    walk(response);

    const unique = new Map();

    for (const item of found) {
        const previous = unique.get(item.url);

        if (!previous) {
            unique.set(item.url, item);
        } else if (!previous.type && item.type) {
            unique.set(item.url, item);
        }
    }

    return [...unique.values()].slice(0, MAX_MEDIA);
}

function mediaType(item) {
    const type = String(item.type || "").toLowerCase();
    const url = item.url.toLowerCase();

    if (
        type.includes("image") ||
        /\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)/i.test(url)
    ) {
        return "image";
    }

    if (
        type.includes("video") ||
        type.includes("mp4") ||
        /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(url)
    ) {
        return "video";
    }

    // Instagram reels are normally videos, but an extensionless
    // URL cannot always be classified from the URL alone.
    return "video";
}

function errorReport(error, stage, url, provider) {
    return [
        "❌ INSTAGRAM COMMAND FAILED",
        `Stage: ${stage}`,
        `Time: ${new Date().toISOString()}`,
        `URL: ${url || "Not extracted"}`,
        `Provider: ${provider || "Not selected"}`,
        `Message: ${error?.message || String(error)}`,
        `Code: ${error?.code || "N/A"}`,
        "",
        error?.stack || "",
        "",
        error?.providerErrors
            ? inspect(error.providerErrors, 6)
            : ""
    ].join("\n");
}

async function instagramCommand(sock, chatId, message) {
    let stage = "initialization";
    let url = "";
    let provider = "Not selected";
    const start = Date.now();

    try {
        stage = "extracting message";

        const text = extractText(message);
        const query = getInstagramUrl(text);

        if (!query) {
            return await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ Instagram link do.\n\n" +
                        "Example:\n" +
                        ".ig https://www.instagram.com/reel/XXXXXXXX/"
                },
                { quoted: message }
            );
        }

        stage = "validating URL";
        url = validateUrl(query);

        log("INFO", "Download requested", url);

        try {
            await sock.sendMessage(chatId, {
                react: { text: "📥", key: message.key }
            });
        } catch (error) {
            log("WARN", "Download reaction failed", error.message);
        }

        // DNS diagnostic: report the known failing host but do not
        // assume every provider uses that API.
        stage = "DNS diagnostics";

        dns.lookup("api.videodropper.app", (error, address) => {
            if (error) {
                log("WARN", "videodropper DNS failure", {
                    code: error.code,
                    message: error.message
                });
            } else {
                log("INFO", "videodropper DNS resolved", address);
            }
        });

        stage = "fetching media";

        const fetched = await fetchInstagram(url);
        provider = fetched.provider;

        stage = "normalizing media";

        log("DEBUG", "Selected provider response", {
            provider,
            raw: inspect(fetched.result)
        });

        const media = normalizeMedia(fetched.result);

        log("INFO", "Normalized media count", media.length);

        if (media.length === 0) {
            const error = new Error(
                "Provider returned data, but no supported media URL " +
                "was found. Inspect the raw response in terminal."
            );

            error.providerErrors = [
                {
                    provider,
                    rawResponse: inspect(fetched.result, 10)
                },
                ...fetched.errors
            ];

            throw error;
        }

        stage = "sending media";

        let sent = 0;
        const failures = [];

        for (let index = 0; index < media.length; index++) {
            const item = media[index];

            try {
                const kind = mediaType(item);

                log("INFO", `Sending media ${index + 1}/${media.length}`, {
                    kind,
                    source: item.source,
                    url: item.url
                });

                const payload = kind === "image"
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
            } catch (error) {
                failures.push({
                    index: index + 1,
                    message: error.message,
                    code: error.code || "N/A",
                    stack: error.stack
                });

                log("ERROR", `Failed to send media ${index + 1}`, error.stack);
            }
        }

        if (sent === 0) {
            const error = new Error(
                "Media URLs were found, but WhatsApp could not send any."
            );

            error.providerErrors = failures;
            throw error;
        }

        stage = "completed";

        log("INFO", "Download complete", {
            provider,
            sent,
            failed: failures.length,
            durationMs: Date.now() - start
        });

        if (failures.length) {
            await sendLog(
                sock,
                chatId,
                "⚠️ PARTIAL SUCCESS\n\n" +
                `Sent: ${sent}\n` +
                `Failed: ${failures.length}\n\n` +
                inspect(failures, 5)
            );
        }

        try {
            await sock.sendMessage(chatId, {
                react: { text: "✅", key: message.key }
            });
        } catch (error) {
            log("WARN", "Success reaction failed", error.message);
        }

    } catch (error) {
        const report = errorReport(error, stage, url, provider);

        log("ERROR", report);

        try {
            await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ Instagram download failed.\n" +
                        `Stage: ${stage}\n` +
                        `Error: ${error.message || String(error)}\n` +
                        "Diagnostic report neeche hai."
                },
                { quoted: message }
            );
        } catch (sendError) {
            log("ERROR", "Could not send error message", sendError.message);
        }

        await sendLog(sock, chatId, report);

        try {
            await sock.sendMessage(chatId, {
                react: { text: "❌", key: message.key }
            });
        } catch (reactError) {
            log("WARN", "Failure reaction failed", reactError.message);
        }
    }
}

module.exports = instagramCommand;
