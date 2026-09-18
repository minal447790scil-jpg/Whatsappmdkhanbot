const yts = require("yt-search");
const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");

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


        const query = msg
            .replace(/^\.song\s*/i, "")
            .trim();


        if (!query) {

            return await sock.sendMessage(
                chatId,
                {
                    text:
                    "❌ Usage:\n.song <song name>"
                },
                {
                    quoted: message
                }
            );

        }



        let url;
        let title = "Song";
        let thumbnail = null;



        // If YouTube link

        if (
            query.includes("youtube.com") ||
            query.includes("youtu.be")
        ) {

            url = query;


            try {

                const info = await ytdlp(url, {
                    dumpSingleJson: true,
                    noPlaylist: true
                });


                title = info.title || "Song";
                thumbnail = info.thumbnail || null;


            } catch {}



        } else {


            const search = await yts(query);


            if (!search.videos.length) {

                return await sock.sendMessage(
                    chatId,
                    {
                        text:"❌ Song not found"
                    },
                    {
                        quoted:message
                    }
                );

            }


            const video = search.videos[0];


            url = video.url;
            title = video.title;
            thumbnail = video.thumbnail;


        }




        // Download message with preview


        await sock.sendMessage(
            chatId,
            {
                image: thumbnail
                    ? {
                        url: thumbnail
                    }
                    : undefined,

                caption:
                `🎵 *${title}*\n\n📥 Downloading...`
            },
            {
                quoted:message
            }
        );




        filePath = path.join(
            os.tmpdir(),
            `song_${Date.now()}.mp3`
        );





        console.log("Downloading:", url);



        await ytdlp(
            url,
            {

                extractAudio:true,

                audioFormat:"mp3",

                audioQuality:"128K",

                output:filePath,

                noPlaylist:true

            }
        );





        if (!fs.existsSync(filePath)) {

            throw new Error(
                "MP3 file not created"
            );

        }




        const audio =
            fs.readFileSync(filePath);





        // Send Audio With Preview


        await sock.sendMessage(
            chatId,
            {

                audio: audio,

                mimetype:
                "audio/mpeg",

                fileName:
                `${title}.mp3`,

                ptt:false,


                contextInfo: {

                    externalAdReply: {

                        title:title,

                        body:
                        "🎵 Song Downloader",

                        thumbnailUrl:
                        thumbnail,

                        mediaType:2,

                        renderLargerThumbnail:true,

                        sourceUrl:url
                    }

                }


            },
            {
                quoted:message
            }
        );





        await sock.sendMessage(chatId,{

            react:{
                text:"✅",
                key:message.key
            }

        });



    } catch(error) {


        console.log(
            "SONG ERROR:",
            error
        );


        await sock.sendMessage(
            chatId,
            {

                text:
                `❌ Song Download Failed\n\n${error.message}`

            },
            {
                quoted:message
            }
        );


    } finally {


        if (
            filePath &&
            fs.existsSync(filePath)
        ) {

            fs.unlinkSync(filePath);

        }

    }

}


module.exports = songCommand;
