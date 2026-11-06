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
        timeout: 600000,
        maxBuffer: 50 * 1024 * 1024,
        ...options
    });
}

async function probe(file) {
    const { stdout } = await run("ffprobe", [
        "-v", "error",
        "-show_entries",
        "stream=index,codec_type,codec_name,width,height,pix_fmt,sample_rate,channels",
        "-show_entries", "format=duration,size",
        "-of", "json",
        file
    ]);
    return JSON.parse(stdout);
}

async function instagramCommand(sock, chatId, message) {
    let dir;
    let stage = "initialization";
    let url = "";

    try {
        // Extract URL from WhatsApp message, including common wrappers.
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
                text: "❌ Send an Instagram Reel/Post link."
            }, { quoted: message });
        }

        url = match[0].replace(/[),.!]+$/, "");
        const parsed = new URL(url);

        if (!["instagram.com", "www.instagram.com", "m.instagram.com"]
            .includes(parsed.hostname.toLowerCase())) {
            throw new Error("Invalid Instagram URL");
        }

        stage = "checking FFmpeg and FFprobe";
        await run("ffmpeg", ["-version"]);
        await run("ffprobe", ["-version"]);

        dir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "instagram-")
        );

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        }).catch(() => {});

        // Ask yt-dlp for best separate video + audio when available.
        // /best is the fallback for extractors that only expose one combined file.
        stage = "downloading Instagram media";

        const options = {
            output: path.join(dir, "%(autonumber)03d-%(id)s.%(ext)s"),
            format: "bestvideo+bestaudio/best",
            mergeOutputFormat: "mkv",
            playlistEnd: MAX_MEDIA,
            retries: 10,
            fragmentRetries: 10,
            extractorRetries: 5,
            socketTimeout: 120,
            concurrentFragments: 4,
            noWarnings: true,
            noProgress: true,
            ignoreErrors: false,
            keepVideo: false
        };

        if (process.env.INSTAGRAM_COOKIES) {
            options.cookies = process.env.INSTAGRAM_COOKIES;
        }

        log("Downloading:", url);
        await ytdlp(url, options);

        stage = "finding downloaded media";

        const files = (await fs.promises.readdir(dir))
            .filter(name =>
                /\.(mp4|m4v|mov|webm|mkv|jpg|jpeg|png|webp)$/i.test(name) &&
                !name.startsWith("converted-")
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
                const image = await fs.promises.readFile(input);
                if (!image.length) throw new Error("Empty image: " + name);

                await sock.sendMessage(chatId, {
                    image,
                    caption: CAPTION
                }, { quoted: message });

                sent++;
                continue;
            }

            // Inspect source tracks before encoding. Never silently invent audio.
            stage = "inspecting source audio/video";
            const sourceInfo = await probe(input);
            const sourceVideo = sourceInfo.streams?.find(
                s => s.codec_type === "video"
            );
            const sourceAudio = sourceInfo.streams?.find(
                s => s.codec_type === "audio"
            );

            if (!sourceVideo) {
                throw new Error("Downloaded media has no video stream: " + name);
            }

            log("Source streams:", {
                file: name,
                videoCodec: sourceVideo.codec_name,
                audioCodec: sourceAudio?.codec_name || "NO AUDIO STREAM",
                duration: sourceInfo.format?.duration
            });

            const output = path.join(dir, `converted-${sent + 1}.mp4`);

            stage = "converting video while preserving available audio";

            const args = [
                "-y",
                "-hide_banner",
                "-i", input,
                "-map", "0:v:0",
                "-map", "0:a:0?"
            ];

            // Re-encode video to H.264 at a smaller size.
            // Audio is copied when already AAC; otherwise encoded to AAC.
            args.push(
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "28",
                "-maxrate", "1800k",
                "-bufsize", "3600k",
                "-pix_fmt", "yuv420p",
                "-vf", "scale='min(720,iw)':-2"
            );

            if (sourceAudio) {
                if (sourceAudio.codec_name === "aac") {
                    args.push("-c:a", "copy");
                } else {
                    args.push(
                        "-c:a", "aac",
                        "-b:a", "96k",
                        "-ac", "2"
                    );
                }
            } else {
                args.push("-an");
            }

            args.push(
                "-movflags", "+faststart",
                output
            );

            try {
                await run("ffmpeg", args);
            } catch (e) {
                log("FFMPEG EXIT:", e.code, "SIGNAL:", e.signal);
                log("FFMPEG STDERR:", String(e.stderr || "").slice(-10000));
                throw new Error(
                    "FFmpeg conversion failed. Check Railway logs for FFMPEG STDERR."
                );
            }

            stage = "validating converted media";

            const outputStat = await fs.promises.stat(output);
            if (!outputStat.size) throw new Error("Converted MP4 is empty");

            const outputInfo = await probe(output);
            const outputVideo = outputInfo.streams?.find(
                s => s.codec_type === "video"
            );
            const outputAudio = outputInfo.streams?.find(
                s => s.codec_type === "audio"
            );

            if (!outputVideo || outputVideo.codec_name !== "h264") {
                throw new Error("Output H.264 video validation failed");
            }

            if (sourceAudio && !outputAudio) {
                throw new Error(
                    "Source had audio but converted MP4 has no audio. Refusing to send silent output."
                );
            }

            log("Output validated:", {
                bytes: outputStat.size,
                duration: outputInfo.format?.duration,
                video: outputVideo.codec_name,
                audio: outputAudio?.codec_name || "silent source"
            });

            stage = "sending video";

            if (outputStat.size <= MAX_VIDEO_SIZE) {
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
                    fileName: "Instagram-Video.mp4",
                    caption: CAPTION
                }, { quoted: message });
            }

            sent++;
            log("Sent:", name);
        }

        if (!sent) throw new Error("No media was successfully sent");

        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        }).catch(() => {});

        log("SUCCESS:", sent, "media item(s)");

    } catch (error) {
        log("FAILED STAGE:", stage);
        log("ERROR:", error.message);
        if (error.stderr) {
            log("STDERR:", String(error.stderr).slice(-10000));
        }

        await sock.sendMessage(chatId, {
            text: [
                "❌ INSTAGRAM DOWNLOAD FAILED",
                "Stage: " + stage,
                "Error: " + (error.message || String(error))
            ].join("\n").slice(0, 3000)
        }, { quoted: message }).catch(() => {});

        await sock.sendMessage(chatId, {
            react: { text: "❌", key: message.key }
        }).catch(() => {});

    } finally {
        if (dir) {
            await fs.promises.rm(dir, {
                recursive: true,
                force: true
            }).catch(e => log("Cleanup failed:", e.message));
        }
    }
}

module.exports = instagramCommand;
