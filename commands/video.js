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


// KROSZTUBE IMPORT FIX
const { download } = await import("krosztube");



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
"Video not found"
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






// CREATE FOLDER

const outputDir="./videos";


if(!fs.existsSync(outputDir)){

fs.mkdirSync(outputDir);

}







console.log(
"Downloading:",
video.url
);






// DOWNLOAD USING KROSZTUBE

const files =
await download(

video.url,

{

quality:1080,

container:"mp4",

outDir:outputDir

}

);





console.log(
"KROSZTUBE FILE:",
files
);





if(!files || !files.length){

throw new Error(
"Video file not generated"
);

}





const filePath =
files[0];






if(!fs.existsSync(filePath)){

throw new Error(
"Downloaded file missing"
);

}





const videoBuffer =
fs.readFileSync(filePath);






if(videoBuffer.length < 10000){

throw new Error(
"Invalid video"
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

✅ Downloaded`

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





module.exports = videoCommand;
