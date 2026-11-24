
const { igdl2 } = require("ruhend-scraper");
const { getInfo } = require("@raihan07/vidly");
const axios = require("axios");

// Media pehle khud buffer mein download karke bhejo — seedha
// URL-send WhatsApp ke fetcher par chhuta tha jo kuch CDN links
// par khamoshi se fail ho jata tha (video aata hi nahi tha).
// Buffer fail ho to URL-send akhri sahara hai.
async function fetchBuffer(url, maxMB = 64) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 45000,
        maxContentLength: maxMB * 1024 * 1024,
        maxBodyLength: maxMB * 1024 * 1024
    });
    return Buffer.from(res.data);
}

// Media fetch: vidly aur igdl2 DONO ek sath (parallel) chalte hain —
// jo pehle VALID media de de, wahi jeet jata hai. Pehle vidly akela
// ~20s leta tha aur bar 20% par atki rehti thi. Dono par 30s timeout
// hai taake koi backend hang ho to command hamesha ke liye na atke.
// igdl2 ke sirf woh items valid hain jinka URL asal path rakhta ho
// (wo kabhi kabhi "https://snapsave.app&dl=1" jaisa kata hua URL
// de deta hai jo download nahi ho sakta).
function withTimeout(promise, ms, name) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(name + " timeout (" + ms / 1000 + "s)")),
                ms
            );
        })
    ]).finally(() => clearTimeout(timer));
}

async function fetchInstagramMedia(cleanUrl) {
    const fromVidly = (async () => {
        const info = await withTimeout(getInfo(cleanUrl), 30000, "vidly");
        const direct = info?.highQuality || info?.lowQuality;

        if (typeof direct === "string" && /^https?:\/\//i.test(direct)) {
            console.log("[IG] vidly: direct CDN link mila (race winner)");
            return [{ url: direct, type: "video" }];
        }

        throw new Error("vidly: koi direct link nahi");
    })();

    const fromIgdl2 = (async () => {
        const data = await withTimeout(igdl2(cleanUrl), 30000, "igdl2");
        const items = Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data)
                ? data
                : [];

        const valid = items.filter((it) => {
            const u = it?.url;
            if (typeof u !== "string") return false;
            try {
                return new URL(u).pathname.length > 1;
            } catch {
                return false;
            }
        });

        if (valid.length) {
            console.log("[IG] igdl2: valid media mila (race winner)");
            return valid;
        }

        throw new Error("igdl2: koi valid media nahi");
    })();

    try {
        return await Promise.any([fromVidly, fromIgdl2]);
    } catch (e) {
        const reasons = (e?.errors || [])
            .map((x) => x?.message || String(x))
            .join(" | ");
        console.log("[IG] dono fetchers fail:", reasons || e?.message || e);
        throw new Error("Scraper failed: dono sources se media nahi mila");
    }
}

async function instagramCommand(sock, chatId, message) {
    let downloadData = null;

    // Animated status message (edit-in-place progress bar)
    let statusKey = null;
    let progressTimer = null;
    const setStatus = async (text) => {
        if (statusKey) {
            await sock.sendMessage(chatId, { text, edit: statusKey }).catch(() => {});
        }
    };
    const stopProgress = () => {
        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    };

    try {
        // Extract message text
        const msg =
            message.message?.ephemeralMessage?.message ||
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
            message.message;

        const text =
            msg?.conversation ||
            msg?.extendedTextMessage?.text ||
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            "";

        // Extract Instagram URL
        const match = text.match(
            /https?:\/\/(?:www\.|m\.|)?instagram\.com\/[^\s]+/i
        );

        const query = match
            ? match[0].replace(/[),.!]+$/, "")
            : text.replace(/^\.(insta|ig|instagram)\s+/i, "").trim();

        if (!query) {
            return await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ Instagram link do.\n\n" +
                        "Example:\n" +
                        ".ig https://www.instagram.com/reel/XXXXXXXX/"
                },
                { quoted: message }
            );
        }

        // Validate URL
        let parsedUrl;

        try {
            parsedUrl = new URL(query);
        } catch {
            return await sock.sendMessage(
                chatId,
                { text: "❌ Invalid URL. Sahi Instagram link do." },
                { quoted: message }
            );
        }

        if (
            !["instagram.com", "www.instagram.com", "m.instagram.com"]
                .includes(parsedUrl.hostname.toLowerCase())
        ) {
            return await sock.sendMessage(
                chatId,
                { text: "❌ Sirf Instagram links supported hain." },
                { quoted: message }
            );
        }

        // Keep the original URL and query parameters for testing.
        const cleanUrl = parsedUrl.toString();

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        });

        try {
            const statusMsg = await sock.sendMessage(chatId, {
                text: "📥 *Downloading...*\n[██░░░░░░░░] 20%"
            }, { quoted: message });
            statusKey = statusMsg.key;
        } catch {}

        // Fetch ke doran bar aahista aahista aage barhti rahe —
        // warna lambi fetch par 20% par atki hui lagti hai
        if (statusKey) {
            const frames = [
                "📥 *Downloading...*\n[███░░░░░░░] 30%",
                "📥 *Downloading...*\n[████░░░░░░] 40%",
                "📥 *Downloading...*\n[█████░░░░░] 50%",
                "📥 *Downloading...*\n[██████░░░░] 60%"
            ];
            let fi = 0;
            progressTimer = setInterval(() => {
                setStatus(frames[fi % frames.length]);
                fi++;
            }, 400);
        }

        console.log("\n========== INSTAGRAM DOWNLOADER ==========");
        console.log("[IG] URL:", cleanUrl);
        console.log("[IG] Fetching media (vidly + igdl2 race)...");

        // Fetch media
        try {
            downloadData = await fetchInstagramMedia(cleanUrl);
        } catch (err) {
            stopProgress();
            console.error("[IG] scraper failed:", err);
            console.error("[IG] Stack:", err?.stack);

            throw new Error(
                `Scraper failed: ${err?.message || String(err)}`
            );
        }
        stopProgress();

        console.log(
            "[IG] Raw response:",
            JSON.stringify(downloadData, null, 2)
        );

        await setStatus("🎬 *Sending...*\n[███████░░░] 70%");
        await new Promise(r => setTimeout(r, 700));

        // Normalize result
        let mediaList = [];

        if (Array.isArray(downloadData)) {
            mediaList = downloadData;
        } else if (Array.isArray(downloadData?.data)) {
            mediaList = downloadData.data;
        } else if (Array.isArray(downloadData?.result)) {
            mediaList = downloadData.result;
        } else if (Array.isArray(downloadData?.urls)) {
            mediaList = downloadData.urls;
        } else if (downloadData) {
            mediaList = [downloadData];
        }

        if (!mediaList.length) {
            throw new Error(
                "Scraper returned no media. Check the URL and library response."
            );
        }

        let sent = 0;

        for (const media of mediaList) {
            try {
                let mediaUrl = null;
                let mediaType = "";

                if (typeof media === "string") {
                    mediaUrl = media;
                } else if (media && typeof media === "object") {
                    mediaUrl =
                        media.url ||
                        media.download_url ||
                        media.downloadUrl ||
                        media.video_url ||
                        media.videoUrl ||
                        media.image_url ||
                        media.display_url ||
                        media.src ||
                        media.download ||
                        media.video ||
                        media.image ||
                        media.link;

                    mediaType = String(
                        media.type || media.media_type || ""
                    ).toLowerCase();

                    if (typeof mediaUrl === "function") {
                        mediaUrl = await mediaUrl();
                    }
                }

                if (
                    typeof mediaUrl !== "string" ||
                    !/^https?:\/\//i.test(mediaUrl)
                ) {
                    console.log("[IG] Skipping unsupported item:", media);
                    continue;
                }

                const isImage =
                    mediaType.includes("image") ||
                    /\.(jpe?g|png|webp)(?:[?#]|$)/i.test(mediaUrl);

                console.log(
                    `[IG] Sending ${isImage ? "image" : "video"}:`,
                    mediaUrl
                );

                // Pehle buffer, phir URL (akhri sahara)
                let delivered = false;
                try {
                    const buf = await fetchBuffer(mediaUrl);
                    await sock.sendMessage(
                        chatId,
                        isImage
                            ? {
                                  image: buf,
                                  caption: "✅ *DOWNLOADED BY SALMAN KHAN*"
                              }
                            : {
                                  video: buf,
                                  mimetype: "video/mp4",
                                  caption: "✅ *DOWNLOADED BY SALMAN KHAN*"
                              },
                        { quoted: message }
                    );
                    delivered = true;
                    console.log("[IG] sent via buffer");
                } catch (bufErr) {
                    console.error("[IG] buffer send fail:", bufErr?.message || bufErr);
                }

                if (!delivered) {
                    await sock.sendMessage(
                        chatId,
                        isImage
                            ? {
                                  image: { url: mediaUrl },
                                  caption: "✅ *DOWNLOADED BY SALMAN KHAN*"
                              }
                            : {
                                  video: { url: mediaUrl },
                                  caption: "✅ *DOWNLOADED BY SALMAN KHAN*"
                              },
                        { quoted: message }
                    );
                    console.log("[IG] sent via url fallback");
                }

                sent++;
            } catch (err) {
                console.error("[IG] Failed to send media:", err);
            }
        }

        if (sent === 0) {
            throw new Error(
                "No supported media could be sent. Inspect the raw response in terminal."
            );
        }

        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        });

        // TikTok ki tarah: sirf mukammal bar, "Downloaded" lafz nahi
        await setStatus("[██████████] 100%");

        console.log(`[IG] Success. Sent ${sent} media item(s).`);
        console.log("==========================================\n");

    } catch (err) {
        stopProgress();
        console.error("[IG] COMMAND ERROR:", err);
        console.error("[IG] Stack:", err?.stack);

        // Chat saaf rakho: bara error paragraph nahi — sirf ek
        // line ka fail note status mein (delete bhi nahi hota),
        // asal wajah logs mein hai
        await setStatus("❌ *Download failed*");

        try {
            await sock.sendMessage(chatId, {
                react: { text: "❌", key: message.key }
            });
        } catch {}
    }
}

module.exports = instagramCommand;
