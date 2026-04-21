const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const apiKey = process.env.GEMINI_API_KEY;
const MODEL = "gemini-2.5-flash";

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server läuft sauber" });
});

async function callGemini(parts) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY fehlt auf dem Server");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: parts
          }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini Fehler:", data);
    throw new Error(data?.error?.message || "Gemini API Fehler");
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim() || "";

  if (!text) {
    throw new Error("Keine Antwort von Gemini erhalten");
  }

  return text;
}

app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Kein Brieftext gesendet"
      });
    }

    const prompt = `
Du siehst ein Foto von einem Brief oder Dokument aus Deutschland.

Deine Aufgabe:
Lies den Brief so genau wie möglich und erkläre ihn dann sehr einfach, klar, direkt und menschlich.

Wichtig:
- Verwende nur Informationen, die auf dem Bild wirklich lesbar sind.
- Erfinde nichts dazu.
- Vermute nichts, wenn etwas unklar ist.
- Wenn ein Wort oder Satz nicht sicher lesbar ist, sag klar: "Ein Teil des Briefes ist auf dem Bild nicht gut lesbar."
- Wenn ein Begriff im Brief rechtlich oder inhaltlich wichtig ist, gib ihn in der Bedeutung korrekt wieder.
- Deute nichts um.
- Bleib so nah wie möglich am echten Inhalt des Briefes.

Schreibe:
- auf Deutsch
- in sehr einfachen, normalen Sätzen
- wie ein echter Mensch
- ohne Überschriften
- ohne Aufzählung mit 1., 2., 3.
- ohne Markdown
- ohne Einleitung wie "Gerne helfe ich dir"
- ohne unnötige Wiederholungen
- ohne Fachsprache, wenn es einfacher geht
- ohne Beamtendeutsch, wenn es einfacher geht

Die Erklärung soll als normaler Fließtext klar sagen:
- worum es in dem Brief geht
- was die Person jetzt tun muss
- welche Unterlagen, Nachweise, Termine oder Antworten verlangt werden
- bis wann etwas erledigt werden muss
- was passiert, wenn die Person nichts macht

Ganz wichtig:
- Wenn der Brief eine Frist enthält, nenne sie genau.
- Wenn der Brief nur Kopien verlangt, sag klar: nur Kopien, keine Originale.
- Wenn Geld, Leistungen, Wohnung, Antrag, Vertrag, Mahnung, Gericht, Jugendamt, Krankenkasse oder Jobcenter betroffen sind, sag das klar und einfach.
- Wenn mehrere Dinge verlangt werden, erkläre sie in einfacher Reihenfolge.
- Wenn eine Folge im Brief nur vorsichtig formuliert ist, übertreibe sie nicht.
- Schreibe nur das als sicher, was wirklich aus dem Brief hervorgeht.

Stil:
Die Antwort soll ruhig, hilfreich, klar und menschlich klingen.
Nicht künstlich.
Nicht trocken.
Nicht übertrieben.
Nicht wie vom Amt.

Ganz am Ende schreibe immer genau einen kurzen Abschlusssatz mit:
"Du musst jetzt nur ..."
Dieser letzte Satz soll in einem einzigen kurzen Satz ganz konkret sagen, was jetzt zu tun ist.
`;

    const erklaerung = await callGemini([{ text: prompt }]);

    res.json({
      ok: true,
      erklaerung: erklaerung
    });
  } catch (error) {
    console.error("Fehler /api/brief:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Serverfehler"
    });
  }
});

app.post("/api/brief-bild", async (req, res) => {
  try {
    const imageData = req.body.imageData;
    const mimeType = req.body.mimeType;

    if (!imageData || !mimeType) {
      return res.status(400).json({
        ok: false,
        error: "Kein Bild gesendet"
      });
    }

    const prompt = `
Du siehst ein Foto von einem Brief oder Dokument aus Deutschland.

Deine Aufgabe:
Lies den Brief so gut wie möglich und erkläre ihn dann extrem einfach, klar, direkt und menschlich.

Wichtig:
- Verwende nur Informationen, die auf dem Bild wirklich lesbar sind.
- Erfinde nichts dazu.
- Wenn etwas nicht gut lesbar ist, sag klar: "Ein Teil des Briefes ist auf dem Bild nicht gut lesbar."
- Schreibe auf Deutsch.
- Schreibe sehr einfach.
- Kein Beamtendeutsch.
- Keine Fachsprache.
- Keine Überschriften.
- Keine Aufzählungen mit 1., 2., 3.
- Kein Markdown.
- Keine Einleitung wie "Gerne helfe ich dir".
- Keine Wiederholungen.
- Keine unnötigen Sätze.

Die Erklärung soll als normaler Text sagen:
- Worum es in dem Brief geht
- Was jetzt gemacht werden muss
- Ob Unterlagen, Geld, Antwort oder ein Termin wichtig sind
- Bis wann etwas erledigt werden muss
- Was passiert, wenn man nichts macht

Wenn es ein wichtiger Termin, eine Frist, ein Gericht, Jugendamt, Jobcenter, Krankenkasse, Kündigung, Mahnung oder Vertrag ist, sag das klar und deutlich.

Ganz am Ende schreibe immer noch einen ganz kurzen Abschlusssatz:
"Du musst jetzt nur ..."
`;

    const erklaerung = await callGemini([
      { text: prompt },
      {
        inline_data: {
          mime_type: mimeType,
          data: imageData
        }
      }
    ]);

    res.json({
      ok: true,
      erklaerung: erklaerung
    });
  } catch (error) {
    console.error("Fehler /api/brief-bild:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Serverfehler"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
