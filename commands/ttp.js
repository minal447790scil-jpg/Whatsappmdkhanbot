const sharp = require("sharp");

// ---------- helpers (attp.js bhi use karta hai) ----------

function escapeXml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function extractInputText(msg, cmd) {
    const m = msg.message || {};
    const body =
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        "";

    // Bot commands ko dot ke saath aur bagair dot dono tarah chalata hai,
    // is liye command word dono surton mein strip karo — warna bagair dot
    // wali surat mein "tts" lafz bhi text mein reh jata aur parha jata tha.
    let text = body.replace(new RegExp("^\\.?" + cmd + "\\b\\s*", "i"), "").trim();

    if (!text) {
        const quoted =
            m.extendedTextMessage?.contextInfo?.quotedMessage;
        text = (
            quoted?.conversation ||
            quoted?.extendedTextMessage?.text ||
            ""
        ).trim();
    }

    return text;
}

function wrapText(text, maxChars) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";

    for (const w of words) {
        if (w.length > maxChars) {
            if (line) { lines.push(line); line = ""; }
            for (let i = 0; i < w.length; i += maxChars) {
                lines.push(w.slice(i, i + maxChars));
            }
            continue;
        }
        if ((line + " " + w).trim().length <= maxChars) {
            line = (line + " " + w).trim();
        } else {
            if (line) lines.push(line);
            line = w;
        }
    }
    if (line) lines.push(line);
    return lines.slice(0, 6);
}

function buildSvg(lines, fill) {
    const maxChars = Math.max(...lines.map(l => l.length), 1);
    let fontSize = Math.min(110, Math.floor(500 / (maxChars * 0.62)));
    fontSize = Math.max(28, Math.min(fontSize, Math.floor(500 / (lines.length * 1.18)) || 28));
    const lineHeight = fontSize * 1.18;
    const totalH = lineHeight * lines.length;
    const startY = (512 - totalH) / 2 + fontSize * 0.85;

    const tspans = lines
        .map((l, i) => `<text x="256" y="${(startY + i * lineHeight).toFixed(1)}" text-anchor="middle" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="bold" font-size="${fontSize}" fill="${fill}" stroke="rgba(0,0,0,0.55)" stroke-width="${Math.max(2, fontSize / 14)}" paint-order="stroke">${escapeXml(l)}</text>`)
        .join("\n");

    return `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">${tspans}</svg>`;
}

async function textToPng(text, fill) {
    const lines = wrapText(text, 12);
    const svg = buildSvg(lines, fill);
    return sharp(Buffer.from(svg)).png().toBuffer();
}

async function textToWebp(text, fill) {
    const lines = wrapText(text, 12);
    const svg = buildSvg(lines, fill);
    return sharp(Buffer.from(svg)).webp({ quality: 95 }).toBuffer();
}

// ---------- .ttp command ----------

module.exports = async function ttpCommand(sock, from, msg) {
    try {
        const text = extractInputText(msg, "ttp");

        if (!text) {
            return await sock.sendMessage(from, {
                text: "❌ Text likho.\n\nExample:\n.ttp SALMAN KHAN\n\nYa kisi text message par reply karke .ttp likho."
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

        const webp = await textToWebp(text, "#ffffff");

        await sock.sendMessage(from, { sticker: webp }, { quoted: msg });

        await sock.sendMessage(from, {
            react: { text: "✅", key: msg.key }
        }).catch(() => {});

    } catch (e) {
        console.error("[TTP] ERROR:", e);
        await sock.sendMessage(from, {
            text: "❌ Sticker nahi ban saka: " + (e.message || String(e))
        }, { quoted: msg }).catch(() => {});
    }
};

module.exports.helpers = { extractInputText, textToPng, textToWebp, wrapText };
