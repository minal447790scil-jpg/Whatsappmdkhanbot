const { rebelpindl } = require("trs-media-downloader");

// rebelpindl kabhi hang ho sakta hai — 30s timeout
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

async function pinterestCommand(sock, chatId, message) {
    // Animated status (IG/TT wali tarah): fetch ke doran bar chalti
    // rehti hai, phir sending -> done.
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

        const match = text.match(
            /https?:\/\/(?:www\.)?(?:pinterest\.[a-z.]+|pin\.it)\/[^\s]+/i
        );

        const query = match
            ? match[0].replace(/[),.!]+$/, "")
            : text.replace(/^\.?(pinterest|pin)\s+/i, "").trim();

        if (!query) {
            return await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ Pinterest link do.\n\n" +
                        "Example:\n" +
                        ".pin https://www.pinterest.com/pin/XXXXXXXX/"
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
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
            }, 1400);
        }

        let data;
        try {
            data = await withTimeout(rebelpindl(query), 30000, "pinterest");
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
                {
                    video: { url: videoUrl },
                    caption: "✅ *DOWNLOADED BY SALMAN KHAN*"
                },
                { quoted: message }
            );
        } else {
            await sock.sendMessage(
                chatId,
                {
                    image: { url: imageUrl },
                    caption: "✅ *DOWNLOADED BY SALMAN KHAN*"
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        });

        await setStatus("✅ *Downloaded!*\n[██████████] 100%");
    } catch (e) {
        stopProgress();
        console.error("[PIN] ERROR:", e?.message || e);
        await setStatus("❌ *Download failed*");
        await sock.sendMessage(
            chatId,
            { text: "❌ Pinterest Error\n\n" + (e?.message || String(e)) },
            { quoted: message }
        ).catch(() => {});
    }
}

module.exports = pinterestCommand;
