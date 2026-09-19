const axios = require("axios");
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



async function tornadoDownload(url){

    const res = await axios.post(
        process.env.TORNADO_API_URL,
        {
            url:url,
            quality:"1080"
        },
        {
            headers:{
                "Authorization":
                `Bearer ${process.env.TORNADO_API_KEY}`,

                "Content-Type":
                "application/json"
            },

            timeout:120000
        }
    );


    console.log(
        "TORNADO RESPONSE:",
        res.data
    );


    return (
        res.data.url ||
        res.data.download ||
        res.data.downloadUrl ||
        res.data.result?.url
    );

}



async function videoCommand(sock, chatId, message){

try{


const text = getText(message);


const query =
text.replace(/^\.video\s*/i,"").trim();



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



await sock.sendMessage(chatId,{
react:{
text:"🔎",
key:message.key
}
});



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



const downloadUrl =
await tornadoDownload(video.url);



if(!downloadUrl){

throw new Error(
"No download URL from Tornado"
);

}



await sock.sendMessage(
chatId,
{
video:{
url:downloadUrl
},

mimetype:
"video/mp4",

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
catch(err){


console.log(
"VIDEO ERROR:",
err.response?.data || err.message
);



await sock.sendMessage(
chatId,
{
text:
`❌ Video Download Failed\n\n${
err.response?.data?.message ||
err.message
}`
},
{
quoted:message
}
);


}

}


module.exports = videoCommand;
