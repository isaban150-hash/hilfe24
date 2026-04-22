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

function getLanguageMeta(lang) {
  switch ((lang || "de").toLowerCase()) {
    case "tr":
      return {
        code: "tr",
        label: "Türkisch",
        instruction: `
Übersetze den deutschen Basistext in natürliches, leicht verständliches Türkisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an der Bedeutung des deutschen Textes.
Ändere keine Bedeutung.
Formuliere vorsichtig.
Mache aus Zielen, Planungen oder Unterstützungsangeboten keine festen Pflichten.
Wenn etwas im Deutschen neutral formuliert ist, muss es auch im Türkischen neutral bleiben.
Wenn etwas nicht sicher ist, darf es nicht als sichere Tatsache erscheinen.
Türkische Sätze sollen möglichst einfach, direkt und alltagstauglich klingen.
Vermeide unnötig formelle Wörter wie "rica olunur" oder zu amtliche Wörter, wenn es einfacher gesagt werden kann.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        instruction: `
Übersetze den deutschen Basistext in natürliches, leicht verständliches Bulgarisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an der Bedeutung des deutschen Textes.
Ändere keine Bedeutung.
`
      };
    case "ar":
      return {
        code: "ar",
        label: "Arabisch",
        instruction: `
Übersetze den deutschen Basistext in natürliches, leicht verständliches Arabisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an der Bedeutung des deutschen Textes.
Ändere keine Bedeutung.
`
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        instruction: `
Gib den Basistext in natürlichem, sehr einfachem Deutsch aus.
`
      };
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
        contents: [{ parts }]
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
    .replace(/\*\*/g, "")
    .replace(/^\s*1\.\s*/gm, "")
    .replace(/^\s*2\.\s*/gm, "")
    .replace(/^\s*3\.\s*/gm, "")
    .replace(/^\s*-\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Konnte keine JSON-Antwort lesen");
  }
  return JSON.parse(match[0]);
}

function normalizeInfo(info) {
  return {
    absender: info.absender || "",
    briefart: info.briefart || "",
    worum_geht_es: info.worum_geht_es || "",
    was_ist_zu_tun: Array.isArray(info.was_ist_zu_tun) ? info.was_ist_zu_tun : [],
    frist: info.frist || "",
    termin: info.termin || "",
    folge_wenn_nichts: info.folge_wenn_nichts || "",
    dringlichkeit: info.dringlichkeit || "",
    versteckte_wichtige_info: info.versteckte_wichtige_info || "",
    unsicherheiten: Array.isArray(info.unsicherheiten) ? info.unsicherheiten : [],
    abschlusssatz: info.abschlusssatz || ""
  };
}

function buildExtractionPromptForText(text) {
  return `
Du bist Hilfe24.

Deine Aufgabe:
Lies diesen Brief und gib NUR strukturierte Informationen als JSON zurück.

Wichtig:
- Erfinde nichts.
- Wenn etwas nicht klar im Brief steht, lass es leer oder setze es in "unsicherheiten".
- Mache aus einer Möglichkeit keine Pflicht.
- Mache aus einer Nebeninfo nicht den Hauptpunkt.
- Aber: Wenn im Brief konkrete nächste Schritte, Voraussetzungen, Fristen, Termine oder Folgen klar genannt werden, dann müssen sie richtig erkannt werden.
- "versteckte_wichtige_info" darf nur Dinge enthalten, die nicht groß auffallen, aber klar aus dem Brief folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- Gib nur gültiges JSON zurück.

Du sollst genau diese Felder zurückgeben:
{
  "absender": "",
  "briefart": "",
  "worum_geht_es": "",
  "was_ist_zu_tun": [],
  "frist": "",
  "termin": "",
  "folge_wenn_nichts": "",
  "dringlichkeit": "",
  "versteckte_wichtige_info": "",
  "unsicherheiten": [],
  "abschlusssatz": ""
}

Regeln für die Felder:
- "absender": nur wenn klar lesbar oder eindeutig erkennbar
- "briefart": sehr kurz, z. B. "Mahnung", "Rechnung", "Jobcenter-Brief", "Versicherungsbrief", "Jugendamt-Protokoll", "Werbung", "Kündigung", "Rückforderung"
- "worum_geht_es": 1 sehr kurzer Satz
- "was_ist_zu_tun": nur konkrete Handlungen, die im Brief ausdrücklich verlangt werden oder sehr klar daraus folgen
- Dazu zählen auch klar genannte notwendige Schritte wie Anmeldung, Ummeldung, Widerspruch, Einreichen, Melden, Zahlen, Termin wahrnehmen
- Ziele, Wünsche, allgemeine Förderideen, allgemeine Unterstützungsangebote oder bloße Gesprächsinhalte gehören NICHT in "was_ist_zu_tun"
- "frist": nur wenn klar vorhanden
- "termin": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt oder sehr deutlich aus dem Brief folgt
- "dringlichkeit": nur eines von diesen Wörtern: "hoch", "mittel", "niedrig"
- "versteckte_wichtige_info": nur 1 kurzer Satz. Nur dann füllen, wenn eine wichtige Sache leicht übersehen wird, z. B. dass ohne Anmeldung keine Hilfe starten kann, dass Mehrkosten drohen, dass Fristversäumnis Folgen haben kann, dass es nur Werbung ist, dass erstmal nichts getan werden muss
- "unsicherheiten": Dinge, die im Brief nicht ganz klar sind
- "abschlusssatz": immer 1 sehr kurzer Satz in sehr einfachem Deutsch. Wenn nichts aktiv getan werden muss, dann eher: "Du musst jetzt nichts machen." Wenn etwas zu tun ist, dann sehr kurz mit "Du musst jetzt nur ..."

Brief:
${text}
`;
}

function buildExtractionPromptForImages() {
  return `
Du bist Hilfe24.

Deine Aufgabe:
Lies die Bilder dieses Briefes und gib NUR strukturierte Informationen als JSON zurück.

Wichtig:
- Erfinde nichts.
- Wenn etwas nicht klar lesbar oder nicht sicher ist, schreibe es in "unsicherheiten".
- Mache aus einer Möglichkeit keine Pflicht.
- Mache aus einer Nebeninfo nicht den Hauptpunkt.
- Aber: Wenn im Brief konkrete nächste Schritte, Voraussetzungen, Fristen, Termine oder Folgen klar genannt werden, dann müssen sie richtig erkannt werden.
- "versteckte_wichtige_info" darf nur Dinge enthalten, die nicht groß auffallen, aber klar aus dem Brief folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- Gib nur gültiges JSON zurück.

Du sollst genau diese Felder zurückgeben:
{
  "absender": "",
  "briefart": "",
  "worum_geht_es": "",
  "was_ist_zu_tun": [],
  "frist": "",
  "termin": "",
  "folge_wenn_nichts": "",
  "dringlichkeit": "",
  "versteckte_wichtige_info": "",
  "unsicherheiten": [],
  "abschlusssatz": ""
}

Regeln für die Felder:
- "absender": nur wenn klar lesbar oder eindeutig erkennbar
- "briefart": sehr kurz
- "worum_geht_es": 1 sehr kurzer Satz
- "was_ist_zu_tun": nur konkrete Handlungen, die auf den Bildern ausdrücklich verlangt werden oder sehr klar daraus folgen
- Dazu zählen auch klar genannte notwendige Schritte wie Anmeldung, Ummeldung, Widerspruch, Einreichen, Melden, Zahlen, Termin wahrnehmen
- Ziele, Wünsche, allgemeine Förderideen, allgemeine Unterstützungsangebote oder bloße Gesprächsinhalte gehören NICHT in "was_ist_zu_tun"
- "frist": nur wenn klar vorhanden
- "termin": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt oder sehr deutlich aus dem Brief folgt
- "dringlichkeit": nur eines von diesen Wörtern: "hoch", "mittel", "niedrig"
- "versteckte_wichtige_info": nur 1 kurzer Satz. Nur dann füllen, wenn eine wichtige Sache leicht übersehen wird
- "unsicherheiten": Dinge, die nicht ganz klar oder nicht gut lesbar sind
- "abschlusssatz": immer 1 sehr kurzer Satz in sehr einfachem Deutsch

Gib nur JSON zurück.

Bilder:
`;
}

function buildGermanBasePrompt(info) {
  return `
Du bist Hilfe24.

Aus diesen strukturierten Informationen sollst du jetzt eine ultra einfache Erklärung auf Deutsch schreiben.

Sehr wichtig:
- Schreibe so, dass auch Menschen mit wenig Deutsch es schnell verstehen.
- Schreibe sehr kurze Sätze.
- Keine Behördensprache.
- Keine schweren Wörter, wenn es einfacher geht.
- Kein Wort wie "Protokoll", "Maßnahme", "Voraussetzung", "Integration", wenn es einfacher geht.
- Sag direkt, was Sache ist.
- Bleibe extrem nah an den Daten.
- Erfinde nichts.
- Lass alles weg, was nicht sicher ist.
- Mache aus keiner Info eine Pflicht, wenn sie nicht eindeutig in den Daten steht.
- Wenn eine Information nur als Ziel, Planung, Unterstützung oder nächster Schritt beschrieben ist, formuliere sie nicht als harte Pflicht.
- Wiederhole am Ende nicht noch einmal allgemein, dass der Brief etwas zusammenfasst oder informiert.
- Vermeide leere Abschlusssätze ohne echten Nutzen.
- Höchstens 5 sehr kurze Sätze plus 1 letzter kurzer Satz.
- Nenne nur die wichtigsten 1 bis 3 Punkte.
- Lass Nebendetails weg.
- Wenn in "was_ist_zu_tun" klare konkrete Schritte stehen, dann müssen die wichtigsten davon rein.
- Wenn "versteckte_wichtige_info" wichtig ist, dann nenne sie kurz und einfach.

Nutze nur diese Informationen:
${JSON.stringify(info, null, 2)}

Baue die Erklärung so:
- Satz 1: Wer hat den Brief geschickt?
- Satz 2: Was ist das für ein Brief und worum geht es?
- Satz 3: Was musst du jetzt machen?
- Satz 4: Bis wann oder welcher Termin?
- Satz 5: Was passiert, wenn du nichts machst?
- Satz 6: Wenn wichtig, die versteckte wichtige Info
- Dann 1 sehr kurzer letzter Satz

Regeln:
- Wenn etwas fehlt, lass den Satz weg.
- Wenn "was_ist_zu_tun" leer ist, schreibe keinen harten Pflichtsatz.
- Wenn "absender" leer ist, erfinde keinen Absender.
- Wenn "versteckte_wichtige_info" leer ist, lass sie weg.
- Wenn "unsicherheiten" vorhanden sind, nenne sie nicht als Tatsache.
- Wenn etwas nicht sicher ist, lass es lieber weg.

Der letzte Satz muss sehr kurz sein.
Beispiele:
- "Du musst jetzt nur zahlen."
- "Du musst jetzt nur den Termin beachten."
- "Du musst jetzt nur die Unterlagen schicken."
- "Du musst jetzt nichts machen."
- "Du musst jetzt nur prüfen, ob das für dich so passt."
`;
}

function buildTranslationPrompt(germanBase, langMeta) {
  return `
Du bist Hilfe24.

Unten steht ein fertiger deutscher Basistext in sehr einfacher Sprache.
Deine Aufgabe ist nur:
übersetze ihn sauber in ${langMeta.label}.

Wichtig:
${langMeta.instruction}

Regeln:
- Bleibe sehr nah am deutschen Text.
- Erfinde nichts dazu.
- Lass nichts Wichtiges weg.
- Ändere keine Bedeutung.
- Wenn der deutsche Text vorsichtig formuliert ist, muss die Übersetzung auch vorsichtig bleiben.
- Mache aus neutralen Aussagen keine harten Pflichten.
- Halte die Sätze kurz.
- Halte die Sprache einfach.
- Keine zusätzlichen Sätze.
- Keine Ausschmückung.
- Keine Wiederholung.
- Kein Markdown.

Deutscher Basistext:
${germanBase}
`;
}

async function buildFinalAnswerFromText(text, lang) {
  const langMeta = getLanguageMeta(lang);

  const rawJson = await callGemini([
    { text: buildExtractionPromptForText(text) }
  ]);

  const info = normalizeInfo(extractJson(rawJson));

  const germanBaseRaw = await callGemini([
    { text: buildGermanBasePrompt(info) }
  ]);
  const germanBase = cleanAntwort(germanBaseRaw);

  if (langMeta.code === "de") {
    return germanBase;
  }

  const translatedRaw = await callGemini([
    { text: buildTranslationPrompt(germanBase, langMeta) }
  ]);

  return cleanAntwort(translatedRaw);
}

async function buildFinalAnswerFromImages(bilder, lang) {
  const langMeta = getLanguageMeta(lang);

  const parts = [{ text: buildExtractionPromptForImages() }];

  for (const bild of bilder) {
    if (!bild.imageData || !bild.mimeType) continue;

    parts.push({
      inline_data: {
        mime_type: bild.mimeType,
        data: bild.imageData
      }
    });
  }

  const rawJson = await callGemini(parts);
  const info = normalizeInfo(extractJson(rawJson));

  const germanBaseRaw = await callGemini([
    { text: buildGermanBasePrompt(info) }
  ]);
  const germanBase = cleanAntwort(germanBaseRaw);

  if (langMeta.code === "de") {
    return germanBase;
  }

  const translatedRaw = await callGemini([
    { text: buildTranslationPrompt(germanBase, langMeta) }
  ]);

  return cleanAntwort(translatedRaw);
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

    const erklaerung = await buildFinalAnswerFromText(text, lang);

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

    const erklaerung = await buildFinalAnswerFromImages(bilder, lang);

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
