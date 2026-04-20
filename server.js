const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/erklaeren", async (req, res) => {
  try {
    const { text } = req.body;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
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
`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    const output =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let parsed;

    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = {
        was: "Fehler",
        bedeutung: output,
        tun: "Unklar",
        dringlichkeit: "gelb"
      };
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

app.listen(3000, () => {
  console.log("Server läuft auf Port 3000");
});
