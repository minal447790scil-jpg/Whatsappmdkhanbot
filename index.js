require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
//const tracker = require("./lib/messageTracker");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, jidNormalizedUser, Browsers, delay } = require('@whiskeysockets/baileys');
const P = require('pino');
const os = require('os');

const toBold = (text) => {
    const boldChars = {
        'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺', 'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
        'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗴', 'H': '𝗵', 'I': '𝗶', 'J': '𝗷', 'K': '𝗸', 'L': '𝗹', 'M': '𝗺', 'N': '𝗻', 'O': '𝗼', 'P': '𝗽', 'Q': '𝗤', 'R': '𝗿', 'S': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
        '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    };
    return text.split('').map(c => boldChars[c] || c).join('');
};

// Import Commands
const commands = {
    sticker: require('./commands/sticker'),
    weather: require('./commands/weather'),
  //  today: require("./commands/today"),
  //  cherry: require('./commands/cherry'),
    fikrandom: require('./commands/fikrandom'),
   // randominsta: require('./commands/randominsta'),
    random: require('./commands/random'),
    autoreacts: require('./commands/autoreacts'),
    status: require('./commands/status'),
    song: require('./commands/song'),
    video: require('./commands/video'),
   hm: require('./commands/vv'),
 //   dp: require('./commands/dp'),
    antidelete: require('./commands/antidelete'),
    anticall: require('./commands/anticall'),
    tagall: require('./commands/tagall'),
    hidetag: require('./commands/hidetag'),
ping: require('./commands/ping'),
owner: require('./commands/owner'),
private: require('./commands/private'),
public: require('./commands/public'),
hidetag: require('./commands/hidetag'),
tagall: require('./commands/tagall'),
setname: require('./commands/setname'),
insta: require('./commands/instagram'),
tiktok: require('./commands/tiktok'),
joke: require('./commands/joke'),
meme: require('./commands/meme'),
groupinfo: require('./commands/groupinfo'),
gdrive: require('./commands/gdrive'),
mf: require('./commands/mf'),
translate: require('./commands/translate').handleTranslateCommand,
apk: require('./commands/apk'),
autoread: require('./commands/autoread').autoreadCommand,
//character: require('./commands/character'),
emojimix: require('./commands/emojimix'),
facebook: require('./commands/facebook'),
hack: require('./commands/hack'),
accept: require('./commands/accept'),
chid: require('./commands/chid'),
follow: require('./commands/follow'),
report: require('./commands/report'),
//reportch: require('./commands/reportch'),
setpp: require('./commands/setpp'),
fullpp: require('./commands/fullpp'),
};

const { storeMessage, handleMessageRevocation } = require('./commands/antidelete');
const { handleAutoread } = require('./commands/autoread');
const isOwner = require('./lib/isOwner');
const { isAdmin: checkAdmin } = require('./lib/isAdmin');

// Telegram Bot Setup
const tgToken = process.env.TELEGRAM_TOKEN || "8895016993:AAGhAYOppfyUSoxCntWwrGdk4PzRlZC2y_w";
const tgBot = new TelegramBot(tgToken, { polling: true });

const getStats = () => {
    const totalUsers = botData.telegramUsers ? botData.telegramUsers.length : 0;
    const totalActive = Object.values(sessions).filter(s => s.isConnected).length;
    return `👋 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 SALMAN KHAN BOT\n\n` +
           `╭━━━〔 𝗕𝗢𝗧 𝗦𝗧𝗔𝗧𝗨𝗦 〕━━━┈⊷\n` +
           `┃ ⋄ 𝗧𝗢𝗧𝗔𝗟 𝗨𝗦𝗘𝗥: ${totalUsers}\n` +
           `┃ ⋄ 𝗧𝗢𝗧𝗔𝗟 𝗔𝗖𝗧𝗜𝗩𝗘 𝗕𝗢𝗧𝗦: ${totalActive}\n` +
           `╰━━━━━━━━━━━━━━━━━━┈⊷`;
};

tgBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!botData.telegramUsers) botData.telegramUsers = [];
    if (!botData.telegramUsers.includes(chatId)) {
        botData.telegramUsers.push(chatId);
        saveBotData();
    }

    if (text === '/start') {
        const welcomeMsg = "👋 *WELCOME TO SALMAN KHAN BOT*\n\n🚀 *FAST & SECURE WHATSAPP AUTOMATION*\n\n📱 *ENTER YOUR WHATSAPP NUMBER*\n_(Example: 923000000000)_";
        await tgBot.sendMessage(chatId, welcomeMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [[{ text: "📊 BOT STATS" }]],
                resize_keyboard: true
            }
        });
        return;
    }

    if (text === '📊 BOT STATS') {
        await tgBot.sendMessage(chatId, getStats());
        return;
    }

    if (/^\d+$/.test(text)) {
        const userId = chatId.toString();
        const phoneNumber = text;

        // Cooldown Logic: 1 minute for same number
        const now = Date.now();
        const lastRequest = pairingCooldowns.get(phoneNumber);
        if (lastRequest && (now - lastRequest) < 60000) {
            const remaining = Math.ceil((60000 - (now - lastRequest)) / 1000);
            return await tgBot.sendMessage(chatId, `⚠️ *Please wait ${remaining} seconds before requesting another code for this number.*`, { parse_mode: 'Markdown' });
        }
        pairingCooldowns.set(phoneNumber, now);

        // Clear existing session if any to avoid getting stuck
        if (sessions[userId]) {
            if (sessions[userId].tgAnimInterval) clearInterval(sessions[userId].tgAnimInterval);
            if (sessions[userId].sock) {
                try { sessions[userId].sock.logout(); } catch (e) {}
                try { sessions[userId].sock.end(); } catch (e) {}
            }
            delete sessions[userId];
        }

        // Clear the session directory to ensure a fresh start
        const authPath = path.join(AUTH_DIR, userId);
        if (fs.existsSync(authPath)) {
            try { fs.removeSync(authPath); } catch (e) {}
        }

        sessions[userId] = new BotSession(userId);
        
        const loadingMsg = await tgBot.sendMessage(chatId, "🔄 *Connecting to WhatsApp Servers...*", { parse_mode: 'Markdown' });
        
        let frames = ["⏳", "⌛", "🔄", "⚙️"];
        let i = 0;
        const animInterval = setInterval(async () => {
            try {
                await tgBot.editMessageText(`${frames[i % frames.length]} *Generating Pairing Code for ${text}...*`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id,
                    parse_mode: 'Markdown'
                });
                i++;
            } catch (e) { clearInterval(animInterval); }
        }, 1500);
        
        sessions[userId].tgChatId = chatId;
        sessions[userId].tgLoadingMsgId = loadingMsg.message_id;
        sessions[userId].tgAnimInterval = animInterval;
        await sessions[userId].initialize(text);
    }
});

// Web server removed as per user request

const AUTH_DIR = './sessions';
const DATA_FILE = './data/bot_data.json';
fs.ensureDirSync(AUTH_DIR);
fs.ensureDirSync('./data');

let botData = { antilinkGroups: {}, totalBots: 0, registeredBots: [], statusSettings: {}, antiDelete: {}, userNames: {}, antiCall: {}, telegramUsers: [] };
if (fs.existsSync(DATA_FILE)) {
    try { botData = fs.readJsonSync(DATA_FILE); } catch (e) {}
}

function saveBotData() {
    fs.writeJsonSync(DATA_FILE, botData);
}

const sessions = {}; 
const userSockets = {}; 
const messageLogs = {}; 
const pairingCooldowns = new Map();

async function loadExistingSessions() {
    try {
        const authDirs = await fs.readdir(AUTH_DIR);
        for (const userId of authDirs) {
            const authPath = path.join(AUTH_DIR, userId);
            const stats = await fs.stat(authPath);
            if (stats.isDirectory()) {
                const credsFile = path.join(authPath, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    if (!sessions[userId]) {
                        sessions[userId] = new BotSession(userId);
                        sessions[userId].initialize().catch(err => {
                            console.error(`[System] Failed to auto-initialize session ${userId}:`, err.message);
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error('[System] Error loading existing sessions:', err.message);
    }
}

class BotSession {
    constructor(userId) {
        this.userId = userId;
        this.sock = null;
        this.isConnected = false;
        this.authPath = path.join(AUTH_DIR, userId);
        this.isInitializing = false;
        this.lastConnectMessageTime = null;
        this.tgChatId = null;
        this.tgLoadingMsgId = null;
        this.tgAnimInterval = null;
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.tgNotificationSent = false;
    }

    async addToQueue(task) {
        this.messageQueue.push(task);
        if (!this.isProcessingQueue) {
            this.processQueue();
        }
    }

    async processQueue() {
        this.isProcessingQueue = true;
        while (this.messageQueue.length > 0) {
            const task = this.messageQueue.shift();
            try {
                await task();
            } catch (e) {
                this.sendLog(`Queue error: ${e.message}`, "error");
            }
            await delay(500); // Prevent spamming/rate limiting
        }
        this.isProcessingQueue = false;
    }

    sendLog(message, type = 'info') {
        console.log(`[${this.userId}] ${message}`);
    }

    sendConnectionStatus() {
        // No web UI to update
    }

    async safeSendMessage(jid, content, options = {}) {
        if (!this.isConnected || !this.sock) {
            throw new Error("Connection Closed");
        }
        try {
            return await this.sock.sendMessage(jid, content, options);
        } catch (e) {
            if (e.message.includes("closed") || e.message.includes("Connection")) {
                this.isConnected = false;
            }
            throw e;
        }
    }

    async initialize(pairingNumber = null) {
        if (this.isInitializing) return;
        this.isInitializing = true;
        try {
            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            
	            this.sock = makeWASocket({
	                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
                },
                generateHighQualityLinkPreview: true,
                maxMsgRetryCount: 3,
                msgRetryCounterCache: new Map(),
                getMessage: async (key) => {
                    if (messageLogs[this.userId] && messageLogs[this.userId][key.id]) {
                        return messageLogs[this.userId][key.id].message;
                    }
                    return { conversation: 'Hello' };
                },
	                printQRInTerminal: false,
	                logger: P({ level: 'fatal' }),
		                browser: Browsers.ubuntu('Chrome'),
	                syncFullHistory: true,
	                shouldSyncHistoryMessage: () => true,
	                markOnlineOnConnect: true,
	                keepAliveIntervalMs: 60000,
	                defaultQueryTimeoutMs: 60000,
	                connectTimeoutMs: 60000,
	            });

			            if (pairingNumber && !state.creds.registered) {
			                this.sendLog(`Initiating pairing process for ${pairingNumber}...`);
			                
			                // Essential delay for pairing code stability
			                await delay(3000);
			                
			                try {
			                    let code = await this.sock.requestPairingCode(pairingNumber);
			                    code = code?.match(/.{1,4}/g)?.join("-") || code;
			                    
			                    this.sendLog(`Pairing code generated successfully: ${code}`);
			                    
			                    if (this.tgAnimInterval) clearInterval(this.tgAnimInterval);
			                    if (this.tgChatId && this.tgLoadingMsgId) {
			                        try {
			                            await tgBot.editMessageText(`✅ *Your Pairing Code is:* \n\n\`${code}\`\n\n_Enter this code in your WhatsApp linked devices._`, {
			                                chat_id: this.tgChatId,
			                                message_id: this.tgLoadingMsgId,
			                                parse_mode: 'Markdown'
			                            });
			                        } catch (editErr) {
			                            await tgBot.sendMessage(this.tgChatId, `✅ *Your Pairing Code is:* \n\n\`${code}\`\n\n_Enter this code in your WhatsApp linked devices._`, { parse_mode: 'Markdown' });
			                        }
			                    }
			                } catch (e) {
			                    this.sendLog(`Pairing code generation failed: ${e.message}`, "error");
			                    if (this.tgAnimInterval) clearInterval(this.tgAnimInterval);
			                    if (this.tgChatId) {
			                        await tgBot.sendMessage(this.tgChatId, `❌ *Pairing Failed:* ${e.message}\n_Please try again in a few moments._`, { parse_mode: 'Markdown' });
			                    }
			                }
			            }

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('group-participants.update', async (anu) => {
                try {
                    if (anu.action === 'add') {
                        await commands.welcome.handleJoinEvent(this.sock, anu.id, anu.participants).catch(() => {});
                    }
                } catch (e) {}
            });

            this.sock.ev.on('messages.upsert', async (chatUpdate) => {
                try {
                    const msg = chatUpdate.messages[0];
                    if (!msg.message) return;

                    // Skip processing if message is just a retry or from self in a way that causes loops
                    if (msg.key.id.startsWith('BAE5') && msg.key.fromMe) return;
                    
                    // Auto-fix session if decryption fails frequently (handled by Baileys, but we can help)
                    if (msg.messageStubType === 1) { // 1 is CIPHERTEXT
                         this.sendLog("Ciphertext message detected. Session might be out of sync.", "warning");
                    }

                    // Status System
                    if (msg.key.remoteJid === 'status@broadcast') {
                    const protocolMessage = msg.message?.protocolMessage;

if (
    protocolMessage &&
    (protocolMessage.type === 0 || protocolMessage.type === 14)
) {
    await handleMessageRevocation(this.sock, msg);
    return;
}

try {
    await storeMessage(msg);
} catch (e) {
    this.sendLog(
        "Status antidelete store error: " + e.message,
        "error"
    );
}
                        const settings = botData.statusSettings[this.userId];
                        if (settings && settings.autoStatus) {
                            // Auto Seen
                            if (settings.autoSeen) {
                                await this.sock.readMessages([msg.key]).catch(() => {});
                                this.sendLog(`Status seen from ${msg.pushName || msg.key.participant.split('@')[0]}`);
                            }
                            // Auto Like
                            if (settings.autoLike) {
                                await this.sock.sendMessage('status@broadcast', {
                                    react: { text: '❤️', key: msg.key }
                                }, { statusJidList: [msg.key.participant] }).catch(() => {});
                            }
                            // Auto Download
                            if (settings.autoDownload) {
                                try {
                                    const botNumber = jidNormalizedUser(this.sock.user.id);
                                    const messageContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2?.message || msg.message;
                                    const type = Object.keys(messageContent)[0];
                                    if (['imageMessage', 'videoMessage'].includes(type)) {
                                        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                                        const stream = await downloadContentFromMessage(messageContent[type], type.replace('Message', ''));
                                        let buffer = Buffer.from([]);
                                        for await (const chunk of stream) {
                                            buffer = Buffer.concat([buffer, chunk]);
                                            if (buffer.length > 50 * 1024 * 1024) break; // 50MB limit
                                        }
                                        const senderName =
    msg.pushName ||
    msg.message?.extendedTextMessage?.contextInfo?.pushName ||
    msg.key.participant.split('@')[0];

console.log("pushName:", msg.pushName);
console.log("participant:", msg.key.participant);
console.log("participantPn:", msg.key.participantPn);

const caption = `*Status Downloaded*

👤 *From:* @${msg.key.participant.split('@')[0]}

📝 *Caption:* ${messageContent[type].caption || 'No caption'}`;

await this.sock.sendMessage(botNumber, {
    [type.replace('Message', '')]: buffer,
    caption,
    mentions: [msg.key.participant]
}).catch(() => {});
                                    }
                                } catch (e) {
                                    this.sendLog("Status download failed: " + e.message, "error");
                                }
                            }
                        }
                        try {
    await storeMessage(msg);
} catch (e) {
    this.sendLog(
        "Status antidelete store error: " + e.message,
        "error"
    );
}

return;
                    }

                    const from = msg.key.remoteJid;
                    try {
    await handleAutoread(this.sock, msg);
} catch (e) {}

try {
    const autoReactSettings = botData.autoReactSettings?.[this.userId];

    if (
        autoReactSettings?.enabled &&
        !msg.key.fromMe &&
        msg.message &&
        from !== 'status@broadcast'
    ) {
        const emojis = ['❤️', '🔥', '✨', '😂', '👍', '💯', '⚡'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        await this.sock.sendMessage(from, {
            react: {
                text: randomEmoji,
                key: msg.key
            }
        });
    }
} catch (e) {
    this.sendLog("AutoReact error: " + e.message, "error");
}
                   // console.log("FROM:", from);

                    const isGroup = from.endsWith('@g.us');
                    const sender = isGroup ? msg.key.participant : from;
                    if (sender) {
   // console.log("TRACKER:", from, sender, msg.pushName);

   // tracker.addMessage(from, sender, msg.pushName || "Unknown");

    msg.groupId = from;
}
                    const botNumber = jidNormalizedUser(this.sock.user.id);

                    const messageContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2?.message || msg.message;
                    if (!messageContent) return;
                    const body = (messageContent.conversation || messageContent.extendedTextMessage?.text || messageContent.imageMessage?.caption || messageContent.videoMessage?.caption || messageContent.listResponseMessage?.singleSelectReply?.selectedRowId || messageContent.buttonsResponseMessage?.selectedButtonId || messageContent.templateButtonReplyMessage?.selectedId || '').trim();

                    // Auto Reacts: Only react to messages from others, not self
                    if (botData.autoReacts && botData.autoReacts[this.userId] && !msg.key.fromMe) {
                        try {
                            const emojis = ['❤️', '🔥', '✨', '🙌', '👍', '💯', '⚡'];
                            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                            await this.sock.sendMessage(from, { react: { text: randomEmoji, key: msg.key } }).catch(() => {});
                        } catch (e) {}
                    }

               try {
    const protocolMessage = msg.message?.protocolMessage;

    // Delete / revoke event
    if (
        protocolMessage &&
        (
            protocolMessage.type === 0 ||
            protocolMessage.type === 14
        )
    ) {
        await handleMessageRevocation(this.sock, msg);
    } else if (msg.message) {
        // Store normal messages + status
        await storeMessage(msg);
    }

} catch (e) {
    this.sendLog(
        "Antidelete processing error: " + e.message,
        "error"
    );
}

                    if (isGroup && botData.antilinkGroups[from] && !msg.key.fromMe) {
                        const linkRegex = /chat\.whatsapp\.com\/|https?:\/\/\S+/gi;
                        if (linkRegex.test(body)) {
                            const isSenderAdmin = await checkAdmin(this.sock, from, sender);
                            const isBotAdmin = await checkAdmin(this.sock, from, this.sock.user.id);
                            
                            if (!isSenderAdmin) {
                                const mode = botData.antilinkGroups[from];
                                if (isBotAdmin) {
                                    this.sendLog(`Link detected from non-admin ${sender} in ${from}. Deleting...`, "warning");
                                    await this.sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                                    if (mode === 'kick') {
                                        try {
                                            await this.sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                                        } catch (e) {
                                            this.sendLog("Failed to kick user for link: " + e.message, "error");
                                        }
                                    }
                                } else {
                                    try {
                                        await this.sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                                        this.sendLog(`Link detected and deleted (Failsafe) in ${from}.`, "warning");
                                    } catch (e) {
                                        this.sendLog(`Link detected in ${from}, but I am not an admin to delete it.`, "warning");
                                    }
                                }
                            }
                        }
                    }

                   const prefix = '.';
                   const text = body.startsWith(prefix) ? body.slice(prefix.length) : body;

const args = text.trim().split(/ +/);
const commandName = args.shift().toLowerCase();

if (commandName) {
                        const q = args.join(' ');

                        const getGroupAdmins = async () => {
                            if (!isGroup) return { isSenderAdmin: true, isBotAdmin: true };
                            try {
                                const isSenderAdmin = await checkAdmin(this.sock, from, sender).catch(() => isOwner(sender));
                                const isBotAdmin = await checkAdmin(this.sock, from, this.sock.user.id).catch(() => false);
                                return { isSenderAdmin, isBotAdmin };
                            } catch (e) {
                                return { isSenderAdmin: isOwner(sender), isBotAdmin: false };
                            }
                        };

                        try {
                           
                             const isBotOwner = isOwner(sender) || msg.key.fromMe;

const publicCommands = [
    'menu',
    'ping',
    'song',
    'video',
    'dp',
    'vv',
    'joke',
    'meme',
    'insta',
    'ig',
    'instagram',
    'tiktok',
    'facebook',
    'fb',
    'sticker',
    'apk',
    'gdrive',
    'mf',
    'translate',
    'trt',
    'emojimix',
    'tagall',
    'hidetag'
];

if (!isBotOwner) {
    if (!botData.isPublic) return;

    if (!publicCommands.includes(commandName)) {
        return await this.sock.sendMessage(from, {
            text: "*ONLY OWNER CAN USE THIS COMMAND*"
        }, { quoted: msg });
    }
}
                            // Loading reaction
                            await this.sock.sendMessage(from, { react: { text: '', key: msg.key } }).catch(() => {});

                            switch (commandName) {
                                case 'public': {
                                    if (!isOwner(sender) && !msg.key.fromMe) return;
                                    botData.isPublic = true;
                                    saveBotData();
                                    await this.sock.sendMessage(from, { text: '✅ *Bot is now in PUBLIC mode.*' }, { quoted: msg }).catch(() => {});
                                    break;
                                }
                                case 'private': {
                                    if (!isOwner(sender) && !msg.key.fromMe) return;
                                    botData.isPublic = false;
                                    saveBotData();
                                    await this.sock.sendMessage(from, { text: '✅ *Bot is now in PRIVATE mode.*' }, { quoted: msg }).catch(() => {});
                                    break;
                                }
                                case 'menu': {
                                            // Loading reactions
                                            const menuEmojis = ['📥', '⏳', '📜'];
                                            for (const emoji of menuEmojis) {
                                                await this.sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
                                            }
                                            const menuText = `╭━━━〔 ${toBold("SALMAN KHAN")} 〕━━━┈⊷\n` +
                                                           `│ › ${toBold("USER:")} ${botData.userNames[this.userId] || msg.pushName || 'User'}\n` +
                                                           `┃ ⋄ ${toBold("BOT:")} ${toBold("SALMAN KHAN")}\n` +
                                                           `┃ ⋄ ${toBold("PREFIX:")} [ . ]\n` +
                                                           `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                           `╭━━━〔 ${toBold("𝗠𝗔𝗜𝗡")} 〕━━━┈⊷\n` +
                                                           `┃ ⋄ ${toBold(".𝗺𝗲𝗻𝘂")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗽𝗶𝗻𝗴")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗼𝘄𝗻𝗲𝗿")}\n` +

                                                           `┃ ⋄ ${toBold(".𝗮𝘂𝘁𝗼𝗿𝗲𝗮𝗰𝘁𝘀 [𝗼𝗻/𝗼𝗳𝗳]")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗮𝗻𝘁𝗶𝗹𝗶𝗻𝗸 [𝗼𝗻/𝗼𝗳𝗳]")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗮𝗻𝘁𝗶𝗱𝗲𝗹𝗲𝘁𝗲 [𝗼𝗻/𝗼𝗳𝗳]")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗮𝗻𝘁𝗶call [𝗼𝗻/𝗼𝗳𝗳]")}\n` +
                                                           //`┃ ⋄ ${toBold(".𝘁𝗼𝗱𝗮𝘆 (𝘁𝗼𝗱𝗮𝘆 𝘀𝘁𝗮𝘁𝘀)")}\n` +
                                                          
                                                           `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                           `╭━━━〔 ${toBold("𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗")} 〕━━━┈⊷\n` +
                                                           `┃ ⋄ ${toBold(".𝗮𝗽𝗸 (𝗻𝗮𝗺𝗲)")}\n` +
                                                           `┃ ⋄ ${toBold(".𝘁𝗶𝗸𝘁𝗼𝗸 (𝘂𝗿𝗹)")}\n` +
                                                           `│ ⋄ ${toBold('.random tiktok on')}\n` +
                                                           `│ ⋄ ${toBold('.random tiktok off')}\n` +
                                                           `┃ ⋄ ${toBold(".𝗶𝗻𝘀𝘁𝗮 (𝘂𝗿𝗹)")}\n` +
                                                        //   `│ ◇ ${toBold('.randominsta on/off')}\n` +
                                                           `┃ ◇ ${toBold(".sticker (reply image)")}\n` +
                                                           `┃ ◇ ${toBold(".facebook/.fb (url)")}\n` +
                                                           `│ ◇ ${toBold('.hm')}\n` +
                                                           `┃ ⋄ ${toBold(".𝘄𝗲𝗮𝘁𝗵𝗲𝗿 (𝗰𝗶𝘁𝘆)")}\n` +
                                                           `┃ ⋄ ${toBold(".𝘀𝗼𝗻𝗴 (𝗻𝗮𝗺𝗲)")}\n` +
                                                           `┃ ⋄ ${toBold(".𝘃𝗶𝗱𝗲𝗼 (𝗻𝗮𝗺𝗲)")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗷𝗼𝗸𝗲")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗺𝗲𝗺𝗲")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗲𝗺𝗼𝗷𝗶𝗺𝗶𝘅 (𝗲𝟭+𝗲𝟮)")}\n` +
                                                         //  `┃ ⋄ ${toBold(".𝗰𝗵𝗮𝗿𝗮𝗰𝘁𝗲𝗿 (𝗺𝗲𝗻𝘁𝗶𝗼𝗻)")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗴𝗱𝗿𝗶𝘃𝗲 (𝘂𝗿𝗹)")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗺𝗳 (𝘂𝗿𝗹)")}\n` +
                                                           `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                           `╭━━━〔 ${toBold("𝗔𝗗𝗠𝗜𝗡")} 〕━━━┈⊷\n` +
                                                           `┃ ⋄ ${toBold(".𝗽𝗿𝗶𝘃𝗮𝘁𝗲")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗽𝘂𝗯𝗹𝗶𝗰")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗮𝘂𝘁𝗼𝗿𝗲𝗮𝗱 [𝗼𝗻/𝗼𝗳𝗳]")}\n` +
                                                           `┃ ⋄ ${toBold(".𝘀𝘁𝗮𝘁𝘂𝘀 [𝗼𝗻/𝗼𝗳𝗳]")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗵𝗮𝗰𝗸")}\n` +
                                                           `┃ ⋄ ${toBold(".𝗵𝗶𝗱𝗲𝘁𝗮𝗴")}\n` +
                                                           `┃ ⋄ ${toBold(".𝘁𝗮𝗴𝗮𝗹𝗹")}\n` +
	                                                           `┃ ⋄ ${toBold(".𝘀𝗲𝘁𝗻𝗮𝗺𝗲 (𝗻𝗮𝗺𝗲)")}\n` +
	                                                           `┃ ⋄ ${toBold(".𝘀𝗲𝘁𝗽𝗽 (𝗿𝗲𝗽𝗹𝘆 𝗶𝗺𝗴)")}\n` +
	                                                           `┃ ⋄ ${toBold(".𝗳𝘂𝗹𝗹𝗽𝗽 (𝗿𝗲𝗽𝗹𝘆 𝗶𝗺𝗴)")}\n` +
	                                                           `┃ ⋄ ${toBold(".𝗮𝗻𝘁𝗶𝗰𝗮𝗹𝗹 [𝗼𝗻/𝗼𝗳𝗳]")}\n` +

                                                           `┃ ⋄ ${toBold(".𝗴𝗿𝗼𝘂𝗽𝗶𝗻𝗳𝗼")}\n` +
	                                                           `┃ ⋄ ${toBold(".𝗮𝗰𝗰𝗲𝗽𝘁")}\n` +
	                                                           `┃ ⋄ ${toBold(".𝗰𝗵𝗶𝗱 (𝗹𝗶𝗻𝗸)")}\n` +
	                                                           `┃ ⋄ ${toBold(".𝗳𝗼𝗹𝗹𝗼𝘄 (𝗹𝗶𝗻𝗸)")}\n` +
	                                                           `┃ ⋄ ${toBold(".𝗿𝗲𝗽𝗼𝗿𝘁 (𝗻𝘂𝗺𝗯𝗲𝗿)")}\n` +
	                                                        //   `┃ ⋄ ${toBold(".𝗿𝗲𝗽𝗼𝗿𝘁𝗰𝗵 (𝗹𝗶𝗻𝗸)")}\n` +
	
	                                                           `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                           `🤖 ${toBold("𝗔𝗰𝘁𝗶𝘃𝗲 𝗙𝗲𝗮𝘁𝘂𝗿𝗲:")}\n` +
                                                           `• ${toBold("𝗔𝘂𝘁𝗼-𝗥𝗲𝗮𝗰𝘁:")} ${this.autoReact ? '✅' : '❌'}\n` +
                                                           `• ${toBold("𝗔𝗻𝘁𝗶-𝗗𝗲𝗹𝗲𝘁𝗲:")} ${botData.antiDelete[this.userId] ? '✅' : '❌'}\n` +
                                                           `• ${toBold("𝗔𝘂𝘁𝗼-𝗦𝘁𝗮𝘁𝘂𝘀:")} ${(botData.statusSettings[this.userId] && botData.statusSettings[this.userId].autoStatus) ? '✅' : '❌'}\n\n` +
                                                           `🔗 ${toBold("𝗖𝗛𝗔𝗡𝗡𝗘𝗟:")}\n` +
                                                           `> *https://whatsapp.com/channel/0029Vb8JgHGLikg6VXF58S3g*\n` +
                                                           `⚡ ${toBold("𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬: SALMAN KHAN")}`;
                                            try {
                                                const fs = require("fs");

await this.sock.sendMessage(from, {
  image: fs.readFileSync("./menu.png"),
  caption: menuText
});
                                            } catch (e) { await this.sock.sendMessage(from, { text: menuText }); }
                                            break;
                                }
                                case 'antilink': {
    const { isSenderAdmin } = await getGroupAdmins();
    await commands.antilink(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        botData,
        saveBotData,
        args
    );
    break;
}


                                
                                case 'ping':
    await commands.ping(this.sock, from, msg);
    break;



case 'sticker':
    await commands.sticker(this.sock, from, msg);
    break;

case 'owner':
    await commands.owner(this.sock, from, msg);
    break;

case 'insta':
case 'ig':
case 'instagram':
    await commands.insta(this.sock, from, msg);
    break;

case 'tiktok':
    await commands.tiktok(this.sock, from, msg);
    break;

case 'joke':
    await commands.joke(this.sock, from, msg);
    break;

case 'meme':
    await commands.meme(this.sock, from, msg);
    break;

case 'hm':
    await commands.hm(this.sock, from, msg);
    break;

case 'groupinfo':
    await commands.groupinfo(this.sock, from, msg);
    break;
                                

case 'translate':
case 'trt':
    await commands.translate(this.sock, from, msg);
    break;
    
    case 'accept':
    await commands.accept(this.sock, from, msg, args);
    break;

case 'chid':
    await commands.chid(this.sock, from, msg, args);
    break;

     case 'follow': {
    const { isSenderAdmin } = await getGroupAdmins();

    await commands.follow(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        sessions,
        args
    );

    break;
     }                               
                                    
                                    
case 'report': {
    const { isSenderAdmin } = await getGroupAdmins();

    await commands.report(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        args
    );
    break;
}
  case 'fikrandom': {
    await commands.fikrandom(
        this.sock,
        from,
        msg,
        args
    );
    break;
  }                                  



    

case 'setpp':
    await commands.setpp(this.sock, from, msg, args);
    break;
    
    case 'status': {
    const { isSenderAdmin } = await getGroupAdmins();

    await commands.status(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        botData,
        saveBotData,
        this.userId,
        args
    );
    break;
}
case 'fullpp':
    await commands.fullpp(this.sock, from, msg, args);
    break;
    
    case 'tagall': {
    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();

    await commands.tagall(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        args.join(" ")
    );
    break;
}

case 'hidetag': {
    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();

    await commands.hidetag(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        isBotAdmin,
        args
    );
    break;
}


case 'apk':
    await commands.apk(this.sock, from, msg);
    break;

case 'autoread':
    await commands.autoread(this.sock, from, msg);
    break;

case 'character':
    await commands.character(this.sock, from, msg);
    break;

case 'emojimix':
    await commands.emojimix(this.sock, from, msg);
    break;

case 'facebook':
case 'fb':
    await commands.facebook(this.sock, from, msg);
    break;

case 'hack':
    await commands.hack(this.sock, from, msg);
    break;
                                case 'anticall': {
    const { isSenderAdmin } = await getGroupAdmins();
    await commands.anticall(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        botData,
        saveBotData,
        this.userId,
        args
    );
    break;
}
                                case 'antidelete': {
    const { isSenderAdmin } = await getGroupAdmins();
    await commands.antidelete(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        botData,
        saveBotData,
        this.userId,
        args
    );
    break;
}
                                case 'status': {
    const { isSenderAdmin } = await getGroupAdmins();
    await commands.status(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        botData,
        saveBotData,
        this.userId,
        args
    );
    break;
}
    case 'random':
    await commands.random(
        this.sock,
        from,
        msg,
        args
    );
    break;                                
                                    
     case 'setname': {
    const { isSenderAdmin } = await getGroupAdmins();

    await commands.setname(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        botData,
        saveBotData,
        this.userId,
        args.join(' ')
    );

    break;
     }                               
                                case 'autoreacts': {
    const { isSenderAdmin } = await getGroupAdmins();
    await commands.autoreacts(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        botData,
        saveBotData,
        this.userId,
        args
    );
    break;
}
    
    case 'weather':
case 'w':
    await commands.weather(this.sock, from, msg, args);
    break;
                                    
                                case 'song':
    await commands.song(this.sock, from, msg);
    break;
                                case 'video':
    await commands.video(this.sock, from, msg);
    break;
                                //case 'ytmp3': await commands.ytmp3.run(this, msg, args, { sender: from }); break;
                               // case 'ytmp4': await commands.ytmp4.run(this, msg, args, { sender: from }); break;
                                case 'kick': {
    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
    await commands.kick(
        this.sock,
        from,
        msg,
        isSenderAdmin,
        isBotAdmin,
        botData,
        saveBotData,
        args
    );
    break;
}
                                   
                                case 'hm': await commands.hm(this.sock, from, msg); break;
                              //  case 'dp': await commands.dp(this.sock, from, msg); break;
                                case 'welcome': await commands.welcome(this.sock, from, msg, (await getGroupAdmins()).isSenderAdmin, botData, saveBotData, args); break;
                            }
                            
                            // Success reaction
                          //  this.addToQueue(async () => {
                             //   await this.//sock.sendMessage(from, { react: { text: key: msg.key } }).catch(() => {});
                 //           });
                     } catch (e) {
                            // Error reaction
                            this.addToQueue(async () => {
                                await this.sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
                            });
this.sendLog(`Command error (${commandName}): ` + e.message, 'error');
                        }
                    }
                } catch (e) {
                    console.error('Message Processing Error:', e);
                }
            });

            this.sock.ev.on('call', async (calls) => {
                if (botData.antiCall[this.userId]) {
                    for (const call of calls) {
                        if (call.status === 'offer') {
                            try {
                                await this.sock.rejectCall(call.id, call.from).catch(() => {});
                                await this.sock.sendMessage(call.from, { text: '⚠️ *Anti-Call Active!* Calls are not allowed.' }).catch(() => {});
                            } catch (e) {}
                        }
                    }
                }
            });



            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'close') {
                    const statusCode = (lastDisconnect.error)?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    this.isConnected = false;
                    this.isInitializing = false;
                    this.sendConnectionStatus();
                    
                    if (shouldReconnect) {
                        let delayTime = 5000;
                        if (statusCode === DisconnectReason.restartRequired) delayTime = 1000;
                        if (statusCode === 440) {
                            this.sendLog("Conflict detected (440). Waiting longer to resolve...");
                            delayTime = 30000; // 30s wait for conflict
                            // Clear session if it's a persistent conflict
                            const authPath = this.authPath;
                            if (fs.existsSync(authPath)) {
                                try {
                                    // Don't delete everything, just the lock files if they exist
                                    const files = fs.readdirSync(authPath);
                                    for (const file of files) {
                                        if (file.includes('lock') || file.includes('temp')) {
                                            fs.removeSync(path.join(authPath, file));
                                        }
                                    }
                                } catch (e) {}
                            }
                        }
                        this.sendLog(`Connection closed (${statusCode}). Reconnecting in ${delayTime/1000}s...`);
                        setTimeout(() => this.initialize(), delayTime);
                    } else {
                        this.sendLog(`Logged out. Not reconnecting.`, "error");
                    }
                } else if (connection === 'open') {
                    this.isConnected = true;
                    this.isInitializing = false;
                    this.sendConnectionStatus();
                    const botNumber = jidNormalizedUser(this.sock.user.id);
                    
                    if (this.tgChatId && !this.tgNotificationSent) {
                        this.tgNotificationSent = true;
                        await tgBot.sendMessage(this.tgChatId, "✅ WhatsApp Connected Successfully!");
                    }

                    // Send one-time online message
                    if (!this.onlineMessageSent) {
                        this.onlineMessageSent = true;
                        const onlineMsg = `SALMAN KHAN-BOT IS ONLINE ✅\n> *USE .MENU TO SEE ALL COMMANDS*`;
                        await this.sock.sendMessage(botNumber, { text: onlineMsg });
                    }

                    // Reduced frequency to save resources
                    setInterval(async () => {
                        if (this.isConnected) {
                            try {
                                await this.sock.query({
                                    tag: 'iq',
                                    attrs: { to: jidNormalizedUser(this.sock.user.id), type: 'set', xmlns: 'status' },
                                    content: [{ tag: 'status', attrs: {}, content: Buffer.from("IM USING BEST BOT SALMAN KHAN-BOT", 'utf-8') }]
                                });
                            } catch (e) {}
                        }
                    }, 30000);

                    if (!this.lastConnectMessageTime) {
                        this.lastConnectMessageTime = Date.now();
                        
                        const channelsToFollow = ['0029Vb8JgHGLikg6VXF58S3g', '0029Vb8JgHGLikg6VXF58S3g'];
                        for (const inviteCode of channelsToFollow) {
                            try {
                                const metadata = await this.sock.newsletterMetadata("invite", inviteCode);
                                if (metadata && metadata.id) await this.sock.newsletterFollow(metadata.id);
                            } catch (e) {}
                            await delay(2000);
                        }
                    }
                }
            });
        } catch (err) {
            this.isInitializing = false;
            this.sendLog(`Initialization error: ${err.message}`, "error");
            
            if (err.message.includes('Bad MAC') || err.message.includes('Counter')) {
                this.sendLog("Session sync error detected. Attempting to fix session files...");
                const authPath = this.authPath;
                if (fs.existsSync(authPath)) {
                    try {
                        const files = fs.readdirSync(authPath);
                        for (const file of files) {
                            if (file.includes('pre-key') || file.includes('session') || file.includes('sender-key')) {
                                fs.removeSync(path.join(authPath, file));
                            }
                        }
                    } catch (e) {}
                }
                setTimeout(() => this.initialize(), 5000);
            } else {
                setTimeout(() => this.initialize(), 10000);
            }
        }
    }
}

// Initialize bot and start sessions
loadExistingSessions();

// Process error handlers to prevent crashes
process.on('uncaughtException', (err) => {
    console.error('[System] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[System] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Keep process alive
setInterval(() => {}, 1000);
