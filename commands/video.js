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
// VIDEO COMMAND
// ===============================
async function videoCommand(sock, chatId, message) {

    try {


        const text = getText(message);


        console.log(
            "VIDEO TEXT:",
            text
        );



        const query = text
            .replace(/^\.video\s*/i,"")
            .trim();



        if(!query){

            return await sock.sendMessage(
                chatId,
                {
                    text:
`🎥 *Video Downloader*

Usage:
.video video name

Example:
.video Dil Dil Pakistan`
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




        // SEARCH

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
                "Video not found"
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


        const duration =
            video.timestamp || "Unknown";





        // PREVIEW


        await sock.sendMessage(
            chatId,
            {

                image:{
                    url:thumbnail
                },

                caption:
`🎥 *${title}*

⏱️ ${duration}

📥 Downloading...`

            },
            {
                quoted:message
            }
        );





        // API REQUEST


        console.log(
            "Sending video to Tunelio:",
            url
        );



        const response =
            await axios.post(

                "https://tunelio.dev/create",

                {
                    url:url,

                    quality:"720p"
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
            "TUNELIO VIDEO RESPONSE:",
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
                "No video URL received from Tunelio"
            );

        }





        // DOWNLOAD VIDEO


        const videoResponse =
            await axios.get(
                downloadUrl,
                {

                    responseType:
                    "arraybuffer",

                    timeout:300000,

                    maxContentLength:
                    300 * 1024 * 1024,

                    maxBodyLength:
                    300 * 1024 * 1024
                }
            );



        const videoBuffer =
            Buffer.from(
                videoResponse.data
            );




        if(!videoBuffer.length){

            throw new Error(
                "Empty video file"
            );

        }





        // SEND VIDEO


        await sock.sendMessage(
            chatId,
            {

                video:
                videoBuffer,

                mimetype:
                "video/mp4",

                fileName:
                `${title}.mp4`,

                caption:
`🎥 *${title}*

⏱️ ${duration}

✅ Downloaded successfully`,


                contextInfo:{

                    externalAdReply:{

                        title:title,

                        body:
                        "🎥 Video Downloader",

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
            "VIDEO ERROR:",
            error.response?.data ||
            error.message
        );



        await sock.sendMessage(
            chatId,
            {

                text:
`❌ *Video Download Failed*

${error.response?.data?.message || error.message}`

            },
            {
                quoted:message
            }
        );


    }

}


module.exports = videoCommand;
