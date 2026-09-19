const yts = require("yt-search");
const { download } = require("krosztube");
const fs = require("fs");
const path = require("path");


function getText(message){

    const msg = message?.message || {};

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
`🎥 *${video.title}*

📥 Downloading...`
},
{
quoted:message
}
);





const outputDir = "./videos";

if(!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir);
}




const files = await download(
    video.url,
    {
        quality:1080,
        container:"mp4",
        outDir:outputDir
    }
);



console.log("KROSZTUBE:",files);




const filePath =
files[0];



if(!fs.existsSync(filePath)){

throw new Error(
"Video file not created"
);

}




const buffer =
fs.readFileSync(filePath);





await sock.sendMessage(
chatId,
{
video:buffer,

mimetype:"video/mp4",

fileName:
`${video.title}.mp4`,

caption:
`🎥 ${video.title}

✅ Downloaded`
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
"KROSZTUBE ERROR:",
err
);


await sock.sendMessage(
chatId,
{
text:
`❌ Video Download Failed

${err.message}`
},
{
quoted:message
}
);


}


}


module.exports = videoCommand;
