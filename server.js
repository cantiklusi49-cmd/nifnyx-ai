
import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/", limiter);

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL;

app.get("/api/health", (_req, res) => {
  res.json({
    ready: Boolean(API_KEY && MODEL),
    model: MODEL || null
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!API_KEY || !MODEL) {
      return res.status(503).json({
        error: "Backend belum dikonfigurasi."
      });
    }

    const { message, image } = req.body || {};

    if (typeof message !== "string" ||
        (!message.trim() && !image)) {
      return res.status(400).json({
        error: "Pesan atau gambar diperlukan."
      });
    }

    if (message.length > 10000) {
      return res.status(413).json({
        error: "Pesan terlalu panjang."
      });
    }

    const content = [];

    if (message.trim()) {
      content.push({
        type: "text",
        text: message.trim()
      });
    } else if (image) {
      content.push({
        type: "text",
        text: "Analisis gambar ini dan jelaskan yang terlihat."
      });
    }

    if (image) {
      if (typeof image !== "string" ||
          !/^data:image\/(jpeg|png|webp|gif);base64,/i.test(image)) {
        return res.status(400).json({
          error: "Format gambar tidak didukung."
        });
      }

      if (image.length > 5_000_000) {
        return res.status(413).json({
          error: "Gambar terlalu besar. Coba gambar lebih kecil."
        });
      }

      content.push({
        type: "image_url",
        image_url: { url: image }
      });
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "system",
              content: "Kamu Nifnyx, asisten AI yang ramah, jelas, dan membantu. Jika pengguna mengirim gambar, analisis hanya hal yang benar-benar terlihat."
            },
            {
              role: "user",
              content
            }
          ],
          max_tokens: 1000
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter error:", response.status);
      return res.status(502).json({
        error: "OpenRouter gagal memproses permintaan. Periksa model, key, dan kuota."
      });
    }

    const reply = data.choices?.[0]?.message?.content;

    if (typeof reply !== "string") {
      return res.status(502).json({
        error: "Model tidak mengembalikan teks jawaban."
      });
    }

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error.message);
    res.status(500).json({
      error: "Terjadi kesalahan pada backend Nifnyx."
    });
  }
});

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Nifnyx backend aktif di port ${PORT}`);
});
