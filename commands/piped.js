const axios = require("axios");


const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://api.piped.projectsegfau.lt",
    "https://pipedapi.leptons.xyz",
    "https://piped-api.privacy.com.de"
];


async function getPipedStream(videoId){

    for(const base of PIPED_INSTANCES){

        try{

            console.log("Trying:", base);


            const res = await axios.get(
                `${base}/streams/${videoId}`,
                {
                    timeout:15000,
                    headers:{
                        "User-Agent":"Mozilla/5.0"
                    }
                }
            );


            const videos =
            res.data.videoStreams || [];


            if(videos.length){

                const best =
                videos.sort(
                    (a,b)=>
                    (b.height || 0) -
                    (a.height || 0)
                )[0];


                console.log(
                    "Working:",
                    base
                );


                return best.url;

            }


        }catch(err){

            console.log(
                "Failed:",
                base,
                err.message
            );

        }

    }


    return null;

}


module.exports = {
    getPipedStream
};