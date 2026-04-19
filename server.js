const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));

// Startseite laden
app.get("/", (req, res) => {
  res.send(`
    <h2>hilfe24 läuft ✅</h2>
    <p>Server funktioniert</p>
  `);
});

// Gemini Funktion
async function askGemini(prompt, imageBase64 = null) {
  const body = {
    contents: [
      {
        parts: imageBase64
          ? [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: imageBase64
                }
              }
            ]
          : [{ text: prompt }]
      }
    ]
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// OCR Route
app.post("/scan", async (req, res) => {
  const image = req.body.image || "";

  try {
    const prompt = `Lies den gesamten Text aus diesem Bild aus.

WICHTIG:
- Antworte nur mit dem erkannten Text
- Keine Erklärung
- Keine Zusammenfassung
- Keine Übersetzung
- Sprache des Bildes nicht verändern
- Wenn kaum Text lesbar ist, schreibe genau:
TEXT NICHT KLAR ERKENNBAR`;

    const text = await askGemini(prompt, image);
    res.send(text || "TEXT NICHT KLAR ERKENNBAR");

  } catch (err) {
    console.log("FEHLER:", err);
    res.send("TEXT NICHT KLAR ERKENNBAR");
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
