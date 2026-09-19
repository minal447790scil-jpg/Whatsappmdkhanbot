const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");
const axios = require("axios");


function getText(message){

    let msg = message?.message || message;

    if(!msg) return "";

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
    ).trim();

}



async function videoCommand(sock, chatId, message){

try{


const text = getText(message);

const query = text
.replace(/^\.video\s*/i,"")
.trim();



if(!query){

return sock.sendMessage(
chatId,
{
text:"🎥 Use:\n.video video name"
},
{
quoted:message
}
);

}




const search = await yts(query);


if(!search.videos.length){

throw new Error("Video not found");

}



const video = search.videos[0];



await sock.sendMessage(
chatId,
{
image:{
url:video.thumbnail
},
caption:
`🎥 *${video.title}*\n\n⏳ Downloading...`
},
{
quoted:message
}
);





// SAME PACKAGE METHOD
const result = await ytdl.downloadVideo(
    video.url,
    720
);



const videoUrl =
result?.download?.downloadUrl ||
result?.downloadUrl ||
result?.url;



if(!videoUrl){

throw new Error(
"No video URL found from ytdl"
);

}




const response = await axios.get(
videoUrl,
{
responseType:"arraybuffer",
timeout:180000
}
);



const buffer = Buffer.from(response.data);



await sock.sendMessage(
chatId,
{
video:buffer,
mimetype:"video/mp4",
fileName:`${video.title}.mp4`,
caption:
`🎥 *${video.title}*\n\n✅ Downloaded`
},
{
quoted:message
}
);



await sock.sendMessage(
chatId,
{
react:{
text:"✅",
key:message.key
}
}
);



}
catch(err){

console.log(
"VIDEO ERROR:",
err
);


await sock.sendMessage(
chatId,
{
text:
`❌ Video Failed\n\n${err.message}`
},
{
quoted:message
}
);

}


}


module.exports = videoCommand;
