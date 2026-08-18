const WebSocket = require("ws");

// ======================================================
// GEMINI LIVE CONFIG
// ======================================================

// IMPORTANT:
// Apni NEW Gemini API key yahan lagao.
// Purani exposed key use mat karna.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Same model used by your Voice Assistant
const GEMINI_MODEL =
    process.env.GEMINI_MODEL ||
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

function askGemini(prompt) {

    return new Promise((resolve, reject) => {

        if (
            !GEMINI_API_KEY ||
            GEMINI_API_KEY ===
                "PASTE_NEW_GEMINI_API_KEY_HERE"
        ) {
            return reject(
                new Error(
                    "Gemini API key is not configured."
                )
            );
        }

        const cleanPrompt =
            String(prompt || "").trim();

        if (!cleanPrompt) {
            return reject(
                new Error("Empty prompt.")
            );
        }

        let ws = null;
        let finished = false;
        let responseText = "";

        const timeout =
            setTimeout(() => {

                finish(
                    new Error(
                        "Gemini Live request timed out."
                    )
                );

            }, 60000);


        // ==================================================
        // FINISH
        // ==================================================

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


        // ==================================================
        // CONNECT
        // ==================================================

        try {

            const url =
                `${GEMINI_WS_URL}?key=${encodeURIComponent(
                    GEMINI_API_KEY
                )}`;

            ws = new WebSocket(url);


            // ==================================================
            // OPEN
            // ==================================================

            ws.on("open", () => {

                console.log(
                    "[GEMINI LIVE] Connected."
                );

                const setupPayload = {

                    setup: {

                        model: GEMINI_MODEL,

                        // ----------------------------------
                        // GENERATION CONFIG
                        // ----------------------------------

                        generationConfig: {

                            // Native Audio model
                            responseModalities: [
                                "AUDIO"
                            ],

                            // Disable thinking/reasoning
                            thinkingConfig: {
                                thinkingBudget: 0
                            },

                            // Voice configuration
                            speechConfig: {

                                voiceConfig: {

                                    prebuiltVoiceConfig: {

                                        voiceName:
                                            "Puck"
                                    }
                                }
                            }
                        },

                        // ----------------------------------
                        // OUTPUT TRANSCRIPTION
                        // ----------------------------------

                        outputAudioTranscription: {},

                        // ----------------------------------
                        // SYSTEM INSTRUCTION
                        // ----------------------------------

                        systemInstruction: {

                            parts: [

                                {
                                    text:
                                        "You are a WhatsApp AI assistant. " +

                                        "Reply ONLY with the final answer " +
                                        "to the user's message. " +

                                        "Do NOT show your thinking, reasoning, " +
                                        "planning, analysis, drafts, internal " +
                                        "process, or how you formulated the answer. " +

                                        "Never write headings such as " +
                                        "'Greeting the User', 'Analysis', " +
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


                console.log(
                    "[GEMINI LIVE] Sending setup..."
                );

                ws.send(
                    JSON.stringify(
                        setupPayload
                    )
                );
            });


            // ==================================================
            // MESSAGE
            // ==================================================

            ws.on("message", (rawData) => {

                try {

                    const data =
                        JSON.parse(
                            rawData.toString()
                        );


                    // ==========================================
                    // SETUP COMPLETE
                    // ==========================================

                    if (data.setupComplete) {

                        console.log(
                            "[GEMINI LIVE] Setup complete."
                        );

                        const userMessage = {

                            clientContent: {

                                turns: [

                                    {
                                        role: "user",

                                        parts: [

                                            {
                                                text:
                                                    cleanPrompt
                                            }

                                        ]
                                    }

                                ],

                                turnComplete: true
                            }
                        };


                        console.log(
                            "[GEMINI LIVE] Sending user message:",
                            cleanPrompt
                        );


                        ws.send(
                            JSON.stringify(
                                userMessage
                            )
                        );

                        return;
                    }


                    // ==========================================
                    // GEMINI ERROR
                    // ==========================================

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


                    // ==========================================
                    // SERVER CONTENT
                    // ==========================================

                    if (data.serverContent) {

                        const serverContent =
                            data.serverContent;


                        // --------------------------------------
                        // OUTPUT TRANSCRIPTION
                        // --------------------------------------

                        if (
                            serverContent.outputTranscription
                        ) {

                            const text =
                                serverContent
                                    .outputTranscription
                                    .text;

                            if (text) {

                                responseText +=
                                    text;

                                console.log(
                                    "[GEMINI TRANSCRIPTION]",
                                    text
                                );
                            }
                        }


                        // --------------------------------------
                        // NORMAL TEXT PART
                        // --------------------------------------

                        if (
                            serverContent.modelTurn &&
                            serverContent.modelTurn.parts
                        ) {

                            for (
                                const part
                                of serverContent.modelTurn.parts
                            ) {

                                if (
                                    part.text
                                ) {

                                    responseText +=
                                        part.text;

                                    console.log(
                                        "[GEMINI TEXT]",
                                        part.text
                                    );
                                }
                            }
                        }


                        // --------------------------------------
                        // TURN COMPLETE
                        // --------------------------------------

                        if (
                            serverContent.turnComplete
                        ) {

                            const finalAnswer =
                                cleanGeminiResponse(
                                    responseText
                                );

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


                            return finish(
                                null,
                                finalAnswer
                            );
                        }
                    }

                } catch (error) {

                    console.error(
                        "[GEMINI MESSAGE PARSE ERROR]",
                        error.message
                    );
                }
            });


            // ==================================================
            // SOCKET ERROR
            // ==================================================

            ws.on("error", (error) => {

                console.error(
                    "[GEMINI SOCKET ERROR]",
                    error.message
                );

                finish(error);
            });


            // ==================================================
            // SOCKET CLOSED
            // ==================================================

            ws.on("close", (code, reason) => {

                console.log(
                    `[GEMINI LIVE] Connection closed: ${code}`
                );

                if (finished) {
                    return;
                }

                const finalAnswer =
                    cleanGeminiResponse(
                        responseText
                    );

                if (finalAnswer) {

                    finish(
                        null,
                        finalAnswer
                    );

                } else {

                    finish(
                        new Error(
                            `Gemini Live connection closed (${code}).`
                        )
                    );
                }
            });


        } catch (error) {

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
                        "┃ Model: Gemini 2.5 Flash\n" +
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
                        "┃ Model: Gemini 2.5 Flash\n" +
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