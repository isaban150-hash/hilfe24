const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const apiKey = process.env.GEMINI_API_KEY;
const MODEL = "gemini-2.5-flash";

app.use(express.json({ limit: "25mb" }));
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
        speech: "tr-TR",
        instruction: `
Übersetze den deutschen Text in sehr einfaches, natürliches Türkisch.
Halte die Bedeutung exakt gleich.
Übersetze Satz für Satz.
Erfinde nichts dazu.
Lass nichts Wichtiges weg.
Wenn im Deutschen "Jobcenter" steht, dann bleibt "Jobcenter".
Wenn im Deutschen "AOK" steht, dann bleibt "AOK".
Wenn im Deutschen "Stadtwerke" steht, dann bleibt "Stadtwerke".
Wenn im Deutschen "Jugendamt" steht, dann übersetze es verständlich als "Gençlik Dairesi".
Schreibe natürlich, kurz und klar.
Nicht steif. Nicht wie Google Translate.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        speech: "bg-BG",
        instruction: `
Übersetze den deutschen Text in sehr einfaches, natürliches Bulgarisch.
Halte die Bedeutung exakt gleich.
Übersetze Satz für Satz.
Erfinde nichts dazu.
Lass nichts Wichtiges weg.
`
      };
    case "ar":
      return {
        code: "ar",
        label: "Arabisch",
        speech: "ar-SA",
        instruction: `
Übersetze den deutschen Text in sehr einfaches, natürliches Arabisch.
Halte die Bedeutung exakt gleich.
Übersetze Satz für Satz.
Erfinde nichts dazu.
Lass nichts Wichtiges weg.
`
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        speech: "de-DE",
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

function cleanText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*\d+\.\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    return JSON.parse(fenced[1]);
  }

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
    absender_original: normalizeString(info.absender_original),
    absender_kurz: normalizeString(info.absender_kurz),
    briefart: normalizeString(info.briefart),
    betroffene_person: normalizeString(info.betroffene_person),
    worum_geht_es: normalizeString(info.worum_geht_es),
    wichtigste_punkte: normalizeArray(info.wichtigste_punkte),
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
- "wichtigste_punkte" sollen die 1 bis 3 wichtigsten Sachen aus dem Brief sein, nicht Nebensachen.
- "versteckte_wichtige_info" nur dann füllen, wenn eine wichtige Sache leicht übersehen wird, aber klar aus dem Brief folgt.
- "kurz_gesagt" soll 1 sehr kurzer Satz in sehr einfachem Deutsch sein.

Gib genau dieses JSON zurück:
{
  "absender_original": "",
  "absender_kurz": "",
  "briefart": "",
  "betroffene_person": "",
  "worum_geht_es": "",
  "wichtigste_punkte": [],
  "was_ist_zu_tun": [],
  "frist": "",
  "termin": "",
  "folge_wenn_nichts": "",
  "versteckte_wichtige_info": "",
  "kurz_gesagt": "",
  "unsicherheiten": []
}

Regeln:
- "absender_original": so wie im Brief
- "absender_kurz": kurze, verständliche Form vom Absender
- "briefart": sehr kurz, z. B. "Mahnung", "Rechnung", "Einladung", "Info-Brief", "Versicherungsbrief", "Bewilligung", "Ablehnung", "Werbung"
- "betroffene_person": Name nur wenn klar erkennbar
- "worum_geht_es": 1 sehr kurzer Satz in einfachem Deutsch
- "wichtigste_punkte": 1 bis 3 echte Kernpunkte
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, antworten, anmelden, Unterlagen schicken, Termin wahrnehmen, unterschreiben, widersprechen
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
- "wichtigste_punkte" sollen die 1 bis 3 wichtigsten Sachen aus dem Brief sein, nicht Nebensachen.
- "versteckte_wichtige_info" nur dann füllen, wenn eine wichtige Sache leicht übersehen wird, aber klar aus dem Brief folgt.
- "kurz_gesagt" soll 1 sehr kurzer Satz in sehr einfachem Deutsch sein.

Gib genau dieses JSON zurück:
{
  "absender_original": "",
  "absender_kurz": "",
  "briefart": "",
  "betroffene_person": "",
  "worum_geht_es": "",
  "wichtigste_punkte": [],
  "was_ist_zu_tun": [],
  "frist": "",
  "termin": "",
  "folge_wenn_nichts": "",
  "versteckte_wichtige_info": "",
  "kurz_gesagt": "",
  "unsicherheiten": []
}

Regeln:
- "absender_original": so wie im Brief
- "absender_kurz": kurze, verständliche Form vom Absender
- "briefart": sehr kurz
- "betroffene_person": Name nur wenn klar erkennbar
- "worum_geht_es": 1 sehr kurzer Satz in einfachem Deutsch
- "wichtigste_punkte": 1 bis 3 echte Kernpunkte
- "was_ist_zu_tun": nur klare Handlungen wie zahlen, melden, antworten, anmelden, Unterlagen schicken, Termin wahrnehmen, unterschreiben, widersprechen
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

function buildImageQualityCheckPrompt() {
  return `
Du prüfst nur die Bildqualität und Vollständigkeit eines Brief-Fotos.

Antworte NUR als JSON.

Gib genau dieses JSON zurück:
{
  "ok": true,
  "problem": "",
  "hinweis": ""
}

Regeln:
- "ok": true nur wenn der Brief sicher genug lesbar und vollständig genug ist
- "ok": false wenn das Bild zu unscharf, abgeschnitten, zu dunkel, mit Schatten verdeckt, zu weit weg oder unvollständig ist
- "ok": false auch dann, wenn der Brief im Bild zu klein ist oder zu viel Hintergrund zu sehen ist
- "ok": false auch dann, wenn wahrscheinlich noch eine weitere Seite, Rückseite oder Anlage fehlt
- "problem": sehr kurz
- "hinweis": sehr einfacher Satz für den Nutzer

Wichtige Zusatzregeln:
- Wenn viel Tisch, Boden, Hände oder Umgebung sichtbar sind und der Brief nicht groß genug im Bild ist, dann setze "ok": false
- Wenn Hinweise auf weitere Seiten, Rückseite oder Anlagen erkennbar sind, dann setze "ok": false
- Sei streng
- Lieber einmal zu früh stoppen als ein schlechtes oder unvollständiges Foto durchlassen

Beispiele:
- "Das Bild ist zu unscharf. Bitte schick ein schärferes Foto."
- "Die Seite ist nicht ganz drauf. Bitte fotografiere die ganze Seite."
- "Der Brief ist zu weit weg. Bitte mach ein näheres Foto nur vom Brief."
- "Es fehlt noch eine Seite. Bitte lade auch die nächste Seite hoch."
- "Bitte lade auch die Rückseite oder die fehlende Seite hoch."

Wenn das Bild gut genug ist, gib zurück:
{
  "ok": true,
  "problem": "",
  "hinweis": ""
}
`;
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

function simplifyActionBase(action) {
  const a = String(action || "").toLowerCase();

  if (
    a.includes("einwohnermeldeamt") ||
    a.includes("bürgeramt") ||
    a.includes("bei der stadt anmelden") ||
    a.includes("bei der stadt wieder anmelden") ||
    a.includes("bei der stadt melden")
  ) {
    return "bei der Stadt anmelden";
  }

  if (a.includes("jobcenter")) {
    return "beim Jobcenter anmelden";
  }

  if (a.includes("unterlagen")) {
    return "Unterlagen schicken";
  }

  if (a.includes("zahlen") || a.includes("überweisen")) {
    return "zahlen";
  }

  if (a.includes("antworten")) {
    return "antworten";
  }

  if (a.includes("unterschreiben")) {
    return "unterschreiben";
  }

  if (a.includes("kündigen")) {
    return "kündigen";
  }

  if (a.includes("anmelden")) {
    return "anmelden";
  }

  if (a.includes("termin")) {
    return "zum Termin gehen";
  }

  if (a.includes("widerspruch")) {
    return "melden, wenn du nicht einverstanden bist";
  }

  if (a.includes("melden")) {
    return "melden";
  }

  return String(action || "").replace(/\.$/, "").trim();
}

function renderShortByLanguage(info, lang) {
  const sender = info.absender_kurz || info.absender_original || "";
  const actions = dedupe((info.was_ist_zu_tun || []).map(simplifyActionBase));
  const lines = [];

  if (lang === "tr") {
    if (sender) lines.push(`Bu mektup ${sender} gönderdi.`);
    if (actions.length > 0) lines.push(`Yapman gereken: ${actions[0]}.`);
    else if (info.worum_geht_es) lines.push(toSentence(info.worum_geht_es));
    else if (info.kurz_gesagt) lines.push(toSentence(info.kurz_gesagt));
    if (info.frist) lines.push(`Son gün: ${info.frist}.`);
    else if (info.termin) lines.push(`Tarih: ${info.termin}.`);
    if (info.folge_wenn_nichts) lines.push(toSentence(info.folge_wenn_nichts));
    else if (info.kurz_gesagt) lines.push(toSentence(info.kurz_gesagt));
    return lines.slice(0, 4).join("\n");
  }

  if (lang === "bg") {
    if (sender) lines.push(`Това е писмо от ${sender}.`);
    if (actions.length > 0) lines.push(`Трябва да ${actions[0]}.`);
    else if (info.worum_geht_es) lines.push(toSentence(info.worum_geht_es));
    else if (info.kurz_gesagt) lines.push(toSentence(info.kurz_gesagt));
    if (info.frist) lines.push(`Срок: ${info.frist}.`);
    else if (info.termin) lines.push(`Дата: ${info.termin}.`);
    if (info.folge_wenn_nichts) lines.push(toSentence(info.folge_wenn_nichts));
    else if (info.kurz_gesagt) lines.push(toSentence(info.kurz_gesagt));
    return lines.slice(0, 4).join("\n");
  }

  if (lang === "ar") {
    if (sender) lines.push(`هذه رسالة من ${sender}.`);
    if (actions.length > 0) lines.push(`يجب عليك أن ${actions[0]}.`);
    else if (info.worum_geht_es) lines.push(toSentence(info.worum_geht_es));
    else if (info.kurz_gesagt) lines.push(toSentence(info.kurz_gesagt));
    if (info.frist) lines.push(`آخر موعد: ${info.frist}.`);
    else if (info.termin) lines.push(`الموعد: ${info.termin}.`);
    if (info.folge_wenn_nichts) lines.push(toSentence(info.folge_wenn_nichts));
    else if (info.kurz_gesagt) lines.push(toSentence(info.kurz_gesagt));
    return lines.slice(0, 4).join("\n");
  }

  if (sender) lines.push(`Das ist ein Brief von ${sender}.`);
  if (actions.length > 0) lines.push(`Du musst ${actions[0]}.`);
  else if (info.worum_geht_es) lines.push(toSentence(info.worum_geht_es));
  else if (info.kurz_gesagt) lines.push(toSentence(info.kurz_gesagt));
  if (info.frist) lines.push(`Bis ${info.frist}.`);
  else if (info.termin) lines.push(`Termin: ${info.termin}.`);
  if (info.folge_wenn_nichts) lines.push(toSentence(info.folge_wenn_nichts));
  else if (info.kurz_gesagt) lines.push(toSentence(info.kurz_gesagt));

  return lines.slice(0, 4).join("\n");
}

function renderDetailTemplateGerman(info) {
  const blocks = [];
  const sender = info.absender_kurz || info.absender_original;

  if (sender) {
    blocks.push(`[[HEAD_FROM]]\nDer Brief ist von ${sender}.`);
  }

  if (info.worum_geht_es) {
    blocks.push(`[[HEAD_TOPIC]]\n${toSentence(info.worum_geht_es)}`);
  }

  const importantPoints = dedupe(info.wichtigste_punkte || []);
  const actions = dedupe((info.was_ist_zu_tun || []).map(simplifyActionBase));

  if (importantPoints.length > 0 || actions.length > 0 || info.versteckte_wichtige_info) {
    const lines = [];

    for (const p of importantPoints.slice(0, 2)) {
      lines.push(toSentence(p));
    }

    if (actions.length > 0) {
      lines.push(`Wichtig: Du musst ${actions.slice(0, 2).join(" und ")}.`);
    }

    if (info.versteckte_wichtige_info) {
      lines.push(toSentence(info.versteckte_wichtige_info));
    }

    blocks.push(`[[HEAD_IMPORTANT]]\n${lines.join(" ")}`);
  }

  if (info.frist || info.termin) {
    const parts = [];
    if (info.frist) parts.push(`Frist: ${info.frist}.`);
    if (info.termin) parts.push(`Termin: ${info.termin}.`);
    blocks.push(`[[HEAD_WHEN]]\n${parts.join(" ")}`);
  }

  if (info.folge_wenn_nichts) {
    blocks.push(`[[HEAD_ELSE]]\n${toSentence(info.folge_wenn_nichts)}`);
  }

  if (info.kurz_gesagt) {
    blocks.push(`[[HEAD_SUMMARY]]\n${toSentence(info.kurz_gesagt)}`);
  } else if (actions.length > 0) {
    blocks.push(`[[HEAD_SUMMARY]]\nDu musst jetzt das Wichtige beachten.`);
  } else {
    blocks.push(`[[HEAD_SUMMARY]]\nDu musst jetzt nichts machen.`);
  }

  return blocks.join("\n\n");
}

function localizeDetailHeadings(text, lang) {
  const maps = {
    de: {
      "[[HEAD_FROM]]": "Wer schreibt?",
      "[[HEAD_TOPIC]]": "Worum geht es?",
      "[[HEAD_IMPORTANT]]": "Was ist jetzt wichtig?",
      "[[HEAD_WHEN]]": "Bis wann?",
      "[[HEAD_ELSE]]": "Was passiert sonst?",
      "[[HEAD_SUMMARY]]": "Kurz gesagt:"
    },
    tr: {
      "[[HEAD_FROM]]": "Kim yazıyor?",
      "[[HEAD_TOPIC]]": "Konu ne?",
      "[[HEAD_IMPORTANT]]": "Şimdi ne önemli?",
      "[[HEAD_WHEN]]": "Ne zamana kadar?",
      "[[HEAD_ELSE]]": "Yoksa ne olur?",
      "[[HEAD_SUMMARY]]": "Kısaca:"
    },
    bg: {
      "[[HEAD_FROM]]": "Кой е изпратил писмото?",
      "[[HEAD_TOPIC]]": "За какво става дума?",
      "[[HEAD_IMPORTANT]]": "Какво е важно сега?",
      "[[HEAD_WHEN]]": "До кога?",
      "[[HEAD_ELSE]]": "Какво става иначе?",
      "[[HEAD_SUMMARY]]": "Накратко:"
    },
    ar: {
      "[[HEAD_FROM]]": "من أرسل الرسالة؟",
      "[[HEAD_TOPIC]]": "عن ماذا تتحدث الرسالة؟",
      "[[HEAD_IMPORTANT]]": "ما المهم الآن؟",
      "[[HEAD_WHEN]]": "إلى متى؟",
      "[[HEAD_ELSE]]": "ماذا يحدث إذا لم أفعل شيئًا؟",
      "[[HEAD_SUMMARY]]": "باختصار:"
    }
  };

  const dict = maps[lang] || maps.de;
  let result = text;

  for (const [token, heading] of Object.entries(dict)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), heading);
  }

  return result;
}

function buildTranslationPrompt(text, langMeta, keepHeadingTokens = false) {
  return `
Du bist Hilfe24.

Unten steht ein fertiger deutscher Text.
Übersetze ihn sauber in ${langMeta.label}.

Wichtig:
${langMeta.instruction}

Regeln:
- Übersetze Satz für Satz.
- Erfinde nichts dazu.
- Lass nichts weg.
- Füge keine neuen Sätze ein.
- Keine Ausschmückung.
- Keine Wiederholung.
- Kein Markdown.
${keepHeadingTokens ? "- Die Tokens wie [[HEAD_FROM]] dürfen NICHT verändert werden." : ""}

Deutscher Text:
${text}
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

async function checkImageQuality(bilder) {
  const parts = [{ text: buildImageQualityCheckPrompt() }];

  for (const bild of bilder) {
    if (!bild.imageData || !bild.mimeType) continue;
    parts.push({
      inline_data: {
        mime_type: bild.mimeType,
        data: bild.imageData
      }
    });
  }

  const raw = await callGemini(parts);
  return extractJson(raw);
}

async function translateDetailIfNeeded(text, lang) {
  const langMeta = getLanguageMeta(lang);
  if (langMeta.code === "de") {
    return localizeDetailHeadings(text, "de");
  }

  const translatedRaw = await callGemini([
    { text: buildTranslationPrompt(text, langMeta, true) }
  ]);

  return localizeDetailHeadings(cleanText(translatedRaw), langMeta.code);
}

async function buildFinalPayloadFromInfo(info, lang) {
  const langCode = getLanguageMeta(lang).code;
  const kurz = cleanText(renderShortByLanguage(info, langCode));
  const detailTemplateDe = cleanText(renderDetailTemplateGerman(info));
  const details = await translateDetailIfNeeded(detailTemplateDe, langCode);

  return {
    ok: true,
    quality_ok: true,
    hinweis: "",
    kurz,
    details,
    audio_kurz: kurz,
    audio_details: details
  };
}

async function buildFinalAnswerFromText(text, lang) {
  const info = await buildInfoFromText(text);
  return await buildFinalPayloadFromInfo(info, lang);
}

async function buildFinalAnswerFromImages(bilder, lang) {
  if (!Array.isArray(bilder) || bilder.length === 0) {
    return {
      ok: false,
      error: "Kein Bild gesendet"
    };
  }

  if (bilder.length > 6) {
    return {
      ok: false,
      error: "Du kannst maximal 6 Bilder hochladen."
    };
  }

  const quality = await checkImageQuality(bilder);

  if (!quality.ok) {
    return {
      ok: true,
      quality_ok: false,
      hinweis: quality.hinweis || "Das Bild ist nicht gut genug. Bitte schick ein neues Foto.",
      kurz: "",
      details: "",
      audio_kurz: "",
      audio_details: ""
    };
  }

  const info = await buildInfoFromImages(bilder);
  return await buildFinalPayloadFromInfo(info, lang);
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

    const result = await buildFinalAnswerFromText(text, lang);
    return res.json(result);
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

    const result = await buildFinalAnswerFromImages(bilder, lang);

    if (!result.ok && result.error) {
      return res.status(400).json(result);
    }

    return res.json(result);
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
