const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server läuft sauber" });
});

app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text) {
      return res.status(400).json({ error: "Kein Text gesendet" });
    }

    const prompt = `
Erkläre diesen Brief ganz einfach in normalem Text.

Schreibe wie ein Mensch.
Keine Überschriften.
Keine Aufzählung.
Einfach erklären, was der Brief sagt und was die Person machen soll.

Brief:
${text}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log("Gemini Fehler:", data);
      return res.status(500).json({
        error: "Gemini API Fehler",
        details: data
      });
    }

    const result =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Keine Antwort von Gemini erhalten.";

    res.json({ result });

  } catch (err) {
    console.error("Serverfehler:", err);
    res.status(500).json({ error: "Server Fehler" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
