const axios = require("axios");
const yts = require("yt-search");



async function ssaveExtract(url){

    const res = await axios.post(

        "https://api.ssave.cc/open/v1/extract",

        {
            url:url
        },

        {
            timeout:60000,
            headers:{
                "User-Agent":"Mozilla/5.0",
                "Content-Type":"application/json",
                "Accept":"application/json"
            }
        }

    );


    return res.data;

}





async function ssaveDownload(id){

    const res = await axios.get(

        `https://api.ssave.cc/open/v1/download?id=${id}&type=hd`,

        {

            responseType:"arraybuffer",

            timeout:120000,

            headers:{
                "User-Agent":"Mozilla/5.0"
            }

        }

    );


    return Buffer.from(res.data);

}





async function getVideo(url){

    const data = await ssaveExtract(url);


    console.log(
        "SSAVE RESPONSE:",
        JSON.stringify(data)
    );


    const id =

    data.id ||
    data.token ||
    data.videoId ||
    data.downloadId;



    if(!id){

        throw new Error(
            "SSave ID not found"
        );

    }



    const buffer =
    await ssaveDownload(id);



    return buffer;

}







async function videoCommand(sock,chatId,message){

try{


const text =

message.message?.conversation ||

message.message?.extendedTextMessage?.text ||

"";



const query =

text.replace(/^\.video\s*/i,"")
.trim();



if(!query){

return sock.sendMessage(
chatId,
{
text:"Use: .video video name"
},
{
quoted:message
}
);

}





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
text:
`🎥 Downloading:\n${video.title}`
},
{
quoted:message
}
);





const buffer =
await getVideo(video.url);





await sock.sendMessage(

chatId,

{

video:buffer,

mimetype:"video/mp4",

caption:
`✅ ${video.title}`

},

{
quoted:message
}

);




}
catch(e){


console.log(
"VIDEO ERROR:",
e.response?.data || e.message
);



await sock.sendMessage(

chatId,

{

text:

`❌ Error:\n${
e.response?.data
?
JSON.stringify(e.response.data)
:
e.message
}`

},

{
quoted:message
}

);


}



}



module.exports = videoCommand;
