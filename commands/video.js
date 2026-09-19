const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");



function getText(message){

    let msg = message?.message || message;

    if(!msg) return "";

    if(msg.ephemeralMessage?.message)
        msg = msg.ephemeralMessage.message;

    if(msg.viewOnceMessage?.message)
        msg = msg.viewOnceMessage.message;

    if(msg.viewOnceMessageV2?.message)
        msg = msg.viewOnceMessageV2.message;


    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
    ).trim();

}





function convertFast(input){

    return new Promise((resolve,reject)=>{

        const output = "./wa_ready.mp4";


        ffmpeg(input)

        .size("?x720")

        .videoCodec("libx264")

        .audioCodec("aac")

        .outputOptions([
            "-preset ultrafast",
            "-crf 30",
            "-movflags +faststart",
            "-pix_fmt yuv420p"
        ])

        .on("end",()=>{

            resolve(output);

        })

        .on("error",(err)=>{

            reject(err);

        })

        .save(output);

    });

}






async function videoCommand(sock,chatId,message){

try{


const text = getText(message);


const query = text
.replace(/^\.video\s*/i,"")
.trim();



if(!query){

return sock.sendMessage(
chatId,
{
text:"🎥 Usage:\n.video video name"
},
{
quoted:message
}
);

}




await sock.sendMessage(
chatId,
{
react:{
text:"🔎",
key:message.key
}
}
);





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







// DOWNLOAD FROM YTDL

const result =
await ytdl.downloadVideo(
    video.url,
    720
);





const videoUrl =

result?.download?.downloadUrl ||
result?.downloadUrl ||
result?.url;



if(!videoUrl){

throw new Error(
"No video URL found"
);

}





const rawFile =
"./raw_video.mp4";





const file =
await axios.get(
videoUrl,
{
responseType:"arraybuffer",
timeout:180000
}
);



fs.writeFileSync(
rawFile,
Buffer.from(file.data)
);






// FAST WHATSAPP CONVERSION

const readyFile =
await convertFast(rawFile);





const buffer =
fs.readFileSync(readyFile);





await sock.sendMessage(
chatId,
{
video:buffer,

mimetype:"video/mp4",

fileName:
`${video.title}.mp4`,

caption:
`🎥 *${video.title}*\n\n✅ Downloaded`
},
{
quoted:message
}
);






// CLEAN FILES

if(fs.existsSync(rawFile))
fs.unlinkSync(rawFile);


if(fs.existsSync(readyFile))
fs.unlinkSync(readyFile);






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
