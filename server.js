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
  const apiKey = process.env.GEMINI_API_KEY;

  if (!text) {
    return res.json({ result: "Bitte füge einen Brief ein." });
  }

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=" + apiKey,
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
                  text:
  "Erkläre diesen Brief extrem einfach.\n\n" +
  "Antworte GENAU in diesem Format:\n\n" +
  "WAS_IST_DAS: ...\n" +
  "WAS_BEDEUTET_DAS: ...\n" +
  "WAS_MUSST_DU_TUN: ...\n" +
  "DRINGLICHKEIT: Grün, Gelb oder Rot\n\n" +
  "Regeln:\n" +
  "- sehr einfache Sprache\n" +
  "- kurze Sätze\n" +
  "- keine Fachwörter\n" +
  "- pro Punkt nur 1 bis 3 kurze Sätze\n" +
  "- bei DRINGLICHKEIT nur Grün, Gelb oder Rot schreiben\n\n" +
  "Brief:\n" +
  text
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    const result =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Ich konnte den Brief nicht verstehen.";

    res.json({ result });
  } catch (error) {
    console.error(error);
    res.json({ result: "Fehler bei der Verarbeitung." });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
