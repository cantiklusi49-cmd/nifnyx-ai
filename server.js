
import express from "express";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

console.log("[TEST] Node.js berhasil dijalankan.");
console.log("[TEST] Port:", PORT);

app.get("/", (_req, res) => {
  res.send("Nifnyx AI - Server berhasil aktif!");
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Nifnyx AI" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[TEST] Server aktif di port ${PORT}`);
});
