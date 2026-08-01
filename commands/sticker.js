const {
    downloadMediaMessage
} = require("@whiskeysockets/baileys");

const sharp = require("sharp");

module.exports = async function stickerCommand(sock, from, msg) {
    try {

        const quoted = msg.message?.extendedTextMessage?.contextInfo;

        if (!quoted) {
            return sock.sendMessage(from, {
                text: "Reply kisi image par karo."
            }, { quoted: msg });
        }

        const buffer = await downloadMediaMessage(
            {
                message: quoted.quotedMessage,
                key: quoted.stanzaId
            },
            "buffer",
            {},
            {
                logger: sock.logger,
                reuploadRequest: sock.updateMediaMessage
            }
        );

        const webp = await sharp(buffer)
            .resize(512, 512, {
                fit: "contain",
                background: {
                    r: 0,
                    g: 0,
                    b: 0,
                    alpha: 0
                }
            })
            .webp({
                quality: 90
            })
            .toBuffer();

        await sock.sendMessage(from, {
            sticker: webp
        }, {
            quoted: msg
        });

    } catch (e) {
        console.log(e);

        await sock.sendMessage(from, {
            text: e.stack || e.message
        }, {
            quoted: msg
        });
    }
};