const axios = require("axios");
const cheerio = require("cheerio");

// WhatsApp par web search — command .google hai, results Bing ke
// index se aate hain (Google khud server IPs ko block kar deta hai,
// Bing ka search page servers par khula milta hai).
// Bing ke links redirect (bing.com/ck/a?u=a1<base64>) hote hain —
// asal URL decode karke dete hain.
function decodeBingUrl(href) {
    try {
        const u = new URL(href);
        if (!u.hostname.includes("bing.com") || !u.pathname.startsWith("/ck/")) {
            return href;
        }
        const enc = u.searchParams.get("u") || "";
        if (enc.startsWith("a1")) {
            const decoded = Buffer.from(enc.slice(2), "base64url").toString("utf8");
            if (/^https?:\/\//i.test(decoded)) return decoded;
        }
    } catch {}
    return href;
}

function parseBing(html, limit = 5) {
    const $ = cheerio.load(html);
    const results = [];

    $("li.b_algo").each((_, el) => {
        if (results.length >= limit) return;

        const a = $(el).find("h2 a").first();
        const title = a.text().trim();
        const rawHref = a.attr("href") || "";
        const snippet =
            $(el).find(".b_caption p").first().text().trim() ||
            $(el).find("p").first().text().trim();

        if (title && /^https?:\/\//i.test(rawHref)) {
            results.push({ title, href: decodeBingUrl(rawHref), snippet });
        }
    });

    return results;
}

async function googleCommand(sock, chatId, message) {
    let statusKey = null;
    const setStatus = async (text) => {
        if (statusKey) {
            await sock.sendMessage(chatId, { text, edit: statusKey }).catch(() => {});
        }
    };

    try {
        const msg =
            message.message?.ephemeralMessage?.message ||
            message.message;

        const text =
            msg?.conversation ||
            msg?.extendedTextMessage?.text ||
            "";

        const query = text
            .replace(/^\.?(google|search|gs)\s+/i, "")
            .trim();

        if (!query) {
            return await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ Kya search karna hai?\n\n" +
                        "Example:\n" +
                        ".google pakistan weather"
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, {
            react: { text: "🔍", key: message.key }
        });

        try {
            const statusMsg = await sock.sendMessage(chatId, {
                text: `🔍 *Searching...*\n${query}`
            }, { quoted: message });
            statusKey = statusMsg.key;
        } catch {}

        const { data: html } = await axios.get("https://www.bing.com/search", {
            params: { q: query },
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9"
            },
            timeout: 20000
        });

        const results = parseBing(html);

        if (!results.length) {
            await setStatus(`❌ *Koi result nahi mila*\n${query}`);
            return;
        }

        const out =
            `🔍 *Search:* ${query}\n\n` +
            results
                .map(
                    (r, i) =>
                        `*${i + 1}. ${r.title}*\n` +
                        (r.snippet ? `${r.snippet}\n` : "") +
                        `🔗 ${r.href}`
                )
                .join("\n\n");

        if (statusKey) {
            await setStatus(out);
        } else {
            await sock.sendMessage(chatId, { text: out }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        });
    } catch (e) {
        console.error("[GOOGLE] ERROR:", e?.message || e);
        await setStatus("❌ *Search failed* — thodi der baad phir try karo.");
    }
}

module.exports = googleCommand;
module.exports.parseBing = parseBing;
