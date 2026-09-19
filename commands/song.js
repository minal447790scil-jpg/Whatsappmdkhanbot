const axios = require("axios");
const yts = require("yt-search");

const TUNELIO_API_KEY = process.env.TUNELIO_API_KEY;


// Get text from Baileys message
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
            .replace(/^\.song\s*/i, "")
            .trim();



        if (!query) {

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
                    quoted: message
                }
            );

        }



        if (!TUNELIO_API_KEY) {

            throw new Error(
                "TUNELIO_API_KEY missing in Railway variables"
            );

        }



        await sock.sendMessage(chatId,{
            react:{
                text:"🔎",
                key:message.key
            }
        });



        // Search YouTube

        const search = await yts(query);


        if(!search.videos.length){

            throw new Error(
                "Song not found"
            );

        }



        const video = search.videos[0];


        const url = video.url;
        const title = video.title;
        const thumbnail = video.thumbnail;



        // Preview

        await sock.sendMessage(
            chatId,
            {
                image:{
                    url:thumbnail
                },

                caption:
`🎵 *${title}*

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



        // Tunelio API

        const api = await axios.post(
            "https://tunelio.dev/api/create",
            {
                url:url,
                quality:"mp3"
            },
            {
                headers:{
                    Authorization:
                    `Bearer ${TUNELIO_API_KEY}`,

                    "Content-Type":
                    "application/json"
                },

                timeout:120000
            }
        );



        const downloadUrl =
            api.data?.url ||
            api.data?.download_url ||
            api.data?.downloadUrl;



        if(!downloadUrl){

            console.log(api.data);

            throw new Error(
                "No download URL returned"
            );

        }



        // Download MP3

        const audio =
            await axios.get(
                downloadUrl,
                {
                    responseType:"arraybuffer",
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
                `${title}.mp3`,

                ptt:false,


                contextInfo:{

                    externalAdReply:{

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
            error.response?.data ||
            error.message
        );


        await sock.sendMessage(
            chatId,
            {
                text:
`❌ *Song Download Failed*

${error.response?.data?.message || error.message}`
            },
            {
                quoted:message
            }
        );


    }

}


module.exports = songCommand;
