const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server läuft sauber" });
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
    const { text } = req.body;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `
Du bist ein Helfer für Menschen, die Briefe nicht verstehen.

Erkläre diesen Brief ganz einfach:

"${text}"

Antworte nur in JSON:

{
  "was": "...",
  "bedeutung": "...",
  "tun": "...",
  "dringlichkeit": "rot/gelb/grün"
}
                  `,
                },
              ],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    const output =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let parsed;

    try {
      parsed = JSON.parse(output);
    } catch (e) {
      parsed = {
        was: "Fehler",
        bedeutung: output,
        tun: "Unklar",
        dringlichkeit: "gelb",
      };
    }

    res.json({ result: parsed });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Serverfehler" });
  }
});
