const { ttdl } = require("ruhend-scraper");

async function tiktokCommand(sock, chatId, message) {

    let downloadData;

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


        downloadData =
            await ttdl(query);


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
            return; // second bot silent
        }


        await sock.sendMessage(
            chatId,
            {
                video: {
                    url: videoUrl
                },

                caption:
                "✅ TIKTOK DOWNLOADED BY SALMAN"
            },
            { quoted: message }
        );


        await sock.sendMessage(chatId, {
            react: {
                text: "✅",
                key: message.key
            }
        });


    } catch (e) {

        // region / second session errors hide
        return;

    }

}


module.exports = tiktokCommand;