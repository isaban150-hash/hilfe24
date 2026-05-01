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

function getTodayGerman() {
  return new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

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
case "ro":
      return {
        code: "ro",
        label: "Rumänisch",
        ttsLanguageCode: "ro-RO",
        ttsVoiceName: "",
        ttsGender: "FEMALE"
      };

    case "en":
      return {
        code: "en",
        label: "Englisch",
        ttsLanguageCode: "en-US",
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

function cleanText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*\d+\.\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJson(text) {
  const raw = String(text || "").trim();

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    return JSON.parse(fenced[1]);
  }

  const match = raw.match(/\{[\s\S]*\}/);
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
    email_adresse: normalizeString(info.email_adresse),
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
    unterlagen: normalizeArray(info.unterlagen),
    referenzen: normalizeArray(info.referenzen),

    antwort_sprache: normalizeChoice(
      info.antwort_sprache,
      ["de", "tr", "bg", "ar", "unklar"],
      "unklar"
    ),

    passende_aktionen: normalizeArray(info.passende_aktionen)
  };
}

function buildExtractionPromptBase(inputMode) {
  return `
Du bist Hilfe24.

Aufgabe:
Du sollst ein Schreiben so verstehen wie ein erfahrener Alltagshelfer.
Nicht nur zusammenfassen.
Du musst erkennen, was für den Menschen wirklich wichtig ist.

Input:
${inputMode === "image" ? "Du bekommst Bilder eines Briefes / Schreibens." : "Du bekommst den Text eines Briefes / Schreibens."}

ZIEL:
Erkenne allgemein jede Art von Schreiben:
- Brief
- E-Mail
- Nachricht
- Behördenschreiben
- Krankenkasse
- Jobcenter
- Finanzamt
- Rentenkasse
- Gericht
- Polizei
- Schule
- Jugendamt
- Inkasso
- Mahnung
- Rechnung
- Vermieter
- Vertrag
- Kündigung
- Reklamation
- Arztbrief / Krankenhausbericht / Befund
- Werbung / Angebot

DENKE IMMER SO:
1. Für wen ist das Schreiben?
2. Von wem kommt es?
3. Was ist das für ein Schreiben?
4. Geht es um Termin, Frist, Betrag, Unterlagen oder reine Information?
5. Ist es Pflicht, freiwillig, Information, Werbung oder unklar?
6. Was passiert, wenn nichts gemacht wird?
7. Was ist der nächste sinnvolle Schritt?
8. Welche Aktionen passen dazu?

REFERENZEN / NUMMERN:
Suche wichtige Identifikationsdaten im Schreiben und trage sie bei "referenzen" ein.
Beispiele:
- Aktenzeichen
- Kundennummer
- BG-Nummer
- Versicherungsnummer
- Mitgliedsnummer
- Vertragsnummer
- Rechnungsnummer
- Mahnnummer
- Geschäftszeichen
- Kassenzeichen
- Fallnummer
- Mein Zeichen
- Ihr Zeichen
- Bearbeitungsnummer

Wenn so etwas sicher im Schreiben steht, exakt übernehmen.
Wenn nichts sicher erkennbar ist, referenzen leer lassen.
Nichts erfinden.
E-MAIL-ADRESSE:
Suche im Schreiben nach einer klar erkennbaren E-Mail-Adresse des Absenders oder der zuständigen Stelle.
Trage sie bei "email_adresse" ein.
Beispiele:
- info@firma.de
- service@krankenkasse.de
- badsalzuflen.025@jobcenter-lippe.de

Nur echte E-Mail-Adressen übernehmen.
Keine Telefonnummer eintragen.
Keine Internetseite eintragen.
Wenn keine E-Mail-Adresse sicher erkennbar ist, leer lassen.
Heutiges Datum: ${getTodayGerman()}

WICHTIG:
- Nicht raten.
- Keine Fristen, Termine, Beträge oder Folgen erfinden.
- Keine Diagnose erfinden.
- Keine Rechtsberatung.
- Keine Panik machen.
- Keine Pflicht erfinden.
- Keine wichtigen Daten weglassen.
- Namen, Daten, Uhrzeiten, Beträge, Aktenzeichen, Behörden und Folgen exakt übernehmen.
- Wenn etwas nicht lesbar oder unklar ist, bei "unsicherheiten" eintragen.

PFLICHT / FREIWILLIG / INFORMATION:

"pflicht":
Wenn klar verlangt wird, dass etwas getan werden muss.
Beispiele:
- Termin wahrnehmen
- Unterlagen einreichen
- Betrag zahlen
- Formular ausfüllen
- Nachweise schicken
- Widerspruchsfrist beachten
- Stellungnahme abgeben
- Meldeaufforderung
- Anhörung
- Mahnung
- Forderung

"freiwillig":
Wenn es nur ein Angebot oder eine freiwillige Möglichkeit ist.
Beispiele:
- freiwillige Untersuchung
- optionales Angebot
- wenn Sie möchten
- wenn Sie teilnehmen möchten
- keine Nachteile bei Nichtteilnahme

"information":
Wenn nur informiert wird und keine Handlung verlangt wird.

"werbung":
Wenn es wie Werbung, Verkauf, Gewinnspiel oder Angebot wirkt und keine echte Pflicht enthält.

"unklar":
Wenn nicht klar erkennbar ist, ob eine Pflicht besteht.

DRINGLICHKEIT:

"hoch":
- Gericht
- Polizei
- Kündigung
- Mahnung mit Frist
- Inkasso mit Frist
- Jobcenter-Termin / Meldeaufforderung
- mögliche Leistungskürzung
- Zwangsvollstreckung
- Pfändung
- wichtige Frist läuft
- Zahlungsfrist
- medizinische Warnzeichen im Text

"mittel":
- Unterlagen nachreichen
- Antrag / Nachweis / Rückmeldung nötig
- Termin oder Frist vorhanden, aber nicht akut bedrohlich

"niedrig":
- reine Information
- freiwilliges Angebot
- Werbung
- keine Nachteile bei Nichtteilnahme

"unklar":
Wenn Frist, Folge oder Handlung nicht sicher erkennbar ist.

BESONDERE LOGIK:

TERMIN:
Wenn ein Termin genannt ist:
- termin ausfüllen
- Unterlagen ausfüllen, wenn etwas mitgebracht werden soll
- folge_wenn_nichts nur füllen, wenn im Brief klar steht, was passiert
- naechster_schritt: Termin wahrnehmen oder rechtzeitig absagen/verschieben, wenn man nicht kann

KRANKHEIT:
Krankheit nicht erfinden.
Nur wenn sie im Schreiben steht, erwähnen.

INKASSO / MAHNUNG / FORDERUNG:
Unterscheide:
1. normale Mahnung / Forderung / Inkasso
2. Mahnbescheid / Amtsgericht / Widerspruch
3. Vollstreckungstitel / Zwangsvollstreckung / Pfändung / Gerichtsvollzieher

Bei normaler Forderung:
- Forderung prüfen
- wenn richtig: zahlen oder Ratenzahlung
- wenn falsch: widersprechen oder Hilfe holen

Bei Mahnbescheid:
- Frist beachten
- bei falscher/unklarer Forderung rechtzeitig widersprechen
- nicht einfach nur "zahlen" schreiben

Bei Vollstreckungstitel:
- ernster als normale Mahnung
- sofort prüfen lassen / Hilfe holen
- bei richtiger Forderung zahlen oder Ratenzahlung

MEDIZIN:
Wenn Arztbrief, Krankenhausbericht, Befund, Notaufnahme, Entlassungsbericht:
- keine Behördenlogik
- keine Zahlung / Strafe / rechtliche Schritte erfinden
- einfach erklären: medizinischer Bericht, was festgestellt wurde, was empfohlen wird
- Dokument aufbewahren
- Arzt / Hausarzt / Facharzt zeigen
- bei starken Beschwerden medizinische Hilfe holen
- keine Diagnose erfinden

OFFIZIELLE ANTWORTSPRACHE:
Erklärung darf später in Nutzersprache sein.
Aber offizielle Antwort an Empfänger soll in Sprache des Briefes / Empfängers sein.
Beispiele:
- deutscher Brief / deutsche Behörde = Antwortsprache "de"
- türkische Behörde = "tr"
- bulgarische Behörde = "bg"
- arabische Stelle = "ar"
- wenn unklar = "unklar"

PASSENDE AKTIONEN:
Gib passende Aktionen als kurze Codes zurück.
Mögliche Codes:
- frage_stellen
- antwort_schreiben
- email_schreiben
- pdf_brief_erstellen
- termin_bestaetigen
- termin_verschieben
- ich_bin_krank
- unterlagen_nachreichen
- unterlagenliste_anzeigen
- fristverlaengerung
- zahlung_pruefen
- ratenzahlung_anfragen
- widerspruch_pruefen
- forderung_pruefen
- arztbrief_erklaeren
- warnzeichen_anzeigen
- fragen_an_arzt
- reklamation_schreiben
- kuendigung_schreiben
- nichts_tun_noetig

FÜR "naechster_schritt":
Genau 1 klarer nächster Schritt in einfacher Sprache.
Keine Romane.

FÜR "kurz_gesagt":
Genau 1 kurzer sachlicher Satz in einfachem Deutsch.
Der Satz soll den Kern treffen.

Gib genau dieses JSON zurück:
{
 "absender_original": "",
"absender_kurz": "",
"email_adresse": "",
"briefart": "",
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
  "unterlagen": [],
  "referenzen": [],
  "antwort_sprache": "unklar",
  "passende_aktionen": []
}

Gib nur gültiges JSON zurück.
Keine Erklärung.
Keine Markdown-Codeblöcke.
`;
}

function buildExtractionPromptForText(text) {
  return `
${buildExtractionPromptBase("text")}

TEXT DES SCHREIBENS:
${String(text || "").slice(0, 12000)}
`;
}

function buildExtractionPromptForImages() {
  return buildExtractionPromptBase("image");
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

function hasAny(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some((word) => lower.includes(word));
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
  const person = String(info.betroffene_person || "").trim();

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

  function typeLine() {
    if (briefart && sender) return `Das ist ein ${briefart} von ${sender}`;
    if (sender) return `Das ist ein Schreiben von ${sender}`;
    if (briefart) return `Das ist ein ${briefart}`;

    return "Das ist ein Schreiben";
  }

  function shortNextStep() {
    const text = cleanSentence(nextStep || actions[0] || summary || topic);

    if (!text) return "";

    if (appointment && hasAny(text, ["termin", "erscheinen", "kommen", "randevu", "melde"])) {
      return "Gehen Sie zum Termin oder melden Sie sich rechtzeitig ab, wenn Sie nicht können";
    }

    if (hasAny(text, ["zahlen", "zahlung", "betrag", "überweisen", "forderung", "inkasso", "mahnung"])) {
      return amount ? `Prüfen Sie die Forderung von ${amount}` : "Prüfen Sie die Forderung";
    }

    if (hasAny(text, ["unterlagen", "nachweise", "einreichen", "schicken", "senden"])) {
      return "Schicken Sie die genannten Unterlagen";
    }

    if (hasAny(text, ["freiwillig", "angebot", "teilnehmen", "untersuchung"])) {
      return "Sie entscheiden selbst, ob Sie das Angebot nutzen möchten";
    }

    if (text.length <= 95) return text;

    return "Prüfen Sie den Brief und den nächsten Schritt";
  }

  function shortConsequence() {
    const text = cleanSentence(consequence);

    if (!text) return "";

    if (hasAny(text, ["10", "prozent", "%", "bürgergeld", "gekürzt", "minderung"])) {
      return "Sonst kann Bürgergeld gekürzt werden";
    }

    if (hasAny(text, ["zwangsvollstreckung", "pfändung", "vollstreckung"])) {
      return "Sonst können weitere Kosten oder Vollstreckung folgen";
    }

    if (hasAny(text, ["keine nachteile", "keinerlei nachteile", "keinen nachteil"])) {
      return "Wenn Sie nicht teilnehmen, entstehen keine Nachteile";
    }

    if (text.length <= 100) return "Sonst: " + text;

    return "Sonst können Nachteile entstehen";
  }

  if (person) {
    pushLine(`Der Brief ist für ${person}`);
  }

  pushLine(typeLine());

  const step = shortNextStep();

  if (step) {
    pushLine(step);
  }

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
    pushLine("Bitte nicht ignorieren");
  }

  return dedupe(lines.filter(Boolean)).slice(0, 6).join("\n");
}

function renderDetailTemplateGerman(info) {
  const blocks = [];
  const sender = String(info.absender_kurz || info.absender_original || "").trim();
  const topic = String(info.worum_geht_es || "").trim();
  const summary = String(info.kurz_gesagt || "").trim();
  const consequence = String(info.folge_wenn_nichts || "").trim();
  const hiddenInfo = String(info.versteckte_wichtige_info || "").trim();
  const importantPoints = dedupe(info.wichtigste_punkte || []);
  const actions = dedupe(info.was_ist_zu_tun || []);
  const documents = dedupe(info.unterlagen || []);
  const references = dedupe(info.referenzen || []);
  const person = String(info.betroffene_person || "").trim();

  function safeSentence(text) {
    return toSentence(String(text || "").trim());
  }

  if (sender) {
    blocks.push(`[[HEAD_FROM]]\nDer Brief ist von ${sender}.`);
  }

  if (person) {
    blocks.push(`[[HEAD_PERSON]]\nDer Brief betrifft ${person}.`);
  }

  if (topic) {
    blocks.push(`[[HEAD_TOPIC]]\n${safeSentence(topic)}`);
  }

  const importantLines = [];

  for (const p of importantPoints.slice(0, 3)) {
    importantLines.push(safeSentence(p));
  }

  for (const a of actions.slice(0, 3)) {
    importantLines.push(safeSentence(a));
  }

  if (documents.length > 0) {
    importantLines.push(`Wichtige Unterlagen: ${documents.slice(0, 5).join(", ")}.`);
  }

  if (references.length > 0) {
    importantLines.push(`Wichtige Nummern/Zeichen: ${references.slice(0, 5).join(", ")}.`);
  }

  if (hiddenInfo) {
    importantLines.push(safeSentence(hiddenInfo));
  }

  if (importantLines.length > 0) {
    blocks.push(`[[HEAD_IMPORTANT]]\n${dedupe(importantLines).join(" ")}`);
  }

  const whenParts = [];

  if (info.frist) {
    whenParts.push(`Frist: ${String(info.frist).trim()}.`);
  }

  if (info.termin) {
    whenParts.push(`Termin: ${String(info.termin).trim()}.`);
  }

  if (whenParts.length > 0) {
    blocks.push(`[[HEAD_WHEN]]\n${whenParts.join(" ")}`);
  }

  if (consequence) {
    blocks.push(`[[HEAD_ELSE]]\n${safeSentence(consequence)}`);
  }

  if (summary) {
    blocks.push(`[[HEAD_SUMMARY]]\n${safeSentence(summary)}`);
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
      "[[HEAD_SUMMARY]]": "Kurz gesagt:"
    },

    tr: {
      "[[HEAD_FROM]]": "Kim yazıyor?",
      "[[HEAD_PERSON]]": "Bu mektup kimin için?",
      "[[HEAD_TOPIC]]": "Konu ne?",
      "[[HEAD_IMPORTANT]]": "Şimdi ne önemli?",
      "[[HEAD_WHEN]]": "Ne zamana kadar?",
      "[[HEAD_ELSE]]": "Yoksa ne olur?",
      "[[HEAD_SUMMARY]]": "Kısaca:"
    },

    bg: {
      "[[HEAD_FROM]]": "Кой е изпратил писмото?",
      "[[HEAD_PERSON]]": "За кого е писмото?",
      "[[HEAD_TOPIC]]": "За какво става дума?",
      "[[HEAD_IMPORTANT]]": "Какво е важно сега?",
      "[[HEAD_WHEN]]": "До кога?",
      "[[HEAD_ELSE]]": "Какво става иначе?",
      "[[HEAD_SUMMARY]]": "Накратко:"
    },

    ar: {
      "[[HEAD_FROM]]": "من أرسل الرسالة؟",
      "[[HEAD_PERSON]]": "لمن هذه الرسالة؟",
      "[[HEAD_TOPIC]]": "عن ماذا تتحدث الرسالة؟",
      "[[HEAD_IMPORTANT]]": "ما المهم الآن؟",
      "[[HEAD_WHEN]]": "إلى متى؟",
      "[[HEAD_ELSE]]": "ماذا يحدث إذا لم أفعل شيئًا؟",
      "[[HEAD_SUMMARY]]": "باختصار:"
        },
 
ro: {
      "[[HEAD_FROM]]": "Cine a trimis scrisoarea?",
      "[[HEAD_PERSON]]": "Pentru cine este scrisoarea?",
      "[[HEAD_TOPIC]]": "Despre ce este vorba?",
      "[[HEAD_IMPORTANT]]": "Ce este important acum?",
      "[[HEAD_WHEN]]": "Până când?",
      "[[HEAD_ELSE]]": "Ce se întâmplă dacă nu faci nimic?",
      "[[HEAD_SUMMARY]]": "Pe scurt:"
    },

    en: {
      "[[HEAD_FROM]]": "Who sent this?",
      "[[HEAD_PERSON]]": "Who is this letter for?",
      "[[HEAD_TOPIC]]": "What is it about?",
      "[[HEAD_IMPORTANT]]": "What is important now?",
      "[[HEAD_WHEN]]": "By when?",
      "[[HEAD_ELSE]]": "What happens if nothing is done?",
      "[[HEAD_SUMMARY]]": "In short:"
    }
 };
  const dict = maps[lang] || maps.de;
  let result = String(text || "");

  for (const [token, heading] of Object.entries(dict)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), heading);
  }

  return result;
}

function protectCriticalValues(text) {
  const tokens = [];
  let output = String(text || "");

  const patterns = [
    /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g,
    /\b\d{1,2}:\d{2}\b/g,
    /\b\d+[,.]\d{2}\s*€\b/g,
    /\b\d+\s*%\b/g,
    /\b§\s*\d+[a-zA-Z]?\b/g,
    /\bSGB\s*[IVX]+\b/g
  ];

  for (const pattern of patterns) {
    output = output.replace(pattern, (match) => {
      const key = `__H24TOKEN${tokens.length}__`;
      tokens.push({
        key,
        value: match
      });
      return key;
    });
  }

  return {
    text: output,
    tokens
  };
}

function restoreCriticalValues(text, tokens = []) {
  let out = String(text || "");

  for (const entry of tokens) {
    if (!entry || !entry.key) continue;

    out = out.split(entry.key).join(entry.value);
  }

  return out;
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

  const protectedKurz = protectCriticalValues(cleanKurz);
  const protectedDetails = protectCriticalValues(cleanDetails);

  const styleRules = {
    tr: `
TÜRKISCH-STIL:
- Doğal, sade ve kısa Türkçe yaz.
- Kısa metin en fazla 5-6 kısa satır olsun.
- Gereksiz uzun açıklama yapma.
- Para ödemek ile yardımın kesilmesi arasındaki farkı açık yaz.
- Termin varsa tarih ve saati aynen koru.
- Bürgergeld gibi resmi isimleri gerekirse aynen bırak.
`,

    bg: `
BULGARISCH-STIL:
- Пиши ясно, естествено и кратко.
- Краткият текст да бъде максимум 5-6 кратки реда.
- Не прави дълги обяснения.
- Разграничавай плащане от намаляване/спиране на помощ.
- Запази датите, часовете и сумите точно.
`,

    ar: `
ARABISCH-STIL:
- اكتب بلغة عربية بسيطة وواضحة وقصيرة.
- النص القصير يكون بحد أقصى 5 أو 6 أسطر قصيرة.
- لا تكتب شرحًا طويلًا.
- فرّق بين دفع المال وبين تخفيض أو إيقاف المساعدة.
- حافظ على التاريخ والوقت والمبلغ كما هو.
`,
 ro: `
RUMÄNISCH-STIL:
- Scrie în română clară, simplă și naturală.
- Folosește propoziții scurte.
- Nu folosi limbaj administrativ greu.
- Textul scurt trebuie să explice imediat: ce este scrisoarea, ce trebuie făcut, termenul sau programarea, documentele sau suma și ce se întâmplă dacă nu faci nimic.
- Nu inventa informații.
- Păstrează exact datele, orele, sumele, numerele de dosar și denumirile oficiale.
`,

    en: `
ENGLISCH-STIL:
- Write in simple, natural English.
- Use short sentences.
- Avoid complicated official language.
- The short text must quickly explain: what this is, what to do, deadline or appointment, documents or amount, and what happens if nothing is done.
- Do not invent information.
- Keep dates, times, amounts, reference numbers and official names exactly as written.
`
  };

  const raw = await callGemini([
    {
      text: `
Du bist professioneller Übersetzer und Sprachvereinfacher für Hilfe24.

Du bekommst zwei deutsche Erklärungstexte zu einem Schreiben:
1. KURZTEXT für den oberen grünen Kasten
2. DETAILTEXT für den unteren Detailkasten

Übersetze beide Texte vollständig und korrekt in ${langMeta.label}.

REGELN:
- Bedeutung exakt beibehalten.
- Keine Informationen hinzufügen.
- Keine Informationen weglassen.
- Keine Zusammenfassung.
- Keine Mischsprache.
- Eigennamen, Behördennamen, Aktenzeichen, Daten, Uhrzeiten, Beträge und Ortsnamen exakt erhalten.
- Begriffe wie Jobcenter, Bürgergeld, AOK, IBAN, QR-Code dürfen im Original bleiben.
- Kurztext kurz halten.
- Keine vollständigen Adressen in den Kurztext übernehmen, wenn sie nicht nötig sind.
- Überschrift-Tokens wie [[HEAD_FROM]], [[HEAD_PERSON]], [[HEAD_TOPIC]], [[HEAD_IMPORTANT]], [[HEAD_WHEN]], [[HEAD_ELSE]], [[HEAD_SUMMARY]] exakt unverändert lassen.

${styleRules[langMeta.code] || ""}

Antworte NUR als gültiges JSON.
Keine Markdown-Codeblöcke.

Gib genau dieses JSON zurück:
{
  "kurz": "",
  "details": ""
}

KURZTEXT_DEUTSCH:
${protectedKurz.text}

DETAILTEXT_DEUTSCH:
${protectedDetails.text}
`
    }
  ]);

  const parsed = extractJson(raw);

  const kurz = restoreCriticalValues(cleanText(parsed.kurz || ""), protectedKurz.tokens)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const detailsRaw = restoreCriticalValues(cleanText(parsed.details || ""), protectedDetails.tokens)
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

async function buildInfoFromText(text) {
  const rawJson = await callGemini([
    {
      text: buildExtractionPromptForText(text)
    }
  ]);

  return normalizeInfo(extractJson(rawJson));
}

async function buildInfoFromImages(bilder) {
  const parts = [
    {
      text: buildExtractionPromptForImages()
    }
  ];

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
    details: translated.details,
    meta: {
      briefart: info.briefart,
      absender: info.absender_kurz || info.absender_original,
     email_adresse: info.email_adresse,
      person: info.betroffene_person,
      termin: info.termin,
      frist: info.frist,
      betrag: info.betrag,
      unterlagen: info.unterlagen,
      referenzen: info.referenzen,
      dringlichkeit: info.dringlichkeit,
      pflicht_oder_freiwillig: info.pflicht_oder_freiwillig,
      naechster_schritt: info.naechster_schritt,
      antwort_sprache: info.antwort_sprache,
      passende_aktionen: info.passende_aktionen
    }
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
    input: {
      text
    },
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

app.post("/api/brief", async (req, res) => {
  try {
    const text = String(req.body.text || "");
    const lang = (req.body.lang || "de").toLowerCase();

    if (!text || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Kein Text gesendet"
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

app.post("/api/frage", async (req, res) => {
  try {
    const briefText = cleanText(req.body.briefText || "");
    const erklaerungKurz = cleanText(req.body.kurz || "");
    const erklaerungDetails = cleanText(req.body.details || "");
  const frage = cleanText(req.body.frage || "");
const frageMode = cleanText(req.body.frageMode || "free");
const lang = (req.body.lang || "de").toLowerCase();
    const langMeta = getLanguageMeta(lang);

    const meta = req.body.meta && typeof req.body.meta === "object" ? req.body.meta : {};
    const metaText = JSON.stringify(meta, null, 2);

    const heute = getTodayGerman();

    if (!frage) {
      return res.status(400).json({
        ok: false,
        error: "Keine Frage gesendet"
      });
    }

    if (!briefText && !erklaerungKurz && !erklaerungDetails) {
      return res.status(400).json({
        ok: false,
        error: "Kein Kontext vorhanden"
      });
    }

    if (frage.length > 1500) {
      return res.status(400).json({
        ok: false,
        error: "Die Frage ist zu lang. Bitte kürzer formulieren."
      });
    }

 const raw = await callGemini([
  {
    text: `
Du bist Hilfe24. Du bist ein einfacher, praktischer Alltagshelfer.

Du hilfst Menschen, Briefe, Nachrichten, Formulare, Bescheide, Gerichtsschreiben, Inkasso, Krankenkasse, Jobcenter, Schule, Arbeit, Pflege, Verträge, Produkte, Screenshots und Alltagssituationen zu verstehen und den nächsten Schritt zu finden.

Ausgewählte Sprache des Nutzers: ${langMeta.label}
Heutiges Datum: ${heute}

Antworte an den Nutzer immer in ${langMeta.label}.
Wenn du eine offizielle Antwort, E-Mail, einen Brief oder PDF-Text an eine deutsche Stelle formulierst, schreibe diesen fertigen Text auf Deutsch.

KONTEXT AUS DEM SCHREIBEN:
Erkannte Daten:
${metaText}

Kurz-Erklärung:
${erklaerungKurz}

Details:
${erklaerungDetails}

Original-Text:
${briefText.slice(0, 12000)}

Frage des Nutzers:
${frage}
Frage-Modus:
${frageMode}

AUFGABE:
WICHTIG ZUM FRAGE-MODUS:
Wenn frageMode = "next_steps":
Der Nutzer will wissen, was er jetzt tun muss.
Antworte handlungsorientiert.
Keine lange Hintergrundgeschichte.
Nutze nur:
- Kurz gesagt
- Was du jetzt tun solltest
- Wichtig
Maximal 5 klare Schritte.

Wenn frageMode = "deadline":
Der Nutzer will die Frist wissen.
Antworte mit:
- Frist / Termin
- Was bedeutet das?
- Was passiert, wenn die Frist verpasst wird?
Keine lange allgemeine Erklärung.

Wenn frageMode = "consequence":
Der Nutzer will wissen, was passiert, wenn er nichts macht.
Antworte mit:
- mögliche Folgen
- wie dringend es ist
- was er jetzt tun sollte
Keine Vorlage schreiben, außer der Nutzer bittet darum.

Wenn frageMode = "reply":
Der Nutzer will eine Antwort schreiben.
Erkläre nicht lange.
Schreibe direkt einen fertigen Text zum Kopieren.
Bei deutschen Behörden, Gerichten, Inkasso, Krankenkassen, Jobcenter oder Schulen immer auf Deutsch schreiben.

Wenn frageMode = "free":
Beantworte die eigene Frage des Nutzers normal, aber weiterhin klar, praktisch und vollständig.
WICHTIGER STIL:
- Nicht zu kurz, nicht zu lang, aber vollständig.
- Keine Begrüßung.
- Nicht schreiben: "Hallo", "Merhaba", "Gerne", "Natürlich" oder ähnliche Einleitung.
- Keine langen KI-Erklärungen.
- Keine unnötigen Wiederholungen.
- Schreibe ruhig, menschlich, direkt und praktisch.
- Erkläre so, dass auch Menschen mit wenig Deutsch oder wenig Erfahrung mit Behörden es verstehen.
- Wenn die Frage einfach ist, antworte kurz.
- Wenn es um Gericht, Polizei, Fristen, Geld, Inkasso, Gesundheit oder wichtige Folgen geht, darf die Antwort ausführlicher sein.
- Wichtige Informationen dürfen nicht weggelassen werden.
- Trotzdem klar gliedern und nicht labern.

ERKENNE STILL DEN BEREICH:
- Gericht / Polizei / Strafsache
- Behörde / Amt / Jobcenter / Krankenkasse / Rente / Schule
- Inkasso / Mahnung / Rechnung / Forderung
- Wohnung / Vermieter / Vertrag / Kündigung
- Arbeit / Pflege / Dokumentation
- Gesundheit / Medikamente
- Produkt / Technik / Screenshot / Betrug
- sonstiger Alltag

GRUNDREGELN:
- Keine Daten erfinden.
- Keine Fristen erfinden.
- Keine Beträge erfinden.
- Keine Namen erfinden.
- Keine Aktenzeichen erfinden.
- Wenn etwas fehlt, sage kurz, was fehlt.
- Wenn eine Frist, ein Termin, Betrag oder Risiko vorhanden ist, nenne es klar.
- Keine Panik machen.
- Keine falsche Sicherheit geben.
- Wenn der Nutzer einen fertigen Text will, schreibe direkt den fertigen Text.
- Wenn der Nutzer nur wissen will, was zu tun ist, schreibe keine fertige Vorlage, außer es ist sinnvoll und kurz.

SPEZIALFÄLLE
QUALITÄT

BEI INKASSO / MAHNUNG / FORDERUNG:
- Nicht automatisch Zahlung empfehlen.
- Forderung prüfen.
- Betrag und Frist nennen, wenn vorhanden.
- Wenn unklar: Nachweis/Forderungsaufstellung verlangen.
- Ratenzahlung nur vorschlagen, wenn der Nutzer zahlen will oder fragt.
- Bei Druck, Drohung oder unklarer Forderung vorsichtig formulieren.

BEI BEHÖRDE / JOBCENTER / KRANKENKASSE / RENTE / SCHULE:
- Frist, Unterlagen, Termin und Folgen klar nennen.
- Sagen, was der Nutzer einreichen, unterschreiben, beantworten oder mitbringen muss.
- Wenn eine Antwort sinnvoll ist, direkt anbieten oder kurzen Text vorbereiten.

BEI GESUNDHEIT / MEDIKAMENTEN:
- Keine Diagnose stellen.
- Keine Dosierung erfinden.
- Einfach erklären.
- Bei Risiko, Unsicherheit oder starken Beschwerden Arzt oder Apotheke empfehlen.

BEI PFLEGE-DOKUMENTATION:
- Sachlich, beobachtend und professionell formulieren.
- Keine Diagnose erfinden.
- Nur beschreiben, was beobachtet wurde.
- Keine Patientendaten erfinden.

BEI SCREENSHOT / BETRUG / PRODUKT / TECHNIK:
- Erkläre, was zu sehen ist.
- Nenne Warnzeichen, wenn vorhanden.
- Gib einfache nächste Schritte.
- Bei Betrugsverdacht: nicht klicken, nichts zahlen, keine Daten senden, Beweise sichern.

WENN DER NUTZER EINE E-MAIL, ANTWORT, VORLAGE, WHATSAPP, EINEN BRIEF ODER PDF-TEXT WILL:
- Maximal ein kurzer Satz davor.
- Dann direkt den fertigen Text schreiben.
- Der Text muss sofort kopierbar sein.
- Höflich, sachlich, klar.
- Keine Drohungen.
- Keine emotionalen Sätze.
- Keine erfundenen Daten.
- Offizielle Antwort an deutsche Stellen immer auf Deutsch.

OFFIZIELLE ANTWORTSPRACHE:
- Erklärung an Nutzer: ${langMeta.label}
- Antwort an deutsche Behörde / deutsches Gericht / deutsches Jobcenter / deutsche Krankenkasse / deutsches Inkasso / deutsche Schule / deutsches Finanzamt: Deutsch
- Antwort an türkische Stelle: Türkisch
- Antwort an bulgarische Stelle: Bulgarisch
- Antwort an arabische Stelle: Arabisch
- Wenn unklar: Sprache des Schreibens verwenden.

REFERENZEN UND DATEN:
Wenn vorhanden, nutze:
- person
- termin
- frist
- betrag
- unterlagen
- absender
- email_adresse
- referenzen
- antwort_sprache

Referenzen wie Aktenzeichen, Kundennummer, BG-Nummer, Versicherungsnummer, Rechnungsnummer, Mahnnummer, "Mein Zeichen" oder "Ihr Zeichen" müssen in offiziellen Antworten übernommen werden, wenn sie vorhanden sind.
Keine Referenzen erfinden.

NAMENSREGEL:
Wenn in den erkannten Daten "person" vorhanden ist, ist das die betroffene Person.

Bei jeder fertigen E-Mail, jedem Brief und jedem PDF-Text gilt:
- Die Antwort muss am Ende mit dem Namen aus "person" unterschrieben werden.
- Schreibe niemals nur "Mit freundlichen Grüßen" ohne Namen darunter.
- Schreibe niemals [Name], wenn "person" vorhanden ist.

Wenn kein Name sicher erkannt wurde, schreibe:

Mit freundlichen Grüßen

[Name]

DEUTSCHE E-MAIL-FORM:
Wenn eine deutsche E-Mail erstellt wird, nutze dieses Format:

Empfänger: [E-Mail-Adresse oder Hinweis]

Wenn in den erkannten Daten "email_adresse" vorhanden ist:
Empfänger: [email_adresse]

Wenn keine email_adresse vorhanden ist:
Empfänger: Bitte E-Mail-Adresse aus dem Brief übernehmen.

Betreff: [passender Betreff mit Termin/Referenz, wenn vorhanden]

Sehr geehrte Damen und Herren,

[Text]

Mit freundlichen Grüßen

[erkannte Person, sonst Name-Platzhalter]

SPEZIALFÄLLE FÜR VORLAGEN:
1. Nutzer ist krank und es geht um Termin:
- Termin krankheitsbedingt absagen
- neuen Termin erbitten
- Bescheinigung nur erwähnen, wenn Nutzer sie genannt hat
- wenn Bescheinigung vorhanden:
  "Die Arbeitsunfähigkeitsbescheinigung füge ich als Anlage bei."
  Anlage:
  - Arbeitsunfähigkeitsbescheinigung
- wenn nicht sicher vorhanden:
  "Falls erforderlich, reiche ich eine ärztliche Bescheinigung nach."
- kurze schriftliche Bestätigung erbitten

2. Termin bestätigen:
- kurze Terminbestätigung schreiben
- Unterlagen erwähnen, wenn im Schreiben genannt

3. Unterlagen fehlen:
- Nachreichung schreiben
- Eingangsbestätigung erbitten

4. Fristproblem:
- Fristverlängerung erbitten
- keine falsche Begründung erfinden

5. Forderung / Inkasso / Mahnung:
- nicht automatisch Zahlung versprechen
- Nachweis / Forderungsaufstellung verlangen oder Ratenzahlung nur anbieten, wenn Nutzer das will

6. Widerspruch:
- sachlich formulieren
- keine Frist erfinden
- wenn unklar: "Bitte prüfen lassen"

QUALITÄT:
Die Antwort soll sich wie Hilfe24 anfühlen:
einfach, klar, vollständig, ruhig, praktisch.
Nicht wie Amtssprache.
Nicht wie Werbung.
Nicht wie ein langer KI-Aufsatz.
`
  }
]);
    const antwort = cleanText(raw)
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return res.json({
      ok: true,
      antwort
    });
  } catch (error) {
    console.error("Fehler /api/frage:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Fehler bei der Frage"
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
