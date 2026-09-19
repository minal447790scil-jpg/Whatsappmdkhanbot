const yts = require("yt-search");
const youtubedl = require("yt-dlp-exec");
const fs = require("fs");


/*
 Create cookies file from Railway Variable
*/

if(process.env.COOKIES_TXT){

    fs.writeFileSync(
        "cookies.txt",
        process.env.COOKIES_TXT
    );

}




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






if(!fs.existsSync("./videos")){

fs.mkdirSync("./videos");

}






const output =
`./videos/%(title)s.%(ext)s`;






console.log(
"Downloading:",
video.url
);






await youtubedl(

video.url,

{

output:output,

format:
"best[ext=mp4]/best",

cookies:
"./cookies.txt",

noCheckCertificates:true,

retries:3

}

);






const files =
fs.readdirSync("./videos");



if(!files.length){

throw new Error(
"Video file not found"
);

}




const filePath =
"./videos/" + files[files.length-1];





const buffer =
fs.readFileSync(filePath);






if(buffer.length < 10000){

throw new Error(
"Invalid video"
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
