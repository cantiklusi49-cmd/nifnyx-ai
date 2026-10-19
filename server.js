
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Batasi permintaan chat agar tidak mudah disalahgunakan.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Nifnyx AI",
    chatConfigured: Boolean(process.env.OPENROUTER_API_KEY)
  });
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openrouter/auto";

  if (!apiKey) {
    return res.status(503).json({
      error: "API belum dikonfigurasi di server."
    });
  }

  const { message, history = [] } = req.body ?? {};

  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 8000
  ) {
    return res.status(400).json({
      error: "Pesan kosong atau terlalu panjang."
    });
  }

  if (!Array.isArray(history) || history.length > 12) {
    return res.status(400).json({
      error: "Format riwayat chat tidak valid."
    });
  }

  const safeHistory = [];

  for (const item of history) {
    if (
      !item ||
      !["user", "assistant"].includes(item.role) ||
      typeof item.content !== "string" ||
      item.content.length > 8000
    ) {
      return res.status(400).json({
        error: "Format riwayat chat tidak valid."
      });
    }

    safeHistory.push({
      role: item.role,
      content: item.content
    });
  }

  const messages = [
    {
      role: "system",
      content:
        "Kamu adalah Nifnyx AI, asisten yang ramah, membantu, " +
        "jujur, dan menjawab dalam bahasa yang digunakan pengguna."
    },
    ...safeHistory.slice(-12),
    { role: "user", content: message.trim() }
  ];

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "Nifnyx AI"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 800,
          stream: false
        }),
        signal: AbortSignal.timeout(45000)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Jangan pernah mencatat API key ke log.
      console.error(
        "OpenRouter error:",
        response.status,
        data?.error?.message || "Unknown provider error"
      );

      return res.status(502).json({
        error:
          response.status === 401
            ? "API key tidak diterima. Periksa konfigurasi server."
            : response.status === 402
              ? "Saldo atau kredit API tidak mencukupi."
              : response.status === 429
                ? "Batas permintaan tercapai. Coba lagi nanti."
                : "Penyedia AI gagal memproses permintaan."
      });
    }

    const answer = data?.choices?.[0]?.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({
        error: "Model AI tidak mengembalikan jawaban teks."
      });
    }

    return res.json({ answer: answer.trim() });
  } catch (error) {
    console.error(
      "Chat request failed:",
      error?.name || "UnknownError"
    );

    return res.status(504).json({
      error:
        error?.name === "TimeoutError"
          ? "AI terlalu lama merespons. Coba lagi."
          : "Gagal menghubungi layanan AI. Coba lagi nanti."
    });
  }
});

// Jangan sajikan file konfigurasi server ke pengunjung.
app.use((req, res, next) => {
  if (
    ["/server.js", "/package.json", "/package-lock.json"].includes(req.path)
  ) {
    return res.sendStatus(404);
  }
  next();
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(__dirname, { index: false }));

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Nifnyx AI berjalan di port ${PORT}`);
});


