require("dotenv").config();
const express = require("express");
const app = express();

app.use(express.json());

app.get("/", (req,res)=>{
  res.send("Royal Mawlamyine AI Webhook Running");
});

// Meta Verify
app.get("/webhook",(req,res)=>{
const mode=req.query["hub.mode"];
const token=req.query["hub.verify_token"];
const challenge=req.query["hub.challenge"];

if(mode==="subscribe" && token===process.env.VERIFY_TOKEN){
return res.status(200).send(challenge);
}

res.sendStatus(403);
});

// Messenger Events
app.post("/webhook",(req,res)=>{
console.log("Message received:", JSON.stringify(req.body));
res.status(200).send("EVENT_RECEIVED");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>{
console.log("Server running on port "+PORT);
});
