const axios = require("axios");
const yts = require("yt-search");
const { lmna } = require("@lmna22/aio-downloader");

// ===============================
// OLD APIs (fallback)
// ===============================
const SONG_APIS = [
    async (url) => {
        const r = await axios.get(
            "https://eliteprotech-apis.zone.id/ytdown",
            {
                params: { url, format: "mp3" },
                timeout: 120000
            }
        );
        return extractUrl(r.data);
    },

    async (url) => {
        const r = await axios.get(
            "https://api.yupra.my.id/api/downloader/ytmp3",
            {
                params: { url },
                timeout: 120000
            }
        );
        return extractUrl(r.data);
    },

    async (url) => {
        const r = await axios.get(
            "https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3",
            {
                params: { url },
                timeout: 120000
            }
        );
        return extractUrl(r.data);
    }
];

// ===============================
// AIO-DOWNLOADER (No API Key)
// ===============================
async function aioDownload(url) {
    const result = await lmna.youtube(url, 8); // 8 = MP3

    if (result?.status && result?.data?.result) {
        return result.data.result; // Buffer
    }

    return null;
}

// ===============================
// EXTRACT DOWNLOAD URL
// ===============================
function extractUrl(data) {
    if (!data) return null;

    return (
        data.url ||
        data.downloadUrl ||
        data.download_url ||
        data.result?.url ||
        data.result?.downloadUrl ||
        data.result?.download_url ||
        data.data?.url ||
        data.data?.downloadUrl ||
        data.data?.download_url ||
        data.links?.[0]?.url ||
        null
    );
}

// ===============================
// GET MESSAGE TEXT
// ===============================
function getText(message) {
    let msg = message?.message || message;

    if (!msg) return "";

    if (msg.ephemeralMessage?.message)
        msg = msg.ephemeralMessage.message;

    if (msg.viewOnceMessage?.message)
        msg = msg.viewOnceMessage.message;

    if (msg.viewOnceMessageV2?.message)
        msg = msg.viewOnceMessageV2.message;

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        ""
    ).trim();
}

// ===============================
// SONG COMMAND
// ===============================
async function songCommand(sock, chatId, message) {
    try {
        const text = getText(message);

        const query = text
            .replace(/^\.song\b/i, "")
            .trim();

        if (!query) {
            return sock.sendMessage(
                chatId,
                {
                    text:
                        "🎵 *Song Downloader*\n\n" +
                        "Usage: `.song song name`\n\n" +
                        "Example: `.song Tum Hi Ho`"
                },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, {
            react: {
                text: "🔎",
                key: message.key
            }
        });

        const search = await yts(query);

        if (!search.videos?.length) {
            throw new Error("No YouTube result found.");
        }

        const video = search.videos[0];

        const title = video.title;
        const url = video.url;
        const thumbnail = video.thumbnail;
        const duration = video.timestamp || "Unknown";

        await sock.sendMessage(
            chatId,
            {
                image: { url: thumbnail },
                caption:
                    `🎵 *${title}*\n\n` +
                    `⏱️ ${duration}\n\n` +
                    `📥 *Downloading...*`
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, {
            react: {
                text: "⏳",
                key: message.key
            }
        });

        let audioBuffer = null;

        // ===============================
        // TRY AIO DOWNLOADER (No API Key)
        // ===============================
        try {
            console.log("Trying aio-downloader...");

            audioBuffer = await aioDownload(url);

            if (audioBuffer) {
                console.log("aio-downloader worked");
            }

        } catch (e) {
            console.log(
                "aio-downloader failed:",
                e.message
            );
        }

        // ===============================
        // FALLBACK TO OLD APIs
        // ===============================
        if (!audioBuffer) {
            for (let i = 0; i < SONG_APIS.length; i++) {
                try {
                    console.log(
                        `Trying Song API ${i + 1}`
                    );

                    const downloadUrl =
                        await SONG_APIS[i](url);

                    if (downloadUrl) {
                        const res = await axios.get(
                            downloadUrl,
                            {
                                responseType:
                                    "arraybuffer",
                                timeout: 180000,
                                maxContentLength:
                                    100 * 1024 * 1024
                            }
                        );

                        audioBuffer =
                            Buffer.from(res.data);

                        if (audioBuffer.length) {
                            console.log(
                                `Song API ${i + 1} worked`
                            );
                            break;
                        }
                    }

                } catch (e) {
                    console.log(
                        `Song API ${i + 1} failed:`,
                        e.message
                    );
                }
            }
        }

        if (!audioBuffer || !audioBuffer.length) {
            throw new Error(
                "All song download APIs failed."
            );
        }

        // ===============================
        // SEND AUDIO
        // ===============================
        await sock.sendMessage(
            chatId,
            {
                audio: audioBuffer,
                mimetype: "audio/mpeg",
                fileName: `${title}.mp3`,
                ptt: false,
                contextInfo: {
                    externalAdReply: {
                        title: title,
                        body:
                            "🎵 Song Downloader",
                        thumbnailUrl:
                            thumbnail,
                        mediaType: 2,
                        renderLargerThumbnail:
                            true,
                        sourceUrl: url
                    }
                }
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, {
            react: {
                text: "🎵",
                key: message.key
            }
        });

    } catch (error) {
        console.error(
            "SONG ERROR:",
            error?.response?.data ||
            error.message
        );

        await sock.sendMessage(
            chatId,
            {
                text:
                    "❌ *Song Download Failed*\n\n" +
                    `${error.message}`
            },
            { quoted: message }
        );
    }
}

module.exports = songCommand;
