const axios = require("axios");
const { ttdl } = require("ruhend-scraper");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const ffmpegStaticPath = require("ffmpeg-static");
const ffmpegPath =
    ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)
        ? ffmpegStaticPath
        : "ffmpeg";

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

async function fromTikwm(url) {
    const { data } = await axios.get("https://www.tikwm.com/api/", {
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
    try {
        const result = await Promise.any([
            withTimeout(fromSiputzx(url), 25000, "siputzx"),
            withTimeout(fromTikwm(url), 25000, "tikwm"),
            withTimeout(fromRuhend(url), 25000, "ruhend")
        ]);
        result.ms = Date.now() - t0;
        return result;
    } catch (e) {
        // Teeno ek sath fail aksar chand second ki kharabi hoti
        // hai (siputzx 503/502 deta hai) — sab se tez source ko
        // ek dafa aur try karo, phir haar mano
        console.error(
            "[TT] race fail, siputzx retry:",
            (e?.errors || [e]).map((x) => x?.message || String(x)).join(" | ")
        );
        await new Promise((r) => setTimeout(r, 1500));
        const result = await withTimeout(fromSiputzx(url), 15000, "siputzx-retry");
        result.ms = Date.now() - t0;
        console.log("[TT] siputzx retry kamyab");
        return result;
    }
}

// PLAYBACK CHECK (2026-11-25, halki surat): bari HD files aur
// ajeeb formats doosri chats mein play nahi hotay thay. Pehle
// convert karne wali surat bohat slow thi (video hi nahi aati
// thi), is liye ab sirf CHECK hai, conversion nahi: SD file
// pehle aati hai (chhoti + aam taur par H.264), format theek
// ho to wahi, warna HD ki bari — aur dono hi theek na hon to
// SD waisi ki waisi (video aana, dair se aana se behtar hai).
function probeInfo(file) {
    return new Promise((resolve) => {
        execFile(
            ffmpegPath,
            ["-i", file],
            { timeout: 15000 },
            (err, stdout, stderr) => resolve(String(stderr || ""))
        );
    });
}

function isPlayable(info) {
    const v = /Video: ([a-z0-9]+)/i.exec(info)?.[1]?.toLowerCase();
    const a = /Audio: ([a-z0-9]+)/i.exec(info)?.[1]?.toLowerCase();
    const pixOk = /yuv420p(?![0-9])/i.test(info);
    return { ok: v === "h264" && pixOk && (!a || a === "aac"), v, a };
}

async function probePlayable(buf) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-"));
    const inF = path.join(dir, "in.mp4");
    try {
        fs.writeFileSync(inF, buf);
        const p = isPlayable(await probeInfo(inF));
        console.log(
            `[TT] probe: video=${p.v || "?"} audio=${p.a || "none"} ok=${p.ok}`
        );
        return p.ok;
    } catch (e) {
        return false;
    } finally {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {}
    }
}

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
            // Video — SD pehle buffer mein; format check ke sath
            // jo candidate theek ho wahi bhejo. Dono hi check
            // fail karein to SD waisi ki waisi (video aana sab
            // se aham hai). Akhri sahara seedha URL-send.
            let sent = false;
            let lastErr = null;
            let firstBuf = null;

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
                    if (!firstBuf) firstBuf = buf;
                    if (await probePlayable(buf)) {
                        await sendBuf(buf);
                    }
                } catch (e) {
                    lastErr = e;
                    console.error("[TT] buffer send fail:", e?.message || e);
                }
            }

            if (!sent && firstBuf) {
                try {
                    console.log("[TT] format verify na hua — pehla (SD) buffer as-is");
                    await sendBuf(firstBuf);
                } catch (e) {
                    lastErr = e;
                    console.error("[TT] as-is send fail:", e?.message || e);
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
module.exports.probePlayable = probePlayable;
