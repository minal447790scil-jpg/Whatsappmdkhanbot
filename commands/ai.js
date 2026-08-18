const WebSocket = require("ws");

// ======================================================
// GEMINI LIVE CONFIG
// ======================================================

// IMPORTANT:
// Apni NEW Gemini API key yahan lagao.
// Purani exposed key use mat karna.
const GEMINI_API_KEY =
    process.env.GEMINI_API_KEY;

// Same model used by your Voice Assistant
const GEMINI_MODEL =
    "models/gemini-3.1-flash-live-preview";

// Gemini Live API WebSocket
const GEMINI_WS_URL =
    "wss://generativelanguage.googleapis.com/ws/" +
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";


// ======================================================
// CLEAN GEMINI RESPONSE
// ======================================================

function cleanGeminiResponse(text) {

    if (!text) {
        return "";
    }

    let answer = String(text).trim();

    // Remove markdown code fences if model somehow returns them
    answer = answer
        .replace(/^```[\s\S]*?\n/, "")
        .replace(/\n```$/g, "")
        .trim();

    // --------------------------------------------------
    // Remove common internal/planning text
    // --------------------------------------------------

    const badPatterns = [
        /^\*?Greeting the User\*?\s*/i,
        /^\*?Understanding the User\*?\s*/i,
        /^\*?Responding to the User\*?\s*/i,
        /^\*?Formulating the Response\*?\s*/i,
        /^\*?Analyzing the User\*?\s*/i,
        /^\*?Analysis\*?\s*/i,
        /^\*?Reasoning\*?\s*/i,
        /^\*?Final Answer\*?\s*/i
    ];

    for (const pattern of badPatterns) {
        answer = answer.replace(pattern, "").trim();
    }

    // --------------------------------------------------
    // If model starts explaining its own process,
    // try to keep only the actual final response.
    // --------------------------------------------------

    const processMarkers = [
        "I've formulated",
        "I have formulated",
        "I’ll formulate",
        "I will formulate",
        "I need to formulate",
        "I should respond",
        "I should say",
        "The user is asking",
        "The user wants",
        "I need to respond",
        "I will respond"
    ];

    for (const marker of processMarkers) {

        const index =
            answer.toLowerCase().indexOf(
                marker.toLowerCase()
            );

        if (index === 0) {

            // Find likely final answer after process paragraph
            const paragraphs =
                answer
                    .split(/\n\s*\n/)
                    .map(x => x.trim())
                    .filter(Boolean);

            if (paragraphs.length > 1) {
                answer =
                    paragraphs[paragraphs.length - 1];
            }
        }
    }

    return answer.trim();
}


// ======================================================
// GEMINI LIVE REQUEST
// ======================================================

async function createGeminiEphemeralToken(apiKey) {
    const now = Date.now();
    const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

    const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
        {
            method: "POST",
            headers: {
                "x-goog-api-key": apiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                uses: 1,
                expireTime,
                newSessionExpireTime,
                liveConnectConstraints: {
                    model: GEMINI_MODEL,
                    config: {
                        responseModalities: ["AUDIO"]
                    }
                }
            })
        }
    );

    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        data = null;
    }

    if (!response.ok) {
        const message =
            data?.error?.message ||
            `Gemini auth token request failed (${response.status}).`;

        throw new Error(message);
    }

    const token =
        data?.name ||
        data?.token?.name ||
        data?.token ||
        data?.accessToken ||
        data?.access_token;

    if (!token) {
        throw new Error(
            "Gemini did not return an ephemeral Live API token."
        );
    }

    return token;
}


function askGemini(prompt) {

    return new Promise(async (resolve, reject) => {

        if (
            !GEMINI_API_KEY ||
            GEMINI_API_KEY === "PASTE_NEW_GEMINI_API_KEY_HERE"
        ) {
            return reject(
                new Error(
                    "Gemini API key is not configured. Set GEMINI_API_KEY in Railway Variables."
                )
            );
        }

        const cleanPrompt = String(prompt || "").trim();

        if (!cleanPrompt) {
            return reject(new Error("Empty prompt."));
        }

        let ws = null;
        let finished = false;
        let responseText = "";
        let authMode = "api-key";

        const timeout = setTimeout(() => {
            finish(new Error("Gemini Live request timed out."));
        }, 60000);

        function finish(error, result) {

            if (finished) {
                return;
            }

            finished = true;
            clearTimeout(timeout);

            try {
                if (ws) {
                    ws.close();
                }
            } catch (_) {}

            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        }

        try {
            let wsUrl;

            // --------------------------------------------------
            // Google now issues AQ.* authorization keys to some
            // accounts. Those keys provision an ephemeral Live
            // token first; the ephemeral token then authenticates
            // the Live WebSocket through access_token=.
            // --------------------------------------------------
            if (GEMINI_API_KEY.startsWith("AQ.")) {

                authMode = "ephemeral-token";

                console.log(
                    "[GEMINI LIVE] AQ authorization key detected; creating ephemeral token..."
                );

                const ephemeralToken =
                    await createGeminiEphemeralToken(
                        GEMINI_API_KEY
                    );

                wsUrl =
                    `${GEMINI_WS_URL}Constrained?access_token=${encodeURIComponent(
                        ephemeralToken
                    )}`;

            } else {

                wsUrl =
                    `${GEMINI_WS_URL}?key=${encodeURIComponent(
                        GEMINI_API_KEY
                    )}`;
            }

            console.log(
                `[GEMINI LIVE] Connecting using ${authMode} authentication...`
            );

            ws = new WebSocket(wsUrl);

            ws.on("open", () => {

                console.log("[GEMINI LIVE] Connected.");

                const setupPayload = {
                    setup: {
                        model: GEMINI_MODEL,

                        responseModalities: ["AUDIO"],

                        thinkingConfig: {
                            thinkingLevel: "minimal",
                            includeThoughts: false
                        },

                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: "Puck"
                                }
                            }
                        },

                        outputAudioTranscription: {},

                        systemInstruction: {
                            parts: [
                                {
                                    text:
                                        "You are a WhatsApp AI assistant. " +
                                        "Reply ONLY with the final answer to the user's message. " +
                                        "Do NOT show your thinking, reasoning, planning, analysis, drafts, " +
                                        "internal process, or how you formulated the answer. " +
                                        "Never write headings such as 'Greeting the User', 'Analysis', " +
                                        "'Reasoning', or 'Final Answer'. " +
                                        "Do not explain what you are going to say. " +
                                        "Just answer the user directly. " +
                                        "Keep responses natural, short and conversational. " +
                                        "Always reply in the user's language."
                                }
                            ]
                        }
                    }
                };

                console.log("[GEMINI LIVE] Sending setup...");

                ws.send(JSON.stringify(setupPayload));
            });

            ws.on("message", (rawData) => {

                try {

                    const data = JSON.parse(rawData.toString());

                    if (data.setupComplete) {

                        console.log("[GEMINI LIVE] Setup complete.");

                        // Gemini 3.1 Live uses realtimeInput for text
                        // turns. clientContent is only for seeding
                        // initial history in this model family.
                        const userMessage = {
                            realtimeInput: {
                                text: cleanPrompt
                            }
                        };

                        console.log(
                            "[GEMINI LIVE] Sending user message:",
                            cleanPrompt
                        );

                        ws.send(JSON.stringify(userMessage));
                        return;
                    }

                    if (data.error) {

                        console.error(
                            "[GEMINI LIVE ERROR]",
                            data.error
                        );

                        return finish(
                            new Error(
                                data.error.message ||
                                "Gemini Live API error."
                            )
                        );
                    }

                    if (data.serverContent) {

                        const serverContent = data.serverContent;

                        if (serverContent.outputTranscription) {

                            const text =
                                serverContent.outputTranscription.text;

                            if (text) {
                                responseText += text;

                                console.log(
                                    "[GEMINI TRANSCRIPTION]",
                                    text
                                );
                            }
                        }

                        if (
                            serverContent.modelTurn &&
                            Array.isArray(serverContent.modelTurn.parts)
                        ) {

                            for (
                                const part of serverContent.modelTurn.parts
                            ) {

                                if (part.text) {
                                    responseText += part.text;

                                    console.log(
                                        "[GEMINI TEXT]",
                                        part.text
                                    );
                                }
                            }
                        }

                        if (serverContent.turnComplete) {

                            const finalAnswer =
                                cleanGeminiResponse(responseText);

                            console.log(
                                "[GEMINI FINAL]",
                                finalAnswer
                            );

                            if (!finalAnswer) {
                                return finish(
                                    new Error(
                                        "Gemini returned an empty response."
                                    )
                                );
                            }

                            return finish(null, finalAnswer);
                        }
                    }

                } catch (error) {

                    console.error(
                        "[GEMINI MESSAGE PARSE ERROR]",
                        error.message
                    );
                }
            });

            ws.on("error", (error) => {

                console.error(
                    "[GEMINI SOCKET ERROR]",
                    error.message
                );

                finish(error);
            });

            ws.on("close", (code, reason) => {

                const closeReason =
                    reason ? reason.toString() : "";

                console.error(
                    `[GEMINI LIVE] Connection closed: ${code}`,
                    closeReason
                        ? `Reason: ${closeReason}`
                        : ""
                );

                if (finished) {
                    return;
                }

                const finalAnswer =
                    cleanGeminiResponse(responseText);

                if (finalAnswer) {
                    finish(null, finalAnswer);
                } else {
                    finish(
                        new Error(
                            `Gemini Live connection closed (${code})` +
                            (closeReason
                                ? `: ${closeReason}`
                                : ".")
                        )
                    );
                }
            });

        } catch (error) {

            console.error(
                "[GEMINI CONNECTION ERROR]",
                error
            );

            finish(error);
        }
    });
}


// ======================================================
// AI COMMAND
// ======================================================

async function aiCommand(
    sock,
    from,
    msg,
    isAdmin,
    session,
    args
) {

    // ==================================================
    // OWNER ONLY
    // ==================================================

    if (!isAdmin) {

        return await sock.sendMessage(
            from,
            {
                text:
                    "❌ Only owner can use AI settings."
            },
            {
                quoted: msg
            }
        );
    }


    const action =
        (args[0] || "")
            .toLowerCase();


    // ==================================================
    // AI ON
    // ==================================================

    switch (action) {

        case "on": {

            session.aiEnabled = true;

            return await sock.sendMessage(
                from,
                {
                    text:
                        "╭━━━〔 🤖 GEMINI AI 〕━━━╮\n" +
                        "┃\n" +
                        "┃ ✅ AI AUTO REPLY: ON\n" +
                        "┃\n" +
                        "┃ Gemini Live AI enabled.\n" +
                        "┃\n" +
                        "┃ Model: Gemini 3.1 Flash Live\n" +
                        "┃ Native Audio Live\n" +
                        "┃\n" +
                        "╰━━━━━━━━━━━━━━━━━━━━╯"
                },
                {
                    quoted: msg
                }
            );
        }


        // ==================================================
        // AI OFF
        // ==================================================

        case "off": {

            session.aiEnabled = false;

            return await sock.sendMessage(
                from,
                {
                    text:
                        "╭━━━〔 🤖 GEMINI AI 〕━━━╮\n" +
                        "┃\n" +
                        "┃ ❌ AI AUTO REPLY: OFF\n" +
                        "┃\n" +
                        "┃ Automatic replies disabled.\n" +
                        "┃\n" +
                        "╰━━━━━━━━━━━━━━━━━━━━╯"
                },
                {
                    quoted: msg
                }
            );
        }


        // ==================================================
        // STATUS
        // ==================================================

        case "status": {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "╭━━━〔 🤖 AI STATUS 〕━━━╮\n" +
                        "┃\n" +
                        `┃ Status: ${
                            session.aiEnabled
                                ? "🟢 ON"
                                : "🔴 OFF"
                        }\n` +
                        "┃ Model: Gemini 3.1 Flash Live\n" +
                        "┃ Live Native Audio\n" +
                        "┃\n" +
                        "╰━━━━━━━━━━━━━━━━━━━━╯"
                },
                {
                    quoted: msg
                }
            );
        }


        // ==================================================
        // TEST
        // ==================================================

        case "test": {

            try {

                await sock.sendMessage(
                    from,
                    {
                        react: {
                            text: "🤖",
                            key: msg.key
                        }
                    }
                );


                const response =
                    await askGemini(
                        "Say hello to the WhatsApp user in one short sentence."
                    );


                return await sock.sendMessage(
                    from,
                    {
                        text:
                            "🤖 *Gemini Test*\n\n" +
                            response
                    },
                    {
                        quoted: msg
                    }
                );

            } catch (error) {

                console.error(
                    "[GEMINI TEST ERROR]",
                    error
                );


                return await sock.sendMessage(
                    from,
                    {
                        text:
                            "❌ Gemini Error:\n\n" +
                            error.message
                    },
                    {
                        quoted: msg
                    }
                );
            }
        }


        // ==================================================
        // ASK
        // ==================================================

        case "ask": {

            const query =
                args
                    .slice(1)
                    .join(" ")
                    .trim();


            if (!query) {

                return await sock.sendMessage(
                    from,
                    {
                        text:
                            "❌ Question missing.\n\n" +
                            "Example:\n" +
                            ".ai ask What is Pakistan?"
                    },
                    {
                        quoted: msg
                    }
                );
            }


            try {

                await sock.sendMessage(
                    from,
                    {
                        react: {
                            text: "🤖",
                            key: msg.key
                        }
                    }
                );


                const response =
                    await askGemini(
                        query
                    );


                return await sock.sendMessage(
                    from,
                    {
                        text:
                            response
                    },
                    {
                        quoted: msg
                    }
                );

            } catch (error) {

                console.error(
                    "[GEMINI ASK ERROR]",
                    error
                );


                return await sock.sendMessage(
                    from,
                    {
                        text:
                            "❌ Gemini Error:\n\n" +
                            error.message
                    },
                    {
                        quoted: msg
                    }
                );
            }
        }


        // ==================================================
        // DEFAULT MENU
        // ==================================================

        default: {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "╭━━━〔 🤖 GEMINI AI MENU 〕━━━╮\n" +
                        "┃\n" +
                        "┃ .ai on\n" +
                        "┃ ➜ AI Auto Reply ON\n" +
                        "┃\n" +
                        "┃ .ai off\n" +
                        "┃ ➜ AI Auto Reply OFF\n" +
                        "┃\n" +
                        "┃ .ai status\n" +
                        "┃ ➜ Check AI Status\n" +
                        "┃\n" +
                        "┃ .ai test\n" +
                        "┃ ➜ Test Gemini Live\n" +
                        "┃\n" +
                        "┃ .ai ask <question>\n" +
                        "┃ ➜ Ask Gemini\n" +
                        "┃\n" +
                        "╰━━━━━━━━━━━━━━━━━━━━╯"
                },
                {
                    quoted: msg
                }
            );
        }
    }
}


// ======================================================
// EXPORT
// ======================================================

module.exports = {
    aiCommand,
    askGemini
};