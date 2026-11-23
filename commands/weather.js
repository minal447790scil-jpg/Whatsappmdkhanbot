const axios = require("axios");

module.exports = async (sock, from, msg, args) => {
    try {
        const city = args.join(" ");

        if (!city) {
            return await sock.sendMessage(from, {
                text: "❌ Usage:\n.weather Lahore"
            }, { quoted: msg });
        }

        const { data } = await axios.get(
            `https://wttr.in/${encodeURIComponent(city)}?format=j1`
        );

        const weather = data.current_condition[0];

        const text = `🌦️ *Weather Report*

📍 Location: ${city}
🌡️ Temperature: ${weather.temp_C}°C
🤗 Feels Like: ${weather.FeelsLikeC}°C
☁️ Condition: ${weather.weatherDesc[0].value}
💧 Humidity: ${weather.humidity}%
🌬️ Wind: ${weather.windspeedKmph} km/h
👁️ Visibility: ${weather.visibility} km`;

        await sock.sendMessage(from, { text }, { quoted: msg });

    } catch (e) {
        await sock.sendMessage(from, {
            text: "❌ City not found."
        }, { quoted: msg });
    }
};