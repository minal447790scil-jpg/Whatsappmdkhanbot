const { ttdl } = require("ruhend-scraper");

// ttdl kabhi hang ho jata hai — 30s timeout taake command atki na rahe
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

async function tiktokCommand(sock, chatId, message) {

    // Animated status message (IG wali tarah) — fetch ke doran bar
    // chalti rehti hai; fail ho to status khamoshi se delete (is
    // command ka purana silent behavior barqarar), success par 100%.
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
            }, 1400);
        }


        let downloadData;

        try {
            downloadData =
                await withTimeout(ttdl(query), 30000, "ttdl");
        } catch (e) {
            await dropStatus();
            return; // second bot silent
        }
        stopProgress();


        let videoUrl;


        if (typeof downloadData === "string") {

            videoUrl = downloadData;

        } else {

            videoUrl =
                downloadData?.video ||
                downloadData?.video_url ||
                downloadData?.download ||
                downloadData?.url ||
                downloadData?.data?.video ||
                downloadData?.data?.play ||
                downloadData?.data?.nowm;

        }


        if (typeof videoUrl === "function") {
            videoUrl = await videoUrl();
        }


        if (
            !videoUrl ||
            !videoUrl.startsWith("http")
        ) {
            await dropStatus();
            return; // second bot silent
        }


        await setStatus("🎬 *Sending...*\n[███████░░░] 70%");

        await sock.sendMessage(
            chatId,
            {
                video: {
                    url: videoUrl
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
