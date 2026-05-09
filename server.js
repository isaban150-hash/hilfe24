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

app.use(express.json({ limit: "70mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server läuft sauber", version: "v14.4-cost-carrier-target-fix" });
});

function getTodayGerman() {
  return new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getLanguageMeta(lang) {
  const raw = String(lang || "de").toLowerCase().slice(0, 2);
  const languages = {
    de: { code: "de", label: "Deutsch", nativeName: "Deutsch", promptLanguage: "Deutsch", outputLanguage: "Deutsch", uiLocale: "de-DE", ttsLanguageCode: "de-DE", ttsGender: "FEMALE", dir: "ltr", officialDraftLanguage: "Deutsch", live: true },
    tr: { code: "tr", label: "Türkisch", nativeName: "Türkçe", promptLanguage: "Türkisch", outputLanguage: "Türkisch", uiLocale: "tr-TR", ttsLanguageCode: "tr-TR", ttsGender: "FEMALE", dir: "ltr", officialDraftLanguage: "Deutsch", live: true },
    bg: { code: "bg", label: "Bulgarisch", nativeName: "Български", promptLanguage: "Bulgarisch", outputLanguage: "Bulgarisch", uiLocale: "bg-BG", ttsLanguageCode: "bg-BG", ttsGender: "FEMALE", dir: "ltr", officialDraftLanguage: "Deutsch", live: true },
    ro: { code: "ro", label: "Rumänisch", nativeName: "Română", promptLanguage: "Rumänisch", outputLanguage: "Rumänisch", uiLocale: "ro-RO", ttsLanguageCode: "ro-RO", ttsGender: "FEMALE", dir: "ltr", officialDraftLanguage: "Deutsch", live: true },
    en: { code: "en", label: "Englisch", nativeName: "English", promptLanguage: "Englisch", outputLanguage: "Englisch", uiLocale: "en-US", ttsLanguageCode: "en-US", ttsGender: "FEMALE", dir: "ltr", officialDraftLanguage: "Deutsch", live: true },
    // Arabisch ist technisch vorbereitet, aber im V14-UI noch nicht live.
    ar: { code: "ar", label: "Arabisch", nativeName: "العربية", promptLanguage: "Arabisch", outputLanguage: "Arabisch", uiLocale: "ar", ttsLanguageCode: "ar-XA", ttsGender: "FEMALE", dir: "rtl", officialDraftLanguage: "Deutsch", live: false }
  };
  return languages[raw] || languages.de;
}

function getProtectedFieldsRuleText() {
  return `GESCHÜTZTE ORIGINALDATEN:
Diese Werte niemals übersetzen, verändern, umformatieren oder frei ergänzen:
- Namen und Anschriften
- Aktenzeichen, Kundennummern, Rechnungsnummern, BG-Nummern, Beitragsnummern, Versicherungsnummern, Vertragsnummern
- Beträge, Fristen, Termine, Datumsangaben, Uhrzeiten
- IBAN/BIC/Telefon/Fax/E-Mail/Webseiten nur als solche behandeln, niemals als Aktenzeichen
- wichtige Originalzitate und deutsche amtliche Begriffe, wenn sie später im Schriftverkehr wieder gebraucht werden.`;
}

function buildMultilingualRules(langMeta = getLanguageMeta("de")) {
  return `MEHRSPRACHIGKEIT V14.3:
Es gibt immer vier Sprachebenen:
1. Originalsprache des Briefes.
2. Nutzersprache für Erklärung, Chat, Hinweise und Audio: ${langMeta.label}.
3. Empfänger-/Amtssprache für offizielle Antworttexte.
4. Geschützte Originaldaten, die nie übersetzt oder verändert werden.

Regeln:
- Erklärungen, Chat-Antworten, Sicherheitswarnungen, nächste Schritte und Audio-Texte immer in ${langMeta.label} schreiben.
- Offizielle E-Mails, Briefe und PDF-Briefe NICHT automatisch in die Nutzersprache übersetzen.
- Offizielle Schreiben müssen in der Sprache der empfangenden Stelle erstellt werden.
- Bei deutschen Behörden, Gerichten, Jobcentern, Krankenkassen, Versicherungen, Inkasso, Banken oder deutschen Firmen: offizielle E-Mail/PDF immer direkt auf Deutsch.
- Bei ausländischen Stellen: offizielle E-Mail/PDF grundsätzlich in der Sprache des Originalbriefes oder der empfangenden Stelle schreiben. Wenn unklar, kurz nachfragen.
- Wenn der Nutzer ausdrücklich sagt "Deutsch", "Almanca", "German" oder "auf Deutsch", muss der Entwurf sofort Deutsch sein.
- Nie eine offizielle deutsche E-Mail aus einer bereits übersetzten Erklärung zurückübersetzen.
- Nutze für offizielle Entwürfe immer die Originaldaten aus dem aktuellen Fall.
- Deutsche Fachbegriffe beim ersten Auftreten nicht nur übersetzen, sondern kurz erklären, z. B. Widerspruch, Widerruf, Kündigung, Mahnung, Vollstreckung, Beratungshilfe, Prozesskostenhilfe, Pflichtverteidiger, Bürgergeld, Bedarfsgemeinschaft, Ratenzahlung, Stundung.
- Wenn ein deutscher Fachbegriff später bei Behörde, Gericht oder Anwalt wichtig ist, den deutschen Begriff sichtbar stehen lassen und in ${langMeta.label} einfach erklären.
- Bei sensiblen Fällen keine Garantien geben und keine rechtliche/medizinische Sicherheit erfinden.
${getProtectedFieldsRuleText()}`;
}

function containsOfficialDraftMarker(text = "") {
  const t = String(text || "");
  return /(^|\n)\s*(E-?MAIL|EMAIL|PDF-BRIEF|PDF BRIEF)\s*:/i.test(t);
}

function isOfficialDraftText(text = "") {
  const t = String(text || "");
  return containsOfficialDraftMarker(t) || /Sehr geehrte Damen und Herren/i.test(t) || /(^|\n)\s*Betreff\s*:/i.test(t) || /Mit freundlichen Grüßen/i.test(t);
}

function wantsExplicitGermanDraft(text = "") {
  const q = String(text || "").toLowerCase();
  return /\b(deutsch|german|auf deutsch|almanca|alman\s*dili|almanca hazırla|almanca hazirla)\b/i.test(q);
}

function wantsOfficialLetterLikeText(text = "") {
  const q = String(text || "").toLowerCase();
  return hasAny(q, [
    "pdf", "pdf-brief", "brief", "e-mail", "email", "mail", "schreiben", "antwort", "formuliere", "vorlage", "fertig",
    "mektup", "mektupla", "dilekçe", "dilekce", "hazırla", "hazirla", "yaz", "cevap", "eposta", "e-posta",
    "писмо", "имейл", "отговор", "напиши", "подготви",
    "scrisoare", "răspuns", "raspuns", "email", "pregătește", "pregateste", "scrie",
    "letter", "write", "prepare", "draft", "reply"
  ]);
}

async function localizeUserFacingAnswerIfNeeded(text, lang) {
  const clean = cleanText(text);
  const langMeta = getLanguageMeta(lang);
  if (!clean || langMeta.code === "de") return clean;
  if (isOfficialDraftText(clean)) return clean;
  return translateHelpTextIfNeeded(clean, langMeta.code);
}

async function callGemini(parts) {
  if (!apiKey) throw new Error("GEMINI_API_KEY fehlt auf dem Server");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] })
    }
  );

  const data = await response.json();
  if (!response.ok) {
    console.error("Gemini Fehler:", data);
    throw new Error(data?.error?.message || "Gemini API Fehler");
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n").trim() || "";
  if (!text) throw new Error("Keine Antwort von Gemini erhalten");
  return text;
}

function cleanText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^\s*[-–—]\s{2,}/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean);
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Konnte keine JSON-Antwort lesen");
  return JSON.parse(match[0]);
}

function hasAny(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some((w) => lower.includes(String(w).toLowerCase()));
}

function dedupe(arr) {
  const out = [];
  for (const item of Array.isArray(arr) ? arr : []) {
    const t = normalizeString(item);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

function looksLikeEmail(value) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalizeString(value));
}

function findEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function looksLikeIban(value) {
  return /\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,34}\b/i.test(String(value || ""));
}

function looksLikePhone(value) {
  const v = normalizeString(value);
  return /(?:tel|telefon|fax|mobil)/i.test(v) || /^\+?\d[\d\s/().-]{6,}$/.test(v);
}

function looksLikeAddress(value) {
  return /\b(str\.|straße|strasse|weg|platz|allee|gasse|\d{5}\s+[a-zäöüß])/i.test(String(value || ""));
}

function normalizePostalAddress(value) {
  const raw = String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeString(line))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!raw) return "";
  if (/iban|bic|telefon|tel\.|fax|e-mail|email|www\.|http/i.test(raw)) return "";
  if (!looksLikeAddress(raw)) return "";
  return raw;
}


function splitAddressIntoLines(value = "") {
  const raw = String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeString(line))
    .filter(Boolean)
    .join("\n");

  if (!raw) return "";

  const lines = raw.split("\n").map((line) => normalizeString(line)).filter(Boolean);
  const out = [];

  for (const line of lines) {
    const commaParts = line.split(/\s*,\s*/).map((part) => normalizeString(part)).filter(Boolean);
    if (commaParts.length >= 2 && commaParts.some((part) => /\b\d{5}\s+/.test(part))) {
      out.push(...commaParts);
    } else {
      out.push(line);
    }
  }

  return dedupe(out).join("\n").trim();
}

function formatAddressBlockWithName(name = "", address = "", fallbackName = "[Name bitte prüfen/eintragen]") {
  const cleanName = looksLikePersonName(name) ? normalizeString(name) : fallbackName;
  const cleanAddress = splitAddressIntoLines(normalizePostalAddress(address) || address);
  if (cleanAddress && cleanAddress.toLowerCase().includes(cleanName.toLowerCase())) return cleanAddress;
  if (cleanAddress) return `${cleanName}\n${cleanAddress}`.trim();
  return `${cleanName}\n[Adresse bitte prüfen/eintragen]`;
}

function formatRecipientAddressBlock(sender = "", address = "") {
  const cleanSender = normalizeString(sender);
  const cleanAddress = splitAddressIntoLines(normalizePostalAddress(address) || address);
  if (cleanAddress && cleanSender && cleanAddress.toLowerCase().includes(cleanSender.toLowerCase())) return cleanAddress;
  if (cleanSender && cleanAddress) return `${cleanSender}\n${cleanAddress}`.trim();
  if (cleanAddress) return cleanAddress;
  if (cleanSender) return `${cleanSender}\n[Anschrift aus dem Schreiben übernehmen]`;
  return "[Empfängeranschrift aus dem Schreiben übernehmen]";
}

function getCityFromPostalAddress(address = "") {
  const text = String(address || "");
  const matches = Array.from(text.matchAll(/\b\d{5}\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+){0,3})/g));
  if (!matches.length) return "";
  const city = normalizeString(matches[matches.length - 1][1]);
  if (!city || /straße|strasse|weg|platz|allee|gasse/i.test(city)) return "";
  return city;
}

function labelAndCleanReference(ref = "", domain = "allgemein") {
  const original = normalizeString(ref);
  if (!original) return { label: "", value: "" };

  const labelMatch = original.match(/^(mahnungsnummer|mahnnummer|aktenzeichen|az|kundennummer|kunden-nr\.?|bg-nummer|steuernummer|beitragsnummer|rechnungsnummer|versicherungsscheinnummer|versicherungsnummer|vertragsnummer|vertragskonto|nummer)\s*[:#-]?\s*(.+)$/i);
  let label = "";
  let value = original;
  if (labelMatch) {
    label = labelMatch[1].toLowerCase();
    value = normalizeString(labelMatch[2]);
  }

  value = value
    .replace(/^(aktenzeichen|az|kundennummer|kunden-nr\.?|bg-nummer|steuernummer|beitragsnummer|rechnungsnummer|versicherungsscheinnummer|versicherungsnummer|vertragsnummer|vertragskonto|mahnungsnummer|mahnnummer|nummer)\s*[:#-]?\s*/i, "")
    .trim();

  if (!value || isUnsafeReference(value)) return { label: "", value: "" };

  if (/mahn/.test(label)) return { label: "Mahnungsnummer", value };
  if (/steuer/.test(label)) return { label: "Steuernummer", value };
  if (/beitrag/.test(label)) return { label: "Beitragsnummer", value };
  if (/rechnung/.test(label)) return { label: "Rechnungsnummer", value };
  if (/versicherungsschein/.test(label)) return { label: "Versicherungsscheinnummer", value };
  if (/versicherung/.test(label)) return { label: "Versicherungsnummer", value };
  if (/vertrag/.test(label)) return { label: "Vertragsnummer", value };
  if (/kunden/.test(label)) return { label: "Kundennummer", value };
  if (/bg/.test(label)) return { label: "BG-Nummer", value };
  if (/aktenzeichen|az/.test(label)) return { label: "Aktenzeichen", value };

  if (domain === "vertrag_versicherung") return { label: "Versicherungsscheinnummer", value };
  if (domain === "finanzamt") return { label: "Steuernummer", value };
  if (domain === "inkasso") return { label: "Aktenzeichen", value };
  return { label: "Nummer", value };
}

function formatReferenceForSubject(ref = "", domain = "allgemein") {
  const parsed = labelAndCleanReference(ref, domain);
  if (!parsed.value) return "";
  return `${parsed.label} ${parsed.value}`.trim();
}

function formatReferenceForSentence(ref = "", domain = "allgemein") {
  const parsed = labelAndCleanReference(ref, domain);
  if (!parsed.value) return "";
  return `zur ${parsed.label} ${parsed.value}`.trim();
}

function inferIntentFromHistory(historyText = "") {
  const h = String(historyText || "").toLowerCase();
  // V14.3: Erstattung/Kostenübernahme muss im Schreibmodus erhalten bleiben.
  // Beispiel: Nutzer schreibt Türkisch „sigortaya yollayayım, bir kısmını geri alayım“.
  // Dann ist die Zielstelle Krankenkasse/Versicherung, nicht die DZR/der Absender der Rechnung.
  if (hasReimbursementIntent(h, "") || hasOfficialWriteToCostCarrierCue(h)) {
    return "reimbursement";
  }
  if (hasAny(h, ["ratenzahlung", "rate", "in raten"])) return "installments";
  if (hasAny(h, ["widerruf", "kündigung", "kuendigung", "kündigen", "kuendigen"])) return "cancel";
  if (hasAny(h, ["stundung", "zahlungsaufschub", "kann nicht zahlen", "kein geld"])) return "no_money";
  if (hasAny(h, ["zahlungsnachweis", "bereits bezahlt", "schon bezahlt"])) return "paid";
  if (hasAny(h, ["widerspruch", "stimmt nicht", "bestreiten"])) return "dispute";
  return "reply";
}

function cleanAddressLines(lines = []) {
  const cleaned = [];
  for (const line of lines) {
    const l = normalizeString(line);
    if (!l) continue;
    if (/iban|bic|telefon|tel\.|fax|e-mail|email|www\.|http|öffnungszeiten|oeffnungszeiten/i.test(l)) continue;
    cleaned.push(l);
  }
  const block = cleaned.join("\n").trim();
  return normalizePostalAddress(block) || "";
}

function splitContextLines(context = "") {
  return String(context || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => normalizeString(line))
    .filter(Boolean);
}

function findAddressBlockAfterLine(context = "", target = "") {
  const lines = splitContextLines(context);
  const needle = normalizeString(target).toLowerCase();
  if (!needle) return "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (!line.includes(needle) && !needle.includes(line)) continue;
    const block = cleanAddressLines(lines.slice(i, i + 4));
    if (block && looksLikeAddress(block)) return block;
  }
  return "";
}

function findAnyPostalBlock(context = "") {
  const lines = splitContextLines(context);
  for (let i = 0; i < lines.length; i++) {
    const block = cleanAddressLines(lines.slice(i, i + 4));
    if (block && looksLikeAddress(block)) return block;
  }
  return "";
}

function getUserPostalAddress(meta = {}, context = "") {
  const name = getSafeSignatureName(meta, context);
  const fromMeta = normalizePostalAddress(meta.absender_adresse || meta.user_adresse || meta.adresse);
  if (fromMeta) return formatAddressBlockWithName(name, fromMeta);

  if (name && name !== "[Name]") {
    const fromContext = findAddressBlockAfterLine(context, name);
    if (fromContext) return formatAddressBlockWithName(name, fromContext);
  }

  return formatAddressBlockWithName(name && name !== "[Name]" ? name : "", "");
}

function getRecipientPostalAddress(meta = {}, context = "") {
  const sender = getSender(meta);
  const fromMeta = normalizePostalAddress(meta.empfaenger_adresse || meta.absender_adresse_empfaenger || meta.postanschrift);
  if (fromMeta) return formatRecipientAddressBlock(sender, fromMeta);

  if (sender) {
    const fromContext = findAddressBlockAfterLine(context, sender);
    if (fromContext) return formatRecipientAddressBlock(sender, fromContext);
  }

  const any = findAnyPostalBlock(context);
  const personName = getSafeSignatureName(meta, context);
  if (any && (!personName || !any.toLowerCase().includes(String(personName).toLowerCase()))) return formatRecipientAddressBlock(sender, any);

  return formatRecipientAddressBlock(sender, "");
}

function wantsPdfOutput(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();
  return hasAny(q, [
    "pdf", "pdf-brief", "brief als pdf", "als pdf", "download", "herunterladen", "ausdrucken",
    "mektup", "mektupla", "dilekçe", "dilekce", "yazdır", "yazdir", "posta ile",
    "писмо", "scrisoare", "letter"
  ]);
}

function wantsEmailOutput(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();
  return hasAny(q, ["e-mail", "email", "mail", "per mail", "e-posta", "eposta", "имейл"]);
}

function wantsBothEmailAndPdf(frage = "", frageMode = "") {
  return wantsPdfOutput(frage, frageMode) && wantsEmailOutput(frage, frageMode);
}


function normalizeChoiceAnswer(frage = "") {
  const q = normalizeString(frage).toLowerCase();
  if (/^(1|eins|ein|erste|e-mail|email|mail|als e-mail|als email)$/.test(q)) return "email";
  if (/^(2|zwei|zweite|pdf|pdf brief|pdf-brief|als pdf|brief|mektup|dilekçe|dilekce|pdf-brief zum herunterladen)$/.test(q)) return "pdf";
  if (/^(3|drei|dritte|beides|beide|email und pdf|e-mail und pdf|mail und pdf)$/.test(q)) return "both";
  return "";
}

function isAnsweringOutputChoice(frage = "", historyText = "") {
  const choice = normalizeChoiceAnswer(frage);
  if (!choice) return "";
  const h = String(historyText || "").toLowerCase();
  if (
    h.includes("wie möchtest du es haben") ||
    h.includes("als e-mail") ||
    h.includes("als pdf-brief") ||
    h.includes("beides")
  ) {
    return choice;
  }
  return "";
}

function isUnsafeReference(value) {
  const v = normalizeString(value);
  if (!v) return true;
  if (looksLikeEmail(v) || looksLikeIban(v) || looksLikePhone(v) || looksLikeAddress(v)) return true;
  if (/\b(bic|iban|konto|kontoinhaber|telefon|tel\.|fax|www\.|http|öffnungszeiten|oeffnungszeiten)\b/i.test(v)) return true;
  if (v.length > 90) return true;
  return false;
}

function safeReferences(meta = {}) {
  const refs = [...normalizeArray(meta.referenzen), ...normalizeArray(meta.referenzen_erkannt_roh)];
  return dedupe(refs.filter((r) => !isUnsafeReference(r))).slice(0, 4);
}

function isCompanyLikeName(value) {
  const v = normalizeString(value).toLowerCase();
  if (!v) return true;
  return hasAny(v, [
    "gmbh", "ag", "kg", "ug", "ev", "e.v.", "versicherung", "bank", "sparkasse", "jobcenter",
    "finanzamt", "amtsgericht", "staatsanwaltschaft", "inkasso", "personalmanagement", "krankenkasse",
    "beitragsservice", "stadt", "gemeinde", "landkreis", "agentur", "service", "verwaltung",
    "portal", "patientenportal", "www", "http", "forderung", "abrechnungsstelle", "rechnungsaussteller"
  ]);
}

function looksLikePersonName(value) {
  const v = normalizeString(value).replace(/^(herr|frau)\s+/i, "").trim();
  if (!v || v.length < 4 || v.length > 80) return false;
  if (isCompanyLikeName(v)) return false;
  if (/bitte|prüfen|pruefen|unklar|unbekannt|nicht sicher|name/i.test(v)) return false;
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return false;
  return parts.every((p) => /^[A-Za-zÄÖÜäöüßÇĞİŞçğışéèêáàâóòôúùû.'-]{2,}$/.test(p));
}

function scorePersonNameForAutofill(value = "") {
  const clean = normalizeString(value).replace(/^(herr|frau)\s+/i, "").replace(/,.*$/, "").trim();
  if (!looksLikePersonName(clean)) return -1;
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length * 100 + clean.length;
}

function chooseBestPersonName(candidates = []) {
  let best = "";
  let bestScore = -1;
  for (const candidate of candidates) {
    const clean = normalizeString(candidate).replace(/^(herr|frau)\s+/i, "").replace(/,.*$/, "").trim();
    const score = scorePersonNameForAutofill(clean);
    if (score > bestScore) {
      best = clean;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : "";
}

function getDetectedPersonName(meta = {}) {
  const candidates = [
    meta.person,
    meta.betroffene_person,
    meta.empfaenger,
    meta.empfänger,
    meta.kunde,
    meta.patient,
    meta.arbeitnehmer,
    meta.versicherungsnehmer,
    ...(Array.isArray(meta.betroffene_personen) ? meta.betroffene_personen : [])
  ];
  return chooseBestPersonName(candidates);
}

function normalizeChoice(value, allowed, fallback = "unklar") {
  const v = normalizeString(value).toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

function normalizeInfo(info = {}) {
  const allRefs = normalizeArray(info.referenzen);
  const email = normalizeString(info.email_adresse) || findEmail(JSON.stringify(info));

  return {
    absender_original: normalizeString(info.absender_original),
    absender_kurz: normalizeString(info.absender_kurz),
    email_adresse: looksLikeEmail(email) ? email : "",
    absender_adresse: normalizePostalAddress(info.absender_adresse),
    empfaenger_adresse: normalizePostalAddress(info.empfaenger_adresse),
    briefart: normalizeString(info.briefart),
    betroffene_person: normalizeString(info.betroffene_person),
    empfaenger: normalizeString(info.empfaenger),
    betroffene_personen: normalizeArray(info.betroffene_personen),
    zeugen: normalizeArray(info.zeugen),
    angeklagte_beschuldigte: normalizeArray(info.angeklagte_beschuldigte),
    worum_geht_es: normalizeString(info.worum_geht_es),
    wichtigste_punkte: normalizeArray(info.wichtigste_punkte),
    was_ist_zu_tun: normalizeArray(info.was_ist_zu_tun),
    frist: normalizeString(info.frist),
    termin: normalizeString(info.termin),
    folge_wenn_nichts: normalizeString(info.folge_wenn_nichts),
    versteckte_wichtige_info: normalizeString(info.versteckte_wichtige_info),
    kurz_gesagt: normalizeString(info.kurz_gesagt),
    unsicherheiten: normalizeArray(info.unsicherheiten),
    pflicht_oder_freiwillig: normalizeChoice(info.pflicht_oder_freiwillig, ["pflicht", "freiwillig", "information", "werbung", "unklar"], "unklar"),
    dringlichkeit: normalizeChoice(info.dringlichkeit, ["hoch", "mittel", "niedrig", "unklar"], "unklar"),
    naechster_schritt: normalizeString(info.naechster_schritt),
    betrag: normalizeString(info.betrag),
    datum_schreiben: normalizeString(info.datum_schreiben),
    unterlagen: normalizeArray(info.unterlagen),
    referenzen: allRefs,
    antwort_sprache: normalizeChoice(info.antwort_sprache, ["de", "tr", "bg", "ar", "ro", "en", "unklar"], "unklar"),
    brief_schwierigkeit: normalizeChoice(info.brief_schwierigkeit, ["leicht", "mittel", "ernst", "unklar"], "unklar"),
    muss_handeln: normalizeChoice(info.muss_handeln, ["ja", "nein", "unklar"], "unklar"),
    geld_betroffen: normalizeChoice(info.geld_betroffen, ["ja", "nein", "unklar"], "unklar"),
    risiko_kurz: normalizeString(info.risiko_kurz),
    erster_sicherer_schritt: normalizeString(info.erster_sicherer_schritt),
    daten_unsicher: normalizeArray(info.daten_unsicher),
    passende_aktionen: normalizeArray(info.passende_aktionen)
  };
}

function buildExtractionPromptBase(inputMode) {
  return `
Du bist Hilfe24. Lies und verstehe ein Schreiben für Menschen, die Briefe nicht gut verstehen.

Input: ${inputMode === "image" ? "Bilder eines Briefes. Lies sie genau." : "Text eines Briefes."}

WICHTIG:
- Erkenne allgemein jede Briefart. Nicht auf einzelne Testfälle fixieren.
- Keine Daten erfinden. Namen, Beträge, Fristen, Termine, Nummern nur übernehmen, wenn sicher lesbar.
- Unterscheide Absender/Firma und betroffene Person. Absender/Firma niemals als betroffene Person eintragen.
- Eine IBAN, BIC, Telefonnummer, Adresse, Webseite oder E-Mail ist keine Aktenzeichen-Referenz.
- E-Mail-Adresse des Absenders separat bei email_adresse eintragen, falls sichtbar.
- Postanschrift der betroffenen Person bei absender_adresse eintragen, wenn sicher sichtbar.
- Postanschrift des Empfängers/Absenders der Stelle bei empfaenger_adresse eintragen, wenn sicher sichtbar.
- Bei Online-Vertrag/Versicherung/Kredit-Anfrage: als Vertrag/Versicherung/Widerruf/Kündigung einordnen, nicht als Bank/P-Konto.
- Bank/P-Konto nur wenn wirklich Pfändung, P-Konto, Pfändungsschutzkonto, Freibetrag oder Kontopfändung vorkommt.
- Gib nur gültiges JSON zurück. Keine Markdown-Codeblöcke.

Gib genau dieses JSON zurück:
{
  "absender_original": "",
  "absender_kurz": "",
  "email_adresse": "",
  "absender_adresse": "",
  "empfaenger_adresse": "",
  "briefart": "",
  "betroffene_person": "",
  "empfaenger": "",
  "betroffene_personen": [],
  "zeugen": [],
  "angeklagte_beschuldigte": [],
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
  "datum_schreiben": "",
  "unterlagen": [],
  "referenzen": [],
  "antwort_sprache": "unklar",
  "brief_schwierigkeit": "unklar",
  "muss_handeln": "unklar",
  "geld_betroffen": "unklar",
  "risiko_kurz": "",
  "erster_sicherer_schritt": "",
  "daten_unsicher": [],
  "passende_aktionen": []
}
`;
}

function buildExtractionPromptForText(text) {
  return `${buildExtractionPromptBase("text")}\nTEXT DES SCHREIBENS:\n${String(text || "").slice(0, 14000)}`;
}

function buildExtractionPromptForImages() {
  return buildExtractionPromptBase("image");
}

async function buildInfoFromText(text) {
  const raw = await callGemini([{ text: buildExtractionPromptForText(text) }]);
  return normalizeInfo(extractJson(raw));
}

async function buildInfoFromImages(bilder) {
  const parts = [{ text: buildExtractionPromptForImages() }];
  let i = 1;
  for (const bild of bilder) {
    if (!bild || !bild.imageData || !bild.mimeType) continue;
    parts.push({ text: `\nFOTO ${i}: Bitte genau lesen.\n` });
    parts.push({ inline_data: { mime_type: bild.mimeType, data: bild.imageData } });
    i++;
  }
  const raw = await callGemini(parts);
  return normalizeInfo(extractJson(raw));
}

function getSender(meta = {}) {
  return normalizeString(meta.absender_kurz || meta.absender_original || meta.absender || "");
}

function getAmount(meta = {}) {
  return normalizeString(meta.betrag || meta.gesamtbetrag || meta.forderung || "");
}

function getDate(meta = {}) {
  return normalizeString(meta.datum_schreiben || meta.datum || "");
}

function getPrimaryReference(meta = {}) {
  return safeReferences(meta)[0] || "";
}

function buildContext(meta = {}, briefText = "", kurz = "", details = "", frage = "", historyText = "") {
  return [
    meta.briefart,
    meta.absender,
    meta.absender_kurz,
    meta.absender_original,
    meta.email_adresse,
    meta.absender_adresse,
    meta.empfaenger_adresse,
    meta.betroffene_person,
    meta.empfaenger,
    meta.worum_geht_es,
    meta.kurz_gesagt,
    meta.betrag,
    meta.frist,
    meta.termin,
    meta.datum_schreiben,
    meta.risiko_kurz,
    meta.naechster_schritt,
    Array.isArray(meta.wichtigste_punkte) ? meta.wichtigste_punkte.join(" ") : "",
    Array.isArray(meta.was_ist_zu_tun) ? meta.was_ist_zu_tun.join(" ") : "",
    Array.isArray(meta.referenzen) ? meta.referenzen.join(" ") : "",
    Array.isArray(meta.referenzen_erkannt_roh) ? meta.referenzen_erkannt_roh.join(" ") : "",
    briefText,
    kurz,
    details,
    frage,
    historyText
  ].join(" ");
}

function isStrictBankPkontoContext(context = "") {
  const t = String(context || "").toLowerCase();
  const bankHit = hasAny(t, ["bank", "postbank", "sparkasse", "volksbank", "konto", "drittschuldner"]);
  const pHit = hasAny(t, ["p-konto", "pfändungsschutzkonto", "pfaendungsschutzkonto", "kontopfändung", "kontopfaendung", "pfändungsbeschluss", "pfaendungsbeschluss", "freibetrag", "konto gesperrt", "gepfändet", "gepfaendet"]);
  return bankHit && pHit;
}

function detectDomain(context = "") {
  const t = String(context || "").toLowerCase();

  // P-Konto nur bei echter Bank/Kontopfändung. IBAN allein reicht nie.
  if (isStrictBankPkontoContext(t)) return "bank_pkonto";

  // Arbeit zuerst prüfen, damit "Arbeitsvertrag" nicht als allgemeiner Vertrag landet.
  if (hasAny(t, [
    "arbeitgeber", "arbeitnehmer", "überzahlung", "ueberzahlung", "rückzahlung", "rueckzahlung",
    "schuldanerkenntnis", "lohnabtretung", "gehalt", "lohn", "personalmanagement",
    "arbeitsvertrag", "abmahnung", "aufhebungsvertrag", "arbeitsentgelt"
  ])) return "arbeit";

  if (hasAny(t, ["finanzamt", "steuer", "steuernummer", "einkommensteuer", "säumniszuschlag", "saeumniszuschlag", "vollstreckungsstelle"])) return "finanzamt";

  if (hasAny(t, ["inkasso", "gläubiger", "glaeubiger", "forderung", "mahnbescheid", "gerichtsvollzieher", "vollstreckung", "forderungsaufstellung"])) return "inkasso";

  if (hasAny(t, ["jobcenter", "bürgergeld", "buergergeld", "sozialamt", "familienkasse", "rente", "bescheid", "rückforderung", "rueckforderung", "aufrechnung", "widerspruch", "rechtsbehelf", "mitwirkung"])) return "behoerde";

  if (hasAny(t, ["rundfunkbeitrag", "beitragsservice", "beitragskonto", "ard zdf", "deutschlandradio"])) return "rundfunk";

  if (hasAny(t, ["gericht", "amtsgericht", "staatsanwaltschaft", "polizei", "anklageschrift", "straf", "ladung", "zeuge", "beschuldig", "angeklagt", "geldauflage"])) return "gericht";

  if (hasAny(t, ["krankenkasse", "pflegekasse", "pflegegrad", "krankengeld", "aok", "tk", "barmer", "dak", "hilfsmittel", "arztbrief", "befund", "krankenhaus"])) return "gesundheit";

  if (hasAny(t, ["vermieter", "miete", "wohnung", "nebenkosten", "kaution", "räumung", "raeumung", "hausverwaltung"])) return "wohnung";

  if (hasAny(t, [
    "finanz-schutzbrief", "versicherungsschein", "versicherungsscheinnummer", "versicherungsbeginn", "versicherungsablauf",
    "versicherung", "sepa-lastschrift", "lastschrift", "widerruf", "online", "kredit", "abo", "anbieter",
    "strom", "gas", "internet", "handyvertrag", "fitnessstudio", "vertrag kündigen", "vertrag kuendigen"
  ])) return "vertrag_versicherung";

  if (hasAny(t, ["rechnung", "zahlungserinnerung", "zahlungsfrist", "offener betrag"])) return "zahlung";

  return "allgemein";
}

function wantsWrittenOutput(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();
  return wantsOfficialLetterLikeText(q);
}

function detectIntent(frage = "", frageMode = "", historyText = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();

  if (/^(ok|okay|danke|alles klar|verstanden|passt|ja)$/i.test(normalizeString(frage))) return "smalltalk";

  // V14.4: Nutzerziel Kostenübernahme/Erstattung schlägt allgemeinen Schreibwunsch.
  if (hasReimbursementIntent(frage, frageMode)) return "reimbursement";

  if (wantsExplicitGermanDraft(q) && wantsOfficialLetterLikeText(q)) {
    if (wantsPdfOutput(frage, frageMode)) return "pdf";
    return "reply";
  }

  if (hasAny(q, ["dilekçe", "dilekce", "mektup", "mektupla", "hazırla", "hazirla", "cevap yaz", "almanca hazırla", "almanca hazirla"])) {
    if (wantsPdfOutput(frage, frageMode)) return "pdf";
    return "reply";
  }

  // Spezifische Nutzerlage zuerst erkennen. Danach entscheidet buildForcedChatAnswer,
  // ob kurze Hilfe oder fertige E-Mail/PDF gebraucht wird.
  if (hasAny(q, ["kündigen", "kuendigen", "kündigung", "kuendigung", "widerrufen", "widerruf", "vertrag raus", "abbuchen stoppen", "lastschrift stoppen"])) return "cancel";
  if (hasAny(q, ["kein geld", "kann nicht zahlen", "nicht bezahlen", "nicht zahlen", "nicht auf einmal", "zahlungsaufschub", "stundung"])) return "no_money";
  if (hasAny(q, ["ratenzahlung", "rate", "raten", "monatlich zahlen", "in raten"])) return "installments";
  if (hasAny(q, ["schon bezahlt", "bereits bezahlt", "habe bezahlt", "überwiesen", "ueberwiesen", "zahlungsnachweis"])) return "paid";
  if (hasAny(q, ["schon geschickt", "bereits geschickt", "nachweis geschickt", "unterlagen geschickt", "bescheid geschickt", "befreiung geschickt"])) return "sent_proof";
  if (hasAny(q, ["stimmt nicht", "forderung falsch", "kenne ich nicht", "nicht richtig", "bestreiten", "widersprechen", "widerspruch", "einspruch"])) return "dispute";

  if (hasAny(q, ["pdf", "als pdf", "pdf-brief", "brief als pdf"])) return "pdf";
  if (wantsWrittenOutput(frage, frageMode)) return "reply";
  if (hasAny(q, ["was soll ich tun", "was muss ich tun", "was jetzt", "nächster schritt", "naechster schritt", "wie weiter"])) return "next_steps";
  if (hasAny(q, ["welche unterlagen", "unterlagen", "anhängen", "anhaengen", "mitschicken", "dokumente"])) return "documents";
  if (hasAny(q, ["termin verschieben", "neuer termin", "absagen", "krank", "kann nicht kommen"])) return "appointment";
  if (hasAny(q, ["frist", "bis wann", "deadline", "termin"])) return "deadline";

  return "";
}

function getRecipientLine(meta = {}, context = "", intent = "") {
  if (intent === "reimbursement" || intent === "erstattung_kostenuebernahme") {
    return "[E-Mail-Adresse der Krankenkasse / Versicherung eintragen]";
  }
  const email = normalizeString(meta.email_adresse) || findEmail(context);
  if (looksLikeEmail(email)) return email;
  const sender = getSender(meta);
  if (sender) return `${sender} – E-Mail oder Anschrift aus dem Schreiben übernehmen`;
  return "E-Mail oder Anschrift aus dem Schreiben übernehmen";
}

function cleanReferenceLabel(ref = "") {
  return labelAndCleanReference(ref, "allgemein").value;
}

function referenceLabelForDomain(ref = "", domain = "allgemein") {
  return formatReferenceForSubject(ref, domain);
}

function hasCreditRejectedContext(context = "") {
  const t = String(context || "").toLowerCase();
  return hasAny(t, ["kredit"])
    && hasAny(t, ["abgelehnt", "nicht bewilligt", "nicht genehmigt", "nicht bekommen", "keinen kredit", "kredit wurde abgelehnt"]);
}

function isFinanzSchutzbriefContext(context = "") {
  return hasAny(context, ["finanz-schutzbrief", "finanzschutzbrief", "finanz schutzbrief"]);
}

function findPersonNameInContext(context = "") {
  const text = String(context || "");
  const candidates = [];
  const patterns = [
    /(?:Herr|Frau)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüßÇĞİŞçğışéèêáàâóòôúùû.'-]{1,40}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüßÇĞİŞçğışéèêáàâóòôúùû.'-]{1,40}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüßÇĞİŞçğışéèêáàâóòôúùû.'-]{1,40})?)/g,
    /(?:Versicherungsnehmer|Kunde|Arbeitnehmer|Patient|Name)\s*[:\-]?\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüßÇĞİŞçğışéèêáàâóòôúùû.'-]{1,40}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüßÇĞİŞçğışéèêáàâóòôúùû.'-]{1,40}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüßÇĞİŞçğışéèêáàâóòôúùû.'-]{1,40})?)/gi
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      if (m && m[1]) candidates.push(m[1]);
    }
  }
  return chooseBestPersonName(candidates);
}

function getSafeSignatureName(meta = {}, context = "") {
  const fromMeta = getDetectedPersonName(meta);
  const fromContext = findPersonNameInContext(context);
  return chooseBestPersonName([fromMeta, fromContext]) || "[Name]";
}

function buildSubject(meta = {}, domain = "allgemein", intent = "reply", context = "") {
  const refRaw = getPrimaryReference(meta);
  const ref = referenceLabelForDomain(refRaw, domain);
  const date = getDate(meta);
  const topic = normalizeString(meta.briefart || meta.worum_geht_es || "");

  let base = "Bitte um Prüfung Ihres Schreibens";
  if (intent === "pdf") base = "Schriftliche Antwort auf Ihr Schreiben";
  if (intent === "no_money") base = "Bitte um Zahlungsaufschub / Stundung";
  if (intent === "installments") base = "Bitte um Ratenzahlung";
  if (intent === "paid") base = "Zahlungsnachweis / Bitte um Prüfung";
  if (intent === "sent_proof") base = "Nachweis erneut eingereicht";
  if (intent === "dispute") base = "Bitte um Prüfung und Klärung";
  if (intent === "cancel") base = "Widerruf und hilfsweise Kündigung";
  if (intent === "reimbursement" || intent === "erstattung_kostenuebernahme") base = "Bitte um Prüfung einer Kostenerstattung";

  if (domain === "vertrag_versicherung") {
    base = isFinanzSchutzbriefContext(context)
      ? "Widerruf und hilfsweise Kündigung des Finanz-Schutzbriefs"
      : "Widerruf und hilfsweise Kündigung des Vertrags";
  }
  if (domain === "arbeit") base = "Bitte um Prüfung der Rückzahlungsvereinbarung";
  if (domain === "bank_pkonto") base = "Bitte um Klärung zur Kontopfändung / P-Konto";
  if (domain === "finanzamt") base = intent === "no_money" ? "Antrag auf Stundung / Zahlungsaufschub" : "Bitte um Prüfung des Steuerbescheids";
  if (domain === "inkasso") base = intent === "installments" ? "Bitte um Ratenzahlung / Forderungsaufstellung" : "Bitte um Prüfung der Forderung";
  if (domain === "gericht") base = "Ihr Schreiben / Bitte um Klärung";

  const parts = [base];
  if (ref) parts.push(ref);
  else if (date) parts.push(`Schreiben vom ${date}`);
  else if (topic && topic.length < 60 && !/iban|bic|telefon|adresse/i.test(topic)) parts.push(topic);

  return parts.join(" – ").replace(/\s+/g, " ").trim();
}

function buildReferenceSentence(meta = {}, domain = "allgemein", context = "") {
  const refRaw = getPrimaryReference(meta);
  const refValue = cleanReferenceLabel(refRaw);
  const refSentence = formatReferenceForSentence(refRaw, domain);
  const date = getDate(meta);
  const amount = getAmount(meta);
  const topic = normalizeString(meta.briefart || meta.worum_geht_es || "");

  if (domain === "vertrag_versicherung") {
    if (isFinanzSchutzbriefContext(context) && refValue) return `ich beziehe mich auf den Finanz-Schutzbrief mit der Versicherungsscheinnummer ${refValue}.`;
    if (refValue) return `ich beziehe mich auf den Vertrag mit der Nummer ${refValue}.`;
    if (date) return `ich beziehe mich auf Ihr Schreiben vom ${date}.`;
    return "ich beziehe mich auf den Vertrag bzw. Ihr Schreiben.";
  }

  if (domain === "arbeit") {
    if (hasAny(context, ["ratenzahlung", "schuldanerkenntnis"]) && date) return `ich beziehe mich auf die Vereinbarung zur Ratenzahlung und zum Schuldanerkenntnis vom ${date}.`;
    if (date) return `ich beziehe mich auf Ihr Schreiben vom ${date}.`;
    return `ich beziehe mich auf Ihr Schreiben bzw. die Vereinbarung${amount ? " über " + amount : ""}.`;
  }

  const bits = [];
  if (date) bits.push(`vom ${date}`);
  if (refSentence) bits.push(refSentence);
  if (amount) bits.push(`über ${amount}`);

  if (bits.length) return `ich beziehe mich auf Ihr Schreiben ${bits.join(" ")}.`;
  if (topic) return `ich beziehe mich auf Ihr Schreiben zum Thema ${topic}.`;
  return "ich beziehe mich auf Ihr Schreiben.";
}

function buildEmailBody(meta = {}, context = "", domain = "allgemein", intent = "reply") {
  const name = getSafeSignatureName(meta, context);
  const amount = getAmount(meta);

  if (intent === "reimbursement" || intent === "erstattung_kostenuebernahme") {
    const ref = getPrimaryReference(meta);
    const date = getDate(meta);
    const originalSender = getSender(meta);
    const invoiceParts = [];
    if (originalSender) invoiceParts.push(`Abrechnungsstelle/Rechnungsaussteller: ${originalSender}`);
    if (date) invoiceParts.push(`Rechnungsdatum/Schreiben vom: ${date}`);
    if (ref) invoiceParts.push(`Rechnungsnummer/Referenz: ${ref}`);
    if (amount) invoiceParts.push(`Betrag: ${amount}`);
    const invoiceInfo = invoiceParts.length ? "\n\nDaten zur Rechnung:\n- " + invoiceParts.join("\n- ") : "";

    return `Sehr geehrte Damen und Herren,

ich bitte um Prüfung, ob die beigefügte Rechnung ganz oder teilweise erstattet werden kann.

Die Rechnung wurde bereits bezahlt. Den Zahlungsnachweis füge ich bei bzw. reiche ich nach.${invoiceInfo}

Bitte prüfen Sie, ob eine Kostenübernahme oder Erstattung nach meinem Versicherungs-/Leistungsanspruch möglich ist.

Falls weitere Unterlagen benötigt werden, teilen Sie mir bitte schriftlich mit, welche Nachweise noch fehlen. Falls eine detaillierte Leistungsaufstellung erforderlich ist, werde ich diese beim Zahnarzt bzw. bei der Abrechnungsstelle anfordern.

Bitte bestätigen Sie mir den Eingang dieses Schreibens und senden Sie mir Ihre Entscheidung schriftlich zu.

Mit freundlichen Grüßen

${name}`;
  }

  if (domain === "vertrag_versicherung" || intent === "cancel") {
    const creditLine = hasCreditRejectedContext(context)
      ? "Der Vertrag ist im Zusammenhang mit einer Online-Kreditanfrage entstanden. Der beantragte Kredit wurde nach meiner Kenntnis nicht bewilligt."
      : "Der Vertrag ist nach meiner Kenntnis im Zusammenhang mit einer Online-Anfrage entstanden.";

    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

${creditLine} Ich bitte um Prüfung, ob der Vertrag wirksam zustande gekommen ist.

Vorsorglich widerrufe ich den Vertrag, soweit dies noch möglich ist. Hilfsweise kündige ich den Vertrag zum nächstmöglichen Zeitpunkt.

Bitte bestätigen Sie mir schriftlich:
- den Eingang dieses Schreibens,
- ob der Vertrag widerrufen oder gekündigt wurde,
- ob noch Beiträge offen sind,
- ab wann keine weiteren Abbuchungen mehr erfolgen.

Bitte ziehen Sie bis zur Klärung keine weiteren Beträge ein.

Mit freundlichen Grüßen

${name}`;
  }

  if (domain === "bank_pkonto") {
    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Bitte prüfen Sie den Vorgang und teilen Sie mir schriftlich mit:
- ob das betroffene Konto bereits als Pfändungsschutzkonto (P-Konto) geführt wird,
- welcher Freibetrag aktuell geschützt ist,
- ob eine zusätzliche P-Konto-Bescheinigung erforderlich ist,
- welche Beträge aktuell gesperrt oder freigegeben sind,
- welche weiteren Schritte notwendig sind.

Bis zur Klärung bitte ich darum, keine weiteren Maßnahmen einzuleiten oder fortzuführen.

Mit freundlichen Grüßen

${name}`;
  }

  if (domain === "arbeit") {
    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Bitte senden Sie mir eine nachvollziehbare schriftliche Aufstellung, aus der hervorgeht, wodurch die Überzahlung entstanden ist und wie sich der Betrag zusammensetzt.

Bitte teilen Sie mir außerdem mit, welcher Betrag aktuell noch offen ist und ob bereits weitere Schritte eingeleitet wurden.

Bis zur Klärung bitte ich darum, keine weiteren Maßnahmen einzuleiten.

Mit freundlichen Grüßen

${name}`;
  }

  if (intent === "no_money") {
    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Ich kann den genannten Betrag aktuell nicht auf einmal zahlen.

Ich bitte daher um Zahlungsaufschub oder Stundung und um schriftliche Mitteilung, welche Lösung möglich ist.

Bitte setzen Sie weitere Maßnahmen bis zur Prüfung meiner Anfrage aus.

Mit freundlichen Grüßen

${name}`;
  }

  if (intent === "installments") {
    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Bitte senden Sie mir eine aktuelle Aufstellung der Forderung zu.

Ohne Anerkennung einer Rechtspflicht bitte ich, falls die Forderung berechtigt ist, um eine Ratenzahlung. Bitte teilen Sie mir schriftlich mit, welche monatliche Rate möglich ist.

Bis zur Klärung bitte ich darum, keine weiteren Maßnahmen einzuleiten.

Mit freundlichen Grüßen

${name}`;
  }

  if (intent === "paid") {
    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Nach meiner Kenntnis wurde der Betrag bereits bezahlt. Den Zahlungsnachweis füge ich bei bzw. reiche ich nach.

Bitte prüfen Sie den Vorgang und bestätigen Sie mir schriftlich, dass keine offene Forderung mehr besteht.

Mit freundlichen Grüßen

${name}`;
  }

  if (intent === "sent_proof") {
    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Der angeforderte Nachweis wurde bereits eingereicht. Vorsorglich reiche ich ihn erneut ein.

Bitte prüfen Sie den Vorgang erneut und bestätigen Sie mir den Eingang schriftlich.

Bis zur Prüfung bitte ich darum, keine weiteren Maßnahmen einzuleiten.

Mit freundlichen Grüßen

${name}`;
  }

  if (intent === "dispute") {
    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Ich bitte um Prüfung des Vorgangs. Die Forderung bzw. der Inhalt des Schreibens ist für mich nicht nachvollziehbar.

Bitte senden Sie mir eine verständliche Begründung und die dazugehörigen Unterlagen oder Berechnungen zu.

Bis zur Klärung bitte ich darum, keine weiteren Maßnahmen einzuleiten.

Mit freundlichen Grüßen

${name}`;
  }

  if (domain === "inkasso") {
    return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Bitte senden Sie mir eine aktuelle Forderungsaufstellung sowie Nachweise zur geltend gemachten Forderung zu.

Ich bitte um Prüfung und schriftliche Rückmeldung, woraus sich die Forderung zusammensetzt.

Bis zur Klärung bitte ich darum, keine weiteren Maßnahmen einzuleiten.

Mit freundlichen Grüßen

${name}`;
  }

  return `Sehr geehrte Damen und Herren,

${buildReferenceSentence(meta, domain, context)}

Bitte prüfen Sie den Vorgang und teilen Sie mir schriftlich mit, welche nächsten Schritte erforderlich sind.

Bitte bestätigen Sie mir den Eingang dieses Schreibens.

Mit freundlichen Grüßen

${name}`;
}

function buildPdfLetterText(meta = {}, context = "", domain = "allgemein", intent = "pdf") {
  const senderAddress = getUserPostalAddress(meta, context);
  const bodyIntent = intent === "pdf" ? inferIntentFromHistory(context) : intent;
  const recipientAddress = (bodyIntent === "reimbursement" || bodyIntent === "erstattung_kostenuebernahme")
    ? "Krankenkasse / Versicherung\n[Adresse eintragen]"
    : getRecipientPostalAddress(meta, context);
  const subject = buildSubject(meta, domain, intent === "cancel" ? "cancel" : bodyIntent, context);
  const body = buildEmailBody(meta, context, domain, bodyIntent);
  const date = getTodayGerman();
  const city = getCityFromPostalAddress(senderAddress);
  const placeLine = city ? `${city}, ${date}` : `[Ort], ${date}`;

  return cleanText(`${senderAddress}

${recipientAddress}

${placeLine}

Betreff: ${subject}

${body}`);
}

function buildProfessionalOutput(meta = {}, context = "", domain = "allgemein", intent = "reply") {
  const recipient = getRecipientLine(meta, context, intent);
  const subject = buildSubject(meta, domain, intent, context);
  const body = buildEmailBody(meta, context, domain, intent);

  if (intent === "pdf") {
    return buildPdfLetterText(meta, context, domain, intent);
  }

  return cleanText(`Empfänger: ${recipient}

Betreff: ${subject}

${body}`);
}

function buildEmailAndPdfOutput(meta = {}, context = "", domain = "allgemein", intent = "reply") {
  const emailText = buildProfessionalOutput(meta, context, domain, intent);
  const pdfText = buildPdfLetterText(meta, context, domain, intent === "pdf" ? inferIntentFromHistory(context) : intent);
  return cleanText(`E-MAIL:

${emailText}

PDF-BRIEF:

${pdfText}

Hinweis: Bitte prüfe vor dem Senden Name, Adresse, Datum, Nummer und Empfänger.`);
}

function buildPdfOnlyOutput(meta = {}, context = "", domain = "allgemein", intent = "pdf") {
  const rememberedIntent = intent && intent !== "pdf" ? intent : inferIntentFromHistory(context);
  const pdfText = buildPdfLetterText(meta, context, domain, rememberedIntent && rememberedIntent !== "reply" ? rememberedIntent : "pdf");
  return cleanText(`PDF-BRIEF:

${pdfText}`);
}



function askOutputChoice(intent = "reply") {
  const actionMap = {
    cancel: "eine Kündigung oder einen Widerruf",
    no_money: "eine Antwort wegen Zahlungsschwierigkeiten",
    installments: "eine Ratenzahlungs-Anfrage",
    paid: "eine Nachricht mit Zahlungsnachweis",
    sent_proof: "eine Nachricht zum Nachweis/Nachreichen",
    dispute: "eine Prüfungs- oder Widerspruchs-Nachricht",
    reply: "eine passende Antwort",
    reimbursement: "eine Nachricht an Krankenkasse oder Versicherung zur Erstattung"
  };
  const action = actionMap[intent] || actionMap.reply;
  return cleanText(`Ich kann dir daraus ${action} vorbereiten.

Wie möchtest du es haben?

1. Als E-Mail
2. Als PDF-Brief zum Herunterladen
3. Beides`);
}

function buildNextSteps(meta = {}, domain = "allgemein") {
  if (domain === "vertrag_versicherung") {
    return "1. Prüfe, ob du den Vertrag wirklich wolltest.\n2. Wenn nicht: schriftlich widerrufen und hilfsweise kündigen.\n3. Lastschrift/Abbuchungen prüfen und Bestätigung verlangen.";
  }
  if (domain === "bank_pkonto") {
    return "1. Bei der Bank P-Konto-Status und Freibetrag klären.\n2. Gläubiger, Betrag und Aktenzeichen prüfen.\n3. Wenn unklar: Schuldnerberatung oder Verbraucherzentrale kontaktieren.";
  }
  if (domain === "arbeit") {
    return "1. Nicht blind unterschreiben, wenn etwas unklar ist.\n2. Aufstellung zur Überzahlung verlangen.\n3. Lohnabtretung und Schuldanerkenntnis genau prüfen lassen.";
  }
  if (domain === "finanzamt") {
    return "1. Betrag, Steuerart und Frist prüfen.\n2. Wenn Zahlung nicht möglich ist: Stundung oder Ratenzahlung beantragen.\n3. Um Aussetzung der Vollstreckung bis zur Entscheidung bitten.";
  }
  return "1. Absender, Betrag, Frist und Nummer prüfen.\n2. Schriftlich klären, wenn etwas unklar ist.\n3. Keine Frist verstreichen lassen.";
}

function buildNoMoneyShort(meta = {}, domain = "allgemein") {
  if (domain === "vertrag_versicherung") {
    return "Dann nicht einfach weiterlaufen lassen. Schreibe der Versicherung, dass du den Vertrag prüfen lässt, vorsorglich widerrufst/kündigst und bis zur Klärung keine weiteren Abbuchungen möchtest.";
  }
  return "Dann nicht sofort eine Rate vorschlagen. Der sichere Schritt ist Zahlungsaufschub oder Stundung. Schreibe der Stelle, dass du aktuell nicht zahlen kannst, und bitte um Aussetzung weiterer Maßnahmen bis zur Entscheidung.";
}

function buildForcedChatAnswer({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const context = buildContext(meta, briefText, kurz, details, frage, historyText);
  const domain = detectDomain(context);
  const outputChoice = isAnsweringOutputChoice(frage, historyText);
  const intent = outputChoice ? inferIntentFromHistory(historyText || context) : detectIntent(frage, frageMode, historyText);
  const wantsPdf = outputChoice === "pdf" || (!outputChoice && wantsPdfOutput(frage, frageMode));
  const wantsEmail = outputChoice === "email" || (!outputChoice && wantsEmailOutput(frage, frageMode));
  const wantsBoth = outputChoice === "both" || (!outputChoice && wantsBothEmailAndPdf(frage, frageMode));

  if (intent === "smalltalk") return "Gerne. Schreib deine nächste Frage.";

  // V10.1: Ausgabeform sauber trennen.
  // PDF nur bei PDF-Wunsch, E-Mail nur bei E-Mail-Wunsch, beides nur bei beidem.
  // Wenn der Nutzer nur eine Antwort/Ratenzahlung/etc. möchte, fragt Hilfe24 nach der gewünschten Form.
  if (wantsBoth) {
    const finalIntent = intent && intent !== "pdf" ? intent : inferIntentFromHistory(historyText || context);
    return buildEmailAndPdfOutput(meta, context, domain, finalIntent && finalIntent !== "pdf" ? finalIntent : "reply");
  }

  if (intent === "pdf") {
    const rememberedIntent = inferIntentFromHistory(historyText || context);
    return buildPdfOnlyOutput(meta, context, domain, rememberedIntent && rememberedIntent !== "reply" ? rememberedIntent : "pdf");
  }

  const formIntent = intent || "reply";

  if (["cancel", "reply", "no_money", "installments", "paid", "sent_proof", "dispute"].includes(formIntent)) {
    if (wantsPdf && !wantsEmail) return buildPdfOnlyOutput(meta, context, domain, formIntent === "reply" ? "pdf" : formIntent);
    if (wantsEmail && !wantsPdf) return buildProfessionalOutput(meta, context, domain, formIntent);

    if (formIntent === "no_money" && !wantsWrittenOutput(frage, frageMode)) {
      return buildNoMoneyShort(meta, domain);
    }

    return askOutputChoice(formIntent);
  }

  if (intent === "next_steps") return buildNextSteps(meta, domain);
  if (intent === "documents") return "Sende nur Unterlagen, die wirklich zum Schreiben passen. Wichtig sind meist: das Schreiben selbst, die genannte Nummer, Nachweise, Zahlungsbelege oder Bescheide. Wenn du willst, schreibe ich dir eine kurze Nachricht zum Nachreichen.";
  if (intent === "deadline") return meta.frist || meta.termin ? `Frist/Termin: ${meta.frist || meta.termin}. Bitte im Originalbrief prüfen und rechtzeitig reagieren.` : "Ich sehe keine sichere Frist. Bitte prüfe das Originalschreiben oder nutze Daten genauer prüfen.";
  return "";
}


function shortGermanExplanation(info = {}) {
  const lines = [];
  const sender = getSender(info);
  const amount = getAmount(info);

  if (info.kurz_gesagt) lines.push(info.kurz_gesagt);
  else if (sender) lines.push(`Dieser Brief ist von ${sender}.`);
  else lines.push("Das ist ein Schreiben.");

  if (info.worum_geht_es) lines.push(info.worum_geht_es);
  if (amount) lines.push(`Betrag: ${amount}.`);
  if (info.frist || info.termin) lines.push(`Frist/Termin: ${info.frist || info.termin}.`);
  if (info.naechster_schritt) lines.push(info.naechster_schritt);
  else lines.push("Prüfe die Daten im Brief und reagiere rechtzeitig, wenn etwas verlangt wird.");

  return cleanText(dedupe(lines).slice(0, 6).join("\n"));
}

function labelForBrief(info = {}) {
  const ctx = buildContext(info);
  const domain = detectDomain(ctx);
  if (domain === "vertrag_versicherung") return "Versicherung / Vertrag";
  if (domain === "bank_pkonto") return "Bank / Pfändung / P-Konto";
  if (domain === "arbeit") return "Arbeit / Rückzahlung / Vereinbarung";
  if (domain === "finanzamt") return "Finanzamt / Steuer";
  if (domain === "inkasso") return "Inkasso / Forderung";
  if (domain === "behoerde") return "Behörde / Bescheid";
  if (domain === "gericht") return "Gericht / Polizei / Strafsache";
  if (domain === "gesundheit") return "Gesundheit / Krankenkasse";
  return info.briefart || "Schreiben";
}

async function translateShortIfNeeded(text, lang) {
  const langMeta = getLanguageMeta(lang);
  const clean = cleanText(text);
  if (langMeta.code === "de") return clean;

  const raw = await callGemini([{ text: `Übersetze diesen Hilfe24-Text vollständig in ${langMeta.label}. Keine neuen Informationen. Daten, Namen, Beträge, Fristen und Nummern exakt erhalten. Kurz und einfach.\n\nTEXT:\n${clean}` }]);
  return cleanText(raw);
}

async function buildFinalPayloadFromInfo(info, lang, sourceMode = "text") {
  const langCode = getLanguageMeta(lang).code;
  const kurzDe = shortGermanExplanation(info);
  const kurz = await translateShortIfNeeded(kurzDe, langCode);
  const refs = safeReferences(info);
  const name = getDetectedPersonName(info);

  return {
    ok: true,
    quality_ok: true,
    hinweis: "",
    kurz,
    details: "",
    helper: {
      quality_mode: true,
      quality_type: detectDomain(buildContext(info)),
      briefart_label: labelForBrief(info),
      urgency_label: info.dringlichkeit === "hoch" ? "Hoch" : info.dringlichkeit === "mittel" ? "Mittel" : info.dringlichkeit === "niedrig" ? "Niedrig" : "Unklar",
      must_react_label: info.muss_handeln === "ja" ? "Ja" : info.muss_handeln === "nein" ? "Nein" : "Bitte prüfen",
      money_label: info.geld_betroffen === "ja" || info.betrag ? "Ja" : info.geld_betroffen === "nein" ? "Nein" : "Bitte prüfen",
      first_step: info.erster_sicherer_schritt || info.naechster_schritt || "Prüfe zuerst Absender, Betrag, Frist und Nummer im Originalbrief.",
      help_tip: "Wenn du möchtest, schreibe ich dir eine professionelle Antwort, E-Mail oder einen PDF-Brief.",
      next_steps: dedupe(info.was_ist_zu_tun).slice(0, 4),
      suggested_actions: ["Was soll ich jetzt tun?", "Schreib mir eine Antwort", "Welche Unterlagen brauche ich?"],
      unsafe_notice: (info.unsicherheiten || []).length ? "Einige Daten konnten nicht sicher gelesen werden. Bitte im Originalbrief prüfen." : "",
      data_rows: [
        { key: "sender", label: "Absender", value: getSender(info) || "Bitte prüfen", status: getSender(info) ? "safe" : "check" },
        { key: "person", label: "Name", value: name || "Bitte prüfen", status: name ? "safe" : "check" },
        { key: "amount", label: "Betrag", value: info.betrag || "Bitte prüfen", status: info.betrag ? "safe" : "check" },
        { key: "deadline", label: "Frist/Termin", value: info.frist || info.termin || "Bitte prüfen", status: (info.frist || info.termin) ? "safe" : "check" },
        { key: "reference", label: "Aktenzeichen/Nummer", value: refs.join(", ") || "Bitte prüfen", status: refs.length ? "safe" : "check" }
      ],
      whatsapp_summary: `${labelForBrief(info)}${getAmount(info) ? " – Betrag: " + getAmount(info) : ""}. ${info.naechster_schritt || "Bitte prüfen."}`,
      phone_script: ""
    },
    meta: {
      briefart: info.briefart,
      absender: getSender(info),
      absender_kurz: info.absender_kurz,
      absender_original: info.absender_original,
      email_adresse: info.email_adresse,
      absender_adresse: info.absender_adresse,
      empfaenger_adresse: info.empfaenger_adresse,
      person: name,
      person_sicher: Boolean(name),
      betroffene_person: info.betroffene_person,
      empfaenger: info.empfaenger,
      termin: info.termin,
      frist: info.frist,
      betrag: info.betrag,
      datum_schreiben: info.datum_schreiben,
      unterlagen: info.unterlagen,
      referenzen: refs,
      referenzen_erkannt_roh: info.referenzen,
      referenzen_sicher: refs.length > 0,
      dringlichkeit: info.dringlichkeit,
      pflicht_oder_freiwillig: info.pflicht_oder_freiwillig,
      naechster_schritt: info.naechster_schritt,
      antwort_sprache: info.antwort_sprache,
      passende_aktionen: info.passende_aktionen,
      unsicherheiten: info.unsicherheiten,
      sourceMode,
      must_react: info.muss_handeln === "ja" ? "yes" : info.muss_handeln === "nein" ? "no" : "maybe",
      money_affected: info.geld_betroffen === "ja" || info.betrag ? "yes" : info.geld_betroffen === "nein" ? "no" : "maybe",
      brief_schwierigkeit: info.brief_schwierigkeit,
      quality_type: detectDomain(buildContext(info)),
      risiko_kurz: info.risiko_kurz,
      erster_sicherer_schritt: info.erster_sicherer_schritt,
      daten_unsicher: info.daten_unsicher
    }
  };
}



/* =========================================================
   HILFE24 V12 CORE LOGIC
   Kernziel: Briefe zuerst sauber erklären, danach Chatfragen
   direkt beantworten. E-Mail/PDF nur bei ausdrücklichem Wunsch.
   ========================================================= */

function buildHilfe24CoreRules(langLabel = "Deutsch") {
  const langMeta = getLanguageMeta(langLabel && langLabel.length <= 3 ? langLabel : "de");
  const effectiveLang = langMeta.code === "de" && langLabel !== "Deutsch" ? { ...langMeta, label: langLabel, promptLanguage: langLabel, outputLanguage: langLabel } : langMeta;
  return `
Du bist Hilfe24.
Du bist kein normaler Chatbot und kein reiner Brief-Zusammenfasser.
Du bist ein Fall-Assistent für Menschen, die schwierige Briefe, Rechnungen, Mahnungen, Bescheide, Verträge und Behördenpost verstehen müssen.

Sprache für Erklärung und Beratung: ${effectiveLang.label || langLabel}.
Bei offiziellen Antworttexten: Sprache der empfangenden Stelle verwenden. Bei deutschen Stellen immer Deutsch verwenden.

${buildMultilingualRules(effectiveLang)}

Harte Regeln:
1. Nutze nur den aktuellen Brief, die extrahierten Daten und die aktuelle Nutzerfrage.
2. Vermische niemals alte Briefe, alte Namen, alte Beträge oder alte Nummern mit dem aktuellen Fall.
3. Trenne immer: sicher sichtbar / unklar / nicht sichtbar.
4. Wenn etwas nicht im Brief steht, sage klar in der Nutzersprache: "Das steht auf dem sichtbaren Schreiben nicht."
5. Erfinde niemals Behandlungen, Leistungen, Fristen, Gründe, Rechtsfolgen, Aktenzeichen, Beträge oder persönliche Daten.
6. Beantworte normale Fragen zuerst direkt. Frage nicht sofort nach E-Mail/PDF.
7. E-Mail/PDF nur erstellen, wenn der Nutzer das ausdrücklich möchte oder nach einer Antwort zum Senden fragt.
8. Keine Schuld blind anerkennen. Keine Forderung blind bestätigen. Keine rechtlichen Garantien geben.
9. Firma/Behörde niemals als Unterschrift verwenden. IBAN, BIC, Telefon, Fax, Adresse, Öffnungszeiten und E-Mail niemals als Aktenzeichen benutzen.
10. Schreibe klar, menschlich und praktisch: nicht zu kurz, nicht zu lang.

Antwortlogik:
- Verständnisfrage: einfach erklären.
- Handlungsfrage: konkrete Schritte geben.
- Fristfrage: Frist/Termin nennen, wenn sicher; sonst klar sagen, dass sie nicht sicher erkennbar ist.
- Folgefrage: nur echte Folgen aus dem Brief nennen, keine Panik erfinden.
- Schon bezahlt: nicht nochmal zahlen, Zahlungsnachweis senden, Nummer nennen, Prüfung/Zuordnung verlangen, Mahnungen/Maßnahmen bis Klärung stoppen lassen.
- Schon geschickt: Nachweis erneut mit Nummer senden, Prüfung und schriftliche Bestätigung verlangen, Versandnachweis behalten.
- Kann nicht zahlen/Ratenzahlung: Forderung zuerst prüfen; wenn plausibel, Ratenzahlung/Stundung als Möglichkeit nennen; keine Schuld blind anerkennen.
- Was wurde gemacht/Wofür Rechnung: nur sichtbare Details nennen. Wenn keine Leistungsdetails sichtbar sind, detaillierte Rechnung/Leistungsaufstellung/Positionen/GOZ-/BEMA-Nummern anfordern.
- Jobcenter/Bürgergeld/Sozialleistung: mögliche Befreiung, Ermäßigung, Kostenübernahme oder Nachweisprüfung nennen, aber nichts garantieren.
- Schreibwunsch: Ausgabeform klären, wenn nicht genannt: E-Mail, PDF-Brief oder beides. Offizielle Entwürfe immer in Empfänger-/Amtssprache schreiben, nicht in Nutzersprache.
`;
}

function buildExtractionPromptBase(inputMode) {
  return `
Du bist Hilfe24. Lies ein aktuelles Schreiben sehr genau und extrahiere nur sichere Fakten.

Input: ${inputMode === "image" ? "Bilder eines Briefes. Lies alle sichtbaren Seiten genau." : "Text eines Briefes."}

Arbeitsweise:
- Erkenne die Briefart allgemein. Keine Fixierung auf einzelne Testbriefe.
- Trenne sicher sichtbare Daten von unklaren oder fehlenden Daten.
- Nenne in unsicherheiten aktiv, was im sichtbaren Schreiben NICHT steht oder nicht sicher lesbar ist.
- Wenn z. B. nur "zahnärztliche Rechnung" sichtbar ist, aber keine Behandlung/Positionen: unsicherheiten muss enthalten, dass die genaue Behandlung/Leistung nicht sichtbar ist.
- Keine Daten erfinden. Namen, Beträge, Fristen, Termine und Nummern nur übernehmen, wenn sicher lesbar.
- Unterscheide Absender/Firma/Behörde und betroffene Person. Absender/Firma niemals als betroffene Person eintragen.
- Eine IBAN, BIC, Telefonnummer, Adresse, Webseite, Öffnungszeit oder E-Mail ist keine Aktenzeichen-Referenz.
- E-Mail-Adresse separat bei email_adresse eintragen, falls sichtbar.
- Adresse der betroffenen Person bei absender_adresse eintragen, wenn sicher sichtbar.
- Adresse der Stelle/Behörde/Firma bei empfaenger_adresse eintragen, wenn sicher sichtbar.
- Bank/P-Konto nur wenn wirklich Pfändung, P-Konto, Pfändungsschutzkonto, Freibetrag oder Kontopfändung vorkommt.
- Gib nur gültiges JSON zurück. Keine Markdown-Codeblöcke.

Gib genau dieses JSON zurück:
{
  "absender_original": "",
  "absender_kurz": "",
  "email_adresse": "",
  "absender_adresse": "",
  "empfaenger_adresse": "",
  "briefart": "",
  "betroffene_person": "",
  "empfaenger": "",
  "betroffene_personen": [],
  "zeugen": [],
  "angeklagte_beschuldigte": [],
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
  "datum_schreiben": "",
  "unterlagen": [],
  "referenzen": [],
  "antwort_sprache": "unklar",
  "brief_schwierigkeit": "unklar",
  "muss_handeln": "unklar",
  "geld_betroffen": "unklar",
  "risiko_kurz": "",
  "erster_sicherer_schritt": "",
  "daten_unsicher": [],
  "passende_aktionen": []
}
`;
}

function formatImportantDataLines(info = {}) {
  const rows = [];
  const sender = getSender(info);
  const name = getDetectedPersonName(info);
  const amount = getAmount(info);
  const ref = safeReferences(info).join(", ");
  if (sender) rows.push(`- Absender: ${sender}`);
  if (name) rows.push(`- Betroffene Person: ${name}`);
  if (amount) rows.push(`- Betrag: ${amount}`);
  if (info.datum_schreiben) rows.push(`- Datum im Schreiben: ${info.datum_schreiben}`);
  if (info.frist) rows.push(`- Frist: ${info.frist}`);
  if (info.termin) rows.push(`- Termin: ${info.termin}`);
  if (ref) rows.push(`- Nummer/Aktenzeichen: ${ref}`);
  if (!rows.length) rows.push("- Keine wichtigen Daten sicher erkannt. Bitte Originalbrief prüfen.");
  return rows.join("\n");
}

function buildUnclearLines(info = {}) {
  const items = dedupe([
    ...(Array.isArray(info.unsicherheiten) ? info.unsicherheiten : []),
    ...(Array.isArray(info.daten_unsicher) ? info.daten_unsicher : [])
  ]).filter(Boolean);
  if (!items.length) return "- Keine zusätzliche Unsicherheit erkannt. Bitte trotzdem Namen, Betrag, Frist und Nummer im Originalbrief prüfen.";
  return items.slice(0, 5).map((x) => `- ${x}`).join("\n");
}

function buildActionLines(info = {}) {
  const steps = dedupe([
    ...(Array.isArray(info.was_ist_zu_tun) ? info.was_ist_zu_tun : []),
    info.erster_sicherer_schritt,
    info.naechster_schritt
  ]).filter(Boolean);
  if (!steps.length) {
    return "1. Prüfe Absender, Name, Betrag, Frist und Nummer im Originalbrief.\n2. Wenn etwas unklar ist, frage die Stelle schriftlich nach.\n3. Reagiere rechtzeitig, wenn eine Frist oder Zahlung verlangt wird.";
  }
  return steps.slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function buildCoreExplanationDe(info = {}) {
  const sender = getSender(info);
  const amount = getAmount(info);
  const ref = getPrimaryReference(info);
  const next = info.erster_sicherer_schritt || info.naechster_schritt || "Prüfe zuerst die sicheren Daten im Originalbrief und kläre schriftlich, was unklar ist.";
  const shortParts = [];
  if (info.kurz_gesagt) shortParts.push(info.kurz_gesagt);
  else if (sender && amount) shortParts.push(`Es geht um ein Schreiben von ${sender} über ${amount}.`);
  else if (sender) shortParts.push(`Es geht um ein Schreiben von ${sender}.`);
  else shortParts.push("Es geht um ein Schreiben, das geprüft werden muss.");
  if (info.worum_geht_es) shortParts.push(info.worum_geht_es);
  if (info.frist || info.termin) shortParts.push(`Wichtig ist auch: ${info.frist || info.termin}.`);

  return cleanText(`Kurz erklärt:
${dedupe(shortParts).slice(0, 4).join("\n")}

Wichtige Daten:
${formatImportantDataLines(info)}

Was bedeutet das praktisch?
${info.versteckte_wichtige_info || info.risiko_kurz || "Der Brief kann eine Reaktion verlangen. Wichtig ist, die genannten Daten zu prüfen und nichts zu übersehen."}

Was ist unklar?
${buildUnclearLines(info)}

Was du jetzt tun solltest:
${buildActionLines(info)}

Wenn du nichts machst:
${info.folge_wenn_nichts || "Das steht auf dem sichtbaren Schreiben nicht sicher. Wenn eine Frist, Mahnung oder Zahlung genannt ist, solltest du rechtzeitig reagieren."}

Nächster Schritt:
${next}${ref ? ` Nenne dabei die Nummer: ${ref}.` : ""}`);
}

function buildCoreShortDe(info = {}) {
  const sender = getSender(info);
  const amount = getAmount(info);
  const next = info.erster_sicherer_schritt || info.naechster_schritt || "Prüfe zuerst die wichtigen Daten im Originalbrief.";
  const unclear = dedupe([...(info.unsicherheiten || []), ...(info.daten_unsicher || [])])[0] || "Wenn etwas nicht sicher lesbar ist, bitte im Originalbrief prüfen.";
  const lines = [];
  lines.push("Kurz erklärt:");
  if (info.kurz_gesagt) lines.push(info.kurz_gesagt);
  else if (sender && amount) lines.push(`Es geht um ein Schreiben von ${sender} über ${amount}.`);
  else if (sender) lines.push(`Es geht um ein Schreiben von ${sender}.`);
  else lines.push("Es geht um ein Schreiben, das geprüft werden muss.");
  if (info.worum_geht_es) lines.push(info.worum_geht_es);
  lines.push("");
  lines.push("Wichtig:");
  if (amount) lines.push(`Betrag: ${amount}.`);
  if (info.frist || info.termin) lines.push(`Frist/Termin: ${info.frist || info.termin}.`);
  const ref = getPrimaryReference(info);
  if (ref) lines.push(`Nummer: ${ref}.`);
  lines.push("");
  lines.push("Was ist unklar?");
  lines.push(unclear);
  lines.push("");
  lines.push("Nächster Schritt:");
  lines.push(next);
  return cleanText(lines.join("\n"));
}

async function translateHelpTextIfNeeded(text, lang) {
  const langMeta = getLanguageMeta(lang);
  const clean = cleanText(text);
  if (langMeta.code === "de") return clean;
  const raw = await callGemini([{ text: `${buildHilfe24CoreRules(langMeta.label)}\n\nÜbersetze den folgenden Hilfe24-Text vollständig in ${langMeta.label}. Keine neuen Informationen. Namen, Beträge, Fristen und Nummern exakt erhalten.\n\nTEXT:\n${clean}` }]);
  return cleanText(raw);
}

async function translateBriefExplanationSetIfNeeded(kurzDe, detailsDe, lang) {
  const langMeta = getLanguageMeta(lang);
  const cleanKurz = cleanText(kurzDe);
  const cleanDetails = cleanText(detailsDe);
  if (langMeta.code === "de") return { kurz: cleanKurz, details: cleanDetails };

  const raw = await callGemini([{ text: `${buildHilfe24CoreRules(langMeta.code)}

Übersetze diese Hilfe24-Erklärung direkt in ${langMeta.label}.
Keine neuen Informationen. Keine Rückübersetzung. Namen, Adressen, Beträge, Fristen, Termine, Aktenzeichen, BG-Nummern, Rechnungsnummern, Kundennummern und Versicherungsnummern exakt erhalten. Deutsche Fachbegriffe beim ersten Auftreten stehen lassen und kurz in ${langMeta.label} erklären.

Gib nur gültiges JSON zurück:
{ "kurz": "...", "details": "..." }

KURZ_DE:
${cleanKurz}

DETAILS_DE:
${cleanDetails}` }]);

  try {
    const parsed = extractJson(raw);
    return {
      kurz: cleanText(parsed.kurz || cleanKurz),
      details: cleanText(parsed.details || cleanDetails)
    };
  } catch (e) {
    return {
      kurz: await translateHelpTextIfNeeded(cleanKurz, langMeta.code),
      details: await translateHelpTextIfNeeded(cleanDetails, langMeta.code)
    };
  }
}

function isExplicitWriteRequest(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();
  if (wantsPdfOutput(frage, frageMode) || wantsEmailOutput(frage, frageMode)) return true;
  return hasAny(q, ["schreib", "schreibe", "formuliere", "mach mir", "erstelle", "vorlage", "antwort zum senden", "brief erstellen", "professionelle antwort"]);
}

function hasCostCarrierCue(text = "") {
  const q = String(text || "").toLowerCase();
  return /(krankenkasse|krankenversicherung|versicherung|beihilfe|kostenstelle|pflegekasse|kasse|aok|tk|barmer|dak|ikk|kkh|hkk|zahnzusatz|zusatzversicherung|sigorta|sigortaya|sigortadan|sigortam|insurance|insurer|health insurance|asigurare|asigurări|asigurari|casa de asigurări|застраховка|здравна каса)/i.test(q);
}

function hasCreditorOnlyPaymentCue(text = "") {
  const q = String(text || "").toLowerCase();
  return /(ratenzahlung|rate|raten|taksit|taksitli|taksitlendirme|stundung|zahlungsaufschub|zahlungsnachweis|schon bezahlt.*mahnung|an dzr|dzr için|an inkasso|an den gläubiger|an den glaeubiger)/i.test(q);
}

function hasOfficialWriteToCostCarrierCue(text = "") {
  const q = String(text || "").toLowerCase();
  const carrier = hasCostCarrierCue(q);
  const sendWrite = /(schreib|schreibe|formuliere|erstelle|mach mir|e-?mail|mail|pdf|brief|antrag|dilekçe|dilekce|mektup|gönder|gonder|göndermek|gondermek|yolla|yollayayım|yollayayim|hazırla|hazirla|prepare|write|send|trimite|scrisoare|имейл|писмо)/i.test(q);
  return carrier && sendWrite;
}

function hasReimbursementIntent(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();

  const payerCue = hasCostCarrierCue(q);
  const reimbursementCue = /(erstatt|zurück|zurueck|geld zurück|geld zurueck|zurückbekommen|zurueckbekommen|kostenübernahme|kostenuebernahme|übernehm|uebernehm|einreich|einreichen|teil|anteil|zahlt die|bezahlt die|ersetz|ersetzt|bekomme ich.*geld|geld.*bekommen|geri al|geri almak|geri alayım|geri alayim|geri ödeme|geri odeme|bir kısm|bir kisim|ödedim.*geri|odedim.*geri|reimburse|refund|claim|ramburs|decont|înapoi|inapoi|възстанов|възстановяване)/i.test(q);

  // V14.4: Wenn der Nutzer ausdrücklich an Krankenkasse/Versicherung/Kostenträger schreiben will,
  // ist das ein Zielstellen-/Kostenübernahme-Fall, auch wenn er nicht extra „Erstattung“ sagt.
  // Beispiel: „Bana sigortaya göndermek için Almanca e-posta hazırla“.
  const writeToCostCarrier = hasOfficialWriteToCostCarrierCue(q);

  const strongReimbursementCue = /(erstattung|erstattet|geld zurück|geld zurueck|zurückbekommen|zurueckbekommen|kostenübernahme|kostenuebernahme|wer zahlt|wer übernimmt|wer uebernimmt|bekomme ich.*zurück|bekomme ich.*zurueck|geri al|geri alayım|geri alayim|geri ödeme|geri odeme|bir kısmını geri|bir kismini geri|refund|reimbursement|ramburs|decont)/i.test(q);

  // Wenn der Nutzer ausdrücklich Ratenzahlung/Zahlungsnachweis an den Gläubiger will,
  // darf „Versicherung“ aus dem Brief nicht versehentlich auf Erstattung routen.
  if (hasCreditorOnlyPaymentCue(q) && !reimbursementCue && !writeToCostCarrier && !strongReimbursementCue) return false;

  return (payerCue && (reimbursementCue || writeToCostCarrier)) || strongReimbursementCue;
}


function hasComplexCaseIntent(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();

  const authorityCue = /(staatsanwaltschaft|amtsgericht|gericht|polizei|bußgeldstelle|bussgeldstelle|ordnungswidrigkeit|strafverfahren|verfahren)/i.test(q);
  const mixupCue = /(mehrere\s+(aktenzeichen|verfahren|termine)|zwei\s+(aktenzeichen|verfahren)|anderes\s+aktenzeichen|verschiedene\s+aktenzeichen|verwechselt|verwechslung|falsch zugeordnet|falsche person|betrifft.*(mehrere|drei|mich|mutter)|nicht nur|hat sich.*geändert|hat sich.*geaendert|termin.*geändert|termin.*geaendert|ich war.*geschädigt|ich war.*geschaedigt|geschädigte?r|geschaedigte?r|zusammen geschlagen|zusammengeschlagen|amtsgericht.*geschildert|staatsanwaltschaft.*geschildert|sich drum kümmern|sich darum kümmern)/i.test(q);
  const clarificationCue = /(klären|klaeren|prüfen|pruefen|zuordnen|welches\s+aktenzeichen|wer.*zahlen|warum.*zahlen|was soll ich.*machen|wie.*weiter)/i.test(q);

  return (authorityCue && mixupCue) || (authorityCue && clarificationCue && hasAny(q, ["aktenzeichen", "verfahren", "geschädigt", "geschaedigt", "falsche person", "nicht nur"]));
}

function buildComplexCaseAdvice(meta = {}) {
  const ref = getPrimaryReference(meta);
  const amount = getAmount(meta);
  const sender = getSender(meta) || "die Stelle aus dem Schreiben";

  const lines = [];
  lines.push("Das ist kein normaler Zahlungsfall.");
  lines.push("");
  lines.push("Wenn mehrere Personen, Verfahren oder Aktenzeichen durcheinanderlaufen, musst du dir das schriftlich klären lassen. Telefonisch ist gut, aber bei Gericht oder Staatsanwaltschaft brauchst du am besten eine schriftliche Bestätigung.");
  lines.push("");
  lines.push("Was du jetzt tun solltest:");
  lines.push("1. Schreibe der Staatsanwaltschaft oder dem Amtsgericht kurz, dass mehrere Verfahren oder Aktenzeichen verwechselt worden sein könnten.");
  lines.push("2. Bitte um schriftliche Klärung, welches Aktenzeichen zu welcher Person gehört.");
  lines.push("3. Schreibe dazu, dass du nach deiner Darstellung Geschädigter bist und die Zuordnung deshalb geprüft werden soll.");
  lines.push("4. Bitte um Prüfung, ob die Zahlungsaufforderung wirklich richtig zugeordnet ist.");
  lines.push("5. Bitte darum, bis zur Klärung keine weiteren Maßnahmen einzuleiten.");
  lines.push("");
  if (ref || amount || sender) {
    const facts = [];
    if (sender) facts.push(`Stelle aus dem Schreiben: ${sender}`);
    if (amount) facts.push(`Betrag: ${amount}`);
    if (ref) facts.push(`Nummer/Aktenzeichen aus dem Schreiben: ${ref}`);
    lines.push(`Aus dem aktuellen Schreiben wichtig: ${facts.join(". ")}.`);
    lines.push("");
  }
  lines.push("Zahle nicht einfach blind, wenn du glaubst, dass Person, Verfahren oder Aktenzeichen falsch zugeordnet wurden. Lass dir zuerst schriftlich bestätigen, wer genau zahlen muss, warum und zu welchem Aktenzeichen.");
  lines.push("");
  lines.push("Wenn du möchtest, schreibe ich dir daraus eine neutrale E-Mail an die Staatsanwaltschaft oder das Amtsgericht.");
  return cleanText(lines.join("\n"));
}

function detectCoreIntent(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();
  const clean = normalizeString(frage).toLowerCase();
  if (/^(ok|okay|danke|alles klar|verstanden|passt|ja)$/i.test(clean)) return "smalltalk";

  // V12.3: Komplexe Verfahrens-/Aktenzeichen-Verwechslung zuerst erkennen.
  // Lange Nutzertexte mit neuen Informationen dürfen nicht auf Frist/Termin reduziert werden.
  if (hasComplexCaseIntent(frage, frageMode)) return "komplexer_verfahrensfall";

  // V12.2: Zielabsicht schlägt Statuswort.
  // „bezahlt“ allein = schon_bezahlt. Aber „bezahlt + Krankenkasse/Geld zurück/Erstattung“ = Erstattungsfrage.
  if (hasReimbursementIntent(frage, frageMode)) return "erstattung_kostenuebernahme";

  if (hasAny(q, ["welche behandlung", "was wurde gemacht", "was haben die gemacht", "wofür ist die rechnung", "wofuer ist die rechnung", "welche leistung", "leistungsaufstellung", "positionen", "goz", "bema"])) return "detailfrage";
  if (hasAny(q, ["schon bezahlt", "bereits bezahlt", "habe bezahlt", "überwiesen", "ueberwiesen", "zahlungsnachweis"])) return "schon_bezahlt";
  if (hasAny(q, ["schon geschickt", "bereits geschickt", "nachweis geschickt", "unterlagen geschickt", "bescheid geschickt", "befreiung geschickt", "habe das geschickt", "dahin geschickt"])) return "schon_geschickt";
  if (hasAny(q, ["jobcenter", "bürgergeld", "buergergeld", "sozialhilfe", "sozialamt", "grundsicherung", "arbeitslosengeld", "alg ii", "alg 2"])) return "sozialleistung";
  if (hasAny(q, ["kein geld", "kann nicht zahlen", "nicht bezahlen", "nicht zahlen", "nicht auf einmal", "zahlungsaufschub", "stundung"])) return "zahlungsproblem";
  if (hasAny(q, ["ratenzahlung", "rate", "raten", "monatlich zahlen", "in raten"])) return "ratenzahlung";
  if (hasAny(q, ["was passiert", "wenn ich nichts", "folge", "konsequenz"])) return "folgenfrage";
  if (hasAny(q, ["frist", "bis wann", "deadline", "termin"])) return "fristfrage";
  if (hasAny(q, ["was soll ich tun", "was muss ich tun", "was kann ich tun", "was jetzt", "nächster schritt", "naechster schritt", "wie weiter"])) return "handlungsfrage";
  if (hasAny(q, ["was bedeutet", "erklär", "erklaer", "verstehe nicht", "was heißt", "was heisst"])) return "verstaendnisfrage";
  if (hasAny(q, ["kündigen", "kuendigen", "kündigung", "kuendigung", "widerrufen", "widerruf", "widersprechen", "widerspruch", "einspruch"])) return "rechtshandlung";
  if (isExplicitWriteRequest(frage, frageMode)) return "schreibwunsch";
  return "";
}

function coreReferenceText(meta = {}) {
  const ref = getPrimaryReference(meta);
  return ref ? ` Nenne dabei diese Nummer: ${ref}.` : "";
}

function buildReimbursementAdvice(meta = {}) {
  const ref = getPrimaryReference(meta);
  const amount = getAmount(meta);
  const sender = getSender(meta);

  const lines = [];
  lines.push("Ja, du kannst versuchen, eine Erstattung oder Teil-Erstattung bei der Krankenkasse oder Versicherung zu bekommen.");
  lines.push("");
  lines.push("Sicher ist das aber nicht. Es hängt davon ab, welche Leistung gemacht wurde, ob sie medizinisch notwendig war und ob deine Krankenkasse oder Versicherung diese Kosten übernimmt.");
  lines.push("");
  lines.push("Was du jetzt tun solltest:");
  lines.push("1. Schick der Krankenkasse oder Versicherung die Rechnung.");
  lines.push("2. Schick den Zahlungsnachweis mit, weil du schon bezahlt hast.");
  if (ref) lines.push(`3. Nenne die Nummer aus dem Schreiben: ${ref}.`);
  else lines.push("3. Nenne Rechnungsnummer, Datum und Betrag aus dem Schreiben.");
  lines.push("4. Bitte um Prüfung, ob die Kosten ganz oder teilweise erstattet werden können.");
  lines.push("5. Wenn nicht genau sichtbar ist, welche Behandlung oder Leistung gemacht wurde, fordere beim Zahnarzt, Leistungserbringer oder bei der Abrechnungsstelle eine detaillierte Leistungsaufstellung an.");
  lines.push("");
  if (amount || sender) {
    const parts = [];
    if (amount) parts.push(`Betrag: ${amount}`);
    if (sender) parts.push(`Stelle aus dem Schreiben: ${sender}`);
    lines.push(`Aus dem aktuellen Schreiben wichtig: ${parts.join(". ")}.`);
    lines.push("");
  }
  lines.push("Wenn du möchtest, schreibe ich dir daraus eine E-Mail oder einen PDF-Brief an die Krankenkasse oder Versicherung.");
  return cleanText(lines.join("\n"));
}

function buildPaidAdvice(meta = {}) {
  return cleanText(`Dann zahl nicht nochmal.

Schick der Stelle aus dem Brief einen Zahlungsnachweis. Nenne dabei Betrag, Datum der Zahlung und die Rechnungsnummer oder das Aktenzeichen.${coreReferenceText(meta)}

Bitte die Stelle um Prüfung, ob die Zahlung richtig zugeordnet wurde. Bitte auch darum, weitere Mahnungen oder Maßnahmen bis zur Klärung zu stoppen.

Wenn du möchtest, schreibe ich dir daraus eine kurze E-Mail oder einen PDF-Brief.`);
}

function buildSentProofAdvice(meta = {}) {
  return cleanText(`Dann schick den Nachweis vorsorglich noch einmal.

Nenne die Nummer aus dem Schreiben und schreibe dazu, dass du die Unterlagen bereits gesendet hast.${coreReferenceText(meta)}

Bitte um Prüfung und schriftliche Bestätigung. Behalte einen Versandnachweis oder Screenshot.`);
}

function buildPaymentAdvice(meta = {}) {
  return cleanText(`Prüfe zuerst, ob die Forderung wirklich stimmt.

Wenn die Forderung korrekt ist, kannst du schriftlich um Ratenzahlung oder Stundung bitten. Schreibe vorsichtig, zum Beispiel: "Ohne Anerkennung einer Rechtspflicht bitte ich um Prüfung einer Ratenzahlung."

Nenne nur eine Rate, die du realistisch zahlen kannst. Bitte um schriftliche Bestätigung, bevor du dich darauf verlässt.

Wenn du möchtest, formuliere ich dir daraus eine E-Mail oder einen PDF-Brief.`);
}

function buildDetailAdvice(meta = {}, context = "") {
  const visible = [];
  if (meta.briefart) visible.push(meta.briefart);
  if (meta.betrag) visible.push(`Betrag: ${meta.betrag}`);
  if (getSender(meta)) visible.push(`Absender: ${getSender(meta)}`);
  const visibleLine = visible.length ? `Sicher sichtbar ist: ${visible.join(", ")}.` : "Sicher sichtbar ist nur, dass es um dieses Schreiben geht.";
  return cleanText(`Das kann ich aus dem sichtbaren Schreiben nicht sicher erkennen.

${visibleLine}

Welche genaue Leistung, Behandlung oder Position gemeint ist, steht auf dem sichtbaren Schreiben nicht sicher drin. Dafür brauchst du die detaillierte Rechnung oder Leistungsaufstellung.

Lade am besten die Seite hoch, auf der einzelne Positionen, Leistungsbeschreibung, GOZ-/BEMA-Nummern oder Behandlungsarten stehen.`);
}

function buildSocialAdvice(meta = {}) {
  return cleanText(`Das kann wichtig sein, aber es ist nicht automatisch sicher.

Wenn du Bürgergeld, Jobcenter-Leistungen oder eine andere Sozialleistung bekommst, kann ein Nachweis, eine Befreiung, eine Ermäßigung oder eine Kostenübernahme relevant sein.

Schick den Bescheid oder Nachweis erneut an die Stelle aus dem Brief. Nenne die Nummer aus dem Schreiben.${coreReferenceText(meta)}

Bitte um Prüfung und schriftliche Bestätigung. Wenn Mahnung, Sperre oder Vollstreckung droht, bitte darum, weitere Maßnahmen bis zur Klärung auszusetzen.`);
}

function buildDeadlineAdvice(meta = {}) {
  if (meta.frist || meta.termin) return `Frist/Termin: ${meta.frist || meta.termin}. Bitte prüfe das im Originalbrief und reagiere rechtzeitig.`;
  return "Ich sehe keine sichere Frist. Prüfe das Originalschreiben genau. Wenn die Frist nicht klar ist, frage die Stelle schriftlich nach und bitte um Bestätigung.";
}

function buildConsequenceAdvice(meta = {}) {
  if (meta.folge_wenn_nichts) return meta.folge_wenn_nichts;
  return "Das steht auf dem sichtbaren Schreiben nicht sicher. Wenn eine Frist, Zahlung, Mahnung oder ein Termin genannt ist, solltest du trotzdem rechtzeitig reagieren, damit keine Nachteile entstehen.";
}

function buildCoreNextSteps(meta = {}) {
  const steps = dedupe([...(meta.was_ist_zu_tun || []), meta.erster_sicherer_schritt, meta.naechster_schritt]).filter(Boolean).slice(0, 5);
  if (steps.length) return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return "1. Prüfe Absender, Name, Betrag, Frist und Nummer im Originalbrief.\n2. Kläre schriftlich, was unklar ist.\n3. Wenn eine Frist oder Zahlung verlangt wird, reagiere rechtzeitig.";
}

function buildUnderstandingAnswer(meta = {}) {
  return cleanText(`Kurz gesagt:
${meta.kurz_gesagt || meta.worum_geht_es || "Es geht um ein Schreiben, das du prüfen solltest."}

Wichtig ist vor allem:
${formatImportantDataLines(meta)}

Unklar bleibt:
${buildUnclearLines(meta)}`);
}

function buildForcedChatAnswer({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const context = buildContext(meta, briefText, kurz, details, frage, historyText);
  const domain = detectDomain(context);
  const outputChoice = isAnsweringOutputChoice(frage, historyText);
  const intent = outputChoice ? inferIntentFromHistory(historyText || context) : detectCoreIntent(frage, frageMode);
  const wantsPdf = outputChoice === "pdf" || (!outputChoice && wantsPdfOutput(frage, frageMode));
  const wantsEmail = outputChoice === "email" || (!outputChoice && wantsEmailOutput(frage, frageMode));
  const wantsBoth = outputChoice === "both" || (!outputChoice && wantsBothEmailAndPdf(frage, frageMode));
  const explicitWrite = isExplicitWriteRequest(frage, frageMode) || Boolean(outputChoice);

  if (intent === "smalltalk") return "Gerne. Schreib deine nächste Frage.";

  // Write Mode: nur bei ausdrücklichem Wunsch.
  // V14.3: Wenn die aktuelle Frage eine Erstattung/Kostenübernahme verlangt,
  // bleibt dieses Ziel auch im PDF-/E-Mail-Modus erhalten.
  const rememberedWriteIntent = inferIntentFromHistory(historyText || context);
  const costCarrierWriteNow = hasReimbursementIntent(frage, frageMode) || hasOfficialWriteToCostCarrierCue(frage);
  const effectiveWriteIntent = (intent === "erstattung_kostenuebernahme" || intent === "reimbursement" || costCarrierWriteNow)
    ? "reimbursement"
    : rememberedWriteIntent;

  if (wantsBoth) return buildEmailAndPdfOutput(meta, context, domain, effectiveWriteIntent);
  if (wantsPdf && !wantsEmail) return buildPdfOnlyOutput(meta, context, domain, effectiveWriteIntent);
  if (wantsEmail && !wantsPdf) return buildProfessionalOutput(meta, context, domain, effectiveWriteIntent);
  if (intent === "schreibwunsch" || (explicitWrite && !wantsPdf && !wantsEmail)) return askOutputChoice(effectiveWriteIntent);

  // V14: Normale Beratungsfragen NICHT mehr hart per Stichwort-Router beantworten.
  // Der alte Router hat bei komplexen Sätzen zu oft nur Einzelwörter erkannt
  // (z. B. Jobcenter, bezahlt, Frist) und dadurch die echte Nutzerabsicht verfehlt.
  // Ab hier übernimmt der Meta-Chat-Prompt die Antwort mit Ziel + Zielstelle + Kontext + Risiko.
  return "";
}

async function buildFinalPayloadFromInfo(info, lang, sourceMode = "text") {
  const langCode = getLanguageMeta(lang).code;
  const kurzDe = buildCoreShortDe(info);
  const detailsDe = buildCoreExplanationDe(info);
  const translatedSet = await translateBriefExplanationSetIfNeeded(kurzDe, detailsDe, langCode);
  const kurz = translatedSet.kurz;
  const details = translatedSet.details;
  const refs = safeReferences(info);
  const name = getDetectedPersonName(info);

  return {
    ok: true,
    quality_ok: true,
    hinweis: "",
    kurz,
    details,
    helper: {
      quality_mode: true,
      quality_type: detectDomain(buildContext(info)),
      briefart_label: labelForBrief(info),
      urgency_label: info.dringlichkeit === "hoch" ? "Hoch" : info.dringlichkeit === "mittel" ? "Mittel" : info.dringlichkeit === "niedrig" ? "Niedrig" : "Unklar",
      must_react_label: info.muss_handeln === "ja" ? "Ja" : info.muss_handeln === "nein" ? "Nein" : "Bitte prüfen",
      money_label: info.geld_betroffen === "ja" || info.betrag ? "Ja" : info.geld_betroffen === "nein" ? "Nein" : "Bitte prüfen",
      first_step: info.erster_sicherer_schritt || info.naechster_schritt || "Prüfe zuerst Absender, Betrag, Frist und Nummer im Originalbrief.",
      help_tip: "Frag zuerst, was du verstehen willst. E-Mail oder PDF erst, wenn du es wirklich brauchst.",
      next_steps: dedupe(info.was_ist_zu_tun).slice(0, 5),
      suggested_actions: ["Was bedeutet das?", "Was soll ich jetzt tun?", "Was ist unklar?"],
      unsafe_notice: (info.unsicherheiten || []).length ? "Einige Daten oder Details sind nicht sicher sichtbar. Die App erfindet sie nicht. Bitte Originalbrief prüfen." : "",
      data_rows: [
        { key: "sender", label: "Absender", value: getSender(info) || "Bitte prüfen", status: getSender(info) ? "safe" : "check" },
        { key: "person", label: "Name", value: name || "Bitte prüfen", status: name ? "safe" : "check" },
        { key: "amount", label: "Betrag", value: info.betrag || "Bitte prüfen", status: info.betrag ? "safe" : "check" },
        { key: "deadline", label: "Frist/Termin", value: info.frist || info.termin || "Bitte prüfen", status: (info.frist || info.termin) ? "safe" : "check" },
        { key: "reference", label: "Aktenzeichen/Nummer", value: refs.join(", ") || "Bitte prüfen", status: refs.length ? "safe" : "check" }
      ],
      whatsapp_summary: `${labelForBrief(info)}${getAmount(info) ? " – Betrag: " + getAmount(info) : ""}. ${info.naechster_schritt || "Bitte prüfen."}`,
      phone_script: ""
    },
    meta: {
      briefart: info.briefart,
      absender: getSender(info),
      absender_kurz: info.absender_kurz,
      absender_original: info.absender_original,
      email_adresse: info.email_adresse,
      absender_adresse: info.absender_adresse,
      empfaenger_adresse: info.empfaenger_adresse,
      person: name,
      person_sicher: Boolean(name),
      betroffene_person: info.betroffene_person,
      empfaenger: info.empfaenger,
      termin: info.termin,
      frist: info.frist,
      betrag: info.betrag,
      datum_schreiben: info.datum_schreiben,
      unterlagen: info.unterlagen,
      referenzen: refs,
      referenzen_erkannt_roh: info.referenzen,
      referenzen_sicher: refs.length > 0,
      dringlichkeit: info.dringlichkeit,
      pflicht_oder_freiwillig: info.pflicht_oder_freiwillig,
      naechster_schritt: info.naechster_schritt,
      antwort_sprache: info.antwort_sprache,
      passende_aktionen: info.passende_aktionen,
      unsicherheiten: info.unsicherheiten,
      worum_geht_es: info.worum_geht_es,
      wichtigste_punkte: info.wichtigste_punkte,
      was_ist_zu_tun: info.was_ist_zu_tun,
      folge_wenn_nichts: info.folge_wenn_nichts,
      versteckte_wichtige_info: info.versteckte_wichtige_info,
      sourceMode,
      must_react: info.muss_handeln === "ja" ? "yes" : info.muss_handeln === "nein" ? "no" : "maybe",
      money_affected: info.geld_betroffen === "ja" || info.betrag ? "yes" : info.geld_betroffen === "nein" ? "no" : "maybe",
      brief_schwierigkeit: info.brief_schwierigkeit,
      quality_type: detectDomain(buildContext(info)),
      risiko_kurz: info.risiko_kurz,
      erster_sicherer_schritt: info.erster_sicherer_schritt,
      daten_unsicher: info.daten_unsicher
    }
  };
}

async function buildFinalAnswerFromText(text, lang) {
  const info = await buildInfoFromText(text);
  return await buildFinalPayloadFromInfo(info, lang, "text");
}

async function buildFinalAnswerFromImages(bilder, lang) {
  if (!Array.isArray(bilder) || bilder.length === 0) return { ok: false, error: "Kein Bild gesendet" };
  if (bilder.length > 3) return { ok: false, error: "In der kostenlosen Version kannst du maximal 3 Bilder hochladen." };

  for (const bild of bilder) {
    if (!bild || typeof bild.imageData !== "string" || typeof bild.mimeType !== "string") return { ok: false, error: "Ein Bild ist ungültig." };
    if (bild.imageData.length > 23000000) return { ok: false, error: "Ein Bild ist zu groß. Bitte fotografiere die Seite klarer oder lade weniger Fotos hoch." };
  }

  const info = await buildInfoFromImages(bilder);
  return await buildFinalPayloadFromInfo(info, lang, "image");
}

app.post("/api/brief", async (req, res) => {
  try {
    const text = String(req.body.text || "");
    const lang = (req.body.lang || "de").toLowerCase();
    if (!text.trim()) return res.status(400).json({ ok: false, error: "Kein Text gesendet" });
    if (text.length > 14000) return res.status(400).json({ ok: false, error: "Der Text ist zu lang. Bitte kürze ihn oder lade nur die wichtigsten Seiten hoch." });
    const result = await buildFinalAnswerFromText(text, lang);
    return res.json(result);
  } catch (error) {
    console.error("Fehler /api/brief:", error);
    return res.status(500).json({ ok: false, error: error.message || "Serverfehler" });
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
    return res.status(500).json({ ok: false, error: error.message || "Serverfehler" });
  }
});

app.post("/api/daten-pruefen", async (req, res) => {
  try {
    const bilder = req.body.bilder || [];
    const lang = (req.body.lang || "de").toLowerCase();
    const langMeta = getLanguageMeta(lang);
    if (!Array.isArray(bilder) || bilder.length === 0) return res.status(400).json({ ok: false, error: "Keine Bilder gesendet" });
    if (bilder.length > 3) return res.status(400).json({ ok: false, error: "Maximal 3 Bilder möglich." });

    const parts = [{ text: `Du bist Hilfe24. Prüfe nur die kritischen Daten aus den Fotos: Empfänger, betroffene Person, Absender, Datum, Nummern, Betrag, Frist, Termin. Antworte kurz in ${langMeta.label}. Nichts erfinden. IBAN/BIC/Telefon nicht als Aktenzeichen bezeichnen.

${buildMultilingualRules(langMeta)}` }];
    let i = 1;
    for (const bild of bilder) {
      if (!bild || !bild.imageData || !bild.mimeType) continue;
      parts.push({ text: `\nFOTO ${i}: Daten prüfen.\n` });
      parts.push({ inline_data: { mime_type: bild.mimeType, data: bild.imageData } });
      i++;
    }
    const raw = await callGemini(parts);
    return res.json({ ok: true, text: cleanText(raw) });
  } catch (error) {
    console.error("Fehler /api/daten-pruefen:", error);
    return res.status(500).json({ ok: false, error: error.message || "Fehler bei der Datenprüfung" });
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
    const chatHistory = Array.isArray(req.body.chatHistory) ? req.body.chatHistory.slice(-10) : [];
    const chatHistoryText = chatHistory.map((e) => `${e && e.role === "user" ? "Nutzer" : "Hilfe24"}: ${cleanText(e && e.text ? e.text : "").slice(0, 1200)}`).join("\n");

    if (!frage) return res.status(400).json({ ok: false, error: "Keine Frage gesendet" });
    if (!briefText && !erklaerungKurz && !erklaerungDetails && !Object.keys(meta).length) return res.status(400).json({ ok: false, error: "Kein Kontext vorhanden" });
    if (frage.length > 1500) return res.status(400).json({ ok: false, error: "Die Frage ist zu lang. Bitte kürzer formulieren." });

    // V14: Nur Write-/Format-Router läuft vor Gemini.
    // Normale Chatfragen gehen in die Meta-Chat-Logik, damit nicht einzelne Stichwörter dominieren.
    const forcedAnswer = buildForcedChatAnswer({
      frage,
      frageMode,
      meta,
      briefText,
      kurz: erklaerungKurz,
      details: erklaerungDetails,
      historyText: chatHistoryText
    });

    if (forcedAnswer) {
      const localizedForcedAnswer = await localizeUserFacingAnswerIfNeeded(forcedAnswer, langMeta.code);
      return res.json({ ok: true, antwort: localizedForcedAnswer });
    }

    const raw = await callGemini([{ text: `
Du bist Hilfe24, ein einfacher Fall-Chat für schwierige Briefe.

Sprache des Nutzers: ${langMeta.label}
Heutiges Datum: ${getTodayGerman()}

${buildHilfe24CoreRules(langMeta.code)}

${buildMultilingualRules(langMeta)}

META-CHAT-LOGIK V14:
Du beantwortest NICHT einzelne Stichwörter. Du verstehst zuerst die echte Absicht.
Arbeite immer in dieser Reihenfolge:

1. Nutzerziel erkennen
   Frage dich: Was will der Nutzer wirklich erreichen?
   Beispiele: verstehen, zahlen, nicht zahlen, Geld zurückbekommen, Anwalt/Hilfe finden, Frist wissen, Verwechslung klären, Unterlagen nachreichen, Antwort schreiben lassen.

2. Zielstelle erkennen
   Frage dich: Wer ist für dieses Ziel zuständig?
   Beispiele: fordernde Stelle, Krankenkasse, Versicherung, Amtsgericht, Staatsanwaltschaft, Anwalt, Jobcenter, Zahnarzt/DZR, Arbeitgeber, Vermieter, Schule, Behörde.

3. Neue Nutzerinfo höher gewichten als den Brief
   Wenn der Nutzer neue Informationen nennt, musst du sie ernst nehmen.
   Beispiel: „Ich habe schon bezahlt“, „Ich war Geschädigter“, „Ich habe mit der Staatsanwaltschaft gesprochen“, „Franka bekommt Jobcenter“.
   Diese Info kann wichtiger sein als die Standarddaten aus dem Brief.

4. Rolle des Briefes bestimmen
   Der aktuelle Brief kann Hauptquelle, Hintergrund, Beweis, Auslöser oder unvollständig sein.
   Wiederhole den Brief nicht blind. Nutze ihn nur für sichere Daten: Betrag, Frist, Aktenzeichen, Absender, Person.

5. Risiko prüfen
   Wenn es rechtlich, medizinisch, finanziell oder verfahrensmäßig heikel ist, keine Garantie geben.
   Sag klar, was unsicher ist und was geprüft werden muss.

PRIORITÄT:
Nutzerziel > Zielstelle > neue Nutzerinfo > aktueller Brief > einzelne Stichwörter.

WICHTIGE BEISPIELE:
- „Ich habe bezahlt. Wie bekomme ich Geld von der Krankenkasse zurück?“
  Ziel = Erstattung. Zielstelle = Krankenkasse/Versicherung. „bezahlt“ ist nur Hintergrund.
  Antwort: Rechnung + Zahlungsnachweis + ggf. Leistungsaufstellung bei Krankenkasse einreichen. Erstattung nicht garantieren.

- „Woher bekomme ich einen Anwalt? Franka bekommt Jobcenter.“
  Ziel = Anwalt/rechtliche Hilfe finden. Zielstelle = Amtsgericht/Rechtsantragstelle oder Anwalt.
  „Jobcenter“ bedeutet hier: wenig Geld / Beratungshilfe prüfen. Nicht automatisch Befreiung/Nachweis an die Briefstelle.
  Antwort: Beratungshilfeschein beim Amtsgericht/Rechtsantragstelle prüfen, Jobcenter-Bescheid, Ausweis und Briefe/Aktenzeichen mitnehmen. Bei Strafsache Pflichtverteidiger prüfen lassen.

- „Mehrere Aktenzeichen, mehrere Personen, ich war Geschädigter, Staatsanwaltschaft/Amtsgericht kümmern sich.“
  Ziel = Verwechslung/Zuständigkeit klären. Zielstelle = Gericht/Staatsanwaltschaft.
  Antwort: schriftliche Klärung verlangen, welches Aktenzeichen zu welcher Person gehört, wer zahlen muss und warum. Nicht blind zahlen.

- „Ich habe schon bezahlt, warum kommt Mahnung?“
  Ziel = Zahlungszuordnung klären. Zielstelle = fordernde Stelle.
  Antwort: nicht nochmal zahlen, Zahlungsnachweis senden, Nummer nennen, Zuordnung prüfen lassen, Mahnungen stoppen lassen.

- „Welche Behandlung war das?“
  Ziel = Detail verstehen. Wenn es nicht sichtbar ist, sage klar: Das steht im sichtbaren Schreiben nicht. Detaillierte Rechnung/Leistungsaufstellung anfordern.

- „Ich kann nicht zahlen.“
  Ziel = Zahlungsproblem lösen. Forderung zuerst prüfen. Wenn plausibel: Ratenzahlung/Stundung vorsichtig anfragen, keine Schuld blind anerkennen.

- „Schreib mir eine Antwort / E-Mail / PDF.“
  Ziel = Text erstellen. Nur dann E-Mail/PDF-Modus. Wenn Format unklar: E-Mail, PDF-Brief oder beides fragen.

LANGE NUTZERFRAGEN:
Wenn der Nutzer lang schreibt, fasse zuerst in einem kurzen Satz zusammen, was du verstanden hast.
Dann gib konkrete Hilfe. Greife nicht nur ein einzelnes Wort heraus.

ANTWORTSTIL:
- Erste Zeile: direkte Antwort auf die echte Frage.
- Danach 1 bis 3 kurze Sätze Einordnung.
- Dann maximal 3 bis 5 konkrete Schritte.
- Danach optional: „Wenn du möchtest, schreibe ich dir daraus eine E-Mail oder einen PDF-Brief.“
- Keine langen Romane.
- Kein falsches Selbstbewusstsein.

HARTE VERBOTE:
- Keine erfundene Frist.
- Keine erfundene Behandlung.
- Keine erfundene Diagnose.
- Kein sicherer Anspruch, wenn es nur geprüft werden kann.
- Keine rechtliche Entscheidung ersetzen.
- Keine alte Briefe oder alte Namen vermischen.
- Keine falsche Zielstelle.
- P-Konto nur erwähnen, wenn wirklich P-Konto/Kontopfändung/Freibetrag im aktuellen Kontext steht.
- Firma/Absender niemals als Unterschrift verwenden.
- IBAN/BIC/Telefon/Adresse niemals als Aktenzeichen verwenden.
- Bei offiziellen Antworten an deutsche Stellen: Deutsch verwenden.

WENN ZU KOMPLEX:
Wenn mehrere Verfahren, Personen, Aktenzeichen, Strafsachen oder widersprüchliche Angaben vorkommen, gib keine endgültige Entscheidung.
Sage: „Das ist zu komplex für eine sichere App-Antwort. Lass dir das schriftlich von der zuständigen Stelle oder von einem Anwalt/Beratungsstelle prüfen.“
Gib trotzdem einen sicheren nächsten Schritt.

ERKANNTE DATEN:
${JSON.stringify(meta, null, 2)}

KURZERKLÄRUNG:
${erklaerungKurz}

DETAILS:
${erklaerungDetails}

ORIGINALTEXT:
${briefText.slice(0, 10000)}

BISHERIGER CHAT:
${chatHistoryText || "Noch kein Chat."}

FRAGE:
${frage}
` }]);

    return res.json({ ok: true, antwort: cleanText(raw) });
  } catch (error) {
    console.error("Fehler /api/frage:", error);
    return res.json({ ok: true, fallback: true, antwort: "Ich konnte die Frage gerade nicht sicher beantworten. Bitte prüfe die Daten im Brief und versuche es noch einmal." });
  }
});


function pdfEscapeText(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/€/g, "EUR");
}

function wrapPdfLine(line = "", maxLen = 88) {
  const words = String(line || "").split(/\s+/).filter(Boolean);
  const out = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxLen) {
      if (current) out.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

function buildSimplePdfBuffer(text = "") {
  const clean = cleanText(text).slice(0, 10000);
  const rawLines = clean.split("\n");
  const lines = [];
  for (const line of rawLines) {
    if (!line.trim()) {
      lines.push("");
      continue;
    }
    lines.push(...wrapPdfLine(line, 88));
  }

  const pages = [];
  const linesPerPage = 46;
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (!pages.length) pages.push([""]);

  const objects = [];
  function addObject(content) {
    objects.push(content);
    return objects.length;
  }

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("PAGES_PLACEHOLDER");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds = [];

  for (const pageLines of pages) {
    let stream = "BT\n/F1 11 Tf\n50 790 Td\n14 TL\n";
    for (const line of pageLines) {
      stream += `(${pdfEscapeText(line)}) Tj\nT*\n`;
    }
    stream += "ET";
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, idx) => {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

app.post("/api/pdf", async (req, res) => {
  try {
    const text = cleanText(req.body.text || req.body.briefText || "");
    if (!text) return res.status(400).json({ ok: false, error: "Kein PDF-Text gesendet" });
    if (text.length > 10000) return res.status(400).json({ ok: false, error: "Der PDF-Text ist zu lang." });

    const filenameRaw = normalizeString(req.body.filename || `hilfe24-brief-${new Date().toISOString().slice(0, 10)}.pdf`);
    const filename = filenameRaw.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "hilfe24-brief.pdf";
    const pdf = buildSimplePdfBuffer(text);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename.endsWith(".pdf") ? filename : filename + ".pdf"}"`);
    res.setHeader("Content-Length", pdf.length);
    return res.send(pdf);
  } catch (error) {
    console.error("Fehler /api/pdf:", error);
    return res.status(500).json({ ok: false, error: error.message || "PDF konnte nicht erstellt werden" });
  }
});

function looksGermanHeavyForAudio(text, lang) {
  const code = getLanguageMeta(lang).code;
  if (code === "de") return false;
  const lower = String(text || "").toLowerCase();
  const markers = ["der brief", "frist", "betrag", "forderung", "widerspruch", "rechnung", "jobcenter", "prüfe", "muss", "unterlagen"];
  return markers.filter((m) => lower.includes(m)).length >= 2;
}

async function translateAudioTextIfNeeded(text, lang) {
  const langMeta = getLanguageMeta(lang);
  const clean = cleanText(text);
  if (!clean || langMeta.code === "de") return clean;
  if (!looksGermanHeavyForAudio(clean, langMeta.code)) return clean;
  const raw = await callGemini([{ text: `Übersetze diesen Vorlesetext vollständig in ${langMeta.label}. Keine neuen Informationen. Beträge, Daten, Namen und Nummern exakt erhalten.\n\nTEXT:\n${clean.slice(0, 2500)}` }]);
  return cleanText(raw);
}

async function synthesizeMp3(text, lang) {
  const langMeta = getLanguageMeta(lang);
  const request = {
    input: { text },
    voice: { languageCode: langMeta.ttsLanguageCode, ssmlGender: langMeta.ttsGender },
    audioConfig: { audioEncoding: "MP3", speakingRate: 0.92, pitch: 0 }
  };
  const [response] = await ttsClient.synthesizeSpeech(request);
  if (!response.audioContent) throw new Error("Keine TTS-Audioantwort erhalten");
  return Buffer.isBuffer(response.audioContent) ? response.audioContent.toString("base64") : Buffer.from(response.audioContent, "binary").toString("base64");
}

app.post("/api/tts", async (req, res) => {
  try {
    const text = cleanText(req.body.text || "");
    const lang = (req.body.lang || "de").toLowerCase();
    if (!text) return res.status(400).json({ ok: false, error: "Kein Text für Audio gesendet" });
    if (text.length > 3000) return res.status(400).json({ ok: false, error: "Der Text ist zu lang zum Vorlesen. Bitte lies nur den wichtigsten Teil vor." });
    const audioText = await translateAudioTextIfNeeded(text, lang);
    const audioBase64 = await synthesizeMp3(audioText, lang);
    return res.json({ ok: true, mimeType: "audio/mpeg", audioBase64, debugAudioText: audioText });
  } catch (error) {
    console.error("Fehler /api/tts:", error);
    return res.status(500).json({ ok: false, error: error.message || "TTS-Fehler" });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT + " | Hilfe24 v14 multilingual logic");
});
