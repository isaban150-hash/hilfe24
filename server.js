const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
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
Erkläre diesen Brief in einfachem Deutsch.

Bitte antworte in dieser Struktur:

Was ist das?
...
Was wird verlangt?
...
Was musst du tun?
...
Wie dringend ist es?
...

Brief:
${text}
`;

    const response = await fetch(
if (!response.ok) {
  return res.json({
    result: "Fehler von Gemini: " + JSON.stringify(data)
  });
}      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
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

console.log("STATUS:", response.status);
console.log("GEMINI RAW:", JSON.stringify(data, null, 2));


    const result =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text
        ? data.candidates[0].content.parts[0].text
        : "Keine Antwort von Gemini erhalten.";

    res.json({ result });
  } catch (error) {
    console.error("Serverfehler:", error);
    res.status(500).json({ error: "Server Fehler" });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
