const { ytmp3 } = require('iguro-ytdl');
const yts = require('yt-search');

async function songCommand(sock, chatId, message) {
    try {
        // Loading reactions
        const loadEmojis = ['📥', '⏳', '🎵'];
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
        
        const query = text.replace(/^\.song\s+/i, '').trim();

        if (!query || query.toLowerCase() === '.song') {
            await sock.sendMessage(chatId, { 
                text: '❌ *Song Downloader*\n\nUsage:\n.song <song name or YouTube link>' 
            }, { quoted: message });
            return;
        }

        let video;
        let videoUrl;

        if (query.includes('youtube.com') || query.includes('youtu.be')) {
            videoUrl = query;
            video = {
                url: videoUrl,
                title: 'YouTube Song',
                thumbnail: 'https://i.postimg.cc/y6GV9P3H/file-000000004c307206bc366893b817568c-(1).png',
                duration: 'Unknown'
            };
        } else {
            const search = await yts(query);
            if (!search || !search.videos.length) {
                await sock.sendMessage(chatId, { text: '❌ No results found.' }, { quoted: message });
                return;
            }
            video = search.videos[0];
            videoUrl = video.url;
        }

        // Send info
        await sock.sendMessage(chatId, {
            image: { url: video.thumbnail || 'https://i.postimg.cc/y6GV9P3H/file-000000004c307206bc366893b817568c-(1).png' },
            caption: `🎵 *${video.title}*\n⏱️ ${video.duration || 'N/A'}`
        }, { quoted: message });

        // 🔥 DOWNLOAD USING iguro-ytdl (Working)
        console.log(`[Song] Downloading: ${videoUrl}`);
        
        const result = await ytmp3(videoUrl);
        
        if (!result || !result.status || !result.result || !result.result.url) {
            throw new Error('Download failed');
        }

        const downloadUrl = result.result.url;
        const finalTitle = result.result.title || video.title;
        const quality = result.result.quality || '128kbps';

        console.log(`[Song] ✅ Got download URL, downloading...`);

        // Download audio
        const audioResponse = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'audio/mpeg,audio/*,*/*'
            }
        });

        const audioBuffer = Buffer.from(audioResponse.data);

        if (!audioBuffer || audioBuffer.length < 10000) {
            throw new Error('File too small');
        }

        console.log(`[Song] ✅ Downloaded ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Send audio
        const fileName = finalTitle.replace(/[^\w\s-]/g, '').substring(0, 40) || 'song';

        await sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${fileName}.mp3`,
            ptt: false
        }, { quoted: message });

        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

    } catch (error) {
        console.error('[Song] Error:', error.message);
        await sock.sendMessage(chatId, {
            text: `❌ ${error.message}\n\nTry:\n.song <song_name>`
        }, { quoted: message });
    }
}

module.exports = songCommand;