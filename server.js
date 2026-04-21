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
