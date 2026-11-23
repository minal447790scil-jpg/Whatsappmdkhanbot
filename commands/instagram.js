
const { igdl } = require("ruhend-scraper");

async function instagramCommand(sock, chatId, message) {
    let downloadData = null;

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

        console.log("\n========== INSTAGRAM DOWNLOADER ==========");
        console.log("[IG] URL:", cleanUrl);
        console.log("[IG] Calling ruhend-scraper igdl...");

        // Fetch media
        try {
            downloadData = await igdl(cleanUrl);
        } catch (err) {
            console.error("[IG] igdl failed:", err);
            console.error("[IG] Stack:", err?.stack);

            throw new Error(
                `Scraper failed: ${err?.message || String(err)}`
            );
        }

        console.log(
            "[IG] Raw response:",
            JSON.stringify(downloadData, null, 2)
        );

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

                if (isImage) {
                    await sock.sendMessage(
                        chatId,
                        {
                            image: { url: mediaUrl },
                            caption: "✅ DOWNLOADED BY SALMAN"
                        },
                        { quoted: message }
                    );
                } else {
                    await sock.sendMessage(
                        chatId,
                        {
                            video: { url: mediaUrl },
                            caption: "✅ DOWNLOADED BY SALMAN"
                        },
                        { quoted: message }
                    );
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

        console.log(`[IG] Success. Sent ${sent} media item(s).`);
        console.log("==========================================\n");

    } catch (err) {
        console.error("[IG] COMMAND ERROR:", err);
        console.error("[IG] Stack:", err?.stack);

        try {
            await sock.sendMessage(
                chatId,
                {
                    text:
                        "❌ Instagram Error\n\n" +
                        `${err?.message || String(err)}\n\n` +
                        "Possible causes:\n" +
                        "• Private, deleted or unsupported post\n" +
                        "• Instagram changed its response\n" +
                        "• Scraper/API failure\n\n" +
                        "Check terminal logs for details."
                },
                { quoted: message }
            );
        } catch (sendErr) {
            console.error("[IG] Could not send error message:", sendErr);
        }

        try {
            await sock.sendMessage(chatId, {
                react: { text: "❌", key: message.key }
            });
        } catch {}
    }
}

module.exports = instagramCommand;
