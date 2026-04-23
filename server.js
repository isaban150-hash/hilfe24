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
Halte die Struktur exakt gleich.
Übersetze Satz für Satz.
Erfinde nichts dazu.
Lass nichts Wichtiges weg.
Keine neue Behörde erfinden.
Wenn im Deutschen "Jobcenter" steht, dann bleibt "Jobcenter".
Wenn im Deutschen "Jugendamt" steht, übersetze es als "Gençlik Dairesi".
Schreibe einfach, klar und natürlich.
Nicht steif. Nicht wie Google Translate.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        instruction: `
Übersetze den deutschen Text in sehr einfaches, natürliches Bulgarisch.
Halte die Struktur exakt gleich.
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
Halte die Struktur exakt gleich.
Übersetze Satz für Satz.
Erfinde nichts dazu.
Lass nichts Wichtiges weg.
`
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        instruction: ``
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
      headers: { "Content-Type": "application/json" },
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

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.map((x) => String(x).trim()).filter(Boolean)
    : [];
}

function normalizeInfo(info) {
  return {
    absender: normalizeString(info.absender),
    briefart: normalizeString(info.briefart),
    betroffene_person: normalizeString(info.betroffene_person),
    worum_geht_es: normalizeString(info.worum_geht_es),
    was_ist_zu_tun: normalizeArray(info.was_ist_zu_tun),
    frist: normalizeString(info.frist),
    termin: normalizeString(info.termin),
    folge_wenn_nichts: normalizeString(info.folge_wenn_nichts),
    versteckte_wichtige_info: normalizeString(info.versteckte_wichtige_info),
    kurz_gesagt: normalizeString(info.kurz_gesagt),
    unsicherheiten: normalizeArray(info.unsicherheiten)
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
- Ziele, Wünsche, Ideen oder allgemeine Gesprächsinhalte gehören NICHT in "was_ist_zu_tun".
- "versteckte_wichtige_info" nur dann füllen, wenn eine wichtige Sache leicht übersehen wird, aber klar aus dem Brief folgt.
- "kurz_gesagt" soll 1 sehr kurzer Satz in sehr einfachem Deutsch sein.

Gib genau dieses JSON zurück:
{
  "absender": "",
  "briefart": "",
  "betroffene_person": "",
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
- "briefart": sehr kurz, z. B. "Mahnung", "Rechnung", "Einladung", "Versicherungsbrief", "Info-Brief", "Werbung", "Kündigung", "Bestätigung", "Ablehnung", "Bewilligung"
- "betroffene_person": Name nur wenn klar erkennbar
- "worum_geht_es": 1 sehr kurzer Satz in einfachem Deutsch
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, anmelden, Unterlagen schicken, Termin wahrnehmen, antworten, kündigen, unterschreiben, widersprechen
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
- Ziele, Wünsche, Ideen oder allgemeine Gesprächsinhalte gehören NICHT in "was_ist_zu_tun".
- "versteckte_wichtige_info" nur dann füllen, wenn eine wichtige Sache leicht übersehen wird, aber klar aus dem Brief folgt.
- "kurz_gesagt" soll 1 sehr kurzer Satz in sehr einfachem Deutsch sein.

Gib genau dieses JSON zurück:
{
  "absender": "",
  "briefart": "",
  "betroffene_person": "",
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
- "betroffene_person": Name nur wenn klar erkennbar
- "worum_geht_es": 1 sehr kurzer Satz in einfachem Deutsch
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, anmelden, Unterlagen schicken, Termin wahrnehmen, antworten, kündigen, unterschreiben, widersprechen
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
  if (text.includes("stadt")) return "Stadt";
  if (text.includes("bürgermeister")) return "Stadt";
  if (text.includes("bank")) return "Bank";

  return absender || "";
}

function toSentence(text) {
  if (!text) return "";
  const t = String(text).trim().replace(/\.$/, "");
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

function dedupe(arr) {
  const out = [];
  for (const item of arr) {
    const t = String(item || "").trim();
    if (!t) continue;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) {
      out.push(t);
    }
  }
  return out;
}

function simplifyAction(action) {
  const a = action.toLowerCase();

  if (
    a.includes("einwohnermeldeamt") ||
    a.includes("bürgeramt") ||
    a.includes("bei der stadt anmelden") ||
    a.includes("bei der stadt wieder anmelden") ||
    a.includes("bei der stadt melden")
  ) {
    return "die Person soll bei der Stadt angemeldet werden";
  }

  if (a.includes("jobcenter")) {
    return "die Person soll beim Jobcenter angemeldet werden";
  }

  if (a.includes("unterlagen")) {
    return "die Unterlagen sollen geschickt werden";
  }

  if (a.includes("zahlen")) {
    return "du sollst zahlen";
  }

  if (a.includes("antworten")) {
    return "du sollst antworten";
  }

  if (a.includes("unterschreiben")) {
    return "du sollst unterschreiben";
  }

  if (a.includes("kündigen")) {
    return "du sollst kündigen";
  }

  if (a.includes("termin")) {
    return "der Termin ist wichtig";
  }

  if (a.includes("widerspruch")) {
    return "du sollst dich melden, wenn du nicht einverstanden bist";
  }

  if (a.includes("melden")) {
    return "du sollst dich melden";
  }

  return action.replace(/\.$/, "").trim();
}

function applyPersonName(text, personName) {
  if (!text) return "";
  if (!personName) return text;
  return text.replace(/die Person/gi, personName);
}

function renderSimpleGerman(info) {
  const blocks = [];
  const sender = simplifySender(info.absender, info.briefart);

  if (sender) {
    blocks.push(`Wer schreibt?\nDer Brief ist vom ${sender}.`);
  }

  if (info.worum_geht_es) {
    blocks.push(`Worum geht es?\n${toSentence(info.worum_geht_es)}`);
  } else if (info.briefart) {
    blocks.push(`Worum geht es?\n${toSentence(`Es geht um diesen ${info.briefart}`)}`);
  }

  const simpleActions = dedupe(
    (info.was_ist_zu_tun || []).map((x) =>
      applyPersonName(simplifyAction(x), info.betroffene_person)
    )
  );

  if (simpleActions.length > 0 || info.versteckte_wichtige_info) {
    const importantLines = [];

    if (simpleActions.length > 0) {
      importantLines.push(`Wichtig: ${simpleActions.slice(0, 2).join(" und ")}.`);
    }

    if (info.versteckte_wichtige_info) {
      importantLines.push(toSentence(info.versteckte_wichtige_info));
    }

    blocks.push(`Was ist jetzt wichtig?\n${importantLines.join(" ")}`);
  }

  if (info.frist || info.termin) {
    if (info.frist && info.termin) {
      blocks.push(
        `Bis wann?\nWichtig ist diese Frist: ${info.frist}. Wichtiger Termin: ${info.termin}.`
      );
    } else if (info.frist) {
      blocks.push(`Bis wann?\nWichtig ist diese Frist: ${info.frist}.`);
    } else if (info.termin) {
      blocks.push(`Bis wann?\nWichtig ist dieser Termin: ${info.termin}.`);
    }
  }

  if (info.folge_wenn_nichts) {
    let consequence = toSentence(info.folge_wenn_nichts)
      .replace(/verbindlich/gi, "gültig")
      .replace(/wirksam/gi, "gültig")
      .replace(/es können keine leistungen[^.]*\./gi, "Sonst kann Geld fehlen oder gestoppt werden.")
      .replace(/keine leistungen[^.]*\./gi, "Sonst kann Geld fehlen oder gestoppt werden.");

    blocks.push(`Was passiert sonst?\n${consequence}`);
  }

  if (info.kurz_gesagt) {
    let shortText = toSentence(info.kurz_gesagt)
      .replace(/senden sie/gi, "Schicken Sie")
      .replace(/reichen sie/gi, "Schicken Sie")
      .replace(/unterlagen ein/gi, "die Unterlagen");

    blocks.push(`Kurz gesagt:\n${shortText}`);
  } else if (simpleActions.length > 0) {
    blocks.push(`Kurz gesagt:\nDu musst jetzt nur das Wichtige beachten.`);
  } else if (info.frist || info.termin) {
    blocks.push(`Kurz gesagt:\nDu musst jetzt nur die Frist oder den Termin beachten.`);
  } else {
    blocks.push(`Kurz gesagt:\nDu musst jetzt nichts machen.`);
  }

  return blocks.slice(0, 6).join("\n\n");
}

function localizeSectionHeadings(text, lang) {
  if (!text) return text;

  const maps = {
    tr: {
      "Wer schreibt?": "Kim yazıyor?",
      "Worum geht es?": "Konu ne?",
      "Was ist jetzt wichtig?": "Şimdi ne önemli?",
      "Bis wann?": "Ne zamana kadar?",
      "Was passiert sonst?": "Yoksa ne olur?",
      "Kurz gesagt:": "Kısaca:"
    },
    bg: {
      "Wer schreibt?": "Кой е изпратил писмото?",
      "Worum geht es?": "За какво става дума?",
      "Was ist jetzt wichtig?": "Какво е важно сега?",
      "Bis wann?": "До кога?",
      "Was passiert sonst?": "Какво става иначе?",
      "Kurz gesagt:": "Накратко:"
    },
    ar: {
      "Wer schreibt?": "من أرسل الرسالة؟",
      "Worum geht es?": "عن ماذا تتحدث الرسالة؟",
      "Was ist jetzt wichtig?": "ما المهم الآن؟",
      "Bis wann?": "إلى متى؟",
      "Was passiert sonst?": "ماذا يحدث إذا لم أفعل شيئًا؟",
      "Kurz gesagt:": "باختصار:"
    }
  };

  const dict = maps[(lang || "").toLowerCase()];
  if (!dict) return text;

  let result = text;
  for (const [de, translated] of Object.entries(dict)) {
    const escaped = de.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), translated);
  }

  return result;
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
- Halte dieselbe Struktur.
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

  const cleaned = cleanAntwort(translatedRaw);
  return localizeSectionHeadings(cleaned, lang);
}

async function buildFinalAnswerFromText(text, lang) {
  const info = await buildInfoFromText(text);
  const germanBase = cleanAntwort(renderSimpleGerman(info));
  return await translateIfNeeded(germanBase, lang);
}

async function buildFinalAnswerFromImages(bilder, lang) {
  const info = await buildInfoFromImages(bilder);
  const germanBase = cleanAntwort(renderSimpleGerman(info));
  return await translateIfNeeded(germanBase, lang);
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

    return res.json({ ok: true, erklaerung });
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

    return res.json({ ok: true, erklaerung });
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
}); require("express");
