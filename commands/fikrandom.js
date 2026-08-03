const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
function clearTmp() {
    const dir = os.tmpdir();

    try {
        const files = fs.readdirSync(dir);

        for (const file of files) {
            if (
    file.startsWith("rg_input_") ||
    file.startsWith("rg_output_")
) {
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
let ffmpegBusy = false;
let redgifsToken = null;
let tokenExpiry = 0;
let cacheRefillRunning = false;
const TOKEN_REFRESH_BUFFER = 300000;
const DOWNLOADED_CACHE_LIMIT = 10;

async function waitForFfmpeg() {
    while (ffmpegBusy) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    ffmpegBusy = true;
}

function releaseFfmpeg() {
    ffmpegBusy = false;
}

const CACHE_LIMIT = 300;

const INTERVAL = 15 * 1000;

async function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            await fs.promises.mkdir(path.dirname(CONFIG_PATH), {
                recursive: true
            });

            await fs.promises.writeFile(
                CONFIG_PATH,
                JSON.stringify({}, null, 2)
            );
        }

        const data = await fs.promises.readFile(CONFIG_PATH, 'utf8');
        return JSON.parse(data);

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
        tokenExpiry = now + 3600000 - TOKEN_REFRESH_BUFFER;
        console.log('✅ Token received and cached');
        return token;
    } catch (e) {
        console.log('❌ Token error:', e.message);
        throw e;
    }
}

/* =========================
   REDGIFS API - WORKING CODE
========================= */

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

        const data = response.data;
        const gifs = data?.gifs || [];

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

                if (!videoUrl) {
                    return null;
                }

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

/* =========================
   REDGIFS - SEARCH VIDEOS
========================= */

async function getRedGifsSearchVideos() {
    try {
        const searchTerms = [
    "amateur",
    "asian",
    "latina",
    "ebony",
    "milf",
    "brunette",
    "blonde",
    "solo",
    "couple",
    "outdoor",
    "cosplay",
    "lingerie",
    "bikini",
    "fitness",
    "gym",
    "tattoo",
    "college",
    "dance",
    "model",
    "selfie",
    "tiktok",
    "cute",
    "petite",
    "curvy",
    "goth",
    "coser",
    "heels",
    "stockings",
    "office",
    "maid"
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

                if (!videoUrl) {
                    return null;
                }

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

/* =========================
   MAIN VIDEO FETCHER
========================= */

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

            const exists = videoCache.some(
                v => getVideoId(v) === getVideoId(video)
            );

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
    if (videoCache.length < 100) {
        await fillVideoCache();
    }

    if (videoCache.length < 20 && !cacheLoading) {
        fillVideoCache().catch(() => {});
    }

    return videoCache;
}

/* =========================
   HELPERS
========================= */

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
        video?.url,
        video?.video_url,
        video?.video,
        video?.play_url,
        video?.download_url,
        video?.content,
        video?.media?.video,
        video?.media?.url,
        video?.video?.url,
        video?.data?.video_url,
        video?.data?.video,
        video?.source,
        video?.src,
        video?.file,
        video?.link,
        video?.videoUrl,
        video?.hd,
        video?.sd
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

/* =========================
   DOWNLOAD - SUPPORTS MP4 AND WEBM
========================= */

async function downloadVideo(url, format) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const inputExt =
        format === 'webm' || url.includes('.webm')
            ? '.webm'
            : '.mp4';

    const inputPath = path.join(
        os.tmpdir(),
        `rg_input_${id}${inputExt}`
    );

    const outputPath = path.join(
        os.tmpdir(),
        `rg_output_${id}.mp4`
    );

    try {
        const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 60000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
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
        console.log('🔄 Waiting for FFmpeg...');

        await waitForFfmpeg();

        console.log('🔄 Converting video for WhatsApp...');

        try {
            await new Promise((resolve, reject) => {
                execFile(
                    ffmpegPath,
                    [
                        '-y',
                        '-i', inputPath,

                        '-map', '0:v:0',
                        '-map', '0:a:0?',

                        '-c:v', 'libx264',
                        '-preset', 'ultrafast',
                        '-crf', '30',

                        '-pix_fmt', 'yuv420p',

                        '-c:a', 'aac',
                        '-b:a', '128k',

                        '-movflags', '+faststart',

                        outputPath
                    ],
                    {
                        timeout: 120000
                    },
                    (error, stdout, stderr) => {
    if (error) {
        console.log("❌ FFmpeg Error:");
        console.log("FFmpeg exit error:", error);
        console.log(stderr);

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

        // Landscape filtering ONLY here
        const { width, height } = await getVideoDimensions(outputPath);

        if (width > height) {
            console.log(`⏭️ Landscape skipped: ${width}x${height}`);

            await fs.promises.unlink(outputPath).catch(() => {});

            return null;
        }

        console.log(`✅ WhatsApp MP4 Ready: ${outputStats.size} bytes`);

        return {
            filePath: outputPath,
            mimetype: 'video/mp4'
        };

    } catch (e) {
        console.log(
            '❌ Download/Convert error:',
            e.message
        );

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
            [
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0:s=x",
                file
            ],
            (err, stdout) => {
                if (err) return reject(err);

                const [width, height] = stdout.trim().split("x").map(Number);

                resolve({ width, height });
            }
        );
    });
}

// Background downloader to fill downloadedCache
async function refillDownloadedCache() {
    // Prevent multiple concurrent refills
    if (cacheRefillRunning) {
        console.log('⏳ Cache refill already running, skipping...');
        return;
    }

    cacheRefillRunning = true;

    try {
        // Ensure videoCache has enough videos
        if (videoCache.length < 10) {
            await fillVideoCache();
        }

        // Get existing downloaded IDs
        const downloadedIds = new Set(downloadedCache.map(item => item.videoId));

        // Find videos not already downloaded
        const available = videoCache.filter(v => !downloadedIds.has(v.id));

        if (!available.length) {
            console.log('⚠️ No new videos available for download cache');
            return;
        }

        // Download up to DOWNLOADED_CACHE_LIMIT videos
        for (const video of available) {
            if (downloadedCache.length >= DOWNLOADED_CACHE_LIMIT) break;
            
            // Check again if already downloaded (prevent race condition)
            if (downloadedCache.some(v => v.videoId === video.id)) continue;

            console.log(`📥 Pre-downloading: ${video.id}`);
            const result = await downloadVideo(video.url, video.format || 'mp4');
            
            if (result) {
                downloadedCache.push({
                    filePath: result.filePath,
                    mimetype: result.mimetype,
                    videoId: video.id
                });
                // Remove from videoCache to prevent duplicate downloads
                const idx = videoCache.findIndex(v => v.id === video.id);
                if (idx !== -1) videoCache.splice(idx, 1);
                console.log(`✅ Pre-download complete (${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT})`);
            }
        }

    } catch (e) {
        console.log('❌ Refill cache error:', e.message);
    } finally {
        cacheRefillRunning = false;
    }
}

/* =========================
   SEND RANDOM VIDEO
========================= */
async function sendRandomFikFap(sock, chatId) {
    const key = getKey(chatId, 'fikfap');

    if (running.has(key)) {
        return false;
    }

    running.add(key);

    try {
        // If downloadedCache has ready videos, use them
        if (downloadedCache.length > 0) {
            const cachedItem = downloadedCache.shift();

            if (cachedItem) {
                const { filePath, mimetype, videoId } = cachedItem;

                try {
                    await sock.sendMessage(chatId, {
                        video: fs.readFileSync(filePath),
                        mimetype: "video/mp4",
                        caption: "> DOWNLOADED BY SALMAN"
                    });
                } finally {
                    try {
                        if (fs.existsSync(filePath)) {
                            await fs.promises.unlink(filePath);
                        }
                    } catch {}
                }

                if (!usedVideos.has(key)) {
                    usedVideos.set(key, new Set());
                }
                usedVideos.get(key).add(videoId);

                console.log(`✅ Video sent from cache: ${videoId}`);
                console.log(`📦 Downloaded cache: ${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT}`);

                // Trigger background refill
                if (downloadedCache.length <= 5) {
    refillDownloadedCache().catch(() => {});
}

                return true;
            }
        }

        // If no cached videos, fallback to direct download
        const videos = await getCachedVideos();

        if (!videos || !videos.length) {
            throw new Error('❌ No videos available');
        }

        if (!usedVideos.has(key)) {
            usedVideos.set(key, new Set());
        }

        const used = usedVideos.get(key);

        let available = videos.filter(video => {
            const id = getVideoId(video);
            return id && !used.has(id);
        });

        if (!available.length) {
            console.log('🔄 All videos used, resetting');
            used.clear();
            available = videos;
        }

        available.sort(() => Math.random() - 0.5);

        for (const video of available) {
            const videoId = getVideoId(video);

            try {
                const videoUrl = getVideoUrl(video);

                if (!videoUrl) {
                    console.log(`❌ No URL for video ${videoId}`);
                    continue;
                }

                console.log(`📥 Downloading: ${videoUrl}`);

                const result = await downloadVideo(videoUrl, video.format || 'mp4');

                if (!result) {
                    const index = videoCache.findIndex(
                        v => getVideoId(v) === videoId
                    );

                    if (index !== -1) {
                        videoCache.splice(index, 1);
                    }

                    continue;
                }

                const { filePath, mimetype } = result;

                const caption = `> DOWNLOADED BY SALMAN`;

                try {
                    await sock.sendMessage(chatId, {
                        video: fs.readFileSync(filePath),
                        mimetype: "video/mp4",
                        caption
                    });
                } finally {
                    try {
                        if (fs.existsSync(filePath)) {
                            await fs.promises.unlink(filePath);
                        }
                    } catch {}
                }

                used.add(videoId);

                const index = videoCache.findIndex(
                    v => getVideoId(v) === videoId
                );

                if (index !== -1) {
                    videoCache.splice(index, 1);
                }

                console.log(`✅ Video sent: ${videoId}`);

                // Trigger background refill
                if (downloadedCache.length <= 2) {
    refillDownloadedCache().catch(() => {});
}

                return true;

            } catch (e) {
                console.log(`❌ Video ${videoId} failed:`, e);
                continue;
            }
        }

        throw new Error('❌ No playable video found');

    } catch (error) {
        console.log('❌ Send error:', error.message);
        throw error;
    } finally {
        running.delete(key);
    }
}

/* =========================
   TIMERS
========================= */

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

/* =========================
   COMMAND - .fikrandom
========================= */

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

        // Trigger background refill on start
        

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

// Initial background fill on startup


module.exports = randomCommand;