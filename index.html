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
            parts
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

    const erklaerung = await callGemini([{ text: prompt }]);

    return res.json({
      ok: true,
      erklaerung
    });
  } catch (error) {
    console.error("Fehler /api/brief:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Serverfehler"
    });
  }
});

app.post("/api/brief-bild", async (req, res) => {
  try {
    const bilder = req.body.bilder;

    if (!Array.isArray(bilder) || bilder.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Kein Bild gesendet"
      });
    }

    const prompt = `
Du siehst ein oder mehrere Fotos von einem Brief oder Dokument aus Deutschland.

Deine Aufgabe:
Lies alle Bilder zusammen als einen einzigen Brief, wenn sie zusammengehören, und erkläre den Inhalt dann sehr einfach, klar, direkt und menschlich.

Wichtig:
- Verwende nur Informationen, die auf den Bildern wirklich lesbar sind.
- Erfinde nichts dazu.
- Vermute nichts, wenn etwas unklar ist.
- Wenn ein Teil fehlt oder nicht gut lesbar ist, sag das klar.
- Wenn mehrere Seiten zu demselben Brief gehören, verbinde die Informationen sinnvoll.
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
- was passiert, wenn man nichts macht

Ganz wichtig:
- Wenn der Brief eine Frist enthält, nenne sie genau.
- Wenn der Brief nur Kopien verlangt, sag klar: nur Kopien, keine Originale.
- Wenn Geld, Leistungen, Wohnung, Antrag, Vertrag, Mahnung, Gericht, Jugendamt, Krankenkasse oder Jobcenter betroffen sind, sag das klar und einfach.
- Wenn mehrere Dinge verlangt werden, erkläre sie in einfacher Reihenfolge.
- Wenn nur eine Folgeseite zu sehen ist, sag klar, dass wichtige Infos fehlen können.
- Schreibe nur das als sicher, was wirklich aus den Bildern hervorgeht.

Stil:
Die Antwort soll ruhig, hilfreich, klar und menschlich klingen.
Nicht künstlich.
Nicht trocken.
Nicht übertrieben.
Nicht wie vom Amt.

Ganz am Ende schreibe immer genau einen kurzen Abschlusssatz mit:
"Du musst jetzt nur ..."
`;

    const parts = [{ text: prompt }];

    for (const bild of bilder) {
      if (!bild.imageData || !bild.mimeType) {
        continue;
      }

      parts.push({
        inline_data: {
          mime_type: bild.mimeType,
          data: bild.imageData
        }
      });
    }

    const erklaerung = await callGemini(parts);

    return res.json({
      ok: true,
      erklaerung
    });
  } catch (error) {
    console.error("Fehler /api/brief-bild:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Serverfehler"
    });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
