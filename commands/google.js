const axios = require("axios");
const cheerio = require("cheerio");

const UA_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
};

// WhatsApp par web search — command .google hai, peeche Bing ka
// index chalta hai (Google khud server IPs ko block kar deta hai).
// User ka matlab: links ki list NAHI — jo search kare, usi ka
// result udhar hi chat mein aaye:
//  - pics wali search  -> tasaveer seedha chat mein
//  - aam sawal         -> jawab (answer box / behtareen snippet)

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

// Bing ka answer box (weather, calculator, definitions waghera)
function extractAnswer(html) {
    const $ = cheerio.load(html);
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

    const xl = clean($(".b_ans .b_xlText").first().text());
    if (xl.length > 30) return xl.slice(0, 700);

    const focus = clean($(".b_focusText").first().text());
    if (focus.length > 30) return focus.slice(0, 700);

    const ans = clean($(".b_ans").first().text());
    if (ans.length > 60) return ans.slice(0, 700);

    return "";
}

// Wikipedia search: sawal ka asal jawab aksar yahin milta hai
// (Bing kabhi kabhi bilkul irrelevant results de deta hai).
// Disambiguation pages skip karte hain.
async function wikiAnswer(query) {
    const { data } = await axios.get("https://en.wikipedia.org/w/api.php", {
        params: {
            action: "query",
            generator: "search",
            gsrsearch: query,
            gsrlimit: 3,
            prop: "extracts|pageprops",
            exintro: 1,
            explaintext: 1,
            exsentences: 3,
            ppprop: "disambiguation",
            format: "json"
        },
        headers: { "User-Agent": "SalmanBot/1.0" },
        timeout: 12000
    });

    const pages = Object.values(data?.query?.pages || {}).sort(
        (a, b) => (a.index || 0) - (b.index || 0)
    );

    for (const p of pages) {
        if (p.pageprops && "disambiguation" in p.pageprops) continue;
        const ex = (p.extract || "").replace(/\s+/g, " ").trim();
        if (ex.length >= 40) {
            return {
                title: p.title,
                text: ex.slice(0, 500),
                url:
                    "https://en.wikipedia.org/wiki/" +
                    encodeURIComponent(p.title.replace(/ /g, "_"))
            };
        }
    }
    return null;
}

// Result ko sawal se kitna match hai — is score par jawab chunte
// hain taake ad/fazool results jawab na ban jayein.
const STOP_WORDS = new Set([
    "the", "a", "an", "of", "is", "in", "on", "to", "for", "and", "or",
    "what", "who", "how", "why", "when", "where", "which",
    "ka", "ki", "ke", "mein", "hai", "kya", "ko", "se"
]);

function relevanceScore(result, query) {
    const terms = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    const hay = (result.title + " " + (result.snippet || "")).toLowerCase();
    return terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
}

function pickAnswerResult(results, query) {
    return results.reduce((best, r) => {
        const sb = relevanceScore(best, query);
        const sr = relevanceScore(r, query);
        if (sr > sb) return r;
        if (
            sr === sb &&
            (r.snippet || "").length > (best.snippet || "").length
        ) {
            return r;
        }
        return best;
    });
}

// Bing Images ke results: page mein murl (asal image URL) hota hai
function parseImageResults(html, limit = 5) {
    const out = [];
    const seen = new Set();
    const re = /murl&quot;:&quot;((?:[^&]|&amp;)+)&quot;/g;
    let m;
    while ((m = re.exec(html)) !== null && out.length < limit) {
        const url = m[1].replace(/&amp;/g, "&");
        if (/^https?:\/\//i.test(url) && !seen.has(url)) {
            seen.add(url);
            out.push(url);
        }
    }
    return out;
}

const IMAGE_INTENT =
    /\b(pic|pics|picture|pictures|photo|photos|image|images|img|wallpaper|wallpapers|poster|posters|logo|dp|tasveer|tasaveer|tasvir)\b/i;

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
                        "Examples:\n" +
                        ".google car pics  (tasaveer aayengi)\n" +
                        ".google pakistan weather  (jawab aayega)"
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

        // ---------- pics wali search: tasaveer chat mein ----------
        if (IMAGE_INTENT.test(query)) {
            const { data: html } = await axios.get(
                "https://www.bing.com/images/search",
                {
                    params: { q: query },
                    headers: UA_HEADERS,
                    timeout: 20000
                }
            );

            const images = parseImageResults(html, 5);

            if (!images.length) {
                await setStatus(`❌ *Koi tasveer nahi mili*\n${query}`);
                return;
            }

            await setStatus(`📤 *Bhej raha hoon...* ${images.length} pics`);

            let sent = 0;
            for (const url of images) {
                try {
                    // Koi caption nahi — saaf chat, sirf tasaveer
                    await sock.sendMessage(
                        chatId,
                        { image: { url } },
                        { quoted: sent === 0 ? message : undefined }
                    );
                    sent++;
                } catch (e) {
                    console.error("[GOOGLE] image send fail:", e?.message || e);
                }
            }

            if (!sent) {
                await setStatus("❌ *Tasaveer bhejni fail ho gayin*");
                return;
            }

            await sock.sendMessage(chatId, {
                react: { text: "✅", key: message.key }
            });
            await setStatus(`✅ *${query}*\n${sent} pics bhej di`);
            return;
        }

        // ---------- aam sawal: jawab ----------
        const { data: html } = await axios.get("https://www.bing.com/search", {
            params: { q: query },
            headers: UA_HEADERS,
            timeout: 20000
        });

        const answer = extractAnswer(html);
        const results = parseBing(html);
        const wiki = answer ? null : await wikiAnswer(query).catch(() => null);

        if (answer) {
            let out = `🔍 *${query}*\n\n${answer}`;
            if (results.length) out += `\n\n🔗 ${results[0].href}`;
            await setStatus(out);
        } else if (wiki) {
            // Wikipedia ka jawab — asal paragraph, links nahi
            const out =
                `🔍 *${query}*\n\n` +
                `*${wiki.title}*\n${wiki.text}\n\n` +
                `🔗 ${wiki.url}`;
            await setStatus(out);
        } else if (results.length) {
            // Dono nahi mile — jawab ke liye sawal se sab se zyada
            // match khane wala result chuno (ad/fazool na aaye).
            // Baqi sirf 2 mazeed results (lambi list nahi).
            const top = pickAnswerResult(results, query);
            let out = `🔍 *${query}*\n\n`;
            out += `*${top.title}*\n`;
            if (top.snippet) out += `${top.snippet}\n\n`;
            out += `🔗 ${top.href}`;

            const more = results.filter((r) => r !== top).slice(0, 2);
            if (more.length) {
                out +=
                    `\n\n*مزید results:*\n` +
                    more
                        .map((r, i) => `${i + 2}. ${r.title}\n${r.href}`)
                        .join("\n");
            }
            await setStatus(out);
        } else {
            await setStatus(`❌ *Koi result nahi mila*\n${query}`);
            return;
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
module.exports.parseImageResults = parseImageResults;
module.exports.extractAnswer = extractAnswer;
module.exports.wikiAnswer = wikiAnswer;
module.exports.pickAnswerResult = pickAnswerResult;
