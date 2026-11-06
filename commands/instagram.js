
const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");

const execFileAsync = promisify(execFile);

const CAPTION = "✅ DOWNLOADED BY SALMAN";
const MAX_MEDIA = 10;

async function instagramCommand(sock, chatId, message) {
    const start = Date.now();
    let stage = "initialization";
    let url = "";
    let dir;

    const log = (...args) =>
        console.log("[INSTAGRAM]", new Date().toISOString(), ...args);

    async function report(error) {
        const details = [
            "❌ INSTAGRAM DOWNLOAD FAILED",
            `Stage: ${stage}`,
            `Error: ${error.message || String(error)}`,
            error.code ? `Code: ${error.code}` : "",
            error.stderr
                ? `Details:\n${String(error.stderr).slice(-1800)}`
                : "",
            `Duration: ${((Date.now() - start) / 1000).toFixed(1)}s`
        ].filter(Boolean).join("\n\n");

        log(details);

        try {
            await sock.sendMessage(chatId, {
                text: details.slice(0, 3500)
            }, { quoted: message });
        } catch (e) {
            log("Error report failed:", e.message);
        }
    }

    try {
        // 1. Extract Instagram URL
        stage = "extracting URL";

        const root = message.message || {};
        const content =
            root.ephemeralMessage?.message ||
            root.viewOnceMessage?.message ||
            root.viewOnceMessageV2?.message ||
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
            return sock.sendMessage(chatId, {
                text: "❌ Please provide an Instagram Reel/Post link."
            }, { quoted: message });
        }

        url = match[0].replace(/[),.!]+$/, "");

        const parsed = new URL(url);

        if (
            !["instagram.com", "www.instagram.com", "m.instagram.com"]
                .includes(parsed.hostname.toLowerCase())
        ) {
            throw new Error("Invalid Instagram URL.");
        }

        // 2. Check FFmpeg
        stage = "checking FFmpeg";

        await execFileAsync("ffmpeg", ["-version"]);

        // 3. Create temporary directory
        stage = "creating temporary folder";

        dir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "instagram-")
        );

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        }).catch(() => {});

        // 4. Download Instagram media
        stage = "downloading with yt-dlp";

        const options = {
            output: path.join(
                dir,
                "%(autonumber)03d-%(id)s.%(ext)s"
            ),

            // Prefer separate video/audio streams, otherwise best single file
            format: "bestvideo+bestaudio/best",

            mergeOutputFormat: "mp4",

            playlistEnd: MAX_MEDIA,
            noWarnings: true,
            noProgress: true,
            noCheckCertificates: false,
            retries: 5,
            fragmentRetries: 5,
            extractorRetries: 3,
            socketTimeout: 60,
            sleepInterval: 1,
            maxSleepInterval: 3,
            ignoreErrors: false
        };

        // Optional Instagram cookies in Netscape format
        if (process.env.INSTAGRAM_COOKIES) {
            options.cookies = process.env.INSTAGRAM_COOKIES;
        }

        log("Downloading:", url);

        await ytdlp(url, options);

        // 5. Read downloaded files
        stage = "finding downloaded media";

        const files = (await fs.promises.readdir(dir))
            .filter(name =>
                /\.(mp4|m4v|mov|webm|mkv|jpg|jpeg|png|webp)$/i.test(name)
            )
            .sort();

        if (!files.length) {
            throw new Error(
                "No media found. The Reel may be private, restricted or unavailable."
            );
        }

        let sent = 0;

        // 6. Process each downloaded file
        for (const name of files.slice(0, MAX_MEDIA)) {
            const input = path.join(dir, name);
            const isImage = /\.(jpg|jpeg|png|webp)$/i.test(name);

            if (isImage) {
                stage = "sending image";

                await sock.sendMessage(chatId, {
                    image: { url: input },
                    caption: CAPTION
                }, { quoted: message });

                sent++;
                continue;
            }

            // 7. Convert every video to WhatsApp-friendly MP4
            stage = "converting video to H264 MP4";

            const output = path.join(
                dir,
                `fixed-${sent + 1}.mp4`
            );

            await execFileAsync("ffmpeg", [
                "-y",
                "-i", input,
                "-map", "0:v:0",
                "-map", "0:a:0?",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ac", "2",
                "-movflags", "+faststart",
                "-max_muxing_queue_size", "2048",
                output
            ], {
                timeout: 300000,
                maxBuffer: 10 * 1024 * 1024
            });

            // 8. Validate converted file
            stage = "validating MP4";

            const stat = await fs.promises.stat(output);

            if (!stat.size) {
                throw new Error("Converted video is empty.");
            }

            const probe = await execFileAsync("ffprobe", [
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_name,width,height",
                "-of", "json",
                output
            ]);

            const info = JSON.parse(probe.stdout);
            const videoStream = info.streams?.[0];

            if (!videoStream || videoStream.codec_name !== "h264") {
                throw new Error("Invalid video stream after conversion.");
            }

            log(
                "Validated:",
                output,
                stat.size,
                "bytes",
                videoStream
            );

            // 9. Send video using local URL (less RAM usage)
            stage = "sending video";

            try {
                await sock.sendMessage(chatId, {
                    video: { url: output },
                    mimetype: "video/mp4",
                    caption: CAPTION,
                    ptv: false
                }, { quoted: message });

            } catch (sendError) {
                log("Video send failed, trying document:", sendError.message);

                // Fallback: send the MP4 as a document
                await sock.sendMessage(chatId, {
                    document: { url: output },
                    mimetype: "video/mp4",
                    fileName: "Instagram-Video.mp4",
                    caption: CAPTION
                }, { quoted: message });
            }

            sent++;
            log("Successfully sent:", output);
        }

        if (!sent) {
            throw new Error("No media was successfully sent.");
        }

        log(`SUCCESS: ${sent} media item(s)`);

        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        }).catch(() => {});

    } catch (error) {
        await report(error);

        await sock.sendMessage(chatId, {
            react: { text: "❌", key: message.key }
        }).catch(() => {});

    } finally {
        if (dir) {
            await fs.promises.rm(dir, {
                recursive: true,
                force: true
            }).catch(err => log("Cleanup failed:", err.message));
        }
    }
}

module.exports = instagramCommand;
