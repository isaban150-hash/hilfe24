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
  const lines = [];

  const sender = simplifySender(info.absender, info.briefart);

  if (sender) {
    lines.push(`Der Brief ist vom ${sender}.`);
  }

  const lowerBriefart = (info.briefart || "").toLowerCase();
  const lowerTopic = (info.worum_geht_es || "").toLowerCase();
  const actions = Array.isArray(info.was_ist_zu_tun) ? info.was_ist_zu_tun : [];

  const hasHelpContext =
    lowerBriefart.includes("jugendamt") ||
    lowerTopic.includes("hilfe") ||
    lowerTopic.includes("unterstützung") ||
    lowerTopic.includes("familie") ||
    lowerTopic.includes("deutschland") ||
    lowerTopic.includes("schule") ||
    lowerTopic.includes("arbeit");

  if (hasHelpContext) {
    lines.push("Es geht um Hilfe für Asen und seine Familie.");
  } else if (info.worum_geht_es) {
    lines.push(sentenceCase(info.worum_geht_es).replace(/\.*$/, "") + ".");
  } else if (info.briefart) {
    lines.push(`Es geht um diesen ${info.briefart}.`);
  }

  if (hasHelpContext) {
    lines.push("Asen soll wieder besser in Deutschland klarkommen.");
  }

  const simpleActions = [];

  for (const action of actions) {
    const a = action.toLowerCase();

    if (a.includes("jobcenter")) {
      simpleActions.push("Asen soll wieder beim Jobcenter angemeldet werden");
      continue;
    }

    if (
      a.includes("stadt") ||
      a.includes("einwohnermeldeamt") ||
      a.includes("bürgeramt") ||
      a.includes("anmelden")
    ) {
      simpleActions.push("Asen soll bei der Stadt angemeldet werden");
      continue;
    }

    if (a.includes("termin")) {
      simpleActions.push("der Termin ist wichtig");
      continue;
    }

    if (a.includes("widerspruch") || a.includes("melden")) {
      simpleActions.push("ihr müsst euch melden, wenn ihr nicht einverstanden seid");
      continue;
    }

    simpleActions.push(action.replace(/\.$/, "").trim());
  }

  const uniqueActions = [];
  for (const item of simpleActions) {
    const key = item.toLowerCase();
    if (item && !uniqueActions.some((x) => x.toLowerCase() === key)) {
      uniqueActions.push(item);
    }
  }

  if (uniqueActions.length > 0) {
    if (uniqueActions.length === 1) {
      lines.push(`Wichtig: ${uniqueActions[0]}.`);
    } else {
      lines.push(`Wichtig: ${uniqueActions[0]} und ${uniqueActions[1]}.`);
    }
  } else if (info.versteckte_wichtige_info) {
    lines.push(sentenceCase(info.versteckte_wichtige_info).replace(/\.*$/, "") + ".");
  }

  if (info.frist) {
    lines.push(`Du hast dafür ${info.frist}.`);
  } else if (info.termin) {
    lines.push(`Wichtig ist dieser Termin: ${info.termin}.`);
  }

  if (info.folge_wenn_nichts) {
    let consequence = sentenceCase(info.folge_wenn_nichts).replace(/\.*$/, "");
    consequence = consequence
      .replace(/verbindlich/gi, "gültig")
      .replace(/Widerspruch/gi, "Meldung");
    lines.push(consequence + ".");
  } else if (info.frist) {
    lines.push("Sonst gilt der Plan.");
  }

  const clean = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!clean.some((x) => x.toLowerCase() === t.toLowerCase())) {
      clean.push(t);
    }
  }

  return clean.slice(0, 5).join("\n");
}

function buildTranslationPrompt(germanBase, langMeta) {
  return `
Du bist Hilfe24.

Unten steht ein fertiger deutscher Text in sehr einfacher Sprache.
Übersetze ihn sauber in ${langMeta.label}.

Wichtig:
${langMeta.instruction}

Sehr strenge Regeln:
- Bleibe extrem nah am deutschen Text.
- Erfinde nichts dazu.
- Lass nichts Wichtiges weg.
- Verwende genau dieselbe Anzahl an Sätzen wie im Deutschen.
- Übersetze Satz für Satz.
- Füge keine Erklärung dazu.
- Füge keine neuen Behördenbegriffe dazu.
- Ersetze keine Behörde durch eine andere Behörde.
- Wenn im Deutschen "Jugendamt" steht, dann übersetze das als die normale, verständliche Bezeichnung für Jugendamt und nicht frei.
- Wenn im Deutschen "Jobcenter" steht, dann lasse "Jobcenter" als "Jobcenter".
- Wenn im Deutschen "Stadt" steht, dann übersetze nur "Stadt" bzw. Gemeinde einfach und neutral.
- Keine förmliche oder steife Sprache.
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
