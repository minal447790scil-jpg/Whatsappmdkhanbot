const axios = require("axios");
const { ttdl } = require("ruhend-scraper");

// Koi source hang ho jaye to timeout — command atki na rahe
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

// Text mein se asal TikTok link nikalo (user aksar link ke sath
// fazool text bhi bhej deta hai — pura text URL bana kar bhejne
// se har source fail ho jata tha)
function extractUrl(text) {
    const m = String(text || "").match(
        /https?:\/\/(?:www\.|vm\.|vt\.)?(?:tiktok\.com|tiktokcdn\.com)[^\s]+/i
    );
    return m ? m[0].replace(/[),.!]+$/, "") : null;
}

// Teen sources RACE karte hain — jo pehle sahi jawab de wahi
// jeet'ta hai (ruhend akela ~58s leta tha, siputzx ~2s):
//   siputzx · tikwm · ruhend ttdl (backup)
// Video ke sath slideshow (photo) posts bhi handle hain.
async function fromSiputzx(url) {
    const { data } = await axios.get(
        "https://api.siputzx.my.id/api/d/tiktok",
        {
            params: { url },
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 20000
        }
    );
    const d = data?.data || {};
    if (d.type === "image" && Array.isArray(d.images) && d.images.length) {
        const urls = d.images
            .map((im) => (typeof im === "string" ? im : im?.url))
            .filter((u) => typeof u === "string" && u.startsWith("http"));
        if (urls.length) return { source: "siputzx", kind: "images", urls };
    }
    const hd = d.video?.hd?.url || null;
    const sd = d.video?.sd?.url || null;
    if (!hd && !sd) throw new Error("siputzx: no video");
    // SD pehle (owner ki hidayat: tez download) — HD files 26MB+
    // hoti hain, dair bhi lagti hai aur bari files doosri chats
    // mein play bhi nahi hotin. HD backup mein rehti hai.
    return {
        source: "siputzx",
        kind: "video",
        url: sd || hd,
        altUrl: sd && hd ? hd : null
    };
}

async function fromTikwm(url, host = "www.tikwm.com") {
    const { data } = await axios.get(`https://${host}/api/`, {
        params: { url, hd: 1 },
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 20000
    });
    const d = data?.data || {};
    if (Array.isArray(d.images) && d.images.length) {
        return { source: "tikwm", kind: "images", urls: d.images.slice(0, 10) };
    }
    const v = d.hdplay || d.play || null;
    if (!v) throw new Error("tikwm: no video");
    return { source: "tikwm", kind: "video", url: v };
}

async function fromRuhend(url) {
    const d = await ttdl(url);
    let v;
    if (typeof d === "string") {
        v = d;
    } else {
        v =
            d?.video ||
            d?.video_url ||
            d?.download ||
            d?.url ||
            d?.data?.video ||
            d?.data?.play ||
            d?.data?.nowm;
    }
    if (typeof v === "function") v = await v();
    if (!v || !String(v).startsWith("http")) {
        throw new Error("ruhend: no video");
    }
    return { source: "ruhend", kind: "video", url: v };
}

async function raceSources(url) {
    const t0 = Date.now();
    // Chaar sources parallel (tikwm ke do hosts alag hain — ek
    // down ho to doosra chal sakta hai). Serial retry HATA di:
    // jab sab sources down hon (jaisay 2026-11-25 ki raat TikTok
    // ki saari free APIs ek sath band theen) wo sirf 17 second
    // aur dair karti thi, video phir bhi nahi aati thi. Ab fail
    // bhi tez hota hai aur jo source pehle wapas aaye, race
    // usay foran pakar leti hai.
    const result = await Promise.any([
        withTimeout(fromSiputzx(url), 20000, "siputzx"),
        withTimeout(fromTikwm(url), 20000, "tikwm"),
        withTimeout(fromTikwm(url, "api.tikwm.com"), 20000, "tikwm-api"),
        withTimeout(fromRuhend(url), 20000, "ruhend")
    ]);
    result.ms = Date.now() - t0;
    return result;
}

// NOTE (2026-11-25): ffmpeg conversion/check owner ke hukm par
// mukammal hata di gayi hai — us se video late aati thi. Ab
// koi check nahi: SD buffer seedha bhejta hai.

// Video pehle khud buffer mein download karo, phir bhejo —
// WhatsApp/Baileys ka apna URL fetcher kuch CDN links par fail
// ho jata tha, jis se video aata hi nahi tha aur status delete
// ho jata tha. Buffer fail ho to URL-send akhri sahara hai.
async function fetchBuffer(url, maxMB = 64) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 60000,
        maxContentLength: maxMB * 1024 * 1024,
        maxBodyLength: maxMB * 1024 * 1024
    });
    return Buffer.from(res.data);
}

async function tiktokCommand(sock, chatId, message) {

    // Animated status (owner ki hidayat: animation RAHEGI) —
    // fetch ke doran bar chalti hai, akhir mein sirf 100% bar,
    // "Downloaded" lafz nahi aayega.
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
    // Fail par status DELETE nahi hota (owner ko yahi shikayat
    // thi) — ek line ka fail note reh jata hai, video aaye to
    // status 100% bar ban jata hai
    const failStatus = async () => {
        stopProgress();
        await setStatus("❌ *Download failed*");
    };

    try {

        const msg =
            message.message?.ephemeralMessage?.message ||
            message.message;


        const text =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            "";


        const url = extractUrl(
            text.replace(/^\.(tiktok|tt)\b/i, "")
        );


        if (!url) {

            return await sock.sendMessage(
                chatId,
                {
                    text: "❌ TikTok link do."
                },
                { quoted: message }
            );

        }


        await sock.sendMessage(chatId, {
            react: {
                text: "📥",
                key: message.key
            }
        });


        try {
            const statusMsg = await sock.sendMessage(chatId, {
                text: "📥 *Downloading...*\n[██░░░░░░░░] 20%"
            }, { quoted: message });
            statusKey = statusMsg.key;
        } catch {}

        if (statusKey) {
            const frames = [
                "📥 *Downloading...*\n[███░░░░░░░] 30%",
                "📥 *Downloading...*\n[████░░░░░░] 40%",
                "📥 *Downloading...*\n[█████░░░░░] 50%",
                "📥 *Downloading...*\n[██████░░░░] 60%"
            ];
            let fi = 0;
            progressTimer = setInterval(() => {
                setStatus(frames[fi % frames.length]);
                fi++;
            }, 400);
        }


        let winner;

        try {
            winner = await raceSources(url);
        } catch (e) {
            // Wajah logs mein lazmi — taake fail nazar aaye,
            // ghayb na ho; chat mein sirf ek line ka fail note
            console.error("[TT] ALL SOURCES FAILED:", e?.message || e);
            await failStatus();
            return;
        }
        stopProgress();

        console.log(
            `[TT] source: ${winner.source} kind: ${winner.kind} in ${winner.ms}ms`
        );


        await setStatus("🎬 *Sending...*\n[███████░░░] 70%");

        if (winner.kind === "images") {
            // Slideshow post — tasaveer bhejo
            let sent = 0;
            for (const imgUrl of winner.urls.slice(0, 6)) {
                try {
                    await sock.sendMessage(
                        chatId,
                        {
                            image: { url: imgUrl },
                            caption:
                                sent === 0
                                    ? "✅ *TIKTOK DOWNLOADED BY SALMAN KHAN*"
                                    : undefined
                        },
                        { quoted: sent === 0 ? message : undefined }
                    );
                    sent++;
                } catch (e) {
                    console.error("[TT] image send fail:", e?.message || e);
                }
            }
            if (!sent) throw new Error("slideshow: koi image nahi gayi");
        } else {
            // Video — SD pehle buffer mein, fail ho to HD buffer,
            // akhri sahara seedha URL-send. Koi ffmpeg check
            // nahi (owner ke hukm par hata di — dair hoti thi).
            let sent = false;
            let lastErr = null;

            const sendBuf = async (buf) => {
                await sock.sendMessage(
                    chatId,
                    {
                        video: buf,
                        mimetype: "video/mp4",
                        caption: "✅ *TIKTOK DOWNLOADED BY SALMAN KHAN*"
                    },
                    { quoted: message }
                );
                sent = true;
                console.log(
                    `[TT] sent via buffer (${(buf.length / 1048576).toFixed(1)}MB)`
                );
            };

            for (const candidate of [winner.url, winner.altUrl]) {
                if (!candidate || sent) continue;
                try {
                    const buf = await fetchBuffer(candidate);
                    await sendBuf(buf);
                } catch (e) {
                    lastErr = e;
                    console.error("[TT] buffer send fail:", e?.message || e);
                }
            }

            if (!sent) {
                try {
                    await sock.sendMessage(
                        chatId,
                        {
                            video: { url: winner.url },
                            caption: "✅ *TIKTOK DOWNLOADED BY SALMAN KHAN*"
                        },
                        { quoted: message }
                    );
                    sent = true;
                    console.log("[TT] sent via url fallback");
                } catch (e) {
                    lastErr = e;
                    console.error("[TT] url send fail:", e?.message || e);
                }
            }

            if (!sent) throw lastErr || new Error("video send failed");
        }


        await sock.sendMessage(chatId, {
            react: {
                text: "✅",
                key: message.key
            }
        });

        // Sirf mukammal bar — "Downloaded" lafz nahi
        await setStatus("[██████████] 100%");


    } catch (e) {

        console.error("[TT] FAILED:", e?.message || e);
        await failStatus().catch(() => {});
        return;

    }

}


module.exports = tiktokCommand;
module.exports.raceSources = raceSources;
module.exports.extractUrl = extractUrl;
