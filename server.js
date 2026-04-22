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
Schreibe kurze Sätze.
Keine schweren Wörter.
Keine unnötig formelle Sprache.
Ändere keine Bedeutung.
Erfinde nichts dazu.
Wenn der deutsche Text vorsichtig formuliert ist, muss Türkisch auch vorsichtig bleiben.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        instruction: `
Übersetze den deutschen Text in sehr einfaches, natürliches Bulgarisch.
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
Übersetze den deutschen Text in sehr einfaches, natürliches Arabisch.
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
    dringlichkeit: typeof info.dringlichkeit === "string" ? info.dringlichkeit.trim() : "",
    versteckte_wichtige_info:
      typeof info.versteckte_wichtige_info === "string"
        ? info.versteckte_wichtige_info.trim()
        : "",
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

Gib genau dieses JSON zurück:
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
  "unsicherheiten": []
}

Regeln:
- "absender": nur wenn klar erkennbar
- "briefart": sehr kurz, z. B. "Mahnung", "Rechnung", "Jobcenter-Brief", "Jugendamt-Brief", "Versicherung", "Werbung"
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, anmelden, schicken, Termin wahrnehmen, widersprechen
- "frist": nur wenn klar vorhanden
- "termin": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt oder sehr klar daraus folgt
- "dringlichkeit": nur "hoch", "mittel" oder "niedrig"
- "versteckte_wichtige_info": nur 1 kurzer Satz
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

Gib genau dieses JSON zurück:
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
  "unsicherheiten": []
}

Regeln:
- "absender": nur wenn klar erkennbar
- "briefart": sehr kurz
- "worum_geht_es": 1 kurzer Satz
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, anmelden, schicken, Termin wahrnehmen, widersprechen
- "frist": nur wenn klar vorhanden
- "termin": nur wenn klar vorhanden
- "folge_wenn_nichts": nur wenn klar genannt oder sehr klar daraus folgt
- "dringlichkeit": nur "hoch", "mittel" oder "niedrig"
- "versteckte_wichtige_info": nur 1 kurzer Satz
- "unsicherheiten": nur echte Unklarheiten oder schlecht lesbare Stellen

Gib nur JSON zurück.

Bilder:
`;
}

function simplifySender(absender, briefart) {
  if (!absender) return "";

  const lower = absender.toLowerCase();

  if (lower.includes("jugendamt")) return "Jugendamt";
  if (lower.includes("jobcenter")) return "Jobcenter";
  if (lower.includes("aok")) return "AOK";
  if (lower.includes("familienkasse")) return "Familienkasse";
  if (lower.includes("krankenkasse")) return "Krankenkasse";
  if (lower.includes("versicherung")) return "Versicherung";
  if (lower.includes("inkasso")) return "Inkasso";
  if (lower.includes("gericht")) return "Gericht";
  if (lower.includes("schule")) return "Schule";
  if (lower.includes("vermieter")) return "Vermieter";

  if (briefart && briefart.toLowerCase().includes("jugendamt")) return "Jugendamt";

  return absender;
}

function simplifyType(briefart) {
  if (!briefart) return "";

  const lower = briefart.toLowerCase();

  if (lower.includes("mahnung")) return "Das ist eine Mahnung.";
  if (lower.includes("rechnung")) return "Das ist eine Rechnung.";
  if (lower.includes("werbung")) return "Das ist nur Werbung.";
  if (lower.includes("versicherung")) return "Das ist ein Brief von einer Versicherung.";
  if (lower.includes("jobcenter")) return "Das ist ein Brief vom Jobcenter.";
  if (lower.includes("jugendamt")) return "Das ist ein Brief vom Jugendamt.";
  if (lower.includes("kündigung")) return "Das ist eine Kündigung.";
  if (lower.includes("rückforderung")) return "Es geht um Geld, das zurückverlangt wird.";

  return "";
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

function sentenceCase(text) {
  if (!text) return "";
  const t = text.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function renderSimpleGerman(info) {
  const sentences = [];

  const sender = simplifySender(info.absender, info.briefart);
  if (sender) {
    sentences.push(`Der Brief ist vom ${sender}.`);
  }

  const typeSentence = simplifyType(info.briefart);
  if (typeSentence) {
    sentences.push(typeSentence);
  } else if (info.worum_geht_es) {
    sentences.push(sentenceCase(info.worum_geht_es).replace(/\.*$/, "") + ".");
  }

  if (info.worum_geht_es) {
    const lower = info.worum_geht_es.toLowerCase();

    if (
      lower.includes("hilfe") ||
      lower.includes("unterstützung") ||
      lower.includes("schule") ||
      lower.includes("arbeit") ||
      lower.includes("familie") ||
      lower.includes("deutschland")
    ) {
      const base = sentenceCase(info.worum_geht_es).replace(/\.*$/, "");
      if (!sentences.some((s) => s.toLowerCase().includes(base.toLowerCase()))) {
        sentences.push(base + ".");
      }
    }
  }

  const actions = formatActions(info.was_ist_zu_tun);
  if (actions) {
    sentences.push(`Wichtig: ${actions}.`);
  } else if (info.versteckte_wichtige_info) {
    sentences.push(sentenceCase(info.versteckte_wichtige_info).replace(/\.*$/, "") + ".");
  }

  if (info.termin) {
    sentences.push(`Wichtig ist dieser Termin: ${info.termin}.`);
  } else if (info.frist) {
    sentences.push(`Wichtig ist diese Frist: ${info.frist}.`);
  }

  if (info.folge_wenn_nichts) {
    sentences.push(sentenceCase(info.folge_wenn_nichts).replace(/\.*$/, "") + ".");
  }

  if (!actions && !info.frist && !info.termin && !info.folge_wenn_nichts) {
    sentences.push("Du musst jetzt nur prüfen, ob das für dich so passt.");
  } else if (actions) {
    const shortAction = actions.length > 90 ? "das prüfen" : actions;
    sentences.push(`Du musst jetzt nur ${shortAction}.`);
  } else if (info.frist || info.termin) {
    sentences.push("Du musst jetzt nur die Frist oder den Termin beachten.");
  }

  const unique = [];
  for (const s of sentences) {
    const key = s.toLowerCase().trim();
    if (!unique.some((x) => x.toLowerCase().trim() === key)) {
      unique.push(s);
    }
  }

  return unique.slice(0, 5).join("\n");
}

function buildTranslationPrompt(germanBase, langMeta) {
  return `
Du bist Hilfe24.

Unten steht ein fertiger deutscher Text in sehr einfacher Sprache.
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
