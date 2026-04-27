const express = require("express");
const path = require("path");
const textToSpeech = require("@google-cloud/text-to-speech");

function createTtsClient() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON;

  if (raw && raw.trim()) {
    const credentials = JSON.parse(raw);

    return new textToSpeech.TextToSpeechClient({
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key
      },
      projectId: credentials.project_id
    });
  }

  return new textToSpeech.TextToSpeechClient();
}

const app = express();
const PORT = process.env.PORT || 8080;
const apiKey = process.env.GEMINI_API_KEY;
const MODEL = "gemini-2.5-flash";
const ttsClient = createTtsClient();

app.use(express.json({ limit: "25mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.json({
    ok: true,
    message: "Server läuft sauber"
  });
});

function getLanguageMeta(lang) {
  switch ((lang || "de").toLowerCase()) {
    case "tr":
      return {
        code: "tr",
        label: "Türkisch",
        ttsLanguageCode: "tr-TR",
        ttsVoiceName: "",
        ttsGender: "FEMALE"
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        ttsLanguageCode: "bg-BG",
        ttsVoiceName: "",
        ttsGender: "FEMALE"
      };
    case "ar":
      return {
        code: "ar",
        label: "Arabisch",
        ttsLanguageCode: "ar-XA",
        ttsVoiceName: "",
        ttsGender: "FEMALE"
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        ttsLanguageCode: "de-DE",
        ttsVoiceName: "",
        ttsGender: "FEMALE"
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
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizeInfo(info) {
  function normalizePerson(value) {
    const v = normalizeString(value);

    if (!v) return "";

    const lower = v.toLowerCase();

    const invalidExact = new Set([
      "sie",
      "ihr",
      "ihnen",
      "empfänger",
      "adressat",
      "adressatin",
      "betroffene person",
      "person",
      "unbekannt",
      "nicht genannt",
      "nicht erkennbar",
      "n/a",
      "-"
    ]);

    if (invalidExact.has(lower)) return "";

    if (/^(herr|frau)$/i.test(v)) return "";
    if (/^[A-Z0-9\-\/]{6,}$/.test(v.replace(/\s+/g, ""))) return "";
    if (v.length < 2) return "";

    return v;
  }

  function normalizeChoice(value, allowed, fallback = "") {
    const v = normalizeString(value).toLowerCase();
    if (!v) return fallback;
    return allowed.includes(v) ? v : fallback;
  }

  return {
    absender_original: normalizeString(info.absender_original),
    absender_kurz: normalizeString(info.absender_kurz),
    briefart: normalizeString(info.briefart),
    betroffene_person: normalizePerson(info.betroffene_person),
    worum_geht_es: normalizeString(info.worum_geht_es),
    wichtigste_punkte: normalizeArray(info.wichtigste_punkte),
    was_ist_zu_tun: normalizeArray(info.was_ist_zu_tun),
    frist: normalizeString(info.frist),
    termin: normalizeString(info.termin),
    folge_wenn_nichts: normalizeString(info.folge_wenn_nichts),
    versteckte_wichtige_info: normalizeString(info.versteckte_wichtige_info),
    kurz_gesagt: normalizeString(info.kurz_gesagt),
    unsicherheiten: normalizeArray(info.unsicherheiten),

    pflicht_oder_freiwillig: normalizeChoice(
      info.pflicht_oder_freiwillig,
      ["pflicht", "freiwillig", "information", "werbung", "unklar"],
      "unklar"
    ),
    dringlichkeit: normalizeChoice(
      info.dringlichkeit,
      ["hoch", "mittel", "niedrig", "unklar"],
      "unklar"
    ),
    naechster_schritt: normalizeString(info.naechster_schritt),
    betrag: normalizeString(info.betrag),
    unterlagen: normalizeArray(info.unterlagen)
  };
}

function buildExtractionPromptForImages() {
  return `
Du bist Hilfe24.

Lies die Bilder dieses Briefes und gib NUR gültiges JSON zurück.

ZIEL:
Du sollst jeden Brief allgemein verstehen.
Nicht auf eine bestimmte Behörde fixieren.
Nicht raten.
Nicht dramatisieren.
Nicht verharmlosen.

Du musst erkennen:
- Wer schreibt?
- Für wen ist der Brief?
- Was ist die Briefart?
- Ist es Pflicht, freiwillig, Information, Werbung oder unklar?
- Wie dringend ist es?
- Was ist der nächste konkrete Schritt?
- Gibt es Frist, Termin, Betrag oder Unterlagen?
- Was passiert, wenn nichts gemacht wird?

ALLGEMEINE BRIEFLOGIK:

1. Pflicht
Wenn der Brief klar verlangt, dass etwas getan werden muss, dann ist "pflicht_oder_freiwillig": "pflicht".
Beispiele:
- Unterlagen einreichen
- Betrag zahlen
- Termin wahrnehmen
- Stellungnahme abgeben
- Formular ausfüllen
- Nachweise schicken
- Widerspruchsfrist beachten
- Kündigung beachten
- Meldeaufforderung
- Anhörung
- Mahnung
- Forderung

2. Freiwillig
Wenn der Brief nur ein Angebot oder eine freiwillige Möglichkeit nennt, dann ist "pflicht_oder_freiwillig": "freiwillig".
Beispiele:
- freiwillige Untersuchung
- optionales Angebot
- wenn Sie möchten
- wenn Sie teilnehmen möchten
- können Sie nutzen
- keine Nachteile bei Nichtteilnahme

3. Information
Wenn der Brief nur informiert und keine Handlung verlangt, dann ist "pflicht_oder_freiwillig": "information".
Beispiele:
- reine Information
- Hinweis
- Bestätigung
- Mitteilung ohne Frist und ohne Pflicht

4. Werbung
Wenn der Brief wie Werbung, Verkauf, Gewinnspiel oder Angebot wirkt und keine echte Pflicht enthält, dann ist "pflicht_oder_freiwillig": "werbung".

5. Unklar
Wenn nicht klar erkennbar ist, ob eine Pflicht besteht, dann ist "pflicht_oder_freiwillig": "unklar".
Dann bei "unsicherheiten" kurz erklären, was unklar ist.

DRINGLICHKEIT:

"hoch":
- Gericht
- Polizei
- Kündigung
- Mahnung mit kurzer Frist
- Jobcenter-Termin / Meldeaufforderung
- Leistungskürzung möglich
- Zwangsvollstreckung möglich
- Frist läuft bald
- Zahlungsfrist

"mittel":
- Unterlagen sollen eingereicht werden
- Antrag / Nachweis / Rückmeldung nötig
- Termin oder Frist vorhanden, aber nicht akut bedrohlich

"niedrig":
- reine Information
- freiwilliges Angebot
- Werbung
- keine Nachteile bei Nichtteilnahme

"unklar":
- wenn Frist/Folge/Handlung nicht sicher erkennbar ist

FÜR "naechster_schritt":
Schreibe genau 1 klaren nächsten Schritt in einfacher Sprache.
Beispiele:
- "Gehen Sie am genannten Termin zum Jobcenter und bringen Sie die Unterlagen mit."
- "Zahlen Sie den Betrag fristgerecht, wenn die Forderung stimmt."
- "Schicken Sie die genannten Unterlagen bis zur Frist."
- "Sie müssen nichts tun, wenn Sie das Angebot nicht nutzen möchten."
- "Prüfen Sie die Forderung und holen Sie Hilfe, wenn Sie unsicher sind."

FÜR "was_ist_zu_tun":
Nur konkrete Schritte eintragen.
Keine allgemeine Floskel wie "auf den Brief reagieren", wenn nicht klar eine Reaktion verlangt wird.

FÜR "betrag":
Nur füllen, wenn ein Geldbetrag klar genannt ist.
Beispiel: "89,50 €"

FÜR "unterlagen":
Nur füllen, wenn konkrete Unterlagen genannt sind.
Beispiele:
- aktueller Lebenslauf
- letztes Bewerbungsschreiben
- Nachweise über Eigenbemühungen
- Kontoauszüge
- Mietvertrag
- Arbeitsunfähigkeitsbescheinigung

FÜR "frist":
Nur füllen, wenn eine Frist klar genannt ist.
Beispiele:
- "innerhalb einer Woche nach Eingang dieser Mahnung"
- "bis zum 15.05.2026"

FÜR "termin":
Nur füllen, wenn ein Termin klar genannt ist.
Beispiel:
- "Mittwoch, 29.04.2026 um 10:00 Uhr, Zimmer E09"

FÜR "folge_wenn_nichts":
Nur füllen, wenn im Brief klar steht, was passiert.
Wenn dort steht, dass keine Nachteile entstehen, dann genau das eintragen.
Keine Folgen erfinden.

FÜR "kurz_gesagt":
Genau 1 kurzer sachlicher Satz in einfachem Deutsch.
Der Satz soll den Kern treffen:
- Bei Pflicht: was muss getan werden?
- Bei Termin: wann muss man erscheinen?
- Bei Mahnung: was muss gezahlt/geprüft werden?
- Bei Information: dass es nur Information/freiwillig ist
- Bei Werbung: dass es ein Angebot/Werbung ist

WICHTIGE REGELN:
- Erfinde nichts.
- Keine Rechtsberatung.
- Keine medizinische Diagnose.
- Keine Panik machen.
- Keine Pflicht erfinden.
- Keine Information weglassen, wenn sie wichtig ist.
- Namen, Daten, Uhrzeiten, Beträge, Behörden und Folgen exakt übernehmen.
- Wenn mehrere Seiten fehlen oder etwas nicht lesbar ist, schreibe das bei "unsicherheiten".

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
  "unsicherheiten": [],
  "pflicht_oder_freiwillig": "unklar",
  "dringlichkeit": "unklar",
  "naechster_schritt": "",
  "betrag": "",
  "unterlagen": []
}

Gib nur JSON zurück.
`;
}
function buildImageQualityCheckPrompt() {
  return `
Du prüfst nur, ob ein Brief-Foto gut genug ist, damit Hilfe24 den Brief einfach erklären kann.

Antworte NUR als JSON.

Gib genau dieses JSON zurück:
{
  "ok": true,
  "problem": "",
  "hinweis": ""
}

Regeln:
- "ok": true, wenn der Brief insgesamt gut genug lesbar ist
- "ok": false nur dann, wenn das Bild klar schlecht ist
- Sei nicht zu streng
- Ein Foto muss NICHT perfekt sein
- Wenn die ganze Seite sichtbar und der Text größtenteils lesbar ist, dann setze "ok": true
- Nicht wegen jeder kleinen Unsicherheit stoppen
- Nicht wegen möglicher fehlender Seite stoppen, wenn die sichtbare Seite gut genug erkennbar ist
- Nur blockieren bei klaren Problemen

Blockiere nur bei solchen Fällen:
- Bild stark unscharf
- Bild zu dunkel
- großer Schatten auf wichtigem Text
- Seite stark abgeschnitten
- Brief viel zu klein im Bild
- sehr viel Hintergrund und Text kaum lesbar
- wichtige Teile klar nicht lesbar

Dann setze:
- "ok": false
- "problem": sehr kurz
- "hinweis": genau 1 kurzer einfacher Satz

Wenn das Foto brauchbar ist, auch wenn es nicht perfekt ist, dann gib zurück:
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
    return "register_city";
  }

  if (a.includes("jobcenter")) return "register_jobcenter";
  if (a.includes("unterlagen")) return "send_documents";
  if (a.includes("zahlen") || a.includes("überweisen")) return "pay";
  if (a.includes("antworten")) return "reply";
  if (a.includes("unterschreiben")) return "sign";
  if (a.includes("kündigen")) return "cancel";
  if (a.includes("anmelden") || a.includes("registrieren")) return "register";
  if (a.includes("termin")) return "attend_appointment";
  if (a.includes("widerspruch")) return "object_if_disagree";
  if (a.includes("melden")) return "contact";

  return String(action || "").replace(/\.$/, "").trim();
}

function actionText(code, language) {
  const map = {
    de: {
      register: "dich anmelden",
      register_city: "die Person bei der Stadt anmelden",
      register_jobcenter: "die Person beim Jobcenter anmelden",
      send_documents: "Unterlagen schicken",
      pay: "zahlen",
      reply: "antworten",
      sign: "unterschreiben",
      cancel: "kündigen",
      attend_appointment: "zum Termin gehen",
      object_if_disagree: "dich melden, wenn du nicht einverstanden bist",
      contact: "dich melden"
    },
    tr: {
      register: "kayıt olmanız gerekiyor",
      register_city: "kişiyi belediyeye kaydetmeniz gerekiyor",
      register_jobcenter: "kişiyi Jobcenter'a kaydetmeniz gerekiyor",
      send_documents: "belgeleri göndermeniz gerekiyor",
      pay: "ödeme yapmanız gerekiyor",
      reply: "cevap vermeniz gerekiyor",
      sign: "imzalamanız gerekiyor",
      cancel: "iptal etmeniz gerekiyor",
      attend_appointment: "randevuya gitmeniz gerekiyor",
      object_if_disagree: "kabul etmiyorsanız bildirmeniz gerekiyor",
      contact: "iletişime geçmeniz gerekiyor"
    },
    bg: {
      register: "трябва да се регистрирате",
      register_city: "трябва да регистрирате лицето в общината",
      register_jobcenter: "трябва да регистрирате лицето в Jobcenter",
      send_documents: "трябва да изпратите документите",
      pay: "трябва да платите",
      reply: "трябва да отговорите",
      sign: "трябва да подпишете",
      cancel: "трябва да прекратите",
      attend_appointment: "трябва да отидете на срещата",
      object_if_disagree: "трябва да се свържете, ако не сте съгласни",
      contact: "трябва да се свържете"
    },
    ar: {
      register: "يجب عليك التسجيل",
      register_city: "يجب عليك تسجيل الشخص في البلدية",
      register_jobcenter: "يجب عليك تسجيل الشخص في الجوب سنتر",
      send_documents: "يجب عليك إرسال المستندات",
      pay: "يجب عليك الدفع",
      reply: "يجب عليك الرد",
      sign: "يجب عليك التوقيع",
      cancel: "يجب عليك الإلغاء",
      attend_appointment: "يجب عليك الذهاب إلى الموعد",
      object_if_disagree: "يجب عليك التواصل إذا لم تكن موافقًا",
      contact: "يجب عليك التواصل"
    }
  };

  return map[language]?.[code] || "";
}

function renderShortByLanguage(info, lang) {
  const sender = String(info.absender_kurz || info.absender_original || "").trim();
  const briefart = String(info.briefart || "").trim();
  const nextStep = String(info.naechster_schritt || "").trim();
  const consequence = String(info.folge_wenn_nichts || "").trim();
  const deadline = String(info.frist || "").trim();
  const appointment = String(info.termin || "").trim();
  const amount = String(info.betrag || "").trim();
  const duty = String(info.pflicht_oder_freiwillig || "unklar").trim();
  const urgency = String(info.dringlichkeit || "unklar").trim();
  const documents = dedupe(info.unterlagen || []);
  const summary = String(info.kurz_gesagt || "").trim();
  const actions = dedupe(info.was_ist_zu_tun || []);
  const topic = String(info.worum_geht_es || "").trim();

  const lines = [];

  function cleanSentence(text) {
    return String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\.$/, "");
  }

  function pushLine(text) {
    const clean = cleanSentence(text);
    if (!clean) return;
    lines.push(clean + ".");
  }

  function hasAny(text, words) {
    const lower = String(text || "").toLowerCase();
    return words.some((word) => lower.includes(word));
  }

  function typeLine() {
    if (duty === "pflicht") {
      if (briefart && sender) return `Das ist ein wichtiger ${briefart} von ${sender}`;
      if (sender) return `Das ist ein wichtiger Brief von ${sender}`;
      if (briefart) return `Das ist ein wichtiger ${briefart}`;
      return "Das ist ein wichtiger Brief";
    }

    if (duty === "freiwillig") {
      if (sender) return `Das ist ein freiwilliges Angebot von ${sender}`;
      return "Das ist ein freiwilliges Angebot";
    }

    if (duty === "information") {
      if (sender) return `Das ist eine Information von ${sender}`;
      return "Das ist eine Information";
    }

    if (duty === "werbung") {
      if (sender) return `Das wirkt wie Werbung oder ein Angebot von ${sender}`;
      return "Das wirkt wie Werbung oder ein Angebot";
    }

    if (briefart && sender) return `Das ist ein ${briefart} von ${sender}`;
    if (sender) return `Das ist ein Brief von ${sender}`;
    if (briefart) return `Das ist ein ${briefart}`;
    return "Das ist ein Brief";
  }

  function shortNextStep() {
    const text = cleanSentence(nextStep || actions[0] || summary || topic);

    if (!text) return "";

    if (hasAny(text, ["termin", "erscheinen", "kommen", "jobcenter", "melde"])) {
      return "Gehen Sie zum genannten Termin";
    }

    if (hasAny(text, ["zahlen", "zahlung", "betrag", "überweisen", "forderung"])) {
      return amount ? `Prüfen und zahlen Sie den Betrag von ${amount}` : "Prüfen Sie die Forderung und zahlen Sie fristgerecht";
    }

    if (hasAny(text, ["unterlagen", "nachweise", "einreichen", "schicken", "senden"])) {
      return "Schicken Sie die genannten Unterlagen";
    }

    if (hasAny(text, ["freiwillig", "angebot", "teilnehmen", "untersuchung"])) {
      return "Sie entscheiden selbst, ob Sie das Angebot nutzen möchten";
    }

    if (text.length <= 90) return text;

    return "Prüfen Sie den Brief und den nächsten Schritt";
  }

  function shortConsequence() {
    const text = cleanSentence(consequence);

    if (!text) return "";

    if (hasAny(text, ["10", "prozent", "%", "bürgergeld", "gekürzt", "minderung"])) {
      return "Sonst kann Bürgergeld gekürzt werden";
    }

    if (hasAny(text, ["zwangsvollstreckung", "zwangsweise", "einziehung"])) {
      return "Sonst können weitere Kosten oder Zwangsvollstreckung folgen";
    }

    if (hasAny(text, ["keine nachteile", "keinerlei nachteile", "keinen nachteil"])) {
      return "Wenn Sie nicht teilnehmen, entstehen keine Nachteile";
    }

    if (text.length <= 95) return "Sonst: " + text;

    return "Sonst können Nachteile entstehen";
  }

  pushLine(typeLine());

  if (duty === "freiwillig" || duty === "information" || duty === "werbung") {
    if (summary) {
      pushLine(summary.length <= 95 ? summary : topic || "Es geht um eine Information oder ein Angebot");
    } else if (topic) {
      pushLine(topic.length <= 95 ? topic : "Es geht um eine Information oder ein Angebot");
    }

    pushLine(shortNextStep());

    const consequenceLine = shortConsequence();
    if (consequenceLine) pushLine(consequenceLine);

    return dedupe(lines.filter(Boolean)).slice(0, 5).join("\n");
  }

  const step = shortNextStep();
  if (step) pushLine(step);

  if (appointment) {
    pushLine(`Termin: ${cleanSentence(appointment)}`);
  } else if (deadline) {
    pushLine(`Frist: ${cleanSentence(deadline)}`);
  }

  if (amount) {
    pushLine(`Betrag: ${cleanSentence(amount)}`);
  }

  if (documents.length > 0) {
    pushLine(`Mitbringen/Schicken: ${documents.slice(0, 3).join(", ")}`);
  }

  if (deadline && appointment) {
    pushLine(`Frist: ${cleanSentence(deadline)}`);
  }

  const consequenceLine = shortConsequence();
  if (consequenceLine) {
    pushLine(consequenceLine);
  } else if (urgency === "hoch") {
    pushLine("Bitte schnell prüfen");
  }

  return dedupe(lines.filter(Boolean)).slice(0, 5).join("\n");
}
function renderDetailTemplateGerman(info) {
  const blocks = [];
  const sender = String(info.absender_kurz || info.absender_original || "").trim();
  const topic = String(info.worum_geht_es || "").trim();
  const summary = String(info.kurz_gesagt || "").trim();
  const consequence = String(info.folge_wenn_nichts || "").trim();
  const hiddenInfo = String(info.versteckte_wichtige_info || "").trim();
  const importantPoints = dedupe(info.wichtigste_punkte || []);
  const actions = dedupe((info.was_ist_zu_tun || []).map(simplifyActionBase));

  function safeSentence(text) {
    return toSentence(String(text || "").trim());
  }

  function actionTextDe(code) {
    const map = {
      register: "Sie müssen sich anmelden.",
      register_city: "Die Person muss bei der Stadt angemeldet werden.",
      register_jobcenter: "Die Person muss beim Jobcenter angemeldet werden.",
      send_documents: "Die Unterlagen müssen geschickt werden.",
      pay: "Sie müssen zahlen.",
      reply: "Sie müssen antworten.",
      sign: "Sie müssen unterschreiben.",
      cancel: "Sie müssen kündigen.",
      attend_appointment: "Sie müssen zum Termin gehen.",
      object_if_disagree: "Wenn Sie nicht einverstanden sind, müssen Sie sich melden oder widersprechen.",
      contact: "Sie müssen sich melden."
    };

    return map[code] || "";
  }

  const actionLines = actions
    .map(actionTextDe)
    .filter(Boolean);

  const importantLines = [];
  const seen = new Set();

  function pushUniqueLine(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    importantLines.push(clean);
  }

  for (const p of importantPoints.slice(0, 3)) {
    pushUniqueLine(safeSentence(p));
  }

  for (const a of actionLines.slice(0, 2)) {
    pushUniqueLine(a);
  }

  if (hiddenInfo) {
    pushUniqueLine(safeSentence(hiddenInfo));
  }

  if (sender) {
    blocks.push(`[[HEAD_FROM]]\nDer Brief ist von ${sender}.`);
  }
if (info.betroffene_person) {
  blocks.push(`[[HEAD_PERSON]]\nDer Brief betrifft ${info.betroffene_person}.`);
}
  if (topic) {
    blocks.push(`[[HEAD_TOPIC]]\n${safeSentence(topic)}`);
  } else if (importantPoints[0]) {
    blocks.push(`[[HEAD_TOPIC]]\n${safeSentence(importantPoints[0])}`);
  } else if (actionLines[0]) {
    blocks.push(`[[HEAD_TOPIC]]\n${actionLines[0]}`);
  }

  if (importantLines.length > 0) {
    blocks.push(`[[HEAD_IMPORTANT]]\n${importantLines.join(" ")}`);
  } else if (actionLines[0]) {
    blocks.push(`[[HEAD_IMPORTANT]]\n${actionLines[0]}`);
  }

  const whenParts = [];
  if (info.frist) whenParts.push(`Frist: ${String(info.frist).trim()}.`);
  if (info.termin) whenParts.push(`Termin: ${String(info.termin).trim()}.`);

  if (whenParts.length > 0) {
    blocks.push(`[[HEAD_WHEN]]\n${whenParts.join(" ")}`);
  }

  if (consequence) {
    blocks.push(`[[HEAD_ELSE]]\n${safeSentence(consequence)}`);
  }

  if (summary) {
    blocks.push(`[[HEAD_SUMMARY]]\n${safeSentence(summary)}`);
  } else if (importantPoints[0]) {
    blocks.push(`[[HEAD_SUMMARY]]\n${safeSentence(importantPoints[0])}`);
  } else if (actionLines[0]) {
    blocks.push(`[[HEAD_SUMMARY]]\n${actionLines[0]}`);
  } else if (topic) {
    blocks.push(`[[HEAD_SUMMARY]]\n${safeSentence(topic)}`);
  }

  return blocks.join("\n\n");
}
function localizeDetailHeadings(text, lang) {
  const maps = {
  de: {
    "[[HEAD_FROM]]": "Wer schreibt?",
    "[[HEAD_PERSON]]": "Für wen ist der Brief?",
    "[[HEAD_TOPIC]]": "Worum geht es?",
    "[[HEAD_IMPORTANT]]": "Was ist jetzt wichtig?",
    "[[HEAD_WHEN]]": "Bis wann?",
    "[[HEAD_ELSE]]": "Was passiert sonst?",
    "[[HEAD_SUMMARY]]": "Kurz gesagt:",
    "HEAD_FROM": "Wer schreibt?",
    "HEAD_PERSON": "Für wen ist der Brief?",
    "HEAD_TOPIC": "Worum geht es?",
    "HEAD_IMPORTANT": "Was ist jetzt wichtig?",
    "HEAD_WHEN": "Bis wann?",
    "HEAD_ELSE": "Was passiert sonst?",
    "HEAD_SUMMARY": "Kurz gesagt:"
  },

  tr: {
    "[[HEAD_FROM]]": "Kim yazıyor?",
    "[[HEAD_PERSON]]": "Bu mektup kimin için?",
    "[[HEAD_TOPIC]]": "Konu ne?",
    "[[HEAD_IMPORTANT]]": "Şimdi ne önemli?",
    "[[HEAD_WHEN]]": "Ne zamana kadar?",
    "[[HEAD_ELSE]]": "Yoksa ne olur?",
    "[[HEAD_SUMMARY]]": "Kısaca:",
    "HEAD_FROM": "Kim yazıyor?",
    "HEAD_PERSON": "Bu mektup kimin için?",
    "HEAD_TOPIC": "Konu ne?",
    "HEAD_IMPORTANT": "Şimdi ne önemli?",
    "HEAD_WHEN": "Ne zamana kadar?",
    "HEAD_ELSE": "Yoksa ne olur?",
    "HEAD_SUMMARY": "Kısaca:"
  },

  bg: {
    "[[HEAD_FROM]]": "Кой е изпратил писмото?",
    "[[HEAD_PERSON]]": "За кого е писмото?",
    "[[HEAD_TOPIC]]": "За какво става дума?",
    "[[HEAD_IMPORTANT]]": "Какво е важно сега?",
    "[[HEAD_WHEN]]": "До кога?",
    "[[HEAD_ELSE]]": "Какво става иначе?",
    "[[HEAD_SUMMARY]]": "Накратко:",
    "HEAD_FROM": "Кой е изпратил писмото?",
    "HEAD_PERSON": "За кого е писмото?",
    "HEAD_TOPIC": "За какво става дума?",
    "HEAD_IMPORTANT": "Какво е важно сега?",
    "HEAD_WHEN": "До кога?",
    "HEAD_ELSE": "Какво става иначе?",
    "HEAD_SUMMARY": "Накратко:"
  },

  ar: {
    "[[HEAD_FROM]]": "من أرسل الرسالة؟",
    "[[HEAD_PERSON]]": "لمن هذه الرسالة؟",
    "[[HEAD_TOPIC]]": "عن ماذا تتحدث الرسالة؟",
    "[[HEAD_IMPORTANT]]": "ما المهم الآن؟",
    "[[HEAD_WHEN]]": "إلى متى؟",
    "[[HEAD_ELSE]]": "ماذا يحدث إذا لم أفعل شيئًا؟",
    "[[HEAD_SUMMARY]]": "باختصار:",
    "HEAD_FROM": "من أرسل الرسالة؟",
    "HEAD_PERSON": "لمن هذه الرسالة؟",
    "HEAD_TOPIC": "عن ماذا تتحدث الرسالة؟",
    "HEAD_IMPORTANT": "ما المهم الآن؟",
    "HEAD_WHEN": "إلى متى؟",
    "HEAD_ELSE": "ماذا يحدث إذا لم أفعل شيئًا؟",
    "HEAD_SUMMARY": "باختصار:"
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
  const tokenRule = keepHeadingTokens
    ? `
- Überschrift-Tokens wie [[HEAD_FROM]], [[HEAD_PERSON]], [[HEAD_TOPIC]], [[HEAD_IMPORTANT]], [[HEAD_WHEN]], [[HEAD_ELSE]], [[HEAD_SUMMARY]] müssen exakt unverändert bleiben.
- Diese Tokens nicht übersetzen.
- Diese Tokens nicht löschen.
- Diese Tokens nicht verändern.
`
    : `
- Lasse keine technischen Tokens wie [[...]] im Ergebnis stehen.
`;

  return `
Du bist professioneller Übersetzer und Sprachvereinfacher für Hilfe24.

Du bekommst einen deutschen Erklärungstext zu einem Brief.
Übersetze ihn vollständig, natürlich, einfach und sauber in ${langMeta.label}.

SEHR WICHTIG:
- Schreibe so, wie ein echter Muttersprachler schreiben würde.
- Der Text muss natürlich klingen, nicht wie eine Wort-für-Wort-Übersetzung.
- Die Bedeutung muss exakt gleich bleiben.
- Keine Informationen weglassen.
- Keine Informationen hinzufügen.
- Keine Zusammenfassung.
- Keine Mischsprache.
- Keine deutschen Sätze oder Satzteile im Ergebnis.
- Nur echte Eigennamen dürfen im Original bleiben, zum Beispiel:
  - Stadt Blomberg
  - Stadtwerke Bad Salzuflen
  - Jobcenter
  - IBAN
  - QR-Code
  - Namen von Personen, Behörden, Orten, Firmen
- Fristen, Daten, Beträge und Folgen müssen vollständig übersetzt und exakt erhalten bleiben.
- Formuliere einfach, klar und alltagstauglich.
- Vermeide schwere Amtssprache.
- Übersetze schwierige Begriffe natürlich und verständlich.
${tokenRule}
- Gib NUR den fertigen übersetzten Text zurück.

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
  const clean = cleanText(text);

  if (!clean) return "";

  if (langMeta.code === "de") {
    return localizeDetailHeadings(clean, "de");
  }

  const translatedRaw = await callGemini([
    { text: buildTranslationPrompt(clean, langMeta, true) }
  ]);

  const result = cleanText(translatedRaw)
    .replace(/\[\[\s*/g, "[[")
    .replace(/\s*\]\]/g, "]]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return localizeDetailHeadings(result, langMeta.code);
}
async function buildFinalAnswerFromImages(bilder, lang) {
  if (!Array.isArray(bilder) || bilder.length === 0) {
    return {
      ok: false,
      error: "Kein Bild gesendet"
    };
  }

  if (bilder.length > 3) {
    return {
      ok: false,
      error: "In der kostenlosen Version kannst du maximal 3 Bilder hochladen."
    };
  }

  for (const bild of bilder) {
    if (!bild || typeof bild.imageData !== "string" || typeof bild.mimeType !== "string") {
      return {
        ok: false,
        error: "Ein Bild ist ungültig."
      };
    }

    if (bild.imageData.length > 8000000) {
      return {
        ok: false,
        error: "Ein Bild ist zu groß. Bitte mach ein kleineres oder klareres Foto."
      };
    }
  }

  const info = await buildInfoFromImages(bilder);
  return await buildFinalPayloadFromInfo(info, lang);
}
async function buildAudioText(text, lang) {
  return cleanText(text);
}

async function synthesizeMp3(text, lang) {
  const langMeta = getLanguageMeta(lang);

  const request = {
    input: { text },
    voice: {
      languageCode: langMeta.ttsLanguageCode,
      ssmlGender: langMeta.ttsGender
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 0.92,
      pitch: 0
    }
  };

  if (langMeta.ttsVoiceName) {
    request.voice.name = langMeta.ttsVoiceName;
  }

  const [response] = await ttsClient.synthesizeSpeech(request);

  if (!response.audioContent) {
    throw new Error("Keine TTS-Audioantwort erhalten");
  }

  return Buffer.isBuffer(response.audioContent)
    ? response.audioContent.toString("base64")
    : Buffer.from(response.audioContent, "binary").toString("base64");
}




async function buildFinalPayloadFromInfo(info, lang) {
  const langCode = getLanguageMeta(lang).code;

  const shortDe = cleanText(renderShortByLanguage(info, "de"));
  const detailTemplateDe = cleanText(renderDetailTemplateGerman(info));

  const translated = await translateFinalTextsIfNeeded(shortDe, detailTemplateDe, langCode);

  return {
    ok: true,
    quality_ok: true,
    hinweis: "",
    kurz: translated.kurz,
    details: translated.details
  };
}
async function translateFinalTextsIfNeeded(kurzDe, detailsDe, lang) {
  const langMeta = getLanguageMeta(lang);

  const cleanKurz = cleanText(kurzDe);
  const cleanDetails = cleanText(detailsDe);

  if (langMeta.code === "de") {
    return {
      kurz: cleanKurz,
      details: localizeDetailHeadings(cleanDetails, "de")
    };
  }

  const raw = await callGemini([
    {
      text: `
Du bist professioneller Übersetzer und Sprachvereinfacher für Hilfe24.

Du bekommst zwei deutsche Erklärungstexte zu einem Brief:
1. Einen kurzen Text für den oberen Kasten
2. Einen Detailtext für den unteren Kasten

Übersetze BEIDE Texte vollständig, natürlich, einfach und sauber in ${langMeta.label}.

SEHR WICHTIG:
- Schreibe so, wie ein echter Muttersprachler schreiben würde.
- Der Text muss natürlich klingen, nicht wie eine Wort-für-Wort-Übersetzung.
- Die Bedeutung muss exakt gleich bleiben.
- Keine Informationen weglassen.
- Keine Informationen hinzufügen.
- Keine Zusammenfassung.
- Keine Mischsprache.
- Keine deutschen Sätze oder Satzteile im Ergebnis.
- Eigennamen, Adressen, Daten, Uhrzeiten, Beträge, Behördennamen und Ortsnamen exakt erhalten.
- Fristen, Daten, Beträge und Folgen müssen exakt erhalten bleiben.
- Formuliere einfach, klar und alltagstauglich.
- Vermeide schwere Amtssprache.
- Überschrift-Tokens wie [[HEAD_FROM]], [[HEAD_PERSON]], [[HEAD_TOPIC]], [[HEAD_IMPORTANT]], [[HEAD_WHEN]], [[HEAD_ELSE]], [[HEAD_SUMMARY]] müssen im Detailtext exakt unverändert bleiben.
- Diese Tokens nicht übersetzen.
- Diese Tokens nicht löschen.
- Diese Tokens nicht verändern.

Antworte NUR als gültiges JSON.
Keine Erklärung außerhalb des JSON.
Keine Markdown-Codeblöcke.

Gib genau dieses JSON zurück:
{
  "kurz": "",
  "details": ""
}

KURZTEXT_DEUTSCH:
${cleanKurz}

DETAILTEXT_DEUTSCH:
${cleanDetails}
`
    }
  ]);

  const parsed = extractJson(raw);

  const kurz = cleanText(parsed.kurz || "");
  const detailsRaw = cleanText(parsed.details || "")
    .replace(/\[\[\s*/g, "[[")
    .replace(/\s*\]\]/g, "]]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    kurz,
    details: localizeDetailHeadings(detailsRaw, langMeta.code)
  };
}
async function buildAudioText(text, lang) {
  return cleanText(text);
}

async function synthesizeMp3(text, lang) {
  const langMeta = getLanguageMeta(lang);

  const request = {
    input: { text },
    voice: {
      languageCode: langMeta.ttsLanguageCode,
      ssmlGender: langMeta.ttsGender
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 0.92,
      pitch: 0
    }
  };

  if (langMeta.ttsVoiceName) {
    request.voice.name = langMeta.ttsVoiceName;
  }

  const [response] = await ttsClient.synthesizeSpeech(request);

  if (!response.audioContent) {
    throw new Error("Keine TTS-Audioantwort erhalten");
  }

  return Buffer.isBuffer(response.audioContent)
    ? response.audioContent.toString("base64")
    : Buffer.from(response.audioContent, "binary").toString("base64");
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

  if (bilder.length > 3) {
    return {
      ok: false,
      error: "In der kostenlosen Version kannst du maximal 3 Bilder hochladen."
    };
  }

  for (const bild of bilder) {
    if (!bild || typeof bild.imageData !== "string" || typeof bild.mimeType !== "string") {
      return {
        ok: false,
        error: "Ein Bild ist ungültig."
      };
    }

    if (bild.imageData.length > 8000000) {
      return {
        ok: false,
        error: "Ein Bild ist zu groß. Bitte mach ein kleineres oder klareres Foto."
      };
    }
  }

  const info = await buildInfoFromImages(bilder);
  return await buildFinalPayloadFromInfo(info, lang);
}

app.post("/api/brief", async (req, res) => {
  try {
    const text = String(req.body.text || "");
    const lang = (req.body.lang || "de").toLowerCase();

    if (!text || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Kein Brieftext gesendet"
      });
    }

    if (text.length > 12000) {
      return res.status(400).json({
        ok: false,
        error: "Der Text ist zu lang. Bitte kürze ihn oder lade nur die wichtigsten Seiten hoch."
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
    const bilder = req.body.bilder || [];
    const lang = (req.body.lang || "de").toLowerCase();

    const result = await buildFinalAnswerFromImages(bilder, lang);
    return res.json(result);
  } catch (error) {
    console.error("Fehler /api/brief-bild:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Serverfehler"
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const text = cleanText(req.body.text || "");
    const lang = (req.body.lang || "de").toLowerCase();

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "Kein Text für Audio gesendet"
      });
    }

    if (text.length > 3000) {
      return res.status(400).json({
        ok: false,
        error: "Der Text ist zu lang zum Vorlesen. Bitte lies nur den wichtigsten Teil vor."
      });
    }

    const audioText = await buildAudioText(text, lang);
    const audioBase64 = await synthesizeMp3(audioText, lang);

    return res.json({
      ok: true,
      mimeType: "audio/mpeg",
      audioBase64,
      debugAudioText: audioText
    });
  } catch (error) {
    console.error("Fehler /api/tts:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "TTS-Fehler"
    });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
