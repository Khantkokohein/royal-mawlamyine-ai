require("dotenv").config();
const express = require("express");
const { GoogleGenAI } = require("@google/genai");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

const userStates = new Map();

const HOTEL = {
  name: "Royal Mawlamyine Hotel",
  hotlines: [
    "09-945002600",
    "09-795679111~222",
    "09-795679666"
  ],
  roomRatesText:
    "Room Rates:\n\n" +
    "Superior Double Room (2 Guests) - 130000MMK\n" +
    "Superior Triple Room (3 Guests) - 170000MMK\n" +
    "Deluxe Room - 200000MMK\n" +
    "Grand Suite - 300000MMK\n\n" +
    "Extra Bed (1 Person) - 40000MMK\n" +
    "Children under 6 years - Free\n" +
    "Children age 6 to 12 years - 25000MMK",
  locationText:
    "Royal Mawlamyine Hotel ၏ လိပ်စာနှင့် တည်နေရာအချက်အလက်ကို ပို့ပေးနိုင်ပါတယ်ရှင်/ခင်ဗျာ။\n" +
    "မိတ်ဆွေ ဘယ်နေရာကနေ လာမလဲဆိုတာ ပြောပေးပါက ဘယ်လိုလာရမလဲဆိုသည့် လမ်းညွှန်အချက်အလက်ကိုလည်း ဆက်လက်ကူညီပေးနိုင်ပါသည်။"
};

const SYSTEM_PROMPT = `
You are the polite assistant for Royal Mawlamyine Hotel.

Rules:
- Reply in polite Burmese by default.
- Use short English only when useful.
- Never invent prices, hotel policies, facilities, or addresses.
- If the message is unclear, ask politely for clarification.
- For official prices and booking flow, business logic outside AI is the source of truth.
- Keep replies concise, professional, and hotel-style.
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
    console.error("Webhook error:", error?.message || error);
    return res.sendStatus(500);
  }
});

async function handleMessageEvent(senderId, message) {
  const text = (message.text || "").trim();
  const normalized = normalizeText(text);

  if (!text && !message.attachments?.length) {
    await sendTextMessage(senderId, "ကျေးဇူးပြု၍ စာသားဖြင့် မေးမြန်းပေးပါရှင်/ခင်ဗျာ။");
    return;
  }

  if (!text && message.attachments?.length) {
    await sendTextMessage(
      senderId,
      "Attachment လက်ခံရရှိပါပြီ။ လောလောဆယ် စာသားဖြင့် မေးမြန်းပေးပါရှင်/ခင်ဗျာ။"
    );
    return;
  }

  const state = getUserState(senderId);

  if (state.stage === "awaiting_checkin") {
    updateUserState(senderId, {
      stage: "awaiting_nights",
      bookingDraft: {
        ...state.bookingDraft,
        checkInDate: text
      },
      lastTopic: "booking",
      lastIntent: "booking"
    });

    await sendTextMessage(
      senderId,
      "ကျေးဇူးတင်ပါတယ်ရှင်/ခင်ဗျာ。\n\n" +
      "ဘယ်နှညတည်းခိုမှာလဲရှင်။\n" +
      "ဥပမာ - 2 Nights"
    );
    return;
  }

  if (state.stage === "awaiting_nights") {
    updateUserState(senderId, {
      stage: "awaiting_guests",
      bookingDraft: {
        ...state.bookingDraft,
        nights: text
      },
      lastTopic: "booking",
      lastIntent: "booking"
    });

    await sendTextMessage(
      senderId,
      "Guest အရေအတွက် ဘယ်လောက်ပါလဲရှင်/ခင်ဗျာ。\n" +
      "ဥပမာ - 2 Adults / 2 Adults 1 Child"
    );
    return;
  }

  if (state.stage === "awaiting_guests") {
    updateUserState(senderId, {
      stage: "awaiting_room_type",
      bookingDraft: {
        ...state.bookingDraft,
        guests: text
      },
      lastTopic: "booking",
      lastIntent: "booking"
    });

    await sendTextMessage(
      senderId,
      "လိုချင်သော Room Type ကို ပို့ပေးပါရှင်/ခင်ဗျာ。\n\n" +
      "ဥပမာ:\n" +
      "- Superior Double\n" +
      "- Superior Triple\n" +
      "- Deluxe\n" +
      "- Grand Suite"
    );
    return;
  }

  if (state.stage === "awaiting_room_type") {
    updateUserState(senderId, {
      stage: "awaiting_contact_info",
      bookingDraft: {
        ...state.bookingDraft,
        roomType: text
      },
      lastTopic: "booking",
      lastIntent: "booking"
    });

    const bookingDraft = {
      ...state.bookingDraft,
      roomType: text
    };

    await sendTextMessage(
      senderId,
      "ကျေးဇူးတင်ပါတယ်ရှင်/ခင်ဗျာ。\n\n" +
      "လက်ခံရရှိသော Booking Request:\n" +
      `Check-in - ${bookingDraft.checkInDate || "-"}\n` +
      `Nights - ${bookingDraft.nights || "-"}\n` +
      `Guests - ${bookingDraft.guests || "-"}\n` +
      `Room Type - ${bookingDraft.roomType || "-"}\n\n` +
      "ကျေးဇူးပြု၍ အတည်ပြုဆက်သွယ်နိုင်ရန် အောက်ပါအချက်အလက်များ ပို့ပေးပါ:\n" +
      "1. Full Name\n" +
      "2. Contact Number\n\n" +
      "ဥပမာ:\n" +
      "Name - Mg Mg\n" +
      "Phone - 09xxxxxxxxx"
    );
    return;
  }

  if (state.stage === "awaiting_contact_info") {
    const parsed = extractNameAndPhone(text);

    const bookingDraft = state.bookingDraft || {};

    await saveBookingToFirestore({
      customerName: parsed.name,
      contactNumber: parsed.phone,
      bookingDetails:
        `Check-in - ${bookingDraft.checkInDate || ""}\n` +
        `Nights - ${bookingDraft.nights || ""}\n` +
        `Guests - ${bookingDraft.guests || ""}\n` +
        `Room Type - ${bookingDraft.roomType || ""}`,
      checkInDate: bookingDraft.checkInDate || "",
      nights: bookingDraft.nights || "",
      guests: bookingDraft.guests || "",
      roomType: bookingDraft.roomType || ""
    });

    updateUserState(senderId, {
      stage: "idle",
      bookingDraft: {},
      contactInfo: text,
      lastTopic: "booking",
      lastIntent: "booking",
      bookingCompletedAt: new Date().toISOString()
    });

    await sendTextMessage(
      senderId,
      "ကျေးဇူးတင်ပါတယ်ရှင်/ခင်ဗျာ。\n\n" +
      "သင်၏ Booking Request ကို လက်ခံရရှိပါပြီ。\n" +
      "Reservation Team မှ မကြာမီ ဆက်သွယ်အတည်ပြုပေးပါမည်。\n\n" +
      urgentContactMessage()
    );
    return;
  }

  if (isGreeting(normalized)) {
    updateUserState(senderId, {
      stage: "idle",
      lastTopic: "welcome",
      lastIntent: "greeting"
    });
    await sendTextMessage(senderId, welcomeMessage());
    return;
  }

  if (isBookingIntent(normalized)) {
    updateUserState(senderId, {
      stage: "awaiting_checkin",
      bookingDraft: {},
      lastTopic: "booking",
      lastIntent: "booking"
    });

    await sendTextMessage(
      senderId,
      "Booking ပြုလုပ်ပေးနိုင်ပါတယ်ရှင်/ခင်ဗျာ。\n\n" +
      "ကျေးဇူးပြု၍ Check-in Date လေး ပို့ပေးပါရှင်။\n" +
      "ဥပမာ - 25 Apr 2026"
    );
    return;
  }

  if (isContactIntent(normalized)) {
    updateUserState(senderId, {
      stage: "idle",
      lastTopic: "contact",
      lastIntent: "contact"
    });
    await sendTextMessage(senderId, urgentContactMessage());
    return;
  }

  if (isLocationIntent(normalized)) {
    updateUserState(senderId, {
      stage: "idle",
      lastTopic: "location",
      lastIntent: "location"
    });
    await sendTextMessage(senderId, `${HOTEL.locationText}\n\n${urgentContactMessage()}`);
    return;
  }

  const specificPrice = getSpecificRoomPrice(normalized);
  if (specificPrice) {
    updateUserState(senderId, {
      stage: "idle",
      lastTopic: specificPrice.topic,
      lastIntent: "price"
    });
    await sendTextMessage(senderId, specificPrice.reply);
    return;
  }

  if (isPriceIntent(normalized) || isRoomIntent(normalized)) {
    updateUserState(senderId, {
      stage: "idle",
      lastTopic: "room_rates",
      lastIntent: "price"
    });
    await sendTextMessage(senderId, HOTEL.roomRatesText);
    return;
  }

  if (isFollowUpQuestion(normalized)) {
    const followUpReply = getFollowUpReply(state, normalized);
    if (followUpReply) {
      await sendTextMessage(senderId, followUpReply);
      return;
    }
  }

  if (isUnclearQuestion(normalized)) {
    await sendTextMessage(senderId, clarificationMessage());
    return;
  }

  const aiReply = await askGemini(text);
  updateUserState(senderId, {
    stage: "idle",
    lastTopic: "general_ai",
    lastIntent: "general"
  });
  await sendTextMessage(senderId, aiReply);
}

async function handlePostbackEvent(senderId, postback) {
  const payload = postback.payload || "";

  if (payload === "GET_STARTED") {
    updateUserState(senderId, {
      stage: "idle",
      lastTopic: "welcome",
      lastIntent: "greeting"
    });
    await sendTextMessage(senderId, welcomeMessage());
    return;
  }

  await sendTextMessage(
    senderId,
    "ကျေးဇူးပြု၍ လိုအပ်သော အချက်အလက်ကို စာသားဖြင့် မေးမြန်းနိုင်ပါသည်။"
  );
}

function getUserState(senderId) {
  return (
    userStates.get(senderId) || {
      stage: "idle",
      lastTopic: null,
      lastIntent: null,
      bookingDraft: {}
    }
  );
}

function updateUserState(senderId, patch) {
  const current = getUserState(senderId);
  userStates.set(senderId, {
    ...current,
    ...patch,
    updatedAt: Date.now()
  });
}

function welcomeMessage() {
  return (
    "🙏 မင်္ဂလာပါ 🙏\n" +
    "Royal Mawlamyine Hotel မှ နွေးထွေးစွာ ကြိုဆိုပါတယ်。\n\n" +
    "Room Rates, Booking, Location / Address နှင့် Contact Information များကို ဤ Chat Box မှ မေးမြန်းနိုင်ပါသည်。\n\n" +
    "Booking ပြုလုပ်လိုပါက “Booking” ဟု ရိုက်ပို့နိုင်ပါသည်。\n\n" +
    urgentContactMessage()
  );
}

function urgentContactMessage() {
  return "Urgent Contact / Hot Line:\n" + HOTEL.hotlines.join("\n");
}

function clarificationMessage() {
  return (
    "လူကြီးမင်း၏ မေးခွန်းလေးကို တိတိကျကျ ထပ်မံမေးမြန်းပေးနိုင်မလားရှင်。\n\n" +
    "ဥပမာ:\n" +
    "- Superior Double Room စျေး\n" +
    "- Deluxe Room စျေး\n" +
    "- Booking ပြုလုပ်လိုပါသည်\n" +
    "- Location / လိပ်စာ\n\n" +
    "ကျေးဇူးတင်ပါတယ်ရှင်။"
  );
}

function normalizeText(text) {
  return text.toLowerCase().trim();
}

function isGreeting(text) {
  const keywords = ["hi", "hello", "hey", "mingalabar", "mingalarbar", "မင်္ဂလာပါ", "ဟယ်လို"];
  return keywords.some((k) => text.includes(k));
}

function isBookingIntent(text) {
  const keywords = [
    "booking",
    "book",
    "reservation",
    "reserve",
    "ဘိုကင်",
    "booking ယူမယ်",
    "booking လုပ်မယ်",
    "အခန်းယူမယ်",
    "တည်းမယ်",
    "booking ပြုလုပ်"
  ];
  return keywords.some((k) => text.includes(k));
}

function isPriceIntent(text) {
  const keywords = [
    "price",
    "prices",
    "rate",
    "rates",
    "room rate",
    "room rates",
    "cost",
    "how much",
    "charge",
    "fee",
    "စျေး",
    "ဈေး",
    "စျေးနှုန်း",
    "ဈေးနှုန်း",
    "ဘယ်လောက်",
    "ကုန်ကျ",
    "ကျသင့်",
    "တစ်ခန်းဘယ်လောက်",
    "အခန်းစျေး",
    "အခန်းခ",
    "တစ်ညဘယ်လောက်"
  ];
  return keywords.some((k) => text.includes(k));
}

function isRoomIntent(text) {
  const keywords = [
    "room",
    "rooms",
    "superior",
    "deluxe",
    "suite",
    "grand suite",
    "double room",
    "triple room",
    "အခန်း",
    "တစ်ခန်း",
    "စူပီးရီးယား",
    "စူပီးရီးရား",
    "ဒီလက်စ်",
    "ဒီလပ်စ်",
    "ဧည့်ခန်းတွဲ",
    "၂ ယောက်ခန်း",
    "၃ ယောက်ခန်း",
    "2 ယောက်ခန်း",
    "3 ယောက်ခန်း",
    "2 guests",
    "3 guests"
  ];
  return keywords.some((k) => text.includes(k));
}

function isLocationIntent(text) {
  const keywords = [
    "location",
    "address",
    "map",
    "where",
    "လိပ်စာ",
    "တည်နေရာ",
    "map link",
    "ဘယ်နား",
    "ဘယ်လိုလာ"
  ];
  return keywords.some((k) => text.includes(k));
}

function isContactIntent(text) {
  const keywords = ["contact", "phone", "hotline", "call", "ဖုန်း", "ဆက်သွယ်", "နံပါတ်", "hot line"];
  return keywords.some((k) => text.includes(k));
}

function isFollowUpQuestion(text) {
  const keywords = [
    "အခုရှိသေးလား",
    "ရှိသေးလား",
    "ရသေးလား",
    "ရလား",
    "ဘယ်လောက်လဲ",
    "ဘယ်လိုလဲ",
    "အခုဘယ်လိုလဲ",
    "အခုရှိလား",
    "လမ်းညွှန်ပေး",
    "ဘယ်လိုလာရမလဲ"
  ];
  return keywords.some((k) => text.includes(k));
}

function isUnclearQuestion(text) {
  const unclearKeywords = [
    "ရှိလား",
    "ရှိသေးလား",
    "ဘယ်လောက်လဲ",
    "ရလား",
    "အခုရှိလား",
    "အခုရလား",
    "သိချင်လို့",
    "ဘာလဲ",
    "အဲ့ဒါ",
    "အဲဒါ",
    "ဒီဟာ",
    "အခု",
    "ရှိမလား"
  ];

  const hasKnownIntent =
    isGreeting(text) ||
    isBookingIntent(text) ||
    isPriceIntent(text) ||
    isRoomIntent(text) ||
    isLocationIntent(text) ||
    isContactIntent(text);

  if (hasKnownIntent) return false;

  return unclearKeywords.some((k) => text.includes(k)) || text.length <= 8;
}

function getSpecificRoomPrice(text) {
  const t = text.toLowerCase();

  if (
    t.includes("superior double") ||
    t.includes("double room") ||
    t.includes("၂ ယောက်ခန်း") ||
    t.includes("2 ယောက်ခန်း") ||
    t.includes("2 guests") ||
    t.includes("နှစ်ယောက်ခန်း") ||
    t.includes("စူပီးရီးယား ၂") ||
    t.includes("စူပီးရီးရား ၂")
  ) {
    return {
      topic: "superior_double",
      reply: "Superior Double Room (2 Guests) - 130000MMK"
    };
  }

  if (
    t.includes("superior triple") ||
    t.includes("triple room") ||
    t.includes("၃ ယောက်ခန်း") ||
    t.includes("3 ယောက်ခန်း") ||
    t.includes("3 guests") ||
    t.includes("သုံးယောက်ခန်း") ||
    t.includes("စူပီးရီးယား ၃") ||
    t.includes("စူပီးရီးရား ၃")
  ) {
    return {
      topic: "superior_triple",
      reply: "Superior Triple Room (3 Guests) - 170000MMK"
    };
  }

  if (t.includes("deluxe") || t.includes("ဒီလက်စ်") || t.includes("ဒီလပ်စ်")) {
    return {
      topic: "deluxe",
      reply: "Deluxe Room - 200000MMK"
    };
  }

  if (
    t.includes("grand suite") ||
    t.includes("grand sheet") ||
    t.includes("suite") ||
    t.includes("ဧည့်ခန်းတွဲ")
  ) {
    return {
      topic: "grand_suite",
      reply: "Grand Suite - 300000MMK"
    };
  }

  if (
    t.includes("extra bed") ||
    t.includes("အပိုကုတင်") ||
    t.includes("ကုတင်ထပ်") ||
    t.includes("တစ်ယောက်ထပ်") ||
    t.includes("၁ ယောက်ထပ်")
  ) {
    return {
      topic: "extra_bed",
      reply: "Extra Bed (1 Person) - 40000MMK"
    };
  }

  if (
    t.includes("child") ||
    t.includes("children") ||
    t.includes("ကလေး") ||
    t.includes("6 to 12") ||
    t.includes("၆ နှစ်") ||
    t.includes("၁၂ နှစ်")
  ) {
    return {
      topic: "child_policy",
      reply: "Children age 6 to 12 years - 25000MMK"
    };
  }

  return null;
}

function getFollowUpReply(state, text) {
  const topic = state.lastTopic;
  if (!topic) return null;

  if (topic === "superior_double") {
    if (text.includes("ရှိ")) {
      return "Superior Double Room availability ကို စစ်ဆေးပေးရပါမယ်ရှင်/ခင်ဗျာ။ ကျေးဇူးပြု၍ Check-in Date လေး ပို့ပေးနိုင်မလားရှင်။";
    }
    if (text.includes("ဘယ်လောက်")) {
      return "Superior Double Room (2 Guests) - 130000MMK";
    }
  }

  if (topic === "superior_triple") {
    if (text.includes("ရှိ")) {
      return "Superior Triple Room availability ကို စစ်ဆေးပေးရပါမယ်ရှင်/ခင်ဗျာ။ ကျေးဇူးပြု၍ Check-in Date လေး ပို့ပေးနိုင်မလားရှင်။";
    }
    if (text.includes("ဘယ်လောက်")) {
      return "Superior Triple Room (3 Guests) - 170000MMK";
    }
  }

  if (topic === "deluxe") {
    if (text.includes("ရှိ")) {
      return "Deluxe Room availability ကို စစ်ဆေးပေးရပါမယ်ရှင်/ခင်ဗျာ။ ကျေးဇူးပြု၍ Check-in Date လေး ပို့ပေးနိုင်မလားရှင်။";
    }
    if (text.includes("ဘယ်လောက်")) {
      return "Deluxe Room - 200000MMK";
    }
  }

  if (topic === "grand_suite") {
    if (text.includes("ရှိ")) {
      return "Grand Suite availability ကို စစ်ဆေးပေးရပါမယ်ရှင်/ခင်ဗျာ။ ကျေးဇူးပြု၍ Check-in Date လေး ပို့ပေးနိုင်မလားရှင်။";
    }
    if (text.includes("ဘယ်လောက်")) {
      return "Grand Suite - 300000MMK";
    }
  }

  if (topic === "extra_bed") {
    if (text.includes("ဘယ်လောက်")) {
      return "Extra Bed (1 Person) - 40000MMK";
    }
    if (text.includes("ရှိ")) {
      return "Extra Bed လိုအပ်ပါက စီစဉ်ပေးနိုင်ခြင်း ရှိ/မရှိကို Reservation Team မှ စစ်ဆေးအတည်ပြုပေးပါမည်ရှင်/ခင်ဗျာ။";
    }
  }

  if (topic === "child_policy") {
    if (text.includes("ဘယ်လောက်")) {
      return "Children age 6 to 12 years - 25000MMK\nChildren under 6 years - Free";
    }
  }

  if (topic === "location") {
    if (text.includes("ဘယ်လိုလာ")) {
      return "မိတ်ဆွေ ဘယ်နေရာကနေ လာမလဲဆိုတာ ပြောပေးပါက Royal Mawlamyine Hotel သို့ ဘယ်လိုလာရမလဲဆိုသည့် လမ်းညွှန်အချက်အလက်ကို ဆက်လက်ကူညီပေးနိုင်ပါသည်။";
    }
    if (text.includes("လိပ်စာ") || text.includes("map")) {
      return HOTEL.locationText;
    }
  }

  if (topic === "room_rates") {
    if (text.includes("ဘယ်လောက်")) {
      return HOTEL.roomRatesText;
    }
    if (text.includes("ရှိ")) {
      return "ကျေးဇူးပြု၍ ဘယ် Room Type availability ကို မေးမြန်းလိုသည်ကို တိတိကျကျ ပို့ပေးနိုင်မလားရှင်။ ဥပမာ - Superior Double / Deluxe / Grand Suite";
    }
  }

  if (topic === "booking") {
    if (text.includes("ရှိ") || text.includes("ရ")) {
      return "Booking availability ကို စစ်ဆေးပေးရပါမယ်ရှင်/ခင်ဗျာ။ ကျေးဇူးပြု၍ Check-in Date, Nights, Guests Count နှင့် Room Type ပို့ပေးနိုင်မလားရှင်။";
    }
  }

  return null;
}

function extractNameAndPhone(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  let name = text;
  let phone = text;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("name")) {
      name = line.split("-").slice(1).join("-").trim() || line;
    }
    if (lower.includes("phone") || lower.includes("contact")) {
      phone = line.split("-").slice(1).join("-").trim() || line;
    }
  }

  const phoneMatch = text.match(/(\+?\d[\d\s~\-]{6,})/);
  if (phoneMatch) {
    phone = phoneMatch[0].trim();
  }

  return { name, phone };
}

async function saveBookingToFirestore(payload) {
  try {
    await db.collection("bookings").add({
      dateReceived: new Date().toISOString(),
      customerName: payload.customerName || "",
      contactNumber: payload.contactNumber || "",
      bookingDetails: payload.bookingDetails || "",
      checkInDate: payload.checkInDate || "",
      nights: payload.nights || "",
      guests: payload.guests || "",
      roomType: payload.roomType || "",
      status: "New",
      source: "Messenger"
    });

    console.log("Booking saved to Firestore");
  } catch (e) {
    console.error("Firestore save error:", e?.message || e);
  }
}

async function askGemini(userText) {
  if (!ai) {
    return clarificationMessage();
  }

  try {
    const prompt = `
${SYSTEM_PROMPT}

Customer message:
${userText}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    const reply = (response.text || "").trim();
    return reply || clarificationMessage();
  } catch (error) {
    console.error("Gemini error:", error?.message || error);
    return clarificationMessage();
  }
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
    console.error("Send message error:", error?.message || error);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
