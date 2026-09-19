const axios = require("axios");
const yts = require("yt-search");


const APIFY_TOKEN = process.env.APIFY_TOKEN;


console.log(
    "APIFY TOKEN:",
    APIFY_TOKEN ? APIFY_TOKEN.slice(0,10) : "MISSING"
);



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





async function downloadWithApify(
    youtubeUrl,
    sock,
    chatId,
    message
){

    try{


        if(!APIFY_TOKEN){

            throw new Error(
                "APIFY_TOKEN missing in Railway variables"
            );

        }



        const response = await axios.post(

            `https://api.apify.com/v2/acts/convertfleetdotonline~video-downloader/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,

            {

                videoUrls:[
                    youtubeUrl
                ],

                proxyConfiguration:{

                    useApifyProxy:true,

                    apifyProxyGroups:[
                        "RESIDENTIAL"
                    ]

                }

            },

            {
                timeout:120000
            }

        );



        await sock.sendMessage(
            chatId,
            {
                text:
                "📦 APIFY RESPONSE:\n\n" +
                JSON.stringify(
                    response.data,
                    null,
                    2
                ).slice(0,3000)
            },
            {
                quoted:message
            }
        );




        const data =
        response.data?.[0];



        if(!data){

            throw new Error(
                "Apify returned empty response"
            );

        }




        const downloadUrl =

            data.downloadUrl ||
            data.download_url ||
            data.videoUrl ||
            data.video_url ||
            data.url ||
            data.fileUrl ||
            data.file_url;



        if(!downloadUrl){

            throw new Error(
                "Download URL not found"
            );

        }



        return downloadUrl;



    }
    catch(error){


        await sock.sendMessage(
            chatId,
            {
                text:
                "❌ APIFY ERROR:\n\n" +
                (
                    error.response?.data
                    ?
                    JSON.stringify(
                        error.response.data,
                        null,
                        2
                    )
                    :
                    error.message
                )
            },
            {
                quoted:message
            }
        );


        return null;

    }

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

📥 Downloading from Apify...`

},
{
quoted:message
}
);






const url =
await downloadWithApify(
    video.url,
    sock,
    chatId,
    message
);





if(!url){

throw new Error(
"Apify URL missing"
);

}





await sock.sendMessage(
chatId,
{
text:
"⬇️ Download URL received"
},
{
quoted:message
}
);






const file =
await axios.get(
    url,
    {
        responseType:"arraybuffer",
        timeout:120000
    }
);




const buffer =
Buffer.from(file.data);





await sock.sendMessage(

chatId,

{

video:buffer,

mimetype:"video/mp4",

fileName:
`${video.title}.mp4`,

caption:

`🎥 ${video.title}

✅ Done`

},

{
quoted:message
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
`❌ VIDEO FAILED

${error.message}`
},
{
quoted:message
}
);


}


}



module.exports = videoCommand;
