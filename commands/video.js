const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");
const axios = require("axios");


function getText(message){

    let msg = message?.message || message;

    if(!msg) return "";

    if(msg.ephemeralMessage?.message)
        msg = msg.ephemeralMessage.message;

    if(msg.viewOnceMessage?.message)
        msg = msg.viewOnceMessage.message;


    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
    ).trim();
}



async function videoCommand(sock,chatId,message){

try{


const text=getText(message);


const query=text
.replace(/^\.video\s*/i,"")
.trim();



if(!query){

return sock.sendMessage(
chatId,
{
text:
"🎥 Usage:\n.video video name"
},
{
quoted:message
}
);

}



const search=await yts(query);



if(!search.videos.length){

throw new Error(
"No video found"
);

}



const video=search.videos[0];



await sock.sendMessage(
chatId,
{
image:{
url:video.thumbnail
},

caption:
`🎥 *${video.title}*

📥 Downloading...`
},
{
quoted:message
}
);



const result=
await ytdl.downloadVideo(
video.url,
720
);



console.log(
"YTDL VIDEO:",
result
);



const videoUrl=
result?.download?.downloadUrl;



if(!videoUrl){

throw new Error(
"No video URL received"
);

}



const file=
await axios.get(
videoUrl,
{
responseType:"arraybuffer",
timeout:300000
}
);



await sock.sendMessage(
chatId,
{
video:
Buffer.from(file.data),

mimetype:
"video/mp4",

fileName:
`${video.title}.mp4`

},
{
quoted:message
}
);



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



module.exports=videoCommand;
