const { ytmp3 } = require('iguro-ytdl');
const yts = require('yt-search');

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
                        '❌ *Song Downloader*\n\n' +
                        'Usage:\n.song <song name or YouTube link>'
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

        await sock.sendMessage(
            chatId,
            {
                image: {
                    url:
                        video.thumbnail ||
                        'https://i.postimg.cc/y6GV9P3H/file-000000004c307206bc366893b817568c-(1).png'
                },
                caption:
                    `🎵 *${video.title}*\n` +
                    `⏱️ ${video.duration || 'N/A'}`
            },
            { quoted: message }
        );

        console.log(`[Song] Getting audio URL: ${videoUrl}`);

        const result = await ytmp3(videoUrl);

        if (
            !result ||
            !result.status ||
            !result.result?.url
        ) {
            throw new Error('Could not get audio URL.');
        }

        const downloadUrl = result.result.url;
        const finalTitle = result.result.title || video.title;

        console.log('[Song] ✅ Audio URL obtained. Sending as URL stream...');

        const fileName =
            String(finalTitle)
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 40) || 'song';

        /*
         * IMPORTANT:
         * Do NOT download the whole MP3 into a Railway Buffer.
         * Pass the remote audio URL directly to Baileys.
         *
         * This removes the large:
         *   YouTube -> Railway Buffer -> WhatsApp
         * transfer from this code.
         *
         * Baileys/WhatsApp still has to fetch/upload the media;
         * WhatsApp itself cannot directly convert a YouTube URL.
         */
        await sock.sendMessage(
            chatId,
            {
                audio: {
                    url: downloadUrl
                },
                mimetype: 'audio/mpeg',
                fileName: `${fileName}.mp3`,
                ptt: false
            },
            { quoted: message }
        );

        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

        console.log('[Song] ✅ Audio sent.');

    } catch (error) {
        console.error('[Song] Error:', error);

        await sock.sendMessage(
            chatId,
            {
                text:
                    `❌ ${error?.message || 'Song download failed.'}` +
                    '\n\nTry:\n.song <song_name>'
            },
            { quoted: message }
        );
    }
}

module.exports = songCommand;
