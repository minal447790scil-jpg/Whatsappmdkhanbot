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

async function getProbe(file) {
    const { stdout } = await run("ffprobe", [
        "-v", "error",
        "-show_entries",
        "stream=codec_type,codec_name,width,height,pix_fmt",
        "-show_entries", "format=duration",
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

        if (process.env.INSTAGRAM_COOKIES) {
            options.cookies = process.env.INSTAGRAM_COOKIES;
        }

        log("Downloading:", url);
        await ytdlp(url, options);

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
                if (!imageBuffer.length) throw new Error("Empty image: " + name);

                await sock.sendMessage(chatId, {
                    image: imageBuffer,
                    caption: CAPTION
                }, { quoted: message });

                sent++;
                continue;
            }

            // Inspect input first: some Instagram files contain video only,
            // with no audio stream. Do not pass audio encoder options in that case.
            stage = "inspecting downloaded video";
            const inputProbe = await getProbe(input);
            const inputVideo = inputProbe.streams?.find(
                stream => stream.codec_type === "video"
            );
            const hasAudio = inputProbe.streams?.some(
                stream => stream.codec_type === "audio"
            );

            if (!inputVideo) {
                throw new Error("Downloaded file has no video stream: " + name);
            }

            const output = path.join(dir, `converted-${sent + 1}.mp4`);

            stage = hasAudio
                ? "converting video and audio to MP4"
                : "converting silent video to MP4";

            const ffmpegArgs = [
                "-y",
                "-hide_banner",
                "-i", input,
                "-map", "0:v:0"
            ];

            if (hasAudio) {
                ffmpegArgs.push(
                    "-map", "0:a:0",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    "-ac", "2"
                );
            } else {
                ffmpegArgs.push("-an");
            }

            ffmpegArgs.push(
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "24",
                "-pix_fmt", "yuv420p",
                "-threads", "2",
                "-movflags", "+faststart",
                output
            );

            try {
                await run("ffmpeg", ffmpegArgs);
            } catch (ffmpegError) {
                log("FFMPEG EXIT CODE:", ffmpegError.code);
                log("FFMPEG SIGNAL:", ffmpegError.signal);
                log("FFMPEG STDERR TAIL:",
                    String(ffmpegError.stderr || "").slice(-8000));
                throw new Error(
                    "FFmpeg conversion failed. Exit=" +
                    (ffmpegError.code ?? "unknown") +
                    ", signal=" + (ffmpegError.signal || "none") +
                    ". Check Railway logs for FFMPEG STDERR TAIL."
                );
            }

            stage = "validating converted video";

            const stat = await fs.promises.stat(output);
            if (!stat.size) throw new Error("Converted video is empty");

            const outputProbe = await getProbe(output);
            const outputVideo = outputProbe.streams?.find(
                stream => stream.codec_type === "video"
            );

            if (
                !outputVideo ||
                outputVideo.codec_name !== "h264" ||
                outputVideo.pix_fmt !== "yuv420p"
            ) {
                throw new Error("Converted output is not valid H.264/yuv420p MP4");
            }

            log("Validated:", {
                file: name,
                bytes: stat.size,
                duration: outputProbe.format?.duration,
                videoCodec: outputVideo.codec_name,
                hasAudio
            });

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
            log("ERROR STDERR TAIL:", String(error.stderr).slice(-8000));
        }

        const report = [
            "❌ INSTAGRAM DOWNLOAD FAILED",
            "Stage: " + stage,
            "Error: " + (error.message || String(error))
        ].join("\n");

        await sock.sendMessage(chatId, {
            text: report.slice(0, 3000)
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
