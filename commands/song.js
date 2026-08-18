const axios = require('axios');
const yts = require('yt-search');

const AXIOS_DEFAULTS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/plain, */*'
    }
};

async function tryRequest(getter, attempts = 2) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await getter();
        } catch (err) {
            lastError = err;

            if (attempt < attempts) {
                await new Promise(r => setTimeout(r, 700 * attempt));
            }
        }
    }

    throw lastError;
}

/*
 * Audio endpoint candidates.
 *
 * The video.js supplied by the user confirms the three API hosts and
 * their MP4 downloader structure. Audio endpoint names are tried as
 * common variants and validated strictly before use.
 */

async function requestAudio(url, endpoint) {
    const apiUrl = endpoint(url);

    const res = await tryRequest(() =>
        axios.get(apiUrl, AXIOS_DEFAULTS)
    );

    const d = res?.data;

    const candidates = [
        d?.downloadURL,
        d?.download_url,
        d?.result?.downloadURL,
        d?.result?.download_url,
        d?.result?.mp3,
        d?.result?.audio,
        d?.data?.downloadURL,
        d?.data?.download_url,
        d?.data?.mp3,
        d?.data?.audio,
        d?.url
    ];

    const download = candidates.find(
        value => typeof value === 'string' && /^https?:\/\//i.test(value)
    );

    if (!download) {
        throw new Error('No audio URL returned');
    }

    return {
        download,
        title:
            d?.title ||
            d?.result?.title ||
            d?.data?.title ||
            ''
    };
}

const audioMethods = [
    {
        name: 'EliteProTech MP3',
        method: url =>
            requestAudio(
                url,
                u =>
                    `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(u)}&format=mp3`
            )
    },
    {
        name: 'EliteProTech Audio',
        method: url =>
            requestAudio(
                url,
                u =>
                    `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(u)}&format=audio`
            )
    },
    {
        name: 'Yupra MP3',
        method: url =>
            requestAudio(
                url,
                u =>
                    `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(u)}`
            )
    },
    {
        name: 'Yupra Audio',
        method: url =>
            requestAudio(
                url,
                u =>
                    `https://api.yupra.my.id/api/downloader/ytaudio?url=${encodeURIComponent(u)}`
            )
    },
    {
        name: 'Okatsu MP3',
        method: url =>
            requestAudio(
                url,
                u =>
                    `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(u)}`
            )
    }
];

async function songCommand(sock, chatId, message) {
    try {
        for (const emoji of ['📥', '⏳', '🎵']) {
            await sock.sendMessage(chatId, {
                react: { text: emoji, key: message.key }
            });
        }

        const messageContent =
            message.message?.ephemeralMessage?.message ||
            message.message?.viewOnceMessage?.message ||
            message.message?.viewOnceMessageV2?.message ||
            message.message;

        const text = (
            messageContent?.conversation ||
            messageContent?.extendedTextMessage?.text ||
            messageContent?.imageMessage?.caption ||
            messageContent?.videoMessage?.caption ||
            ''
        ).trim();

        const query = text.replace(/^\.song\s+/i, '').trim();

        if (!query || query.toLowerCase() === '.song') {
            return await sock.sendMessage(chatId, {
                text:
                    '❌ *Song Downloader*\n\n' +
                    'Usage:\n.song <song name or YouTube link>'
            }, { quoted: message });
        }

        let videoUrl = '';
        let videoTitle = '';
        let videoThumbnail = '';
        let videoDuration = 'Unknown';

        if (/youtube\.com|youtu\.be/i.test(query)) {
            videoUrl = query;

            try {
                const search = await yts({
                    videoId: extractVideoId(query)
                });

                videoTitle = search?.title || 'YouTube Song';
                videoThumbnail = search?.thumbnail || '';
                videoDuration = search?.timestamp || 'Unknown';
            } catch (_) {
                videoTitle = 'YouTube Song';
            }
        } else {
            const { videos } = await yts(query);

            if (!videos?.length) {
                return await sock.sendMessage(
                    chatId,
                    { text: '❌ No results found.' },
                    { quoted: message }
                );
            }

            const video = videos[0];

            videoUrl = video.url;
            videoTitle = video.title;
            videoThumbnail = video.thumbnail;
            videoDuration = video.timestamp || 'Unknown';
        }

        await sock.sendMessage(chatId, {
            image: {
                url:
                    videoThumbnail ||
                    'https://i.postimg.cc/y6GV9P3H/file-000000004c307206bc366893b817568c-(1).png'
            },
            caption:
                `🎵 Downloading: *${videoTitle}*\n` +
                `⏱️ Duration: *${videoDuration}*`
        }, { quoted: message });

        let audioData = null;

        for (const api of audioMethods) {
            try {
                console.log(`[Song] Trying ${api.name}...`);

                const result = await api.method(videoUrl);

                if (result?.download) {
                    audioData = result;
                    console.log(`[Song] ✅ ${api.name}`);
                    break;
                }
            } catch (err) {
                console.log(`[Song] ${api.name} failed: ${err.message}`);
            }
        }

        if (!audioData?.download) {
            throw new Error(
                'All audio download sources failed. The APIs may not currently expose MP3.'
            );
        }

        const finalTitle = audioData.title || videoTitle;

        const safeFileName =
            finalTitle
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 40) || 'song';

        /*
         * Same fast architecture as video.js:
         * API creates the downloadable URL, then Baileys receives
         * the remote URL directly. No full MP3 Buffer on Railway.
         */
        await sock.sendMessage(chatId, {
            audio: {
                url: audioData.download
            },
            mimetype: 'audio/mpeg',
            fileName: `${safeFileName}.mp3`,
            ptt: false
        }, { quoted: message });

        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

    } catch (error) {
        console.error('[Song] Error:', error);

        await sock.sendMessage(chatId, {
            text:
                `❌ Error: ${error?.message || 'Song download failed.'}\n\n` +
                'Try:\n.song <song_name>'
        }, { quoted: message });
    }
}

function extractVideoId(url) {
    try {
        const match = url.match(
            /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([^&?/\s]+)/
        );

        return match?.[1] || '';
    } catch {
        return '';
    }
}

module.exports = songCommand;
