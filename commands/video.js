const yts = require("yt-search");
const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");


async function videoCommand(sock, chatId, message) {

    let filePath = null;

    try {

        // reactions
        for (const emoji of ["📥","⏳","🎥"]) {
            await sock.sendMessage(chatId,{
                react:{
                    text:emoji,
                    key:message.key
                }
            });
        }


        const content =
            message.message?.ephemeralMessage?.message ||
            message.message?.viewOnceMessage?.message ||
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            "";


        const query = content
            .replace(/^\.video\s*/i,"")
            .trim();



        if(!query){

            return await sock.sendMessage(chatId,{
                text:
                "❌ Use:\n.video <video name/link>"
            },{
                quoted:message
            });

        }



        let url;
        let title = "YouTube Video";
        let thumbnail = "";



        // Link

        if(
            query.includes("youtube.com") ||
            query.includes("youtu.be")
        ){

            url = query;


            try {

                const info = await ytdlp(url,{
                    dumpSingleJson:true,
                    noPlaylist:true
                });

                title =
                info.title || title;

                thumbnail =
                info.thumbnail || "";

            }catch(e){}



        }else{


            const search = await yts(query);


            if(!search.videos.length){

                return await sock.sendMessage(chatId,{
                    text:"❌ Video not found"
                },{
                    quoted:message
                });

            }


            const video = search.videos[0];


            url = video.url;
            title = video.title;
            thumbnail = video.thumbnail;


        }




        // Preview

        if(thumbnail){

            await sock.sendMessage(chatId,{
                image:{
                    url:thumbnail
                },
                caption:
`🎥 *${title}*

📥 Downloading video...`
            },{
                quoted:message
            });

        }else{

            await sock.sendMessage(chatId,{
                text:
`🎥 *${title}*

📥 Downloading video...`
            },{
                quoted:message
            });

        }





        filePath = path.join(
            os.tmpdir(),
            `video_${Date.now()}.mp4`
        );




        console.log("Downloading:",url);



        await ytdlp(url,{

            format:
            "best[ext=mp4]/best",

            output:filePath,

            noPlaylist:true,

            socketTimeout:60

        });





        if(!fs.existsSync(filePath)){

            throw new Error(
                "Video file not created"
            );

        }




        const videoBuffer =
        fs.readFileSync(filePath);




        await sock.sendMessage(chatId,{

            video:videoBuffer,

            mimetype:"video/mp4",

            fileName:
            `${title}.mp4`,

            caption:
`🎥 *${title}*

> Downloaded by SALMAN KHAN`

        },{
            quoted:message
        });





        await sock.sendMessage(chatId,{
            react:{
                text:"✅",
                key:message.key
            }
        });



    }catch(error){


        console.log(
            "VIDEO ERROR:",
            error
        );


        await sock.sendMessage(chatId,{
            text:
`❌ Video Download Failed

${error.message}`
        },{
            quoted:message
        });



    }finally{


        if(filePath && fs.existsSync(filePath)){

            fs.unlinkSync(filePath);

        }

    }

}


module.exports = videoCommand;
