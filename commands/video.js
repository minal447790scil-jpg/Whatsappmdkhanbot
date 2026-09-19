const yts = require("yt-search");
const youtubedl = require("yt-dlp-exec");
const fs = require("fs");
const path = require("path");


// CREATE COOKIES FILE

try {

    if (process.env.COOKIES_TXT) {

        fs.writeFileSync(
            "./cookies.txt",
            process.env.COOKIES_TXT
        );

        console.log(
            "COOKIE CREATED:",
            process.env.COOKIES_TXT.length
        );

    } else {

        console.log("NO COOKIES VARIABLE");

    }

}
catch(err){

    console.log(
        "COOKIE ERROR:",
        err.message
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
"🎥 Usage:\n.video video name"
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
"START DOWNLOAD:",
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
f =>
f.endsWith(".mp4") ||
f.endsWith(".webm")
);



if(!files.length){

throw new Error(
"Downloaded file not found"
);

}




const filePath =
path.join(
"./videos",
files[files.length-1]
);





console.log(
"SENDING:",
filePath
);





const buffer =
fs.readFileSync(filePath);





console.log(
"SIZE:",
buffer.length
);






await sock.sendMessage(
chatId,
{

video:buffer,

mimetype:
"video/mp4",

fileName:
`${video.title}.mp4`,

caption:
`🎥 ${video.title}\n\n✅ Downloaded`

},
{
quoted:message
}
);






fs.unlinkSync(filePath);



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
