const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ttdl } = require('ruhend-scraper');

const CONFIG_PATH = path.join(__dirname, '../data/random.json');

const DELAY = 15 * 1000;

const timers = new Map();
const usedVideos = new Map();
const running = new Set();

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.mkdirSync(path.dirname(CONFIG_PATH), {
                recursive: true
            });

            fs.writeFileSync(
                CONFIG_PATH,
                JSON.stringify({}, null, 2)
            );
        }

        return JSON.parse(
            fs.readFileSync(CONFIG_PATH, 'utf8')
        );
    } catch {
        return {};
    }
}

function saveConfig(config) {
    try {
        fs.writeFileSync(
            CONFIG_PATH,
            JSON.stringify(config, null, 2)
        );
    } catch (e) {
        console.log('Random config error:', e.message);
    }
}

const FEED_KEYWORDS = [
    'girl', 'girls', 'dance', 'dancing', 'fashion', 'model',
    'glam', 'style', 'outfit', 'beauty', 'fitness', 'desi',
    'makeup', 'viral', 'trend'
];

function feedScore(video) {
    const text = [
        video?.title,
        video?.desc,
        video?.description,
        video?.author?.nickname,
        video?.music_info?.title
    ].filter(Boolean).join(' ').toLowerCase();

    return FEED_KEYWORDS.reduce(
        (score, keyword) => score + (text.includes(keyword) ? 1 : 0),
        0
    );
}

async function getTrendingVideos() {
    const regions = ['PK', 'US', 'GB', 'ID'];

    for (const region of regions) {
        try {
            const response = await axios.get(
                `https://www.tikwm.com/api/feed/list?region=${region}&count=30`,
                {
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        Accept: 'application/json'
                    }
                }
            );

            const data = response.data;

            const lists = [
                data?.data,
                data?.data?.list,
                data?.data?.videos,
                data?.data?.aweme_list,
                data?.list,
                data?.videos
            ];

            for (const list of lists) {
                if (Array.isArray(list) && list.length) {
                    return [...list].sort((a, b) => {
                        const diff = feedScore(b) - feedScore(a);
                        return diff || (Math.random() - 0.5);
                    });
                }
            }

        } catch (e) {
            console.log(
                `Feed ${region} skipped:`,
                e.message
            );
        }
    }

    return [];
}

function getVideoId(video) {
    return String(
        video?.video_id ||
        video?.aweme_id ||
        video?.id ||
        ''
    );
}

function getTikTokLink(video) {
    const id = getVideoId(video);

    const username =
        video?.author?.unique_id ||
        video?.author?.uniqueId ||
        video?.author?.username;

    if (!id || !username) {
        return null;
    }

    return `https://www.tiktok.com/@${username}/video/${id}`;
}

function getDirectUrl(video) {
    const urls = [
        video?.play,
        video?.wmplay,
        video?.download,
        video?.video_url,
        video?.data?.play,
        video?.data?.nowm,
        video?.video?.play_addr?.url_list?.[0],
        video?.video?.download_addr?.url_list?.[0]
    ];

    return urls.find(
        url =>
            typeof url === 'string' &&
            /^https?:\/\//i.test(url)
    );
}

async function resolveVideo(video) {
    const directUrl = getDirectUrl(video);

    if (directUrl) {
        return directUrl;
    }

    const link = getTikTokLink(video);

    if (!link) {
        return null;
    }

    try {
        const data = await Promise.race([
            ttdl(link),

            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error('TTDL timeout')),
                    15000
                )
            )
        ]);

        let url;

        if (typeof data === 'string') {
            url = data;
        } else {
            url =
                data?.video ||
                data?.video_url ||
                data?.download ||
                data?.url ||
                data?.data?.video ||
                data?.data?.play ||
                data?.data?.nowm;
        }

        if (typeof url === 'function') {
            url = await url();
        }

        if (
            typeof url === 'string' &&
            /^https?:\/\//i.test(url)
        ) {
            return url;
        }

    } catch (e) {
        console.log('Resolve skipped:', e.message);
    }

    return null;
}

async function downloadVideo(url) {
    const filePath = path.join(os.tmpdir(), `tiktok_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
    try {
        const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024,
            maxBodyLength: 50 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
                Accept: 'video/mp4,video/*,*/*',
                Referer: 'https://www.tiktok.com/'
            }
        });

        let total = 0;
        const writer = fs.createWriteStream(filePath);
        await new Promise((resolve, reject) => {
            response.data.on('data', chunk => {
                total += chunk.length;
                if (total > 50 * 1024 * 1024) response.data.destroy(new Error('Video exceeds 50MB'));
            });
            response.data.on('error', reject);
            writer.on('error', reject);
            writer.on('finish', resolve);
            response.data.pipe(writer);
        });

        if (total < 50000) throw new Error('Video too small');

        const fd = fs.openSync(filePath, 'r');
        const headerBuffer = Buffer.alloc(64);
        fs.readSync(fd, headerBuffer, 0, 64, 0);
        fs.closeSync(fd);

        const header = headerBuffer.toString('latin1');
        if (!header.includes('ftyp')) {
            throw new Error('Skipped non-MP4 TikTok video');
        }

        return filePath;
    } catch (e) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        console.log('Download skipped:', e.message);
        return null;
    }
}

async function sendRandomTikTok(sock, chatId) {
    if (running.has(chatId)) {
        return false;
    }

    running.add(chatId);

    try {
        const videos = await getTrendingVideos();

        if (!videos.length) {
            throw new Error('No TikTok videos found');
        }

        if (!usedVideos.has(chatId)) {
            usedVideos.set(chatId, new Set());
        }

        const used = usedVideos.get(chatId);

        let available = videos.filter(video => {
            const id = getVideoId(video);

            return id && !used.has(id);
        });

        if (!available.length) {
            used.clear();
            available = videos;
        }

        available.sort(() => Math.random() - 0.5);

        for (const video of available.slice(0, 8)) {
            const videoId = getVideoId(video);

            try {
                const videoUrl = await resolveVideo(video);

                if (!videoUrl) {
                    continue;
                }

                const filePath = await downloadVideo(videoUrl);

                if (!filePath) continue;

                try {
                    await sock.sendMessage(chatId, {
                        video: { url: filePath },
                        mimetype: 'video/mp4',
                        caption: '> DOWNLOADED BY SALMAN'
                    });
                } finally {
                    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
                }

                used.add(videoId);

                console.log(
                    `Random TikTok sent: ${videoId}`
                );

                return true;

            } catch (e) {
                console.log(
                    `Video ${videoId} skipped:`,
                    e.message
                );
            }
        }

        throw new Error('No playable TikTok video found');

    } finally {
        running.delete(chatId);
    }
}

function stopTimer(chatId) {
    const timer = timers.get(chatId);

    if (timer) {
        clearTimeout(timer);
        timers.delete(chatId);
    }
}

function startTimer(sock, chatId) {
    stopTimer(chatId);

    const run = async () => {
        const config = loadConfig();

        if (!config[chatId]?.tiktok) {
            stopTimer(chatId);
            return;
        }

        try {
            await sendRandomTikTok(sock, chatId);
        } catch (e) {
            console.log(
                'Random TikTok Error:',
                e.message
            );
        }

        const latestConfig = loadConfig();

        if (latestConfig[chatId]?.tiktok) {
            const timer = setTimeout(
                run,
                DELAY
            );

            timers.set(chatId, timer);
        }
    };

    const timer = setTimeout(
        run,
        DELAY
    );

    timers.set(chatId, timer);
}

async function randomCommand(sock, from, msg, args) {
    try {
        const type = args?.[0]?.toLowerCase();
        const action = args?.[1]?.toLowerCase();

        if (
            type !== 'tiktok' ||
            !['on', 'off'].includes(action)
        ) {
            return await sock.sendMessage(
                from,
                {
                    text:
                        '❌ Usage:\n' +
                        '.random tiktok on\n' +
                        '.random tiktok off'
                },
                { quoted: msg }
            );
        }

        const config = loadConfig();

        if (!config[from]) {
            config[from] = {};
        }

        if (action === 'off') {
            config[from].tiktok = false;

            saveConfig(config);
            stopTimer(from);

            return await sock.sendMessage(
                from,
                {
                    text: '❌ Random TikTok OFF!'
                },
                { quoted: msg }
            );
        }

        config[from].tiktok = true;
        saveConfig(config);

        await sock.sendMessage(
            from,
            {
                text:
                    '✅ Random TikTok ON!\n' +
                    '🎥 First video sending now.\n' +
                    '⏱️ Next video after 15 seconds.'
            },
            { quoted: msg }
        );

        await sendRandomTikTok(
            sock,
            from
        ).catch(error => {
            console.log(
                'First Random Error:',
                error.message
            );
        });

        startTimer(sock, from);

    } catch (error) {
        console.log(
            'Random Command Error:',
            error.message
        );

        await sock.sendMessage(
            from,
            {
                text:
                    `❌ Random TikTok Error: ${error.message}`
            },
            { quoted: msg }
        ).catch(() => {});
    }
}

module.exports = randomCommand;