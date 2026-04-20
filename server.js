import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 8080;

// nötig für __dirname bei ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(__dirname));

// Startseite
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Test-Route
app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server läuft sauber" });
});

// 👉 HIER passiert die KI-Erklärung
app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text) {
      return res.status(400).json({ error: "Kein Text gesendet" });
    }

    const prompt = `
Erkläre diesen Brief in einfachem Deutsch.

- Was ist das?
- Was wird verlangt?
- Was musst du tun?
- Wie dringend ist es?

Brief:
${text}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    const result =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Keine Antwort von KI.";

    res.json({ result });

  } catch (error) {
    console.error("FEHLER:", error);
    res.status(500).json({ error: "Server Fehler" });
  }
});

// Server starten
app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
