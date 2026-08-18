const axios = require('axios');
const yts = require('yt-search');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function getAudioUrl(videoUrl) {
    // Use yt-dlp directly instead of the slow third-party ytmp3 converter.
    // yt-dlp must be installed on Railway/container.
    const { stdout } = await execFileAsync(
        'yt-dlp',
        [
            '--no-playlist',
            '--get-url',
            '-f',
            'bestaudio[ext=m4a]/bestaudio/best',
            videoUrl
        ],
        {
            timeout: 60000,
            maxBuffer: 1024 * 1024
        }
    );

    const url = String(stdout || '').trim().split(/\r?\n/)[0];

    if (!url) {
        throw new Error('Could not get direct audio URL.');
    }

    return url;
}

async function songCommand(sock, chatId, message) {
    try {
        const loadEmojis = ['📥', '⏳', '🎵'];

        for (const emoji of loadEmojis) {
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
            await sock.sendMessage(
                chatId,
                {
                    text:
                        '❌ *Song Downloader*\\n\\n' +
                        'Usage:\\n.song <song name or YouTube link>'
                },
                { quoted: message }
            );
            return;
        }

        let video;
        let videoUrl;

        if (
            query.includes('youtube.com') ||
            query.includes('youtu.be')
        ) {
            videoUrl = query;

            video = {
                url: videoUrl,
                title: 'YouTube Song',
                thumbnail:
                    'https://i.postimg.cc/y6GV9P3H/file-000000004c307206bc366893b817568c-(1).png',
                duration: 'Unknown'
            };
        } else {
            const search = await yts(query);

            if (!search || !search.videos?.length) {
                await sock.sendMessage(
                    chatId,
                    { text: '❌ No results found.' },
                    { quoted: message }
                );
                return;
            }

            video = search.videos[0];
            videoUrl = video.url;
        }

        // Send information while audio is being prepared.
        await sock.sendMessage(
            chatId,
            {
                image: {
                    url:
                        video.thumbnail ||
                        'https://i.postimg.cc/y6GV9P3H/file-000000004c307206bc366893b817568c-(1).png'
                },
                caption:
                    `🎵 *${video.title}*\\n` +
                    `⏱️ ${video.duration || 'N/A'}`
            },
            { quoted: message }
        );

        console.log(`[Song] Getting direct audio URL: ${videoUrl}`);

        // No iguro-ytdl/ytmp3 conversion server.
        const downloadUrl = await getAudioUrl(videoUrl);

        console.log('[Song] ✅ Direct audio URL obtained.');

        const audioResponse = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 90000,
            maxContentLength: 50 * 1024 * 1024,
            maxBodyLength: 50 * 1024 * 1024,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'audio/*,*/*',
                'Connection': 'keep-alive'
            }
        });

        const audioBuffer = Buffer.from(audioResponse.data);

        if (audioBuffer.length < 10000) {
            throw new Error('Downloaded audio file is too small.');
        }

        console.log(
            `[Song] ✅ Downloaded ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB`
        );

        const fileName =
            String(video.title || 'song')
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 40) || 'song';

        await sock.sendMessage(
            chatId,
            {
                audio: audioBuffer,
                mimetype: 'audio/mp4',
                fileName: `${fileName}.m4a`,
                ptt: false
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

    } catch (error) {
        console.error('[Song] Error:', error);

        await sock.sendMessage(
            chatId,
            {
                text:
                    `❌ ${error?.message || 'Song download failed.'}` +
                    `\n\nTry:\n.song <song_name>`
            },
            { quoted: message }
        );
    }
}

module.exports = songCommand;
