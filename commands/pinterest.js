const axios = require("axios");
const { rebelpindl } = require("trs-media-downloader");

// Koi fetch hang ho jaye to 30s timeout — command atki na rahe
function withTimeout(promise, ms, name) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(name + " timeout (" + ms / 1000 + "s)")),
                ms
            );
        })
    ]).finally(() => clearTimeout(timer));
}

// Pinterest SEARCH (siputzx free API): keywords do, asal Pinterest
// pins ki media (image/video) seedha chat mein aati hai.
// Live sach (2026-11-23 test): videos sirf tab aati hain jab query
// mein "video" ho — aur API ki order relevance ke hisab se nahi
// hoti. Is liye:
//  - video wali query -> videos PEHLE, phir images
//  - har item ko query se match par score karke sab se relevant
//    pehle bhejte hain (jo manga, wahi mile)
const INTENT_WORDS = new Set([
    "video", "videos", "pic", "pics", "photo", "photos", "image",
    "images", "wallpaper", "wallpapers", "clip", "clips", "reel", "reels"
]);

function queryTerms(query) {
    return query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !INTENT_WORDS.has(w));
}

function itemScore(it, terms) {
    const hay = (
        (it?.grid_title || "") + " " +
        (it?.description || "") + " " +
        (it?.seo_alt_text || "")
    ).toLowerCase();
    return terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
}

async function fetchPinItems(query) {
    const { data } = await withTimeout(
        axios.get("https://api.siputzx.my.id/api/s/pinterest", {
            params: { query },
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 20000
        }),
        25000,
        "pinterest-search"
    );
    return Array.isArray(data?.data) ? data.data : [];
}

function buildMedia(items, terms) {
    const seen = new Set();
    const media = [];
    items.forEach((it, idx) => {
        let entry = null;
        if (typeof it?.video_url === "string" && it.video_url) {
            entry = { type: "video", url: it.video_url };
        } else if (typeof it?.image_url === "string" && it.image_url) {
            entry = { type: "image", url: it.image_url };
        } else if (typeof it?.gif_url === "string" && it.gif_url) {
            entry = { type: "image", url: it.gif_url };
        }
        if (entry && !seen.has(entry.url)) {
            seen.add(entry.url);
            media.push({ ...entry, score: itemScore(it, terms), idx });
        }
    });
    return media;
}

async function searchPinterest(query) {
    const terms = queryTerms(query);
    const videoIntent =
        /\b(video|videos|clip|clips|reel|reels|movie|film)\b/i.test(query);

    let items = await fetchPinItems(query);
    let media = buildMedia(items, terms);

    // Video manga tha lekin query mein "video" lafz nahi tha
    // (maslan "car reels") aur ek bhi video nahi mili — ek dafa
    // "video" jod kar dobara dhoondho.
    if (videoIntent && !media.some((m) => m.type === "video") && !/\bvideo/i.test(query)) {
        try {
            const more = await fetchPinItems(query + " video");
            media = buildMedia(items.concat(more), terms);
        } catch {}
    }

    if (videoIntent) {
        media.sort(
            (a, b) =>
                (b.type === "video") - (a.type === "video") ||
                b.score - a.score ||
                a.idx - b.idx
        );
    } else {
        media.sort((a, b) => b.score - a.score || a.idx - b.idx);
    }

    return media.slice(0, 6).map(({ type, url }) => ({ type, url }));
}

async function pinterestCommand(sock, chatId, message) {
    // Animated status: fetch ke doran bar chalti rehti hai
    let statusKey = null;
    let progressTimer = null;

    const setStatus = async (text) => {
        if (statusKey) {
            await sock.sendMessage(chatId, { text, edit: statusKey }).catch(() => {});
        }
    };
    const stopProgress = () => {
        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    };
    const startProgress = (label) => {
        if (!statusKey) return;
        const frames = [
            `${label}\n[███░░░░░░░] 30%`,
            `${label}\n[████░░░░░░] 40%`,
            `${label}\n[█████░░░░░] 50%`,
            `${label}\n[██████░░░░] 60%`
        ];
        let fi = 0;
        progressTimer = setInterval(() => {
            setStatus(frames[fi % frames.length]);
            fi++;
        }, 1400);
    };

    try {
        const msg =
            message.message?.ephemeralMessage?.message ||
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
            message.message;

        const text =
            msg?.conversation ||
            msg?.extendedTextMessage?.text ||
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            "";

        const urlMatch = text.match(
            /https?:\/\/(?:www\.)?(?:pinterest\.[a-z.]+|pin\.it)\/[^\s]+/i
        );

        const query = text
            .replace(/^\.?(pinterest|pin)\s+/i, "")
            .trim();

        if (!urlMatch && !query) {
            return await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ Kya dhoondhna hai?\n\n" +
                        "Search: .pin car pics\n" +
                        "Link:   .pin https://www.pinterest.com/pin/XXXX/"
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        });

        // ---------- MODE 1: link diya hai -> download ----------
        if (urlMatch) {
            const pinUrl = urlMatch[0].replace(/[),.!]+$/, "");

            try {
                const statusMsg = await sock.sendMessage(chatId, {
                    text: "📥 *Downloading...*\n[██░░░░░░░░] 20%"
                }, { quoted: message });
                statusKey = statusMsg.key;
            } catch {}
            startProgress("📥 *Downloading...*");

            let data;
            try {
                data = await withTimeout(rebelpindl(pinUrl), 30000, "pinterest");
            } catch (e) {
                stopProgress();
                throw new Error("Pinterest fetch failed: " + (e?.message || e));
            }
            stopProgress();

            const videoUrl = typeof data?.video === "string" ? data.video : null;
            const imageUrl = typeof data?.image === "string" ? data.image : null;

            if (!videoUrl && !imageUrl) {
                throw new Error("Is link se koi media nahi mila (private ya invalid pin).");
            }

            await setStatus("🎬 *Sending...*\n[███████░░░] 70%");

            if (videoUrl) {
                await sock.sendMessage(
                    chatId,
                    { video: { url: videoUrl }, caption: "✅ *DOWNLOADED BY SALMAN KHAN*" },
                    { quoted: message }
                );
            } else {
                await sock.sendMessage(
                    chatId,
                    { image: { url: imageUrl }, caption: "✅ *DOWNLOADED BY SALMAN KHAN*" },
                    { quoted: message }
                );
            }

            await sock.sendMessage(chatId, {
                react: { text: "✅", key: message.key }
            });
            await setStatus("✅ *Downloaded!*\n[██████████] 100%");
            return;
        }

        // ---------- MODE 2: keywords -> search, media chat mein ----------
        try {
            const statusMsg = await sock.sendMessage(chatId, {
                text: `🔍 *Pinterest par dhoondh raha hoon...*\n${query}\n[██░░░░░░░░] 20%`
            }, { quoted: message });
            statusKey = statusMsg.key;
        } catch {}
        startProgress(`🔍 *Pinterest par dhoondh raha hoon...*\n${query}`);

        let media;
        try {
            media = await searchPinterest(query);
        } catch (e) {
            stopProgress();
            throw new Error("Pinterest search failed: " + (e?.message || e));
        }
        stopProgress();

        if (!media.length) {
            await setStatus(`❌ *Koi result nahi mila*\n${query}`);
            return;
        }

        await setStatus(`📤 *Bhej raha hoon...* ${media.length} results\n[███████░░░] 70%`);

        let sent = 0;
        for (const m of media) {
            try {
                // Koi caption nahi — saaf chat, sirf media
                if (m.type === "video") {
                    await sock.sendMessage(
                        chatId,
                        { video: { url: m.url } },
                        { quoted: sent === 0 ? message : undefined }
                    );
                } else {
                    await sock.sendMessage(
                        chatId,
                        { image: { url: m.url } },
                        { quoted: sent === 0 ? message : undefined }
                    );
                }
                sent++;
            } catch (e) {
                console.error("[PIN] media send fail:", e?.message || e);
            }
        }

        if (!sent) {
            throw new Error("Results mile thay lekin media bhejna fail ho gaya.");
        }

        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        });
        await setStatus(`✅ *Pinterest:* ${query}\n${sent} results bhej diye\n[██████████] 100%`);
    } catch (e) {
        stopProgress();
        console.error("[PIN] ERROR:", e?.message || e);
        await setStatus("❌ *Pinterest failed*");
        await sock.sendMessage(
            chatId,
            { text: "❌ Pinterest Error\n\n" + (e?.message || String(e)) },
            { quoted: message }
        ).catch(() => {});
    }
}

module.exports = pinterestCommand;
module.exports.searchPinterest = searchPinterest;
