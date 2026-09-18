const yts = require('yt-search');
const axios = require('axios');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        execFile('yt-dlp', args, {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 180000
        }, (error, stdout, stderr) => {
            if (error) {
                console.error('[yt-dlp STDERR]', stderr);
                reject(new Error(stderr || error.message));
                return;
            }

            resolve(stdout.trim());
        });
    });
}

async function songCommand(sock, chatId, message) {
    let outputFile = null;

    try {
        // =========================
        // Loading reactions
        // =========================

        for (const emoji of ['📥', '⏳', '🎵']) {
            try {
                await sock.sendMessage(chatId, {
                    react: {
                        text: emoji,
                        key: message.key
                    }
                });
            } catch {}
        }

        // =========================
        // Get message text
        // =========================

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

        const query = text.replace(/^\.song\s*/i, '').trim();

        if (!query) {
            await sock.sendMessage(
                chatId,
                {
                    text:
                        '❌ *Song Downloader*\n\n' +
                        'Usage:\n' +
                        '.song <song name>\n\n' +
                        'Example:\n' +
                        '.song Tum Hi Ho Arijit Singh'
                },
                { quoted: message }
            );
            return;
        }

        // =========================
        // Find YouTube video
        // =========================

        let video;
        let videoUrl;

        if (/youtube\.com|youtu\.be/i.test(query)) {
            videoUrl = query;

            try {
                const info = await runYtDlp([
                    '--dump-single-json',
                    '--no-playlist',
                    '--skip-download',
                    videoUrl
                ]);

                const data = JSON.parse(info);

                video = {
                    title: data.title || 'YouTube Song',
                    thumbnail: data.thumbnail || null,
                    duration: data.duration_string || 'Unknown',
                    url: videoUrl
                };
            } catch (err) {
                console.error('[Song] URL info error:', err.message);

                video = {
                    title: 'YouTube Song',
                    thumbnail: null,
                    duration: 'Unknown',
                    url: videoUrl
                };
            }

        } else {

            console.log('[Song] Searching:', query);

            const search = await yts(query);

            if (!search?.videos?.length) {
                await sock.sendMessage(
                    chatId,
                    {
                        text: '❌ No YouTube results found.'
                    },
                    { quoted: message }
                );
                return;
            }

            video = search.videos[0];
            videoUrl = video.url;
        }

        console.log('[Song] Selected:', video.title);
        console.log('[Song] URL:', videoUrl);

        // =========================
        // Send song information
        // =========================

        if (video.thumbnail) {
            try {
                await sock.sendMessage(
                    chatId,
                    {
                        image: {
                            url: video.thumbnail
                        },
                        caption:
                            `🎵 *${video.title}*\n` +
                            `⏱️ ${video.duration || 'N/A'}\n\n` +
                            `📥 Downloading audio...`
                    },
                    { quoted: message }
                );
            } catch {
                await sock.sendMessage(
                    chatId,
                    {
                        text:
                            `🎵 *${video.title}*\n\n` +
                            `📥 Downloading audio...`
                    },
                    { quoted: message }
                );
            }
        } else {
            await sock.sendMessage(
                chatId,
                {
                    text:
                        `🎵 *${video.title}*\n\n` +
                        `📥 Downloading audio...`
                },
                { quoted: message }
            );
        }

        // =========================
        // Temporary output file
        // =========================

        const tempDir = os.tmpdir();

        const safeName = (
            video.title ||
            'song'
        )
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 80);

        outputFile = path.join(
            tempDir,
            `${Date.now()}-${safeName || 'song'}.mp3`
        );

        // =========================
        // Download + convert
        // =========================

        console.log('[Song] Starting yt-dlp...');

        await runYtDlp([
            '--no-playlist',

            // Best available audio
            '-f',
            'bestaudio/best',

            // Convert to MP3
            '-x',
            '--audio-format',
            'mp3',
            '--audio-quality',
            '128K',

            // Output
            '-o',
            outputFile,

            // Avoid unnecessary output
            '--no-warnings',

            videoUrl
        ]);

        // =========================
        // Check file
        // =========================

        if (!fs.existsSync(outputFile)) {
            throw new Error('MP3 file was not created.');
        }

        const stats = fs.statSync(outputFile);

        console.log(
            `[Song] Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
        );

        if (stats.size < 10000) {
            throw new Error('Downloaded MP3 file is too small.');
        }

        // =========================
        // Read audio
        // =========================

        const audioBuffer = fs.readFileSync(outputFile);

        // =========================
        // Send to WhatsApp
        // =========================

        let fileName = (
            video.title ||
            'song'
        )
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 60);

        if (!fileName) {
            fileName = 'song';
        }

        console.log('[Song] Sending audio...');

        await sock.sendMessage(
            chatId,
            {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: `${fileName}.mp3`,
                ptt: false
            },
            { quoted: message }
        );

        // =========================
        // Success reaction
        // =========================

        await sock.sendMessage(chatId, {
            react: {
                text: '✅',
                key: message.key
            }
        });

        console.log('[Song] ✅ Sent successfully');

    } catch (error) {

        console.error('[Song] ❌ ERROR:', error.message);
        console.error('[Song] STACK:', error.stack);

        try {
            await sock.sendMessage(
                chatId,
                {
                    text:
                        `❌ *Song Download Failed*\n\n` +
                        `${error.message}\n\n` +
                        `Try again with:\n` +
                        `.song <song name>`
                },
                { quoted: message }
            );
        } catch {}

    } finally {

        // =========================
        // Delete temporary MP3
        // =========================

        if (outputFile) {
            try {
                if (fs.existsSync(outputFile)) {
                    fs.unlinkSync(outputFile);
                    console.log('[Song] Temporary file deleted');
                }
            } catch (err) {
                console.error(
                    '[Song] Cleanup error:',
                    err.message
                );
            }
        }
    }
}

module.exports = songCommand;
