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
Ändere keine Bedeutung.
Formuliere vorsichtig.
Mache aus Zielen, Planungen oder Unterstützungsangeboten keine festen Pflichten.
Wenn etwas im Deutschen neutral formuliert ist, muss es auch im Türkischen neutral bleiben.
Wenn etwas nicht sicher ist, darf es nicht als sichere Tatsache erscheinen.
Vermeide im Türkischen unnötig harte Pflichtwörter wie "gerekmektedir", "zorundadır", "mutlaka", wenn die Information nicht eindeutig eine Pflicht ist.
Wenn etwas nur geplant, besprochen oder vorgesehen ist, formuliere weicher und natürlicher.
Türkische Sätze sollen möglichst einfach, direkt und alltagstauglich klingen.
Vermeide unnötig formelle Wörter wie "rica olunur" oder zu amtliche Wörter wie "önlemler", wenn es einfacher gesagt werden kann.
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
  "absender": "",
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
- "absender": nur wenn klar lesbar oder eindeutig erkennbar, z. B. "Jugendamt Bad Salzuflen", "Jobcenter Lippe", "AOK", "Familienkasse"
- Wenn der Absender nicht klar lesbar ist, dann lass "absender" leer.
- "art_des_briefs": sehr kurz, z. B. "Jobcenter-Brief", "Hilfeplan-Protokoll", "Mahnung"
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur Handlungen, die im Brief ausdrücklich verlangt werden. Keine Ziele, keine Wünsche, keine geplanten Maßnahmen, keine Empfehlungen, keine allgemeinen Vorhaben.
- Wenn der Brief nur Ziele, Planungen, Unterstützungsangebote oder Gesprächsinhalte beschreibt, dann darf "was_ist_zu_tun" leer bleiben.
- "frist": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt
- "wichtige_termine": nur Termine, die im Brief klar stehen
- "praktische_tipps": höchstens 2 kurze Tipps, aber nur wenn sie direkt aus dem Brief sinnvoll folgen
- "unsicherheiten": Dinge, die im Brief nicht ganz klar oder eventuell unklar sind
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
  "absender": "",
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
- "absender": nur wenn auf den Bildern klar lesbar oder eindeutig erkennbar
- Wenn der Absender nicht klar lesbar ist, dann lass "absender" leer.
- "art_des_briefs": sehr kurz
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur Handlungen, die auf den Bildern ausdrücklich verlangt werden. Keine Ziele, keine Wünsche, keine geplanten Maßnahmen, keine Empfehlungen, keine allgemeinen Vorhaben.
- Wenn der Brief nur Ziele, Planungen, Unterstützungsangebote oder Gesprächsinhalte beschreibt, dann darf "was_ist_zu_tun" leer bleiben.
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

function buildFinalAnswerPrompt(info, langMeta) {
  return `
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
- Wenn eine Information nur als Ziel, Planung, Unterstützung oder nächster Schritt beschrieben ist, formuliere sie nicht als harte Pflicht.
- Vermeide Wörter wie "muss", "soll", "ist erforderlich", wenn die Daten das nicht eindeutig als Pflicht zeigen.
- Formuliere in solchen Fällen weicher, zum Beispiel mit "es ist vorgesehen", "es ist geplant", "dabei soll geholfen werden" oder "im Protokoll steht".
- Keine freien Zusatzgedanken.
- Keine Ausschmückung.
- Keine Überschriften.
- Kein Markdown.
- Keine Listen mit 1., 2., 3.
- Höchstens 5 kurze Sätze plus 1 Abschlusssatz.
- Wenn "was_ist_zu_tun" leer ist, schreibe keinen Satz mit einer Pflicht oder Aufgabe.
- Ziele, Unterstützungsangebote oder geplante Maßnahmen dürfen nicht als direkte Pflicht für die Person formuliert werden.
- In Türkisch dürfen Ziele, Vorhaben, Unterstützungsangebote oder Gesprächsinhalte nicht wie feste Pflichten klingen.
- In Türkisch darf eine Maßnahme nur dann als Pflicht formuliert werden, wenn sie in den Daten ausdrücklich als Handlung steht.
- Wenn eine Handlung nicht ganz sicher oder nicht ausdrücklich gefordert ist, formuliere sie nicht als Pflicht.
- Wenn "was_ist_zu_tun" leer oder unsicher ist, schreibe keinen "Du musst"-Satz außer für einen möglichen Widerspruch oder eine Prüfung des Inhalts.
- Wiederhole am Ende nicht noch einmal allgemein, dass der Brief etwas zusammenfasst oder informiert.
- Vermeide leere Abschlusssätze ohne echten Nutzen.

Nutze nur diese Informationen:
${JSON.stringify(info, null, 2)}

Regeln für den Aufbau:
- Satz 1: wenn "absender" vorhanden ist, zuerst sagen, von wem der Brief ist
- Satz 2: kurz sagen, was das für ein Brief oder Protokoll ist
- Satz 3: kurz sagen, worum es geht
- Satz 4: nur wenn klar vorhanden: was man tun muss
- Satz 5: nur wenn klar vorhanden: Frist oder Termin
- Satz 6: nur wenn klar vorhanden: was passiert, wenn man nichts macht
- Danach genau 1 einzelner sehr kurzer Abschlusssatz in einem eigenen letzten Satz.
- Der Abschlusssatz darf nur 1 Satz sein und keine weiteren Erklärungen enthalten.
- Beispiel: "Du musst jetzt nur prüfen, ob du mit dem Protokoll einverstanden bist."
- Wenn "absender" vorhanden ist, beginne möglichst mit: "Der Brief ist von ..."
- Wenn "absender" leer ist, erfinde keinen Absender

Wenn "unsicherheiten" vorhanden sind, dann nenne sie nicht als Tatsache.
Wenn etwas nicht sicher ist, lass es lieber weg.
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
