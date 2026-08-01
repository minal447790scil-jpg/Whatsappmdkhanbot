const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function apkCommand(sock, chatId, message) {
    let apkPath = null;

    try {
        const messageContent =
            message.message?.ephemeralMessage?.message ||
            message.message?.viewOnceMessage?.message ||
            message.message?.viewOnceMessageV2?.message ||
            message.message;

        const userMessage =
            messageContent?.conversation ||
            messageContent?.extendedTextMessage?.text ||
            messageContent?.imageMessage?.caption ||
            messageContent?.videoMessage?.caption ||
            '';

        const appName = userMessage
            .split(' ')
            .slice(1)
            .join(' ')
            .trim();

        if (!appName) {
            return await sock.sendMessage(
                chatId,
                {
                    text:
                        '⚠️ Please provide an app name.\n' +
                        'Example: `.apk whatsapp`'
                },
                { quoted: message }
            );
        }

        // Loading reaction
        await sock.sendMessage(chatId, {
            react: {
                text: '⏳',
                key: message.key
            }
        });

        // APK API
        const response = await axios.get(
            'https://api.nexoracle.com/downloader/apk',
            {
                params: {
                    apikey: 'free_key@maher_apis',
                    q: appName
                },
                timeout: 60000
            }
        );

        const result = response.data?.result;

        if (
            response.data?.status !== 200 ||
            !result ||
            !result.dllink
        ) {
            throw new Error('APK not found');
        }

        const {
            name,
            lastup,
            package: packageName,
            size,
            icon,
            dllink
        } = result;

        // Preview
        await sock.sendMessage(
            chatId,
            {
                image: {
                    url: icon
                },
                caption:
                    `📦 *Downloading ${name}...*\n` +
                    `📏 *Size:* ${size || 'Unknown'}\n\n` +
                    `⏳ Please wait...`
            },
            { quoted: message }
        );

        // Temp folder
        const tempDir = path.join(
            __dirname,
            '../tmp'
        );

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, {
                recursive: true
            });
        }

        const safeName = String(
            name || 'application'
        )
            .replace(/[<>:"/\\|?*]/g, '')
            .trim() || 'application';

        apkPath = path.join(
            tempDir,
            `${Date.now()}-${safeName}.apk`
        );

        // Stream APK download
        const apkResponse = await axios({
            method: 'GET',
            url: dllink,
            responseType: 'stream',
            timeout: 10 * 60 * 1000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        const writer =
            fs.createWriteStream(apkPath);

        apkResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
            apkResponse.data.on('error', reject);
        });

        if (!fs.existsSync(apkPath)) {
            throw new Error(
                'APK file was not downloaded'
            );
        }

        const fileStats =
            fs.statSync(apkPath);

        if (fileStats.size === 0) {
            throw new Error(
                'Downloaded APK is empty'
            );
        }

        console.log(
            `[APK] Download complete: ${apkPath}`
        );

        console.log(
            `[APK] File size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`
        );

        const details =
            `📦 *APK Details* 📦\n\n` +
            `🔖 *Name:* ${name}\n` +
            `📅 *Last Update:* ${lastup || 'Unknown'}\n` +
            `📦 *Package:* ${packageName || 'Unknown'}\n` +
            `📏 *Size:* ${size || 'Unknown'}\n\n` +
            `> © POWERED BY SALMAN KHAN`;

        // Read APK from disk
        const apkBuffer =
            fs.readFileSync(apkPath);

        console.log(
            `[APK] Sending APK to WhatsApp...`
        );

        // Send APK
        await sock.sendMessage(
            chatId,
            {
                document: apkBuffer,
                mimetype:
                    'application/vnd.android.package-archive',
                fileName:
                    `${safeName}.apk`,
                caption: details
            },
            {
                quoted: message
            }
        );

        console.log(
            `[APK] APK sent successfully`
        );

        // Success reaction
        await sock.sendMessage(chatId, {
            react: {
                text: '✅',
                key: message.key
            }
        });

    } catch (error) {
        console.error(
            '❌ APK Error:',
            error?.response?.status ||
            '',
            error.message
        );

        await sock.sendMessage(
            chatId,
            {
                text:
                    `❌ APK Error: ${error.message}`
            },
            {
                quoted: message
            }
        ).catch(() => {});

        await sock.sendMessage(chatId, {
            react: {
                text: '❌',
                key: message.key
            }
        }).catch(() => {});

    } finally {
        if (
            apkPath &&
            fs.existsSync(apkPath)
        ) {
            setTimeout(() => {
                try {
                    fs.unlinkSync(apkPath);

                    console.log(
                        '[APK] Temp APK deleted'
                    );
                } catch (e) {}
            }, 10000);
        }
    }
}

module.exports = apkCommand;