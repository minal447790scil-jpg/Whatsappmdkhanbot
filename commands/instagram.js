const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");

const exec = promisify(execFile);

// Instagram currently blocks many anonymous requests without a browser TLS fingerprint.
// Install yt-dlp with curl-cffi once per Railway container, then use Chrome impersonation.
let ytDlpReady = null;

async function ensureYtDlp() {
    if (!ytDlpReady) {
        ytDlpReady = (async () => {
            const pythonCandidates = ["python3", "python"];
            let python = null;

            for (const candidate of pythonCandidates) {
                try {
                    await run(candidate, ["--version"], { timeout: 15000 });
                    python = candidate;
                    break;
                } catch (_) {}
            }

            if (!python) {
                throw new Error(
                    "Python 3 is required for cookie-free Instagram browser impersonation. " +
                    "Install Python 3 in the Railway image; see README."
                );
            }

            const installArgs = [
                "-m", "pip", "install", "--user",
                "--break-system-packages",
                "--upgrade", "yt-dlp[default,curl-cffi]"
            ];

            try {
                await run(python, installArgs, { timeout: 600000 });
            } catch (error) {
                const detail = String(error.stderr || error.message || error).slice(-1200);
                throw new Error("Could not install yt-dlp/curl-cffi in Railway: " + detail);
            }

            await run(python, ["-m", "yt_dlp", "--version"], { timeout: 30000 });
            return python;
        })().catch(error => {
            ytDlpReady = null;
            throw error;
        });
    }

    return ytDlpReady;
}

async function downloadInstagram(url, outputTemplate) {
    const python = await ensureYtDlp();

    const args = [
        "-m", "yt_dlp",
        "--ignore-config",
        "--no-warnings",
        "--no-progress",
        "--format", "bestvideo+bestaudio/best",
        "--merge-output-format", "mp4",
        "--output", outputTemplate,
        "--playlist-end", String(MAX_MEDIA),
        "--retries", "10",
        "--fragment-retries", "10",
        "--extractor-retries", "5",
        "--socket-timeout", "120",
        "--concurrent-fragments", "4",
        "--impersonate", "chrome",
        url
    ];

    return run(python, args, { timeout: 900000 });
}

const CAPTION = "✅ DOWNLOADED BY SALMAN";
const MAX_MEDIA = 10;
const MAX_VIDEO_SIZE = 60 * 1024 * 1024;

function log(...args) {
    console.log("[INSTAGRAM]", new Date().toISOString(), ...args);
}

async function run(command, args, options = {}) {
    return exec(command, args, {
        timeout: 600000,
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

        const outputTemplate = path.join(dir, "%(autonumber)03d-%(id)s.%(ext)s");

        log("Starting direct Instagram download with yt-dlp + curl-cffi impersonation:", url);
        await downloadInstagram(url, outputTemplate);

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

            // Convert VP9/large/high-FPS Instagram sources to WhatsApp-friendly H.264.
            // Use a fast first pass and a lower-resolution fallback for memory/CPU-limited hosts.
            stage = "converting video to WhatsApp-compatible MP4";

            const output = path.join(dir, `converted-${sent + 1}.mp4`);

            const conversionProfiles = [
                {
                    label: "720p/30fps",
                    vf: "scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
                    fps: "30",
                    crf: "27"
                },
                {
                    label: "480p/24fps fallback",
                    vf: "scale=480:854:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
                    fps: "24",
                    crf: "30"
                }
            ];

            let conversionError = null;
            for (const profile of conversionProfiles) {
                try {
                    await run("ffmpeg", [
                        "-y",
                        "-hide_banner",
                        "-loglevel", "error",
                        "-fflags", "+genpts",
                        "-i", input,
                        "-map", "0:v:0",
                        "-map", "0:a:0?",
                        "-vf", profile.vf,
                        "-c:v", "libx264",
                        "-preset", "ultrafast",
                        "-tune", "fastdecode",
                        "-crf", profile.crf,
                        "-profile:v", "baseline",
                        "-pix_fmt", "yuv420p",
                        "-r", profile.fps,
                        "-threads", "2",
                        "-c:a", "aac",
                        "-b:a", "96k",
                        "-ar", "44100",
                        "-ac", "2",
                        "-max_muxing_queue_size", "2048",
                        "-avoid_negative_ts", "make_zero",
                        "-movflags", "+faststart",
                        "-f", "mp4",
                        output
                    ], { timeout: 600000 });

                    const convertedStat = await fs.promises.stat(output);
                    if (convertedStat.size > 0) {
                        log("Conversion completed using", profile.label);
                        conversionError = null;
                        break;
                    }
                    throw new Error("FFmpeg produced an empty MP4");
                } catch (err) {
                    conversionError = err;
                    log("Conversion profile failed:", profile.label,
                        String(err.stderr || err.message || err).slice(-1200));
                    await fs.promises.rm(output, { force: true }).catch(() => {});
                }
            }

            if (conversionError) {
                const details = String(conversionError.stderr || conversionError.message || conversionError);
                throw new Error("FFmpeg conversion failed on both 720p and 480p profiles: " + details.slice(-1800));
            }

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
            const sendStat = await fs.promises.stat(sendFile);
            if (!sendStat.size) throw new Error("Video file is empty");

            if (sendStat.size <= MAX_VIDEO_SIZE) {
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

        const combinedError = `${error.message || ""} ${error.stderr || ""}`.toLowerCase();
        const isAnonymousRateLimit =
            combinedError.includes("exceeded the rate-limit") ||
            combinedError.includes("redirected to the login page") ||
            combinedError.includes("use --cookies") ||
            combinedError.includes("login required") ||
            combinedError.includes("exceeded the rate-limit") ||
            combinedError.includes("redirected to the login page");

        const errorMessage = [
            "❌ INSTAGRAM DOWNLOAD FAILED",
            ...(isAnonymousRateLimit ? [
                "",
                "Instagram is blocking anonymous access from this server (rate limit/login required).",
                "This version does not use cookies, login, API keys, or paid APIs.",
                "A public-link-only download cannot be guaranteed while Instagram blocks the server."
            ] : []),
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
