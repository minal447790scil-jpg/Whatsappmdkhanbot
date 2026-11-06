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
        maxBuffer: 30 * 1024 * 1024,
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

async function sendVideo(sock, chatId, message, file, caption) {
    const stat = await fs.promises.stat(file);
    if (!stat.size) throw new Error("Video file is empty");

    if (stat.size <= MAX_VIDEO_SIZE) {
        const buffer = await fs.promises.readFile(file);
        await sock.sendMessage(chatId, {
            video: buffer,
            mimetype: "video/mp4",
            caption
        }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, {
            document: { url: file },
            mimetype: "video/mp4",
            fileName: "Instagram-Video.mp4",
            caption
        }, { quoted: message });
    }
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

        stage = "checking FFmpeg";
        await run("ffmpeg", ["-version"]);
        await run("ffprobe", ["-version"]);

        dir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "instagram-")
        );

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        }).catch(() => {});

        // IMPORTANT: Prefer a format that contains BOTH video and audio.
        // If no combined format exists, request best video + best audio.
        // There is deliberately no silent-video fallback.
        stage = "downloading audio-and-video format";

        const options = {
            output: path.join(dir, "%(autonumber)03d-%(id)s.%(ext)s"),
            format: "best[acodec!=none][vcodec!=none]/bestvideo*+bestaudio",
            formatSort: ["hasaud", "res", "vcodec:h264", "acodec:m4a"],
            mergeOutputFormat: "mkv",
            playlistEnd: MAX_MEDIA,
            retries: 8,
            fragmentRetries: 8,
            extractorRetries: 4,
            socketTimeout: 90,
            concurrentFragments: 2,
            noWarnings: true,
            noProgress: true,
            ignoreErrors: false
        };

        if (process.env.INSTAGRAM_COOKIES) {
            options.cookies = process.env.INSTAGRAM_COOKIES;
        }

        log("Downloading with required audio:", url);
        await ytdlp(url, options);

        stage = "finding downloaded files";

        const files = (await fs.promises.readdir(dir))
            .filter(name =>
                /\.(mp4|m4v|mov|webm|mkv|jpg|jpeg|png|webp)$/i.test(name) &&
                !name.startsWith("converted-")
            )
            .sort();

        if (!files.length) {
            throw new Error(
                "No audio/video media downloaded. Instagram may require login or provide no compatible audio format."
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

            stage = "checking source audio";
            const sourceInfo = await probe(input);
            const sourceVideo = sourceInfo.streams?.find(
                s => s.codec_type === "video"
            );
            const sourceAudio = sourceInfo.streams?.find(
                s => s.codec_type === "audio"
            );

            log("Source streams:", {
                file: name,
                video: sourceVideo?.codec_name || "missing",
                audio: sourceAudio?.codec_name || "missing",
                duration: sourceInfo.format?.duration
            });

            if (!sourceVideo) {
                throw new Error("Downloaded file has no video stream: " + name);
            }

            // Do not send a silent clip when the user expects sound.
            if (!sourceAudio) {
                throw new Error(
                    "Instagram/yt-dlp returned a video-only file (no audio stream). Refusing to send a silent video. Check format availability/cookies and update yt-dlp."
                );
            }

            const converted = path.join(dir, `converted-${sent + 1}.mp4`);
            stage = "converting video with audio";

            const ffmpegArgs = [
                "-y",
                "-hide_banner",
                "-i", input,
                "-map", "0:v:0",
                "-map", "0:a:0",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "27",
                "-vf", "scale='min(720,iw)':-2",
                "-pix_fmt", "yuv420p",
                "-threads", "2",
                "-c:a", "aac",
                "-b:a", "96k",
                "-ac", "2",
                "-movflags", "+faststart",
                converted
            ];

            let sendFile = input;
            let conversionSucceeded = false;

            try {
                await run("ffmpeg", ffmpegArgs);

                const convertedStat = await fs.promises.stat(converted);
                const convertedInfo = await probe(converted);
                const convertedVideo = convertedInfo.streams?.find(
                    s => s.codec_type === "video"
                );
                const convertedAudio = convertedInfo.streams?.find(
                    s => s.codec_type === "audio"
                );

                if (!convertedStat.size || !convertedVideo ||
                    convertedVideo.codec_name !== "h264" || !convertedAudio) {
                    throw new Error("Converted file failed video/audio validation");
                }

                sendFile = converted;
                conversionSucceeded = true;

                log("Compressed output:", {
                    originalBytes: (await fs.promises.stat(input)).size,
                    convertedBytes: convertedStat.size,
                    audioCodec: convertedAudio.codec_name
                });

            } catch (conversionError) {
                log("FFMPEG CONVERSION FAILED; FALLING BACK TO ORIGINAL WITH AUDIO");
                log("FFMPEG EXIT:", conversionError.code);
                log("FFMPEG SIGNAL:", conversionError.signal);
                log("FFMPEG STDERR:", String(
                    conversionError.stderr || conversionError.message
                ).slice(-8000));

                // Original source has already been verified to contain audio.
                // Send it instead of losing the download.
                sendFile = input;
            }

            stage = conversionSucceeded
                ? "sending compressed video with audio"
                : "sending original video with audio";

            await sendVideo(sock, chatId, message, sendFile, CAPTION);

            sent++;
            log("Sent:", name, conversionSucceeded ? "compressed" : "original");
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
            log("STDERR:", String(error.stderr).slice(-8000));
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
            }).catch(error => log("Cleanup failed:", error.message));
        }
    }
}

module.exports = instagramCommand;
