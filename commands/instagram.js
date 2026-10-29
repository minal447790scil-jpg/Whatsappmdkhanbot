
const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const os = require("os");
const path = require("path");

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
            `URL: ${url || "N/A"}`,
            `Error: ${error.message || String(error)}`,
            error.code ? `Code: ${error.code}` : "",
            error.stderr ? `Details:\n${error.stderr}` : "",
            `Duration: ${((Date.now() - start) / 1000).toFixed(1)}s`
        ].filter(Boolean).join("\n\n");

        log(details);

        try {
            await sock.sendMessage(chatId, {
                text: details.slice(0, 3500)
            }, { quoted: message });
        } catch (e) {
            log("Could not send error report:", e.message);
        }
    }

    try {
        stage = "extracting URL";

        const root = message.message || {};
        const content =
            root.ephemeralMessage?.message ||
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
            return sock.sendMessage(chatId, {
                text: "❌ Instagram link do.\nExample: .ig https://www.instagram.com/reel/ID/"
            }, { quoted: message });
        }

        url = match[0].replace(/[),.!]+$/, "");

        const parsed = new URL(url);

        if (!["instagram.com", "www.instagram.com", "m.instagram.com"]
            .includes(parsed.hostname.toLowerCase())) {
            throw new Error("Invalid Instagram URL.");
        }

        stage = "creating temporary folder";
        dir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "instagram-")
        );

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        }).catch(() => {});

        stage = "downloading with yt-dlp";

        const options = {
            output: path.join(dir, "%(playlist_index)s-%(id)s.%(ext)s"),
            format: "best[ext=mp4]/best",
            playlistEnd: 10,
            noWarnings: true,
            noProgress: true,
            retries: 2,
            socketTimeout: 30
        };

        // Optional: configure a valid Netscape-format cookies file
        // using the INSTAGRAM_COOKIES environment variable.
        if (process.env.INSTAGRAM_COOKIES) {
            options.cookies = process.env.INSTAGRAM_COOKIES;
        }

        log("Downloading:", url);

        await ytdlp(url, options);

        stage = "reading downloaded files";

        const files = (await fs.promises.readdir(dir))
            .filter(name => /\.(mp4|m4v|mov|webm|jpg|jpeg|png|webp)$/i.test(name))
            .sort();

        if (!files.length) {
            throw new Error("yt-dlp completed but no media files were found.");
        }

        stage = "sending media";

        let sent = 0;

        for (const name of files.slice(0, 10)) {
            const file = path.join(dir, name);
            const buffer = await fs.promises.readFile(file);

            const isImage = /\.(jpg|jpeg|png|webp)$/i.test(name);

            await sock.sendMessage(chatId, isImage
                ? {
                    image: buffer,
                    caption: "✅ DOWNLOADED BY SALMAN"
                }
                : {
                    video: buffer,
                    caption: "✅ DOWNLOADED BY SALMAN"
                }, { quoted: message });

            sent++;
            log("Sent:", name, buffer.length, "bytes");
        }

        log(`SUCCESS: ${sent} item(s)`);

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
