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

app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text) {
      return res.status(400).json({ error: "Kein Text gesendet" });
    }

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
                  text: `Erkläre diesen Brief einfach:\n\n${text}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return res.status(500).json({
        error: "Gemini API Fehler"
      });
    }

    const output =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "Keine Antwort";

    res.json({
      was: "Brief vom Amt",
      bedeutung: output,
      tun: "Bitte lesen und ggf. Unterlagen einreichen",
      dringlichkeit: "gelb"
    });

  } catch (err) {
    console.error("SERVER FEHLER:", err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
