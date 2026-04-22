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
Schreibe auf natürlichem, leicht verständlichem Türkisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an den vorgegebenen Informationen.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        instruction: `
Schreibe auf natürlichem, leicht verständlichem Bulgarisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an den vorgegebenen Informationen.
`
      };
    case "ar":
      return {
        code: "ar",
        label: "Arabisch",
        instruction: `
Schreibe auf natürlichem, leicht verständlichem Arabisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an den vorgegebenen Informationen.
`
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        instruction: `
Schreibe auf natürlichem, einfachem Deutsch.
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
    praktische_tipps: Array.isArray(info.praktische_tipps) ? info.praktische_tipps : [],
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
  "art_des_briefs": "",
  "worum_geht_es": "",
  "was_ist_zu_tun": [],
  "frist": "",
  "folge_wenn_nichts": "",
  "wichtige_termine": [],
  "praktische_tipps": [],
  "unsicherheiten": [],
  "abschlusssatz": ""
}

Regeln für die Felder:
- "art_des_briefs": sehr kurz, z. B. "Jobcenter-Brief", "Hilfeplan-Protokoll", "Mahnung"
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur Handlungen, die im Brief ausdrücklich verlangt werden. Keine Ziele, keine Wünsche, keine geplanten Maßnahmen, keine Empfehlungen, keine allgemeinen Vorhaben.
- "Wenn der Brief nur Ziele, Planungen, Unterstützungsangebote oder Gesprächsinhalte beschreibt, dann darf "was_ist_zu_tun" leer bleiben.
- "frist": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt
- "wichtige_termine": nur Termine, die im Brief klar stehen
- "praktische_tipps": höchstens 2 kurze Tipps, aber nur wenn sie direkt aus dem Brief sinnvoll folgen
- "unsicherheiten": Dinge, die im Brief nicht ganz klar oder evtl. unklar sind
- "abschlusssatz": immer ein einziger kurzer Satz, möglichst mit "Du musst jetzt nur ...", aber nur passend zum Brief

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
  "art_des_briefs": "",
  "worum_geht_es": "",
  "was_ist_zu_tun": [],
  "frist": "",
  "folge_wenn_nichts": "",
  "wichtige_termine": [],
  "praktische_tipps": [],
  "unsicherheiten": [],
  "abschlusssatz": ""
}

Regeln für die Felder:
- "art_des_briefs": sehr kurz
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur Handlungen, die auf den Bildern ausdrücklich verlangt werden. Keine Ziele, keine Wünsche, keine geplanten Maßnahmen, keine Empfehlungen, keine allgemeinen Vorhaben.

- "frist": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt
- "wichtige_termine": nur Termine, die klar auf den Bildern stehen
- "praktische_tipps": höchstens 2 kurze Tipps, aber nur wenn sie direkt aus dem Brief sinnvoll folgen
- "unsicherheiten": Dinge, die nicht ganz klar oder nicht gut lesbar sind
- "abschlusssatz": immer ein kurzer Schlusssatz, passend zum Brief

Gib nur JSON zurück.

Bilder:
`;
}

function buildFinalAnswerPrompt(info, langMeta) {return `
Du bist Hilfe24.

Aus den folgenden strukturierten Informationen sollst du jetzt eine sehr kurze, einfache und verlässliche Erklärung schreiben.

Antwortsprache:
${langMeta.label}

Sprachregel:
${langMeta.instruction}

Wichtig:
- Bleibe extrem nah an den Daten.
- Erfinde nichts.
- Lass alles weg, was nicht sicher ist.
- Formuliere vorsichtig.
- Mache aus keiner Info eine Pflicht, wenn sie nicht eindeutig in den Daten steht.
- Keine freien Zusatzgedanken.
- Keine Ausschmückung.
- Keine Überschriften.
- Kein Markdown.
- Keine Listen mit 1., 2., 3.
- Wenn "was_ist_zu_tun" leer ist, schreibe keinen Satz mit einer Pflicht oder Aufgabe.
- Ziele, Unterstützungsangebote oder geplante Maßnahmen dürfen nicht als direkte Pflicht für die Person formuliert werden.Höchstens 5 kurze Sätze plus 1 Abschlusssatz.

Nutze nur diese Informationen:
${JSON.stringify(info, null, 2)}

Regeln für den Aufbau:
- Satz 1: kurz sagen, was das für ein Brief oder Protokoll ist
- Satz 2: kurz sagen, worum es geht
- Satz 3: nur wenn klar vorhanden: was man tun muss
- Satz 4: nur wenn klar vorhanden: Frist oder Termin
- Satz 5: nur wenn klar vorhanden: was passiert, wenn man nichts macht
- Danach genau 1 kurzer Abschlusssatz

Wenn "unsicherheiten" vorhanden sind, dann nenne sie nicht als Tatsache.
Wenn etwas nicht sicher ist, lass es lieber weg.

Der Abschlusssatz muss sehr kurz sein.
Wenn eine klare Handlung verlangt wird, beginne mit:
"Du musst jetzt nur ..."
Wenn keine klare Handlung verlangt wird, schreibe:
"Das ist erstmal nur eine Information."
`;
  return `
Du bist Hilfe24.

Aus den folgenden strukturierten Informationen sollst du jetzt eine kurze, natürliche und einfache Erklärung schreiben.

Antwortsprache:
${langMeta.label}

Sprachregel:
${langMeta.instruction}

Wichtig:
- Bleibe sehr nah an den Daten.
- Erfinde nichts dazu.
- Lass Nebensachen weg.
- Mache aus einem Termin keine Hauptpflicht, wenn er nur ein Termin ist.
- Mache aus einer Info keine feste Pflicht, wenn sie nicht klar als Pflicht in den Daten steht.
- Schreibe kurz, klar und menschlich.
- Keine Überschriften.
- Keine Listen mit 1., 2., 3.
- Kein Markdown.
- Keine Sternchen.
- Normalerweise 4 bis 7 Sätze.
- Wenn wenig wichtig ist, dann noch kürzer.

Nutze nur diese Informationen:
${JSON.stringify(info, null, 2)}

Bau die Erklärung ungefähr so:
- kurz sagen, was das für ein Brief ist und worum es geht
- dann nur die wirklich wichtigen Handlungen oder Fristen nennen
- wenn vorhanden, kurz sagen, was passiert, wenn man nichts macht
- wenn sinnvoll, maximal 1 bis 2 kurze praktische Tipps
- am Ende genau den Abschlusssatz aus den Daten sinngemäß wiedergeben

Wenn "unsicherheiten" vorhanden sind, nenne sie nur kurz und vorsichtig.
`;
}

async function buildFinalAnswerFromText(text, lang) {
  const langMeta = getLanguageMeta(lang);

  const rawJson = await callGemini([
    { text: buildExtractionPromptForText(text) }
  ]);

  const info = normalizeInfo(extractJson(rawJson));

  const finalText = await callGemini([
    { text: buildFinalAnswerPrompt(info, langMeta) }
  ]);

  return cleanAntwort(finalText);
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

  const finalText = await callGemini([
    { text: buildFinalAnswerPrompt(info, langMeta) }
  ]);

  return cleanAntwort(finalText);
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
