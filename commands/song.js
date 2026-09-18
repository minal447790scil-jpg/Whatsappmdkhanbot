const yts = require("yt-search");
const ytdlp = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");

async function songCommand(sock, chatId, message) {

    let filePath = null;

    try {

        // reactions
        for (const emoji of ["📥","⏳","🎵"]) {
            await sock.sendMessage(chatId,{
                react:{
                    text:emoji,
                    key:message.key
                }
            });
        }


        const text =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            "";


        const query = text.replace(/^\.song\s*/i,"").trim();


        if(!query){
            return sock.sendMessage(chatId,{
                text:"❌ Use:\n.song <song name>"
            },{
                quoted:message
            });
        }


        let url;
        let title;
        let thumbnail;


        if(query.includes("youtube.com") || query.includes("youtu.be")){

            url=query;

            const info = await ytdlp(url,{
                dumpSingleJson:true,
                noPlaylist:true,
                extractorArgs:"youtube:player_client=android"
            });

            title=info.title;
            thumbnail=info.thumbnail;


        }else{

            const search=await yts(query);

            if(!search.videos.length)
                throw new Error("Song not found");


            const video=search.videos[0];

            url=video.url;
            title=video.title;
            thumbnail=video.thumbnail;

        }


        // preview
        await sock.sendMessage(chatId,{
            image:{
                url:thumbnail
            },
            caption:
`🎵 *${title}*

📥 Downloading...`
        },{
            quoted:message
        });



        filePath=path.join(
            os.tmpdir(),
            `song_${Date.now()}.mp3`
        );


        await ytdlp(url,{

            extractAudio:true,
            audioFormat:"mp3",
            audioQuality:"128K",

            output:filePath,

            noPlaylist:true,

            extractorArgs:
            "youtube:player_client=android"

        });



        if(!fs.existsSync(filePath))
            throw new Error("Audio file not created");


        const audio=fs.readFileSync(filePath);



        await sock.sendMessage(chatId,{
            audio:audio,
            mimetype:"audio/mpeg",
            fileName:`${title}.mp3`,
            ptt:false,

            contextInfo:{
                externalAdReply:{
                    title:title,
                    body:"🎵 Song Downloader",
                    thumbnailUrl:thumbnail,
                    mediaType:2,
                    renderLargerThumbnail:true,
                    sourceUrl:url
                }
            }

        },{
            quoted:message
        });



        await sock.sendMessage(chatId,{
            react:{
                text:"✅",
                key:message.key
            }
        });


    }catch(err){

        console.log("SONG ERROR:",err);

        await sock.sendMessage(chatId,{
            text:
`❌ Song Download Failed

${err.message}`
        },{
            quoted:message
        });


    }finally{

        if(filePath && fs.existsSync(filePath)){
            fs.unlinkSync(filePath);
        }

    }
}


module.exports= songCommand;
