const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");


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



function convertWhatsApp(input){

    return new Promise((resolve,reject)=>{

        const output="./wa_video.mp4";

        ffmpeg(input)

        .videoCodec("libx264")
        .audioCodec("aac")

        .outputOptions([
            "-preset ultrafast",
            "-crf 28",
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


const text=getText(message);

const query=text
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




const search=await yts(query);


if(!search.videos.length){

throw new Error("Video not found");

}



const video=search.videos[0];




await sock.sendMessage(
chatId,
{
image:{
url:video.thumbnail
},
caption:
`🎥 ${video.title}\n\n⏳ Downloading...`
},
{
quoted:message
}
);





// SAME WORKING METHOD

const result =
await ytdl.downloadVideo(
    video.url,
    720
);





const url =
result?.download?.downloadUrl ||
result?.downloadUrl ||
result?.url;



if(!url){

throw new Error(
"Video URL not found"
);

}





const raw="./raw.mp4";



const file =
await axios.get(
url,
{
responseType:"arraybuffer",
timeout:180000
}
);



fs.writeFileSync(
raw,
Buffer.from(file.data)
);



let finalFile=raw;



try{


finalFile =
await convertWhatsApp(raw);


}
catch(e){

console.log(
"Conversion failed:",
e.message
);

}





const buffer =
fs.readFileSync(finalFile);





await sock.sendMessage(
chatId,
{
video:buffer,
mimetype:"video/mp4",
fileName:"video.mp4",
caption:
`🎥 ${video.title}\n\n✅ Done`
},
{
quoted:message
}
);





if(fs.existsSync(raw))
fs.unlinkSync(raw);


if(finalFile !== raw && fs.existsSync(finalFile))
fs.unlinkSync(finalFile);



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



module.exports=videoCommand;
