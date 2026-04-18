require("dotenv").config();
const express = require("express");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const HOTEL_KNOWLEDGE = `
You are the assistant for Royal Mawlamyine Hotel.

Rules:
- Never invent prices, policies, or facilities.
- Use only the hotel facts below.
- Reply in polite Burmese by default.
- Use short English only when helpful.
- If the customer wants booking, ask for:
  1. Check-in Date
  2. Number of Nights
  3. Guests Count
  4. Room Type
- If the user asks location, say address/direction assistance is available.
- If information is missing, ask a short follow-up question.

Hotel facts:
- Superior Double Room (2 Guests) — 130,000 MMK
- Superior Triple Room (3 Guests) — 170,000 MMK
- Deluxe Room — 200,000 MMK
- Grand Suite (Separate Living Area) — 300,000 MMK
- Extra Bed (1 Person) — 40,000 MMK
- Children under 6 years — Free of Charge
- Children age 6–12 years — 25,000 MMK
- Hotlines:
  09-945002600
  09-795679111~222
  09-795679666
`;

app.get("/", (req, res) => {
  res.send("Royal Mawlamyine AI Webhook Running");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== "page") {
      return res.sendStatus(404);
    }

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        if (event.message?.text) {
          const userText = event.message.text.trim();
          const replyText = await askGemini(userText);
          await sendTextMessage(senderId, replyText);
        } else if (event.message?.attachments?.length) {
          await sendTextMessage(
            senderId,
            "Attachment လက်ခံရရှိပါပြီ။ လောလောဆယ် စာသားဖြင့် မေးမြန်းပေးပါရှင်/ခင်ဗျာ။"
          );
        }

        if (event.postback) {
          await sendTextMessage(
            senderId,
            "မင်္ဂလာပါ။ Booking, Room Rates, Location နှင့် Contact Information ကို မေးမြန်းနိုင်ပါသည်။"
          );
        }
      }
    }

    return res.status(200).send("EVENT_RECEIVED");
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(500);
  }
});

async function askGemini(userText) {
  try {
    const prompt = `
${HOTEL_KNOWLEDGE}

Customer message:
${userText}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    const text = response.text;
    return text || "မင်္ဂလာပါ။ ကျေးဇူးပြု၍ ထပ်မံမေးမြန်းပေးပါရှင်/ခင်ဗျာ။";
  } catch (error) {
    console.error("Gemini error:", error);
    return "လက်ရှိစနစ်တွင် အခက်အခဲတချို့ရှိနေပါသည်။ ကျေးဇူးပြု၍ မကြာခင် ထပ်မံကြိုးစားပေးပါရှင်/ခင်ဗျာ။";
  }
}

async function sendTextMessage(recipientId, text) {
  const response = await fetch(
    `https://graph.facebook.com/v23.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text }
      })
    }
  );

  const data = await response.json();
  console.log("Send API response:", data);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
