const yts = require('yt-search');
const ytdlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function songCommand(sock, chatId, message) {
    let filePath = null;

    try {
        await sock.sendMessage(chatId, {
            react: {
                text: "⏳",
                key: message.key
            }
        });

        const msg =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            "";

        const query = msg.replace(/^\.song\s*/i, "").trim();

        if (!query) {
            return sock.sendMessage(chatId, {
                text: "❌ Use:\n.song song name"
            }, { quoted: message });
        }

        let video;

        if (query.includes("youtube.com") || query.includes("youtu.be")) {
            video = {
                url: query,
                title: "YouTube Song"
            };
        } else {
            const search = await yts(query);

            if (!search.videos.length) {
                return sock.sendMessage(chatId, {
                    text: "❌ Song not found"
                }, { quoted: message });
            }

            video = search.videos[0];
        }

        await sock.sendMessage(chatId, {
            text:
            `🎵 ${video.title}\n\n📥 Downloading...`
        }, { quoted: message });


        const name = `song-${Date.now()}.mp3`;

        filePath = path.join(
            os.tmpdir(),
            name
        );


        await ytdlp(video.url, {
            extractAudio: true,
            audioFormat: "mp3",
            audioQuality: "128K",
            output: filePath,
            noPlaylist: true
        });


        if (!fs.existsSync(filePath)) {
            throw new Error("MP3 not created");
        }


        const audio = fs.readFileSync(filePath);


        await sock.sendMessage(chatId, {
            audio: audio,
            mimetype: "audio/mpeg",
            fileName: `${video.title}.mp3`
        }, { quoted: message });


        await sock.sendMessage(chatId, {
            react: {
                text: "✅",
                key: message.key
            }
        });


    } catch (err) {

        console.log("SONG ERROR:", err);

        await sock.sendMessage(chatId, {
            text:
            `❌ Song Download Failed\n\n${err.message}`
        }, { quoted: message });

    } finally {

        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

module.exports = songCommand;
