const ytdl = require("@pontalabs/ytdl");
const yts = require("yt-search");



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
"🎥 Use:\n.video video name"
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





const search =
await yts(query);



if(!search.videos.length){

throw new Error(
"No video found"
);

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






// YTDL STREAM

const stream =
ytdl(video.url, {

quality:"highestvideo"

});





const chunks = [];



stream.on(
"data",
(chunk)=>{

chunks.push(chunk);

});





stream.on(
"end",
async()=>{


const buffer =
Buffer.concat(chunks);



console.log(
"VIDEO SIZE:",
buffer.length
);



if(buffer.length < 10000){

throw new Error(
"Invalid video buffer"
);

}




await sock.sendMessage(

chatId,

{

video:buffer,

mimetype:"video/mp4",

fileName:
`${video.title}.mp4`,

caption:
`✅ *${video.title}*`

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



});



stream.on(
"error",
(err)=>{

throw err;

});





}
catch(error){


console.log(
"YTDL ERROR:",
error
);



await sock.sendMessage(
chatId,
{
text:
`❌ Video Failed\n\n${error.message}`
},
{
quoted:message
}
);


}



}



module.exports = videoCommand;
