const axios = require("axios");
const yts = require("yt-search");


const APIFY_TOKEN = process.env.APIFY_TOKEN;



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
                "📦 *APIFY RESPONSE*\n\n" +
                JSON.stringify(
                    response.data,
                    null,
                    2
                ).slice(0,3500)
            },
            {
                quoted:message
            }
        );



        const data =
        response.data[0];



        if(!data){

            throw new Error(
                "Apify returned empty data"
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
                "No download URL found in Apify response"
            );

        }



        return downloadUrl;



    }
    catch(error){


        await sock.sendMessage(
            chatId,
            {
                text:
                "❌ *APIFY ERROR*\n\n" +
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

📥 Apify downloading...`

},
{
quoted:message
}
);







const downloadUrl =
await downloadWithApify(
    video.url,
    sock,
    chatId,
    message
);





if(!downloadUrl){

throw new Error(
"Download URL missing"
);

}






const file =
await axios.get(

downloadUrl,

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

`❌ *VIDEO FAILED*

${error.message}`

},

{
quoted:message
}

);


}



}




module.exports = videoCommand;
