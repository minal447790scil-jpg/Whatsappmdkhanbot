const axios = require("axios");
const yts = require("yt-search");


async function cobaltDownload(url) {

    const res = await axios.post(
        "https://api.cobalt.tools/",
        {
            url: url,
            videoQuality: "1080",
            isAudioOnly: false,
            filenameStyle: "pretty"
        },
        {
            headers: {
                "Accept": "application/json",
                "Authorization":
                `Api-Key ${process.env.COBALT_API_KEY}`
            }
        }
    );


    if(res.data?.url){
        return res.data.url;
    }


    throw new Error(
        "Cobalt download URL not found"
    );
}



async function videoCommand(sock, chatId, message){

try{


const text =
message.message?.conversation ||
message.message?.extendedTextMessage?.text ||
"";


const query =
text.replace(/^\.video\s*/i,"").trim();



if(!query){

return sock.sendMessage(
chatId,
{
text:"🎥 Use: .video song name"
},
{
quoted:message
}
);

}



const search =
await yts(query);


const video =
search.videos[0];


if(!video){

throw new Error(
"No video found"
);

}



await sock.sendMessage(
chatId,
{
image:{
url:video.thumbnail
},
caption:
`🎥 *${video.title}*

📥 Downloading 1080p...`
},
{
quoted:message
}
);



const downloadUrl =
await cobaltDownload(video.url);



await sock.sendMessage(
chatId,
{
video:{
url:downloadUrl
},
mimetype:"video/mp4",
caption:
`🎥 *${video.title}*

✨ *Downloaded by SALMAN KHAN*`
},
{
quoted:message
}
);



}

catch(err){

console.log(err);

await sock.sendMessage(
chatId,
{
text:
`❌ Video Download Failed\n\n${err.message}`
},
{
quoted:message
}
);

}

}


module.exports = videoCommand;
