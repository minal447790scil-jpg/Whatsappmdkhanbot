const {
    downloadMediaMessage
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const ffmpegStaticPath = require("ffmpeg-static");
const ffmpegPath = ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)
    ? ffmpegStaticPath
    : "ffmpeg";

const MAX_VIDEO_BYTES = 64 * 1024 * 1024; // 64 MB

function convertToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        execFile(
            ffmpegPath,
            [
                "-y",
                "-i", inputPath,
                "-vn",
                "-codec:a", "libmp3lame",
                "-q:a", "2",
                outputPath
            ],
            { timeout: 180000, maxBuffer: 1024 * 1024 * 16 },
            (err, stdout, stderr) => {
                if (err) return reject(new Error("FFmpeg conversion failed: " + (stderr || err.message)));
                resolve();
            }
        );
    });
}

module.exports = async function toaudioCommand(sock, from, msg) {
    let tmpDir = null;

    try {
        // Do surtein: (1) kisi video par reply karke .toaudio
        //              (2) video ke saath caption mein .toaudio
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const ownVideo = msg.message?.videoMessage;

        let mediaMsg = null;
        let mediaKey = null;

        if (ctx?.quotedMessage?.videoMessage) {
            mediaMsg = ctx.quotedMessage;
            mediaKey = ctx.stanzaId;
        } else if (ownVideo) {
            mediaMsg = msg.message;
            mediaKey = msg.key?.id;
        }

        if (!mediaMsg) {
            return await sock.sendMessage(from, {
                text: "❌ Kisi video par reply karke .toaudio likho.\n\nExample: video par reply → .toaudio"
            }, { quoted: msg });
        }

        await sock.sendMessage(from, {
            react: { text: "⏳", key: msg.key }
        }).catch(() => {});

        const buffer = await downloadMediaMessage(
            {
                message: mediaMsg,
                key: mediaKey
            },
            "buffer",
            {},
            {
                logger: sock.logger,
                reuploadRequest: sock.updateMediaMessage
            }
        );

        if (!buffer || !buffer.length) {
            throw new Error("Video download nahi ho saki, dobara try karo.");
        }

        if (buffer.length > MAX_VIDEO_BYTES) {
            throw new Error("Video bohot bari hai (64 MB se zyada) — chhoti video par try karo.");
        }

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toaudio-"));
        const inputPath = path.join(tmpDir, "input.mp4");
        const outputPath = path.join(tmpDir, "output.mp3");

        fs.writeFileSync(inputPath, buffer);
        await convertToMp3(inputPath, outputPath);

        const audioBuffer = fs.readFileSync(outputPath);

        if (!audioBuffer.length) {
            throw new Error("Conversion ke baad audio khaali aaya.");
        }

        await sock.sendMessage(from, {
            audio: audioBuffer,
            mimetype: "audio/mpeg"
        }, { quoted: msg });

        await sock.sendMessage(from, {
            react: { text: "✅", key: msg.key }
        }).catch(() => {});

    } catch (e) {
        console.error("[TOAUDIO] ERROR:", e);

        await sock.sendMessage(from, {
            react: { text: "❌", key: msg.key }
        }).catch(() => {});

        await sock.sendMessage(from, {
            text: "❌ Video ko audio mein convert nahi kar saka.\n" + (e.message || String(e))
        }, { quoted: msg }).catch(() => {});

    } finally {
        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    }
};
