const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

async function emojimixCommand(sock, chatId, msg) {
    try {
        const text =
            msg.message?.conversation?.trim() ||
            msg.message?.extendedTextMessage?.text?.trim() ||
            '';

        const args = text.split(' ').slice(1);

        if (!args[0] || !args[0].includes('+')) {
            return await sock.sendMessage(chatId, {
                text: '🎴 Example: .emojimix 😂+😭'
            }, { quoted: msg });
        }


        const [e1, e2] = args[0]
            .split('+')
            .map(x => x.trim());


        function emojiCode(emoji) {
            return [...emoji]
                .map(e => 'u' + e.codePointAt(0).toString(16))
                .join('-');
        }


        const code1 = emojiCode(e1);
        const code2 = emojiCode(e2);


        const dates = [
            '20250610',
            '20250430',
            '20241003',
            '20240828',
            '20240530',
            '20240206',
            '20231113',
            '20230803',
            '20230515',
            '20230301',
            '20221101',
            '20220915',
            '20220406',
            '20220203',
            '20211115',
            '20210831',
            '20210521',
            '20210218',
            '20201001'
        ];


        let imageUrl = null;


        for (const date of dates) {

            const urls = [
                `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${code1}/${code1}_${code2}.png`,
                `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${code2}/${code2}_${code1}.png`
            ];


            for (const url of urls) {

                const res = await fetch(url);

                if (res.status === 200) {
                    imageUrl = url;
                    break;
                }
            }

            if (imageUrl) break;
        }


        if (!imageUrl) {
            return await sock.sendMessage(chatId, {
                text: '❌ These emojis cannot be mixed!'
            }, { quoted: msg });
        }


        const img = await fetch(imageUrl);
        const buffer = await img.buffer();


        const tmpDir = path.join(process.cwd(), 'tmp');

        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }


        const time = Date.now();

        const png = path.join(tmpDir, `${time}.png`);
        const webp = path.join(tmpDir, `${time}.webp`);


        fs.writeFileSync(png, buffer);


        await new Promise((resolve, reject) => {

            exec(
                `ffmpeg -y -i "${png}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" "${webp}"`,
                err => err ? reject(err) : resolve()
            );

        });


        // FIXED SEND METHOD
        const stickerBuffer = fs.readFileSync(webp);

        await sock.sendMessage(
            chatId,
            {
                sticker: stickerBuffer,
                mimetype: 'image/webp'
            },
            { quoted: msg }
        );


        // cleanup after upload
        setTimeout(() => {
            try {
                if (fs.existsSync(png)) fs.unlinkSync(png);
                if (fs.existsSync(webp)) fs.unlinkSync(webp);
            } catch {}
        }, 30000);


    } catch (e) {

        console.log('EmojiMix Error:', e);

        await sock.sendMessage(chatId, {
            text:
`❌ EmojiMix Error:
${e.message}`
        }, { quoted: msg });

    }
}

module.exports = emojimixCommand;