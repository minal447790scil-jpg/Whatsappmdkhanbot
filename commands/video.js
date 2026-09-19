const ytdl = require("@distube/ytdl-core");
const yts = require("yt-search");


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
            "VIDEO TEXT:",
            text
        );


        const query = text
            .replace(/^\.video\s*/i, "")
            .trim();



        if (!query) {

            return await sock.sendMessage(
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



        // SEARCH VIDEO

        const search =
            await yts(query);



        if (!search.videos.length) {

            throw new Error(
                "No video found"
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
        // DOWNLOAD HD STREAM
        // ===============================


        const stream = ytdl(
            video.url,
            {
                quality:"highest",

                filter:
                "audioandvideo"
            }
        );



        const chunks = [];



        for await (const chunk of stream) {

            chunks.push(chunk);

        }



        const videoBuffer =
            Buffer.concat(chunks);



        if (!videoBuffer.length) {

            throw new Error(
                "Video buffer empty"
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
                `${video.title}.mp4`,


                caption:
`🎥 *${video.title}*

✨ Downloaded by SALMAN KHAN`

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
    catch(error) {


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
