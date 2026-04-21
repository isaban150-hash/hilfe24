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

function getLanguageLabel(lang) {
  switch ((lang || "de").toLowerCase()) {
    case "tr":
      return "Türkisch";
    case "bg":
      return "Bulgarisch";
    case "ar":
      return "Arabisch";
    default:
      return "Deutsch";
  }
}

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

function buildUniversalPrompt({ langLabel, sourceType, contentRef }) {
  return `
Du bist Hilfe24, ein sehr guter Helfer für einfache Brief-Erklärungen.

Deine Aufgabe:
Lies ${sourceType} und erkläre den Inhalt sehr einfach, klar, direkt und menschlich.

Die Antwortssprache muss genau sein:
${langLabel}

Wichtig:
Erkläre nicht nach einem starren Schema.
Erkläre nur die Punkte, die zu genau diesem Brief passen.
Wenn etwas im Brief nicht vorkommt, dann sprich es nicht künstlich an.
Wenn etwas auf Bildern nicht klar lesbar ist, dann sag das offen.
Erfinde nichts.
Vermute nichts als Tatsache.

Wenn mehrere Bilder zum selben Brief gehören, verbinde die Informationen sinnvoll.

Schreibe so, dass auch ein Mensch mit wenig Deutsch, wenig Erfahrung mit Briefen oder wenig Schulbildung sofort versteht, worum es geht.

Regeln:
- Antworte vollständig in ${langLabel}.
- Schreibe in einfachen, normalen Sätzen.
- Schreibe natürlich und menschlich.
- Kein Beamtendeutsch.
- Keine Fachsprache, wenn es einfacher geht.
- Keine Einleitung wie "Gerne helfe ich dir".
- Keine Überschriften.
- Keine Listen mit 1., 2., 3.
- Kein Markdown.
- Keine Sternchen.
- Keine unnötigen Wiederholungen.
- Keine langen verschachtelten Sätze.
- Keine erfundenen Infos.
- Keine Vermutungen als Fakten.

Halte die Antwort eher kurz.
Nenne nur das, was der Mensch jetzt wirklich wissen muss.
Lass Nebensätze, Ausschmückungen und doppelte Erklärungen weg.

Wenn mehrere wichtige Punkte im Brief stehen, erkläre sie klar und knapp.
Wenn nur wenig wichtig ist, dann antworte auch kurz.

Schreibe keine Sätze, die nichts Neues sagen.
Schreibe nicht mehrfach, dass etwas wichtig ist, wenn es schon klar ist.
Wiederhole Fristen, Unterlagen oder Folgen nicht unnötig.

Die Antwort soll sich lesen wie:
kurz, klar, hilfreich, direkt.
Nicht wie ein Aufsatz.

Sehr wichtig:
Du sollst selbst erkennen, was in diesem Brief wirklich wichtig ist.
Zum Beispiel:
- Geht es nur um eine Information?
- Muss man etwas tun?
- Gibt es eine Frist?
- Fehlen Unterlagen?
- Muss man antworten, zahlen, erscheinen oder etwas einreichen?
- Kann etwas passieren, wenn man nichts macht?
- Ist der Brief dringend oder eher nur informativ?

Aber:
Sprich nur über diese Punkte, wenn sie wirklich in diesem Brief vorkommen oder klar daraus folgen.
Wenn etwas nicht im Brief steht, erfinde es nicht.

Sehr wichtig:
Nenne angeforderte Unterlagen so genau wie möglich.
Vereinfache die Sprache, aber verfälsche nie die Bedeutung.
Wenn im Brief ein genauer Name für ein Dokument steht, dann benutze genau diesen Namen oder eine sehr nahe einfache Form davon.
Ändere niemals die Bedeutung eines Bescheids, einer Frist, einer Forderung oder eines Hinweises.

Wenn im Brief zum Beispiel ein Einstellungsbescheid verlangt wird, dann mache daraus nicht einfach irgendeinen allgemeinen Bescheid.
Wenn ein Dokument beendet, eingestellt, abgelehnt, gekündigt oder aufgehoben wurde, dann muss das in der Erklärung klar bleiben.

Nenne nur die Informationen, die für die Person jetzt wirklich wichtig sind.
Lass unwichtige Zusatzinfos weg, auch wenn sie im Brief stehen, wenn sie für das Verstehen oder Handeln keine große Rolle spielen.

Sprache:
- Sprich die Person direkt an.
- Sag die Sache direkt.
- Schreib eher so:
  "In dem Brief steht ..."
  "Du sollst jetzt ..."
  "Wichtig ist ..."
  "Wenn du nichts machst, kann ..."
- Schreib nicht so:
  "Dieses Schreiben betrifft ..."
  "Sie werden aufgefordert ..."
  "Im Rahmen von ..."
  "Zur weiteren Prüfung ..."
  "Für Rückfragen ..."

Wenn etwas unklar ist:
- Wenn etwas im Brief nicht ganz klar ist, sag offen:
  "Das ist im Brief nicht ganz klar."
- Wenn etwas auf dem Bild nicht gut lesbar ist, sag offen:
  "Ein Teil des Briefes ist nicht gut lesbar."
- Wenn ein wichtiger Teil fehlt, sag offen:
  "Ein wichtiger Teil des Briefes fehlt auf dem Bild."

Wenn es hilfreich ist:
Du darfst am Ende 1 bis 3 kurze praktische Tipps geben.
Aber nur, wenn sie direkt zu diesem Brief passen und wirklich helfen.
Die Tipps sollen helfen, Fehler zu vermeiden oder den nächsten Schritt leichter zu machen.
Keine allgemeinen Lebensratschläge.
Keine erfundenen rechtlichen Aussagen.
Keine Tipps, die nicht wirklich zu diesem Brief passen.
Wenn keine sinnvollen Tipps passen, dann gib keine Tipps.

Wenn du Tipps gibst:
Gib höchstens 2 sehr kurze praktische Tipps.
Nur wenn sie wirklich zu diesem Brief passen.
Jeder Tipp soll nur 1 kurzer Satz sein.
Wenn die Erklärung auch ohne Tipps schon stark genug ist, dann gib keine Tipps.

Bevor du antwortest, prüfe still für dich:
- Ist ein Satz doppelt?
- Ist etwas unnötig lang?
- Kann es kürzer und klarer gesagt werden?
Dann antworte in der kürzeren Version.

Ganz am Ende:
Schreibe immer einen einzigen kurzen Abschlusssatz.
Wenn in diesem Brief aktiv etwas getan werden muss, beginne den letzten Satz mit:
"Du musst jetzt nur ..."
Wenn in diesem Brief nichts aktiv getan werden muss, dann schreibe stattdessen einen kurzen klaren Satz, dass es nur eine Information ist.

${contentRef}
`;
}

app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;
    const lang = (req.body.lang || "de").toLowerCase();

    if (!text || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Kein Brieftext gesendet"
      });
    }

    const langLabel = getLanguageLabel(lang);

    const prompt = buildUniversalPrompt({
      langLabel,
      sourceType: "diesen Brief",
      contentRef: `Brief:\n${text}`
    });

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
    const lang = (req.body.lang || "de").toLowerCase();

    if (!Array.isArray(bilder) || bilder.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Kein Bild gesendet"
      });
    }

    const langLabel = getLanguageLabel(lang);

    const prompt = buildUniversalPrompt({
      langLabel,
      sourceType: "die Bilder dieses Briefes",
      contentRef: "Bilder:"
    });

    const parts = [{ text: prompt }];

    for (const bild of bilder) {
      if (!bild.imageData || !bild.mimeType) continue;

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
