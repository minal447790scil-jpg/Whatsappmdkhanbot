const axios = require("axios");
const yts = require("yt-search");

const TUNELIO_API_KEY = process.env.TUNELIO_API_KEY;


// ===============================
// GET TEXT FROM BAILEYS
// ===============================
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
        msg.documentMessage?.caption ||
        ""
    ).trim();
}



// ===============================
// SONG COMMAND
// ===============================
async function songCommand(sock, chatId, message) {

    try {


        const text = getText(message);


        console.log(
            "SONG TEXT:",
            text
        );


        const query = text
            .replace(/^\.song\s*/i,"")
            .trim();



        if(!query){

            return await sock.sendMessage(
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



        if(!TUNELIO_API_KEY){

            throw new Error(
                "TUNELIO_API_KEY missing"
            );

        }




        // SEARCH YOUTUBE

        await sock.sendMessage(chatId,{
            react:{
                text:"🔎",
                key:message.key
            }
        });



        const search =
            await yts(query);



        if(!search.videos.length){

            throw new Error(
                "Song not found"
            );

        }



        const video =
            search.videos[0];


        const url =
            video.url;


        const title =
            video.title;


        const thumbnail =
            video.thumbnail;



        // PREVIEW


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





        // TUNELIO API REQUEST


        console.log(
            "Sending to Tunelio:",
            url
        );



        const response =
            await axios.post(

                "https://tunelio.dev/create",

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




        console.log(
            "TUNELIO RESPONSE:",
            response.data
        );




        const downloadUrl =

            response.data?.url ||

            response.data?.download_url ||

            response.data?.downloadUrl ||

            response.data?.data?.url ||

            response.data?.data?.download_url ||

            response.data?.result?.url;




        if(!downloadUrl){

            throw new Error(
                "No download URL received from Tunelio"
            );

        }





        // DOWNLOAD AUDIO


        const audioResponse =
            await axios.get(
                downloadUrl,
                {

                    responseType:
                    "arraybuffer",

                    timeout:180000
                }
            );



        const audio =
            Buffer.from(
                audioResponse.data
            );




        if(!audio.length){

            throw new Error(
                "Empty audio file"
            );

        }





        // SEND AUDIO


        await sock.sendMessage(
            chatId,
            {

                audio:audio,

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



    } catch(error){


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
