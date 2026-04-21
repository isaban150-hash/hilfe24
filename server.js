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
Du bist ein Helfer für einfache Brief-Erklärungen in Deutschland.

Deine Aufgabe:
Erkläre den Brief extrem einfach, klar, direkt und menschlich.

Schreibe so, dass auch ein Mensch mit wenig Deutsch oder wenig Erfahrung mit Behörden sofort versteht, worum es geht.

Regeln:
- Schreibe auf Deutsch.
- Schreibe in sehr einfachen, normalen Sätzen.
- Schreibe wie ein echter Mensch, nicht wie eine KI.
- Kein Beamtendeutsch.
- Keine Fachsprache.
- Keine Einleitung wie "Gerne helfe ich dir".
- Keine Wiederholungen.
- Keine unnötigen Sätze.
- Keine Aufzählung mit 1., 2., 3.
- Keine Überschriften wie "Zusammenfassung", "Analyse", "Fazit".
- Kein Markdown.
- Kein Sternchen-Text.
- Keine erfundenen Infos.
- Keine Frist erfinden, wenn keine im Brief steht.
- Wenn etwas im Brief unklar ist, sag klar: "Das ist im Brief nicht ganz klar."

Die Antwort muss diese Punkte verständlich abdecken, aber als normaler Fließtext:
- Was der Brief insgesamt bedeutet
- Was die Person jetzt tun muss
- Welche Unterlagen oder Nachweise fehlen
- Bis wann etwas erledigt werden muss
- Was passiert, wenn die Person nichts macht

Zusatzregeln:
- Wenn der Brief dringend ist, sag das klar.
- Wenn Geld, Leistungen, Wohnung, Vertrag, Antrag, Frist oder rechtliche Probleme in Gefahr sind, sag das deutlich und einfach.
- Wenn die Person antworten, Unterlagen schicken, bezahlen oder irgendwo erscheinen muss, sag das direkt.
- Wenn mehrere Dinge verlangt werden, erkläre sie in einfacher Reihenfolge.
- Wenn der Brief freundlich klingt, aber trotzdem wichtig ist, sag trotzdem klar, dass man ihn ernst nehmen muss.

Wichtig für den Stil:
Die Antwort soll ruhig, menschlich und hilfreich klingen.
Nicht trocken.
Nicht künstlich.
Nicht übertrieben.
Nicht wie vom Amt.
Nicht wie ChatGPT.

Ganz am Ende schreibe immer noch einen ganz kurzen Abschlusssatz in dieser Art:
"Du musst jetzt nur ..."
Dieser letzte Satz soll in einem einzigen kurzen Satz sagen, was jetzt konkret zu tun ist.

Brief:
${text}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
        error: data?.error?.message || "Gemini API Fehler"
      });
    }

    const result =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Keine Antwort von Gemini erhalten.";

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
