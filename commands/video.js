const { downloadVideo } = require("@raihan07/vidly");
const yts = require("yt-search");
const fs = require("fs");


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

📥 Downloading HD...`
},
{
quoted:message
}
);





// DOWNLOAD USING VIDLY

const result =
await downloadVideo(
video.url
);



console.log(
"VIDLY RESULT:",
result
);



if(!result.filePath){

throw new Error(
"Video file not found"
);

}




const videoBuffer =
fs.readFileSync(
result.filePath
);




if(videoBuffer.length < 10000){

throw new Error(
"Invalid video file"
);

}





await sock.sendMessage(
chatId,
{
video:videoBuffer,

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
"VIDLY ERROR:",
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
