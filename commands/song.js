const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");
const axios = require("axios");

function getText(message) {

    let msg = message?.message || message;

    if (!msg) return "";

    if (msg.ephemeralMessage?.message)
        msg = msg.ephemeralMessage.message;

    if (msg.viewOnceMessage?.message)
        msg = msg.viewOnceMessage.message;

    if (msg.viewOnceMessageV2?.message)
        msg = msg.viewOnceMessageV2.message;


    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
    ).trim();
}



async function songCommand(sock, chatId, message) {

    try {

        const text = getText(message);

        const query = text
            .replace(/^\.song\s*/i,"")
            .trim();


        if(!query){

            return sock.sendMessage(
                chatId,
                {
                    text:
`🎵 *Song Downloader*

Usage:
.song song name

Example:
.song Tum Hi Ho`
                },
                {
                    quoted:message
                }
            );
        }



        await sock.sendMessage(chatId,{
            react:{
                text:"🔎",
                key:message.key
            }
        });



        const search = await yts(query);


        if(!search.videos.length){

            throw new Error(
                "Song not found"
            );
        }


        const video = search.videos[0];

        const url = video.url;


        await sock.sendMessage(
            chatId,
            {
                image:{
                    url:video.thumbnail
                },

                caption:
`🎵 *${video.title}*

📥 Downloading...`
            },
            {
                quoted:message
            }
        );



        await sock.sendMessage(chatId,{
            react:{
                text:"⏳",
                key:message.key
            }
        });



        // GET MP3 URL

        const result =
            await ytdl.downloadAudio(
                url,
                128
            );



        console.log(
            "YTDL AUDIO:",
            result
        );



        const audioUrl =
            result?.download?.downloadUrl;



        if(!audioUrl){

            throw new Error(
                "No audio URL received"
            );
        }



        const audio =
            await axios.get(
                audioUrl,
                {
                    responseType:
                    "arraybuffer",

                    timeout:180000
                }
            );



        await sock.sendMessage(
            chatId,
            {

                audio:
                Buffer.from(audio.data),

                mimetype:
                "audio/mpeg",

                fileName:
                `${video.title}.mp3`,

                ptt:false

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



    } catch(error){

        console.log(
            "SONG ERROR:",
            error
        );


        await sock.sendMessage(
            chatId,
            {
                text:
`❌ *Song Download Failed*

${error.message}`
            },
            {
                quoted:message
            }
        );
    }
}


module.exports = songCommand;
