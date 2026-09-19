const {
    getVideoInfo,
    downloadStream
} = require("@natsu.darkcore/ytdl-darkcore");

const yts = require("yt-search");
const fs = require("fs");
const path = require("path");


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
text:
`🎥 Usage:
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

throw new Error("Video not found");

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

📥 Downloading...`
},
{
quoted:message
}
);





// GET INFO

const info =
await getVideoInfo(video.url);



console.log(
"TITLE:",
info.title
);

console.log(
"FORMATS:",
info.formats.length
);




// TRY BEST VIDEO

const bestVideo =
info.bestVideo;



if(!bestVideo){

throw new Error(
"No video format found"
);

}




const filePath =
path.join(
__dirname,
`${Date.now()}.mp4`
);




// DOWNLOAD

await downloadStream(
bestVideo,
filePath
);



const buffer =
fs.readFileSync(filePath);



if(buffer.length < 10000){

throw new Error(
"Downloaded file invalid"
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



fs.unlinkSync(filePath);



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
`❌ Video Download Failed

${error.message}`
},
{
quoted:message
}
);


}


}



module.exports = videoCommand;
