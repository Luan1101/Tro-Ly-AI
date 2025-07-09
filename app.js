
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const multer = require("multer");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const app = express();
const upload = multer();
const { google } = require("googleapis");
const port = 3000;

// Firebase Admin SDK
const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const chatCollection = db.collection("chatHistory");

app.set("view engine", "ejs");
app.set("views", "./views");

app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.use(session({ secret: "secret", resave: false, saveUninitialized: true }));
app.use(express.static("public"));

// Route hiển thị giao diện chính
const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.course-work.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
];

const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID || '234266435961-9r9aaabpkqtb8bdmf5vrov5o4ommkaq7.apps.googleusercontent.com',
  process.env.CLIENT_SECRET || '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',
  process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback'
);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: true,
  })
);

app.post('/language', (req, res) => {
  req.session.language = req.body.lang || 'vi';
  res.redirect('back');
});

app.get('/auth', (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
  const { data: userinfo } = await oauth2.userinfo.get();

  req.session.user = userinfo;
  req.session.access_token = tokens.access_token;

  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/', async (req, res) => {
  const user = req.session.user;
  const token = req.session.access_token;
  const currentLanguage = req.session.language || 'vi';
  const notifications = [];

  if (!user || !token) {
    return res.render('index', {
      user: null,
      notifications,
      title: 'Trợ lý ảo TDTU',
      currentLanguage,
      history: [],
    });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });

    const classroom = google.classroom({ version: 'v1', auth });
    const { data: courseData } = await classroom.courses.list({ courseStates: ['ACTIVE'] });
    const courses = courseData.courses || [];

    for (const course of courses) {
      const ann = await classroom.courses.announcements.list({ courseId: course.id });
      ann.data.announcements?.forEach(item => {
        notifications.push({
          type: 'Thông báo',
          title: item.text,
          courseName: course.name,
          date: item.creationTime,
          link: item.alternateLink,
        });
      });

      const work = await classroom.courses.courseWork.list({ courseId: course.id });
      work.data.courseWork?.forEach(item => {
        notifications.push({
          type: 'Bài tập',
          title: item.title,
          courseName: course.name,
          date: item.creationTime,
          link: item.alternateLink,
          dueDate: item.dueDate,
        });
      });
    }

    notifications.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.render('index', {
      user,
      notifications,
      title: 'Trợ lý ảo TDTU',
      currentLanguage,
      history: [],
    });
  } catch (err) {
    console.error('❌ Google Classroom API error:', err.message);
    res.render('index', {
      user,
      notifications: [],
      title: 'Trợ lý ảo TDTU',
      currentLanguage,
      history: [],
    });
  }
});


// Route giao diện chat và load lịch sử
app.get("/ai-assistant", async (req, res) => {
  const snapshot = await chatCollection.orderBy("createdAt", "desc").limit(10).get();
  const history = snapshot.docs.map(doc => doc.data());
  res.render("ai-assistant", { history });
});

// Route xử lý chat
app.post("/chat", upload.single("image"), async (req, res) => {
  const message = req.body.message || "";
  const imageBuffer = req.file ? req.file.buffer : null;
  let imageBase64 = null;

  if (imageBuffer) {
    imageBase64 = `data:${req.file.mimetype};base64,${imageBuffer.toString("base64")}`;
  }

  // Giả lập gọi Gemini API
  const responseText = imageBase64
    ? `Phân tích ảnh + nội dung: ${message}`
    : `Phản hồi cho: ${message}`;

  const record = {
    message,
    response: responseText,
    imageBase64,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await chatCollection.add(record);

  res.json({ answer: responseText });
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyD0rTIls_V4nNm1OOOJsF6kMTxPlebRh1o';
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

app.post("/api/ocr", async (req, res) => {
  try {
    const base64 = req.body.image;
    const currentLanguage = req.body.language || 'vi';

    if (!base64) return res.status(400).json({ error: "No image provided." });

    const base64Data = base64.split(',')[1];

    const promptText =
      currentLanguage === "vi"
        ? "Hãy phân tích nội dung của hình ảnh này, bao gồm văn bản và các thông tin quan trọng. Trả lời bằng tiếng Việt."
        : "Please analyze the content of this image, including text and important information. Respond in English.";

    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: "image/png",
                data: base64Data
              }
            }
          ]
        }
      ]
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "❌ Không nhận được kết quả từ Gemini.";

    res.json({ text });
  } catch (err) {
    console.error("Gemini API error:", err);
    res.status(500).json({ error: "Lỗi khi xử lý ảnh với Gemini." });
  }
});

// Route xử lý chatbot qui chế qui định
const tdtChatbotRoute = require("./tdtuChatbot");
//Route default
app.post("/chat-gemini", async (req, res) => {
  try {
    const question = req.body.question?.trim();
    if (!question) return res.status(400).json({ error: "Missing question" });

    const prompt = `
Bạn là một trợ lý AI thân thiện. Hãy trả lời câu hỏi sau một cách tự nhiên, chính xác và rõ ràng. Sử dụng định dạng Markdown để trình bày câu trả lời một cách dễ đọc, bao gồm tiêu đề, danh sách, code block nếu cần thiết:

"${question}"
`;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyD0rTIls_V4nNm1OOOJsF6kMTxPlebRh1o';
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await axios.post(GEMINI_URL, {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    });

    const answer = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    res.json({ text: answer || "Tôi không biết thông tin này." });
  } catch (err) {
    console.error("❌ Gemini API error:", err.response?.data || err.message);
    res.status(500).json({ error: "Gemini API error: " + err.message });
  }
});
//Route sửa lỗi chính tả
app.post("/spell-check", async (req, res) => {
  try {
    const question = req.body.question?.trim();
    if (!question) return res.status(400).json({ error: "Missing question" });

    if (question.split(/\s+/).length > 500) {
      return res.status(400).json({ error: "Vượt quá giới hạn 500 từ." });
    }

    const prompt = `
Bạn là một AI ngôn ngữ chuyên sửa lỗi chính tả và ngữ pháp.

Văn bản dưới đây có thể là tiếng Việt hoặc tiếng Anh. Hãy tự động nhận diện ngôn ngữ và sửa lỗi chính tả, ngữ pháp nếu có. Trả về văn bản đã chỉnh sửa, không cần giải thích thêm.

Văn bản: "${question}"
`;

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyD0rTIls_V4nNm1OOOJsF6kMTxPlebRh1o';
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await axios.post(GEMINI_URL, {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    });

    const corrected = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    res.json({ text: corrected || "Không có lỗi cần sửa hoặc không thể xử lý." });
  } catch (err) {
    console.error("❌ Spell-check Gemini API error:", err.response?.data || err.message);
    res.status(500).json({ error: "Gemini API error: " + err.message });
  }
});

// Mount vào /tdt-chat
app.use("/tdtu-chat", tdtChatbotRoute);
app.listen(port, () => {
  console.log(`🚀 Server chạy tại http://localhost:${port}`);
});
