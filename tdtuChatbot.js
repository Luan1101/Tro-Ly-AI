
// tdtChatbot.js
const express = require("express");
const router = express.Router();
const fs = require("fs");
const axios = require("axios");
const Fuse = require("fuse.js");

// Đọc dữ liệu QA
const qaData = JSON.parse(fs.readFileSync("qa_data.json", "utf8"));

// Tìm kiếm gần đúng bằng Fuse.js
const fuse = new Fuse(qaData, {
    keys: ["question"],
    threshold: 0.5,
    ignoreLocation: true,
    includeScore: true,
});



const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyD0rTIls_V4nNm1OOOJsF6kMTxPlebRh1o';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

router.post("/", async (req, res) => {
    try {
        const question = req.body.question?.trim();
        if (!question) return res.status(400).json({ error: "Missing question" });

        // 1. Tìm kiếm gần đúng với Fuse
        const match = fuse.search(question)?.[0];
        if (match && match.score < 0.5) {
            return res.json({ answer: match.item.answer, source: "matched" });
        }

        // 2. Nếu không có, hỏi Gemini kèm theo quy chế
        const prompt = `
Bạn là trợ lý AI chuyên hỗ trợ sinh viên về quy chế của trường Đại học Tôn Đức Thắng.

Câu hỏi sau liên quan đến một hành vi vi phạm. Hãy xác định hình thức kỷ luật phù hợp nhất với hành vi đó, **dựa trên quy định, quy chế và thông lệ giáo dục đại học tại Việt Nam**.

Bạn chỉ được chọn và trả lời duy nhất một trong các hình thức kỷ luật sau:

    1. Nhắc nhở  
    2. Phê bình  
    3. Nghiêm khắc phê bình  
    4. Khiển trách  
    5. Cảnh cáo lần 1  
    6. Cảnh cáo lần 2  
    7. Đình chỉ học tập có thời hạn  
    8. Buộc thôi học

Câu hỏi: "${question}", ở Đại học Tôn Đức Thắng bị xử lý sao?

Trả lời theo đúng một trong các hình thức kỷ luật trên.
`;


        const geminiRes = await axios.post(GEMINI_URL, {
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }],
                },
            ],
        });

        const answer = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!answer || answer.toLowerCase().includes("tôi không biết")) {
            return res.json({ text: "Xin lỗi, tôi chưa biết nội dung quy chế phù hợp để trả lời câu hỏi này." });
        }

        return res.json({ text: answer });

    } catch (err) {
        console.error("❌ Gemini API error:", err.response?.data || err.message);
        res.status(500).json({ error: "Gemini API error" + err });
    }
});

module.exports = router;
