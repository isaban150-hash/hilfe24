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

function cleanAntwort(text) {
  if (!text) return "";

  return text
    .replace(/Es geht darum, dass\s*/gi, "")
    .replace(/In dem Brief geht es darum, dass\s*/gi, "")
    .replace(/Ganz konkret werden von dir .*?verlangt:\s*/gi, "")
    .replace(/Für Fragen können.*$/gim, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*1\.\s*/gm, "")
    .replace(/^\s*2\.\s*/gm, "")
    .replace(/^\s*3\.\s*/gm, "")
    .replace(/^\s*-\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
Du bist ein sehr guter Helfer für einfache Brief-Erklärungen in Deutschland.

Deine Aufgabe:
Erkläre den Brief extrem einfach, klar, direkt und menschlich.

Schreibe so, dass auch ein Mensch mit wenig Deutsch, wenig Schulbildung oder wenig Erfahrung mit Behörden sofort versteht, worum es geht.

Wichtig:
Benutze nur Informationen, die wirklich im Brief stehen.
Erfinde nichts dazu.
Wenn etwas fehlt oder unklar ist, sage das offen und einfach.

Regeln:
- Schreibe auf Deutsch.
- Schreibe in sehr einfachen, normalen Sätzen.
- Schreibe wie ein echter Mensch, nicht wie eine KI.
- Kein Beamtendeutsch.
- Keine Fachsprache.
- Keine Einleitung wie "Gerne helfe ich dir".
- Keine Wiederholungen.
- Keine unnötigen Sätze.
- Keine Überschriften.
- Keine Aufzählung mit 1., 2., 3.
- Kein Markdown.
- Kein Sternchen-Text.
- Keine erfundenen Infos.
- Keine Frist erfinden, wenn keine im Brief steht.
- Wenn etwas im Brief nicht ganz klar ist, sage klar: "Das ist im Brief nicht ganz klar."

Die Antwort soll als normaler Fließtext diese Punkte abdecken:
- Was der Brief insgesamt bedeutet
- Was die Person jetzt tun muss
- Welche Unterlagen, Nachweise, Termine oder Antworten verlangt werden
- Bis wann etwas erledigt werden muss
- Was passiert, wenn die Person nichts macht

Zusatzregeln:
- Wenn der Brief dringend ist, sag das klar.
- Wenn Geld, Leistungen, Wohnung, Vertrag, Antrag, Frist, Mahnung, Gericht, Jugendamt, Krankenkasse oder Jobcenter betroffen sind, sag das deutlich und einfach.
- Wenn die Person etwas schicken, zahlen, erscheinen, anrufen oder antworten muss, sag das direkt.
- Wenn mehrere Dinge verlangt werden, erkläre sie in einfacher Reihenfolge.
- Wenn der Brief freundlich klingt, aber trotzdem wichtig ist, sag trotzdem klar, dass man ihn ernst nehmen muss.
- Wenn der Brief nur Kopien verlangt, sag klar: nur Kopien, keine Originale.

Stil:
Die Antwort soll ruhig, menschlich, hilfreich und natürlich klingen.
Nicht trocken.
Nicht künstlich.
Nicht übertrieben.
Nicht wie vom Amt.
Nicht wie ChatGPT.

Ganz am Ende schreibe immer genau einen kurzen Abschlusssatz mit:
"Du musst jetzt nur ..."

Brief:
${text}
`;

    const raw = await callGemini([{ text: prompt }]);
    const erklaerung = cleanAntwort(raw);

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
Lies alle Bilder zusammen und erkläre den Brief extrem einfach, kurz, klar und menschlich.

Regeln:
- Schreibe auf Deutsch.
- Schreibe so, wie du mit einem normalen Menschen sprichst.
- Schreibe mit "du", nie mit "Sie".
- Schreibe sehr einfach.
- Keine Fachsprache.
- Kein Beamtendeutsch.
- Keine Überschriften.
- Keine Einleitung.
- Keine Aufzählung mit 1., 2., 3.
- Keine Sternchen.
- Keine Wiederholungen.
- Keine unnötigen Sätze.
- Kein Satz wie: "Im Brief steht, dass ..."
- Kein Satz wie: "Ihr Ansprechpartner ist ..."
- Nenne nur Dinge, die für die Person wirklich wichtig sind.
- Wenn nur Kopien verlangt werden, sag klar: nur Kopien, keine Originale.
- Wenn eine Frist drinsteht, sag sie klar.
- Wenn etwas passieren kann, sag es klar und direkt.
- Wenn etwas auf dem Bild fehlt oder nicht lesbar ist, sag das offen.
- Erfinde nichts dazu.

Wenn etwas auf dem Bild nicht gut lesbar ist, schreibe genau:
Ein Teil des Briefes ist auf dem Bild nicht gut lesbar.

Wenn ein wichtiger Teil fehlt, schreibe genau:
Ein wichtiger Teil des Briefes fehlt auf dem Bild.

Wenn mehrere Bilder zu demselben Brief gehören, verbinde die Informationen sinnvoll.

Die Antwort soll in normalem Fließtext sein und genau diese Punkte enthalten:
- Was der Brief bedeutet
- Was die Person jetzt tun muss
- Bis wann
- Was passiert, wenn sie nichts macht

Ganz am Ende schreibe immer genau einen einzigen kurzen Satz.
Dieser Satz muss die echten Unterlagen und die echte Frist aus dem Brief enthalten.
Schreibe nie allgemeine Wörter wie "Stichtag", wenn im Brief ein genaues Datum steht.
Beispiel:
Du musst jetzt nur die Abmeldung von Asen und den Einstellungsbescheid für das Kindergeld bis zum 23.01.2026 als Kopie einreichen.

Bilder:
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

    const raw = await callGemini(parts);
    const erklaerung = cleanAntwort(raw);

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
