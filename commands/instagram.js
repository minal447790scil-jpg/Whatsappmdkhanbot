const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");
const { Scraper } = require("@xazepysk/scrapers");

const exec = promisify(execFile);

const CAPTION = "✅ DOWNLOADED BY SALMAN";
const MAX_MEDIA = 10;
const MAX_VIDEO_SIZE = 60 * 1024 * 1024;
const INSTAGRAM_HOSTS = new Set([
    "instagram.com",
    "www.instagram.com",
    "m.instagram.com"
]);

function log(...args) {
    console.log("[INSTAGRAM]", new Date().toISOString(), ...args);
}

async function run(command, args, options = {}) {
    return exec(command, args, {
        timeout: 300000,
        maxBuffer: 20 * 1024 * 1024,
        ...options
    });
}

function validateInstagramUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error("Invalid Instagram URL.");
    }

    if (!INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())) {
        throw new Error("Please send a valid Instagram link.");
    }

    if (!/^\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?$/i.test(parsed.pathname)) {
        throw new Error("Supported links: public Instagram Reels and posts.");
    }

    return parsed.toString();
}

async function instagramCommand(sock, chatId, message) {
    let dir;
    let stage = "initialization";
    let url = "";

    try {
        stage = "extracting Instagram URL";

        const root = message.message || {};
        const content =
            root.ephemeralMessage?.message ||
            root.viewOnceMessageV2?.message ||
            root.viewOnceMessage?.message ||
            root;

        const text =
            content.conversation ||
            content.extendedTextMessage?.text ||
            root.conversation ||
            root.extendedTextMessage?.text ||
            "";

        const match = text.match(
            /https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?(?:\?[^\s]*)?/i
        );

        if (!match) {
            return await sock.sendMessage(chatId, {
                text: "❌ Send a public Instagram Reel/Post link.\n\nExample:\n.ig https://www.instagram.com/reel/ID/"
            }, { quoted: message });
        }

        url = validateInstagramUrl(match[0].replace(/[),.!]+$/, ""));

        stage = "checking FFmpeg";
        await run("ffmpeg", ["-version"]);
        await run("ffprobe", ["-version"]);

        dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "instagram-"));

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        }).catch(() => {});

        stage = "extracting media with @xazepysk/scrapers";
        log("Starting extraction:", url);

        const scraper = new Scraper();
        let result;

        try {
            result = await scraper.Download.instagram(url);
        } catch (extractError) {
            const details = extractError.message || "";

            if (/401|unauthorized|rate.limit/i.test(details)) {
                throw new Error("Instagram is rate-limiting anonymous requests from this server. Try again later. No cookies or login are used.");
            }
            if (/login|redirect/i.test(details)) {
                throw new Error("Instagram is showing a login wall for this public link. This downloader cannot bypass Instagram's authentication.");
            }
            throw new Error(`Extraction failed: ${details}`);
        }

        if (!result || !result.items || !result.items.length) {
            throw new Error("Extractor finished but no media items were found.");
        }

        stage = "downloading media files";
        const items = result.items.slice(0, MAX_MEDIA);
        let sent = 0;

        for (const item of items) {
            const isImage = item.type === "image";
            const ext = isImage ? "jpg" : "mp4";
            const input = path.join(dir, `media-${sent + 1}.${ext}`);

            // Download media to local file
            const response = await require("axios").get(item.url, {
                responseType: "arraybuffer",
                timeout: 120000,
                maxContentLength: 100 * 1024 * 1024
            });

            await fs.promises.writeFile(input, Buffer.from(response.data));

            if (isImage) {
                stage = "sending image";
                const imageBuffer = await fs.promises.readFile(input);
                if (!imageBuffer.length) throw new Error("Empty image");

                await sock.sendMessage(chatId, {
                    image: imageBuffer,
                    caption: CAPTION
                }, { quoted: message });
                sent++;
                continue;
            }

            // Video conversion
            stage = "converting video to WhatsApp-compatible MP4";
            const output = path.join(dir, `converted-${sent + 1}.mp4`);

            await run("ffmpeg", [
                "-y",
                "-fflags", "+genpts",
                "-i", input,
                "-map", "0:v:0",
                "-map", "0:a:0?",
                "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,setsar=1",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-profile:v", "baseline",
                "-level", "3.1",
                "-pix_fmt", "yuv420p",
                "-r", "30",
                "-fps_mode", "cfr",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ar", "44100",
                "-ac", "2",
                "-max_muxing_queue_size", "2048",
                "-avoid_negative_ts", "make_zero",
                "-movflags", "+faststart",
                "-f", "mp4",
                output
            ]);

            const stat = await fs.promises.stat(output);
            if (!stat.size) throw new Error("FFmpeg produced an empty MP4");

            stage = "sending video";
            if (stat.size <= MAX_VIDEO_SIZE) {
                const buffer = await fs.promises.readFile(output);
                await sock.sendMessage(chatId, {
                    video: buffer,
                    mimetype: "video/mp4",
                    caption: CAPTION
                }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, {
                    document: { url: output },
                    mimetype: "video/mp4",
                    fileName: path.basename(output),
                    caption: CAPTION
                }, { quoted: message });
            }

            sent++;
            log("Successfully sent:", item.filename || `media-${sent}`);
        }

        if (!sent) throw new Error("No media was sent");

        log("SUCCESS:", sent, "media files sent");
        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        }).catch(() => {});

    } catch (error) {
        log("FAILED STAGE:", stage);
        log("ERROR:", error.message);

        const errorMessage = [
            "❌ INSTAGRAM DOWNLOAD FAILED",
            "",
            "Stage: " + stage,
            "Error: " + (error.message || String(error))
        ].filter(Boolean).join("\n");

        await sock.sendMessage(chatId, {
            text: errorMessage.slice(0, 3500)
        }, { quoted: message }).catch(() => {});

        await sock.sendMessage(chatId, {
            react: { text: "❌", key: message.key }
        }).catch(() => {});

    } finally {
        if (dir) {
            await fs.promises.rm(dir, {
                recursive: true,
                force: true
            }).catch(error => log("Cleanup failed:", error.message));
        }
    }
}

module.exports = instagramCommand;
