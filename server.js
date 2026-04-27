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
  unsicherheiten: normalizeArray(info.unsicherheiten)
};
}
function buildExtractionPromptForText(text) {
  return `
Du bist Hilfe24.

Lies diesen Brief und gib NUR gültiges JSON zurück.

WICHTIG:
- Erfinde nichts.
- Nenne nur Dinge, die klar im Brief stehen oder sehr klar direkt daraus folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- Wenn etwas unklar ist, lieber leer lassen statt raten.
- "betroffene_person" nur füllen, wenn im Brief klar erkennbar ist, welche Person gemeint oder angeschrieben ist.
- Bei "betroffene_person" nur den Namen oder die klar erkennbare betroffene Person eintragen, keine Rollenwörter wie "Sie", "Empfänger" oder "Adressat".
- Wenn nicht klar erkennbar ist, für wen der Brief ist, "betroffene_person" leer lassen.
- "was_ist_zu_tun" nur für echte konkrete Schritte.
- "frist" nur füllen, wenn eine Frist im Brief klar genannt wird.
- "termin" nur füllen, wenn ein echter Termin klar genannt wird.
- "folge_wenn_nichts" nur füllen, wenn eine Folge klar im Brief steht.
- "wichtigste_punkte" nur mit den 1 bis 3 wichtigsten sachlichen Punkten aus dem Brief.
- In "wichtigste_punkte" gehören NICHT hinein: Bankverbindungen, Öffnungszeiten, Datenschutz-Hinweise, Internetseiten, Kontaktangaben, interne Nummern oder Nebensätze ohne direkte Relevanz.
- "kurz_gesagt" muss genau 1 sehr kurzer sachlicher Satz in einfachem Deutsch sein.
- "kurz_gesagt" darf nur den Kern des Briefes enthalten, keine Nebensachen.
- Geldbeträge, Daten, Fristen, Namen, Behörden, Forderungen und Folgen müssen exakt erhalten bleiben.
- Keine Übertreibung.
- Keine Abschwächung.
- Keine zusätzliche Deutung.
- "versteckte_wichtige_info" nur füllen, wenn im Brief ein wichtiger Hinweis steht, der leicht übersehen werden kann und direkt relevant ist.
- "briefart" soll kurz und sachlich sein, zum Beispiel: Mahnung, Rechnung, Bescheid, Termin, Anhörung, Kündigung, Forderung, Erinnerung, Schreiben.

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

Brief:
${text}
`;
}

function buildExtractionPromptForImages() {
  return `
Du bist Hilfe24.

Lies die Bilder dieses Briefes und gib NUR gültiges JSON zurück.

DEINE AUFGABE:
Du sollst den Brief sachlich verstehen.
Erkenne allgemein, ob der Nutzer wirklich handeln muss oder ob der Brief nur informiert, etwas anbietet, bestätigt, warnt oder Werbung ist.

WICHTIG:
- Erfinde nichts.
- Nenne nur Dinge, die klar auf den Bildern stehen oder sehr klar direkt daraus folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- Wenn etwas unklar oder schlecht lesbar ist, lieber leer lassen statt raten.
- Geldbeträge, Daten, Fristen, Namen, Behörden, Forderungen und Folgen müssen exakt erhalten bleiben.
- Keine Panik machen.
- Keine Pflicht erfinden.
- Wenn wirklich eine Pflicht, Frist, Forderung oder Gefahr genannt wird, dann klar benennen.

ENTSCHEIDUNGSLOGIK:

1. Informationsbrief
Wenn der Brief nur informiert, erklärt oder auf ein Angebot hinweist, dann ist es meistens keine Pflicht.
Typische Wörter:
- Information
- wir informieren Sie
- Hinweis
- Angebot
- freiwillig
- können Sie
- wenn Sie möchten
- wenn Sie teilnehmen möchten
- es entstehen keine Nachteile
- keine Nachteile

Dann:
- "briefart" eher "Informationsbrief" oder "Hinweis"
- "was_ist_zu_tun" nur füllen, wenn ein sinnvoller freiwilliger Schritt genannt wird
- nicht schreiben: "Sie müssen reagieren"
- nicht schreiben: "Sie müssen antworten"
- nicht schreiben: "Sie müssen auf diesen Brief reagieren"

Beispiel:
Wenn im Brief steht, dass eine Teilnahme freiwillig ist, dann schreibe:
"Wenn Sie teilnehmen möchten, können Sie sich bei der genannten Stelle melden."
Wenn im Brief steht, dass keine Nachteile entstehen, dann schreibe das bei "folge_wenn_nichts".

2. Pflichtbrief
Wenn der Brief eine klare Pflicht nennt, dann trage sie bei "was_ist_zu_tun" ein.
Typische Fälle:
- Unterlagen einreichen
- Betrag zahlen
- Termin wahrnehmen
- Stellungnahme abgeben
- Vertrag kündigen oder bestätigen
- Nachweis schicken
- Formular ausfüllen
- Frist beachten

Dann:
- "was_ist_zu_tun" mit konkretem Schritt füllen
- "frist" füllen, wenn Datum oder Zeitraum genannt ist
- "folge_wenn_nichts" nur füllen, wenn die Folge im Brief steht

3. Mahnung / Rechnung / Forderung
Wenn es um Geld geht:
- Betrag exakt übernehmen
- Zahlungsfrist exakt übernehmen, wenn genannt
- nicht automatisch behaupten, dass die Forderung richtig ist
- wenn unklar ist, ob bezahlt werden muss, bei "unsicherheiten" eintragen
- bei "was_ist_zu_tun" sachlich schreiben: "Forderung prüfen" oder "Betrag zahlen, wenn die Forderung stimmt"

4. Werbung / Angebot
Wenn der Brief wie Werbung, Gewinnspiel, Verkauf oder Angebot wirkt:
- "briefart" als "Werbung" oder "Angebot" eintragen
- keine Zahlungspflicht erfinden
- bei "was_ist_zu_tun" höchstens schreiben: "Nur reagieren, wenn Sie das Angebot nutzen möchten."
- wenn es unseriös oder unklar wirkt, bei "unsicherheiten" eintragen

5. Gericht / Polizei / Behörde / Jobcenter
Wenn Gericht, Polizei, Jobcenter, Stadt, Krankenkasse, Rentenversicherung, Ausländerbehörde oder Finanzamt schreibt:
- besonders genau auf Fristen, Termine und Folgen achten
- keine Frist erfinden
- keine rechtliche Sicherheit behaupten
- wenn es ernst wirkt, sachlich sagen, dass man schnell prüfen oder Hilfe holen sollte

6. Gesundheit / Krankenkasse / Pflege
Wenn es um Gesundheit, Untersuchung, Pflege, Krankenkasse oder medizinische Themen geht:
- keine medizinische Diagnose stellen
- keine Behandlung empfehlen
- nur erklären, was im Brief steht
- freiwillige Angebote klar als freiwillig erklären
- wenn Beratung empfohlen wird, nur den im Brief genannten Ansprechpartner nennen

FÜR "was_ist_zu_tun":
- Nur echte Pflichtschritte oder sinnvolle freiwillige nächste Schritte eintragen.
- Wenn nichts getan werden muss, leer lassen oder nur freiwilligen Schritt eintragen.
- Keine allgemeine Floskel wie "auf den Brief reagieren", wenn keine Reaktion gefordert wird.

FÜR "folge_wenn_nichts":
- Nur füllen, wenn im Brief klar eine Folge steht.
- Wenn im Brief steht, dass keine Nachteile entstehen, genau das eintragen.
- Keine Folgen selbst erfinden.

FÜR "kurz_gesagt":
- Genau 1 kurzer sachlicher Satz in einfachem Deutsch.
- Bei Informationsbriefen klar sagen, dass es eine Information oder ein freiwilliges Angebot ist.
- Bei Pflichtbriefen klar sagen, was getan werden muss.
- Bei Mahnungen/Forderungen klar sagen, dass Zahlung oder Prüfung nötig sein kann.
- Bei Werbung klar sagen, dass es ein Angebot oder Werbung ist.
- Keine Panik.
- Keine Nebensachen.

FÜR "wichtigste_punkte":
- Nur die 1 bis 3 wichtigsten sachlichen Punkte aus dem Brief.
- Keine Bankverbindungen, Öffnungszeiten, Datenschutz-Hinweise, Internetseiten, Kontaktangaben, interne Nummern oder Nebensätze ohne direkte Relevanz.

FÜR "briefart":
Nutze kurz und sachlich, zum Beispiel:
- Informationsbrief
- Hinweis
- Angebot
- Werbung
- Mahnung
- Rechnung
- Bescheid
- Termin
- Anhörung
- Kündigung
- Forderung
- Erinnerung
- Schreiben

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
  const senderRaw = info.absender_kurz || info.absender_original || "";
  const sender = senderRaw.trim();
  const person = String(info.betroffene_person || "").trim();
  const topic = String(info.worum_geht_es || "").trim();
  const consequence = String(info.folge_wenn_nichts || "").trim();
  const briefart = String(info.briefart || "").trim();
  const importantPoints = dedupe(info.wichtigste_punkte || []);
  const actionCodes = dedupe((info.was_ist_zu_tun || []).map(simplifyActionBase));
  const firstAction = actionCodes[0] || "";
  const lines = [];

  function cleanSentence(text) {
    return String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\.$/, "");
  }

  function hasAny(text, words) {
    const lower = String(text || "").toLowerCase();
    return words.some((word) => lower.includes(word));
  }

  const allText = [
    briefart,
    topic,
    consequence,
    importantPoints.join(" "),
    (info.was_ist_zu_tun || []).join(" "),
    String(info.kurz_gesagt || "")
  ].join(" ").toLowerCase();

  const isInfoOrOffer = hasAny(allText, [
    "information",
    "informationsbrief",
    "hinweis",
    "angebot",
    "freiwillig",
    "wenn sie möchten",
    "wenn sie teilnehmen möchten",
    "können sie",
    "keine nachteile",
    "keinerlei nachteile"
  ]);

  const hasNoDisadvantage = hasAny(consequence, [
    "keine nachteile",
    "keinerlei nachteile",
    "keine negativen folgen",
    "keine folgen",
    "keinen nachteil"
  ]);

  const hasRealAction = Boolean(firstAction);

  function addSenderLine() {
    if (lang === "tr") {
      if (sender) lines.push(`Bu, ${sender} tarafından gönderilen bir mektup.`);
      return;
    }

    if (lang === "bg") {
      if (sender) lines.push(`Това е писмо от ${sender}.`);
      return;
    }

    if (lang === "ar") {
      if (sender) lines.push(`هذه رسالة من ${sender}.`);
      return;
    }

    if (sender) lines.push(`Das ist ein Brief von ${sender}.`);
  }

  function addPersonLine() {
    if (!person) return;

    if (lang === "tr") {
      lines.push(`Mektup ${person} ile ilgilidir.`);
      return;
    }

    if (lang === "bg") {
      lines.push(`Писмото се отнася за ${person}.`);
      return;
    }

    if (lang === "ar") {
      lines.push(`الرسالة تخص ${person}.`);
      return;
    }

    lines.push(`Der Brief betrifft ${person}.`);
  }

  function addTopicLine() {
    if (!topic) return;

    if (lang === "tr") {
      lines.push(cleanSentence(topic) + ".");
      return;
    }

    if (lang === "bg") {
      lines.push(cleanSentence(topic) + ".");
      return;
    }

    if (lang === "ar") {
      lines.push(cleanSentence(topic) + ".");
      return;
    }

    lines.push(cleanSentence(topic) + ".");
  }

  function addInfoLogicLines() {
    if (lang === "tr") {
      if (isInfoOrOffer) lines.push("Bu mektup bilgi amaçlıdır.");
      if (!hasRealAction) lines.push("Şu anda zorunlu bir cevap vermeniz gerekmiyor.");
      if (hasNoDisadvantage) lines.push("Katılmak istemezseniz sigorta güvenceniz için bir dezavantaj oluşmaz.");
      return;
    }

    if (lang === "bg") {
      if (isInfoOrOffer) lines.push("Това писмо е с информационна цел.");
      if (!hasRealAction) lines.push("В момента не е нужно задължително да отговаряте.");
      if (hasNoDisadvantage) lines.push("Ако не участвате, няма да има неблагоприятни последици за Вашата здравна осигуровка.");
      return;
    }

    if (lang === "ar") {
      if (isInfoOrOffer) lines.push("هذه الرسالة للمعلومة فقط.");
      if (!hasRealAction) lines.push("لا يجب عليك الرد بشكل إلزامي الآن.");
      if (hasNoDisadvantage) lines.push("إذا لم تشارك، فلن يحدث أي ضرر لتأمينك الصحي.");
      return;
    }

    if (isInfoOrOffer) lines.push("Das ist eine Information.");
    if (!hasRealAction) lines.push("Du musst nicht zwingend antworten.");
    if (hasNoDisadvantage) lines.push("Wenn du nicht teilnimmst, entstehen keine Nachteile für deinen Versicherungsschutz.");
  }

  function addActionLine() {
    if (!firstAction) return;

    const map = {
      de: {
        register: "Du musst dich anmelden.",
        register_city: "Die Person muss bei der Stadt angemeldet werden.",
        register_jobcenter: "Die Person muss beim Jobcenter angemeldet werden.",
        send_documents: "Du musst Unterlagen schicken.",
        pay: "Du musst zahlen.",
        reply: "Du musst antworten.",
        sign: "Du musst unterschreiben.",
        cancel: "Du musst kündigen.",
        attend_appointment: "Du musst zu dem angegebenen Termin erscheinen.",
        object_if_disagree: "Wenn du nicht einverstanden bist, musst du widersprechen oder dich melden.",
        contact: "Du musst dich melden."
      },
      tr: {
        register: "Kayıt olmanız gerekiyor.",
        register_city: "Kişiyi belediyeye kaydetmeniz gerekiyor.",
        register_jobcenter: "Kişiyi Jobcenter'a kaydetmeniz gerekiyor.",
        send_documents: "Belgeleri göndermeniz gerekiyor.",
        pay: "Ödeme yapmanız gerekiyor.",
        reply: "Cevap vermeniz gerekiyor.",
        sign: "İmzalamanız gerekiyor.",
        cancel: "İptal etmeniz gerekiyor.",
        attend_appointment: "Belirtilen randevuya gitmeniz gerekiyor.",
        object_if_disagree: "Kabul etmiyorsanız itiraz etmeniz veya iletişime geçmeniz gerekiyor.",
        contact: "İletişime geçmeniz gerekiyor."
      },
      bg: {
        register: "Трябва да се регистрирате.",
        register_city: "Трябва да регистрирате лицето в общината.",
        register_jobcenter: "Трябва да регистрирате лицето в Jobcenter.",
        send_documents: "Трябва да изпратите документите.",
        pay: "Трябва да платите.",
        reply: "Трябва да отговорите.",
        sign: "Трябва да подпишете.",
        cancel: "Трябва да прекратите.",
        attend_appointment: "Трябва да отидете на посочения час.",
        object_if_disagree: "Ако не сте съгласни, трябва да възразите или да се свържете.",
        contact: "Трябва да се свържете."
      },
      ar: {
        register: "يجب عليك التسجيل.",
        register_city: "يجب عليك تسجيل الشخص في البلدية.",
        register_jobcenter: "يجب عليك تسجيل الشخص في الجوب سنتر.",
        send_documents: "يجب عليك إرسال المستندات.",
        pay: "يجب عليك الدفع.",
        reply: "يجب عليك الرد.",
        sign: "يجب عليك التوقيع.",
        cancel: "يجب عليك الإلغاء.",
        attend_appointment: "يجب عليك الذهاب إلى الموعد المحدد.",
        object_if_disagree: "إذا لم تكن موافقًا، يجب عليك الاعتراض أو التواصل.",
        contact: "يجب عليك التواصل."
      }
    };

    lines.push(map[lang]?.[firstAction] || map.de[firstAction] || "");
  }

  function addWhenLine() {
    if (info.termin) {
      const t = cleanSentence(info.termin);
      if (lang === "tr") lines.push(`Tarih: ${t}.`);
      else if (lang === "bg") lines.push(`Дата: ${t}.`);
      else if (lang === "ar") lines.push(`الموعد: ${t}.`);
      else lines.push(`Termin: ${t}.`);
      return;
    }

    if (info.frist) {
      const f = cleanSentence(info.frist);
      if (lang === "tr") lines.push(`Son tarih: ${f}.`);
      else if (lang === "bg") lines.push(`Срок: ${f}.`);
      else if (lang === "ar") lines.push(`آخر موعد: ${f}.`);
      else lines.push(`Frist: ${f}.`);
    }
  }

  function addConsequenceLine() {
    if (!consequence) return;

    if (hasNoDisadvantage && isInfoOrOffer) return;

    const c = cleanSentence(consequence);

    if (lang === "tr") {
      lines.push(`Aksi halde: ${c}.`);
      return;
    }

    if (lang === "bg") {
      lines.push(`Иначе: ${c}.`);
      return;
    }

    if (lang === "ar") {
      lines.push(`وإلا: ${c}.`);
      return;
    }

    lines.push(`Sonst: ${c}.`);
  }

  addSenderLine();
  addPersonLine();

  if (isInfoOrOffer && !hasRealAction) {
    addTopicLine();
    addInfoLogicLines();
  } else {
    if (firstAction) {
      addActionLine();
    } else if (topic) {
      addTopicLine();
    } else if (importantPoints[0]) {
      lines.push(cleanSentence(importantPoints[0]) + ".");
    } else {
      if (lang === "tr") lines.push("Bu mektupla ilgili bilgileri kontrol etmelisiniz.");
      else if (lang === "bg") lines.push("Трябва да проверите информацията в това писмо.");
      else if (lang === "ar") lines.push("يجب عليك مراجعة المعلومات في هذه الرسالة.");
      else lines.push("Du solltest diesen Brief prüfen.");
    }

    addWhenLine();
    addConsequenceLine();
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
