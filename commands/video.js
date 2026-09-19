const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");
const axios = require("axios");

const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

const fs = require("fs");
const path = require("path");
const os = require("os");

ffmpeg.setFfmpegPath(ffmpegPath);



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


let inputFile;
let outputFile;


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
"🎥 Usage:\n.video video name"
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




const search = await yts(query);



if(!search.videos.length){

throw new Error(
"No video found"
);

}



const video = search.videos[0];





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





// PONTALABS DOWNLOAD


const result =
await ytdl.downloadVideo(
video.url,
720
);



console.log(
"YTDL RESULT:",
result
);



const downloadUrl =
result?.download?.downloadUrl;



if(!downloadUrl){

throw new Error(
"No download URL"
);

}





// Download file


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



if(buffer.length < 10000){

throw new Error(
"Invalid video file"
);

}





// TEMP FILES


inputFile =
path.join(
os.tmpdir(),
`input_${Date.now()}.mp4`
);


outputFile =
path.join(
os.tmpdir(),
`output_${Date.now()}.mp4`
);




fs.writeFileSync(
inputFile,
buffer
);





// ONLY REMUX (NO CONVERSION)


await new Promise((resolve,reject)=>{


ffmpeg(inputFile)

.outputOptions([
"-c copy",
"-movflags +faststart"
])

.save(outputFile)

.on("end",resolve)

.on("error",reject);


});





const finalVideo =
fs.readFileSync(outputFile);





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

finally{


try{

if(inputFile && fs.existsSync(inputFile))
fs.unlinkSync(inputFile);


if(outputFile && fs.existsSync(outputFile))
fs.unlinkSync(outputFile);


}catch(e){}


}



}



module.exports = videoCommand;
