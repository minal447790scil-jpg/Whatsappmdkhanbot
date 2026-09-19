const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");
const axios = require("axios");


// ===============================
// GET MESSAGE TEXT
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
            "VIDEO COMMAND:",
            text
        );


        const query = text
            .replace(/^\.video\s*/i, "")
            .trim();



        if (!query) {

            return sock.sendMessage(
                chatId,
                {
                    text:
`🎥 *Video Downloader*

Usage:
.video video name

Example:
.video Tum Hi Ho`
                },
                {
                    quoted: message
                }
            );

        }




        await sock.sendMessage(chatId,{
            react:{
                text:"🔎",
                key:message.key
            }
        });



        // SEARCH

        const search =
            await yts(query);



        if(!search.videos.length){

            throw new Error(
                "Video not found"
            );

        }



        const video =
            search.videos[0];



        // PREVIEW

        await sock.sendMessage(
            chatId,
            {
                image:{
                    url:video.thumbnail
                },

                caption:
`🎥 *${video.title}*

⏱️ ${video.timestamp}

📥 Downloading HD...`
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




        // ===============================
        // PONTALABS DOWNLOAD
        // ===============================


        const result =
            await ytdl.downloadVideo(
                video.url,
                720
            );


        console.log(
            "PONTALABS RESULT:",
            result
        );



        const downloadUrl =
            result?.download?.downloadUrl;



        if(!downloadUrl){

            throw new Error(
                "No video download URL"
            );

        }





        // ===============================
        // DOWNLOAD BUFFER
        // ===============================


        const file =
            await axios.get(
                downloadUrl,
                {
                    responseType:
                    "arraybuffer",

                    timeout:300000
                }
            );



        const buffer =
            Buffer.from(file.data);



        if(buffer.length < 10000){

            throw new Error(
                "Video file invalid"
            );

        }




        // ===============================
        // SEND VIDEO
        // ===============================


        await sock.sendMessage(
            chatId,
            {

                video:
                buffer,


                mimetype:
                "video/mp4",


                fileName:
                `${video.title}.mp4`,


                caption:
`🎥 *${video.title}*

✨ *Downloaded by SALMAN KHAN*`

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



    }
    catch(error){


        console.log(
            "VIDEO ERROR:",
            error
        );



        await sock.sendMessage(
            chatId,
            {
                text:
`❌ *Video Download Failed*

${error.message}`
            },
            {
                quoted:message
            }
        );

    }

}



module.exports = videoCommand;
