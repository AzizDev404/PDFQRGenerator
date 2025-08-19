// db.js
const mongoose = require("mongoose");

async function connectDB() {
  try {
    // IPv6/localhost muammolarini chetlash uchun 127.0.0.1
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB ulanish holati: Ulandi");
  } catch (error) {
    console.error("❌ MongoDB ulanishida xatolik:", error.message);
    process.exit(1);
  }
}

module.exports = connectDB; // <-- funksiya sifatida export
