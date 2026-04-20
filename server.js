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

    if (!text || !text.trim()) {
      return res.status(400).json({
        error: "Kein Brieftext gesendet"
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY fehlt"
      });
    }

    const prompt = `
Du bist ein Helfer für Menschen, die Briefe nicht verstehen.

Erkläre diesen Brief in einfachem Deutsch.

Brief:
${text}

Antworte NUR als JSON in genau diesem Format:

{
  "was": "Was ist das für ein Brief?",
  "bedeutung": "Was bedeutet der Brief einfach erklärt?",
  "tun": "Was muss die Person jetzt tun?",
  "dringlichkeit": "rot"
}

Nutze bei dringlichkeit nur eines von diesen Wörtern:
rot, gelb, grün
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

    if (!response.ok) {
  console.error("GEMINI FEHLER KOMPLETT:", JSON.stringify(data, null, 2));

  return res.status(500).json({
    error: "Gemini API Fehler",
    details: data
  });
}
      console.error("GEMINI FEHLER:", data);
      return res.status(500).json({
        error: "Gemini API Fehler",
        details: data
      });
    }

    const output =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!output) {
      console.error("GEMINI LEERE ANTWORT:", data);
      return res.status(500).json({
        error: "Keine Antwort von Gemini erhalten"
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(output);
    } catch (e) {
      console.error("JSON PARSE FEHLER:", output);
      parsed = {
        was: "Unklar",
        bedeutung: output,
        tun: "Bitte Antwort prüfen",
        dringlichkeit: "gelb"
      };
    }

    res.json(parsed);
  } catch (error) {
    console.error("SERVERFEHLER:", error);
    res.status(500).json({
      error: "Serverfehler"
    });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
