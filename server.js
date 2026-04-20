const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

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
  const text = req.body.text;
  const API_KEY = process.env.GEMINI_API_KEY;

  if (!text) {
    return res.json({ result: "Bitte füge einen Brief ein." });
  }

  try {
   
      `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Erkläre diesen Brief extrem einfach.

Struktur:
1. Was ist das?
2. Was bedeutet das?
3. Was musst du tun?
4. Dringlichkeit (Grün, Gelb oder Rot)

Kurze Sätze. Keine Fachwörter.

Brief:
${text}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    const result =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Ich konnte den Brief nicht verstehen.";

    res.json({ result });
  } catch (error) {
    res.json({ result: "Fehler bei der Verarbeitung." });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
