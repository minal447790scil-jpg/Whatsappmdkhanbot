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

// DELAY FIX (2026-11-23): pehle sirf ruhend ttdl tha — live test
// mein akela 58s le raha tha, is liye download bhi slow tha aur
// animation bhi atakti lagti thi. Ab teen sources RACE karte hain,
// jo pehle sahi video de wahi jeet'ta hai:
//   siputzx (~2s live) · tikwm · ruhend ttdl (backup)
async function fromSiputzx(url) {
    const { data } = await axios.get(
        "https://api.siputzx.my.id/api/d/tiktok",
        {
            params: { url },
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 20000
        }
    );
    const v =
        data?.data?.video?.hd?.url ||
        data?.data?.video?.sd?.url ||
        null;
    if (!v) throw new Error("siputzx: no video");
    return { source: "siputzx", url: v };
}

async function fromTikwm(url) {
    const { data } = await axios.get("https://www.tikwm.com/api/", {
        params: { url, hd: 1 },
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 20000
    });
    const v = data?.data?.hdplay || data?.data?.play || null;
    if (!v) throw new Error("tikwm: no video");
    return { source: "tikwm", url: v };
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
    return { source: "ruhend", url: v };
}

async function getVideoUrl(url) {
    const t0 = Date.now();
    const result = await Promise.any([
        withTimeout(fromSiputzx(url), 25000, "siputzx"),
        withTimeout(fromTikwm(url), 25000, "tikwm"),
        withTimeout(fromRuhend(url), 25000, "ruhend")
    ]);
    result.ms = Date.now() - t0;
    return result;
}

async function tiktokCommand(sock, chatId, message) {

    // Animated status message — fetch ke doran bar chalti rehti
    // hai; fail ho to status khamoshi se delete (is command ka
    // purana silent behavior barqarar), success par 100%.
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
    const dropStatus = async () => {
        stopProgress();
        if (statusKey) {
            await sock.sendMessage(chatId, { delete: statusKey }).catch(() => {});
            statusKey = null;
        }
    };

    try {

        const msg =
            message.message?.ephemeralMessage?.message ||
            message.message;


        const text =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            "";


        const query =
            text
            .replace(/^\.(tiktok|tt)\s+/i, "")
            .trim();


        if (!query) {

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
            }, 900);
        }


        let winner;

        try {
            winner = await getVideoUrl(query);
        } catch (e) {
            await dropStatus();
            return; // second bot silent
        }
        stopProgress();

        console.log(`[TT] source: ${winner.source} in ${winner.ms}ms`);


        await setStatus("🎬 *Sending...*\n[███████░░░] 70%");

        await sock.sendMessage(
            chatId,
            {
                video: {
                    url: winner.url
                },

                caption:
                "✅ *TIKTOK DOWNLOADED BY SALMAN KHAN*"
            },
            { quoted: message }
        );


        await sock.sendMessage(chatId, {
            react: {
                text: "✅",
                key: message.key
            }
        });

        await setStatus("✅ *Downloaded!*\n[██████████] 100%");


    } catch (e) {

        // region / second session errors hide
        await dropStatus().catch(() => {});
        return;

    }

}


module.exports = tiktokCommand;
module.exports.getVideoUrl = getVideoUrl;
