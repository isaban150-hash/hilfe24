const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server laeuft sauber" });
});

app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text) {
      return res.status(400).json({ error: "Kein Text gesendet" });
    }

    const antwort = `Erklaerung:

Das Jobcenter sagt:
- Deine Unterlagen wurden geprueft
- Es fehlen noch:
  - Kontoauszuege der letzten 3 Monate
  - Mietvertrag

Was du tun musst:
Reiche die Unterlagen bis spaetestens 30.04.2026 ein.

Wenn du nichts schickst:
Dein Antrag kann nicht weiter bearbeitet werden.`;

    res.json({ result: antwort });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server Fehler" });
  }
});
app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text) {
      return res.status(400).json({ error: "Kein Text gesendet" });
    }

    const prompt = `
Du bist ein Helfer für Menschen, die Briefe nicht verstehen.

Erkläre diesen Brief in sehr einfachem Deutsch.

Antworte in genau diesem Format:

Erklaerung:

Das sagt der Brief:
...

Was bedeutet das:
...

Was du tun musst:
...

Wie dringend ist das:
...

Hier ist der Brief:
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
              parts: [
                {
                  text: prompt
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
      "Keine Antwort von Gemini erhalten.";

    res.json({ result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server Fehler" });
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server laeuft auf Port " + PORT);
});
