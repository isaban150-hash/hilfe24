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
                    "Struktur:\n" +
                    "1. Was ist das?\n" +
                    "2. Was bedeutet das?\n" +
                    "3. Was musst du tun?\n" +
                    "4. Dringlichkeit (Grün, Gelb oder Rot)\n\n" +
                    "Kurze Sätze. Keine Fachwörter.\n\n" +
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
