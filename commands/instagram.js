const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");

const exec = promisify(execFile);

const CAPTION = "✅ DOWNLOADED BY SALMAN";
const MAX_MEDIA = 10;
const MAX_VIDEO_SIZE = 60 * 1024 * 1024;

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

async function instagramCommand(sock, chatId, message) {
    let dir;
    let stage = "initialization";
    let url = "";

    try {
        // Extract URL from the incoming WhatsApp message.
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
            /https?:\/\/(?:www\.|m\.)?instagram\.com\/[^\s]+/i
        );

        if (!match) {
            return await sock.sendMessage(chatId, {
                text: "❌ Send an Instagram Reel/Post link.\n\nExample:\n.ig https://www.instagram.com/reel/ID/"
            }, { quoted: message });
        }

        url = match[0].replace(/[),.!]+$/, "");
        const parsed = new URL(url);

        if (!["instagram.com", "www.instagram.com", "m.instagram.com"]
            .includes(parsed.hostname.toLowerCase())) {
            throw new Error("Invalid Instagram URL");
        }

        // Verify FFmpeg tools are installed in the Railway container.
        stage = "checking FFmpeg and FFprobe";
        await run("ffmpeg", ["-version"]);
        await run("ffprobe", ["-version"]);

        dir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "instagram-")
        );

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        }).catch(() => {});

        // Download media. yt-dlp merges separate audio/video streams when needed.
        stage = "downloading Instagram media";

        const options = {
            output: path.join(dir, "%(autonumber)03d-%(id)s.%(ext)s"),
            format: "bestvideo+bestaudio/best",
            mergeOutputFormat: "mp4",
            playlistEnd: MAX_MEDIA,
            retries: 10,
            fragmentRetries: 10,
            extractorRetries: 5,
            socketTimeout: 120,
            concurrentFragments: 4,
            noWarnings: true,
            noProgress: true,
            ignoreErrors: false
        };


        log("Starting download:", url);
        await ytdlp(url, options);

        // Find downloaded images/videos.
        stage = "finding downloaded files";

        const files = (await fs.promises.readdir(dir))
            .filter(name =>
                /\.(mp4|m4v|mov|webm|mkv|jpg|jpeg|png|webp)$/i.test(name)
            )
            .sort();

        if (!files.length) {
            throw new Error(
                "No media downloaded. Instagram may require login or the content may be unavailable."
            );
        }

        let sent = 0;

        for (const name of files.slice(0, MAX_MEDIA)) {
            const input = path.join(dir, name);
            const isImage = /\.(jpg|jpeg|png|webp)$/i.test(name);

            if (isImage) {
                stage = "sending image";
                const imageBuffer = await fs.promises.readFile(input);

                if (!imageBuffer.length) {
                    throw new Error("Empty image: " + name);
                }

                await sock.sendMessage(chatId, {
                    image: imageBuffer,
                    caption: CAPTION
                }, { quoted: message });

                sent++;
                continue;
            }

            // Convert every video to a WhatsApp-compatible MP4.
            // Do not fall back to the unconverted source: that can produce a
            // message that uploads successfully but cannot play in WhatsApp.
            stage = "converting video to WhatsApp-compatible MP4";

            const output = path.join(dir, `converted-${sent + 1}.mp4`);

            await run("ffmpeg", [
                "-y",
                "-fflags", "+genpts",
                "-i", input,
                "-map", "0:v:0",
                "-map", "0:a:0?",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-profile:v", "baseline",
                "-level", "3.1",
                "-pix_fmt", "yuv420p",
                "-r", "30",
                "-vsync", "cfr",
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
            if (!stat.size) {
                throw new Error("FFmpeg produced an empty MP4");
            }

            const { stdout } = await run("ffprobe", [
                "-v", "error",
                "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt",
                "-show_entries", "format=format_name,duration",
                "-of", "json",
                output
            ]);

            const probe = JSON.parse(stdout);
            const videoStream = probe.streams?.find(
                stream => stream.codec_type === "video"
            );
            const audioStream = probe.streams?.find(
                stream => stream.codec_type === "audio"
            );
            const duration = Number(probe.format?.duration || 0);

            if (!videoStream ||
                videoStream.codec_name !== "h264" ||
                videoStream.pix_fmt !== "yuv420p" ||
                !String(probe.format?.format_name || "").includes("mp4") ||
                !Number.isFinite(duration) ||
                duration <= 0) {
                throw new Error("Converted MP4 failed playback validation");
            }

            if (audioStream && audioStream.codec_name !== "aac") {
                throw new Error("Converted MP4 audio is not AAC");
            }

            const sendFile = output;
            const sendMime = "video/mp4";
            log("WhatsApp-compatible MP4 ready:", name, stat.size, "bytes");
            stage = "sending video";
            const stat = await fs.promises.stat(sendFile);
            if (!stat.size) throw new Error("Video file is empty");

            if (stat.size <= MAX_VIDEO_SIZE) {
                const buffer = await fs.promises.readFile(sendFile);
                await sock.sendMessage(chatId, {
                    video: buffer,
                    mimetype: sendMime,
                    caption: CAPTION
                }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, {
                    document: { url: sendFile },
                    mimetype: sendMime,
                    fileName: path.basename(sendFile),
                    caption: CAPTION
                }, { quoted: message });
            }

            sent++;
            log("Successfully sent:", name);
        }

        if (sent === 0) {
            throw new Error("No media was sent");
        }

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
            error.stderr
                ? "Details:\n" + String(error.stderr).slice(-1500)
                : ""
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
            }).catch(error => {
                log("Cleanup failed:", error.message);
            });
        }
    }
}

module.exports = instagramCommand;
