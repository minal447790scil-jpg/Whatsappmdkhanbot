const ytdl = require("shadowx-ytdl");
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



async function getVideoUrl(url) {

    const qualities = [1080, 720, 480];

    for (const quality of qualities) {

        try {

            console.log(
                "Trying quality:",
                quality
            );


            const result =
                await ytdl.downloadVideo(
                    url,
                    quality
                );


            console.log(
                "RESULT QUALITY:",
                quality,
                result?.download?.downloadUrl
            );


            const downloadUrl =
                result?.download?.downloadUrl;


            if (downloadUrl) {
                return downloadUrl;
            }


        } catch (e) {

            console.log(
                "Quality failed:",
                quality,
                e.message
            );

        }

    }


    return null;
}





async function videoCommand(sock, chatId, message) {


try {


const text = getText(message);


const query = text
.replace(/^\.video\s*/i,"")
.trim();



if(!query){

return sock.sendMessage(
chatId,
{
text:
`🎥 *Video Downloader*

Usage:
.video video name`
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



const search =
await yts(query);



if(!search.videos.length){

throw new Error(
"No video found"
);

}



const video =
search.videos[0];




await sock.sendMessage(
chatId,
{
image:{
url:video.thumbnail
},

caption:
`🎥 *${video.title}*

⏳ Downloading HD...`
},
{
quoted:message
}
);





const videoUrl =
await getVideoUrl(
video.url
);



if(!videoUrl){

throw new Error(
"No download URL found"
);

}




const response =
await axios.get(
videoUrl,
{
responseType:"arraybuffer",
timeout:300000
}
);



const buffer =
Buffer.from(response.data);



if(buffer.length < 10000){

throw new Error(
"Invalid video file"
);

}





await sock.sendMessage(
chatId,
{

video:buffer,

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
