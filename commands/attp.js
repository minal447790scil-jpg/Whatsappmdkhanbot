const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const sharp = require("sharp");
const { helpers } = require("./ttp");

const ffmpegStaticPath = require("ffmpeg-static");
const ffmpegPath = ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)
    ? ffmpegStaticPath
    : "ffmpeg";

const RAINBOW = ["#ff004c", "#ff8a00", "#ffee00", "#00e676", "#00b0ff", "#d500f9"];

function makeAnimatedWebp(frameDir) {
    return new Promise((resolve, reject) => {
        execFile(
            ffmpegPath,
            [
                "-y",
                "-framerate", "7",
                "-i", path.join(frameDir, "frame%02d.png"),
                "-c:v", "libwebp",
                "-q:v", "85",
                "-loop", "0",
                "-an",
                path.join(frameDir, "out.webp")
            ],
            { timeout: 60000 },
            (err) => {
                if (err) return reject(err);
                resolve(path.join(frameDir, "out.webp"));
            }
        );
    });
}

module.exports = async function attpCommand(sock, from, msg) {
    let tmpDir = null;

    try {
        const text = helpers.extractInputText(msg, "attp");

        if (!text) {
            return await sock.sendMessage(from, {
                text: "❌ Text likho.\n\nExample:\n.attp SALMAN KHAN\n\nYa kisi text message par reply karke .attp likho."
            }, { quoted: msg });
        }

        if (text.length > 100) {
            return await sock.sendMessage(from, {
                text: "❌ Text bohot lamba hai — 100 characters tak rakho."
            }, { quoted: msg });
        }

        await sock.sendMessage(from, {
            react: { text: "⏳", key: msg.key }
        }).catch(() => {});

        let webp = null;

        try {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attp-"));

            for (let i = 0; i < RAINBOW.length; i++) {
                const png = await helpers.textToPng(text, RAINBOW[i]);
                fs.writeFileSync(
                    path.join(tmpDir, `frame${String(i).padStart(2, "0")}.png`),
                    png
                );
            }

            const outPath = await makeAnimatedWebp(tmpDir);
            webp = fs.readFileSync(outPath);

            // Verify ke waqai animated hai (pages > 1)
            const meta = await sharp(webp).metadata();
            if (!meta.pages || meta.pages < 2) throw new Error("not animated");
        } catch (animErr) {
            console.log("[ATTP] animation failed, static fallback:", animErr.message);
            webp = await helpers.textToWebp(text, "#ffee00");
        }

        await sock.sendMessage(from, { sticker: webp }, { quoted: msg });

        await sock.sendMessage(from, {
            react: { text: "✅", key: msg.key }
        }).catch(() => {});

    } catch (e) {
        console.error("[ATTP] ERROR:", e);
        await sock.sendMessage(from, {
            text: "❌ Sticker nahi ban saka: " + (e.message || String(e))
        }, { quoted: msg }).catch(() => {});
    } finally {
        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    }
};
