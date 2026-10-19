import express from "express";
import rateLimit from "express-rate-limit";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 3000;
console.log("[BOOT] Nifnyx mulai dijalankan");
console.log("[BOOT] Port:", process.env.PORT);
console.log("[BOOT] Direktori:", process.cwd());
const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(ROOT, "uploads");
const GALLERY = path.join(ROOT, "gallery");
const DB_FILE = path.join(DATA, "nifnyx-db.json");

const CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || "openrouter/auto";
const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || "google/gemini-2.5-flash";
const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || "bytedance-seed/seedream-4.5";
const API_URL = "https://openrouter.ai/api/v1";

await Promise.all([
fs.mkdir(DATA, { recursive: true }),
fs.mkdir(UPLOADS, { recursive: true }),
fs.mkdir(GALLERY, { recursive: true })
]);

async function readDB() {
try {
return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
} catch {
const initial = { conversations: [], files: [], gallery: [] };
await writeDB(initial);
return initial;
}
}

async function writeDB(db) {
const temp = DB_FILE + ".tmp";
await fs.writeFile(temp, JSON.stringify(db, null, 2));
await fs.rename(temp, DB_FILE);
}

app.use(express.json({ limit: "12mb" }));
app.get("/", (_req, res) => {
res.sendFile(path.join(ROOT, "index.html"));
});

const limiter = rateLimit({
windowMs: 60_000,
limit: 30,
standardHeaders: "draft-7",
legacyHeaders: false
});

app.use("/api/", limiter);

function cleanText(value, max = 30000) {
if (typeof value !== "string") return "";
return value.trim().slice(0, max);
}

function getKey() {
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
const err = new Error("OPENROUTER_API_KEY belum dipasang di Environment Variables.");
err.status = 503;
throw err;
}
return key;
}

async function openRouter(endpoint, body, timeout = 120000) {
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeout);

try {
const response = await fetch(${API_URL}${endpoint}, {
method: "POST",
headers: {
Authorization: Bearer ${getKey()},
"Content-Type": "application/json",
"HTTP-Referer": process.env.APP_URL || "https://example.com",
"X-Title": "Nifnyx AI"
},
body: JSON.stringify(body),
signal: controller.signal
});

const result = await response.json().catch(() => ({}));  

if (!response.ok) {  
  const err = new Error(  
    result?.error?.message || `OpenRouter error (${response.status})`  
  );  
  err.status = response.status >= 500 ? 502 : 400;  
  throw err;  
}  
return result;

} catch (err) {
if (err.name === "AbortError") {
const timeoutError = new Error("Permintaan terlalu lama. Coba lagi.");
timeoutError.status = 504;
throw timeoutError;
}
throw err;
} finally {
clearTimeout(timer);
}
}

function safeError(err) {
console.error("[Nifnyx]", err.message);
return {
error: err.status && err.status < 500
? err.message
: (err.status === 504
? err.message
: "Terjadi kesalahan server/provider. Coba lagi atau periksa konfigurasi model.")
};
}

function imageMime(mime) {
return ["image/jpeg", "image/png", "image/webp"].includes(mime);
}

function dataUrlParts(dataUrl) {
const match = /^data:(image/(?:jpeg|png|webp)|application/pdf|text/plain);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
if (!match) throw Object.assign(new Error("Format file tidak didukung."), { status: 400 });
const buffer = Buffer.from(match[2], "base64");
if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
throw Object.assign(new Error("Ukuran file maksimal 5 MB."), { status: 413 });
}
return { mime: match[1], buffer };
}

function extensionFor(mime) {
return ({
"image/jpeg": ".jpg",
"image/png": ".png",
"image/webp": ".webp",
"application/pdf": ".pdf",
"text/plain": ".txt"
})[mime];
}

async function findFile(id) {
const db = await readDB();
const file = db.files.find(item => item.id === id);
if (!file) throw Object.assign(new Error("File tidak ditemukan."), { status: 404 });
return { db, file };
}

app.get("/api/health", async (_req, res) => {
const db = await readDB();
res.json({
ok: true,
service: "Nifnyx AI",
chatConfigured: Boolean(process.env.OPENROUTER_API_KEY),
visionModel: VISION_MODEL,
imageModel: IMAGE_MODEL,
conversations: db.conversations.length,
files: db.files.length,
gallery: db.gallery.length
});
});

// Riwayat percakapan
app.get("/api/conversations", async (_req, res, next) => {
try {
const db = await readDB();
res.json(db.conversations.map(c => ({
id: c.id,
title: c.title,
updatedAt: c.updatedAt,
messages: c.messages.length
})).sort((a, b) => b.updatedAt - a.updatedAt));
} catch (e) { next(e); }
});

app.get("/api/conversations/:id", async (req, res, next) => {
try {
const db = await readDB();
const c = db.conversations.find(x => x.id === req.params.id);
if (!c) return res.status(404).json({ error: "Chat tidak ditemukan." });
res.json(c);
} catch (e) { next(e); }
});

app.delete("/api/conversations/:id", async (req, res, next) => {
try {
const db = await readDB();
db.conversations = db.conversations.filter(x => x.id !== req.params.id);
await writeDB(db);
res.json({ ok: true });
} catch (e) { next(e); }
});

app.post("/api/chat", async (req, res, next) => {
try {
const message = cleanText(req.body.message);
if (!message) return res.status(400).json({ error: "Pesan masih kosong." });

const db = await readDB();  
let convo = db.conversations.find(x => x.id === req.body.conversationId);  

if (!convo) {  
  convo = {  
    id: crypto.randomUUID(),  
    title: message.slice(0, 70),  
    createdAt: Date.now(),  
    updatedAt: Date.now(),  
    messages: []  
  };  
  db.conversations.unshift(convo);  
}  

const content = [{ type: "text", text: message }];  
const attachedIds = Array.isArray(req.body.fileIds) ? req.body.fileIds.slice(0, 4) : [];  

for (const id of attachedIds) {  
  const file = db.files.find(f => f.id === id);  
  if (!file) continue;  

  const bytes = await fs.readFile(path.join(UPLOADS, file.diskName));  
  const data = bytes.toString("base64");  
  const dataUrl = `data:${file.mime};base64,${data}`;  

  if (file.mime.startsWith("image/")) {  
    content.push({ type: "image_url", image_url: { url: dataUrl } });  
  } else if (file.mime === "application/pdf") {  
    content.push({  
      type: "file",  
      file: { filename: file.name, file_data: dataUrl }  
    });  
  } else if (file.mime === "text/plain") {  
    content.push({  
      type: "text",  
      text: `\n\nIsi file ${file.name}:\n${bytes.toString("utf8").slice(0, 20000)}`  
    });  
  }  
}  

const history = convo.messages.slice(-12).map(m => ({  
  role: m.role,  
  content: m.content  
}));  

const result = await openRouter("/chat/completions", {  
  model: CHAT_MODEL,  
  messages: [

{
role: "system",
content: `Kamu adalah Nifnyx AI, asisten AI yang cerdas, ramah, teliti, edukatif, dan mudah dipahami.

GAYA KOMUNIKASI:

- Gunakan bahasa yang sesuai dengan bahasa pengguna.
- Jika pengguna berbicara santai, kamu boleh menjawab santai dan ramah tanpa mengurangi ketepatan informasi.
- Jelaskan jawaban dengan cukup panjang, rinci, dan menyeluruh agar pengguna benar-benar memahami topiknya.
- Jangan memberi jawaban terlalu singkat untuk pertanyaan yang membutuhkan penjelasan.
- Hindari pengulangan, kalimat bertele-tele, dan informasi yang tidak relevan.

STRUKTUR JAWABAN:

1. Mulai dengan jawaban inti yang langsung menjawab pertanyaan.
2. Jelaskan konsep, alasan, atau cara kerjanya secara bertahap.
3. Berikan contoh nyata atau analogi sederhana jika membantu pemahaman.
4. Jika pertanyaan berupa tutorial, tuliskan langkah-langkah secara berurutan.
5. Jika ada istilah teknis, jelaskan artinya dengan bahasa sederhana.
6. Jika ada beberapa pilihan, jelaskan perbedaan, kelebihan, kekurangan, dan kapan setiap pilihan cocok digunakan.
7. Akhiri dengan kesimpulan singkat jika jawaban panjang membutuhkan rangkuman.

ATURAN KEDALAMAN:

- Untuk pertanyaan sederhana, jawab ringkas tetapi tetap jelas.
- Untuk pertanyaan pelajaran, teknologi, sains, pemrograman, atau pertanyaan kompleks, berikan penjelasan mendalam beserta contoh yang relevan.
- Untuk tutorial, jangan melewatkan langkah penting yang dapat membuat pengguna bingung.
- Untuk kode, jelaskan fungsi bagian penting, cara memasang, cara menjalankan, dan kemungkinan kesalahan jika relevan.
- Sesuaikan kedalaman jawaban dengan kebutuhan pengguna; jangan memanjangkan jawaban hanya demi panjangnya.

KETELITIAN:

- Jangan mengarang fakta, sumber, hasil pengujian, atau kemampuan yang belum tersedia.
- Jika informasi belum pasti atau dapat berubah, jelaskan ketidakpastiannya.
- Bedakan fakta, perkiraan, dan opini.
- Jika pertanyaan kurang jelas, ajukan pertanyaan klarifikasi yang spesifik.
- Jika tidak mengetahui jawaban, jujurlah dan jelaskan apa yang masih perlu diverifikasi.

INTERAKSI:

- Bersikap sabar, suportif, sopan, dan tidak merendahkan pengguna.
- Bantu pengguna memahami alasan di balik jawaban, bukan hanya memberikan hasil akhir.
- Gunakan judul, daftar, tabel, atau contoh kode jika benar-benar membuat jawaban lebih mudah dibaca.
- Jangan selalu menggunakan format panjang untuk percakapan santai atau pertanyaan yang hanya membutuhkan jawaban langsung.

TUJUAN UTAMA:
Pastikan pengguna tidak hanya mendapatkan jawaban, tetapi juga memahami apa artinya, mengapa hal itu benar, dan bagaimana menerapkannya.`
},

...history,  
    { role: "user", content }  
  ],  
  max_tokens: 4000  
});  

const answer = result?.choices?.[0]?.message?.content;  
if (!answer || typeof answer !== "string") {  
  throw new Error("Provider tidak mengembalikan jawaban teks.");  
}  

convo.messages.push(  
  { role: "user", content: message, createdAt: Date.now() },  
  { role: "assistant", content: answer, createdAt: Date.now() }  
);  
convo.updatedAt = Date.now();  
await writeDB(db);  

res.json({  
  ok: true,  
  conversationId: convo.id,  
  answer,  
  model: result.model || CHAT_MODEL  
});

} catch (e) { next(e); }
});

// Upload gambar, PDF, dan TXT
app.post("/api/files", async (req, res, next) => {
try {
const name = path.basename(cleanText(req.body.name, 180) || "upload");
const { mime, buffer } = dataUrlParts(req.body.dataUrl);
const id = crypto.randomUUID();
const diskName = id + extensionFor(mime);

await fs.writeFile(path.join(UPLOADS, diskName), buffer);  
const db = await readDB();  
const file = { id, name, mime, size: buffer.length, diskName, createdAt: Date.now() };  
db.files.unshift(file);  
await writeDB(db);  
res.json({ ok: true, file: { ...file, diskName: undefined } });

} catch (e) { next(e); }
});

app.get("/api/files", async (_req, res, next) => {
try {
const db = await readDB();
res.json(db.files.map(({ diskName, ...f }) => f));
} catch (e) { next(e); }
});

app.get("/api/files/:id/download", async (req, res, next) => {
try {
const { file } = await findFile(req.params.id);
res.download(path.join(UPLOADS, file.diskName), file.name);
} catch (e) { next(e); }
});

app.delete("/api/files/:id", async (req, res, next) => {
try {
const { db, file } = await findFile(req.params.id);
await fs.unlink(path.join(UPLOADS, file.diskName)).catch(() => {});
db.files = db.files.filter(f => f.id !== file.id);
await writeDB(db);
res.json({ ok: true });
} catch (e) { next(e); }
});

// Analisis foto langsung
app.post("/api/analyze", async (req, res, next) => {
try {
const prompt = cleanText(req.body.prompt, 5000) || "Jelaskan isi gambar ini secara rinci.";
const { mime, buffer } = dataUrlParts(req.body.dataUrl);
if (!imageMime(mime)) return res.status(400).json({ error: "Pilih gambar JPG, PNG, atau WEBP." });

const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;  
const result = await openRouter("/chat/completions", {  
  model: VISION_MODEL,  
  messages: [{  
    role: "user",  
    content: [  
      { type: "text", text: prompt },  
      { type: "image_url", image_url: { url: dataUrl } }  
    ]  
  }],  
  max_tokens: 3000  
});  

res.json({  
  ok: true,  
  answer: result?.choices?.[0]?.message?.content || "Model tidak memberikan jawaban teks.",  
  model: result.model || VISION_MODEL  
});

} catch (e) { next(e); }
});

// Generate gambar melalui OpenRouter Images API
app.post("/api/images/generate", async (req, res, next) => {
try {
const prompt = cleanText(req.body.prompt, 4000);
if (!prompt) return res.status(400).json({ error: "Prompt gambar masih kosong." });

const result = await openRouter("/images", {  
  model: IMAGE_MODEL,  
  prompt  
}, 180000);  

const item = result?.data?.[0];  
if (!item?.b64_json) {  
  throw new Error("Provider tidak mengembalikan data gambar.");  
}  

const mime = item.media_type || "image/png";  
if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {  
  throw new Error("Format gambar hasil tidak didukung.");  
}  

const id = crypto.randomUUID();  
const ext = mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png";  
const diskName = id + ext;  
await fs.writeFile(path.join(GALLERY, diskName), Buffer.from(item.b64_json, "base64"));  

const db = await readDB();  
const image = { id, prompt, mime, diskName, createdAt: Date.now() };  
db.gallery.unshift(image);  
await writeDB(db);  

res.json({  
  ok: true,  
  image: { id, prompt, mime, url: `/api/gallery/${id}/image` },  
  model: result.model || IMAGE_MODEL  
});

} catch (e) { next(e); }
});

app.get("/api/gallery", async (_req, res, next) => {
try {
const db = await readDB();
res.json(db.gallery.map(({ diskName, ...image }) => ({
...image, url: /api/gallery/${image.id}/image
})));
} catch (e) { next(e); }
});

app.get("/api/gallery/:id/image", async (req, res, next) => {
try {
const db = await readDB();
const image = db.gallery.find(x => x.id === req.params.id);
if (!image) return res.status(404).json({ error: "Gambar tidak ditemukan." });
res.type(image.mime).sendFile(path.join(GALLERY, image.diskName));
} catch (e) { next(e); }
});

app.delete("/api/gallery/:id", async (req, res, next) => {
try {
const db = await readDB();
const image = db.gallery.find(x => x.id === req.params.id);
if (image) await fs.unlink(path.join(GALLERY, image.diskName)).catch(() => {});
db.gallery = db.gallery.filter(x => x.id !== req.params.id);
await writeDB(db);
res.json({ ok: true });
} catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
const status = err.status || 500;
res.status(status).json(safeError(err));
});

app.listen(PORT, "0.0.0.0", () => {
console.log(Nifnyx AI running on port ${PORT});
});
