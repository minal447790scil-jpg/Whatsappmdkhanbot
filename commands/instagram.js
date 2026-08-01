const { igdl } = require("ruhend-scraper");

async function instagramCommand(sock, chatId, message) {
    let downloadData;

    try {
        const msg =
            message.message?.ephemeralMessage?.message ||
            message.message;

        const text =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            "";

        const query = text
            .replace(/^\.(insta|ig|instagram)\s+/i, "")
            .trim();

        if (!query) {
            return sock.sendMessage(chatId, {
                text: "❌ Instagram link do."
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        });

        const cleanUrl = query.split("?")[0];

        downloadData = await igdl(cleanUrl);

        let mediaList = [];

        if (Array.isArray(downloadData)) {
            mediaList = downloadData;
        }
        else if (Array.isArray(downloadData?.data)) {
            mediaList = downloadData.data;
        }
        else if (Array.isArray(downloadData?.result)) {
            mediaList = downloadData.result;
        }
        else if (downloadData) {
            mediaList = [downloadData];
        }

        let sent = false;


        for (const media of mediaList) {

            let mediaUrl;

            // library direct url array deti hai
            if (typeof media === "string") {
                mediaUrl = media;
            } 
            else {
                mediaUrl =
                    media.url ||
                    media.download_url ||
                    media.download ||
                    media.video ||
                    media.video_url ||
                    media.link;
            }


            // agar link function hua
            if (typeof mediaUrl === "function") {
                mediaUrl = await mediaUrl();
            }


            if (!mediaUrl || !mediaUrl.startsWith("http")) {
                continue;
            }


            await sock.sendMessage(chatId, {
                video: { url: mediaUrl },
                caption: "✅ DOWNLOADED BY SALMAN"
            }, { quoted: message });


            sent = true;
        }


        if (!sent) {
            throw new Error(
                JSON.stringify(downloadData, null, 2)
            );
        }


        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        });


    } catch (e) {

        await sock.sendMessage(chatId, {
            text:
`❌ Instagram Error

${e.message}

RAW:
${JSON.stringify(downloadData, null, 2)?.slice(0,2000)}`
        }, { quoted: message });

    }
}

module.exports = instagramCommand;