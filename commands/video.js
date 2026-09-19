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

📥 Downloading 1080p...`
},
{
quoted:message
}
);





// FORCE 1080P ONLY


console.log(
"Downloading 1080:",
video.url
);



const result =
await ytdl.downloadVideo(
    video.url,
    1080
);



console.log(
"SHADOWX RESULT:",
JSON.stringify(result,null,2)
);



const downloadUrl =
result?.download?.downloadUrl;



if(!downloadUrl){

throw new Error(
"1080p download URL not found"
);

}





// DOWNLOAD BUFFER


const response =
await axios.get(
downloadUrl,
{
responseType:"arraybuffer",

timeout:300000
}
);



const buffer =
Buffer.from(response.data);



console.log(
"Video Size:",
(buffer.length/1024/1024).toFixed(2),
"MB"
);





if(buffer.length < 10000){

throw new Error(
"Invalid video file"
);

}





// SEND VIDEO


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
