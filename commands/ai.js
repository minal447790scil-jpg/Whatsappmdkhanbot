const https = require("https");

// ======================================================
// OPENAI CONFIG
// ======================================================
// Railway variable required:
// OPENAI_API_KEY = your OpenAI API key
// Optional:
// OPENAI_MODEL = gpt-5.6

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6";

const OPENAI_HOST = "api.openai.com";
const OPENAI_PATH = "/v1/responses";

// ======================================================
// CLEAN AI RESPONSE
// ======================================================

function cleanAIResponse(text) {
    if (!text) return "";

    let answer = String(text).trim();

    answer = answer
        .replace(/^```[\s\S]*?\n/, "")
        .replace(/\n```$/g, "")
        .trim();

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

    return answer.trim();
}

// ======================================================
// EXTRACT TEXT FROM OPENAI RESPONSES API JSON
// ======================================================

function extractOutputText(data) {
    if (!data) return "";

    // Some wrappers/SDK-style responses expose output_text.
    if (typeof data.output_text === "string" && data.output_text.trim()) {
        return data.output_text.trim();
    }

    let result = "";

    if (Array.isArray(data.output)) {
        for (const item of data.output) {
            if (!item) continue;

            if (typeof item.text === "string") {
                result += item.text;
            }

            if (Array.isArray(item.content)) {
                for (const content of item.content) {
                    if (!content) continue;

                    if (typeof content.text === "string") {
                        result += content.text;
                    }

                    if (content.type === "output_text" && typeof content.text === "string") {
                        result += content.text;
                    }
                }
            }
        }
    }

    return result.trim();
}

// ======================================================
// OPENAI REQUEST
// ======================================================

function askGemini(prompt) {
    // Keep the old function name intentionally.
    // index.js may already import askGemini().
    // Internally it now uses OpenAI, so index.js does not need changing.

    return new Promise((resolve, reject) => {
        if (!OPENAI_API_KEY || OPENAI_API_KEY === "PASTE_YOUR_OPENAI_API_KEY_HERE") {
            return reject(
                new Error("OpenAI API key is not configured. Add OPENAI_API_KEY in Railway Variables.")
            );
        }

        const cleanPrompt = String(prompt || "").trim();

        if (!cleanPrompt) {
            return reject(new Error("Empty prompt."));
        }

        const requestBody = JSON.stringify({
            model: OPENAI_MODEL,
            instructions:
                "You are a WhatsApp AI assistant. " +
                "Reply only with the final answer to the user's message. " +
                "Do not show thinking, reasoning, planning, analysis, drafts, or internal process. " +
                "Do not use headings such as Analysis, Reasoning, or Final Answer. " +
                "Keep replies natural, short and conversational. " +
                "Always reply in the user's language.",
            input: cleanPrompt,
            store: false
        });

        const options = {
            hostname: OPENAI_HOST,
            path: OPENAI_PATH,
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(requestBody)
            },
            timeout: 60000
        };

        const req = https.request(options, (res) => {
            let responseData = "";

            res.setEncoding("utf8");

            res.on("data", (chunk) => {
                responseData += chunk;
            });

            res.on("end", () => {
                let data;

                try {
                    data = JSON.parse(responseData);
                } catch (error) {
                    return reject(
                        new Error(
                            `OpenAI returned invalid JSON (HTTP ${res.statusCode || "unknown"}).`
                        )
                    );
                }

                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const message =
                        data?.error?.message ||
                        data?.message ||
                        `OpenAI API request failed with HTTP ${res.statusCode}.`;

                    return reject(new Error(message));
                }

                const answer = cleanAIResponse(extractOutputText(data));

                if (!answer) {
                    return reject(new Error("OpenAI returned an empty response."));
                }

                resolve(answer);
            });
        });

        req.on("timeout", () => {
            req.destroy(new Error("OpenAI request timed out."));
        });

        req.on("error", (error) => {
            reject(error);
        });

        req.write(requestBody);
        req.end();
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
                text: "❌ Only owner can use AI settings."
            },
            {
                quoted: msg
            }
        );
    }

    const action = (args[0] || "").toLowerCase();

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
                        "╭━━━〔 🤖 OPENAI AI 〕━━━╮\n" +
                        "┃\n" +
                        "┃ ✅ AI AUTO REPLY: ON\n" +
                        "┃\n" +
                        "┃ OpenAI AI enabled.\n" +
                        `┃ Model: ${OPENAI_MODEL}\n` +
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
                        "╭━━━〔 🤖 OPENAI AI 〕━━━╮\n" +
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
                        `┃ Status: ${session.aiEnabled ? "🟢 ON" : "🔴 OFF"}\n` +
                        "┃ Provider: OpenAI\n" +
                        `┃ Model: ${OPENAI_MODEL}\n` +
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

                const response = await askGemini(
                    "Say hello to the WhatsApp user in one short sentence."
                );

                return await sock.sendMessage(
                    from,
                    {
                        text: "🤖 *OpenAI Test*\n\n" + response
                    },
                    {
                        quoted: msg
                    }
                );
            } catch (error) {
                console.error("[OPENAI TEST ERROR]", error);

                return await sock.sendMessage(
                    from,
                    {
                        text: "❌ OpenAI Error:\n\n" + error.message
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
            const query = args.slice(1).join(" ").trim();

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

                const response = await askGemini(query);

                return await sock.sendMessage(
                    from,
                    {
                        text: response
                    },
                    {
                        quoted: msg
                    }
                );
            } catch (error) {
                console.error("[OPENAI ASK ERROR]", error);

                return await sock.sendMessage(
                    from,
                    {
                        text: "❌ OpenAI Error:\n\n" + error.message
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
                        "╭━━━〔 🤖 OPENAI AI MENU 〕━━━╮\n" +
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
                        "┃ ➜ Test OpenAI\n" +
                        "┃\n" +
                        "┃ .ai ask <question>\n" +
                        "┃ ➜ Ask OpenAI\n" +
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
    // Kept as askGemini so existing index.js imports do not break.
    askGemini
};
