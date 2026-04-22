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
Übersetze den deutschen Basistext in einfaches, natürliches Türkisch.
Schreibe kurze Sätze.
Keine schweren Wörter.
Keine Behördensprache, wenn es einfacher geht.
Ändere keine Bedeutung.
Erfinde nichts dazu.
Wenn der deutsche Text vorsichtig ist, muss Türkisch auch vorsichtig bleiben.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        instruction: `
Übersetze den deutschen Basistext in einfaches, natürliches Bulgarisch.
Schreibe kurze Sätze.
Ändere keine Bedeutung.
Erfinde nichts dazu.
`
      };
    case "ar":
      return {
        code: "ar",
        label: "Arabisch",
        instruction: `
Übersetze den deutschen Basistext in einfaches, natürliches Arabisch.
Schreibe kurze Sätze.
Ändere keine Bedeutung.
Erfinde nichts dazu.
`
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        instruction: `
Gib den Basistext in sehr einfachem Deutsch aus.
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
    .replace(/^\s*\d+\.\s*/gm, "")
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
    versteckte_wichtige_info: info.versteckte_wichtige_info || "",
    unsicherheiten: Array.isArray(info.unsicherheiten) ? info.unsicherheiten : []
  };
}

function buildExtractionPromptForText(text) {
  return `
Du bist Hilfe24.

Lies diesen Brief und gib NUR JSON zurück.

Wichtig:
- Erfinde nichts.
- Nur Dinge nennen, die klar im Brief stehen oder sehr klar daraus folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.

Gib genau dieses JSON zurück:
{
  "absender": "",
  "briefart": "",
  "worum_geht_es": "",
  "was_ist_zu_tun": [],
  "frist": "",
  "termin": "",
  "folge_wenn_nichts": "",
  "versteckte_wichtige_info": "",
  "unsicherheiten": []
}

Regeln:
- "absender": nur wenn klar erkennbar
- "briefart": sehr kurz, z. B. "Mahnung", "Rechnung", "Jugendamt-Brief", "Versicherung", "Werbung"
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, anmelden, schicken, Termin wahrnehmen, widersprechen
- Ziele und allgemeine Ideen gehören NICHT in "was_ist_zu_tun"
- "frist": nur wenn klar vorhanden
- "termin": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt oder sehr klar daraus folgt
- "versteckte_wichtige_info": nur 1 kurzer Satz, nur wenn eine wichtige Sache leicht übersehen wird
- "unsicherheiten": nur wenn wirklich etwas unklar ist

Brief:
${text}
`;
}

function buildExtractionPromptForImages() {
  return `
Du bist Hilfe24.

Lies die Bilder dieses Briefes und gib NUR JSON zurück.

Wichtig:
- Erfinde nichts.
- Nur Dinge nennen, die klar auf den Bildern stehen oder sehr klar daraus folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.

Gib genau dieses JSON zurück:
{
  "absender": "",
  "briefart": "",
  "worum_geht_es": "",
  "was_ist_zu_tun": [],
  "frist": "",
  "termin": "",
  "folge_wenn_nichts": "",
  "versteckte_wichtige_info": "",
  "unsicherheiten": []
}

Regeln:
- "absender": nur wenn klar erkennbar
- "briefart": sehr kurz
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, anmelden, schicken, Termin wahrnehmen, widersprechen
- Ziele und allgemeine Ideen gehören NICHT in "was_ist_zu_tun"
- "frist": nur wenn klar vorhanden
- "termin": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt oder sehr klar daraus folgt
- "versteckte_wichtige_info": nur 1 kurzer Satz, nur wenn eine wichtige Sache leicht übersehen wird
- "unsicherheiten": nur wenn wirklich etwas unklar oder schlecht lesbar ist

Gib nur JSON zurück.

Bilder:
`;
}

function buildGermanBasePrompt(info) {
  return `
Du bist Hilfe24.

Schreibe aus diesen Daten eine ULTRA EINFACHE Erklärung auf Deutsch.

Sehr wichtig:
- Sehr kurze Sätze.
- Keine Behördensprache.
- Keine langen Erklärungen.
- Keine Nummern.
- Keine Einleitung wie "Hier ist die Erklärung".
- Keine Füllsätze.
- Maximal 5 kurze Sätze.
- Jeder Satz soll einen klaren Zweck haben.
- Schreibe so, dass ein Mensch mit wenig Deutsch es versteht.
- Bleibe sehr nah an den Daten.
- Erfinde nichts.
- Wenn etwas unklar ist, lass es weg.

Nutze nur diese Informationen:
${JSON.stringify(info, null, 2)}

Schreibe nur in dieser Reihenfolge:
- Satz 1: Wer schreibt?
- Satz 2: Worum geht es?
- Satz 3: Was ist jetzt wichtig?
- Satz 4: Bis wann oder welcher Termin?
- Satz 5: Was passiert sonst?

Regeln:
- Wenn eine Zeile nicht gebraucht wird, lass sie weg.
- Wenn "absender" leer ist, erfinde keinen Absender.
- Wenn "was_ist_zu_tun" leer ist, schreibe keinen Befehl.
- Wenn "frist" leer ist und "termin" leer ist, lass Satz 4 weg.
- Wenn "folge_wenn_nichts" leer ist, lass Satz 5 weg.
- Wenn "versteckte_wichtige_info" wichtig ist, packe sie in Satz 3 oder Satz 5.
- Statt schwieriger Wörter lieber einfache Wörter.
- Statt "widersprechen" lieber "melden, wenn du nicht einverstanden bist", wenn das passt.
- Statt "Protokoll" lieber "Zusammenfassung von einem Gespräch", wenn das passt.
- Statt "Integration" lieber "wieder besser in Deutschland klarkommen", wenn das passt.
`;
}

function buildTranslationPrompt(germanBase, langMeta) {
  return `
Du bist Hilfe24.

Unten steht ein fertiger deutscher Basistext in sehr einfacher Sprache.
Übersetze ihn sauber in ${langMeta.label}.

Wichtig:
${langMeta.instruction}

Regeln:
- Bleibe sehr nah am deutschen Text.
- Erfinde nichts dazu.
- Lass nichts Wichtiges weg.
- Halte die Sätze kurz.
- Halte die Sprache einfach.
- Keine zusätzlichen Sätze.
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
