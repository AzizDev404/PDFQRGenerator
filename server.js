const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const QRCode = require('qrcode');
require('dotenv').config(); // .env faylini yuklash
const connectDB = require('./db'); // funksiya sifatida import

const app = express();
const PORT = process.env.PORT || 3001;

// Login ma'lumotlari
const ADMIN_USERNAME = process.env.ADMIN_USERNAME
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD 

// Middleware
app.use(cors());
app.use(express.json());
// Statik papkani absolute yo'l bilan berish — har doim ishlaydi
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ⛳️ SCHEMA (Mongoose model)
const fileSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  originalName: { type: String, required: true },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  fileSize: { type: Number, required: true },
  mimeType: { type: String, required: true },
  qrCodePath: { type: String, required: true },
  uploadDate: { type: Date, default: Date.now },
  downloadCount: { type: Number, default: 0 },
  lastAccessed: { type: Date, default: Date.now }
});
const FileModel = mongoose.model('File', fileSchema);

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', 'pdfs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype === 'application/pdf'
    ? cb(null, true)
    : cb(new Error('Faqat PDF fayllar qabul qilinadi!'), false)
});

// QR helper - faqat URL saqlash
const generateQRCode = async (url) => {
  const qrDir = path.join(__dirname, 'uploads', 'qrcodes');
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
  const qrPath = path.join(qrDir, `qr_${Date.now()}.png`);
  await QRCode.toFile(qrPath, url);
  return qrPath;
};

// 🔐 SODDALASHTIRILGAN LOGIN ROUTE
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  // Ma'lumotlar mavjudligini tekshirish
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username va password talab qilinadi' });
  }
  
  // ENV dan kelayotgan ma'lumotlar bilan taqqoslash
  const isValid = username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
  
  if (isValid) {
    // Muvaffaqiyatli login
    res.json({ 
      success: true, 
      message: 'Muvaffaqiyatli kirish'
    });
  } else {
    // Noto'g'ri ma'lumotlar
    res.json({ 
      success: false, 
      message: 'Noto\'g\'ri username yoki password' 
    });
  }
});

// Logout route (ixtiyoriy)
app.post('/api/logout', (req, res) => {
  res.json({ success: true, message: 'Muvaffaqiyatli chiqish' });
});

// 📊 ROUTES (artiq hech qanday auth middleware yo'q)
app.get("/api/qrs", async (req, res) => {
  try {
    const files = await FileModel.find();
    res.json(files);
  } catch (error) {
    res.status(500).json({ message: "Xatolik ❌", error: error.message });
  }
});

app.post('/api/upload', upload.array('pdfs', 10), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'Hech qanday fayl yuklanmadi' });

    const uploadedFiles = [];
    for (const file of req.files) {
      const fileId = Date.now().toString() + Math.random().toString(36).slice(2, 11);
      
      // QR kodda faqat URL saqlash
      const downloadUrl = `${req.protocol}://${req.get('host')}/api/pdf/${fileId}`;
      const qrCodePath = await generateQRCode(downloadUrl);

      const newFile = new FileModel({
        id: fileId,
        originalName: file.originalname,
        fileName: file.filename,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        qrCodePath
      });
      await newFile.save();

      uploadedFiles.push({
        id: fileId,
        name: file.originalname,
        size: file.size,
        qrCode: `${req.protocol}://${req.get('host')}/uploads/qrcodes/${path.basename(qrCodePath)}`,
        downloadUrl: downloadUrl,
        uploadDate: new Date()
      });
    }

    res.json({ success: true, message: `${uploadedFiles.length} ta fayl muvaffaqiyatli yuklandi`, files: uploadedFiles });
  } catch (error) {
    console.error('Yuklashda xatolik:', error);
    res.status(500).json({ error: 'Server xatoligi: ' + error.message });
  }
});

app.get('/api/files', async (req, res) => {
  try {
    const page = +req.query.page || 1;
    const limit = +req.query.limit || 10;
    const skip = (page - 1) * limit;

    const [files, total] = await Promise.all([
      FileModel.find().sort({ uploadDate: -1 }).skip(skip).limit(limit),
      FileModel.countDocuments()
    ]);

    const filesWithUrls = files.map(file => ({
      id: file.id,
      originalName: file.originalName,
      fileSize: file.fileSize,
      uploadDate: file.uploadDate,
      downloadCount: file.downloadCount,
      qrCode: `${req.protocol}://${req.get('host')}/uploads/qrcodes/${path.basename(file.qrCodePath)}`,
      downloadUrl: `${req.protocol}://${req.get('host')}/api/pdf/${file.id}`
    }));

    res.json({
      files: filesWithUrls,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

app.delete('/api/file/:id', async (req, res) => {
  try {
    const file = await FileModel.findOne({ id: req.params.id });
    if (!file) return res.status(404).json({ error: 'Fayl topilmadi' });

    if (fs.existsSync(file.filePath)) fs.unlinkSync(file.filePath);
    if (fs.existsSync(file.qrCodePath)) fs.unlinkSync(file.qrCodePath);
    await FileModel.deleteOne({ id: req.params.id });

    res.json({ success: true, message: "Fayl muvaffaqiyatli o'chirildi" });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const [totalFiles, downloadsAgg, recentFiles] = await Promise.all([
      FileModel.countDocuments(),
      FileModel.aggregate([{ $group: { _id: null, total: { $sum: '$downloadCount' } } }]),
      FileModel.find().sort({ uploadDate: -1 }).limit(5).select('originalName uploadDate downloadCount')
    ]);
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayUploads = await FileModel.countDocuments({ uploadDate: { $gte: todayStart } });

    res.json({
      totalFiles,
      totalDownloads: downloadsAgg[0]?.total || 0,
      todayUploads,
      recentFiles
    });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// 📄 PUBLIC ROUTES (login kerak emas)
app.get('/api/pdf/:id', async (req, res) => {
  try {
    const file = await FileModel.findOne({ id: req.params.id });
    if (!file) return res.status(404).json({ error: 'Fayl topilmadi' });
    if (!fs.existsSync(file.filePath)) return res.status(404).json({ error: 'Fayl serverda topilmadi' });

    file.downloadCount += 1;
    file.lastAccessed = new Date();
    await file.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
    fs.createReadStream(file.filePath).pipe(res);
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

app.get('/api/file-info/:id', async (req, res) => {
  try {
    const file = await FileModel.findOne({ id: req.params.id });
    if (!file) return res.status(404).json({ error: 'Fayl topilmadi' });
    res.json({
      id: file.id,
      originalName: file.originalName,
      fileSize: file.fileSize,
      uploadDate: file.uploadDate,
      downloadCount: file.downloadCount,
      lastAccessed: file.lastAccessed
    });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

app.get('/api/qr/:id', async (req, res) => {
  try {
    const file = await FileModel.findOne({ id: req.params.id });
    if (!file) return res.status(404).json({ error: 'Fayl topilmadi' });
    if (!fs.existsSync(file.qrCodePath)) return res.status(404).json({ error: 'QR kod topilmadi' });

    res.setHeader('Content-Type', 'image/png');
    fs.createReadStream(file.qrCodePath).pipe(res);
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Multer error handler
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Fayl hajmi juda katta (maksimal 50MB)' });
  }
  if (error) return res.status(500).json({ error: error.message });
  next();
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Sahifa topilmadi' }));

// 🔸 Serverni faqat DB ulanganidan keyin ishga tushiramiz
(async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Server ${PORT} portda ishlamoqda`);
    console.log(`👤 Admin Username: ${ADMIN_USERNAME}`);
    console.log(`🔑 Admin Password: ${ADMIN_PASSWORD}`);
  });
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log("Server to'xtatilmoqda...");
  await mongoose.connection.close();
  process.exit(0);
});