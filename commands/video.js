const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");
const axios = require("axios");

const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

const fs = require("fs");
const path = require("path");
const os = require("os");


ffmpeg.setFfmpegPath(ffmpegPath);



function getText(message){

let msg=message?.message || message;

if(!msg) return "";

if(msg.ephemeralMessage?.message)
msg=msg.ephemeralMessage.message;

if(msg.viewOnceMessage?.message)
msg=msg.viewOnceMessage.message;


return (
msg.conversation ||
msg.extendedTextMessage?.text ||
msg.imageMessage?.caption ||
msg.videoMessage?.caption ||
""
).trim();

}




async function videoCommand(sock,chatId,message){


let input;
let output;


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

⏳ Downloading...`
},
{
quoted:message
}
);





const result =
await ytdl.downloadVideo(
video.url,
720
);



const videoUrl =
result?.download?.downloadUrl;



if(!videoUrl){

throw new Error(
"No video URL found"
);

}





const raw =
await axios.get(
videoUrl,
{
responseType:"arraybuffer",
timeout:300000
}
);





input =
path.join(
os.tmpdir(),
`raw_${Date.now()}.mp4`
);



output =
path.join(
os.tmpdir(),
`final_${Date.now()}.mp4`
);





fs.writeFileSync(
input,
Buffer.from(raw.data)
);





// WhatsApp compatible convert

await new Promise((resolve,reject)=>{


ffmpeg(input)

.videoCodec("libx264")

.audioCodec("aac")

.outputOptions([
"-preset veryfast",
"-movflags +faststart",
"-pix_fmt yuv420p"
])

.save(output)


.on("end",resolve)

.on("error",reject);



});





const finalVideo =
fs.readFileSync(output);






await sock.sendMessage(
chatId,
{

video:
finalVideo,

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
catch(err){

console.log(
"VIDEO ERROR",
err
);


await sock.sendMessage(
chatId,
{
text:
`❌ *Video Download Failed*

${err.message}`
},
{
quoted:message
}
);

}



finally{


try{

if(input && fs.existsSync(input))
fs.unlinkSync(input);


if(output && fs.existsSync(output))
fs.unlinkSync(output);


}catch(e){}


}


}



module.exports=videoCommand;
