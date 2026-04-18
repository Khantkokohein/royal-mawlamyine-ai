require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Royal Mawlamyine AI Webhook Running");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
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

        if (event.message) {
          const userText = (event.message.text || "").trim().toLowerCase();

          let replyText = "မင်္ဂလာပါ။ Royal Mawlamyine Hotel မှ ကြိုဆိုပါတယ်။ ဘာကူညီပေးရမလဲ?";

          if (userText === "hi" || userText === "hello") {
            replyText = "မင်္ဂလာပါ။ Royal Mawlamyine Hotel မှ ကြိုဆိုပါတယ်။ Room, price, booking, location စတာတွေ မေးနိုင်ပါတယ်။";
          }

          await sendTextMessage(senderId, replyText);
        }

        if (event.postback) {
          await sendTextMessage(
            senderId,
            "ကျေးဇူးပြု၍ လိုအပ်တာကို စာပို့မေးမြန်းနိုင်ပါတယ်။"
          );
        }
      }
    }

    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Webhook error:", error?.response?.data || error.message || error);
    return res.sendStatus(500);
  }
});

async function sendTextMessage(recipientId, text) {
  const response = await fetch(
    `https://graph.facebook.com/v23.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text }
      })
    }
  );

  const data = await response.json();
  console.log("Send API response:", data);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
