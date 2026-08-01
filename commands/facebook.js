const axios = require("axios");

async function facebookCommand(sock, chatId, message) {

    let raw;

    try {

        const msg =
            message.message?.ephemeralMessage?.message ||
            message.message;


        const text =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            "";


        const url =
            text.replace(/^\.(fb|facebook)\s+/i, "")
            .trim();


        if (!url) {
            return await sock.sendMessage(
                chatId,
                {
                    text: "❌ Facebook link do."
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


        const api =
            `https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(url)}`;


        const res = await axios.get(api, {
            timeout: 30000,
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        });


        raw = res.data;


        let videoUrl =
            raw?.data?.hd ||
            raw?.data?.sd ||
            raw?.data?.url ||

            // NEW API FORMAT FIX
            raw?.data?.downloads?.find(x =>
                x.quality?.toLowerCase().includes("hd")
            )?.url ||

            raw?.data?.downloads?.[0]?.url ||

            raw?.result?.hd ||
            raw?.result?.sd ||
            raw?.result?.url ||
            raw?.downloads?.[0]?.url ||
            raw?.url;


        if (!videoUrl) {

            let arr =
                raw?.data?.data ||
                raw?.data ||
                raw?.result;


            if (Array.isArray(arr)) {

                videoUrl =
                    arr[0]?.url ||
                    arr[0]?.link ||
                    arr[0]?.download;

            }

        }


        if (!videoUrl) {
            throw new Error("No video URL found");
        }


        await sock.sendMessage(
            chatId,
            {
                video: {
                    url: videoUrl
                },

                caption:
                    "✅ FACEBOOK DOWNLOADED BY SALMAN"
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

        await sock.sendMessage(
            chatId,
            {
                text:
`❌ Facebook Error

${e.message}

RAW:
${JSON.stringify(raw)?.slice(0,1000)}`
            },
            { quoted: message }
        );

    }

}


module.exports = facebookCommand;