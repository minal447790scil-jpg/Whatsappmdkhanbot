const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { helpers } = require("./ttp");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

const ffmpegStaticPath = require("ffmpeg-static");
const ffmpegPath = ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)
    ? ffmpegStaticPath
    : "ffmpeg";

// Natural neural voices (Microsoft Edge Read Aloud)
const VOICES = {
    ur: "ur-PK-UzmaNeural",
    en: "en-US-AriaNeural"
};

function splitChunks(text, max) {
    const chunks = [];
    let rest = text.trim();

    while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut < 40) cut = max;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
    return chunks;
}

// --- Engine 1: Microsoft Edge neural TTS (natural voice) ---
async function synthEdgeChunk(text, voice) {
    const tts = new MsEdgeTTS();
    try {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text);
        const chunks = [];

        await Promise.race([
            new Promise((resolve, reject) => {
                audioStream.on("data", (c) => chunks.push(c));
                audioStream.on("end", resolve);
                audioStream.on("error", reject);
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Edge TTS timeout")), 30000)
            )
        ]);

        const buf = Buffer.concat(chunks);
        if (!buf.length) throw new Error("Edge TTS empty audio");
        return buf;
    } finally {
        try { tts.close(); } catch (_) {}
    }
}

async function synthEdge(text, lang) {
    const voice = VOICES[lang] || VOICES.en;
    const parts = [];
    for (const chunk of splitChunks(text, 350)) {
        parts.push(await synthEdgeChunk(chunk, voice));
    }
    return Buffer.concat(parts);
}

// --- Engine 2: Google Translate TTS (fallback, robotic magar reliable) ---
async function fetchGoogleMp3(text, lang) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"
        }
    });
    if (!res.ok) throw new Error("Google TTS error: HTTP " + res.status);
    return Buffer.from(await res.arrayBuffer());
}

async function synthGoogle(text, lang) {
    const parts = [];
    for (const chunk of splitChunks(text, 180)) {
        parts.push(await fetchGoogleMp3(chunk, lang));
    }
    return Buffer.concat(parts);
}

function toOpus(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        execFile(
            ffmpegPath,
            ["-y", "-i", inputPath, "-vn", "-c:a", "libopus", "-b:a", "64k", outputPath],
            { timeout: 60000 },
            (err) => (err ? reject(err) : resolve())
        );
    });
}

module.exports = async function ttsCommand(sock, from, msg) {
    let tmpDir = null;

    try {
        const text = helpers.extractInputText(msg, "tts");

        if (!text) {
            return await sock.sendMessage(from, {
                text: "❌ Jo bolna hai wo likho.\n\nExample:\n.tts Assalam o Alaikum\n.tts Hello, how are you?"
            }, { quoted: msg });
        }

        if (text.length > 600) {
            return await sock.sendMessage(from, {
                text: "❌ Text bohot lamba hai — 600 characters tak rakho."
            }, { quoted: msg });
        }

        await sock.sendMessage(from, {
            react: { text: "⏳", key: msg.key }
        }).catch(() => {});

        // Urdu script ho to Urdu voice, warna English
        const lang = /[\u0600-\u06FF]/.test(text) ? "ur" : "en";

        // Pehle natural neural voice (Edge), fail ho to Google fallback
        let mp3 = null;
        try {
            mp3 = await synthEdge(text, lang);
            console.log("[TTS] engine: edge-neural (" + (VOICES[lang] || VOICES.en) + ")");
        } catch (edgeErr) {
            console.log("[TTS] Edge fail, Google fallback:", edgeErr.message);
            mp3 = await synthGoogle(text, lang);
            console.log("[TTS] engine: google-fallback");
        }

        // Voice note ke liye opus mein convert (fail ho to mp3 hi bhej do)
        let audio = mp3;
        let mimetype = "audio/mpeg";

        try {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-"));
            const inPath = path.join(tmpDir, "in.mp3");
            const outPath = path.join(tmpDir, "out.ogg");
            fs.writeFileSync(inPath, mp3);
            await toOpus(inPath, outPath);
            audio = fs.readFileSync(outPath);
            mimetype = "audio/ogg; codecs=opus";
        } catch (convErr) {
            console.log("[TTS] opus conversion failed, mp3 bhej raha hoon:", convErr.message);
        }

        await sock.sendMessage(from, {
            audio,
            mimetype,
            ptt: true
        }, { quoted: msg });

        await sock.sendMessage(from, {
            react: { text: "✅", key: msg.key }
        }).catch(() => {});

    } catch (e) {
        console.error("[TTS] ERROR:", e);

        await sock.sendMessage(from, {
            react: { text: "❌", key: msg.key }
        }).catch(() => {});

        await sock.sendMessage(from, {
            text: "❌ Voice note nahi ban saka: " + (e.message || String(e))
        }, { quoted: msg }).catch(() => {});
    } finally {
        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    }
};
