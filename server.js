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

WICHTIG:
- Erfinde nichts.
- Nenne nur Dinge, die klar auf den Bildern stehen oder sehr klar direkt daraus folgen.
- Keine freien Erklärungen.
- Keine Sätze außerhalb des JSON.
- Wenn etwas unklar oder schlecht lesbar ist, lieber leer lassen statt raten.
- "was_ist_zu_tun" nur für echte konkrete Schritte.
- "frist" nur füllen, wenn eine Frist auf den Bildern klar genannt wird.
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
  const actionCodes = dedupe((info.was_ist_zu_tun || []).map(simplifyActionBase));
  const firstAction = actionCodes[0] || "";
  const lines = [];

  function cleanNativeSentence(text) {
    return String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\.$/, "");
  }

  function simplifyFrist(value, language) {
    const v = String(value || "").trim();
    if (!v) return "";

    const lower = v.toLowerCase();

    if (lower.includes("innerhalb einer woche")) {
      if (language === "tr") return "Bir hafta içinde";
      if (language === "bg") return "В рамките на една седмица";
      if (language === "ar") return "خلال أسبوع واحد";
      return "Innerhalb einer Woche";
    }

    return v;
  }

  if (lang === "tr") {
    if (sender) lines.push(`Bu mektup ${sender} tarafından gönderildi.`);
    if (person) lines.push(`Bu mektup ${person} içindir.`);

    if (firstAction) {
      const map = {
        register: "Kayıt olmanız gerekiyor.",
        register_city: "Kişiyi belediyeye kaydetmeniz gerekiyor.",
        register_jobcenter: "Kişiyi Jobcenter'a kaydetmeniz gerekiyor.",
        send_documents: "Belgeleri göndermeniz gerekiyor.",
        pay: "Ödeme yapmanız gerekiyor.",
        reply: "Cevap vermeniz gerekiyor.",
        sign: "İmzalamanız gerekiyor.",
        cancel: "İptal etmeniz gerekiyor.",
        attend_appointment: "Belirtilen zamanda hazır bulunmanız gerekiyor.",
        object_if_disagree: "Kabul etmiyorsanız itiraz etmeniz veya iletişime geçmeniz gerekiyor.",
        contact: "İletişime geçmeniz gerekiyor."
      };
      lines.push(map[firstAction] || "Harekete geçmeniz gerekiyor.");
    } else if (topic) {
      lines.push(cleanNativeSentence(topic) + ".");
    } else {
      lines.push("Bu mektupla ilgili işlem yapmanız gerekiyor.");
    }

    if (info.termin) {
      lines.push(`Tarih: ${cleanNativeSentence(info.termin)}.`);
    } else if (info.frist) {
      lines.push(`Son tarih: ${simplifyFrist(info.frist, "tr")}.`);
    }

    if (consequence) {
      lines.push(cleanNativeSentence(consequence) + ".");
    }

    return lines.slice(0, 5).join("\n");
  }

  if (lang === "bg") {
    if (sender) lines.push(`Това е писмо от ${sender}.`);
    if (person) lines.push(`Писмото е за ${person}.`);

    if (firstAction) {
      const map = {
        register: "Трябва да се регистрирате.",
        register_city: "Трябва да регистрирате лицето в общината.",
        register_jobcenter: "Трябва да регистрирате лицето в Jobcenter.",
        send_documents: "Трябва да изпратите документите.",
        pay: "Трябва да платите.",
        reply: "Трябва да отговорите.",
        sign: "Трябва да подпишете.",
        cancel: "Трябва да прекратите.",
        attend_appointment: "Трябва да се явите на посочения час.",
        object_if_disagree: "Ако не сте съгласни, трябва да възразите или да се свържете.",
        contact: "Трябва да се свържете."
      };
      lines.push(map[firstAction] || "Трябва да предприемете действие.");
    } else if (topic) {
      lines.push(cleanNativeSentence(topic) + ".");
    } else {
      lines.push("Трябва да предприемете действие по това писмо.");
    }

    if (info.termin) {
      lines.push(`Дата: ${cleanNativeSentence(info.termin)}.`);
    } else if (info.frist) {
      lines.push(`Срок: ${simplifyFrist(info.frist, "bg")}.`);
    }

    if (consequence) {
      lines.push(cleanNativeSentence(consequence) + ".");
    }

    return lines.slice(0, 5).join("\n");
  }

  if (lang === "ar") {
    if (sender) lines.push(`هذه رسالة من ${sender}.`);
    if (person) lines.push(`هذه الرسالة تخص ${person}.`);

    if (firstAction) {
      const map = {
        register: "يجب عليك التسجيل.",
        register_city: "يجب عليك تسجيل الشخص في البلدية.",
        register_jobcenter: "يجب عليك تسجيل الشخص في الجوب سنتر.",
        send_documents: "يجب عليك إرسال المستندات.",
        pay: "يجب عليك الدفع.",
        reply: "يجب عليك الرد.",
        sign: "يجب عليك التوقيع.",
        cancel: "يجب عليك الإلغاء.",
        attend_appointment: "يجب عليك الحضور في الموعد المحدد.",
        object_if_disagree: "إذا لم تكن موافقًا، يجب عليك الاعتراض أو التواصل.",
        contact: "يجب عليك التواصل."
      };
      lines.push(map[firstAction] || "يجب عليك اتخاذ إجراء.");
    } else if (topic) {
      lines.push(cleanNativeSentence(topic) + ".");
    } else {
      lines.push("يجب عليك اتخاذ إجراء بخصوص هذه الرسالة.");
    }

    if (info.termin) {
      lines.push(`الموعد: ${cleanNativeSentence(info.termin)}.`);
    } else if (info.frist) {
      lines.push(`آخر موعد: ${simplifyFrist(info.frist, "ar")}.`);
    }

    if (consequence) {
      lines.push(cleanNativeSentence(consequence) + ".");
    }

    return lines.slice(0, 5).join("\n");
  }

  if (sender) lines.push(`Das ist ein Brief von ${sender}.`);
  if (person) lines.push(`Der Brief betrifft ${person}.`);

  if (firstAction) {
    const map = {
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
    };
    lines.push(map[firstAction] || "Du musst auf diesen Brief reagieren.");
  } else if (topic) {
    lines.push(cleanNativeSentence(topic) + ".");
  } else {
    lines.push("Du musst auf diesen Brief reagieren.");
  }

  if (info.termin) {
    lines.push(`Termin: ${cleanNativeSentence(info.termin)}.`);
  } else if (info.frist) {
    lines.push(`Frist: ${simplifyFrist(info.frist, "de")}.`);
  }

  if (consequence) {
    lines.push(`Sonst: ${cleanNativeSentence(consequence)}.`);
  }

  return lines.slice(0, 5).join("\n");
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
async function translateShortIfNeeded(text, lang) {
  const langMeta = getLanguageMeta(lang);
  const clean = cleanText(text);

  if (langMeta.code === "de") {
    return clean;
  }

  const translatedRaw = await callGemini([
    { text: buildTranslationPrompt(clean, langMeta, false) }
  ]);

  return cleanText(translatedRaw);
}

async function buildFinalPayloadFromInfo(info, lang) {
  const langCode = getLanguageMeta(lang).code;

  const shortDe = cleanText(renderShortByLanguage(info, "de"));
  const kurz = await translateShortIfNeeded(shortDe, langCode);

  const detailTemplateDe = cleanText(renderDetailTemplateGerman(info));
  const details = await translateDetailIfNeeded(detailTemplateDe, langCode);

  return {
    ok: true,
    quality_ok: true,
    hinweis: "",
    kurz,
    details
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
