const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const CONFIG_PATH = path.join(__dirname, '../data/random.json');

const timers = new Map();
const usedVideos = new Map();
const running = new Set();
const videoCache = [];
const downloadedCache = [];
let cacheLoading = false;
let backgroundWorkerActive = false;
let ffmpegBusy = false;
let redgifsToken = null;
let tokenExpiry = 0;

const CACHE_LIMIT = 200;
const DOWNLOADED_CACHE_LIMIT = 5;
const INTERVAL = 15 * 1000;
const MAX_PARALLEL_DOWNLOADS = 1;
const TOKEN_REFRESH_BUFFER = 300000; // 5 minutes before expiry

function clearTmp() {
    const dir = os.tmpdir();
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (file.startsWith("rg_input_") || file.startsWith("rg_output_")) {
                try {
                    fs.unlinkSync(path.join(dir, file));
                } catch {}
            }
        }
        console.log("✅ Temp cleaned");
    } catch (e) {
        console.log(e.message);
    }
}

async function waitForFfmpeg() {
    while (ffmpegBusy) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    ffmpegBusy = true;
}

function releaseFfmpeg() {
    ffmpegBusy = false;
}

async function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            await fs.promises.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
            await fs.promises.writeFile(CONFIG_PATH, JSON.stringify({}, null, 2));
        }
        const data = await fs.promises.readFile(CONFIG_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
        console.log('Random config error:', e.message);
    }
}

function getKey(chatId, type) {
    return `${chatId}:${type}`;
}

async function getRedGifsToken() {
    const now = Date.now();
    if (redgifsToken && now < tokenExpiry) {
        return redgifsToken;
    }

    try {
        console.log('🔑 Getting RedGifs token...');
        const response = await axios.get(
            'https://api.redgifs.com/v2/auth/temporary',
            {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
                }
            }
        );

        const token = response.data?.token;
        if (!token) {
            throw new Error('No token received');
        }

        redgifsToken = token;
        tokenExpiry = now + 3600000 - TOKEN_REFRESH_BUFFER; // 1 hour expiry
        console.log('✅ Token received and cached');
        return token;
    } catch (e) {
        console.log('❌ Token error:', e.message);
        throw e;
    }
}

async function getRedGifsVideos() {
    try {
        const token = await getRedGifsToken();
        const page = Math.floor(Math.random() * 20) + 1;
        
        const response = await axios.get(
            `https://api.redgifs.com/v2/gifs/trending?count=100&page=${page}`,
            {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            }
        );

        const gifs = response.data?.gifs || [];
        if (!gifs.length) {
            throw new Error('No gifs found');
        }

        const videos = gifs
            .map(g => {
                let videoUrl = null;
                let format = 'mp4';
                if (g.urls?.mp4) {
                    videoUrl = g.urls.mp4;
                    format = 'mp4';
                } else if (g.urls?.sd && g.urls.sd.includes('.webm')) {
                    videoUrl = g.urls.sd;
                    format = 'webm';
                } else if (g.urls?.hd) {
                    videoUrl = g.urls.hd;
                    format = 'mp4';
                } else if (g.videoUrl) {
                    videoUrl = g.videoUrl;
                    format = 'mp4';
                }
                if (!videoUrl) return null;
                return {
                    id: g.id || `redgif_${Date.now()}`,
                    url: videoUrl,
                    format: format,
                    title: g.title || 'RedGifs Video',
                    source: 'RedGifs',
                    duration: g.duration,
                    views: g.views,
                    likes: g.likes,
                    userName: g.userName
                };
            })
            .filter(g => g !== null);

        console.log(`✅ RedGifs: ${videos.length} videos found`);
        return videos;
    } catch (e) {
        console.log('❌ RedGifs error:', e.message);
        return [];
    }
}

async function getRedGifsSearchVideos() {
    try {
        const searchTerms = [
            "amateur", "asian", "latina", "ebony", "milf", "brunette", "blonde",
            "solo", "couple", "outdoor", "cosplay", "lingerie", "bikini", "fitness",
            "gym", "tattoo", "college", "dance", "model", "selfie", "tiktok",
            "cute", "petite", "curvy", "goth", "coser", "heels", "stockings",
            "office", "maid"
        ];
        const search = searchTerms[Math.floor(Math.random() * searchTerms.length)];
        const token = await getRedGifsToken();
        const page = Math.floor(Math.random() * 20) + 1;
        
        const response = await axios.get(
            `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(search)}&count=100&page=${page}`,
            {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            }
        );

        const gifs = response.data?.gifs || [];
        const videos = gifs
            .map(g => {
                let videoUrl = null;
                let format = 'mp4';
                if (g.urls?.mp4) {
                    videoUrl = g.urls.mp4;
                    format = 'mp4';
                } else if (g.urls?.sd && g.urls.sd.includes('.webm')) {
                    videoUrl = g.urls.sd;
                    format = 'webm';
                } else if (g.urls?.hd) {
                    videoUrl = g.urls.hd;
                    format = 'mp4';
                } else if (g.videoUrl) {
                    videoUrl = g.videoUrl;
                    format = 'mp4';
                }
                if (!videoUrl) return null;
                return {
                    id: g.id || `redgif_${Date.now()}`,
                    url: videoUrl,
                    format: format,
                    title: g.title || 'RedGifs Video',
                    source: 'RedGifs',
                    duration: g.duration,
                    views: g.views,
                    likes: g.likes,
                    userName: g.userName
                };
            })
            .filter(g => g !== null);

        console.log(`✅ RedGifs Search (${search}): ${videos.length} videos found`);
        return videos;
    } catch (e) {
        console.log('❌ RedGifs Search error:', e.message);
        return [];
    }
}

async function getAdultVideos() {
    console.log('📡 Fetching RedGifs videos...');
    let videos = [];

    const trending = await getRedGifsVideos();
    if (trending.length) videos.push(...trending);

    const results = await Promise.all(
        Array.from({ length: 3 }, () => getRedGifsSearchVideos())
    );
    for (const searchVideos of results) {
        if (searchVideos.length) {
            videos.push(...searchVideos);
        }
    }

    const uniqueVideos = [];
    const seen = new Set();
    for (const v of videos.sort(() => Math.random() - 0.5)) {
        const id = getVideoId(v);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        uniqueVideos.push(v);
        if (uniqueVideos.length >= CACHE_LIMIT) break;
    }

    if (uniqueVideos.length) {
        console.log(`✅ TOTAL: ${uniqueVideos.length} videos found`);
        return uniqueVideos;
    }
    throw new Error('❌ No videos found');
}

async function fillVideoCache() {
    if (cacheLoading) return;
    cacheLoading = true;
    try {
        console.log('🔄 Filling video cache...');
        const videos = await getAdultVideos();
        for (const video of videos) {
            if (videoCache.length >= CACHE_LIMIT) break;
            const exists = videoCache.some(v => getVideoId(v) === getVideoId(video));
            if (!exists) {
                videoCache.push(video);
            }
        }
        console.log(`⚡ Cache ready: ${videoCache.length} videos`);
    } catch (e) {
        console.log('❌ Cache Error:', e.message);
    } finally {
        cacheLoading = false;
    }
}

async function getCachedVideos() {
    if (videoCache.length < 50) {
        await fillVideoCache();
    }
    return videoCache;
}

function getVideoId(video) {
    return String(
        video?.id ||
        video?.video_id ||
        video?.post_id ||
        video?._id ||
        `vid_${Date.now()}_${Math.random()}`
    );
}

function getVideoUrl(video) {
    if (typeof video === 'string' && /^https?:\/\//i.test(video)) {
        return video;
    }
    const urls = [
        video?.url, video?.video_url, video?.video, video?.play_url,
        video?.download_url, video?.content, video?.media?.video,
        video?.media?.url, video?.video?.url, video?.data?.video_url,
        video?.data?.video, video?.source, video?.src, video?.file,
        video?.link, video?.videoUrl, video?.hd, video?.sd
    ];
    for (const url of urls) {
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
            return url;
        }
    }
    return null;
}

function getVideoTitle(video) {
    const title = String(
        video?.title ||
        video?.caption ||
        video?.description ||
        video?.text ||
        video?.name ||
        'Video'
    );
    return title.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Video';
}

async function downloadAndConvertVideo(video) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputExt = video.format === 'webm' || video.url.includes('.webm') ? '.webm' : '.mp4';
    const inputPath = path.join(os.tmpdir(), `rg_input_${id}${inputExt}`);
    const outputPath = path.join(os.tmpdir(), `rg_output_${id}.mp4`);

    try {
        const response = await axios.get(video.url, {
            responseType: 'stream',
            timeout: 60000,
            maxContentLength: 50 * 1024 * 1024,
            maxBodyLength: 50 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': '*/*',
                'Referer': 'https://redgifs.com/'
            }
        });

        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(inputPath);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
            response.data.on('error', reject);
        });

        const inputStats = await fs.promises.stat(inputPath);
        if (inputStats.size < 50000) {
            throw new Error('Video too small');
        }

        console.log(`📥 Downloaded: ${inputStats.size} bytes`);
        await waitForFfmpeg();
        console.log('🔄 Converting video for WhatsApp...');

        try {
            await new Promise((resolve, reject) => {
                execFile(
                    ffmpegPath,
                    [
                        '-y', '-i', inputPath,
                        '-map', '0:v:0', '-map', '0:a:0?',
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
                        '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', '-b:a', '128k',
                        '-movflags', '+faststart',
                        outputPath
                    ],
                    { timeout: 120000 },
                    (error) => {
                        if (error) {
                            console.log('❌ FFmpeg Error:', error);
                            return reject(error);
                        }
                        resolve();
                    }
                );
            });
        } finally {
            releaseFfmpeg();
        }

        if (!fs.existsSync(outputPath)) {
            throw new Error('Converted video not created');
        }

        const outputStats = await fs.promises.stat(outputPath);
        if (outputStats.size < 50000) {
            throw new Error('Converted video invalid');
        }

        // Check dimensions - portrait only
        const { width, height } = await getVideoDimensions(outputPath);
        if (width > height) {
            console.log(`⏭️ Landscape skipped: ${width}x${height}`);
            await fs.promises.unlink(outputPath).catch(() => {});
            return null;
        }

        console.log(`✅ WhatsApp MP4 Ready: ${outputStats.size} bytes`);
        return {
    filePath: outputPath,
    mimetype: "video/mp4",
    videoId: video.id,
    video
};

    } catch (e) {
        console.log('❌ Download/Convert error:', e.message);
        return null;
    } finally {
        try {
            if (fs.existsSync(inputPath)) {
                await fs.promises.unlink(inputPath);
            }
        } catch {}
    }
}

function getVideoDimensions(file) {
    return new Promise((resolve, reject) => {
        execFile(
            ffprobePath,
            ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file],
            (err, stdout) => {
                if (err) return reject(err);
                const [width, height] = stdout.trim().split("x").map(Number);
                resolve({ width, height });
            }
        );
    });
}

async function backgroundDownloader() {
    if (backgroundWorkerActive) return;
    if (downloadedCache.length >= DOWNLOADED_CACHE_LIMIT) return;

    backgroundWorkerActive = true;
    console.log(`🔄 Background downloader started (${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT})`);

    try {
        if (videoCache.length < 20) {
            await fillVideoCache();
        }

        const existingIds = new Set(downloadedCache.map(v => v.videoId));
        const available = videoCache.filter(v => !existingIds.has(v.id));

        if (!available.length) {
            console.log('⚠️ No new videos available for background download');
            backgroundWorkerActive = false;
            return;
        }

        const toDownload = available.slice(0, Math.min(MAX_PARALLEL_DOWNLOADS * 2, DOWNLOADED_CACHE_LIMIT - downloadedCache.length));
        console.log(`📥 Downloading ${toDownload.length} videos in background (${MAX_PARALLEL_DOWNLOADS} parallel)...`);

        // Download in parallel chunks
        for (let i = 0; i < toDownload.length; i += MAX_PARALLEL_DOWNLOADS) {
            if (downloadedCache.length >= DOWNLOADED_CACHE_LIMIT) break;
            
            const chunk = toDownload.slice(i, i + MAX_PARALLEL_DOWNLOADS);
            const results = await Promise.all(
                chunk.map(async (video) => {
                    if (downloadedCache.some(v => v.videoId === video.id)) return null;
                    const result = await downloadAndConvertVideo(video);
                    if (result) {
                        const idx = videoCache.findIndex(v => v.id === video.id);
                        if (idx !== -1) videoCache.splice(idx, 1);
                    }
                    return result;
                })
            );

            for (const result of results) {
                if (result && downloadedCache.length < DOWNLOADED_CACHE_LIMIT) {
                    downloadedCache.push(result);
                    console.log("📦 Cached:", result.videoId);
                    console.log(`✅ Background download complete (${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT})`);
                }
            }
        }

    } catch (e) {
        console.log('❌ Background downloader error:', e.message);
    } finally {
        backgroundWorkerActive = false;
        console.log(`🔄 Background downloader stopped (${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT})`);

        if (downloadedCache.length < DOWNLOADED_CACHE_LIMIT) {
            setTimeout(() => backgroundDownloader(), 3000);
        }
    }
}

function triggerBackgroundFill() {
    if (!backgroundWorkerActive && downloadedCache.length < DOWNLOADED_CACHE_LIMIT) {
        backgroundDownloader().catch(() => {});
    }
}
async function sendRandomFikFap(sock, chatId) {
    const key = getKey(chatId, 'fikfap');

    if (running.has(key)) {
        return false;
    }

    running.add(key);

    try {
        if (downloadedCache.length === 0) {
            console.log('⏳ No downloaded videos ready, waiting...');
            await backgroundDownloader();
            let waited = 0;
            while (downloadedCache.length === 0 && waited < 30) {
                await new Promise(r => setTimeout(r, 1000));
                waited++;
            }
        }

        const cachedItem = downloadedCache.shift();

        if (!cachedItem) {
            throw new Error('❌ No downloaded video available');
        }

        const { filePath, mimetype, videoId } = cachedItem;

        await sock.sendMessage(chatId, {
            video: fs.createReadStream(filePath),
            mimetype: "video/mp4",
            caption: "> DOWNLOADED BY SALMAN"
        });

        if (!usedVideos.has(key)) {
            usedVideos.set(key, new Set());
        }
        usedVideos.get(key).add(videoId);

        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
        } catch {}

        console.log(`✅ Video sent: ${videoId}`);
        console.log(`📦 Downloaded cache: ${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT}`);

        triggerBackgroundFill();

        return true;

    } catch (error) {
        console.log('❌ Send error:', error.message);
        throw error;
    } finally {
        running.delete(key);
    }
}

function stopTimer(chatId, type) {
    const key = getKey(chatId, type);
    const timer = timers.get(key);
    if (timer) {
        clearTimeout(timer);
        timers.delete(key);
    }
}

function startTimer(sock, chatId, type) {
    stopTimer(chatId, type);
    const key = getKey(chatId, type);

    const run = async () => {
        const config = await loadConfig();
        if (!config[chatId]?.[type]) {
            stopTimer(chatId, type);
            return;
        }
        try {
            if (type === 'fikfap') {
                await sendRandomFikFap(sock, chatId);
            }
        } catch (e) {
            console.log(`❌ Random ${type} Error:`, e.message);
        }
        const latestConfig = await loadConfig();
        if (latestConfig[chatId]?.[type]) {
            const timer = setTimeout(run, INTERVAL);
            timers.set(key, timer);
        }
    };

    const timer = setTimeout(run, INTERVAL);
    timers.set(key, timer);
}

async function randomCommand(sock, from, msg, args) {
    try {
        const action = args?.[0]?.toLowerCase();

        if (!['on', 'off'].includes(action)) {
            return await sock.sendMessage(
                from,
                {
                    text: '❌ Usage:\n\n.fikrandom on\n.fikrandom off'
                },
                { quoted: msg }
            );
        }

        const type = 'fikfap';
        const config = await loadConfig();

        if (!config[from]) {
            config[from] = {};
        }

        if (action === 'off') {
            config[from][type] = false;
            saveConfig(config);
            stopTimer(from, type);

            return await sock.sendMessage(
                from,
                {
                    text: '❌ RedGifs Random OFF!'
                },
                { quoted: msg }
            );
        }

        config[from][type] = true;
        saveConfig(config);

        await sock.sendMessage(
            from,
            {
                text: '✅ RedGifs Random ON!\n' +
                      '🎥 First video sending now.\n' +
                      '⏱️ Next video every 15 seconds.'
            },
            { quoted: msg }
        );

        triggerBackgroundFill();

        sendRandomFikFap(sock, from).catch(error => {
            console.log('❌ First Video Error:', error.message);
            sock.sendMessage(from, {
                text: `❌ ${error.message}`
            }).catch(() => {});
        });

        startTimer(sock, from, type);

    } catch (error) {
        console.log('❌ Command Error:', error.message);

        await sock.sendMessage(
            from,
            {
                text: `❌ Error: ${error.message}`
            },
            { quoted: msg }
        ).catch(() => {});
    }
}

// Initial background fill
//triggerBackgroundFill();

module.exports = randomCommand;