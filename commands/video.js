const axios = require("axios");
const yts = require("yt-search");


const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://api.piped.projectsegfau.lt",
    "https://pipedapi.leptons.xyz",
    "https://piped-api.privacy.com.de"
];



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




async function getPipedStream(videoId){


    for(const base of PIPED_INSTANCES){


        try{


            console.log(
                "Trying Piped:",
                base
            );



            const res = await axios.get(

                `${base}/streams/${videoId}`,

                {
                    timeout:15000,

                    headers:{
                        "User-Agent":
                        "Mozilla/5.0"
                    }
                }

            );



            const videos =
            res.data.videoStreams || [];



            if(videos.length){


                const bestVideo =
                videos.sort(
                    (a,b)=>
                    (b.height || 0) -
                    (a.height || 0)

                )[0];



                console.log(
                    "Piped Success:",
                    base
                );



                return bestVideo.url;


            }



        }
        catch(err){


            console.log(

                "Piped Failed:",
                base,
                err.message

            );


        }


    }


    return null;

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






// GET STREAM FROM PIPED

const streamUrl =
await getPipedStream(
video.videoId
);





if(!streamUrl){


throw new Error(
"Stream not found"
);


}






// DOWNLOAD VIDEO BUFFER

const response =
await axios.get(

streamUrl,

{

responseType:
"arraybuffer",

timeout:
60000

}

);





const videoBuffer =
Buffer.from(
response.data
);





if(videoBuffer.length < 10000){


throw new Error(
"Invalid video file"
);


}






await sock.sendMessage(

chatId,

{

video:
videoBuffer,


mimetype:
"video/mp4",


fileName:
`${video.title}.mp4`,


caption:

`🎥 *${video.title}*

✨ Downloaded by SALMAN KHAN`

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
