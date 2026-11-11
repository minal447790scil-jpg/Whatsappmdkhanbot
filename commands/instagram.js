const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");

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

        stage = "checking downloader and FFmpeg";
        await run("parth-dl", ["--version"]);
        await run("ffmpeg", ["-version"]);
        await run("ffprobe", ["-version"]);

        dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "instagram-"));

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        }).catch(() => {});

        stage = "downloading public Instagram media with parth-dl";
        log("Starting parth-dl download:", url);

        try {
            const result = await run("parth-dl", [
                url,
                "--paths", dir,
                "--force"
            ], { timeout: 300000 });
            log("parth-dl output:", (result.stdout || "").slice(-2000));
        } catch (downloadError) {
            const details = [
                downloadError.message || "",
                downloadError.stderr || "",
                downloadError.stdout || ""
            ].join("\n");

            if (/rate.limit|rate limited|429/i.test(details)) {
                throw new Error("Instagram is rate-limiting anonymous requests from this server. Try again later; no cookies or login are used.");
            }
            if (/login wall|login required|redirected to the login/i.test(details)) {
                throw new Error("Instagram is showing a login wall for this public link. parth-dl cannot download links Instagram restricts to logged-in users.");
            }
            throw new Error(`parth-dl download failed: ${details.slice(-1800) || "No error details returned"}`);
        }

        stage = "finding downloaded files";
        const allowedExtensions = /\.(mp4|m4v|mov|webm|mkv|jpg|jpeg|png|webp)$/i;
        const files = (await fs.promises.readdir(dir))
            .filter(name => allowedExtensions.test(name))
            .sort()
            .slice(0, MAX_MEDIA);

        if (!files.length) {
            throw new Error("Downloader finished but no media files were found.");
        }

        let sent = 0;

        for (const name of files) {
            const input = path.join(dir, name);
            const isImage = /\.(jpg|jpeg|png|webp)$/i.test(name);

            if (isImage) {
                stage = "sending image";
                const imageBuffer = await fs.promises.readFile(input);
                if (!imageBuffer.length) throw new Error("Empty image: " + name);

                await sock.sendMessage(chatId, {
                    image: imageBuffer,
                    caption: CAPTION
                }, { quoted: message });
                sent++;
                continue;
            }

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

            const { stdout } = await run("ffprobe", [
                "-v", "error",
                "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt",
                "-show_entries", "format=format_name,duration",
                "-of", "json",
                output
            ]);

            const probe = JSON.parse(stdout);
            const videoStream = probe.streams?.find(stream => stream.codec_type === "video");
            const audioStream = probe.streams?.find(stream => stream.codec_type === "audio");
            const duration = Number(probe.format?.duration || 0);

            if (!videoStream || videoStream.codec_name !== "h264" ||
                videoStream.pix_fmt !== "yuv420p" ||
                !String(probe.format?.format_name || "").includes("mp4") ||
                !Number.isFinite(duration) || duration <= 0) {
                throw new Error("Converted MP4 failed playback validation");
            }
            if (audioStream && audioStream.codec_name !== "aac") {
                throw new Error("Converted MP4 audio is not AAC");
            }

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
            log("Successfully sent:", name);
        }

        if (!sent) throw new Error("No media was sent");

        log("SUCCESS:", sent, "media files sent");
        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        }).catch(() => {});

    } catch (error) {
        log("FAILED STAGE:", stage);
        log("ERROR:", error.message);
        log("STDERR:", error.stderr || "N/A");

        const errorMessage = [
            "❌ INSTAGRAM DOWNLOAD FAILED",
            "",
            "Stage: " + stage,
            "Error: " + (error.message || String(error)),
            error.stderr ? "Details:\n" + String(error.stderr).slice(-1200) : ""
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
