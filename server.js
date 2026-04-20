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
        ok: false,
        error: "Kein Text gesendet"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "GEMINI_API_KEY fehlt auf dem Server"
      });
    }

    const prompt = `
Erkläre diesen Brief ganz einfach in normalem, natürlichem Deutsch.

Schreibe wie ein Mensch.
Keine Überschriften.
Keine Aufzählung.
Einfach erklären, was der Brief sagt und was die Person jetzt tun muss.

Brief:
${text}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
      console.error("Gemini Fehler:", data);

      return res.status(response.status).json({
        ok: false,
        error:
          data?.error?.message ||
          "Gemini API Fehler"
      });
    }

    const result =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!result) {
      console.error("Gemini leere Antwort:", data);

      return res.status(500).json({
        ok: false,
        error: "Keine Antwort von Gemini erhalten"
      });
    }

    return res.json({
      ok: true,
      result
    });
  } catch (error) {
    console.error("Serverfehler:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Unbekannter Serverfehler"
    });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
