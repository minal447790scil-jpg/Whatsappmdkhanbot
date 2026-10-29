
const { instagramGetUrl } = require("instagram-url-direct");

async function instagramCommand(sock, chatId, message) {
    const log = async (text) => {
        console.log("[INSTAGRAM]", text);
        try {
            await sock.sendMessage(chatId, { text: "🛠️ IG LOG\n" + text });
        } catch (e) {
            console.error("[INSTAGRAM] Log send failed:", e.message);
        }
    };

    try {
        const root = message.message || {};
        const msg = root.ephemeralMessage?.message || root;
        const text =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            root.conversation ||
            root.extendedTextMessage?.text ||
            "";

        const match = text.match(
            /https?:\/\/(?:www\.|m\.)?instagram\.com\/[^\s]+/i
        );

        if (!match) {
            return sock.sendMessage(chatId, {
                text: "❌ Instagram link do.\nExample: .ig https://www.instagram.com/reel/ID/"
            }, { quoted: message });
        }

        const url = match[0].replace(/[),.!]+$/, "");
        const parsed = new URL(url);

        if (!["instagram.com", "www.instagram.com", "m.instagram.com"]
            .includes(parsed.hostname.toLowerCase())) {
            throw new Error("Invalid Instagram URL");
        }

        await sock.sendMessage(chatId, {
            react: { text: "📥", key: message.key }
        });

        console.log("[INSTAGRAM] Fetching:", url);

        const data = await instagramGetUrl(url);

        console.log("[INSTAGRAM] Response:", JSON.stringify(data, null, 2));

        if (!data || data.post_info?.is_private) {
            throw new Error("Private post or no response from Instagram.");
        }

        const items = Array.isArray(data.media_details)
            ? data.media_details
            : (data.url_list || []).map(url => ({ url, type: "" }));

        if (!items.length) {
            throw new Error("No media URLs returned. Check terminal response.");
        }

        let sent = 0;

        for (const item of items.slice(0, 10)) {
            const mediaUrl = typeof item === "string" ? item : item.url;

            if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
                console.log("[INSTAGRAM] Invalid media item:", item);
                continue;
            }

            const type = String(item.type || "").toLowerCase();
            const image = type.includes("image") ||
                /\.(jpe?g|png|webp|gif)(?:[?#]|$)/i.test(mediaUrl);

            await sock.sendMessage(chatId, image
                ? {
                    image: { url: mediaUrl },
                    caption: "✅ DOWNLOADED BY SALMAN"
                }
                : {
                    video: { url: mediaUrl },
                    caption: "✅ DOWNLOADED BY SALMAN"
                }, { quoted: message });

            sent++;
        }

        if (!sent) throw new Error("No media could be sent to WhatsApp.");

        await sock.sendMessage(chatId, {
            react: { text: "✅", key: message.key }
        });

        console.log(`[INSTAGRAM] Success: ${sent} media item(s)`);

    } catch (err) {
        const report =
            `❌ Instagram failed\n` +
            `Error: ${err.message}\n` +
            `Stack:\n${err.stack || "N/A"}`;

        console.error("[INSTAGRAM]", report);

        await log(report);

        try {
            await sock.sendMessage(chatId, {
                react: { text: "❌", key: message.key }
            });
        } catch {}
    }
}

module.exports = instagramCommand;
