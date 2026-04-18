require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

// Temporary in-memory state (demo only)
// Later -> move to Google Sheet / DB / Redis
const userStates = new Map();

const HOTEL = {
  name: "Royal Mawlamyine Hotel",
  hotlines: [
    "09-945002600",
    "09-795679111~222",
    "09-795679666"
  ],
  roomRates: [
    "Superior Double Room (2 Guests) — 130,000 MMK",
    "Superior Triple Room (3 Guests) — 170,000 MMK",
    "Deluxe Room — 200,000 MMK",
    "Grand Suite (Separate Living Area) — 300,000 MMK"
  ],
  extraCharges: [
    "Extra Bed (1 Person) — 40,000 MMK",
    "Children under 6 years — Free of Charge",
    "Children age 6–12 years — 25,000 MMK"
  ],
  poolInfo: "Swimming Pool information will be updated soon. Please contact our front desk for the latest details.",
  locationInfo: "Royal Mawlamyine Hotel location information will be updated soon. Please contact our front desk for directions and assistance.",
};

app.get("/", (req, res) => {
  res.send("Royal Mawlamyine AI Webhook Running");
});

// Meta webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Messenger webhook events
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
          await handleMessageEvent(senderId, event.message);
        }

        if (event.postback) {
          await handlePostbackEvent(senderId, event.postback);
        }
      }
    }

    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Webhook error:", error?.response?.data || error.message || error);
    return res.sendStatus(500);
  }
});

async function handleMessageEvent(senderId, message) {
  const text = (message.text || "").trim();
  const normalized = normalizeText(text);

  // Ignore empty non-text messages for now
  if (!text && !message.attachments?.length) {
    await sendTextMessage(
      senderId,
      "ကျေးဇူးပြု၍ စာသားဖြင့် မေးမြန်းပေးပါရှင်/ခင်ဗျာ။"
    );
    return;
  }

  // If voice/file/image sent
  if (!text && message.attachments?.length) {
    await sendTextMessage(
      senderId,
      "Attachment လက်ခံရရှိပါပြီ။ လောလောဆယ် စာသားဖြင့် မေးမြန်းပေးပါရှင်/ခင်ဗျာ။"
    );
    return;
  }

  const currentState = userStates.get(senderId);

  // Booking flow state 1 -> waiting for booking details
  if (currentState?.stage === "awaiting_booking_details") {
    userStates.set(senderId, {
      ...currentState,
      stage: "awaiting_contact_info",
      bookingDetails: text
    });

    await sendTextMessage(
      senderId,
      "ကျေးဇူးတင်ပါတယ်ရှင်/ခင်ဗျာ။\n\n" +
      "လက်ခံရရှိသော Booking Details:\n" +
      `${text}\n\n` +
      "ကျေးဇူးပြု၍ အတည်ပြုဆက်သွယ်နိုင်ရန် အောက်ပါအချက်အလက် ပို့ပေးပါ:\n" +
      "1. Full Name\n" +
      "2. Contact Number\n\n" +
      "ဥပမာ:\n" +
      "Name - Mg Mg\n" +
      "Phone - 09xxxxxxxxx"
    );
    return;
  }

  // Booking flow state 2 -> waiting for name and phone
  if (currentState?.stage === "awaiting_contact_info") {
    userStates.set(senderId, {
      ...currentState,
      stage: "booking_completed",
      contactInfo: text,
      completedAt: new Date().toISOString()
    });

    await sendTextMessage(
      senderId,
      "ကျေးဇူးတင်ပါတယ်ရှင်/ခင်ဗျာ။\n\n" +
      "သင်၏ Booking Request ကို လက်ခံရရှိပါပြီ။\n" +
      "Reservation Team မှ မကြာမီ ဆက်သွယ်အတည်ပြုပေးပါမည်။\n\n" +
      urgentContactMessage()
    );

    // Clear state after confirmation
    setTimeout(() => userStates.delete(senderId), 3000);
    return;
  }

  // Intents
  if (isGreeting(normalized)) {
    await sendTextMessage(senderId, welcomeMessage());
    return;
  }

  if (isBookingIntent(normalized)) {
    userStates.set(senderId, {
      stage: "awaiting_booking_details",
      startedAt: new Date().toISOString()
    });

    await sendTextMessage(senderId, bookingStartMessage());
    return;
  }

  if (isPriceIntent(normalized) || isRoomIntent(normalized)) {
    await sendTextMessage(senderId, roomRatesMessage());
    return;
  }

  if (isPoolIntent(normalized)) {
    await sendTextMessage(senderId, HOTEL.poolInfo);
    return;
  }

  if (isLocationIntent(normalized)) {
    await sendTextMessage(
      senderId,
      `${HOTEL.locationInfo}\n\n${urgentContactMessage()}`
    );
    return;
  }

  if (isContactIntent(normalized)) {
    await sendTextMessage(senderId, urgentContactMessage());
    return;
  }

  // Fallback
  await sendTextMessage(senderId, fallbackMessage());
}

async function handlePostbackEvent(senderId, postback) {
  const payload = postback.payload || "";

  if (payload === "GET_STARTED") {
    await sendTextMessage(senderId, welcomeMessage());
    return;
  }

  await sendTextMessage(
    senderId,
    "ကျေးဇူးပြု၍ လိုအပ်သော အချက်အလက်ကို စာသားဖြင့် မေးမြန်းနိုင်ပါသည်။"
  );
}

function welcomeMessage() {
  return (
    "🙏 မင်္ဂလာပါ 🙏\n" +
    `Royal Mawlamyine Hotel မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်။\n\n` +
    "Room Rates, Booking, Room Availability, Location နှင့် အခြားစုံစမ်းမေးမြန်းမှုများကို ဤ Chat Box မှ မေးမြန်းနိုင်ပါသည်။\n\n" +
    "Booking ပြုလုပ်လိုပါက “Booking” ဟု ရိုက်ပို့နိုင်ပါသည်။\n\n" +
    urgentContactMessage()
  );
}

function bookingStartMessage() {
  return (
    "Booking ပြုလုပ်ပေးနိုင်ပါတယ်ရှင်/ခင်ဗျာ။\n\n" +
    "ကျေးဇူးပြု၍ အောက်ပါအချက်အလက်များ ပို့ပေးပါ:\n" +
    "1. Check-in Date\n" +
    "2. Number of Nights\n" +
    "3. Guests Count (Adults / Children)\n" +
    "4. Room Type\n\n" +
    "ဥပမာ:\n" +
    "Check-in - 25 Apr 2026\n" +
    "Nights - 2\n" +
    "Guests - 2 Adults\n" +
    "Room Type - Superior Double"
  );
}

function roomRatesMessage() {
  return (
    "Room Rates:\n\n" +
    HOTEL.roomRates.join("\n") +
    "\n\nAdditional Charges:\n" +
    HOTEL.extraCharges.join("\n") +
    "\n\nFor Booking, please type: Booking"
  );
}

function fallbackMessage() {
  return (
    `ကျေးဇူးပြု၍ မေးမြန်းလိုသော အကြောင်းအရာကို ထပ်မံပို့ပေးပါရှင်/ခင်ဗျာ။\n\n` +
    "You can ask about:\n" +
    "- Room Rates\n" +
    "- Booking\n" +
    "- Location\n" +
    "- Swimming Pool\n" +
    "- Contact Information\n\n" +
    urgentContactMessage()
  );
}

function urgentContactMessage() {
  return (
    "Urgent Contact / Hot Line:\n" +
    HOTEL.hotlines.join("\n")
  );
}

function normalizeText(text) {
  return text.toLowerCase().trim();
}

function isGreeting(text) {
  const keywords = [
    "hi", "hello", "hey", "mingalabar", "mingalarbar",
    "မင်္ဂလာပါ", "ဟယ်လို", "hello royal"
  ];
  return keywords.some((k) => text.includes(k));
}

function isBookingIntent(text) {
  const keywords = [
    "booking", "book", "reservation", "reserve",
    "ဘိုကင်", "booking ယူမယ်", "အခန်းယူမယ်", "booking လုပ်မယ်", "တည်းမယ်"
  ];
  return keywords.some((k) => text.includes(k));
}

function isPriceIntent(text) {
  const keywords = [
    "price", "prices", "rate", "rates", "room rates",
    "စျေး", "ဈေး", "စျေးနှုန်း", "အခန်းစျေး", "room price"
  ];
  return keywords.some((k) => text.includes(k));
}

function isRoomIntent(text) {
  const keywords = [
    "room", "rooms", "superior", "deluxe", "suite",
    "စူပီးရီးယား", "ဒီလက်စ်", "grand suite", "အခန်း"
  ];
  return keywords.some((k) => text.includes(k));
}

function isPoolIntent(text) {
  const keywords = [
    "pool", "swimming pool", "swim",
    "ရေကူး", "pool ရှိလား", "swimming"
  ];
  return keywords.some((k) => text.includes(k));
}

function isLocationIntent(text) {
  const keywords = [
    "location", "address", "map", "where",
    "လိပ်စာ", "တည်နေရာ", "map link", "ဘယ်နား"
  ];
  return keywords.some((k) => text.includes(k));
}

function isContactIntent(text) {
  const keywords = [
    "contact", "phone", "hotline", "call",
    "ဖုန်း", "ဆက်သွယ်", "နံပါတ်", "hot line"
  ];
  return keywords.some((k) => text.includes(k));
}

async function sendTextMessage(recipientId, text) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v23.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
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

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }
  } catch (error) {
    console.error("Send message error:", error.message || error);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
