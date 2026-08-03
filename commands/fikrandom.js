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

// ==================== CACHE SYSTEMS ====================
const videoCache = [];
const downloadedCache = [];
const downloadQueue = [];
let isProcessingQueue = false;

let cacheLoading = false;
let ffmpegBusy = false;
let cacheRefillRunning = false;
let redgifsToken = null;
let tokenExpiry = 0;

const TOKEN_REFRESH_BUFFER = 300000;
const CACHE_LIMIT = 100;
const DOWNLOADED_CACHE_LIMIT = 50;
const MAX_CONCURRENT_DOWNLOADS = 2;
const FFMPEG_CONCURRENCY = 1;
const CACHE_REFILL_THRESHOLD = 30;
const MAX_RETRIES = 3;

const INTERVAL = 15 * 1000;

// ==================== UTILITY FUNCTIONS ====================

function clearTmp() {
    const dir = os.tmpdir();
    try {
        const files = fs.readdirSync(dir);
        let cleaned = 0;
        for (const file of files) {
            if (file.startsWith("rg_input_") || file.startsWith("rg_output_")) {
                try {
                    fs.unlinkSync(path.join(dir, file));
                    cleaned++;
                } catch {}
            }
        }
        if (cleaned > 0) console.log(`✅ Temp cleaned: ${cleaned} files`);
    } catch (e) {
        console.log(e.message);
    }
}

async function waitForFfmpeg() {
    let waited = 0;
    while (ffmpegBusy) {
        await new Promise(resolve => setTimeout(resolve, 200));
        waited++;
        if (waited % 50 === 0) {
            console.log(`⏳ FFmpeg waiting... (${waited * 0.2}s)`);
        }
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

// ==================== REDGIFS API WITH TOKEN CACHING ====================

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
        console.log('✅ Token received and cached (expires in ~55 min)');
        return token;
    } catch (e) {
        console.log('❌ Token error:', e.message);
        throw e;
    }
}

// ==================== REDGIFS API FUNCTIONS ====================

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

// ==================== VIDEO METADATA CACHE ====================

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

// ==================== HELPERS ====================

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

// ==================== VIDEO DIMENSIONS ====================

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

// ==================== DOWNLOAD & CONVERT WITH RETRY ====================

async function downloadVideoWithRetry(url, format, retryCount = 0) {
    try {
        const result = await downloadVideo(url, format);
        if (result) return result;
        
        if (retryCount < MAX_RETRIES) {
            console.log(`🔄 Retry ${retryCount + 1}/${MAX_RETRIES} for download...`);
            await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
            return downloadVideoWithRetry(url, format, retryCount + 1);
        }
        return null;
    } catch (e) {
        if (retryCount < MAX_RETRIES) {
            console.log(`🔄 Retry ${retryCount + 1}/${MAX_RETRIES} (error: ${e.message})...`);
            await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
            return downloadVideoWithRetry(url, format, retryCount + 1);
        }
        console.log(`❌ Failed after ${MAX_RETRIES} retries:`, e.message);
        return null;
    }
}

async function downloadVideo(url, format) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputExt = format === 'webm' || url.includes('.webm') ? '.webm' : '.mp4';
    const inputPath = path.join(os.tmpdir(), `rg_input_${id}${inputExt}`);
    const outputPath = path.join(os.tmpdir(), `rg_output_${id}.mp4`);

    try {
        console.log(`📥 Download started: ${url.substring(0, 80)}...`);

        const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 30000,
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
            throw new Error('Video too small (< 50KB)');
        }

        console.log(`✅ Download completed: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB`);

        // FFmpeg conversion with retry
        let conversionResult = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                await waitForFfmpeg();
                conversionResult = await convertWithFFmpeg(inputPath, outputPath);
                break;
            } catch (e) {
                console.log(`🔄 FFmpeg attempt ${attempt + 1}/${MAX_RETRIES} failed:`, e.message);
                releaseFfmpeg();
                if (attempt === MAX_RETRIES - 1) throw e;
                await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            }
        }

        if (!conversionResult) {
            throw new Error('FFmpeg conversion failed after retries');
        }

        // 🔥 LANDSCAPE FILTERING - ONLY HERE
        const { width, height } = await getVideoDimensions(outputPath);

        if (width > height) {
            console.log(`⏭️ Landscape skipped: ${width}x${height}`);
            await fs.promises.unlink(outputPath).catch(() => {});
            return null;
        }

        const outputStats = await fs.promises.stat(outputPath);
        console.log(`✅ WhatsApp MP4 ready: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);

        return {
            filePath: outputPath,
            mimetype: 'video/mp4'
        };

    } catch (e) {
        console.log('❌ Download/Convert error:', e.message);
        return null;
    } finally {
        // Clean up input file immediately after conversion
        try {
            if (fs.existsSync(inputPath)) {
                await fs.promises.unlink(inputPath);
                console.log(`🗑️ Cleaned up input: ${inputPath}`);
            }
        } catch {}
    }
}

async function convertWithFFmpeg(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        execFile(
            ffmpegPath,
            [
                '-y', '-i', inputPath,
                '-map', '0:v:0', '-map', '0:a:0?',
                '-c:v', 'libx264', '-preset', 'superfast', '-crf', '32',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                outputPath
            ],
            { timeout: 120000 },
            (error) => {
                releaseFfmpeg();
                if (error) {
                    console.log('❌ FFmpeg Error:', error.message);
                    reject(error);
                } else {
                    console.log('✅ FFmpeg conversion completed');
                    resolve(true);
                }
            }
        );
    });
}

// ==================== DOWNLOAD QUEUE ====================

function enqueueDownload(video, callback) {
    downloadQueue.push({ video, callback });
    if (!isProcessingQueue) {
        processQueue();
    }
}

async function processQueue() {
    if (isProcessingQueue || downloadQueue.length === 0) return;
    isProcessingQueue = true;

    try {
        while (downloadQueue.length > 0) {
            const batch = downloadQueue.splice(0, MAX_CONCURRENT_DOWNLOADS);

            await Promise.all(
                batch.map(async (item) => {
                    try {
                        console.log(`📥 Queue processing: ${item.video.id}`);
                        const result = await downloadVideoWithRetry(item.video.url, item.video.format || 'mp4');
                        item.callback(result, item.video);
                    } catch (e) {
                        console.log('❌ Download queue error:', e.message);
                        item.callback(null, item.video);
                    }
                })
            );

            if (downloadQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    } catch (e) {
        console.log('❌ Queue processor error:', e.message);
    } finally {
        isProcessingQueue = false;
        if (downloadQueue.length > 0) {
            // Restart queue if new items were added
            processQueue().catch(() => {});
        }
    }
}

// ==================== DOWNLOADED CACHE ====================

async function refillDownloadedCache() {
    if (cacheRefillRunning) {
        console.log('⏳ Cache refill already running, skipping...');
        return;
    }

    if (downloadedCache.length >= DOWNLOADED_CACHE_LIMIT) {
        console.log(`✅ Downloaded cache full: ${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT}`);
        return;
    }

    cacheRefillRunning = true;

    try {
        console.log(`🔄 Refilling downloaded cache (${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT})...`);

        if (videoCache.length < 20) {
            await fillVideoCache();
        }

        const downloadedIds = new Set(downloadedCache.map(item => item.videoId));
        const usedIds = new Set();
        for (const [key, usedSet] of usedVideos) {
            for (const id of usedSet) {
                usedIds.add(id);
            }
        }

        const available = videoCache.filter(v => 
            !downloadedIds.has(v.id) && !usedIds.has(v.id)
        );

        if (!available.length) {
            console.log('⚠️ No new videos available for download cache');
            return;
        }

        const needed = DOWNLOADED_CACHE_LIMIT - downloadedCache.length;
        const toDownload = available.slice(0, Math.min(needed, available.length));

        console.log(`📥 Downloading ${toDownload.length} videos in background...`);

        let downloaded = 0;
        const downloadPromises = toDownload.map((video) => {
            return new Promise((resolve) => {
                enqueueDownload(video, (result, videoData) => {
                    if (result) {
                        downloadedCache.push({
                            filePath: result.filePath,
                            mimetype: result.mimetype,
                            videoId: videoData.id
                        });

                        const idx = videoCache.findIndex(v => v.id === videoData.id);
                        if (idx !== -1) videoCache.splice(idx, 1);

                        downloaded++;
                        console.log(`✅ Pre-download complete (${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT})`);
                    } else {
                        const idx = videoCache.findIndex(v => v.id === videoData.id);
                        if (idx !== -1) videoCache.splice(idx, 1);
                    }
                    resolve();
                });
            });
        });

        await Promise.all(downloadPromises);

        console.log(`✅ Cache refill completed (${downloaded}/${toDownload.length} successful)`);

    } catch (e) {
        console.log('❌ Cache refill error:', e.message);
    } finally {
        cacheRefillRunning = false;

        if (downloadedCache.length < DOWNLOADED_CACHE_LIMIT && videoCache.length > 0) {
            setTimeout(() => refillDownloadedCache().catch(() => {}), 5000);
        }
    }
}

// ==================== SEND RANDOM VIDEO ====================

async function sendRandomFikFap(sock, chatId) {
    const key = getKey(chatId, 'fikfap');

    if (running.has(key)) {
        return false;
    }

    running.add(key);

    try {
        // Auto-recovery: If cache is empty, refill immediately
        if (downloadedCache.length === 0) {
            console.log('⚠️ Downloaded cache empty, initiating emergency refill...');
            await refillDownloadedCache();
            if (downloadedCache.length === 0) {
                console.log('⏳ Emergency refill produced no results, falling back to direct download...');
            }
        }

        // FAST PATH: Use ready-to-send video from cache
        if (downloadedCache.length > 0) {
            const cachedItem = downloadedCache.shift();

            if (cachedItem) {
                const { filePath, mimetype, videoId } = cachedItem;

                try {
                    console.log(`📤 Sending cached video: ${videoId}`);
                    console.time("Send");

                    // Non-blocking file read
                    let videoBuffer = await fs.promises.readFile(filePath);
                    
                    await sock.sendMessage(chatId, {
                        video: videoBuffer,
                        mimetype: "video/mp4",
                        caption: "> DOWNLOADED BY SALMAN"
                    });

                    console.timeEnd("Send");
                    console.log(`✅ Video sent from cache: ${videoId}`);

                    // Release buffer for GC
                    videoBuffer = null;

                } finally {
                    // Delete converted file immediately after sending
                    try {
                        if (fs.existsSync(filePath)) {
                            await fs.promises.unlink(filePath);
                            console.log(`🗑️ Cleaned up: ${filePath}`);
                        }
                    } catch {}
                }

                // Track used video
                if (!usedVideos.has(key)) {
                    usedVideos.set(key, new Set());
                }
                usedVideos.get(key).add(videoId);

                console.log(`📦 Downloaded cache: ${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT}`);

                // Trigger background refill if cache is below threshold
                if (downloadedCache.length < CACHE_REFILL_THRESHOLD) {
                    refillDownloadedCache().catch(() => {});
                }

                return true;
            }
        }

        // SLOW PATH: Direct download
        console.log('⏳ Direct download fallback...');

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
                    const index = videoCache.findIndex(v => getVideoId(v) === videoId);
                    if (index !== -1) videoCache.splice(index, 1);
                    continue;
                }

                console.log(`📥 Direct download: ${videoUrl}`);

                const result = await downloadVideoWithRetry(videoUrl, video.format || 'mp4');

                if (!result) {
                    const index = videoCache.findIndex(v => getVideoId(v) === videoId);
                    if (index !== -1) videoCache.splice(index, 1);
                    continue;
                }

                const { filePath, mimetype } = result;

                console.log(`📤 Sending directly downloaded video...`);
                
                let videoBuffer = await fs.promises.readFile(filePath);
                await sock.sendMessage(chatId, {
                    video: videoBuffer,
                    mimetype: "video/mp4",
                    caption: "> DOWNLOADED BY SALMAN"
                });
                videoBuffer = null;

                // Clean up
                try {
                    if (fs.existsSync(filePath)) {
                        await fs.promises.unlink(filePath);
                        console.log(`🗑️ Cleaned up: ${filePath}`);
                    }
                } catch {}

                used.add(videoId);

                const index = videoCache.findIndex(v => getVideoId(v) === videoId);
                if (index !== -1) videoCache.splice(index, 1);

                console.log(`✅ Video sent: ${videoId}`);

                // Trigger background refill
                if (downloadedCache.length < CACHE_REFILL_THRESHOLD) {
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

// ==================== TIMERS ====================

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

// ==================== COMMAND ====================

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

        // Start background cache refill
        refillDownloadedCache().catch(() => {});

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

// ==================== STARTUP ====================

// Proper startup order:
// 1. Fill video metadata cache first
// 2. Then build downloaded cache
setTimeout(async () => {
    console.log('🚀 Starting background systems...');
    try {
        await fillVideoCache();
        console.log('✅ Video metadata cache ready');
        await refillDownloadedCache();
        console.log('✅ Downloaded cache ready');
        console.log(`📦 System ready: ${downloadedCache.length} videos pre-downloaded`);
    } catch (e) {
        console.log('❌ Startup cache error:', e.message);
        // Retry after 30 seconds
        setTimeout(() => {
            refillDownloadedCache().catch(() => {});
        }, 30000);
    }
}, 3000);

// Periodic clean-up of temp files every 5 minutes
setInterval(() => {
    clearTmp();
    // Log cache status
    console.log(`📊 Cache status: Downloaded=${downloadedCache.length}/${DOWNLOADED_CACHE_LIMIT}, Queue=${downloadQueue.length}`);
}, 300000);

module.exports = randomCommand;