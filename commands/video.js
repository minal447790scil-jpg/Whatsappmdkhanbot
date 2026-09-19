const axios = require("axios");
const yts = require("yt-search");


const BASE_URL = "https://api.tornadoapi.io";



function getText(message){

    let msg = message?.message || {};

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
    ).trim();

}




async function tornadoDownload(youtubeUrl){


    // Create download job

    const create = await axios.post(
        `${BASE_URL}/jobs`,
        {
            url: youtubeUrl,
            quality: "1080"
        },
        {
            headers:{
                "x-api-key":
                process.env.TORNADO_API_KEY,

                "Content-Type":
                "application/json"
            }
        }
    );



    const jobId =
    create.data.job_id;



    console.log(
        "TORNADO JOB:",
        jobId
    );



    let downloadUrl = null;



    // Check job status

    for(let i = 0; i < 40; i++){


        await new Promise(
            resolve => setTimeout(resolve,3000)
        );



        const status = await axios.get(
            `${BASE_URL}/jobs/${jobId}`,
            {
                headers:{
                    "x-api-key":
                    process.env.TORNADO_API_KEY
                }
            }
        );



        console.log(
            "TORNADO STATUS:",
            status.data
        );



        const data = status.data;



        if(
            data.file_url ||
            data.download_url ||
            data.url
        ){

            downloadUrl =
            data.file_url ||
            data.download_url ||
            data.url;

            break;

        }



        if(data.status === "failed"){

            throw new Error(
                "Tornado download failed"
            );

        }


    }



    if(!downloadUrl){

        throw new Error(
            "Download timeout"
        );

    }



    return downloadUrl;

}






async function videoCommand(
    sock,
    chatId,
    message
){


try{


const text =
getText(message);



const query =
text.replace(/^\.video\s*/i,"")
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

📥 Downloading 1080p...`
},
{
quoted:message
}
);






const url =
await tornadoDownload(
video.url
);






await sock.sendMessage(
chatId,
{
video:{
url:url
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
catch(err){


console.log(
"TORNADO ERROR:",
err.response?.data || err.message
);



await sock.sendMessage(
chatId,
{
text:
`❌ *Video Download Failed*

${
err.response?.data?.error ||
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
