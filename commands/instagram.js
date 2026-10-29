
const util = require("util");
const { igdl: abIgdl } = require("ab-downloader");

let ruhendIgdl;

try {
    ruhendIgdl = require("ruhend-scraper").igdl;
} catch {
    ruhendIgdl = null;
}

const TIMEOUT = 45000;
const MAX_MEDIA = 10;
const MAX_LOG = 2500;

function log(level, message, data) {
    console.log(
        `[${new Date().toISOString()}] [INSTAGRAM] [${level}] ${message}`,
        data === undefined ? "" : util.inspect(data, {
            depth: 6,
            colors: false,
            maxArrayLength: 40
        })
    );
}

function inspect(value) {
    return util.inspect(value, {
        depth: 10,
        colors: false,
        maxArrayLength: 50,
        maxStringLength: 3000
    });
}

async function sendLog(sock, chatId, content) {
    const text = String(content || "No details");

    for (let i = 0; i < text.length; i += MAX_LOG) {
        try {
            await sock.sendMessage(chatId, {
                text: "🛠️ INSTAGRAM LOG\n\n" +
                    text.slice(i, i + MAX_LOG)
            });
        } catch (error) {
            log("ERROR", "WhatsApp log delivery failed", error.message);
        }
    }
}

function extractText(message) {
    const root = message?.message || {};
    const content =
        root.ephemeralMessage?.message ||
        root.viewOnceMessage?.message ||
        root.viewOnceMessageV2?.message ||
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

function extractUrl(text) {
    const match = text.match(
        /https?:\/\/(?:www\.|m\.)?instagram\.com\/[^\s]+/i
    );

    return match
        ? match[0].replace(/[),.!]+$/, "")
        : text.replace(/^\.(?:ig|insta|instagram)\s+/i, "").trim();
}

function validateUrl(value) {
    let url;

    try {
        url = new URL(value);
    } catch {
        throw new Error("Invalid Instagram URL.");
    }

    if (![
        "instagram.com",
        "www.instagram.com",
        "m.instagram.com"
    ].includes(url.hostname.toLowerCase())) {
        throw new Error("Only Instagram URLs are supported.");
    }

    if (!/^\/(p|reel|reels|tv|stories)\//i.test(url.pathname)) {
        throw new Error("Unsupported Instagram post URL.");
    }

    url.hash = "";
    return url.toString();
}

function withTimeout(promise, ms, provider) {
    let timer;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error(`${provider} timed out after ${ms}ms`);
            error.code = "ETIMEDOUT";
            reject(error);
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isFailure(data) {
    if (!data || typeof data !== "object") return !data;

    const message = String(data.message || data.error || "");

    return (
        data.status === false ||
        data.success === false ||
        data.ok === false ||
        /\b(401|403|429)\b/.test(message)
    );
}

function collectMedia(data) {
    const results = [];
    const visited = new Set();

    const urlKeys = [
        "url", "download_url", "downloadUrl",
        "video_url", "videoUrl", "image_url", "imageUrl",
        "display_url", "displayUrl", "src", "download",
        "video", "image", "link", "href",
        "media_url", "mediaUrl", "contentUrl"
    ];

    const childKeys = [
        "data", "result", "results", "items",
        "media", "medias", "urls", "images",
        "videos", "resources", "carousel",
        "edges", "node", "content", "post", "response"
    ];

    function add(url, type, source) {
        if (typeof url === "string" && /^https?:\/\//i.test(url)) {
            results.push({
                url,
                type: String(type || "").toLowerCase(),
                source
            });
        }
    }

    function walk(value, depth = 0, source = "root") {
        if (!value || depth > 12 || results.length >= 100) return;

        if (typeof value === "string") {
            const str = value.trim();

            if (/^https?:\/\//i.test(str)) {
                add(str, "", source);
            } else if (
                (str.startsWith("{") && str.endsWith("}")) ||
                (str.startsWith("[") && str.endsWith("]"))
            ) {
                try {
                    walk(JSON.parse(str), depth + 1, source + ".json");
                } catch {
                    // Not JSON.
                }
            }
            return;
        }

        if (typeof value !== "object" || visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            value.forEach((item, index) =>
                walk(item, depth + 1, `${source}[${index}]`)
            );
            return;
        }

        const type =
            value.type ||
            value.media_type ||
            value.mediaType ||
            value.mime_type ||
            "";

        for (const key of urlKeys) {
            if (typeof value[key] === "string") {
                add(value[key], type, `${source}.${key}`);
            }
        }

        for (const key of childKeys) {
            if (value[key] !== undefined) {
                walk(value[key], depth + 1, `${source}.${key}`);
            }
        }
    }

    walk(data);

    const unique = new Map();

    for (const item of results) {
        if (!unique.has(item.url)) {
            unique.set(item.url, item);
        } else if (!unique.get(item.url).type && item.type) {
            unique.set(item.url, item);
        }
    }

    return [...unique.values()].slice(0, MAX_MEDIA);
}

function detectType(item) {
    const type = item.type;
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

    return "video";
}

async function fetchMedia(url) {
    const providers = [
        ["ab-downloader", abIgdl],
        ["ruhend-scraper", ruhendIgdl]
    ].filter(([, fn]) => typeof fn === "function");

    const errors = [];

    for (const [name, downloader] of providers) {
        log("INFO", `Trying ${name}`);

        try {
            const response = await withTimeout(
                Promise.resolve().then(() => downloader(url)),
                TIMEOUT,
                name
            );

            log("DEBUG", `${name} raw response`, inspect(response));

            if (isFailure(response)) {
                throw new Error(
                    `API rejected request: ${response.message || response.error || "status false"}`
                );
            }

            const media = collectMedia(response);

            if (!media.length) {
                throw new Error(
                    "No media URLs in response: " + inspect(response)
                );
            }

            return { media, provider: name, errors };
        } catch (error) {
            const detail = {
                provider: name,
                message: error.message,
                code: error.code || "N/A",
                stack: error.stack
            };

            errors.push(detail);
            log("ERROR", `${name} failed`, detail);
        }
    }

    const error = new Error("All Instagram providers failed.");
    error.providerErrors = errors;
    throw error;
}

async function instagramCommand(sock, chatId, message) {
    let stage = "start";
    let url = "";
    let provider = "none";
    const started = Date.now();

    try {
        stage = "extract URL";
        const text = extractText(message);
        const query = extractUrl(text);

        if (!query) {
            return await sock.sendMessage(chatId, {
                text:
                    "❌ Instagram link do.\n\n" +
                    "Example:\n" +
                    ".ig https://www.instagram.com/reel/XXXXXXXX/"
            }, { quoted: message });
        }

        stage = "validate URL";
        url = validateUrl(query);

        log("INFO", "URL received", url);

        try {
            await sock.sendMessage(chatId, {
                react: { text: "📥", key: message.key }
            });
        } catch (error) {
            log("WARN", "Reaction failed", error.message);
        }

        stage = "fetch media";
        const fetched = await fetchMedia(url);
        provider = fetched.provider;

        stage = "send media";
        let sent = 0;
        const sendErrors = [];

        for (let i = 0; i < fetched.media.length; i++) {
            const item = fetched.media[i];
            const type = detectType(item);

            try {
                log("INFO", `Sending ${i + 1}/${fetched.media.length}`, {
                    type,
                    source: item.source,
                    url: item.url
                });

                const payload = type === "image"
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
                sendErrors.push({
                    item: i + 1,
                    message: error.message,
                    code: error.code || "N/A",
                    stack: error.stack
                });

                log("ERROR", "WhatsApp media send failed", error.stack);
            }
        }

        if (!sent) {
            const error = new Error("All media sends failed.");
            error.providerErrors = sendErrors;
            throw error;
        }

        log("INFO", "Download complete", {
            provider,
            sent,
            durationMs: Date.now() - started
        });

        if (sendErrors.length) {
            await sendLog(sock, chatId,
                "⚠️ PARTIAL SUCCESS\n" + inspect(sendErrors));
        }

        try {
            await sock.sendMessage(chatId, {
                react: { text: "✅", key: message.key }
            });
        } catch {}

    } catch (error) {
        const report = [
            "❌ INSTAGRAM COMMAND FAILED",
            `Stage: ${stage}`,
            `Time: ${new Date().toISOString()}`,
            `Duration: ${((Date.now() - started) / 1000).toFixed(1)}s`,
            `URL: ${url || "N/A"}`,
            `Provider: ${provider}`,
            `Message: ${error.message || String(error)}`,
            `Code: ${error.code || "N/A"}`,
            "",
            error.stack || "",
            "",
            "Provider errors:",
            inspect(error.providerErrors || [])
        ].join("\n");

        log("ERROR", report);

        try {
            await sock.sendMessage(chatId, {
                text:
                    "❌ Instagram download failed.\n" +
                    `Stage: ${stage}\n` +
                    `Error: ${error.message || String(error)}`
            }, { quoted: message });
        } catch {}

        await sendLog(sock, chatId, report);

        try {
            await sock.sendMessage(chatId, {
                react: { text: "❌", key: message.key }
            });
        } catch {}
    }
}

module.exports = instagramCommand;
