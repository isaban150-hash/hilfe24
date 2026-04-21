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
  res.json({ ok:  true, message: "Server läuft sauber" });
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
Du siehst ein oder mehrere Fotos von einem Brief oder Dokument aus Deutschland.

Deine Aufgabe:
Lies alle Bilder zusammen und erkläre den Brief sehr einfach, klar, kurz und menschlich.

Wichtig:
Benutze nur Informationen, die auf den Bildern wirklich lesbar sind.
Erfinde nichts.
Rate nichts.
Wenn etwas fehlt, unscharf oder abgeschnitten ist, sag das offen und klar.

Schreibe so, wie du einem Freund den Brief erklären würdest.
Nicht wie ein Amt.
Nicht wie ein Anwalt.
Nicht wie eine Behörde.
Nicht wie ChatGPT.

Regeln:
- Schreibe auf Deutsch.
- Sprich die Person immer mit "du" an.
- Schreibe nur normalen Fließtext.
- Maximal 6 kurze Sätze.
- Jeder Satz soll leicht verständlich sein.
- Keine Überschriften.
- Keine Listen.
- Keine Aufzählungszeichen.
- Keine Nummerierungen.
- Keine Sternchen.
- Kein Markdown.
- Kein Fettdruck.
- Keine Fachsprache.
- Kein Beamtendeutsch.
- Keine formellen Sätze wie:
  "Dieses Schreiben ..."
  "Es geht darum, dass ..."
  "fordert Sie auf ..."
  "zur Prüfung ..."
  "im Rahmen von ..."
  "für Rückfragen ..."
- Keine Wiederholungen.
- Keine erfundenen Infos.
- Keine Frist nennen, wenn sie nicht klar lesbar ist.

Wenn etwas auf dem Bild nicht gut lesbar ist, schreibe genau:
Ein Teil des Briefes ist auf dem Bild nicht gut lesbar.

Wenn ein wichtiger Teil fehlt, schreibe genau:
Ein wichtiger Teil des Briefes fehlt auf dem Bild.

Wenn mehrere Bilder zu demselben Brief gehören, verbinde die Informationen sinnvoll.

Die Antwort muss immer enthalten:
- worum es im Brief geht
- was du jetzt tun musst
- welche Unterlagen, Termine oder Antworten verlangt werden
- bis wann du etwas machen musst
- was passiert, wenn du nichts machst

Schreibe möglichst in dieser Art:
"Das Jobcenter will noch ..."
"Du sollst jetzt ..."
"Das musst du bis ... machen."
"Wichtig ist: ..."
"Wenn du nichts machst, kann ..."

Wenn nur Kopien verlangt werden, schreibe klar:
nur Kopien, keine Originale

Ganz am Ende schreibe immer genau einen einzigen kurzen Satz mit:
Du musst jetzt nur ...

Bilder:
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
Lies alle Bilder zusammen und erkläre den Brief sehr einfach, klar, kurz und menschlich.

Wichtig:
Benutze nur Informationen, die auf den Bildern wirklich lesbar sind.
Erfinde nichts.
Rate nichts.
Wenn etwas fehlt, unscharf oder abgeschnitten ist, sag das offen und klar.

Schreibe so, wie du einem Freund den Brief erklären würdest.
Nicht wie ein Amt.
Nicht wie ein Anwalt.
Nicht wie eine Behörde.
Nicht wie ChatGPT.

Regeln:
- Schreibe auf Deutsch.
- Sprich die Person immer mit "du" an.
- Schreibe nur normalen Fließtext.
- Maximal 6 kurze Sätze.
- Jeder Satz soll leicht verständlich sein.
- Keine Überschriften.
- Keine Listen.
- Keine Aufzählungszeichen.
- Keine Nummerierungen.
- Keine Sternchen.
- Kein Markdown.
- Kein Fettdruck.
- Keine Fachsprache.
- Kein Beamtendeutsch.
- Keine formellen Sätze wie:
  "Dieses Schreiben ..."
  "Es geht darum, dass ..."
  "fordert Sie auf ..."
  "zur Prüfung ..."
  "im Rahmen von ..."
  "für Rückfragen ..."
- Keine Wiederholungen.
- Keine erfundenen Infos.
- Keine Frist nennen, wenn sie nicht klar lesbar ist.

Wenn etwas auf dem Bild nicht gut lesbar ist, schreibe genau:
Ein Teil des Briefes ist auf dem Bild nicht gut lesbar.

Wenn ein wichtiger Teil fehlt, schreibe genau:
Ein wichtiger Teil des Briefes fehlt auf dem Bild.

Wenn mehrere Bilder zu demselben Brief gehören, verbinde die Informationen sinnvoll.

Die Antwort muss immer enthalten:
- worum es im Brief geht
- was du jetzt tun musst
- welche Unterlagen, Termine oder Antworten verlangt werden
- bis wann du etwas machen musst
- was passiert, wenn du nichts machst

Schreibe möglichst in dieser Art:
"Das Jobcenter will noch ..."
"Du sollst jetzt ..."
"Das musst du bis ... machen."
"Wichtig ist: ..."
"Wenn du nichts machst, kann ..."

Wenn nur Kopien verlangt werden, schreibe klar:
nur Kopien, keine Originale

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
