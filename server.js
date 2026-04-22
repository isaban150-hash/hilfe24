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
Gib den Basistext in natürlichem, einfachem Deutsch aus.
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
    art_des_briefs: info.art_des_briefs || "",
    worum_geht_es: info.worum_geht_es || "",
    was_ist_zu_tun: Array.isArray(info.was_ist_zu_tun) ? info.was_ist_zu_tun : [],
    frist: info.frist || "",
    folge_wenn_nichts: info.folge_wenn_nichts || "",
    wichtige_termine: Array.isArray(info.wichtige_termine) ? info.wichtige_termine : [],
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
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- Gib nur gültiges JSON zurück.

Du sollst genau diese Felder zurückgeben:
{
  "absender": "",
  "art_des_briefs": "",
  "worum_geht_es": "",
  "was_ist_zu_tun": [],
  "frist": "",
  "folge_wenn_nichts": "",
  "wichtige_termine": [],
  "unsicherheiten": [],
  "abschlusssatz": ""
}

Regeln für die Felder:
- "absender": nur wenn klar lesbar oder eindeutig erkennbar
- "art_des_briefs": sehr kurz
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur Handlungen, die im Brief ausdrücklich verlangt werden. Keine Ziele, keine Wünsche, keine geplanten Maßnahmen, keine Empfehlungen, keine allgemeinen Vorhaben.
- Wenn der Brief nur Ziele, Planungen, Unterstützungsangebote oder Gesprächsinhalte beschreibt, dann darf "was_ist_zu_tun" leer bleiben.
- "frist": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt
- "wichtige_termine": nur klare Termine aus dem Brief
- "unsicherheiten": Dinge, die nicht ganz klar sind
- "abschlusssatz": immer ein sehr kurzer Satz. Wenn keine klare Pflicht da ist, dann eher in Richtung: "Du musst jetzt nur prüfen, ob du einverstanden bist."

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
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- Gib nur gültiges JSON zurück.

Du sollst genau diese Felder zurückgeben:
{
  "absender": "",
  "art_des_briefs": "",
  "worum_geht_es": "",
  "was_ist_zu_tun": [],
  "frist": "",
  "folge_wenn_nichts": "",
  "wichtige_termine": [],
  "unsicherheiten": [],
  "abschlusssatz": ""
}

Regeln für die Felder:
- "absender": nur wenn klar lesbar oder eindeutig erkennbar
- "art_des_briefs": sehr kurz
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur Handlungen, die auf den Bildern ausdrücklich verlangt werden. Keine Ziele, keine Wünsche, keine geplanten Maßnahmen, keine Empfehlungen, keine allgemeinen Vorhaben.
- Wenn der Brief nur Ziele, Planungen, Unterstützungsangebote oder Gesprächsinhalte beschreibt, dann darf "was_ist_zu_tun" leer bleiben.
- "frist": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt
- "wichtige_termine": nur klare Termine aus den Bildern
- "unsicherheiten": Dinge, die nicht ganz klar oder nicht gut lesbar sind
- "abschlusssatz": immer ein sehr kurzer Satz. Wenn keine klare Pflicht da ist, dann eher in Richtung: "Du musst jetzt nur prüfen, ob du einverstanden bist."

Gib nur JSON zurück.

Bilder:
`;
}

function buildGermanBasePrompt(info) {
  return `
Du bist Hilfe24.

Aus diesen strukturierten Informationen sollst du jetzt eine sehr kurze, sichere und einfache Erklärung auf Deutsch schreiben.

Wichtig:
- Bleibe extrem nah an den Daten.
- Erfinde nichts.
- Lass alles weg, was nicht sicher ist.
- Formuliere vorsichtig.
- Mache aus keiner Info eine Pflicht, wenn sie nicht eindeutig in den Daten steht.
- Wenn eine Information nur als Ziel, Planung, Unterstützung oder nächster Schritt beschrieben ist, formuliere sie nicht als harte Pflicht.
- Vermeide Wörter wie "muss", "soll", "ist erforderlich", wenn die Daten das nicht eindeutig als Pflicht zeigen.
- Formuliere in solchen Fällen weicher, zum Beispiel mit "im Protokoll steht", "es ist vorgesehen", "es ist geplant" oder "dabei soll geholfen werden".
- Keine freien Zusatzgedanken.
- Keine Ausschmückung.
- Keine Überschriften.
- Kein Markdown.
- Keine Listen.
- Wiederhole am Ende nicht noch einmal allgemein, dass der Brief etwas zusammenfasst oder informiert.
- Vermeide leere Abschlusssätze ohne echten Nutzen.
- Höchstens 4 sehr kurze Sätze plus 1 Abschlusssatz.
- Halte die Erklärung so kurz wie möglich.
- Nenne nur die wichtigsten 1 bis 3 Punkte.
- Lass Nebendetails weg.

Nutze nur diese Informationen:
${JSON.stringify(info, null, 2)}

Regeln für den Aufbau:
- Satz 1: wenn "absender" vorhanden ist, zuerst sagen, von wem der Brief ist
- Satz 2: kurz sagen, was das für ein Brief oder Protokoll ist und worum es geht
- Satz 3: nur den wichtigsten nächsten Schritt oder die wichtigste Frist nennen
- Satz 4: nur wenn wirklich nötig: kurz sagen, was passiert, wenn man nichts macht
- Danach genau 1 einzelner sehr kurzer Abschlusssatz in einem eigenen letzten Satz.
- Der Abschlusssatz darf nur 1 Satz sein und keine weiteren Erklärungen enthalten.
- Wenn "was_ist_zu_tun" leer ist, schreibe keinen harten Pflichtsatz.
- Wenn "absender" leer ist, erfinde keinen Absender.

Wenn "unsicherheiten" vorhanden sind, nenne sie nicht als Tatsache.
Wenn etwas nicht sicher ist, lass es lieber weg.
`;
}

function buildTranslationPrompt(germanBase, langMeta) {
  return `
Du bist Hilfe24.

Unten steht ein fertiger deutscher Basistext.
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
