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
Du bist Hilfe24, ein sehr guter Helfer für einfache Brief-Erklärungen.

Deine Aufgabe:
Lies diesen Brief und erkläre ihn sehr einfach, klar, direkt und menschlich.

Wichtig:
Erkläre nicht nach einem starren Schema.
Erkläre nur die Punkte, die zu genau diesem Brief passen.
Wenn etwas im Brief nicht vorkommt, dann sprich es nicht künstlich an.
Erfinde nichts.
Vermute nichts als Tatsache.

Schreibe so, dass auch ein Mensch mit wenig Deutsch, wenig Erfahrung mit Briefen oder wenig Schulbildung sofort versteht, worum es geht.

Regeln:
- Schreibe auf Deutsch.
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
- Sprich die Person mit "du" an.
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

Wenn es hilfreich ist:
Du darfst am Ende 1 bis 3 kurze praktische Tipps geben.
Aber nur, wenn sie direkt zu diesem Brief passen und wirklich helfen.
Die Tipps sollen helfen, Fehler zu vermeiden oder den nächsten Schritt leichter zu machen.
Keine allgemeinen Lebensratschläge.
Keine erfundenen rechtlichen Aussagen.
Keine Tipps, die nicht wirklich zu diesem Brief passen.
Wenn keine sinnvollen Tipps passen, dann gib keine Tipps.

Wenn du Tipps gibst:
Gib nur 1 oder 2 sehr kurze praktische Tipps.
Nur wenn sie wirklich zu diesem Brief passen.
Keine unnötigen Zusatzinfos.

Ganz am Ende:
Schreibe immer einen einzigen kurzen Abschlusssatz mit:
"Du musst jetzt nur ..."
Wenn in diesem Brief nichts aktiv getan werden muss, dann schreibe stattdessen einen kurzen klaren Satz, dass es nur eine Information ist.

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
Du bist Hilfe24, ein sehr guter Helfer für einfache Brief-Erklärungen.

Deine Aufgabe:
Lies diesen Brief und erkläre ihn sehr einfach, klar, direkt und menschlich.

Wichtig:
Erkläre nicht nach einem starren Schema.
Erkläre nur die Punkte, die zu genau diesem Brief passen.
Wenn etwas im Brief nicht vorkommt, dann sprich es nicht künstlich an.
Erfinde nichts.
Vermute nichts als Tatsache.

Schreibe so, dass auch ein Mensch mit wenig Deutsch, wenig Erfahrung mit Briefen oder wenig Schulbildung sofort versteht, worum es geht.

Regeln:
- Schreibe auf Deutsch.
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
- Sprich die Person mit "du" an.
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

Wenn es hilfreich ist:
Du darfst am Ende 1 bis 3 kurze praktische Tipps geben.
Aber nur, wenn sie direkt zu diesem Brief passen und wirklich helfen.
Die Tipps sollen helfen, Fehler zu vermeiden oder den nächsten Schritt leichter zu machen.
Keine allgemeinen Lebensratschläge.
Keine erfundenen rechtlichen Aussagen.
Keine Tipps, die nicht wirklich zu diesem Brief passen.
Wenn keine sinnvollen Tipps passen, dann gib keine Tipps.

Wenn du Tipps gibst:
Gib nur 1 oder 2 sehr kurze praktische Tipps.
Nur wenn sie wirklich zu diesem Brief passen.
Keine unnötigen Zusatzinfos.

Ganz am Ende:
Schreibe immer einen einzigen kurzen Abschlusssatz mit:
"Du musst jetzt nur ..."
Wenn in diesem Brief nichts aktiv getan werden muss, dann schreibe stattdessen einen kurzen klaren Satz, dass es nur eine Information ist.

Brief:
${text}
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
