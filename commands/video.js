const yts = require("yt-search");
const youtubedl = require("yt-dlp-exec");
const fs = require("fs");
const path = require("path");


// Create cookies file from Railway variable

if (process.env.COOKIES_TXT) {

    fs.writeFileSync(
        "./cookies.txt",
        process.env.COOKIES_TXT
    );

    console.log("✅ Cookies file created");

} else {

    console.log("❌ COOKIES_TXT missing");

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





if(!fs.existsSync("./videos")){

fs.mkdirSync("./videos");

}





console.log(
"Downloading:",
video.url
);





await youtubedl(
video.url,
{

output:
"./videos/%(title)s.%(ext)s",


format:
"best[ext=mp4]/best",



cookies:
"./cookies.txt",



js_runtimes:
"deno",



no_check_certificates:
true,



retries:
5,


socket_timeout:
60

}
);





const files =
fs.readdirSync("./videos")
.filter(
file =>
file.endsWith(".mp4") ||
file.endsWith(".mkv") ||
file.endsWith(".webm")
);



if(!files.length){

throw new Error(
"Video file not found"
);

}





const filePath =
path.join(
"./videos",
files[files.length-1]
);





console.log(
"Sending file:",
filePath
);





const buffer =
fs.readFileSync(filePath);





console.log(
"Video size:",
buffer.length
);





await sock.sendMessage(

chatId,

{

video:
buffer,


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





// delete file after sending

fs.unlinkSync(filePath);



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
