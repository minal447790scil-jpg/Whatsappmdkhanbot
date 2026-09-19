const axios = require('axios');
const yts = require('yt-search');

// 🔥 NAYI LIBRARIES
const { downloadVideo } = require('fallen-yt');
const { ytmp4 } = require('iguro-ytdl');

const AXIOS_DEFAULTS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/plain, */*'
    }
};

async function tryRequest(getter, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await getter();
        } catch (err) {
            lastError = err;
            if (attempt < attempts) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastError;
}

// ===============================
// 🔥 PURANI APIs (Tumhari)
// ===============================
async function getEliteProTechVideoByUrl(youtubeUrl) {
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) {
        return { download: res.data.downloadURL, title: res.data.title };
    }
    throw new Error('EliteProTech failed');
}

async function getYupraVideoByUrl(youtubeUrl) {
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
        return { download: res.data.data.download_url, title: res.data.data.title };
    }
    throw new Error('Yupra failed');
}

async function getOkatsuVideoByUrl(youtubeUrl) {
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.mp4) {
        return { download: res.data.result.mp4, title: res.data.result.title };
    }
    throw new Error('Okatsu failed');
}

// ===============================
// 🔥 NAYI APIs (fallen-yt + iguro-ytdl)
// ===============================
async function getFallenYtVideoByUrl(youtubeUrl) {
    // fallen-yt: direct URL deta hai, koi FFmpeg nahi
    const res = await downloadVideo(youtubeUrl, "720");
    if (res?.url) {
        return { download: res.url, title: res.title || 'YouTube Video' };
    }
    throw new Error('fallen-yt failed');
}

async function getIguroVideoByUrl(youtubeUrl) {
    // iguro-ytdl: ytmp4 se direct URL
    const res = await ytmp4(youtubeUrl, "720p");
    if (res?.status && res?.result?.url) {
        return { download: res.result.url, title: res.result.title || 'YouTube Video' };
    }
    throw new Error('iguro-ytdl failed');
}

// ===============================
// VIDEO COMMAND
// ===============================
async function videoCommand(sock, chatId, message) {
    try {
        // Loading reactions
        const loadEmojis = ['📥', '⏳', '🎥'];
        for (const emoji of loadEmojis) {
            await sock.sendMessage(chatId, { react: { text: emoji, key: message.key } });
        }

        const messageContent = message.message?.ephemeralMessage?.message || 
                             message.message?.viewOnceMessage?.message || 
                             message.message?.viewOnceMessageV2?.message || 
                             message.message;
        
        const text = (messageContent.conversation || 
                     messageContent.extendedTextMessage?.text || 
                     messageContent.imageMessage?.caption || 
                     messageContent.videoMessage?.caption || '').trim();
        
        const query = text.replace(/^\.video\s+/i, '').trim();

        if (!query || query.toLowerCase() === '.video') {
            await sock.sendMessage(chatId, { text: 'Usage: .video <name or link>' }, { quoted: message });
            return;
        }

        let videoUrl = '';
        let videoTitle = '';
        let videoThumbnail = '';

        if (query.includes('youtube.com') || query.includes('youtu.be')) {
            videoUrl = query;
            videoTitle = 'YouTube Video';
        } else {
            const { videos } = await yts(query);
            if (!videos || videos.length === 0) {
                await sock.sendMessage(chatId, { text: 'No videos found!' }, { quoted: message });
                return;
            }
            videoUrl = videos[0].url;
            videoTitle = videos[0].title;
            videoThumbnail = videos[0].thumbnail;
        }

        await sock.sendMessage(chatId, {
            image: { url: videoThumbnail || 'https://i.postimg.cc/y6GV9P3H/file-000000004c307206bc366893b817568c-(1).png' },
            caption: `🎥 Downloading: *${videoTitle}*`
        }, { quoted: message });

        let videoData;
        let downloadSuccess = false;

        // 🔥 SAB APIs IKATHTHA
        const apiMethods = [
            { name: 'EliteProTech', method: () => getEliteProTechVideoByUrl(videoUrl) },
            { name: 'Yupra', method: () => getYupraVideoByUrl(videoUrl) },
            { name: 'Okatsu', method: () => getOkatsuVideoByUrl(videoUrl) },
            { name: 'fallen-yt', method: () => getFallenYtVideoByUrl(videoUrl) },
            { name: 'iguro-ytdl', method: () => getIguroVideoByUrl(videoUrl) }
        ];

        for (const apiMethod of apiMethods) {
            try {
                console.log(`Trying ${apiMethod.name}...`);
                videoData = await apiMethod.method();
                if (videoData && videoData.download) {
                    downloadSuccess = true;
                    console.log(`✅ ${apiMethod.name} worked!`);
                    break;
                }
            } catch (err) {
                console.log(`❌ ${apiMethod.name} failed:`, err.message);
            }
        }

        if (!downloadSuccess) {
            throw new Error('All download sources failed.');
        }

        await sock.sendMessage(chatId, {
            video: { url: videoData.download },
            mimetype: 'video/mp4',
            fileName: `${(videoData.title || videoTitle).replace(/[^\w\s-]/g, '')}.mp4`,
            caption: `*${videoData.title || videoTitle}*\n\n> *Downloaded by OLD-STUDIO*`
        }, { quoted: message });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('Video error:', error);
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: message });
    }
}

module.exports = videoCommand;
