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
Übersetze den deutschen Text in sehr einfaches, natürliches Türkisch.
Halte die Struktur und die Überschriften gleich.
Übersetze Satz für Satz.
Erfinde nichts dazu.
Lass nichts Wichtiges weg.
Keine neue Behörde erfinden.
Jobcenter soll als "Jobcenter" stehen bleiben.
Schreibe einfach und natürlich.
Keine unnötig formellen Wörter.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        instruction: `
Übersetze den deutschen Text in sehr einfaches, natürliches Bulgarisch.
Halte die Struktur und die Überschriften gleich.
Übersetze Satz für Satz.
Erfinde nichts dazu.
Lass nichts Wichtiges weg.
`
      };
    case "ar":
      return {
        code: "ar",
        label: "Arabisch",
        instruction: `
Übersetze den deutschen Text in sehr einfaches, natürliches Arabisch.
Halte die Struktur und die Überschriften gleich.
Übersetze Satz für Satz.
Erfinde nichts dazu.
Lass nichts Wichtiges weg.
`
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        instruction: `
Gib den Text in sehr einfachem Deutsch aus.
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
    absender: typeof info.absender === "string" ? info.absender.trim() : "",
    briefart: typeof info.briefart === "string" ? info.briefart.trim() : "",
    worum_geht_es: typeof info.worum_geht_es === "string" ? info.worum_geht_es.trim() : "",
    was_ist_zu_tun: Array.isArray(info.was_ist_zu_tun)
      ? info.was_ist_zu_tun.map((x) => String(x).trim()).filter(Boolean)
      : [],
    frist: typeof info.frist === "string" ? info.frist.trim() : "",
    termin: typeof info.termin === "string" ? info.termin.trim() : "",
    folge_wenn_nichts:
      typeof info.folge_wenn_nichts === "string" ? info.folge_wenn_nichts.trim() : "",
    versteckte_wichtige_info:
      typeof info.versteckte_wichtige_info === "string"
        ? info.versteckte_wichtige_info.trim()
        : "",
    kurz_gesagt: typeof info.kurz_gesagt === "string" ? info.kurz_gesagt.trim() : "",
    unsicherheiten: Array.isArray(info.unsicherheiten)
      ? info.unsicherheiten.map((x) => String(x).trim()).filter(Boolean)
      : []
  };
}

function buildExtractionPromptForText(text) {
  return `
Du bist Hilfe24.

Lies diesen Brief und gib NUR gültiges JSON zurück.

Wichtig:
- Erfinde nichts.
- Nenne nur Dinge, die klar im Brief stehen oder sehr klar daraus folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- "was_ist_zu_tun" nur für echte konkrete Schritte.
- Ziele, Wünsche, allgemeine Ideen oder bloße Gesprächsinhalte gehören NICHT in "was_ist_zu_tun".
- "versteckte_wichtige_info" nur dann füllen, wenn eine wichtige Sache leicht übersehen wird, aber klar aus dem Brief folgt.
- "kurz_gesagt" soll 1 sehr kurzer Satz in ultra einfachem Deutsch sein.

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
  "kurz_gesagt": "",
  "unsicherheiten": []
}

Regeln:
- "absender": nur wenn klar erkennbar
- "briefart": sehr kurz, z. B. "Mahnung", "Rechnung", "Jobcenter-Brief", "Jugendamt-Brief", "Versicherung", "Werbung"
- "worum_geht_es": 1 sehr kurzer Satz in einfachem Deutsch
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, anmelden, schicken, Termin wahrnehmen, widersprechen
- "frist": nur wenn klar vorhanden
- "termin": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt oder sehr klar daraus folgt
- "versteckte_wichtige_info": nur 1 kurzer Satz
- "kurz_gesagt": 1 sehr kurzer einfacher Satz
- "unsicherheiten": nur echte Unklarheiten

Brief:
${text}
`;
}

function buildExtractionPromptForImages() {
  return `
Du bist Hilfe24.

Lies die Bilder dieses Briefes und gib NUR gültiges JSON zurück.

Wichtig:
- Erfinde nichts.
- Nenne nur Dinge, die klar auf den Bildern stehen oder sehr klar daraus folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- "was_ist_zu_tun" nur für echte konkrete Schritte.
- Ziele, Wünsche, allgemeine Ideen oder bloße Gesprächsinhalte gehören NICHT in "was_ist_zu_tun".
- "versteckte_wichtige_info" nur dann füllen, wenn eine wichtige Sache leicht übersehen wird, aber klar aus dem Brief folgt.
- "kurz_gesagt" soll 1 sehr kurzer Satz in ultra einfachem Deutsch sein.

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
  "kurz_gesagt": "",
  "unsicherheiten": []
}

Regeln:
- "absender": nur wenn klar erkennbar
- "briefart": sehr kurz
- "worum_geht_es": 1 sehr kurzer Satz in einfachem Deutsch
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, anmelden, schicken, Termin wahrnehmen, widersprechen
- "frist": nur wenn klar vorhanden
- "termin": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt oder sehr klar daraus folgt
- "versteckte_wichtige_info": nur 1 kurzer Satz
- "kurz_gesagt": 1 sehr kurzer einfacher Satz
- "unsicherheiten": nur echte Unklarheiten oder schlecht lesbare Stellen

Gib nur JSON zurück.

Bilder:
`;
}

function simplifySender(absender, briefart) {
  const text = `${absender || ""} ${briefart || ""}`.toLowerCase();

  if (text.includes("jugendamt")) return "Jugendamt";
  if (text.includes("jobcenter")) return "Jobcenter";
  if (text.includes("aok")) return "AOK";
  if (text.includes("familienkasse")) return "Familienkasse";
  if (text.includes("krankenkasse")) return "Krankenkasse";
  if (text.includes("versicherung")) return "Versicherung";
  if (text.includes("inkasso")) return "Inkasso";
  if (text.includes("gericht")) return "Gericht";
  if (text.includes("schule")) return "Schule";
  if (text.includes("vermieter")) return "Vermieter";

  return absender || "";
}

function toSentence(text) {
  if (!text) return "";
  const t = text.trim().replace(/\.$/, "");
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

function formatActions(actions) {
  if (!actions || actions.length === 0) return "";

  const cleaned = actions
    .map((x) => x.replace(/\.$/, "").trim())
    .filter(Boolean)
    .slice(0, 2);

  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned[0];

  return `${cleaned[0]} und ${cleaned[1]}`;
}

function renderSimpleGerman(info) {
  const lines = [];

  const sender = simplifySender(info.absender, info.briefart);
  if (sender) {
    lines.push(`Wer schreibt?\nDer Brief ist vom ${sender}.`);
  }

  if (info.worum_geht_es) {
    lines.push(`Worum geht es?\n${toSentence(info.worum_geht_es)}`);
  } else if (info.briefart) {
    lines.push(`Worum geht es?\n${toSentence(`Es geht um diesen ${info.briefart}`)}`);
  }

  const actions = formatActions(info.was_ist_zu_tun);
  let important = "";

  if (actions) {
    important = `Wichtig: ${actions}.`;
  } else if (info.versteckte_wichtige_info) {
    important = toSentence(info.versteckte_wichtige_info);
  }

  if (important) {
    lines.push(`Was ist jetzt wichtig?\n${important}`);
  }

  if (info.frist || info.termin) {
    const whenText = info.frist
      ? `Wichtig ist diese Frist: ${info.frist}.`
      : `Wichtig ist dieser Termin: ${info.termin}.`;
    lines.push(`Bis wann?\n${whenText}`);
  }

  if (info.folge_wenn_nichts) {
    lines.push(`Was passiert sonst?\n${toSentence(info.folge_wenn_nichts)}`);
  }

  if (info.kurz_gesagt) {
    lines.push(`Kurz gesagt:\n${toSentence(info.kurz_gesagt)}`);
  } else if (actions) {
    lines.push(`Kurz gesagt:\nDu musst jetzt nur ${actions}.`);
  } else if (info.frist || info.termin) {
    lines.push(`Kurz gesagt:\nDu musst jetzt nur die Frist oder den Termin beachten.`);
  } else {
    lines.push(`Kurz gesagt:\nDu musst jetzt nichts machen.`);
  }

  return lines.slice(0, 6).join("\n\n");
}

function buildTranslationPrompt(germanBase, langMeta) {
  return `
Du bist Hilfe24.

Unten steht ein fertiger deutscher Text mit festen Überschriften.
Übersetze ihn sauber in ${langMeta.label}.

Wichtig:
${langMeta.instruction}

Regeln:
- Übersetze Satz für Satz.
- Halte dieselben Überschriften.
- Erfinde nichts dazu.
- Lass nichts weg.
- Füge keine neuen Sätze ein.
- Keine Ausschmückung.
- Keine Wiederholung.
- Kein Markdown.

Deutscher Text:
${germanBase}
`;
}

async function buildInfoFromText(text) {
  const rawJson = await callGemini([{ text: buildExtractionPromptForText(text) }]);
  return normalizeInfo(extractJson(rawJson));
}

async function buildInfoFromImages(bilder) {
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
  return normalizeInfo(extractJson(rawJson));
}

async function translateIfNeeded(germanBase, lang) {
  const langMeta = getLanguageMeta(lang);

  if (langMeta.code === "de") {
    return germanBase;
  }

  const translatedRaw = await callGemini([
    { text: buildTranslationPrompt(germanBase, langMeta) }
  ]);

  return cleanAntwort(translatedRaw);
}

async function buildFinalAnswerFromText(text, lang) {
  const info = await buildInfoFromText(text);
  const germanBase = cleanAntwort(renderSimpleGerman(info));
  return translateIfNeeded(germanBase, lang);
}

async function buildFinalAnswerFromImages(bilder, lang) {
  const info = await buildInfoFromImages(bilder);
  const germanBase = cleanAntwort(renderSimpleGerman(info));
  return translateIfNeeded(germanBase, lang);
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
