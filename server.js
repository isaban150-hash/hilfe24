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
app.use((err, req, res, next) => {
  if (!err) return next();
  if (req && req.path === "/api/brief-bild" && (err.type === "request.aborted" || /aborted/i.test(String(err.message || "")))) {
    console.error("Upload abgebrochen /api/brief-bild", err);
    return res.status(408).json({ ok: false, error: "Upload wurde abgebrochen. Bitte versuche es erneut." });
  }
  return next(err);
});
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server läuft sauber", version: "v16.1-case-routing-answer-types-template-guard-checked" });
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

function addressLooksLikeCompanyOrSender(address = "", sender = "") {
  const a = normalizeString(address).toLowerCase();
  const s = normalizeString(sender).toLowerCase();
  if (!a) return false;
  if (/(gmbh|ag|ug|kg|inkasso|bank|versicherung|jobcenter|amtsgericht|staatsanwaltschaft|finanzamt|beitragsservice|postfach)/i.test(a)) return true;
  if (s) {
    const senderTokens = s.split(/\s+/).filter(x => x.length >= 3 && !/^(der|die|das|und|für|fuer)$/i.test(x));
    if (senderTokens.some(tok => a.includes(tok))) return true;
  }
  return false;
}

function addressLooksLikePersonAddress(address = "", personName = "", sender = "") {
  const a = normalizeString(address);
  if (!a || !looksLikeAddress(a)) return false;
  const p = normalizeString(personName).toLowerCase();
  const lower = a.toLowerCase();
  if (p && lower.includes(p)) return true;
  if (addressLooksLikeCompanyOrSender(a, sender)) return false;
  return /\d{5}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+/.test(a) && /(str\.?|straße|strasse|weg|platz|allee|gasse|ring|damm|ufer)/i.test(a);
}

function getUserPostalAddress(meta = {}, context = "") {
  const name = getSafeSignatureName(meta, context);
  const sender = getSender(meta);

  // V14.6: Für PDF-Absender zuerst Adresse direkt bei der betroffenen Person suchen.
  // Absender-/Firmenadressen aus dem Brief dürfen nicht in den Absenderblock des Nutzers rutschen.
  if (name && name !== "[Name]") {
    const fromContext = findAddressBlockAfterLine(context, name);
    if (addressLooksLikePersonAddress(fromContext, name, sender)) return formatAddressBlockWithName(name, fromContext);
  }

  const candidates = [meta.user_adresse, meta.adresse, meta.empfaenger_adresse, meta.absender_adresse]
    .map(x => normalizePostalAddress(x))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (addressLooksLikePersonAddress(candidate, name, sender)) return formatAddressBlockWithName(name, candidate);
  }

  return formatAddressBlockWithName(name && name !== "[Name]" ? name : "", "");
}

function getRecipientPostalAddress(meta = {}, context = "") {
  const sender = getSender(meta);
  const personName = getSafeSignatureName(meta, context);

  const candidates = [meta.empfaenger_adresse, meta.absender_adresse_empfaenger, meta.postanschrift, meta.absender_adresse]
    .map(x => normalizePostalAddress(x))
    .filter(Boolean);

  // V14.6: Empfängeradresse darf nicht die Privatadresse der betroffenen Person sein.
  for (const candidate of candidates) {
    const lower = normalizeString(candidate).toLowerCase();
    const personLower = normalizeString(personName).toLowerCase();
    if (personLower && lower.includes(personLower)) continue;
    if (addressLooksLikeCompanyOrSender(candidate, sender) || !addressLooksLikePersonAddress(candidate, personName, sender)) {
      return formatRecipientAddressBlock(sender, candidate);
    }
  }

  if (sender) {
    const fromContext = findAddressBlockAfterLine(context, sender);
    if (fromContext && !addressLooksLikePersonAddress(fromContext, personName, sender)) return formatRecipientAddressBlock(sender, fromContext);
  }

  const any = findAnyPostalBlock(context);
  if (any && !addressLooksLikePersonAddress(any, personName, sender)) return formatRecipientAddressBlock(sender, any);

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

// V15.0.1 Fix: Helper wurde in buildFinalPayloadFromInfo/buildFallbackPayloadFromInfo genutzt,
// war aber nicht definiert. Ohne diese Funktion bricht /api/erkennen mit
// "labelForBrief is not defined" ab.
function labelForBrief(meta = {}) {
  const raw = normalizeString(meta.briefart || meta.briefart_label || meta.art || "");
  const ctx = buildContext(meta);
  const domain = detectDomain(ctx);

  if (raw && !/^(unklar|nicht erkennbar|unknown)$/i.test(raw)) return raw;

  const labels = {
    jobcenter: "Jobcenter / Behörde",
    court: "Gericht / Ladung",
    staatsanwaltschaft: "Staatsanwaltschaft / Justiz",
    inkasso: "Inkasso / Forderung",
    beitragsservice: "Rundfunkbeitrag / Beitragsservice",
    finanzamt: "Finanzamt / Steuer",
    krankenkasse: "Krankenkasse / Gesundheit",
    pflegekasse: "Pflegekasse / Pflege",
    rentenversicherung: "Rentenversicherung",
    vertrag: "Vertrag / Versicherung / Abo",
    versicherung: "Versicherung / Vertrag",
    arbeitgeber: "Arbeitgeber / Arbeit",
    vermieter: "Vermieter / Wohnen"
  };

  return labels[domain] || "Schreiben / Brief";
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
  const subject = buildSubject(meta, domain, bodyIntent === "cancel" ? "cancel" : bodyIntent, context);
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



/* ==========================================================
   HILFE24 V15.0 - ASSISTENTEN-ANALYSE + TEMPLATE-GUARD
   Ziel: erst analysieren, dann antworten/schreiben.
   Index bleibt Anzeige-Schicht. Server entscheidet Fachlogik.
   ========================================================== */

function normalizeForIntent(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function detectUserLanguageFromQuestion(frage = "", fallback = "de") {
  const raw = String(frage || "").toLowerCase();
  const q = normalizeForIntent(raw);
  if (/(\bben\b|bana|sana|nasıl|nasil|yapayim|yapayım|anlat|avukat|yardim|yardım|dilekce|dilekçe|mektup|sigorta|taksit|gonder|gönder|hazirla|hazırla|odeme|ödeme)/i.test(q)) return "tr";
  if (/[а-яё]/i.test(raw)) return "bg";
  if (/(what|how|why|please|letter|lawyer|insurance|refund|help)/i.test(raw)) return "en";
  if (/(avocat|asigurare|scrisoare|ajutor|rambursare|plată|plata)/i.test(raw)) return "ro";
  return fallback || "de";
}

function safeSignatureForDraft(meta = {}, context = "") {
  const raw = getSafeSignatureName(meta, context);
  const clean = normalizeString(raw)
    .replace(/['’´`]?(nin|nın|nun|nün|in|ın|un|ün)$/i, "")
    .replace(/['’´`]s$/i, "")
    .replace(/\b(forderung|versicherung|portal|patientenportal|webseite|rechnung|aktenzeichen)\b/gi, "")
    .trim();
  return looksLikePersonName(clean) ? clean : (looksLikePersonName(raw) ? raw : "[Name bitte prüfen/eintragen]");
}

function hasLegalAidCue(text = "") {
  const q = normalizeForIntent(text);
  return /(anwalt|rechtsanwalt|verteidiger|pflichtverteidiger|beratungshilfe|prozesskostenhilfe|verfahrenskostenhilfe|rechtsantragstelle|avukat|avukati|avukata|avukat tut|para odemeden avukat|hukuki yardim|hukuk yardimi|legal aid|lawyer)/i.test(q);
}

function hasCourtCriminalCue(text = "") {
  const q = normalizeForIntent(text);
  return /(gericht|amtsgericht|landgericht|staatsanwaltschaft|polizei|anklage|angeklagt|straf|strafverfahren|strafbefehl|hauptverhandlung|ladung|umladung|termin|haftbefehl|pflichtverteidiger|gefahrliche korperverletzung|körperverletzung|mahkeme|savcilik|savcılık|ceza davasi|dava|duruşma|durusma|police|court|prosecutor)/i.test(q);
}

function hasGuidanceCue(text = "") {
  const q = normalizeForIntent(text);
  return /(schritt fur schritt|schrittweise|leitfaden|checkliste|was brauche ich|was muss ich mitnehmen|was soll ich jetzt machen|was soll ich tun|wie mache ich|wie bekomme ich|tek tek|tek tek anlat|nasil yapayim|nasıl yapayım|bana yol goster|yol göster|ne yapmam gerekiyor|kontrol listesi|abhaken|plan|guide|checklist)/i.test(q);
}

function hasBenefitCue(text = "") {
  const q = normalizeForIntent(text);
  return /(pflegegrad|pflegekasse|pflegeversicherung|pflegegeld|entlastungsbetrag|krankenkasse|rentenversicherung|rentenkasse|erwerbsminderung|reha|schwerbehindert|gdb|versorgungsamt|jobcenter|burgergeld|buergergeld|sozialamt|wohngeld|familienkasse|kinderzuschlag|unterhaltsvorschuss|bildung und teilhabe|but|rundfunkbefreiung|p-konto|pfandung|pfändung|was kann ich bekommen|steht mir zu)/i.test(q);
}

function hasInsuranceContractCue(text = "") {
  const q = normalizeForIntent(text);
  return /(finanz-schutzbrief|finanzschutzbrief|versicherungsschein|versicherungsscheinnummer|versicherungsbeginn|versicherungsende|versicherungsablauf|sepa-lastschrift|kredit|kreditanfrage|kredit nicht|kredi|kredi cek|kredi olmad|sigorta cik|sigorta çık|abschließen|abgeschlossen|vertrag|widerruf|kundigen|kündigen|kuendigen|abo|lastschrift)/i.test(q)
    && /(versicherung|sigorta|schutzbrief|vertrag|kredit|kredi)/i.test(q);
}

function detectCaseTypeV15(context = "") {
  const q = normalizeForIntent(context);
  if (hasCourtCriminalCue(q)) return "court_legal_aid";
  if (hasInsuranceContractCue(q)) return "insurance_contract";
  if (/(dzr|zahnarzt|zahn|rechnung|rg-nummer|goz|bema|behandlung|patient)/i.test(q)) return "invoice_medical";
  if (/(inkasso|mahnung|forderung|gerichtsvollzieher|vollstreckung)/i.test(q)) return "debt_collection";
  if (/(jobcenter|burgergeld|buergergeld|sozialamt|rückforderung|rueckforderung|bescheid|widerspruch|aufrechnung)/i.test(q)) return "authority_social";
  if (/(pflegegrad|pflegekasse|pflegeversicherung|md gutachten|medizinischer dienst)/i.test(q)) return "care_insurance";
  if (/(rentenversicherung|rentenkasse|erwerbsminderung|reha|teilhabe am arbeitsleben|kontenklärung|kontenklaerung)/i.test(q)) return "pension_insurance";
  if (/(schwerbehindert|gdb|merkzeichen|versorgungsamt|behindertenausweis)/i.test(q)) return "disability";
  if (/(arbeitgeber|arbeitnehmer|lohn|gehalt|abmahnung|kündigung|kuendigung|arbeitszeugnis|schuldanerkenntnis|lohnabtretung)/i.test(q)) return "employment";
  if (/(vermieter|miete|nebenkosten|kaution|räumung|raeumung|wohnung)/i.test(q)) return "housing";
  if (/(finanzamt|steuer|einkommensteuer|säumniszuschlag|saeumniszuschlag)/i.test(q)) return "tax";
  if (/(rundfunkbeitrag|beitragsservice|beitragskonto)/i.test(q)) return "broadcast_fee";
  if (/(familienkasse|kindergeld|kinderzuschlag|jugendamt|unterhaltsvorschuss|schule|kita|klassenfahrt|bildung und teilhabe)/i.test(q)) return "family_school";
  if (/(krankenkasse|hilfsmittel|zuzahlungsbefreiung|krankengeld|haushaltshilfe|fahrtkosten|rezept|verordnung)/i.test(q)) return "health_insurance";
  return detectDomain(context) || "allgemein";
}

function detectCurrentUserGoalV15(frage = "", context = "") {
  const q = normalizeForIntent(`${frage} ${context}`);
  if (hasLegalAidCue(q)) return "legal_aid";
  if (hasGuidanceCue(frage)) return "guidance";
  if (hasInsuranceContractCue(`${frage} ${context}`) && /(widerruf|kundig|kündig|kuendig|iptal|fesih|nicht gewollt|nicht bewusst|kredi|kredit|vertrag prüfen|vertrag pruefen)/i.test(q)) return "contract_check_cancel";
  if (hasReimbursementIntent(frage, "")) return "reimbursement";
  if (/(ratenzahlung|rate|raten|taksit|taksitli|stundung|zahlungsaufschub)/i.test(q)) return "payment_plan";
  if (/(schon bezahlt|bereits bezahlt|habe bezahlt|überwiesen|ueberwiesen|dekont|zahlungsnachweis)/i.test(q)) return "paid_proof";
  if (/(widerspruch|einspruch|bestreiten|stimmt nicht|itiraz|ablehnung|abgelehnt)/i.test(q)) return "appeal_dispute";
  if (hasBenefitCue(q)) return "benefit_check";
  if (/(welche behandlung|was wurde gemacht|wofur ist die rechnung|wofür ist die rechnung|leistungsaufstellung|goz|bema)/i.test(q)) return "details_needed";
  if (/(frist|bis wann|termin|deadline)/i.test(q)) return "deadline";
  if (/(was bedeutet|erklär|erklar|anlam|ne demek)/i.test(q)) return "understand";
  if (/(was soll ich|was muss ich|was kann ich|ne yapmam|nasil|nasıl|wie weiter)/i.test(q)) return "guidance";
  return "answer_question";
}

function detectRequestedFormatV15(frage = "", frageMode = "") {
  if (wantsBothEmailAndPdf(frage, frageMode)) return "both";
  if (wantsPdfOutput(frage, frageMode)) return "pdf";
  if (wantsEmailOutput(frage, frageMode)) return "email";
  return "none";
}

function buildTemplateRulesV15(caseType = "", userGoal = "") {
  const rules = {
    allowedTemplates: ["general_answer"],
    forbiddenTemplates: [],
    riskLevel: "low",
    riskReasons: []
  };
  if (caseType === "court_legal_aid") {
    rules.riskLevel = "high";
    rules.riskReasons.push("Gericht/Strafsache/Anwalt möglich");
    rules.allowedTemplates = ["legal_aid_checklist", "legal_aid_request", "public_defender_request", "court_clarification", "appointment_notice"];
    rules.forbiddenTemplates = ["krankenkasse_reimbursement", "dzr_installments", "dental_detail_request", "insurance_reimbursement", "generic_invoice_refund"];
  } else if (caseType === "insurance_contract") {
    rules.riskLevel = "medium";
    rules.riskReasons.push("Vertrag/Widerruf/Kündigung möglich");
    rules.allowedTemplates = ["contract_check_cancel", "withdrawal", "termination", "contract_proof_request", "stop_debit_request"];
    rules.forbiddenTemplates = ["krankenkasse_reimbursement", "dzr_installments", "dental_detail_request"];
  } else if (caseType === "invoice_medical") {
    rules.allowedTemplates = ["reimbursement", "paid_proof", "installments", "detail_request", "general_answer"];
    rules.forbiddenTemplates = ["legal_aid_request", "public_defender_request"];
  } else if (caseType === "debt_collection") {
    rules.riskLevel = "medium";
    rules.allowedTemplates = ["debt_check", "installments", "paid_proof", "dispute"];
    rules.forbiddenTemplates = ["krankenkasse_reimbursement", "legal_aid_request"];
  } else if (["tax", "employment", "housing"].includes(caseType)) {
    rules.riskLevel = "medium";
    rules.riskReasons.push("Frist/Geld/Vertrag möglich");
  }
  return rules;
}

function buildHilfe24AnalysisV15({ frage = "", frageMode = "", meta = {}, briefText = "", kurz = "", details = "", historyText = "" }) {
  const context = buildContext(meta, briefText, kurz, details, frage, historyText);
  const currentOnly = String(frage || "");
  const caseType = detectCaseTypeV15(`${context}`);
  const currentUserGoal = detectCurrentUserGoalV15(currentOnly, context);
  const requestedFormat = detectRequestedFormatV15(frage, frageMode);
  const isWriteRequest = isExplicitWriteRequest(frage, frageMode) || requestedFormat !== "none";
  const wantsChecklist = hasGuidanceCue(currentOnly) || /(checkliste|leitfaden|abhaken|kontrol listesi)/i.test(normalizeForIntent(currentOnly));
  const wantsStepByStep = hasGuidanceCue(currentOnly);
  const wantsGuidance = wantsChecklist || wantsStepByStep || currentUserGoal === "guidance" || (caseType === "court_legal_aid" && hasLegalAidCue(currentOnly));
  const templateRules = buildTemplateRulesV15(caseType, currentUserGoal);
  let targetParty = getSender(meta) || "Stelle aus dem Schreiben";
  let officialDraftLanguage = "Deutsch";
  let shouldOnlyAnswer = !isWriteRequest;
  let shouldCreateDraft = isWriteRequest && requestedFormat !== "none";
  let shouldAskClarification = false;
  let clarificationQuestion = "";

  if (caseType === "court_legal_aid") {
    targetParty = "Amtsgericht / Rechtsantragstelle";
    if (wantsGuidance && !/^(pdf|brief|e-?mail|email|mail)$/i.test(normalizeString(frage))) {
      shouldOnlyAnswer = false;
      shouldCreateDraft = false;
    }
  } else if (caseType === "insurance_contract") {
    targetParty = getSender(meta) || "Versicherung / Vertragspartner";
  } else if (currentUserGoal === "reimbursement") {
    targetParty = "Krankenkasse / Versicherung / Kostenträger";
  } else if (currentUserGoal === "payment_plan" || currentUserGoal === "paid_proof") {
    targetParty = getSender(meta) || "Gläubiger / Rechnungssteller";
  }

  if (isWriteRequest && requestedFormat === "none") {
    shouldAskClarification = true;
    clarificationQuestion = "Möchtest du eine E-Mail, einen PDF-Brief oder beides?";
    shouldCreateDraft = false;
  }

  const allowedTemplates = templateRules.allowedTemplates;
  const forbiddenTemplates = templateRules.forbiddenTemplates;

  return {
    caseType,
    currentUserGoal,
    currentUserIntent: isWriteRequest ? "write_or_prepare" : (wantsGuidance ? "guidance" : "answer"),
    isWriteRequest,
    wantsChecklist,
    wantsStepByStep,
    wantsGuidance,
    requestedFormat,
    shouldOnlyAnswer,
    shouldCreateDraft,
    shouldAskClarification,
    clarificationQuestion,
    userLanguage: detectUserLanguageFromQuestion(frage, "de"),
    officialDraftLanguage,
    sourceParty: getSender(meta) || "",
    demandingParty: getSender(meta) || "",
    targetParty,
    costCarrierParty: currentUserGoal === "reimbursement" ? "Krankenkasse / Versicherung / Kostenträger" : "",
    contractParty: caseType === "insurance_contract" ? (getSender(meta) || "Versicherung / Vertragspartner") : "",
    legalAidParty: caseType === "court_legal_aid" ? "Amtsgericht / Rechtsantragstelle" : "",
    benefitParty: currentUserGoal === "benefit_check" ? "zuständige Leistungsstelle" : "",
    rightsCategory: [caseType, currentUserGoal].filter(Boolean),
    possibleRights: inferPossibleRightsV15(caseType, currentUserGoal),
    possibleBenefits: inferPossibleBenefitsV15(caseType, currentUserGoal),
    requiredDocuments: inferRequiredDocumentsV15(caseType, currentUserGoal, meta),
    deadline: meta.frist || meta.termin || "",
    appointment: Boolean(meta.termin || /termin|duruşma|durusma|hauptverhandlung|ladung/i.test(normalizeForIntent(context))),
    riskLevel: templateRules.riskLevel,
    riskReasons: templateRules.riskReasons,
    forbiddenTemplates,
    allowedTemplates,
    protectedSignatureName: safeSignatureForDraft(meta, context),
    protectedIdentifiers: [getPrimaryReference(meta)].filter(Boolean),
    needsKnowledgeLookup: hasBenefitCue(`${frage} ${context}`) || hasLegalAidCue(`${frage} ${context}`),
    knowledgeCategory: [caseType, currentUserGoal].filter(Boolean)
  };
}

function inferPossibleRightsV15(caseType = "", goal = "") {
  if (caseType === "court_legal_aid") return ["Beratungshilfe prüfen", "Pflichtverteidiger prüfen", "Frist/Termin beachten", "schriftliche Klärung verlangen"];
  if (caseType === "insurance_contract") return ["Widerruf prüfen", "hilfsweise Kündigung", "Vertragsschluss-Nachweis verlangen", "Lastschrift/Abbuchung prüfen"];
  if (caseType === "debt_collection") return ["Forderung prüfen", "Forderungsaufstellung verlangen", "Nachweise verlangen", "Ratenzahlung/Stundung prüfen"];
  if (caseType === "authority_social") return ["Widerspruch prüfen", "Unterlagen nachreichen", "Akteneinsicht/Begründung verlangen", "Frist beachten"];
  if (caseType === "care_insurance") return ["Pflegegrad beantragen oder Höherstufung prüfen", "Widerspruch gegen Bescheid prüfen", "MD-Gutachten prüfen"];
  if (caseType === "pension_insurance") return ["Reha prüfen", "Erwerbsminderungsrente prüfen", "Widerspruch gegen Bescheid prüfen"];
  if (caseType === "disability") return ["Schwerbehindertenausweis/GdB prüfen", "Merkzeichen/Nachteilsausgleiche prüfen", "Widerspruch prüfen"];
  if (goal === "reimbursement") return ["Kostenübernahme/Erstattung prüfen lassen"];
  return [];
}

function inferPossibleBenefitsV15(caseType = "", goal = "") {
  if (caseType === "court_legal_aid") return ["Beratungshilfe", "Prozesskostenhilfe/Verfahrenskostenhilfe je nach Verfahren", "Pflichtverteidiger nur bei bestimmten Strafsachen"];
  if (caseType === "care_insurance") return ["Pflegegeld", "Pflegesachleistungen", "Entlastungsbetrag", "Pflegehilfsmittel", "Wohnraumanpassung"];
  if (caseType === "health_insurance") return ["Kostenübernahme", "Hilfsmittel", "Zuzahlungsbefreiung", "Krankengeld", "Fahrtkosten"];
  if (caseType === "pension_insurance") return ["Reha", "Teilhabe am Arbeitsleben", "Erwerbsminderungsrente"];
  if (caseType === "disability") return ["Nachteilsausgleiche", "Merkzeichen", "Steuer-/Mobilitätsvorteile je nach Fall"];
  if (caseType === "family_school") return ["Bildung und Teilhabe", "Kinderzuschlag", "Unterhaltsvorschuss", "Kita-Ermäßigung"];
  if (goal === "benefit_check") return ["mögliche staatliche Hilfe oder Befreiung prüfen lassen"];
  return [];
}

function inferRequiredDocumentsV15(caseType = "", goal = "", meta = {}) {
  const ref = getPrimaryReference(meta);
  const common = [];
  if (ref) common.push(`Nummer/Aktenzeichen: ${ref}`);
  if (caseType === "court_legal_aid") return dedupe(["Gerichtsschreiben", ref ? `Aktenzeichen: ${ref}` : "Aktenzeichen", "aktueller Bürgergeld-/Jobcenter-Bescheid", "Personalausweis oder Reisepass", "falls vorhanden: Einkommens- und Ausgabennachweise"]);
  if (caseType === "insurance_contract") return dedupe(["Vertrag/Versicherungsschein", "Schreiben der Versicherung", "Nachweis zur Kreditanfrage", "Kontoauszug bei Abbuchung", ...common]);
  if (goal === "reimbursement") return dedupe(["Rechnung", "Zahlungsnachweis", "Leistungsaufstellung", "Versicherungs-/Krankenkassendaten", ...common]);
  if (caseType === "care_insurance") return ["Pflegegrad-Bescheid", "MD-Gutachten", "Arztberichte", "Medikamentenplan", "Pflegedokumentation"];
  if (caseType === "pension_insurance") return ["Rentenversicherungs-Schreiben", "Arztberichte", "Arbeitsunfähigkeitszeiten", "Reha-Unterlagen", "Versicherungsverlauf"];
  return common;
}

function templateAllowedV15(analysis = {}, templateName = "") {
  if (!templateName) return true;
  if (Array.isArray(analysis.forbiddenTemplates) && analysis.forbiddenTemplates.includes(templateName)) return false;
  if (Array.isArray(analysis.allowedTemplates) && analysis.allowedTemplates.length && !analysis.allowedTemplates.includes(templateName) && !analysis.allowedTemplates.includes("general_answer")) return false;
  return true;
}

function getLegalAidRecipientAddress(meta = {}, context = "") {
  const c = String(context || "");
  if (/amtsgericht\s+lemgo/i.test(c)) return "Amtsgericht Lemgo\nRechtsantragstelle\nAm Lindenhaus 2\n32657 Lemgo";
  const recipient = getRecipientPostalAddress(meta, context);
  if (/amtsgericht|gericht/i.test(recipient)) return recipient.replace(/(Amtsgericht[^\n]*)/i, "$1\nRechtsantragstelle");
  if (/amtsgericht/i.test(c)) return "Amtsgericht / Rechtsantragstelle\n[Adresse bitte eintragen]";
  return "Amtsgericht / Rechtsantragstelle\n[Adresse bitte eintragen]";
}

function buildLegalAidChecklistAnswerV15(meta = {}, context = "", langCode = "tr") {
  const ref = getPrimaryReference(meta);
  const termin = meta.termin || "";
  const recipient = getLegalAidRecipientAddress(meta, context);
  if (langCode === "tr") {
    return cleanText(`Tamam. Burada konu para iadesi değil, avukat yardımıdır.

Bu bir mahkeme/ceza davası olduğu için dikkatli ve hızlı ilerlemek gerekir. Bürgergeld/Jobcenter yardımı alınıyorsa Beratungshilfe veya bazı durumlarda Pflichtverteidiger konusu kontrol edilebilir. Bu garanti değildir; yetkili yer karar verir.

Kontrol listesi:
☐ 1. Mahkeme yazısını hazırla.
${ref ? `☐ 2. Aktenzeichen'i not et: ${ref}.` : "☐ 2. Aktenzeichen'i mahkeme yazısından not et."}
☐ 3. Güncel Bürgergeld/Jobcenter Bescheidini hazırla.
☐ 4. Kimliği hazırla: Personalausweis veya Reisepass.
☐ 5. ${recipient.replace(/\n/g, ", ")} ile iletişime geç.
☐ 6. Şunu sor: “Beratungshilfe alabilir miyim? Bu dosyada Pflichtverteidiger mümkün mü?”
☐ 7. Strafrecht alanında bir avukat ara ve Bürgergeld aldığını söyle.
${termin ? `☐ 8. Mahkeme tarihini kaçırma: ${termin}.` : "☐ 8. Mahkeme tarihini kaçırma. Tarih yazıda varsa hemen takvime ekle."}

Sorulması gereken kısa sorular:
- Şu anda avukatınız var mı?
- Avukat masrafını ödeyebiliyor musunuz?
- Güncel Jobcenter/Bürgergeld Bescheidiniz var mı?
- Duruşma tarihi kesin mi?

Önemli: Mahkeme, polis veya ceza davası varsa yanlış bilgi vermeyin ve anlamadığınız bir şeyi imzalamayın.

İstersen bundan sonra Amtsgericht / Rechtsantragstelle için Almanca PDF dilekçesi hazırlayabilirim.`);
  }
  return cleanText(`Das ist kein Erstattungsfall, sondern ein Thema anwaltliche Hilfe.

Wenn Bürgergeld bezogen wird, können Beratungshilfe oder je nach Verfahren weitere Hilfe geprüft werden. In Strafsachen kann unter bestimmten Voraussetzungen auch ein Pflichtverteidiger in Betracht kommen. Das ist nicht garantiert; die zuständige Stelle entscheidet.

Checkliste:
☐ 1. Gerichtsschreiben bereitlegen.
${ref ? `☐ 2. Aktenzeichen notieren: ${ref}.` : "☐ 2. Aktenzeichen aus dem Schreiben notieren."}
☐ 3. Aktuellen Bürgergeld-/Jobcenter-Bescheid bereitlegen.
☐ 4. Ausweis bereitlegen.
☐ 5. Amtsgericht / Rechtsantragstelle kontaktieren.
☐ 6. Beratungshilfe und Pflichtverteidiger-Möglichkeit erfragen.
☐ 7. Strafrecht-Anwalt kontaktieren.
${termin ? `☐ 8. Gerichtstermin nicht verpassen: ${termin}.` : "☐ 8. Gerichtstermin nicht verpassen."}

Wenn du möchtest, erstelle ich daraus einen deutschen PDF-Brief an das Amtsgericht / die Rechtsantragstelle.`);
}

function buildLegalAidPdfOutputV15(meta = {}, context = "") {
  const senderAddress = getUserPostalAddress(meta, context).replace(getSafeSignatureName(meta, context), safeSignatureForDraft(meta, context));
  const recipient = getLegalAidRecipientAddress(meta, context);
  const date = getTodayGerman();
  const city = getCityFromPostalAddress(senderAddress);
  const placeLine = city ? `${city}, ${date}` : `[Ort], ${date}`;
  const ref = getPrimaryReference(meta);
  const subject = ref
    ? `Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe – ${formatReferenceForSubject(ref, "gericht") || ref}`
    : "Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe";
  const name = safeSignatureForDraft(meta, context);
  const body = `Sehr geehrte Damen und Herren,

ich bitte um Hilfe, weil ich mir einen Rechtsanwalt finanziell nicht leisten kann.

${ref ? `Ich beziehe mich auf das Verfahren mit dem Aktenzeichen ${cleanReferenceLabel(ref) || ref}.` : "Ich beziehe mich auf das aktuelle gerichtliche Schreiben."}

Ich beziehe Bürgergeld bzw. habe nur geringe finanzielle Mittel. Deshalb bitte ich um Mitteilung, wie ich Beratungshilfe beantragen kann.

Bitte teilen Sie mir außerdem mit, ob in diesem Verfahren die Beiordnung eines Pflichtverteidigers in Betracht kommt oder welche Schritte dafür erforderlich sind.

Den Bürgergeld-/Jobcenter-Bescheid, meinen Ausweis und das gerichtliche Schreiben kann ich vorlegen.

Bitte bestätigen Sie mir den Eingang dieses Schreibens und teilen Sie mir schriftlich mit, was ich als Nächstes tun muss.

Mit freundlichen Grüßen

${name}`;
  return cleanText(`PDF-BRIEF:

${senderAddress}

${recipient}

${placeLine}

Betreff: ${subject}

${body}`);
}

function buildInsuranceContractGuidanceV15(meta = {}, context = "", langCode = "tr") {
  const ref = getPrimaryReference(meta);
  if (langCode === "tr") {
    return cleanText(`Bu durumda “sigorta” kelimesi para iadesi/Krankenkasse anlamında görünmüyor. Daha çok bir sigorta sözleşmesi veya krediyle bağlantılı ek ürün gibi duruyor.

Bu yüzden doğru yol:
1. Sözleşmenin gerçekten isteyerek yapılıp yapılmadığını kontrol ettirmek.
2. Mümkünse Widerruf yani cayma hakkını kullanmak.
3. Ek olarak hilfsweise Kündigung yani yedek olarak fesih göndermek.
4. Abbuchung varsa banka hesabını kontrol etmek.
5. Yazılı onay istemek.
${ref ? `
Önemli numara: ${ref}` : ""}

Garanti veremem. Ama bu bir Erstattung/Krankenkasse konusu değil; sözleşme kontrolü, Widerruf ve Kündigung konusudur.`);
  }
  return cleanText(`Das wirkt nicht wie ein Erstattungsfall, sondern wie ein Versicherungs-/Vertragsproblem.

Sinnvoll ist: Vertragsschluss prüfen lassen, vorsorglich widerrufen, hilfsweise kündigen, weitere Abbuchungen stoppen lassen und schriftliche Bestätigung verlangen.${ref ? `

Wichtige Nummer: ${ref}` : ""}`);
}

function buildAssistantAnalysisDebugLine(analysis = {}) {
  return ""; // bewusst leer: Analyse bleibt intern, keine UI-Verwirrung.
}

function buildForcedChatAnswer_LEGACY_1({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const context = buildContext(meta, briefText, kurz, details, frage, historyText);
  const domain = detectDomain(context);
  const analysis = buildHilfe24AnalysisV15({ frage, frageMode, meta, briefText, kurz, details, historyText });
  const outputChoice = isAnsweringOutputChoice(frage, historyText);
  const intent = outputChoice ? inferIntentFromHistory(historyText || context) : detectCoreIntent(frage, frageMode);
  const wantsPdf = outputChoice === "pdf" || (!outputChoice && wantsPdfOutput(frage, frageMode));
  const wantsEmail = outputChoice === "email" || (!outputChoice && wantsEmailOutput(frage, frageMode));
  const wantsBoth = outputChoice === "both" || (!outputChoice && wantsBothEmailAndPdf(frage, frageMode));
  const explicitWrite = isExplicitWriteRequest(frage, frageMode) || Boolean(outputChoice);

  if (intent === "smalltalk") return "Gerne. Schreib deine nächste Frage.";

  // V15.0: Gericht/Anwalt/Bürgergeld ist Hochrisiko. Zuerst Assistenten-Leitfaden,
  // wenn der Nutzer Schritt-für-Schritt-Hilfe braucht. Keine falsche Erstattungs-/Krankenkassen-Vorlage.
  if (analysis.caseType === "court_legal_aid") {
    const pureFormatChoice = /^(pdf|brief|e-?mail|email|mail|beides|1|2|3)$/i.test(normalizeString(frage));
    const directDraftRequest = explicitWrite && (wantsPdf || wantsEmail || wantsBoth) && !analysis.wantsGuidance;
    const followUpDraftAfterGuidance = pureFormatChoice && /beratungshilfe|pflichtverteidiger|rechtsantragstelle|amtsgericht|anwalt|avukat/i.test(historyText || "");

    if ((analysis.wantsGuidance || analysis.currentUserGoal === "legal_aid") && !directDraftRequest && !followUpDraftAfterGuidance) {
      return buildLegalAidChecklistAnswerV15(meta, context, analysis.userLanguage);
    }

    if ((wantsPdf || followUpDraftAfterGuidance) && templateAllowedV15(analysis, "legal_aid_request")) {
      return buildLegalAidPdfOutputV15(meta, context);
    }

    if (wantsEmail && templateAllowedV15(analysis, "legal_aid_request")) {
      const pdf = buildLegalAidPdfOutputV15(meta, context).replace(/^PDF-BRIEF:\s*/i, "");
      return cleanText(`Empfänger: Amtsgericht / Rechtsantragstelle

Betreff: Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe

${pdf.split(/\n\nBetreff:/).pop().replace(/^.*?Sehr geehrte/s, "Sehr geehrte")}`);
    }

    return buildLegalAidChecklistAnswerV15(meta, context, analysis.userLanguage);
  }

  // V15.0: Versicherung/sigorta als Vertrag darf nicht in Krankenkassen-Erstattung kippen.
  if (analysis.caseType === "insurance_contract") {
    if (explicitWrite && (wantsPdf || wantsEmail || wantsBoth)) {
      const contractContext = `${context}\n${frage}`;
      if (wantsBoth) return buildEmailAndPdfOutput(meta, contractContext, "vertrag_versicherung", "cancel");
      if (wantsPdf && !wantsEmail) return buildPdfOnlyOutput(meta, contractContext, "vertrag_versicherung", "cancel");
      if (wantsEmail && !wantsPdf) return buildProfessionalOutput(meta, contractContext, "vertrag_versicherung", "cancel");
    }
    if (analysis.wantsGuidance || analysis.currentUserGoal === "contract_check_cancel") {
      return buildInsuranceContractGuidanceV15(meta, context, analysis.userLanguage);
    }
  }

  // V15.0: Leitfaden-/Checklistenfragen nicht sofort in Schreibmodus drücken.
  if (analysis.wantsGuidance && !explicitWrite) {
    const lines = [];
    lines.push("Ich mache dir zuerst einen einfachen Leitfaden.");
    lines.push("");
    lines.push("Checkliste:");
    const docs = analysis.requiredDocuments && analysis.requiredDocuments.length ? analysis.requiredDocuments : ["aktuelles Schreiben", "Nummer/Aktenzeichen", "Nachweise", "Ausweis falls Termin bei einer Stelle nötig ist"];
    docs.slice(0, 6).forEach((d, i) => lines.push(`☐ ${i + 1}. ${d}`));
    lines.push("");
    if (analysis.possibleRights && analysis.possibleRights.length) lines.push(`Möglich zu prüfen: ${analysis.possibleRights.join(", ")}.`);
    if (analysis.targetParty) lines.push(`Zuständige Stelle wahrscheinlich: ${analysis.targetParty}.`);
    if (analysis.deadline) lines.push(`Wichtig: Frist/Termin beachten: ${analysis.deadline}.`);
    lines.push("Die zuständige Stelle entscheidet. Ich kann dir den sicheren nächsten Schritt formulieren, aber keine Garantie geben.");
    lines.push("");
    lines.push("Wenn du möchtest, erstelle ich dir danach eine E-Mail oder einen PDF-Brief.");
    return cleanText(lines.join("\n"));
  }

  // Write Mode: nur bei ausdrücklichem Wunsch und nur nach aktueller Analyse.
  const rememberedWriteIntent = inferIntentFromHistory(historyText || context);
  let currentWriteIntent = inferCurrentWriteIntentFromUserQuestion(frage, frageMode);

  // Template-Guard: bei Vertragsversicherung darf aktuelles „sigorta“ nicht automatisch Erstattung bedeuten.
  if (analysis.caseType === "insurance_contract" && currentWriteIntent === "reimbursement") currentWriteIntent = "cancel";

  const costCarrierWriteNow = currentWriteIntent === "reimbursement";
  const effectiveWriteIntent = currentWriteIntent
    || ((intent === "erstattung_kostenuebernahme" || intent === "reimbursement" || costCarrierWriteNow) ? "reimbursement" : rememberedWriteIntent);

  // Template-Guard: verbotene Vorlagen blockieren und stattdessen sichere Rückfrage/Leitfaden liefern.
  if (analysis.forbiddenTemplates && analysis.forbiddenTemplates.length) {
    if ((effectiveWriteIntent === "reimbursement" || effectiveWriteIntent === "erstattung_kostenuebernahme") && analysis.forbiddenTemplates.includes("krankenkasse_reimbursement")) {
      return "Das wäre hier wahrscheinlich die falsche Vorlage. In diesem Fall geht es nicht um Krankenkasse/Erstattung. Ich mache zuerst einen passenden Leitfaden und kann danach den richtigen Brief erstellen.";
    }
  }

  if (wantsBoth) return buildEmailAndPdfOutput(meta, context, domain, effectiveWriteIntent);
  if (wantsPdf && !wantsEmail) return buildPdfOnlyOutput(meta, context, domain, effectiveWriteIntent);
  if (wantsEmail && !wantsPdf) return buildProfessionalOutput(meta, context, domain, effectiveWriteIntent);
  if (intent === "schreibwunsch" || (explicitWrite && !wantsPdf && !wantsEmail)) return askOutputChoice(effectiveWriteIntent);

  return "";
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
  return /(ratenzahlung|rate|raten|taksit|taksitli|taksitlendirme|stundung|zahlungsaufschub|zahlungsnachweis|schon bezahlt.*mahnung|an dzr|dzr için|dzr icin|an inkasso|an den gläubiger|an den glaeubiger)/i.test(q);
}

function inferCurrentWriteIntentFromUserQuestion(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();

  // V14.5: Die aktuelle Nutzerfrage schlägt die vorherige Chat-Historie.
  // Beispiel: Vorher fragte der Nutzer nach Erstattung an Versicherung.
  // Danach schreibt er: „Bana DZR için taksitli ödeme e-postası hazırla“.
  // Dann muss der neue Entwurf an DZR/Ratenzahlung gehen, nicht weiter an Versicherung.
  if (hasReimbursementIntent(frage, frageMode) || hasOfficialWriteToCostCarrierCue(q)) return "reimbursement";

  if (/(ratenzahlung|rate|raten|monatlich zahlen|in raten|taksit|taksitli|taksitlendirme|ödeme planı|odeme plani|installments|payment plan|разсроч|rate lunare)/i.test(q)) return "installments";
  if (/(stundung|zahlungsaufschub|aufschub|erteleme|ödeme erteleme|odeme erteleme)/i.test(q)) return "no_money";
  if (/(zahlungsnachweis|überweisungsbeleg|ueberweisungsbeleg|schon bezahlt|bereits bezahlt|dekont|ödeme belgesi|odeme belgesi)/i.test(q)) return "paid";
  if (/(widerruf|widerrufen|kündigung|kuendigung|kündigen|kuendigen|iptal|fesih|cancel|termination)/i.test(q)) return "cancel";
  if (/(widerspruch|einspruch|bestreiten|stimmt nicht|itiraz|contest|objection)/i.test(q)) return "dispute";

  return "";
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
  if (hasAny(q, ["ratenzahlung", "rate", "raten", "monatlich zahlen", "in raten", "taksit", "taksitli", "taksitlendirme", "ödeme planı", "odeme plani", "разсроч", "rate", "rate lunare", "installments", "payment plan"])) return "ratenzahlung";
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



/* ==========================================================
   HILFE24 V15.0 - ASSISTENTEN-ANALYSE + TEMPLATE-GUARD
   Ziel: erst analysieren, dann antworten/schreiben.
   Index bleibt Anzeige-Schicht. Server entscheidet Fachlogik.
   ========================================================== */

function normalizeForIntent(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function detectUserLanguageFromQuestion(frage = "", fallback = "de") {
  const raw = String(frage || "").toLowerCase();
  const q = normalizeForIntent(raw);
  if (/(\bben\b|bana|sana|nasıl|nasil|yapayim|yapayım|anlat|avukat|yardim|yardım|dilekce|dilekçe|mektup|sigorta|taksit|gonder|gönder|hazirla|hazırla|odeme|ödeme)/i.test(q)) return "tr";
  if (/[а-яё]/i.test(raw)) return "bg";
  if (/(what|how|why|please|letter|lawyer|insurance|refund|help)/i.test(raw)) return "en";
  if (/(avocat|asigurare|scrisoare|ajutor|rambursare|plată|plata)/i.test(raw)) return "ro";
  return fallback || "de";
}

function safeSignatureForDraft(meta = {}, context = "") {
  const raw = getSafeSignatureName(meta, context);
  const clean = normalizeString(raw)
    .replace(/['’´`]?(nin|nın|nun|nün|in|ın|un|ün)$/i, "")
    .replace(/['’´`]s$/i, "")
    .replace(/\b(forderung|versicherung|portal|patientenportal|webseite|rechnung|aktenzeichen)\b/gi, "")
    .trim();
  return looksLikePersonName(clean) ? clean : (looksLikePersonName(raw) ? raw : "[Name bitte prüfen/eintragen]");
}

function hasLegalAidCue(text = "") {
  const q = normalizeForIntent(text);
  return /(anwalt|rechtsanwalt|verteidiger|pflichtverteidiger|beratungshilfe|prozesskostenhilfe|verfahrenskostenhilfe|rechtsantragstelle|avukat|avukati|avukata|avukat tut|para odemeden avukat|hukuki yardim|hukuk yardimi|legal aid|lawyer)/i.test(q);
}

function hasCourtCriminalCue(text = "") {
  const q = normalizeForIntent(text);
  return /(gericht|amtsgericht|landgericht|staatsanwaltschaft|polizei|anklage|angeklagt|straf|strafverfahren|strafbefehl|hauptverhandlung|ladung|umladung|termin|haftbefehl|pflichtverteidiger|gefahrliche korperverletzung|körperverletzung|mahkeme|savcilik|savcılık|ceza davasi|dava|duruşma|durusma|police|court|prosecutor)/i.test(q);
}

function hasGuidanceCue(text = "") {
  const q = normalizeForIntent(text);
  return /(schritt fur schritt|schrittweise|leitfaden|checkliste|was brauche ich|was muss ich mitnehmen|was soll ich jetzt machen|was soll ich tun|wie mache ich|wie bekomme ich|tek tek|tek tek anlat|nasil yapayim|nasıl yapayım|bana yol goster|yol göster|ne yapmam gerekiyor|kontrol listesi|abhaken|plan|guide|checklist)/i.test(q);
}

function hasBenefitCue(text = "") {
  const q = normalizeForIntent(text);
  return /(pflegegrad|pflegekasse|pflegeversicherung|pflegegeld|entlastungsbetrag|krankenkasse|rentenversicherung|rentenkasse|erwerbsminderung|reha|schwerbehindert|gdb|versorgungsamt|jobcenter|burgergeld|buergergeld|sozialamt|wohngeld|familienkasse|kinderzuschlag|unterhaltsvorschuss|bildung und teilhabe|but|rundfunkbefreiung|p-konto|pfandung|pfändung|was kann ich bekommen|steht mir zu)/i.test(q);
}

function hasInsuranceContractCue(text = "") {
  const q = normalizeForIntent(text);
  return /(finanz-schutzbrief|finanzschutzbrief|versicherungsschein|versicherungsscheinnummer|versicherungsbeginn|versicherungsende|versicherungsablauf|sepa-lastschrift|kredit|kreditanfrage|kredit nicht|kredi|kredi cek|kredi olmad|sigorta cik|sigorta çık|abschließen|abgeschlossen|vertrag|widerruf|kundigen|kündigen|kuendigen|abo|lastschrift)/i.test(q)
    && /(versicherung|sigorta|schutzbrief|vertrag|kredit|kredi)/i.test(q);
}

function detectCaseTypeV15(context = "") {
  const q = normalizeForIntent(context);
  if (hasCourtCriminalCue(q)) return "court_legal_aid";
  if (hasInsuranceContractCue(q)) return "insurance_contract";
  if (/(dzr|zahnarzt|zahn|rechnung|rg-nummer|goz|bema|behandlung|patient)/i.test(q)) return "invoice_medical";
  if (/(inkasso|mahnung|forderung|gerichtsvollzieher|vollstreckung)/i.test(q)) return "debt_collection";
  if (/(jobcenter|burgergeld|buergergeld|sozialamt|rückforderung|rueckforderung|bescheid|widerspruch|aufrechnung)/i.test(q)) return "authority_social";
  if (/(pflegegrad|pflegekasse|pflegeversicherung|md gutachten|medizinischer dienst)/i.test(q)) return "care_insurance";
  if (/(rentenversicherung|rentenkasse|erwerbsminderung|reha|teilhabe am arbeitsleben|kontenklärung|kontenklaerung)/i.test(q)) return "pension_insurance";
  if (/(schwerbehindert|gdb|merkzeichen|versorgungsamt|behindertenausweis)/i.test(q)) return "disability";
  if (/(arbeitgeber|arbeitnehmer|lohn|gehalt|abmahnung|kündigung|kuendigung|arbeitszeugnis|schuldanerkenntnis|lohnabtretung)/i.test(q)) return "employment";
  if (/(vermieter|miete|nebenkosten|kaution|räumung|raeumung|wohnung)/i.test(q)) return "housing";
  if (/(finanzamt|steuer|einkommensteuer|säumniszuschlag|saeumniszuschlag)/i.test(q)) return "tax";
  if (/(rundfunkbeitrag|beitragsservice|beitragskonto)/i.test(q)) return "broadcast_fee";
  if (/(familienkasse|kindergeld|kinderzuschlag|jugendamt|unterhaltsvorschuss|schule|kita|klassenfahrt|bildung und teilhabe)/i.test(q)) return "family_school";
  if (/(krankenkasse|hilfsmittel|zuzahlungsbefreiung|krankengeld|haushaltshilfe|fahrtkosten|rezept|verordnung)/i.test(q)) return "health_insurance";
  return detectDomain(context) || "allgemein";
}

function detectCurrentUserGoalV15(frage = "", context = "") {
  const q = normalizeForIntent(`${frage} ${context}`);
  if (hasLegalAidCue(q)) return "legal_aid";
  if (hasGuidanceCue(frage)) return "guidance";
  if (hasInsuranceContractCue(`${frage} ${context}`) && /(widerruf|kundig|kündig|kuendig|iptal|fesih|nicht gewollt|nicht bewusst|kredi|kredit|vertrag prüfen|vertrag pruefen)/i.test(q)) return "contract_check_cancel";
  if (hasReimbursementIntent(frage, "")) return "reimbursement";
  if (/(ratenzahlung|rate|raten|taksit|taksitli|stundung|zahlungsaufschub)/i.test(q)) return "payment_plan";
  if (/(schon bezahlt|bereits bezahlt|habe bezahlt|überwiesen|ueberwiesen|dekont|zahlungsnachweis)/i.test(q)) return "paid_proof";
  if (/(widerspruch|einspruch|bestreiten|stimmt nicht|itiraz|ablehnung|abgelehnt)/i.test(q)) return "appeal_dispute";
  if (hasBenefitCue(q)) return "benefit_check";
  if (/(welche behandlung|was wurde gemacht|wofur ist die rechnung|wofür ist die rechnung|leistungsaufstellung|goz|bema)/i.test(q)) return "details_needed";
  if (/(frist|bis wann|termin|deadline)/i.test(q)) return "deadline";
  if (/(was bedeutet|erklär|erklar|anlam|ne demek)/i.test(q)) return "understand";
  if (/(was soll ich|was muss ich|was kann ich|ne yapmam|nasil|nasıl|wie weiter)/i.test(q)) return "guidance";
  return "answer_question";
}

function detectRequestedFormatV15(frage = "", frageMode = "") {
  if (wantsBothEmailAndPdf(frage, frageMode)) return "both";
  if (wantsPdfOutput(frage, frageMode)) return "pdf";
  if (wantsEmailOutput(frage, frageMode)) return "email";
  return "none";
}

function buildTemplateRulesV15(caseType = "", userGoal = "") {
  const rules = {
    allowedTemplates: ["general_answer"],
    forbiddenTemplates: [],
    riskLevel: "low",
    riskReasons: []
  };
  if (caseType === "court_legal_aid") {
    rules.riskLevel = "high";
    rules.riskReasons.push("Gericht/Strafsache/Anwalt möglich");
    rules.allowedTemplates = ["legal_aid_checklist", "legal_aid_request", "public_defender_request", "court_clarification", "appointment_notice"];
    rules.forbiddenTemplates = ["krankenkasse_reimbursement", "dzr_installments", "dental_detail_request", "insurance_reimbursement", "generic_invoice_refund"];
  } else if (caseType === "insurance_contract") {
    rules.riskLevel = "medium";
    rules.riskReasons.push("Vertrag/Widerruf/Kündigung möglich");
    rules.allowedTemplates = ["contract_check_cancel", "withdrawal", "termination", "contract_proof_request", "stop_debit_request"];
    rules.forbiddenTemplates = ["krankenkasse_reimbursement", "dzr_installments", "dental_detail_request"];
  } else if (caseType === "invoice_medical") {
    rules.allowedTemplates = ["reimbursement", "paid_proof", "installments", "detail_request", "general_answer"];
    rules.forbiddenTemplates = ["legal_aid_request", "public_defender_request"];
  } else if (caseType === "debt_collection") {
    rules.riskLevel = "medium";
    rules.allowedTemplates = ["debt_check", "installments", "paid_proof", "dispute"];
    rules.forbiddenTemplates = ["krankenkasse_reimbursement", "legal_aid_request"];
  } else if (["tax", "employment", "housing"].includes(caseType)) {
    rules.riskLevel = "medium";
    rules.riskReasons.push("Frist/Geld/Vertrag möglich");
  }
  return rules;
}

function buildHilfe24AnalysisV15({ frage = "", frageMode = "", meta = {}, briefText = "", kurz = "", details = "", historyText = "" }) {
  const context = buildContext(meta, briefText, kurz, details, frage, historyText);
  const currentOnly = String(frage || "");
  const caseType = detectCaseTypeV15(`${context}`);
  const currentUserGoal = detectCurrentUserGoalV15(currentOnly, context);
  const requestedFormat = detectRequestedFormatV15(frage, frageMode);
  const isWriteRequest = isExplicitWriteRequest(frage, frageMode) || requestedFormat !== "none";
  const wantsChecklist = hasGuidanceCue(currentOnly) || /(checkliste|leitfaden|abhaken|kontrol listesi)/i.test(normalizeForIntent(currentOnly));
  const wantsStepByStep = hasGuidanceCue(currentOnly);
  const wantsGuidance = wantsChecklist || wantsStepByStep || currentUserGoal === "guidance" || (caseType === "court_legal_aid" && hasLegalAidCue(currentOnly));
  const templateRules = buildTemplateRulesV15(caseType, currentUserGoal);
  let targetParty = getSender(meta) || "Stelle aus dem Schreiben";
  let officialDraftLanguage = "Deutsch";
  let shouldOnlyAnswer = !isWriteRequest;
  let shouldCreateDraft = isWriteRequest && requestedFormat !== "none";
  let shouldAskClarification = false;
  let clarificationQuestion = "";

  if (caseType === "court_legal_aid") {
    targetParty = "Amtsgericht / Rechtsantragstelle";
    if (wantsGuidance && !/^(pdf|brief|e-?mail|email|mail)$/i.test(normalizeString(frage))) {
      shouldOnlyAnswer = false;
      shouldCreateDraft = false;
    }
  } else if (caseType === "insurance_contract") {
    targetParty = getSender(meta) || "Versicherung / Vertragspartner";
  } else if (currentUserGoal === "reimbursement") {
    targetParty = "Krankenkasse / Versicherung / Kostenträger";
  } else if (currentUserGoal === "payment_plan" || currentUserGoal === "paid_proof") {
    targetParty = getSender(meta) || "Gläubiger / Rechnungssteller";
  }

  if (isWriteRequest && requestedFormat === "none") {
    shouldAskClarification = true;
    clarificationQuestion = "Möchtest du eine E-Mail, einen PDF-Brief oder beides?";
    shouldCreateDraft = false;
  }

  const allowedTemplates = templateRules.allowedTemplates;
  const forbiddenTemplates = templateRules.forbiddenTemplates;

  return {
    caseType,
    currentUserGoal,
    currentUserIntent: isWriteRequest ? "write_or_prepare" : (wantsGuidance ? "guidance" : "answer"),
    isWriteRequest,
    wantsChecklist,
    wantsStepByStep,
    wantsGuidance,
    requestedFormat,
    shouldOnlyAnswer,
    shouldCreateDraft,
    shouldAskClarification,
    clarificationQuestion,
    userLanguage: detectUserLanguageFromQuestion(frage, "de"),
    officialDraftLanguage,
    sourceParty: getSender(meta) || "",
    demandingParty: getSender(meta) || "",
    targetParty,
    costCarrierParty: currentUserGoal === "reimbursement" ? "Krankenkasse / Versicherung / Kostenträger" : "",
    contractParty: caseType === "insurance_contract" ? (getSender(meta) || "Versicherung / Vertragspartner") : "",
    legalAidParty: caseType === "court_legal_aid" ? "Amtsgericht / Rechtsantragstelle" : "",
    benefitParty: currentUserGoal === "benefit_check" ? "zuständige Leistungsstelle" : "",
    rightsCategory: [caseType, currentUserGoal].filter(Boolean),
    possibleRights: inferPossibleRightsV15(caseType, currentUserGoal),
    possibleBenefits: inferPossibleBenefitsV15(caseType, currentUserGoal),
    requiredDocuments: inferRequiredDocumentsV15(caseType, currentUserGoal, meta),
    deadline: meta.frist || meta.termin || "",
    appointment: Boolean(meta.termin || /termin|duruşma|durusma|hauptverhandlung|ladung/i.test(normalizeForIntent(context))),
    riskLevel: templateRules.riskLevel,
    riskReasons: templateRules.riskReasons,
    forbiddenTemplates,
    allowedTemplates,
    protectedSignatureName: safeSignatureForDraft(meta, context),
    protectedIdentifiers: [getPrimaryReference(meta)].filter(Boolean),
    needsKnowledgeLookup: hasBenefitCue(`${frage} ${context}`) || hasLegalAidCue(`${frage} ${context}`),
    knowledgeCategory: [caseType, currentUserGoal].filter(Boolean)
  };
}

function inferPossibleRightsV15(caseType = "", goal = "") {
  if (caseType === "court_legal_aid") return ["Beratungshilfe prüfen", "Pflichtverteidiger prüfen", "Frist/Termin beachten", "schriftliche Klärung verlangen"];
  if (caseType === "insurance_contract") return ["Widerruf prüfen", "hilfsweise Kündigung", "Vertragsschluss-Nachweis verlangen", "Lastschrift/Abbuchung prüfen"];
  if (caseType === "debt_collection") return ["Forderung prüfen", "Forderungsaufstellung verlangen", "Nachweise verlangen", "Ratenzahlung/Stundung prüfen"];
  if (caseType === "authority_social") return ["Widerspruch prüfen", "Unterlagen nachreichen", "Akteneinsicht/Begründung verlangen", "Frist beachten"];
  if (caseType === "care_insurance") return ["Pflegegrad beantragen oder Höherstufung prüfen", "Widerspruch gegen Bescheid prüfen", "MD-Gutachten prüfen"];
  if (caseType === "pension_insurance") return ["Reha prüfen", "Erwerbsminderungsrente prüfen", "Widerspruch gegen Bescheid prüfen"];
  if (caseType === "disability") return ["Schwerbehindertenausweis/GdB prüfen", "Merkzeichen/Nachteilsausgleiche prüfen", "Widerspruch prüfen"];
  if (goal === "reimbursement") return ["Kostenübernahme/Erstattung prüfen lassen"];
  return [];
}

function inferPossibleBenefitsV15(caseType = "", goal = "") {
  if (caseType === "court_legal_aid") return ["Beratungshilfe", "Prozesskostenhilfe/Verfahrenskostenhilfe je nach Verfahren", "Pflichtverteidiger nur bei bestimmten Strafsachen"];
  if (caseType === "care_insurance") return ["Pflegegeld", "Pflegesachleistungen", "Entlastungsbetrag", "Pflegehilfsmittel", "Wohnraumanpassung"];
  if (caseType === "health_insurance") return ["Kostenübernahme", "Hilfsmittel", "Zuzahlungsbefreiung", "Krankengeld", "Fahrtkosten"];
  if (caseType === "pension_insurance") return ["Reha", "Teilhabe am Arbeitsleben", "Erwerbsminderungsrente"];
  if (caseType === "disability") return ["Nachteilsausgleiche", "Merkzeichen", "Steuer-/Mobilitätsvorteile je nach Fall"];
  if (caseType === "family_school") return ["Bildung und Teilhabe", "Kinderzuschlag", "Unterhaltsvorschuss", "Kita-Ermäßigung"];
  if (goal === "benefit_check") return ["mögliche staatliche Hilfe oder Befreiung prüfen lassen"];
  return [];
}

function inferRequiredDocumentsV15(caseType = "", goal = "", meta = {}) {
  const ref = getPrimaryReference(meta);
  const common = [];
  if (ref) common.push(`Nummer/Aktenzeichen: ${ref}`);
  if (caseType === "court_legal_aid") return dedupe(["Gerichtsschreiben", ref ? `Aktenzeichen: ${ref}` : "Aktenzeichen", "aktueller Bürgergeld-/Jobcenter-Bescheid", "Personalausweis oder Reisepass", "falls vorhanden: Einkommens- und Ausgabennachweise"]);
  if (caseType === "insurance_contract") return dedupe(["Vertrag/Versicherungsschein", "Schreiben der Versicherung", "Nachweis zur Kreditanfrage", "Kontoauszug bei Abbuchung", ...common]);
  if (goal === "reimbursement") return dedupe(["Rechnung", "Zahlungsnachweis", "Leistungsaufstellung", "Versicherungs-/Krankenkassendaten", ...common]);
  if (caseType === "care_insurance") return ["Pflegegrad-Bescheid", "MD-Gutachten", "Arztberichte", "Medikamentenplan", "Pflegedokumentation"];
  if (caseType === "pension_insurance") return ["Rentenversicherungs-Schreiben", "Arztberichte", "Arbeitsunfähigkeitszeiten", "Reha-Unterlagen", "Versicherungsverlauf"];
  return common;
}

function templateAllowedV15(analysis = {}, templateName = "") {
  if (!templateName) return true;
  if (Array.isArray(analysis.forbiddenTemplates) && analysis.forbiddenTemplates.includes(templateName)) return false;
  if (Array.isArray(analysis.allowedTemplates) && analysis.allowedTemplates.length && !analysis.allowedTemplates.includes(templateName) && !analysis.allowedTemplates.includes("general_answer")) return false;
  return true;
}

function getLegalAidRecipientAddress(meta = {}, context = "") {
  const c = String(context || "");
  if (/amtsgericht\s+lemgo/i.test(c)) return "Amtsgericht Lemgo\nRechtsantragstelle\nAm Lindenhaus 2\n32657 Lemgo";
  const recipient = getRecipientPostalAddress(meta, context);
  if (/amtsgericht|gericht/i.test(recipient)) return recipient.replace(/(Amtsgericht[^\n]*)/i, "$1\nRechtsantragstelle");
  if (/amtsgericht/i.test(c)) return "Amtsgericht / Rechtsantragstelle\n[Adresse bitte eintragen]";
  return "Amtsgericht / Rechtsantragstelle\n[Adresse bitte eintragen]";
}

function buildLegalAidChecklistAnswerV15(meta = {}, context = "", langCode = "tr") {
  const ref = getPrimaryReference(meta);
  const termin = meta.termin || "";
  const recipient = getLegalAidRecipientAddress(meta, context);
  if (langCode === "tr") {
    return cleanText(`Tamam. Burada konu para iadesi değil, avukat yardımıdır.

Bu bir mahkeme/ceza davası olduğu için dikkatli ve hızlı ilerlemek gerekir. Bürgergeld/Jobcenter yardımı alınıyorsa Beratungshilfe veya bazı durumlarda Pflichtverteidiger konusu kontrol edilebilir. Bu garanti değildir; yetkili yer karar verir.

Kontrol listesi:
☐ 1. Mahkeme yazısını hazırla.
${ref ? `☐ 2. Aktenzeichen'i not et: ${ref}.` : "☐ 2. Aktenzeichen'i mahkeme yazısından not et."}
☐ 3. Güncel Bürgergeld/Jobcenter Bescheidini hazırla.
☐ 4. Kimliği hazırla: Personalausweis veya Reisepass.
☐ 5. ${recipient.replace(/\n/g, ", ")} ile iletişime geç.
☐ 6. Şunu sor: “Beratungshilfe alabilir miyim? Bu dosyada Pflichtverteidiger mümkün mü?”
☐ 7. Strafrecht alanında bir avukat ara ve Bürgergeld aldığını söyle.
${termin ? `☐ 8. Mahkeme tarihini kaçırma: ${termin}.` : "☐ 8. Mahkeme tarihini kaçırma. Tarih yazıda varsa hemen takvime ekle."}

Sorulması gereken kısa sorular:
- Şu anda avukatınız var mı?
- Avukat masrafını ödeyebiliyor musunuz?
- Güncel Jobcenter/Bürgergeld Bescheidiniz var mı?
- Duruşma tarihi kesin mi?

Önemli: Mahkeme, polis veya ceza davası varsa yanlış bilgi vermeyin ve anlamadığınız bir şeyi imzalamayın.

İstersen bundan sonra Amtsgericht / Rechtsantragstelle için Almanca PDF dilekçesi hazırlayabilirim.`);
  }
  return cleanText(`Das ist kein Erstattungsfall, sondern ein Thema anwaltliche Hilfe.

Wenn Bürgergeld bezogen wird, können Beratungshilfe oder je nach Verfahren weitere Hilfe geprüft werden. In Strafsachen kann unter bestimmten Voraussetzungen auch ein Pflichtverteidiger in Betracht kommen. Das ist nicht garantiert; die zuständige Stelle entscheidet.

Checkliste:
☐ 1. Gerichtsschreiben bereitlegen.
${ref ? `☐ 2. Aktenzeichen notieren: ${ref}.` : "☐ 2. Aktenzeichen aus dem Schreiben notieren."}
☐ 3. Aktuellen Bürgergeld-/Jobcenter-Bescheid bereitlegen.
☐ 4. Ausweis bereitlegen.
☐ 5. Amtsgericht / Rechtsantragstelle kontaktieren.
☐ 6. Beratungshilfe und Pflichtverteidiger-Möglichkeit erfragen.
☐ 7. Strafrecht-Anwalt kontaktieren.
${termin ? `☐ 8. Gerichtstermin nicht verpassen: ${termin}.` : "☐ 8. Gerichtstermin nicht verpassen."}

Wenn du möchtest, erstelle ich daraus einen deutschen PDF-Brief an das Amtsgericht / die Rechtsantragstelle.`);
}

function buildLegalAidPdfOutputV15(meta = {}, context = "") {
  const senderAddress = getUserPostalAddress(meta, context).replace(getSafeSignatureName(meta, context), safeSignatureForDraft(meta, context));
  const recipient = getLegalAidRecipientAddress(meta, context);
  const date = getTodayGerman();
  const city = getCityFromPostalAddress(senderAddress);
  const placeLine = city ? `${city}, ${date}` : `[Ort], ${date}`;
  const ref = getPrimaryReference(meta);
  const subject = ref
    ? `Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe – ${formatReferenceForSubject(ref, "gericht") || ref}`
    : "Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe";
  const name = safeSignatureForDraft(meta, context);
  const body = `Sehr geehrte Damen und Herren,

ich bitte um Hilfe, weil ich mir einen Rechtsanwalt finanziell nicht leisten kann.

${ref ? `Ich beziehe mich auf das Verfahren mit dem Aktenzeichen ${cleanReferenceLabel(ref) || ref}.` : "Ich beziehe mich auf das aktuelle gerichtliche Schreiben."}

Ich beziehe Bürgergeld bzw. habe nur geringe finanzielle Mittel. Deshalb bitte ich um Mitteilung, wie ich Beratungshilfe beantragen kann.

Bitte teilen Sie mir außerdem mit, ob in diesem Verfahren die Beiordnung eines Pflichtverteidigers in Betracht kommt oder welche Schritte dafür erforderlich sind.

Den Bürgergeld-/Jobcenter-Bescheid, meinen Ausweis und das gerichtliche Schreiben kann ich vorlegen.

Bitte bestätigen Sie mir den Eingang dieses Schreibens und teilen Sie mir schriftlich mit, was ich als Nächstes tun muss.

Mit freundlichen Grüßen

${name}`;
  return cleanText(`PDF-BRIEF:

${senderAddress}

${recipient}

${placeLine}

Betreff: ${subject}

${body}`);
}

function buildInsuranceContractGuidanceV15(meta = {}, context = "", langCode = "tr") {
  const ref = getPrimaryReference(meta);
  if (langCode === "tr") {
    return cleanText(`Bu durumda “sigorta” kelimesi para iadesi/Krankenkasse anlamında görünmüyor. Daha çok bir sigorta sözleşmesi veya krediyle bağlantılı ek ürün gibi duruyor.

Bu yüzden doğru yol:
1. Sözleşmenin gerçekten isteyerek yapılıp yapılmadığını kontrol ettirmek.
2. Mümkünse Widerruf yani cayma hakkını kullanmak.
3. Ek olarak hilfsweise Kündigung yani yedek olarak fesih göndermek.
4. Abbuchung varsa banka hesabını kontrol etmek.
5. Yazılı onay istemek.
${ref ? `
Önemli numara: ${ref}` : ""}

Garanti veremem. Ama bu bir Erstattung/Krankenkasse konusu değil; sözleşme kontrolü, Widerruf ve Kündigung konusudur.`);
  }
  return cleanText(`Das wirkt nicht wie ein Erstattungsfall, sondern wie ein Versicherungs-/Vertragsproblem.

Sinnvoll ist: Vertragsschluss prüfen lassen, vorsorglich widerrufen, hilfsweise kündigen, weitere Abbuchungen stoppen lassen und schriftliche Bestätigung verlangen.${ref ? `

Wichtige Nummer: ${ref}` : ""}`);
}

function buildAssistantAnalysisDebugLine(analysis = {}) {
  return ""; // bewusst leer: Analyse bleibt intern, keine UI-Verwirrung.
}

function buildForcedChatAnswer_LEGACY_2({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
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
  const currentWriteIntent = inferCurrentWriteIntentFromUserQuestion(frage, frageMode);
  const costCarrierWriteNow = currentWriteIntent === "reimbursement";

  // V14.5: Aktuelle Nutzerfrage hat Vorrang vor alter Historie.
  // Sonst bleibt die App nach einer Erstattungsfrage fälschlich auf Versicherung/Krankenkasse hängen.
  const effectiveWriteIntent = currentWriteIntent
    || ((intent === "erstattung_kostenuebernahme" || intent === "reimbursement" || costCarrierWriteNow) ? "reimbursement" : rememberedWriteIntent);

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
    const bilder = req.body && req.body.bilder;
    const lang = (req.body.lang || "de").toLowerCase();

    if (!Array.isArray(bilder)) {
      return res.status(400).json({ ok: false, error: "Kein Bild empfangen." });
    }
    if (!bilder.length) {
      return res.status(400).json({ ok: false, error: "Kein Bild empfangen." });
    }
    if (bilder.length > 3) {
      return res.status(400).json({ ok: false, error: "Maximal 3 Bilder möglich." });
    }

    const MAX_IMAGE_BASE64_LEN = 12 * 1024 * 1024;
    for (const bild of bilder) {
      if (!bild || typeof bild.imageData !== "string" || typeof bild.mimeType !== "string") {
        return res.status(400).json({ ok: false, error: "Kein Bild empfangen." });
      }
      const normalizedImageData = String(bild.imageData).replace(/^data:[^;]+;base64,/, "");
      if (!normalizedImageData || normalizedImageData.length > MAX_IMAGE_BASE64_LEN) {
        return res.status(413).json({
          ok: false,
          error: "Das Foto ist zu groß. Bitte lade ein kleineres oder klareres Foto hoch."
        });
      }
    }

    const withTimeout = async (promise, ms) => {
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const timeoutError = new Error("brief-bild-timeout");
              timeoutError.code = "ETIMEDOUT";
              reject(timeoutError);
            }, ms);
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const langCode = getLanguageMeta(lang).code;
    let info;
    try {
      info = await withTimeout(buildInfoFromImages(bilder), 45000);
    } catch (error) {
      console.error("Gemini Fehler /api/brief-bild:", error);
      if (error && (error.code === "ETIMEDOUT" || /timeout|timed out|brief-bild-timeout/i.test(String(error.message || "")))) {
        return res.status(504).json({ ok: false, error: "Die Analyse dauert zu lange. Bitte versuche es mit einem klareren Foto oder weniger Seiten." });
      }
      throw error;
    }

    const kurzDe = buildCoreShortDe(info);
    const detailsDe = buildCoreExplanationDe(info);
    let kurz = cleanText(kurzDe);
    const details = cleanText(detailsDe);

    if (langCode !== "de") {
      try {
        kurz = await withTimeout(translateHelpTextIfNeeded(kurzDe, langCode), 12000);
      } catch (error) {
        console.error("Gemini Fehler /api/brief-bild:", error);
        if (error && (error.code === "ETIMEDOUT" || /timeout|timed out|brief-bild-timeout/i.test(String(error.message || "")))) {
          return res.status(504).json({ ok: false, error: "Die Analyse dauert zu lange. Bitte versuche es mit einem klareren Foto oder weniger Seiten." });
        }
      }
    }

    const refs = safeReferences(info);
    const name = getDetectedPersonName(info);
    return res.json({
      ok: true,
      quality_ok: true,
      hinweis: "",
      kurz,
      details,
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
        sourceMode: "image",
        must_react: info.muss_handeln === "ja" ? "yes" : info.muss_handeln === "nein" ? "no" : "maybe",
        money_affected: info.geld_betroffen === "ja" || info.betrag ? "yes" : info.geld_betroffen === "nein" ? "no" : "maybe",
        brief_schwierigkeit: info.brief_schwierigkeit,
        quality_type: detectDomain(buildContext(info)),
        risiko_kurz: info.risiko_kurz,
        erster_sicherer_schritt: info.erster_sicherer_schritt,
        daten_unsicher: info.daten_unsicher
      }
    });
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

    // V17 mini pipeline (route-local): decide answer path before Gemini.
    const v17Norm = (value = "") => String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/ş/g, "s")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c")
      .replace(/[^\w@.\s\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const v17Has = (text = "", patterns = []) => {
      const q = v17Norm(text);
      return patterns.some((p) => (p instanceof RegExp ? p.test(q) : q.includes(v17Norm(p))));
    };

    const currentContext = cleanText([
      briefText,
      erklaerungKurz,
      erklaerungDetails,
      frage,
      JSON.stringify(meta || {})
    ].filter(Boolean).join("\n\n")).slice(0, 30000);
    const currentQuestion = v17Norm(frage);
    const lastAssistantAnswer = cleanText((chatHistory.slice().reverse().find((e) => e && e.role === "assistant" && e.text) || {}).text || "");
    const lastUserQuestion = cleanText((chatHistory.slice().reverse().find((e) => e && e.role === "user" && e.text) || {}).text || "");
    const looksTurkish = /[ığüşöçİĞÜŞÖÇ]/.test(frage) || v17Has(currentQuestion, [/\bve\b/, /\bama\b/, /\bneden\b/, /\bniye\b/, /\bbana\b/, /\bisim\b/, /\bmektupta\b/, /\byaziyor\b/, /\byazıyor\b/, /\btaksit\b/]);
    const userLang = looksTurkish ? "tr" : langMeta.code;

    if (v17Has(currentQuestion, [/bana niye almanca yaziyorsun/, /bana niye almanca yazıyorsun/])) {
      return res.json({
        ok: true,
        antwort: cleanText("Haklısın. Sana Türkçe açıklıyorum. Resmi e-postayı Almanca hazırlıyorum.")
      });
    }

    const pendingNameRequested = v17Has(
      `${lastAssistantAnswer}\n${chatHistoryText}`,
      [/ich brauche nur noch den namen fur die unterschrift/, /name fur die unterschrift/, /unterschrift/]
    );
    const isLikelyOnlyName = (() => {
      const trimmed = cleanText(frage);
      if (!trimmed) return false;
      const words = trimmed.split(/\s+/).filter(Boolean);
      if (words.length < 1 || words.length > 5) return false;
      if (!/[A-Za-zÄÖÜäöüßÇĞİÖŞÜçğıöşü]/.test(trimmed)) return false;
      if (/\?|!|,|;|:/.test(trimmed)) return false;
      if (v17Has(trimmed, [/was|wie|warum|wieso|wo|wer|wann|kannst|bitte|ne|neden|niye|nasil|nasıl|kim|nerede|ne zaman/])) return false;
      return !/\d/.test(trimmed) && trimmed.length <= 60;
    })();
    const saysNameInLetter = v17Has(currentQuestion, [/isim mektupta yaziyor/, /isim mektupta yazıyor/, /name steht im brief/, /steht im brief/]);
    const briefNameMatch = cleanText(
      meta.betroffene_person ||
      meta.name ||
      meta.vollname ||
      meta.person_name ||
      ((briefText.match(/\b([A-ZÄÖÜ][a-zäöüß]+\s+[A-ZÄÖÜ][a-zäöüß]+)\b/) || [])[1] || "")
    );
    const pendingName = pendingNameRequested && isLikelyOnlyName ? cleanText(frage) : "";

    const correctionDetected = v17Has(currentQuestion, [
      /nein falsch/,
      /falsch/,
      /yok yanlis/,
      /yanlis/,
      /yanlis/,
      /nicht so/,
      /das ist falsch/
    ]);

    const wantsEmail = v17Has(currentQuestion, [/e[\s-]?mail/, /\bmail\b/, /e[\s-]?posta/, /\beposta\b/, /\bemail\b/]) || (pendingNameRequested && v17Has(`${lastAssistantAnswer}\n${lastUserQuestion}\n${chatHistoryText}`, [/empfanger:/, /empfänger:/, /e[\s-]?mail/, /\bmail\b/]));
    const wantsPdf = v17Has(currentQuestion, [/\bpdf\b/, /pdf brief/, /pdf-brief/, /brief zum download/]) || (pendingNameRequested && v17Has(`${lastAssistantAnswer}\n${lastUserQuestion}\n${chatHistoryText}`, [/pdf-brief/, /\bpdf\b/]));
    const wantsChecklist = v17Has(currentQuestion, [/unterlagen/, /checkliste/, /welche dokumente/, /welche nachweise/, /hangi belge/]);
    const wantsNextSteps = v17Has(currentQuestion, [/was soll ich tun/, /wie weiter/, /wie geht es weiter/, /ne yapmam/, /ne yapayim/, /ne yapayım/]);

    let answerType = "short_answer";
    if (wantsEmail) answerType = "draft_email";
    else if (wantsPdf) answerType = "draft_pdf";
    else if (wantsChecklist) answerType = "checklist";
    else if (wantsNextSteps) answerType = "next_steps";

    const contextUnclear = !briefText && !erklaerungKurz && !erklaerungDetails;
    const goalUnclear = currentQuestion.length < 5 || /^(ok|okay|ja|nein|hmm|hallo|hi)$/.test(currentQuestion);
    if (answerType === "short_answer" && (contextUnclear || goalUnclear)) answerType = "clarification";
    if (pendingName) {
      answerType = wantsPdf ? "draft_pdf" : "draft_email";
    }

    let userGoal = "understand";
    if (v17Has(currentQuestion, [/ratenzahlung/, /\brate\b/, /\braten\b/, /taksit/, /iki taksit/, /zwei raten/, /in raten/, /monatlich zahlen/])) userGoal = "installment_request";
    else if (v17Has(currentQuestion, [/stundung/, /zahlungsaufschub/, /spater zahlen/, /später zahlen/])) userGoal = "deferral_request";
    else if (v17Has(currentQuestion, [/erstattung/, /geld zuruck/, /geld zurück/, /zuruckbekommen/, /zurückbekommen/, /kostenubernahme/, /kostenübernahme/]) || (v17Has(currentQuestion, [/krankenkasse/, /versicherung/]) && v17Has(currentQuestion, [/bezahlt/, /einreichen/])) ) userGoal = "reimbursement_request";
    else if (v17Has(currentQuestion, [/kundigung/, /kündigung/, /widerruf/, /iptal/, /fesih/])) userGoal = "cancellation_request";
    else if (v17Has(currentQuestion, [/anwalt/, /beratungshilfe/, /pflichtverteidiger/, /rechtsantragstelle/, /avukat/])) userGoal = "legal_aid_request";
    else if (v17Has(currentQuestion, [/unterlagen nachreichen/, /bescheid geschickt/, /nachweis senden/, /unterlagen senden/])) userGoal = "submit_documents";
    else if (v17Has(currentQuestion, [/schon bezahlt/, /zahlungsnachweis/, /uberwiesen/, /überwiesen/, /dekont/])) userGoal = "payment_proof";
    else if (v17Has(currentQuestion, [/widerspruch/, /einspruch/, /stimmt nicht/, /bestreiten/, /itiraz/])) userGoal = "dispute_or_objection";
    if (pendingName && userGoal === "understand") {
      if (v17Has(`${lastUserQuestion}\n${chatHistoryText}\n${currentContext}`, [/ratenzahlung/, /rate/, /raten/, /taksit/, /iki taksit/, /zwei raten/, /monatlich zahlen/])) userGoal = "installment_request";
      else if (v17Has(`${lastUserQuestion}\n${chatHistoryText}\n${currentContext}`, [/stundung/, /zahlungsaufschub/])) userGoal = "deferral_request";
      else if (v17Has(`${lastUserQuestion}\n${chatHistoryText}\n${currentContext}`, [/erstattung/, /kostenubernahme/, /kostenübernahme/, /krankenkasse/, /versicherung/])) userGoal = "reimbursement_request";
      else if (v17Has(`${lastUserQuestion}\n${chatHistoryText}\n${currentContext}`, [/kundigung/, /kündigung/, /widerruf/, /iptal/, /fesih/])) userGoal = "cancellation_request";
    }

    let caseGroup = "unknown";
    if (v17Has(currentContext, [/mahnung/, /inkasso/, /forderung/, /vollstreckung/, /gerichtsvollzieher/])) caseGroup = "debt_collection";
    else if (v17Has(currentContext, [/\bbank\b/, /p-konto/, /pfandung/, /pfändung/, /\bkonto\b/, /freibetrag/])) caseGroup = "banking";
    else if (v17Has(currentContext, [/gericht/, /polizei/, /staatsanwaltschaft/, /strafsache/, /anklage/])) caseGroup = "court_police";
    else if (v17Has(currentContext, [/vertrag/, /versicherung/, /kredit/, /\babo\b/, /widerruf/, /kundigung/, /kündigung/])) caseGroup = "contracts";
    else if (v17Has(currentContext, [/krankenkasse/, /zahnarzt/, /\bdzr\b/, /rechnung/, /medizin/])) caseGroup = "health_insurance";
    else if (v17Has(currentContext, [/jobcenter/, /burgergeld/, /buergergeld/, /bürgergeld/, /sozialamt/, /familienkasse/])) caseGroup = "social_benefits";
    else if (v17Has(currentContext, [/finanzamt/, /steuer/])) caseGroup = "tax_office";
    else if (v17Has(currentContext, [/arbeitgeber/, /lohn/, /ruckzahlung/, /rückzahlung/, /schuldanerkenntnis/])) caseGroup = "employment";
    else if (v17Has(currentContext, [/vermieter/, /miete/, /wohnung/])) caseGroup = "housing";

    const metaEmail = cleanText(meta.email_adresse || "");
    const allContextEmails = Array.from(new Set((currentContext.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((x) => x.toLowerCase())));
    const v17ChooseBestEmail = (text = "", emails = []) => {
      if (!emails.length) return "";
      const lines = String(text || "").split(/\r?\n/);
      let best = "";
      let bestScore = -999;
      for (const email of emails) {
        const emailLower = email.toLowerCase();
        const generic = /^(info|kontakt|contact|office|service|support|hello|mail|post|admin|team)@/.test(emailLower);
        let score = generic ? 0 : 2;
        lines.forEach((line) => {
          const l = String(line || "").toLowerCase();
          if (!l.includes(emailLower)) return;
          if (/ansprechpartner|sachbearbeitung|mahnung|forderung|kontakt|zustandig|zuständig/.test(l)) score += 8;
          if (/inkasso|aktenzeichen|kassenzeichen|rechnungsnummer|kundennummer/.test(l)) score += 4;
        });
        if (!generic) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = email;
        }
      }
      return best || emails[0];
    };
    const emailInTextMatch = v17ChooseBestEmail(currentContext, allContextEmails);
    const senderCandidate = cleanText(
      meta.absender ||
      meta.absender_name ||
      meta.stelle ||
      meta.empfaenger ||
      meta.firma ||
      meta.sender ||
      ""
    );

    let targetParty = "";
    if (answerType === "draft_email" && metaEmail) targetParty = metaEmail;
    else if (emailInTextMatch) targetParty = emailInTextMatch;
    else if (userGoal === "installment_request") targetParty = senderCandidate || "Stelle aus dem Brief";
    else if (userGoal === "reimbursement_request") targetParty = "Krankenkasse / Versicherung";
    else if (userGoal === "cancellation_request") targetParty = senderCandidate || "Vertragspartner / Firma aus dem Brief";
    else if (userGoal === "legal_aid_request") targetParty = "Amtsgericht / Rechtsantragstelle oder Anwalt";

    if (!targetParty && answerType === "draft_email") {
      targetParty = "[E-Mail-Adresse der Stelle einfügen]";
    }
    if (!targetParty && answerType === "draft_pdf") {
      answerType = "clarification";
    }

    const forbidReimbursementTemplate = (
      userGoal === "installment_request" ||
      caseGroup === "court_police" ||
      caseGroup === "debt_collection" ||
      caseGroup === "banking" ||
      caseGroup === "tax_office"
    );
    const forbidInstallmentTemplate = userGoal === "reimbursement_request";
    const contractOnlyCancellation = caseGroup === "contracts" && userGoal !== "reimbursement_request";
    const cautiousDebtPhrase = caseGroup === "debt_collection";
    const cautiousCourtPhrase = caseGroup === "court_police";

    if ((answerType === "draft_email" || answerType === "draft_pdf") && contractOnlyCancellation && userGoal !== "cancellation_request") {
      answerType = "clarification";
    }

    const twoRatesRequested = v17Has(currentQuestion, [/zwei raten/, /iki taksit/]);
    const refCandidates = [
      meta.mahnungsnummer,
      meta.aktenzeichen,
      meta.kassenzeichen,
      meta.rechnungsnummer,
      meta.kundennummer,
      meta.referenz,
      meta.nummer
    ].map((x) => cleanText(x || "")).filter(Boolean);
    const refMatch = currentContext.match(/\b(Mahnungsnummer|Aktenzeichen|Kassenzeichen|Rechnungsnummer|Kundennummer)\s*[:\-]?\s*([A-Z0-9\-\/.]{3,})/i);
    const cleanRef = refCandidates[0] || cleanText(refMatch && refMatch[2] ? refMatch[2] : "");
    const subjectRef = cleanRef ? ` – ${cleanRef}` : "";
    const salutation = "Sehr geehrte Damen und Herren,";
    const uncertainClaim = userGoal === "dispute_or_objection" || /unsicher|unklar|zweifel|bestreit|widerspruch|einspruch|itiraz/.test(currentQuestion);
    const debtNoAck = (cautiousDebtPhrase || uncertainClaim) ? "Ohne Anerkennung einer Rechtspflicht.\n\n" : "";
    const noGuiltCourt = cautiousCourtPhrase ? "Dies stellt kein Schuldeingeständnis dar.\n\n" : "";
    let signatureName = cleanText(
      meta.name ||
      meta.vollname ||
      meta.absender_name ||
      meta.person_name ||
      meta.user_name ||
      meta.unterschrift ||
      ""
    );
    if (pendingName) signatureName = pendingName;
    if (!signatureName && saysNameInLetter && briefNameMatch) signatureName = briefNameMatch;
    if (!signatureName && saysNameInLetter) {
      return res.json({
        ok: true,
        antwort: cleanText(userLang === "tr"
          ? "İsmi güvenli şekilde bulamıyorum. Lütfen adı bir kez kısa yaz."
          : "Ich finde den Namen nicht sicher. Bitte schreib den Namen einmal kurz.")
      });
    }

    let draftBody = "";
    if (userGoal === "installment_request" || userGoal === "deferral_request") {
      const fixedRateText = "Ich kann den Betrag derzeit nicht auf einmal bezahlen. Deshalb bitte ich darum, den Betrag in zwei Raten zahlen zu dürfen.";
      const fixedRateConfirm = "Bitte teilen Sie mir schriftlich mit, ob Sie damit einverstanden sind und zu welchen Terminen ich die Raten überweisen soll.";
      draftBody = `${debtNoAck}${noGuiltCourt}${fixedRateText}\n${fixedRateConfirm}`;
    } else if (userGoal === "reimbursement_request") {
      draftBody = `${debtNoAck}${noGuiltCourt}ich bitte um Prüfung einer Erstattung/Kostenübernahme.\nIch habe die Kosten bereits bezahlt und reiche die Nachweise ein.\nBitte teilen Sie mir schriftlich mit, ob und in welcher Höhe eine Erstattung möglich ist.`;
    } else if (userGoal === "cancellation_request") {
      draftBody = `${debtNoAck}${noGuiltCourt}hiermit erkläre ich den Widerruf, hilfsweise die Kündigung des Vertrags.\nBitte stoppen Sie weitere Abbuchungen und bestätigen Sie mir die Vertragsbeendigung schriftlich.`;
    } else if (userGoal === "legal_aid_request") {
      draftBody = `${noGuiltCourt}ich bitte um Information zur Beratungshilfe bzw. zur Möglichkeit einer anwaltlichen Unterstützung.\nBitte teilen Sie mir mit, welche Unterlagen ich einreichen soll.`;
    } else if (userGoal === "submit_documents") {
      draftBody = `anbei reiche ich die angeforderten Unterlagen/Nachweise ein.\nBitte bestätigen Sie mir den Eingang schriftlich.`;
    } else if (userGoal === "payment_proof") {
      draftBody = `${debtNoAck}${noGuiltCourt}ich habe bereits gezahlt und sende den Zahlungsnachweis.\nBitte prüfen Sie die Zuordnung und bestätigen Sie mir den Ausgleich schriftlich.`;
    } else if (userGoal === "dispute_or_objection") {
      draftBody = `${debtNoAck}${noGuiltCourt}ich widerspreche der Forderung in der vorliegenden Form und bitte um schriftliche Klärung.\nBitte senden Sie mir eine nachvollziehbare Begründung und die zugehörigen Nachweise.`;
    } else {
      draftBody = "bitte teilen Sie mir schriftlich mit, welche nächsten Schritte erforderlich sind.";
    }

    if ((answerType === "draft_email" || answerType === "draft_pdf") && forbidReimbursementTemplate && userGoal === "reimbursement_request") {
      answerType = "clarification";
    }
    if ((answerType === "draft_email" || answerType === "draft_pdf") && forbidInstallmentTemplate && userGoal === "installment_request") {
      answerType = "clarification";
    }

    if (correctionDetected) {
      return res.json({
        ok: true,
        antwort: cleanText("Verstanden, danke für die Korrektur. Ich berücksichtige das ab jetzt.")
      });
    }

    if (answerType === "clarification") {
      return res.json({
        ok: true,
        antwort: cleanText("An wen soll die Antwort genau gehen: an die Stelle aus dem Brief oder an eine andere Stelle?")
      });
    }

    if (answerType === "checklist") {
      const checklist = [
        "Brief/Schreiben",
        cleanRef ? `Aktenzeichen/Nummer: ${cleanRef}` : "Aktenzeichen/Nummer",
        "Ausweis",
        "relevante Nachweise/Belege",
        "Zahlungsnachweis (falls vorhanden)"
      ];
      return res.json({
        ok: true,
        antwort: cleanText(`Checkliste:\n${checklist.map((x) => `☐ ${x}`).join("\n")}`)
      });
    }

    if (answerType === "next_steps") {
      return res.json({
        ok: true,
        antwort: cleanText("Nächste Schritte: 1) Frist und Aktenzeichen prüfen, 2) zuständige Stelle schriftlich kontaktieren, 3) Nachweise beilegen, 4) schriftliche Antwort aufbewahren.")
      });
    }

    if (answerType === "draft_email") {
      if (!signatureName) {
        return res.json({
          ok: true,
          antwort: cleanText(userLang === "tr" ? "İmza için sadece ismi yazman gerekiyor." : "Ich brauche nur noch den Namen für die Unterschrift.")
        });
      }
      const emailSubject = userGoal === "installment_request" || userGoal === "deferral_request"
        ? `Bitte um Ratenzahlung in zwei Raten – Ihr Schreiben${subjectRef}`
        : `Anliegen zu Ihrem Schreiben${subjectRef}`;
      const emailDraft = cleanText(
        `Empfänger: ${targetParty}\n` +
        `Betreff: ${emailSubject}\n\n` +
        `${salutation}\n\n` +
        `${draftBody}\n\n` +
        `Mit freundlichen Grüßen\n${signatureName}`
      );
      return res.json({ ok: true, antwort: emailDraft });
    }

    if (answerType === "draft_pdf") {
      if (!signatureName) {
        return res.json({
          ok: true,
          antwort: cleanText(userLang === "tr" ? "İmza için sadece ismi yazman gerekiyor." : "Ich brauche nur noch den Namen für die Unterschrift.")
        });
      }
      const pdfDraft = cleanText(
        `PDF-BRIEF:\n\n` +
        `${salutation}\n\n` +
        `${draftBody}\n\n` +
        `Mit freundlichen Grüßen\n${signatureName}`
      );
      return res.json({ ok: true, antwort: pdfDraft });
    }

    if (answerType === "short_answer") {
      const short = userGoal === "installment_request"
        ? "Du kannst um Ratenzahlung bitten. Formuliere kurz, dass du aktuell nicht auf einmal zahlen kannst und um schriftliche Bestätigung bittest."
        : userGoal === "reimbursement_request"
          ? "Du kannst Erstattung/Kostenübernahme bei Krankenkasse oder Versicherung prüfen lassen. Reiche Rechnung und Zahlungsnachweis mit ein."
          : userGoal === "payment_proof"
            ? "Nicht doppelt zahlen. Sende den Zahlungsnachweis und bitte um schriftliche Zuordnungsbestätigung."
            : "Kurz gesagt: kläre die zuständige Stelle schriftlich und lasse dir die nächsten Schritte bestätigen.";
      return res.json({ ok: true, antwort: cleanText(short) });
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
  console.log("Server läuft auf Port " + PORT + " | Hilfe24 v16.1 case routing");
});


// ===============================
// V15.0.2 FINAL ROUTER OVERRIDE
// Reason: an older buildForcedChatAnswer definition later in the file overrode the V15 router.
// This final definition must stay at the very end so the assistant-analysis/template-guard router wins.
// ===============================
function isPureFormatChoiceV1502(text = "") {
  const q = normalizeString(text).toLowerCase();
  return /^(pdf|pdf brief|pdf-brief|brief|e-?mail|email|mail|beides|both|1|2|3|pdf hazırla|pdf hazirla|almanca pdf|almanca e-?mail)$/.test(q);
}

function hasLegalAidHistoryV1502(historyText = "", context = "") {
  const t = `${historyText || ""}\n${context || ""}`;
  return hasCourtCriminalCue(t) && (hasLegalAidCue(t) || /beratungshilfe|pflichtverteidiger|rechtsantragstelle|bürgergeld|buergergeld|jobcenter|avukat/i.test(t));
}

function hasInsuranceContractHistoryV1502(historyText = "", context = "") {
  const t = `${historyText || ""}\n${context || ""}`;
  return hasInsuranceContractCue(t) || /(finanz-schutzbrief|finanzschutzbrief|versicherungsschein|versicherungsscheinnummer|kreditanfrage|kredit.*nicht|kredi.*olmad|sigorta.*cik|sigorta.*çık|sepa-lastschrift|mandatsreferenz)/i.test(t);
}

function buildContractPdfOutputV1502(meta = {}, context = "") {
  return buildPdfOnlyOutput(meta, context, "vertrag_versicherung", "cancel");
}

function buildContractEmailOutputV1502(meta = {}, context = "") {
  return buildProfessionalOutput(meta, context, "vertrag_versicherung", "cancel");
}

function buildForcedChatAnswer_LEGACY_3({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const context = buildContext(meta, briefText, kurz, details, frage, historyText);
  const analysis = buildHilfe24AnalysisV15({ frage, frageMode, meta, briefText, kurz, details, historyText });
  const outputChoice = isAnsweringOutputChoice(frage, historyText);
  const intent = outputChoice ? inferIntentFromHistory(historyText || context) : detectCoreIntent(frage, frageMode);
  const wantsPdf = outputChoice === "pdf" || (!outputChoice && wantsPdfOutput(frage, frageMode));
  const wantsEmail = outputChoice === "email" || (!outputChoice && wantsEmailOutput(frage, frageMode));
  const wantsBoth = outputChoice === "both" || (!outputChoice && wantsBothEmailAndPdf(frage, frageMode));
  const explicitWrite = isExplicitWriteRequest(frage, frageMode) || Boolean(outputChoice) || /dilekçe|dilekce|mektup|brief|schreib|formuliere|hazırla|hazirla/i.test(String(frage || ""));
  const pureFormatChoice = isPureFormatChoiceV1502(frage);
  const legalAidContext = analysis.caseType === "court_legal_aid" || hasLegalAidHistoryV1502(historyText, context);
  const insuranceContractContext = analysis.caseType === "insurance_contract" || hasInsuranceContractHistoryV1502(historyText, context);

  if (intent === "smalltalk") return "Gerne. Schreib deine nächste Frage.";

  // 1) HIGH-RISK COURT/LAWYER/LEGAL-AID ROUTE WINS OVER EVERY OLD TEMPLATE.
  if (legalAidContext) {
    const directDraft = wantsPdf || wantsEmail || wantsBoth || (pureFormatChoice && /pdf|brief|mail|email|beides|both/i.test(String(frage || "")));
    const asksForGuide = analysis.wantsGuidance || hasGuidanceCue(frage) || /avukat|anwalt|beratungshilfe|pflichtverteidiger|jobcenter|bürgergeld|buergergeld/i.test(String(frage || ""));

    if (directDraft) {
      if (wantsBoth) {
        const email = buildLegalAidPdfOutputV15(meta, context).replace(/^PDF-BRIEF:\s*/i, "");
        return cleanText(`E-MAIL:\n\nEmpfänger: Amtsgericht / Rechtsantragstelle\n\n${email}\n\nPDF-BRIEF:\n\n${email}`);
      }
      if (wantsEmail && !wantsPdf) {
        const email = buildLegalAidPdfOutputV15(meta, context).replace(/^PDF-BRIEF:\s*/i, "");
        return cleanText(`Empfänger: Amtsgericht / Rechtsantragstelle\n\n${email}`);
      }
      return buildLegalAidPdfOutputV15(meta, context);
    }

    // If the user asks for help/step-by-step, answer as assistant first, not as generator.
    if (asksForGuide || !explicitWrite) return buildLegalAidChecklistAnswerV15(meta, context, analysis.userLanguage);

    // If the user asks vaguely to write but no format is clear, keep it safe.
    return cleanText(`${buildLegalAidChecklistAnswerV15(meta, context, analysis.userLanguage)}\n\nWenn du möchtest, schreibe ich dir daraus danach einen deutschen PDF-Brief an das Amtsgericht / die Rechtsantragstelle.`);
  }

  // 2) INSURANCE-AS-CONTRACT ROUTE. NEVER USE HEALTH-INSURANCE/REIMBURSEMENT HERE.
  if (insuranceContractContext) {
    const currentIntent = inferCurrentWriteIntentFromUserQuestion(frage, frageMode);
    const asksCancelOrWrite = explicitWrite || wantsPdf || wantsEmail || wantsBoth || /widerruf|kündig|kuendig|kündigung|kuendigung|iptal|fesih|vertrag|sözleşme|sozlesme|dilekçe|dilekce|brief|mektup|hazırla|hazirla/i.test(String(frage || ""));

    if (wantsBoth) return buildEmailAndPdfOutput(meta, context, "vertrag_versicherung", "cancel");
    if (wantsPdf || (asksCancelOrWrite && /pdf|brief|mektup|dilekçe|dilekce/i.test(String(frage || "")))) return buildContractPdfOutputV1502(meta, context);
    if (wantsEmail || (asksCancelOrWrite && /e-?mail|mail/i.test(String(frage || "")))) return buildContractEmailOutputV1502(meta, context);

    if (asksCancelOrWrite && (currentIntent === "cancel" || /kredi|kredit|nicht bekommen|olmad|sigorta|versicherung/i.test(String(frage || "")))) {
      return buildContractPdfOutputV1502(meta, context);
    }

    return buildInsuranceContractGuidanceV15(meta, context, analysis.userLanguage);
  }

  // 3) GENERAL GUIDANCE: checklist before draft when user asks for a plan.
  if (analysis.wantsGuidance && !explicitWrite) {
    const lines = [];
    lines.push("Ich mache dir zuerst einen einfachen Leitfaden.");
    lines.push("");
    lines.push("Checkliste:");
    const docs = analysis.requiredDocuments && analysis.requiredDocuments.length ? analysis.requiredDocuments : ["aktuelles Schreiben", "Nummer/Aktenzeichen", "Nachweise", "Ausweis falls Termin bei einer Stelle nötig ist"];
    docs.slice(0, 6).forEach((d, i) => lines.push(`☐ ${i + 1}. ${d}`));
    lines.push("");
    if (analysis.possibleRights && analysis.possibleRights.length) lines.push(`Möglich zu prüfen: ${analysis.possibleRights.join(", ")}.`);
    if (analysis.targetParty) lines.push(`Zuständige Stelle wahrscheinlich: ${analysis.targetParty}.`);
    if (analysis.deadline) lines.push(`Wichtig: Frist/Termin beachten: ${analysis.deadline}.`);
    lines.push("Die zuständige Stelle entscheidet. Ich kann dir den sicheren nächsten Schritt formulieren, aber keine Garantie geben.");
    lines.push("");
    lines.push("Wenn du möchtest, erstelle ich dir danach eine E-Mail oder einen PDF-Brief.");
    return cleanText(lines.join("\n"));
  }

  // 4) NORMAL WRITE MODE WITH TEMPLATE GUARD.
  const rememberedWriteIntent = inferIntentFromHistory(historyText || context);
  let currentWriteIntent = inferCurrentWriteIntentFromUserQuestion(frage, frageMode);
  const costCarrierWriteNow = currentWriteIntent === "reimbursement";
  let effectiveWriteIntent = currentWriteIntent
    || ((intent === "erstattung_kostenuebernahme" || intent === "reimbursement" || costCarrierWriteNow) ? "reimbursement" : rememberedWriteIntent);

  // Never allow reimbursement if this analysis forbids that template.
  if ((effectiveWriteIntent === "reimbursement" || effectiveWriteIntent === "erstattung_kostenuebernahme")
      && Array.isArray(analysis.forbiddenTemplates)
      && (analysis.forbiddenTemplates.includes("krankenkasse_reimbursement") || analysis.forbiddenTemplates.includes("insurance_reimbursement"))) {
    if (analysis.caseType === "insurance_contract") return buildInsuranceContractGuidanceV15(meta, context, analysis.userLanguage);
    if (analysis.caseType === "court_legal_aid") return buildLegalAidChecklistAnswerV15(meta, context, analysis.userLanguage);
    return "Das wäre hier wahrscheinlich die falsche Vorlage. Ich brauche zuerst die richtige Zielstelle: Soll es an den Absender aus dem Brief gehen oder an eine andere Stelle?";
  }

  const domain = detectDomain(context);
  if (wantsBoth) return buildEmailAndPdfOutput(meta, context, domain, effectiveWriteIntent);
  if (wantsPdf && !wantsEmail) return buildPdfOnlyOutput(meta, context, domain, effectiveWriteIntent);
  if (wantsEmail && !wantsPdf) return buildProfessionalOutput(meta, context, domain, effectiveWriteIntent);
  if (intent === "schreibwunsch" || (explicitWrite && !wantsPdf && !wantsEmail)) return askOutputChoice(effectiveWriteIntent || "reply");

  return "";
}

// ===============================
// V15.0.3 FINAL CASE ISOLATION + PDF CLEAN FIX
// Reason:
// 1) Old legal-aid history could bleed into a new insurance/contract case.
// 2) Legal-aid PDF sender block could contain explanatory/chat text.
// This final override keeps current document context stronger than old chat history.
// ===============================
function currentCaseContextV1503(meta = {}, briefText = "", kurz = "", details = "", frage = "") {
  return buildContext(meta, briefText, kurz, details, frage, "");
}

function isCurrentInsuranceContractCaseV1503(meta = {}, currentContext = "") {
  const t = `${JSON.stringify(meta || {})}\n${currentContext || ""}`;
  return hasInsuranceContractCue(t) || /(finanz-schutzbrief|finanzschutzbrief|versicherungsschein|versicherungsscheinnummer|kreditanfrage|kredit.*nicht|kredi.*olmad|sigorta.*cik|sigorta.*çık|sepa-lastschrift|mandatsreferenz|würzburger\s+versicher)/i.test(t);
}

function isCurrentCourtLegalAidCaseV1503(meta = {}, currentContext = "", frage = "") {
  const t = `${JSON.stringify(meta || {})}\n${currentContext || ""}`;
  const q = String(frage || "");
  return (hasCourtCriminalCue(t) && (hasLegalAidCue(t) || hasLegalAidCue(q) || /beratungshilfe|pflichtverteidiger|rechtsantragstelle|bürgergeld|buergergeld|jobcenter|avukat/i.test(`${t}\n${q}`)))
    || /(amtsgericht|jugendschöffengericht|straf(?:sache|verfahren)|hauptverhandlung|anklage|geschäftsnummer).*?(anwalt|avukat|beratungshilfe|pflichtverteidiger|jobcenter|bürgergeld|buergergeld)/i.test(`${t}\n${q}`);
}

function cleanPostalAddressLinesV1503(block = "") {
  const lines = String(block || "")
    .split(/\n+/)
    .map(l => normalizeString(l))
    .filter(Boolean)
    .filter(l => !/^(ilgili\s+kişi|ilgili kisi|yazıdaki tarih|yazidaki tarih|süre|sure|frist|tarih|termin|duruşma|durusma|salonu|önemli|onemli|kurz erklärt|kısaca|kisaca|betreff|sehr geehrte|pdf-brief)/i.test(l));
  const keep = [];
  for (const l of lines) {
    if (/\b(str\.?|straße|strasse|weg|platz|allee|gasse|ring|damm|ufer)\b/i.test(l) || /\b\d{5}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+/.test(l) || /^\[Adresse bitte prüfen\/eintragen\]$/i.test(l)) keep.push(l);
  }
  return keep.slice(0, 3).join("\n");
}

function buildStrictSenderAddressV1503(meta = {}, context = "") {
  const name = safeSignatureForDraft(meta, context);
  let addr = "";
  if (name && !/^\[/.test(name)) {
    const after = findAddressBlockAfterLine(context, name);
    if (addressLooksLikePersonAddress(after, name, getSender(meta))) addr = cleanPostalAddressLinesV1503(after);
  }
  if (!addr) {
    const candidates = [meta.user_adresse, meta.adresse, meta.empfaenger_adresse]
      .map(x => cleanPostalAddressLinesV1503(normalizePostalAddress(x)))
      .filter(Boolean);
    addr = candidates[0] || "[Adresse bitte prüfen/eintragen]";
  }
  return `${name || "[Name bitte prüfen/eintragen]"}\n${addr}`;
}

function buildLegalAidPdfOutputV15(meta = {}, context = "") {
  const senderAddress = buildStrictSenderAddressV1503(meta, context);
  const recipient = getLegalAidRecipientAddress(meta, context);
  const date = getTodayGerman();
  const city = getCityFromPostalAddress(senderAddress);
  const placeLine = city ? `${city}, ${date}` : `[Ort], ${date}`;
  const ref = getPrimaryReference(meta);
  const subject = ref
    ? `Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe – ${formatReferenceForSubject(ref, "gericht") || ref}`
    : "Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe";
  const name = safeSignatureForDraft(meta, context);
  const body = `Sehr geehrte Damen und Herren,

ich bitte um Hilfe, weil ich mir einen Rechtsanwalt finanziell nicht leisten kann.

${ref ? `Ich beziehe mich auf das Verfahren mit dem Aktenzeichen ${cleanReferenceLabel(ref) || ref}.` : "Ich beziehe mich auf das aktuelle gerichtliche Schreiben."}

Ich beziehe Bürgergeld bzw. habe nur geringe finanzielle Mittel. Deshalb bitte ich um Mitteilung, wie ich Beratungshilfe beantragen kann.

Bitte teilen Sie mir außerdem mit, ob in diesem Verfahren die Beiordnung eines Pflichtverteidigers in Betracht kommt oder welche Schritte dafür erforderlich sind.

Den Bürgergeld-/Jobcenter-Bescheid, meinen Ausweis und das gerichtliche Schreiben kann ich vorlegen.

Bitte bestätigen Sie mir den Eingang dieses Schreibens und teilen Sie mir schriftlich mit, was ich als Nächstes tun muss.

Mit freundlichen Grüßen

${name}`;
  return cleanText(`PDF-BRIEF:

${senderAddress}

${recipient}

${placeLine}

Betreff: ${subject}

${body}`);
}

function buildForcedChatAnswer_LEGACY_4({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const currentContext = currentCaseContextV1503(meta, briefText, kurz, details, frage);
  const fullContext = buildContext(meta, briefText, kurz, details, frage, historyText);
  const analysis = buildHilfe24AnalysisV15({ frage, frageMode, meta, briefText, kurz, details, historyText: "" });
  const outputChoice = isAnsweringOutputChoice(frage, historyText);
  const intent = outputChoice ? inferIntentFromHistory(historyText || fullContext) : detectCoreIntent(frage, frageMode);
  const wantsPdf = outputChoice === "pdf" || (!outputChoice && wantsPdfOutput(frage, frageMode));
  const wantsEmail = outputChoice === "email" || (!outputChoice && wantsEmailOutput(frage, frageMode));
  const wantsBoth = outputChoice === "both" || (!outputChoice && wantsBothEmailAndPdf(frage, frageMode));
  const explicitWrite = isExplicitWriteRequest(frage, frageMode) || Boolean(outputChoice) || /dilekçe|dilekce|mektup|brief|schreib|formuliere|hazırla|hazirla/i.test(String(frage || ""));
  const pureFormatChoice = isPureFormatChoiceV1502(frage);

  const currentInsuranceContract = isCurrentInsuranceContractCaseV1503(meta, currentContext);
  const currentLegalAid = isCurrentCourtLegalAidCaseV1503(meta, currentContext, frage);
  const followUpLegalAid = !currentInsuranceContract && (analysis.caseType === "court_legal_aid" || hasLegalAidHistoryV1502(historyText, currentContext));
  const legalAidContext = currentLegalAid || (pureFormatChoice && followUpLegalAid);
  const insuranceContractContext = currentInsuranceContract || (!legalAidContext && (analysis.caseType === "insurance_contract" || hasInsuranceContractHistoryV1502(historyText, currentContext)));

  if (intent === "smalltalk") return "Gerne. Schreib deine nächste Frage.";

  // Current insurance/contract case wins over old legal-aid chat history.
  if (insuranceContractContext && !currentLegalAid) {
    const currentIntent = inferCurrentWriteIntentFromUserQuestion(frage, frageMode);
    const asksCancelOrWrite = explicitWrite || wantsPdf || wantsEmail || wantsBoth || /widerruf|kündig|kuendig|kündigung|kuendigung|iptal|fesih|vertrag|sözleşme|sozlesme|dilekçe|dilekce|brief|mektup|hazırla|hazirla/i.test(String(frage || ""));

    if (wantsBoth) return buildEmailAndPdfOutput(meta, currentContext, "vertrag_versicherung", "cancel");
    if (wantsPdf || (asksCancelOrWrite && /pdf|brief|mektup|dilekçe|dilekce/i.test(String(frage || "")))) return buildContractPdfOutputV1502(meta, currentContext);
    if (wantsEmail || (asksCancelOrWrite && /e-?mail|mail/i.test(String(frage || "")))) return buildContractEmailOutputV1502(meta, currentContext);
    if (asksCancelOrWrite && (currentIntent === "cancel" || /kredi|kredit|nicht bekommen|olmad|sigorta|versicherung/i.test(String(frage || "")))) return buildContractPdfOutputV1502(meta, currentContext);
    return buildInsuranceContractGuidanceV15(meta, currentContext, analysis.userLanguage);
  }

  if (legalAidContext) {
    const directDraft = wantsPdf || wantsEmail || wantsBoth || (pureFormatChoice && /pdf|brief|mail|email|beides|both/i.test(String(frage || "")));
    const asksForGuide = analysis.wantsGuidance || hasGuidanceCue(frage) || /avukat|anwalt|beratungshilfe|pflichtverteidiger|jobcenter|bürgergeld|buergergeld/i.test(String(frage || ""));

    if (directDraft) {
      const pdf = buildLegalAidPdfOutputV15(meta, currentContext);
      if (wantsBoth) {
        const email = pdf.replace(/^PDF-BRIEF:\s*/i, "");
        return cleanText(`E-MAIL:\n\nEmpfänger: Amtsgericht / Rechtsantragstelle\n\n${email}\n\nPDF-BRIEF:\n\n${email}`);
      }
      if (wantsEmail && !wantsPdf) {
        const email = pdf.replace(/^PDF-BRIEF:\s*/i, "");
        return cleanText(`Empfänger: Amtsgericht / Rechtsantragstelle\n\n${email}`);
      }
      return pdf;
    }

    if (asksForGuide || !explicitWrite) return buildLegalAidChecklistAnswerV15(meta, currentContext, analysis.userLanguage);
    return cleanText(`${buildLegalAidChecklistAnswerV15(meta, currentContext, analysis.userLanguage)}\n\nWenn du möchtest, schreibe ich dir daraus danach einen deutschen PDF-Brief an das Amtsgericht / die Rechtsantragstelle.`);
  }

  if (analysis.wantsGuidance && !explicitWrite) {
    const lines = [];
    lines.push("Ich mache dir zuerst einen einfachen Leitfaden.");
    lines.push("");
    lines.push("Checkliste:");
    const docs = analysis.requiredDocuments && analysis.requiredDocuments.length ? analysis.requiredDocuments : ["aktuelles Schreiben", "Nummer/Aktenzeichen", "Nachweise", "Ausweis falls Termin bei einer Stelle nötig ist"];
    docs.slice(0, 6).forEach((d, i) => lines.push(`☐ ${i + 1}. ${d}`));
    lines.push("");
    if (analysis.possibleRights && analysis.possibleRights.length) lines.push(`Möglich zu prüfen: ${analysis.possibleRights.join(", ")}.`);
    if (analysis.targetParty) lines.push(`Zuständige Stelle wahrscheinlich: ${analysis.targetParty}.`);
    if (analysis.deadline) lines.push(`Wichtig: Frist/Termin beachten: ${analysis.deadline}.`);
    lines.push("Die zuständige Stelle entscheidet. Ich kann dir den sicheren nächsten Schritt formulieren, aber keine Garantie geben.");
    lines.push("");
    lines.push("Wenn du möchtest, erstelle ich dir danach eine E-Mail oder einen PDF-Brief.");
    return cleanText(lines.join("\n"));
  }

  const rememberedWriteIntent = inferIntentFromHistory(historyText || fullContext);
  let currentWriteIntent = inferCurrentWriteIntentFromUserQuestion(frage, frageMode);
  let effectiveWriteIntent = currentWriteIntent || ((intent === "erstattung_kostenuebernahme" || intent === "reimbursement") ? "reimbursement" : rememberedWriteIntent);

  if ((effectiveWriteIntent === "reimbursement" || effectiveWriteIntent === "erstattung_kostenuebernahme")
      && Array.isArray(analysis.forbiddenTemplates)
      && (analysis.forbiddenTemplates.includes("krankenkasse_reimbursement") || analysis.forbiddenTemplates.includes("insurance_reimbursement"))) {
    if (analysis.caseType === "insurance_contract") return buildInsuranceContractGuidanceV15(meta, currentContext, analysis.userLanguage);
    if (analysis.caseType === "court_legal_aid") return buildLegalAidChecklistAnswerV15(meta, currentContext, analysis.userLanguage);
    return "Das wäre hier wahrscheinlich die falsche Vorlage. Ich brauche zuerst die richtige Zielstelle: Soll es an den Absender aus dem Brief gehen oder an eine andere Stelle?";
  }

  const domain = detectDomain(currentContext);
  if (wantsBoth) return buildEmailAndPdfOutput(meta, currentContext, domain, effectiveWriteIntent);
  if (wantsPdf && !wantsEmail) return buildPdfOnlyOutput(meta, currentContext, domain, effectiveWriteIntent);
  if (wantsEmail && !wantsPdf) return buildProfessionalOutput(meta, currentContext, domain, effectiveWriteIntent);
  if (intent === "schreibwunsch" || (explicitWrite && !wantsPdf && !wantsEmail)) return askOutputChoice(effectiveWriteIntent || "reply");

  return "";
}

// ===============================
// V15.0.4 PDF PURE TEMPLATE FIX
// Reason:
// - PDF drafts must contain only official German draft text, never Turkish explanation/unclear notes.
// - Legal-aid sender address must never become the court address.
// - Insurance-contract PDF must be a clean contract/widerruf draft, not generated from mixed explanation context.
// ===============================
function isInstitutionAddressLineV1504(line = "") {
  return /(amtsgericht|rechtsantragstelle|staatsanwaltschaft|gericht|jobcenter|dzr|versicherung|krankenkasse|pflegekasse|inkasso|beitragsservice|finanzamt|polizei|jugendamt|sozialamt|agentur\s+für\s+arbeit)/i.test(String(line || ""));
}

function normalizeDraftAddressBlockV1504(block = "") {
  const lines = String(block || "")
    .split(/\n+/)
    .map(l => normalizeString(l))
    .filter(Boolean)
    .filter(l => !/^(pdf-brief|e-mail|empfänger|empfaenger|betreff|sehr geehrte|mit freundlichen|ilgili|kısaca|kisaca|net olmayan|önemli|onemli|frist|termin|tarih|süre|sure|banka|krankentagegeld)/i.test(l));
  return lines.slice(0, 4).join("\n");
}

function extractPersonAddressFromContextV1504(name = "", context = "") {
  const t = String(context || "");
  const cleanName = normalizeString(name || "");
  if (!cleanName || /^\[/.test(cleanName)) return "";

  const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\n([\\s\\S]{0,180})`, "i");
  const m = t.match(re);
  if (m) {
    const candidate = normalizeDraftAddressBlockV1504(m[1]);
    const lines = candidate.split(/\n+/).filter(Boolean);
    const hasStreet = lines.some(l => /\b(str\.?|straße|strasse|weg|platz|allee|gasse|ring|damm|ufer)\b/i.test(l));
    const hasZip = lines.some(l => /\b\d{5}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+/.test(l));
    const hasInstitution = lines.some(isInstitutionAddressLineV1504);
    const hasCourtAddress = lines.some(l => /am\s+lindenhaus|32657\s+lemgo|bahnhofstraße\s+11|97070\s+würzburg/i.test(l));
    if (hasStreet && hasZip && !hasInstitution && !hasCourtAddress) return lines.slice(0, 3).join("\n");
  }

  // Fallback: find a normal private address near common person names, but reject institution addresses.
  const privateBlock = t.match(/(?:^|\n)([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+){1,4})\s*\n([^\n]*(?:str\.?|straße|strasse|weg|platz|allee|gasse|ring|damm|ufer)[^\n]*)\s*\n(\d{5}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+)/i);
  if (privateBlock && normalizeString(privateBlock[1]).toLowerCase().includes(cleanName.split(" ")[0].toLowerCase())) {
    const block = `${privateBlock[2]}\n${privateBlock[3]}`;
    if (!/am\s+lindenhaus|32657\s+lemgo|bahnhofstraße\s+11|97070\s+würzburg/i.test(block)) return block;
  }
  return "";
}

function getSafeSenderBlockV1504(meta = {}, context = "") {
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  let addr = extractPersonAddressFromContextV1504(name, context);

  if (!addr) {
    const rawCandidates = [
      meta.user_adresse,
      meta.adresse,
      meta.empfaenger_adresse,
      meta.anschrift,
      meta.betroffene_person_adresse
    ];
    for (const raw of rawCandidates) {
      const c = normalizeDraftAddressBlockV1504(normalizePostalAddress(raw));
      if (!c) continue;
      const bad = /am\s+lindenhaus|32657\s+lemgo|bahnhofstraße\s+11|97070\s+würzburg|amtsgericht|rechtsantragstelle|versicherung|krankenkasse|dzr/i.test(c);
      const looks = /\b(str\.?|straße|strasse|weg|platz|allee|gasse|ring|damm|ufer)\b/i.test(c) && /\b\d{5}\s+[A-ZÄÖÜ]/.test(c);
      if (looks && !bad) { addr = c; break; }
    }
  }

  if (!addr) addr = "[Adresse bitte prüfen/eintragen]";
  return `${name}\n${addr}`;
}

function buildLegalAidPdfOutputV15(meta = {}, context = "") {
  const senderAddress = getSafeSenderBlockV1504(meta, context);
  const recipient = cleanText(`Amtsgericht Lemgo
Rechtsantragstelle
Am Lindenhaus 2
32657 Lemgo`);
  const date = getTodayGerman();
  const city = getCityFromPostalAddress(senderAddress);
  const placeLine = city ? `${city}, ${date}` : `[Ort], ${date}`;
  const ref = getPrimaryReference(meta) || (String(context || "").match(/(?:Aktenzeichen|Geschäftsnummer)\s*[:\-]?\s*([0-9]{1,3}\s*Ls[\s\-]*[0-9]{1,3}\s*Js\s*[0-9\/\-]+)/i)?.[1] || "");
  const refClean = ref ? cleanReferenceLabel(ref) || ref : "";
  const subject = refClean
    ? `Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe – Aktenzeichen: ${refClean}`
    : "Bitte um Hilfe wegen anwaltlicher Vertretung / Beratungshilfe";
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";

  return cleanText(`PDF-BRIEF:

${senderAddress}

${recipient}

${placeLine}

Betreff: ${subject}

Sehr geehrte Damen und Herren,

ich bitte um Hilfe, weil ich mir einen Rechtsanwalt finanziell nicht leisten kann.

${refClean ? `Ich beziehe mich auf das Verfahren mit dem Aktenzeichen ${refClean}.` : "Ich beziehe mich auf das aktuelle gerichtliche Schreiben."}

Ich beziehe Bürgergeld bzw. habe nur geringe finanzielle Mittel. Deshalb bitte ich um Mitteilung, wie ich Beratungshilfe beantragen kann.

Bitte teilen Sie mir außerdem mit, ob in diesem Verfahren die Beiordnung eines Pflichtverteidigers in Betracht kommt oder welche Schritte dafür erforderlich sind.

Den Bürgergeld-/Jobcenter-Bescheid, meinen Ausweis und das gerichtliche Schreiben kann ich vorlegen.

Bitte bestätigen Sie mir den Eingang dieses Schreibens und teilen Sie mir schriftlich mit, was ich als Nächstes tun muss.

Mit freundlichen Grüßen

${name}`);
}

function getInsuranceContractRecipientV1504(meta = {}, context = "") {
  const t = `${JSON.stringify(meta || {})}\n${context || ""}`;
  if (/würzburger|wuerzburger/i.test(t)) {
    return cleanText(`Würzburger Versicherungs-AG
Bahnhofstraße 11
97070 Würzburg`);
  }
  const sender = getSender(meta) || "";
  if (/versicherung/i.test(sender)) return cleanText(`${sender}\n[Adresse bitte eintragen]`);
  return cleanText(`Versicherung / Vertragspartner
[Adresse bitte eintragen]`);
}

function getInsurancePolicyRefV1504(meta = {}, context = "") {
  const t = `${JSON.stringify(meta || {})}\n${context || ""}`;
  return (t.match(/Versicherungsscheinnummer\s*[:\-]?\s*([0-9A-Z\-\/]+)/i)?.[1]
    || t.match(/Mandatsreferenz\s*[:\-]?\s*([0-9A-Z\-\/]+)/i)?.[1]
    || getPrimaryReference(meta)
    || "").trim();
}

function buildContractPdfOutputV1502(meta = {}, context = "") {
  const senderAddress = getSafeSenderBlockV1504(meta, context);
  const recipient = getInsuranceContractRecipientV1504(meta, context);
  const date = getTodayGerman();
  const city = getCityFromPostalAddress(senderAddress) || "[Ort]";
  const policy = getInsurancePolicyRefV1504(meta, context);
  const letterDate = getDateFromMeta(meta) || (String(context || "").match(/(?:Schreiben\s+vom|Datum)\s*[:\-]?\s*(\d{2}\.\d{2}\.\d{4})/i)?.[1]) || "31.03.2026";
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  const subjectRef = policy ? ` – Versicherungsscheinnummer: ${policy}` : "";

  return cleanText(`PDF-BRIEF:

${senderAddress}

${recipient}

${city}, ${date}

Betreff: Widerruf und hilfsweise Kündigung des Finanz-Schutzbriefs${subjectRef}

Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben vom ${letterDate}${policy ? ` zur Versicherungsscheinnummer ${policy}` : ""}.

Der Vertrag ist nach meiner Kenntnis im Zusammenhang mit einer Online-Anfrage entstanden. Ich bitte um Prüfung, ob der Vertrag wirksam zustande gekommen ist.

Vorsorglich widerrufe ich den Vertrag, soweit dies noch möglich ist. Hilfsweise kündige ich den Vertrag zum nächstmöglichen Zeitpunkt.

Bitte bestätigen Sie mir schriftlich:
- den Eingang dieses Schreibens,
- ob der Vertrag widerrufen oder gekündigt wurde,
- ob noch Beiträge offen sind,
- ab wann keine weiteren Abbuchungen mehr erfolgen.

Bitte ziehen Sie bis zur Klärung keine weiteren Beträge ein. Falls bereits Beiträge eingezogen wurden und der Vertrag nicht wirksam zustande gekommen ist, bitte ich um Prüfung einer Rückerstattung.

Mit freundlichen Grüßen

${name}`);
}

function buildContractEmailOutputV1502(meta = {}, context = "") {
  const pdf = buildContractPdfOutputV1502(meta, context).replace(/^PDF-BRIEF:\s*/i, "");
  const recipient = getInsuranceContractRecipientV1504(meta, context).split(/\n/)[0];
  return cleanText(`Empfänger: ${recipient}

${pdf}`);
}

// ===============================
// V15.1 GENERAL ROUTER + TEMPLATE MATRIX
// Purpose:
// - Stop per-letter fixes. Route by user goal + target party + risk.
// - Keep guide answers short.
// - Build official drafts from pure templates only.
// - Prevent wrong template classes before PDF/E-Mail output.
// ===============================
function hasAnyV151(text = "", words = []) {
  const q = String(text || "").toLowerCase();
  return words.some(w => q.includes(String(w).toLowerCase()));
}

function normV151(text = "") {
  return normalizeForIntent ? normalizeForIntent(String(text || "")) : String(text || "").toLowerCase();
}

function contextCurrentOnlyV151(meta = {}, briefText = "", kurz = "", details = "") {
  return cleanText(`${JSON.stringify(meta || {})}\n${kurz || ""}\n${details || ""}\n${briefText || ""}`).slice(0, 16000);
}

function isGuideRequestV151(frage = "") {
  const q = normV151(frage);
  return /(schritt|leitfaden|checkliste|abhaken|was brauche ich|was muss ich|wie mache ich|wie geht|tek tek|nasil|nasıl|yol goster|yol göster|ne yapmam|adım adım|adim adim|kontrol listesi)/i.test(q);
}

function isWriteRequestV151(frage = "", mode = "") {
  return isExplicitWriteRequest(frage, mode) || wantsOfficialLetterLikeText(frage) || /(pdf|e-?mail|email|brief|mektup|dilekce|dilekçe|yaz|hazirla|hazırla|formuliere|vorlage|fertig)/i.test(normV151(frage));
}

function requestedFormatV151(frage = "", mode = "") {
  const q = normV151(`${frage} ${mode}`);
  if (/(beides|both|email.*pdf|e-?mail.*pdf|pdf.*e-?mail)/i.test(q)) return "both";
  if (/(e-?mail|email|mail|e-posta|eposta)/i.test(q)) return "email";
  if (/(pdf|brief|mektup|dilekce|dilekçe|schreiben|vorlage)/i.test(q)) return "pdf";
  return "none";
}

function detectCaseTypeGeneralV151(frage = "", context = "") {
  const q = normV151(`${frage}\n${context}`);

  if (/(gericht|amtsgericht|staatsanwaltschaft|polizei|hauptverhandlung|strafbefehl|haftbefehl|ladung|umladung|anklageschrift|straf?sache|akliye|mahkeme|savcilik|savcılık|avukat|anwalt|beratungshilfe|pflichtverteidiger|rechtsantragstelle)/i.test(q)) {
    if (/(anwalt|avukat|beratungshilfe|pflichtverteidiger|rechtsantragstelle|jobcenter|bürgergeld|buergergeld|para|bezahlen|ödeyem|odeyem)/i.test(q)) return "legal_aid";
    return "court";
  }
  if (/(finanz-?schutzbrief|versicherungsschein|versicherungsbeginn|versicherungsende|mandatsreferenz|sepa-lastschrift|kreditanfrage|kredi|wuerzburger|würzburger|vertrag.*versicherung|sigorta.*kredi)/i.test(q)) return "contract_insurance";
  if (/(dzr|zahn|zahnarzt|diş|dis|rechnung|fatura|rg-nummer|goz|bema|patientenportal)/i.test(q)) return "invoice_medical";
  if (/(inkasso|mahnung|forderung|gerichtsvollzieher|vollstreckung|mahnbescheid|borc|borç)/i.test(q)) return "debt_collection";
  if (/(jobcenter|bürgergeld|buergergeld|sozialamt|grundsicherung|bescheid|rückforderung|rueckforderung|aufrechnung)/i.test(q)) return "authority_social";
  if (/(pflegegrad|pflegekasse|pflegeversicherung|md-gutachten|medizinischer dienst|verhinderungspflege|entlastungsbetrag)/i.test(q)) return "care_insurance";
  if (/(rentenversicherung|rentenkasse|erwerbsminderung|reha|kontenklärung|kontenklaerung|versicherungsverlauf|teilhabe am arbeitsleben)/i.test(q)) return "pension_insurance";
  if (/(schwerbehindert|gdb|merkzeichen|versorgungsamt|behindertenausweis)/i.test(q)) return "disability";
  if (/(krankenkasse|krankenversicherung|hilfsmittel|zuzahlungsbefreiung|krankengeld|haushaltshilfe|fahrtkosten|rezept|verordnung)/i.test(q)) return "health_insurance";
  if (/(arbeitgeber|lohn|gehalt|abmahnung|kündigung|kuendigung|arbeitszeugnis|urlaub|schuldanerkenntnis|lohnabtretung)/i.test(q)) return "employment";
  if (/(vermieter|miete|nebenkosten|kaution|räumung|raeumung|wohnung|mietschulden)/i.test(q)) return "housing";
  if (/(finanzamt|steuer|einkommensteuer|säumniszuschlag|saeumniszuschlag|stundung|steuerbescheid)/i.test(q)) return "tax";
  if (/(rundfunkbeitrag|beitragsservice|beitragskonto)/i.test(q)) return "broadcast_fee";
  if (/(familienkasse|kindergeld|kinderzuschlag|jugendamt|unterhaltsvorschuss|schule|kita|klassenfahrt|bildung und teilhabe)/i.test(q)) return "family_school";
  if (/(p-konto|pfändung|pfaendung|kontopfändung|lohnpfändung|freibetrag|bank)/i.test(q)) return "bank_pfändung";
  if (/(ausländerbehörde|auslaenderbehoerde|aufenthalt|fiktionsbescheinigung|abschiebung|duldung)/i.test(q)) return "immigration";
  return "general";
}

function detectGoalGeneralV151(frage = "", context = "") {
  const qOnly = normV151(frage);
  const q = normV151(`${frage}\n${context}`);

  if (isGuideRequestV151(frage)) return "guidance";
  if (/(anwalt|avukat|beratungshilfe|pflichtverteidiger|rechtsanwalt|strafverteidiger)/i.test(qOnly)) return "legal_aid";
  if (/(widerruf|kündig|kuendig|kündigung|kuendigung|iptal|fesih|vertrag los|nicht abgeschlossen|nicht bewusst|kredi|kredit.*nicht|abbuchung stoppen)/i.test(qOnly)) return "contract_cancel";
  if (/(erstattung|zurückbekommen|zurueckbekommen|geld zurück|geld zuruck|kostenübernahme|kostenuebernahme|übernimmt|uebernimmt|einreichen|sigortadan|geri al|geri ödeme|geri odeme|reimbursement)/i.test(qOnly)) return "reimbursement";
  if (/(rate|ratenzahlung|taksit|taksitli|stundung|aufschub|kann.*nicht.*zahlen|kein geld|ödeyemem|odeyemem)/i.test(qOnly)) return "payment_plan";
  if (/(schon bezahlt|bereits bezahlt|habe bezahlt|überwiesen|ueberwiesen|gezahlt|dekont|zahlungsnachweis)/i.test(qOnly)) return "paid_proof";
  if (/(widerspruch|einspruch|itiraz|bestreiten|stimmt nicht|ablehnung|abgelehnt|falsch|verwechslung)/i.test(qOnly)) return "appeal_or_dispute";
  if (/(was steht mir zu|was kann ich bekommen|hilfe bekommen|zuschuss|leistung|befreiung|ermäßigung|ermaessigung|pflegegeld|wohngeld|kinderzuschlag|unterhaltsvorschuss)/i.test(qOnly)) return "benefit_check";
  if (/(welche behandlung|was wurde gemacht|worum|wofür|wofur|leistungsaufstellung|details|unklar|ne olduğu|ne oldugu)/i.test(qOnly)) return "detail_question";
  if (/(frist|bis wann|termin|deadline|süre|sure|tarih)/i.test(qOnly)) return "deadline";
  if (/(was bedeutet|erklär|erklaer|anlam|ne demek)/i.test(qOnly)) return "understand";
  if (isWriteRequestV151(frage, "")) return "write_request";
  return "answer_question";
}

const TEMPLATE_MATRIX_V151 = {
  legal_aid: {
    riskLevel: "high",
    targetParty: "Amtsgericht / Rechtsantragstelle / Anwalt",
    allowed: ["legal_aid", "public_defender", "court_clarification", "appointment_notice"],
    forbidden: ["reimbursement", "medical_detail", "payment_plan", "contract_cancel"]
  },
  court: {
    riskLevel: "high",
    targetParty: "Gericht / Staatsanwaltschaft",
    allowed: ["court_clarification", "appointment_notice", "document_request", "evidence_notice"],
    forbidden: ["reimbursement", "medical_detail", "payment_plan", "contract_cancel"]
  },
  contract_insurance: {
    riskLevel: "medium",
    targetParty: "Versicherung / Vertragspartner",
    allowed: ["contract_cancel", "contract_proof", "stop_debit", "document_request"],
    forbidden: ["reimbursement", "legal_aid", "medical_detail", "payment_plan"]
  },
  invoice_medical: {
    riskLevel: "medium",
    targetParty: "Rechnungssteller / Krankenkasse / Versicherung je nach Ziel",
    allowed: ["reimbursement", "payment_plan", "paid_proof", "medical_detail", "document_request"],
    forbidden: ["legal_aid", "contract_cancel"]
  },
  debt_collection: {
    riskLevel: "medium",
    targetParty: "Gläubiger / Inkasso / Schuldnerberatung je nach Ziel",
    allowed: ["claim_dispute", "payment_plan", "paid_proof", "document_request"],
    forbidden: ["reimbursement", "legal_aid", "contract_cancel"]
  },
  authority_social: {
    riskLevel: "medium",
    targetParty: "ausstellende Behörde / Jobcenter / Sozialamt",
    allowed: ["appeal", "document_request", "benefit_application", "clarification"],
    forbidden: ["reimbursement", "contract_cancel"]
  },
  care_insurance: { riskLevel: "medium", targetParty: "Pflegekasse", allowed: ["appeal", "benefit_application", "document_request", "clarification"], forbidden: ["contract_cancel"] },
  pension_insurance: { riskLevel: "medium", targetParty: "Deutsche Rentenversicherung", allowed: ["appeal", "benefit_application", "document_request", "clarification"], forbidden: ["contract_cancel"] },
  disability: { riskLevel: "medium", targetParty: "Versorgungsamt", allowed: ["appeal", "benefit_application", "document_request", "clarification"], forbidden: ["contract_cancel"] },
  health_insurance: { riskLevel: "medium", targetParty: "Krankenkasse", allowed: ["reimbursement", "benefit_application", "appeal", "document_request"], forbidden: ["contract_cancel", "legal_aid"] },
  employment: { riskLevel: "high", targetParty: "Arbeitgeber / Arbeitsgericht / Gewerkschaft je nach Ziel", allowed: ["claim_dispute", "appeal", "document_request", "clarification"], forbidden: ["reimbursement"] },
  housing: { riskLevel: "medium", targetParty: "Vermieter / Jobcenter / Sozialamt je nach Ziel", allowed: ["claim_dispute", "payment_plan", "benefit_application", "document_request"], forbidden: ["reimbursement"] },
  tax: { riskLevel: "high", targetParty: "Finanzamt", allowed: ["appeal", "payment_plan", "document_request", "clarification"], forbidden: ["reimbursement", "contract_cancel"] },
  broadcast_fee: { riskLevel: "medium", targetParty: "Beitragsservice", allowed: ["benefit_application", "document_request", "clarification"], forbidden: ["contract_cancel"] },
  family_school: { riskLevel: "medium", targetParty: "Familienkasse / Jugendamt / Schule / Kommune", allowed: ["benefit_application", "appeal", "document_request"], forbidden: ["contract_cancel"] },
  bank_pfändung: { riskLevel: "high", targetParty: "Bank / Amtsgericht / Schuldnerberatung", allowed: ["document_request", "clarification"], forbidden: ["reimbursement", "contract_cancel"] },
  immigration: { riskLevel: "high", targetParty: "Ausländerbehörde / Beratungsstelle / Anwalt", allowed: ["document_request", "clarification", "appointment_notice"], forbidden: ["reimbursement", "contract_cancel"] },
  general: { riskLevel: "low", targetParty: "zuständige Stelle", allowed: ["clarification", "document_request", "general_reply"], forbidden: [] }
};

function selectTemplateGeneralV151(caseType = "", goal = "") {
  if (goal === "legal_aid" || caseType === "legal_aid") return "legal_aid";
  if (goal === "contract_cancel") return "contract_cancel";
  if (goal === "reimbursement") return "reimbursement";
  if (goal === "payment_plan") return "payment_plan";
  if (goal === "paid_proof") return "paid_proof";
  if (goal === "appeal_or_dispute") return caseType === "debt_collection" ? "claim_dispute" : "appeal";
  if (goal === "benefit_check") return "benefit_application";
  if (goal === "detail_question") return "document_request";
  if (goal === "deadline") return "clarification";
  if (caseType === "contract_insurance") return "contract_cancel";
  return "general_reply";
}

function buildRouteV151({ frage = "", frageMode = "", meta = {}, briefText = "", kurz = "", details = "", historyText = "" }) {
  const currentContext = contextCurrentOnlyV151(meta, briefText, kurz, details);
  const caseType = detectCaseTypeGeneralV151(frage, currentContext);
  const goal = detectGoalGeneralV151(frage, currentContext);
  const format = requestedFormatV151(frage, frageMode);
  const writeRequest = isWriteRequestV151(frage, frageMode) || format !== "none";
  const guideRequest = isGuideRequestV151(frage) || goal === "guidance" || (!writeRequest && ["legal_aid", "benefit_check"].includes(goal));
  const matrix = TEMPLATE_MATRIX_V151[caseType] || TEMPLATE_MATRIX_V151.general;
  let template = selectTemplateGeneralV151(caseType, goal);

  // Goal decides target party, not sender.
  let targetParty = matrix.targetParty;
  if (goal === "reimbursement") targetParty = "Krankenkasse / Versicherung / Kostenträger";
  if (goal === "payment_plan" || goal === "paid_proof") targetParty = getSender(meta) || "Gläubiger / Rechnungssteller";
  if (goal === "legal_aid") targetParty = "Amtsgericht / Rechtsantragstelle / Strafverteidiger";
  if (goal === "contract_cancel") targetParty = getSender(meta) || "Versicherung / Vertragspartner";

  const forbidden = matrix.forbidden || [];
  const allowed = matrix.allowed || ["general_reply"];
  const templateBlocked = forbidden.includes(template) || (allowed.length && !allowed.includes(template) && template !== "general_reply");

  return {
    caseType,
    currentUserGoal: goal,
    currentUserIntent: writeRequest ? "write" : (guideRequest ? "guide" : "answer"),
    isWriteRequest: writeRequest,
    wantsChecklist: guideRequest,
    wantsStepByStep: guideRequest,
    wantsGuidance: guideRequest,
    requestedFormat: format,
    shouldOnlyAnswer: !writeRequest && !guideRequest,
    shouldCreateDraft: writeRequest && !templateBlocked,
    shouldAskClarification: writeRequest && (templateBlocked || (format === "none" && !/(brief|mektup|dilekce|dilekçe|schreiben|vorlage)/i.test(normV151(frage)))) ,
    clarificationQuestion: templateBlocked ? "Bu yazı için yanlış şablon seçilmek üzere. Kime yazmak istiyorsun: mektuptaki yere mi, yoksa başka bir kuruma mı?" : "Möchtest du eine E-Mail, einen PDF-Brief oder beides?",
    userLanguage: detectUserLanguageFromQuestion(frage, "de"),
    officialDraftLanguage: "Deutsch",
    sourceParty: getSender(meta) || "",
    demandingParty: getSender(meta) || "",
    targetParty,
    rightsCategory: [caseType, goal],
    possibleRights: inferPossibleRightsV151(caseType, goal),
    possibleBenefits: inferPossibleBenefitsV151(caseType, goal),
    requiredDocuments: inferRequiredDocumentsV151(caseType, goal, meta),
    deadline: meta.frist || meta.termin || "",
    appointment: Boolean(meta.termin || /termin|ladung|umladung|duruşma|durusma|hauptverhandlung/i.test(normV151(currentContext))),
    riskLevel: matrix.riskLevel,
    riskReasons: inferRiskReasonsV151(caseType, goal),
    allowedTemplates: allowed,
    forbiddenTemplates: forbidden,
    selectedTemplate: template,
    templateBlocked,
    protectedSignatureName: safeSignatureForDraft(meta, currentContext),
    protectedIdentifiers: [getPrimaryReference(meta)].filter(Boolean),
    knowledgeCategory: [caseType, goal]
  };
}

function inferPossibleRightsV151(caseType = "", goal = "") {
  const base = [];
  if (["legal_aid", "court"].includes(caseType)) base.push("Beratungshilfe/Pflichtverteidiger prüfen", "Termin/Frist ernst nehmen", "schriftliche Klärung verlangen");
  if (caseType === "contract_insurance") base.push("Widerruf prüfen", "hilfsweise Kündigung", "Vertragsschluss-Nachweis verlangen", "Abbuchung stoppen lassen");
  if (["invoice_medical", "health_insurance"].includes(caseType)) base.push("Kostenübernahme/Erstattung prüfen", "Rechnung/Zahlungsnachweis einreichen", "Leistungsaufstellung anfordern");
  if (caseType === "debt_collection") base.push("Forderung prüfen", "Forderungsaufstellung verlangen", "nicht blind anerkennen", "Ratenzahlung/Stundung prüfen");
  if (["authority_social", "care_insurance", "pension_insurance", "disability"].includes(caseType)) base.push("Widerspruch prüfen", "Unterlagen/Gutachten verlangen", "Frist prüfen");
  if (caseType === "employment") base.push("Kündigungsschutz/Frist prüfen", "Lohnabrechnung/Unterlagen verlangen", "nichts blind unterschreiben");
  if (caseType === "housing") base.push("Nebenkosten/Kaution prüfen", "Mietschuldenhilfe prüfen", "Mieterberatung nutzen");
  if (caseType === "tax") base.push("Einspruch prüfen", "Stundung/Ratenzahlung prüfen", "Vollstreckung vermeiden");
  if (!base.length) base.push("Unterlagen verlangen", "schriftliche Bestätigung verlangen");
  return base;
}

function inferPossibleBenefitsV151(caseType = "", goal = "") {
  if (goal === "benefit_check") return ["zuständige Leistung prüfen", "Unterlagen sammeln", "schriftlichen Antrag stellen"];
  if (caseType === "care_insurance") return ["Pflegegrad", "Höherstufung", "Pflegegeld", "Entlastungsbetrag", "Pflegehilfsmittel"];
  if (caseType === "pension_insurance") return ["Reha", "Erwerbsminderungsrente", "Teilhabe am Arbeitsleben", "Kontenklärung"];
  if (caseType === "disability") return ["GdB", "Merkzeichen", "Nachteilsausgleiche", "Verschlimmerungsantrag"];
  if (caseType === "family_school") return ["Bildung und Teilhabe", "Kinderzuschlag", "Unterhaltsvorschuss", "Kita-Ermäßigung"];
  if (caseType === "broadcast_fee") return ["Befreiung/Ermäßigung prüfen"];
  if (caseType === "legal_aid") return ["Beratungshilfe", "Pflichtverteidiger prüfen"];
  return [];
}

function inferRequiredDocumentsV151(caseType = "", goal = "", meta = {}) {
  if (caseType === "legal_aid") return ["Gerichtsschreiben", "Aktenzeichen", "aktueller Bürgergeld-/Jobcenter-Bescheid", "Ausweis", "Einkommens-/Ausgabennachweise falls vorhanden"];
  if (caseType === "contract_insurance") return ["Versicherungsschreiben", "Versicherungsscheinnummer", "Kontoauszug/Abbuchung falls vorhanden", "Screenshot oder Nachweis der Online-Anfrage"];
  if (goal === "reimbursement" || caseType === "invoice_medical") return ["Rechnung", "Zahlungsnachweis", "Leistungsaufstellung", "Versicherungs-/Krankenkassenkarte oder Versicherungsnummer"];
  if (caseType === "care_insurance") return ["Pflegegrad-Bescheid", "MD-Gutachten", "Arztberichte", "Pflegedokumentation"];
  if (caseType === "pension_insurance") return ["Rentenversicherungs-Schreiben", "Arztberichte", "AU-Zeiten", "Gutachten", "Versicherungsverlauf"];
  if (caseType === "disability") return ["Bescheid", "Arztberichte", "Gutachten", "Nachweise über Einschränkungen"];
  if (caseType === "debt_collection") return ["Mahnung/Inkassoschreiben", "Forderungsaufstellung", "Vertragsnachweis", "Zahlungsnachweis falls bezahlt"];
  return ["aktuelles Schreiben", "Aktenzeichen/Nummer", "relevante Nachweise", "Ausweis falls persönlicher Termin nötig ist"];
}

function inferRiskReasonsV151(caseType = "", goal = "") {
  if (["legal_aid", "court", "immigration", "bank_pfändung", "tax"].includes(caseType)) return ["Frist/Termin oder rechtliche Folgen möglich"];
  if (["debt_collection", "employment", "housing", "contract_insurance"].includes(caseType)) return ["Geld, Vertrag oder Frist kann betroffen sein"];
  if (["care_insurance", "pension_insurance", "disability", "health_insurance"].includes(caseType)) return ["Leistung/Anspruch hängt vom Einzelfall ab"];
  return [];
}

function buildShortGuideV151(route = {}, meta = {}, context = "") {
  const title = route.caseType === "legal_aid" ? "Checkliste: Anwalt / Beratungshilfe" : "Checkliste: Nächste Schritte";
  const docs = (route.requiredDocuments || []).slice(0, 6);
  const rights = (route.possibleRights || []).slice(0, 4);
  const warning = route.riskLevel === "high"
    ? "Wichtig: Frist oder Termin nicht verpassen. Bei Gericht/Strafsache schnell handeln."
    : (route.riskLevel === "medium" ? "Wichtig: Nichts unterschreiben oder zahlen, was du nicht verstanden hast." : "Wichtig: Lass dir alles schriftlich bestätigen.");

  const next = route.caseType === "legal_aid"
    ? "Nächster Schritt: Amtsgericht/Rechtsantragstelle kontaktieren und Beratungshilfe oder Pflichtverteidiger fragen."
    : route.currentUserGoal === "reimbursement"
      ? "Nächster Schritt: Rechnung und Zahlungsnachweis bei Krankenkasse/Versicherung einreichen."
      : route.currentUserGoal === "contract_cancel"
        ? "Nächster Schritt: Vertragspartner schriftlich anschreiben und Widerruf/Kündigung prüfen lassen."
        : `Nächster Schritt: ${route.targetParty || "zuständige Stelle"} schriftlich kontaktieren.`;

  return cleanText(`${title}

Kurz gesagt:
Das kann möglich sein, ist aber nicht sicher. Die zuständige Stelle entscheidet.

Zu prüfen:
${rights.map(x => `☐ ${x}`).join("\n")}

Unterlagen:
${docs.map(x => `☐ ${x}`).join("\n")}

Fragen:
☐ Hast du schon eine schriftliche Antwort oder einen Bescheid?
☐ Gibt es eine Frist oder einen Termin?
☐ Soll ich daraus einen offiziellen Brief oder eine E-Mail machen?

Warnung:
${warning}

${next}`);
}

function getSenderBlockGenericV151(meta = {}, context = "") {
  if (typeof getSafeSenderBlockV1504 === "function") return getSafeSenderBlockV1504(meta, context);
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  return `${name}\n[Adresse bitte prüfen/eintragen]`;
}

function makeOfficialDraftV151(route = {}, meta = {}, context = "", format = "pdf") {
  const template = route.selectedTemplate;
  if (template === "legal_aid") return buildLegalAidPdfOutputV15(meta, context);
  if (template === "contract_cancel") return buildContractPdfOutputV1502(meta, context);
  if (template === "reimbursement") return buildReimbursementDraftV151(meta, context);
  if (template === "payment_plan") return buildPaymentPlanDraftV151(meta, context);
  if (template === "paid_proof") return buildPaidProofDraftV151(meta, context);
  if (template === "claim_dispute") return buildClaimDisputeDraftV151(meta, context);
  if (template === "appeal") return buildAppealDraftV151(meta, context);
  if (template === "benefit_application") return buildBenefitApplicationDraftV151(route, meta, context);
  return buildClarificationDraftV151(route, meta, context);
}

function wrapAsEmailOrPdfV151(draft = "", route = {}, format = "pdf") {
  const pure = cleanText(String(draft || "").replace(/^PDF-BRIEF:\s*/i, "").replace(/^E-MAIL:\s*/i, ""));
  if (format === "both") return cleanText(`E-MAIL:\n\n${pure}\n\nPDF-BRIEF:\n\n${pure}`);
  if (format === "email") return cleanText(`E-MAIL:\n\n${pure}`);
  return cleanText(`PDF-BRIEF:\n\n${pure}`);
}

function buildReimbursementDraftV151(meta = {}, context = "") {
  const sender = getSenderBlockGenericV151(meta, context);
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  const ref = getPrimaryReference(meta) || "[Nummer bitte eintragen]";
  const amount = getAmount(meta) || "[Betrag bitte eintragen]";
  const date = getDateFromMeta(meta) || getDate(meta) || "[Datum bitte eintragen]";
  const senderOrg = getSender(meta) || "[Rechnungssteller bitte eintragen]";
  const city = getCityFromPostalAddress(sender) || "[Ort]";
  return cleanText(`PDF-BRIEF:

${sender}

Krankenkasse / Versicherung
[Adresse bitte eintragen]

${city}, ${getTodayGerman()}

Betreff: Bitte um Prüfung einer Kostenübernahme / Erstattung – Nummer: ${ref}

Sehr geehrte Damen und Herren,

ich bitte um Prüfung, ob die beigefügte Rechnung ganz oder teilweise übernommen oder erstattet werden kann.

Daten zur Rechnung:
- Rechnungssteller: ${senderOrg}
- Schreiben/Rechnung vom: ${date}
- Nummer/Referenz: ${ref}
- Betrag: ${amount}

Den Zahlungsnachweis füge ich bei bzw. reiche ich nach.

Bitte teilen Sie mir schriftlich mit, ob eine Kostenübernahme oder Erstattung nach meinem Versicherungs-/Leistungsanspruch möglich ist.

Falls weitere Unterlagen benötigt werden, teilen Sie mir bitte mit, welche Nachweise noch fehlen.

Mit freundlichen Grüßen

${name}`);
}

function buildPaymentPlanDraftV151(meta = {}, context = "") {
  const sender = getSenderBlockGenericV151(meta, context);
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  const recipient = getSender(meta) || "[Gläubiger / Rechnungssteller bitte eintragen]";
  const ref = getPrimaryReference(meta) || "[Nummer bitte eintragen]";
  const amount = getAmount(meta) || "[Betrag bitte eintragen]";
  const city = getCityFromPostalAddress(sender) || "[Ort]";
  return cleanText(`PDF-BRIEF:

${sender}

${recipient}
[Adresse bitte eintragen]

${city}, ${getTodayGerman()}

Betreff: Bitte um Ratenzahlung / Stundung – Nummer: ${ref}

Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben zur Nummer ${ref} über ${amount}.

Bitte senden Sie mir zuerst eine aktuelle und nachvollziehbare Forderungsaufstellung zu.

Ohne Anerkennung einer Rechtspflicht bitte ich, falls die Forderung berechtigt ist, um eine Ratenzahlung oder Stundung.

Bitte teilen Sie mir schriftlich mit, welche monatliche Rate möglich ist und bestätigen Sie, dass bis zur Klärung keine weiteren Maßnahmen eingeleitet werden.

Mit freundlichen Grüßen

${name}`);
}

function buildPaidProofDraftV151(meta = {}, context = "") {
  const sender = getSenderBlockGenericV151(meta, context);
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  const recipient = getSender(meta) || "[Empfänger bitte eintragen]";
  const ref = getPrimaryReference(meta) || "[Nummer bitte eintragen]";
  const city = getCityFromPostalAddress(sender) || "[Ort]";
  return cleanText(`PDF-BRIEF:

${sender}

${recipient}
[Adresse bitte eintragen]

${city}, ${getTodayGerman()}

Betreff: Zahlungsnachweis / Bitte um Zuordnung – Nummer: ${ref}

Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben zur Nummer ${ref}.

Der Betrag wurde bereits bezahlt. Den Zahlungsnachweis füge ich bei bzw. reiche ich nach.

Bitte prüfen Sie die Zahlung und ordnen Sie diese meinem Vorgang zu.

Bitte bestätigen Sie mir schriftlich, dass keine weiteren Mahnungen oder Maßnahmen wegen dieses Betrags erfolgen.

Mit freundlichen Grüßen

${name}`);
}

function buildClaimDisputeDraftV151(meta = {}, context = "") {
  const sender = getSenderBlockGenericV151(meta, context);
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  const recipient = getSender(meta) || "[Empfänger bitte eintragen]";
  const ref = getPrimaryReference(meta) || "[Nummer bitte eintragen]";
  const city = getCityFromPostalAddress(sender) || "[Ort]";
  return cleanText(`PDF-BRIEF:

${sender}

${recipient}
[Adresse bitte eintragen]

${city}, ${getTodayGerman()}

Betreff: Bitte um Prüfung der Forderung – Nummer: ${ref}

Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben zur Nummer ${ref}.

Die Forderung ist für mich nicht nachvollziehbar. Bitte senden Sie mir eine aktuelle Forderungsaufstellung und die Nachweise, aus denen sich die Forderung ergibt.

Bis zur Klärung erkenne ich die Forderung nicht an und bitte darum, keine weiteren Maßnahmen einzuleiten.

Bitte bestätigen Sie mir den Eingang dieses Schreibens schriftlich.

Mit freundlichen Grüßen

${name}`);
}

function buildAppealDraftV151(meta = {}, context = "") {
  const sender = getSenderBlockGenericV151(meta, context);
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  const recipient = getSender(meta) || "[Behörde bitte eintragen]";
  const date = getDateFromMeta(meta) || getDate(meta) || "[Datum bitte eintragen]";
  const ref = getPrimaryReference(meta) || "[Aktenzeichen / Nummer bitte eintragen]";
  const city = getCityFromPostalAddress(sender) || "[Ort]";
  return cleanText(`PDF-BRIEF:

${sender}

${recipient}
[Adresse bitte eintragen]

${city}, ${getTodayGerman()}

Betreff: Widerspruch / Bitte um Überprüfung – Nummer: ${ref}

Sehr geehrte Damen und Herren,

hiermit lege ich vorsorglich Widerspruch gegen Ihr Schreiben / Ihren Bescheid vom ${date} zur Nummer ${ref} ein.

Ich bitte um erneute Prüfung und um eine verständliche schriftliche Begründung.

Bitte senden Sie mir außerdem die Unterlagen oder Berechnungen, auf denen Ihre Entscheidung beruht.

Bitte bestätigen Sie mir den Eingang dieses Schreibens schriftlich.

Mit freundlichen Grüßen

${name}`);
}

function buildBenefitApplicationDraftV151(route = {}, meta = {}, context = "") {
  const sender = getSenderBlockGenericV151(meta, context);
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  const recipient = route.targetParty || "[zuständige Stelle bitte eintragen]";
  const city = getCityFromPostalAddress(sender) || "[Ort]";
  return cleanText(`PDF-BRIEF:

${sender}

${recipient}
[Adresse bitte eintragen]

${city}, ${getTodayGerman()}

Betreff: Antrag / Bitte um Prüfung einer möglichen Leistung

Sehr geehrte Damen und Herren,

ich bitte um Prüfung, ob in meinem Fall eine Leistung, Kostenübernahme, Befreiung oder Unterstützung möglich ist.

Bitte teilen Sie mir schriftlich mit, welche Unterlagen Sie dafür benötigen und welches Formular ich einreichen muss.

Die vorhandenen Nachweise kann ich vorlegen oder nachreichen.

Bitte bestätigen Sie mir den Eingang dieses Schreibens schriftlich.

Mit freundlichen Grüßen

${name}`);
}

function buildClarificationDraftV151(route = {}, meta = {}, context = "") {
  const sender = getSenderBlockGenericV151(meta, context);
  const name = safeSignatureForDraft(meta, context) || "[Name bitte prüfen/eintragen]";
  const recipient = getSender(meta) || route.targetParty || "[Empfänger bitte eintragen]";
  const ref = getPrimaryReference(meta) || "[Nummer bitte eintragen]";
  const city = getCityFromPostalAddress(sender) || "[Ort]";
  return cleanText(`PDF-BRIEF:

${sender}

${recipient}
[Adresse bitte eintragen]

${city}, ${getTodayGerman()}

Betreff: Bitte um Klärung – Nummer: ${ref}

Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben zur Nummer ${ref}.

Ich bitte um eine verständliche schriftliche Erklärung, worum es genau geht und welche nächsten Schritte von mir erwartet werden.

Bitte teilen Sie mir außerdem mit, welche Frist gilt und welche Unterlagen ich einreichen muss.

Bitte bestätigen Sie mir den Eingang dieses Schreibens schriftlich.

Mit freundlichen Grüßen

${name}`);
}

function buildShortAnswerV151(route = {}, meta = {}, context = "", frage = "") {
  const first = route.currentUserGoal === "reimbursement"
    ? "Das kann möglich sein, ist aber nicht sicher. Die Krankenkasse oder Versicherung muss es prüfen."
    : route.currentUserGoal === "payment_plan"
      ? "Wenn du nicht zahlen kannst, zuerst die Forderung prüfen und dann schriftlich Ratenzahlung oder Stundung anfragen."
      : route.currentUserGoal === "contract_cancel"
        ? "Hier geht es wahrscheinlich um einen Vertrag. Prüfe Widerruf, Kündigung und ob der Vertrag wirklich gewollt abgeschlossen wurde."
        : route.currentUserGoal === "legal_aid"
          ? "Wenn du den Anwalt nicht bezahlen kannst, kann Beratungshilfe oder ein Pflichtverteidiger geprüft werden."
          : "Ich helfe dir Schritt für Schritt. Wichtig ist, zuerst Zielstelle, Frist und Unterlagen zu klären.";
  const docs = (route.requiredDocuments || []).slice(0, 4).map(x => `- ${x}`).join("\n");
  const next = route.selectedTemplate === "general_reply" ? "Schreibe mir kurz, ob du nur Erklärung, eine Checkliste oder einen Brief brauchst." : `Nächster Schritt: ${route.targetParty} kontaktieren.`;
  return cleanText(`${first}

Was du brauchst:
${docs}

${next}

Wenn du möchtest, schreibe ich dir daraus eine E-Mail oder einen PDF-Brief.`);
}

function buildForcedChatAnswer_LEGACY_5({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const route = buildRouteV151({ frage, frageMode, meta, briefText, kurz, details, historyText });
  const context = contextCurrentOnlyV151(meta, briefText, kurz, details);

  // General Template Guard: block dangerous wrong template classes before writing.
  if (route.templateBlocked) {
    return cleanText(`Das wäre wahrscheinlich die falsche Vorlage.

Ich muss zuerst die richtige Zielstelle klären:
- Soll es an die Stelle aus dem Brief gehen?
- Oder an eine andere Stelle, zum Beispiel Krankenkasse, Versicherung, Amtsgericht, Jobcenter oder Anwalt?

Schreib mir kurz: An wen soll es gehen?`);
  }

  // Guidance/checklist comes before PDF unless the user clearly requests an immediate official draft.
  const explicitDraftNow = route.isWriteRequest && route.requestedFormat !== "none";
  if (route.wantsGuidance && !explicitDraftNow) {
    return buildShortGuideV151(route, meta, context);
  }

  // If user asks for a draft but format is unclear, ask short clarification.
  if (route.isWriteRequest && route.requestedFormat === "none" && !/(brief|mektup|dilekce|dilekçe|schreiben|vorlage)/i.test(normV151(frage))) {
    return cleanText(`Möchtest du eine E-Mail, einen PDF-Brief oder beides?

Ich erstelle den offiziellen Text in der Sprache der empfangenden Stelle.`);
  }

  // Official draft from pure template only.
  if (route.isWriteRequest || route.requestedFormat !== "none") {
    const fmt = route.requestedFormat === "none" ? "pdf" : route.requestedFormat;
    const draft = makeOfficialDraftV151(route, meta, context, fmt);
    return wrapAsEmailOrPdfV151(draft, route, fmt);
  }

  // Short assistant answer for common goal questions; otherwise allow Gemini fallback.
  if (["reimbursement", "payment_plan", "contract_cancel", "legal_aid", "benefit_check"].includes(route.currentUserGoal)) {
    return buildShortAnswerV151(route, meta, context, frage);
  }

  return "";
}


// ===============================
// V15.2 CLEANUP FINAL ROUTER
// Purpose:
// - One active chat router only: this final function overrides all legacy routers above.
// - Current user question beats old chat history and old case context.
// - Strong reimbursement / insurance / legal-aid signals are resolved before mixed context.
// - Official drafts are built only from pure templates.
// ===============================
function normCleanV152(text = "") {
  return normV151 ? normV151(text) : String(text || "").toLowerCase();
}

function strongReimbursementQuestionV152(frage = "") {
  const q = normCleanV152(frage);
  return /(sigortadan|sigortaya|geri al|geri odeme|geri ödeme|bir kismini|bir kısmını|bunu odedim|bunu ödedim|odedim.*sigorta|ödedim.*sigorta|doctor|doktor|arzt|rechnung|fatura|kostenubernahme|kostenübernahme|erstattung|erstattet|zuruckbekommen|zurückbekommen|refund|reimbursement)/i.test(q)
    && /(sigorta|versicherung|krankenkasse|kasse|doctor|doktor|arzt|rechnung|fatura|kosten|geri|erstattung|refund)/i.test(q);
}

function strongLegalAidQuestionV152(frage = "") {
  const q = normCleanV152(frage);
  return /(avukat|anwalt|rechtsanwalt|beratungshilfe|pflichtverteidiger|rechtsantragstelle|para odemeden|para ödemeden|hukuki yardim|hukuki yardım)/i.test(q);
}

function strongContractQuestionV152(frage = "") {
  const q = normCleanV152(frage);
  return /(kredi|kredit|finanzschutzbrief|finanz-schutzbrief|versicherungsschein|sigorta.*kredi|kredi.*sigorta|vertrag|sozlesme|sözleşme|widerruf|kundigung|kündigung|iptal|fesih|abbuchung stoppen|lastschrift)/i.test(q)
    && /(sigorta|versicherung|vertrag|kredi|kredit|schutzbrief|widerruf|kündig|kundig|iptal|fesih)/i.test(q);
}

function strongPaymentPlanQuestionV152(frage = "") {
  const q = normCleanV152(frage);
  return /(taksit|taksitli|rate|ratenzahlung|stundung|zahlungsaufschub|kann nicht zahlen|nicht bezahlen|ödeyemem|odeyemem)/i.test(q);
}

function strongPaidProofQuestionV152(frage = "") {
  const q = normCleanV152(frage);
  return /(schon bezahlt|bereits bezahlt|habe bezahlt|bunu odedim|bunu ödedim|odedim|ödedim|zahlungsnachweis|dekont|überwiesen|ueberwiesen)/i.test(q) && !strongReimbursementQuestionV152(frage);
}

function makeRouteV152({ frage = "", frageMode = "", meta = {}, briefText = "", kurz = "", details = "", historyText = "" }) {
  const currentContext = contextCurrentOnlyV151(meta, briefText, kurz, details);
  let route = buildRouteV151({ frage, frageMode, meta, briefText, kurz, details, historyText: "" });
  const fmt = requestedFormatV151(frage, frageMode);
  const writeReq = isWriteRequestV151(frage, frageMode) || fmt !== "none";

  if (strongAcceptedOverpaymentQuestionV153(frage, currentContext)) {
    route.caseType = "authority_social";
    route.currentUserGoal = "accepted_overpayment";
    route.currentUserIntent = "answer";
    route.isWriteRequest = writeReq;
    route.requestedFormat = fmt;
    route.wantsGuidance = false;
    route.wantsChecklist = false;
    route.wantsStepByStep = false;
    route.userLanguage = "tr";
    route.targetParty = "Jobcenter";
    route.selectedTemplate = "accepted_overpayment";
    route.allowedTemplates = ["accepted_overpayment", "payment_plan", "document_request", "general_answer"];
    route.forbiddenTemplates = ["legal_aid", "contract_cancel", "reimbursement"];
    route.templateBlocked = false;
    route.riskLevel = "medium";
    route.requiredDocuments = ["Jobcenter-Bescheid", "Aktenzeichen/Bedarfsgemeinschaftsnummer", "Nachweise zu Einkommen und Ausgaben falls niedrigere Rate gewünscht ist"];
    route.possibleRights = ["Berechnung prüfen lassen", "niedrigere Aufrechnung beantragen", "Stundung oder Ratenzahlung prüfen"];
    return route;
  }

  // Current user intent wins. This is the main cleanup fix.
  if (strongReimbursementQuestionV152(frage)) {
    route.caseType = /krankenkasse|kasse|versicherung|sigorta/i.test(normCleanV152(frage)) ? "invoice_medical" : (route.caseType === "health_insurance" ? "health_insurance" : "invoice_medical");
    route.currentUserGoal = "reimbursement";
    route.currentUserIntent = writeReq ? "write" : "answer";
    route.isWriteRequest = writeReq;
    route.requestedFormat = fmt;
    route.wantsGuidance = isGuideRequestV151(frage);
    route.wantsChecklist = route.wantsGuidance;
    route.wantsStepByStep = route.wantsGuidance;
    route.targetParty = "Krankenkasse / Versicherung / Kostenträger";
    route.selectedTemplate = "reimbursement";
    route.allowedTemplates = ["reimbursement", "document_request", "general_answer"];
    route.forbiddenTemplates = ["legal_aid", "public_defender", "court_clarification", "contract_cancel"];
    route.templateBlocked = false;
    route.riskLevel = "medium";
    route.requiredDocuments = ["Rechnung", "Zahlungsnachweis", "Leistungsaufstellung", "Versicherungs-/Krankenkassendaten"];
    route.possibleRights = ["Kostenübernahme oder Erstattung prüfen lassen", "fehlende Unterlagen schriftlich anfordern"];
    return route;
  }

  if (strongLegalAidQuestionV152(frage)) {
    route.caseType = "legal_aid";
    route.currentUserGoal = "legal_aid";
    route.currentUserIntent = writeReq ? "write" : "guide";
    route.isWriteRequest = writeReq;
    route.requestedFormat = fmt;
    route.wantsGuidance = !writeReq || isGuideRequestV151(frage);
    route.wantsChecklist = route.wantsGuidance;
    route.wantsStepByStep = route.wantsGuidance;
    route.targetParty = "Amtsgericht / Rechtsantragstelle / Strafverteidiger";
    route.selectedTemplate = "legal_aid";
    route.allowedTemplates = ["legal_aid", "public_defender", "court_clarification", "appointment_notice"];
    route.forbiddenTemplates = ["reimbursement", "medical_detail", "payment_plan", "contract_cancel"];
    route.templateBlocked = false;
    route.riskLevel = "high";
    route.requiredDocuments = ["Gerichtsschreiben", "Aktenzeichen", "aktueller Bürgergeld-/Jobcenter-Bescheid", "Ausweis", "Einkommens-/Ausgabennachweise falls vorhanden"];
    route.possibleRights = ["Beratungshilfe prüfen", "Pflichtverteidiger prüfen", "Termin/Frist beachten"];
    return route;
  }

  if (strongContractQuestionV152(frage)) {
    route.caseType = "contract_insurance";
    route.currentUserGoal = "contract_cancel";
    route.currentUserIntent = writeReq ? "write" : "answer";
    route.isWriteRequest = writeReq;
    route.requestedFormat = fmt;
    route.wantsGuidance = isGuideRequestV151(frage);
    route.wantsChecklist = route.wantsGuidance;
    route.wantsStepByStep = route.wantsGuidance;
    route.targetParty = getSender(meta) || "Versicherung / Vertragspartner";
    route.selectedTemplate = "contract_cancel";
    route.allowedTemplates = ["contract_cancel", "contract_proof", "stop_debit", "document_request"];
    route.forbiddenTemplates = ["reimbursement", "legal_aid", "medical_detail", "payment_plan"];
    route.templateBlocked = false;
    route.riskLevel = "medium";
    route.requiredDocuments = ["Versicherungsschreiben", "Versicherungsscheinnummer", "Nachweis zur Kreditanfrage", "Kontoauszug/Abbuchung falls vorhanden"];
    route.possibleRights = ["Widerruf prüfen", "hilfsweise Kündigung", "Vertragsschluss-Nachweis verlangen", "Abbuchung stoppen lassen"];
    return route;
  }

  if (strongPaymentPlanQuestionV152(frage)) {
    route.currentUserGoal = "payment_plan";
    route.targetParty = getSender(meta) || "Gläubiger / Rechnungssteller";
    route.selectedTemplate = "payment_plan";
    route.allowedTemplates = ["payment_plan", "document_request", "claim_dispute", "general_answer"];
    route.forbiddenTemplates = ["legal_aid", "contract_cancel", "reimbursement"];
    route.templateBlocked = false;
    return route;
  }

  if (strongPaidProofQuestionV152(frage)) {
    route.currentUserGoal = "paid_proof";
    route.targetParty = getSender(meta) || "Gläubiger / Rechnungssteller";
    route.selectedTemplate = "paid_proof";
    route.allowedTemplates = ["paid_proof", "document_request", "general_answer"];
    route.forbiddenTemplates = ["legal_aid", "contract_cancel"];
    route.templateBlocked = false;
    return route;
  }

  return route;
}

function buildShortGuideCleanV152(route = {}, meta = {}, context = "") {
  const lang = route.userLanguage || "de";
  const docs = (route.requiredDocuments || []).slice(0, 6);
  const rights = (route.possibleRights || []).slice(0, 4);
  if (lang === "tr") {
    const title = route.currentUserGoal === "reimbursement" ? "Kontrol listesi: Sigorta / geri ödeme" : route.currentUserGoal === "legal_aid" ? "Kontrol listesi: Avukat / danışmanlık yardımı" : "Kontrol listesi: Sonraki adımlar";
    const warning = route.riskLevel === "high" ? "Önemli: Mahkeme veya ceza konusu varsa süre/termin kaçırılmamalı." : "Önemli: Kararı yetkili kurum verir. Garanti yok.";
    const next = route.currentUserGoal === "reimbursement" ? "Sonraki adım: Fatura ve ödeme dekontunu Krankenkasse / Versicherung’a gönder." : `Sonraki adım: ${route.targetParty || "yetkili kurum"} ile yazılı iletişime geç.`;
    return cleanText(`${title}

Kısaca:
Bu mümkün olabilir, ama kesin değildir.

Gerekenler:
${docs.map(x => `☐ ${x}`).join("\n")}

Kontrol et:
${rights.map(x => `☐ ${x}`).join("\n")}

Uyarı:
${warning}

${next}

İstersen sana bunun için Almanca e-posta veya PDF mektup hazırlayayım.`);
  }
  return buildShortGuideV151(route, meta, context);
}

function buildShortAnswerCleanV152(route = {}, meta = {}, context = "", frage = "") {
  const lang = route.userLanguage || detectUserLanguageFromQuestion(frage, "de");
  if (route.currentUserGoal === "reimbursement" && lang === "tr") {
    return cleanText(`Evet, bunu Krankenkasse veya Versicherung'a gönderebilirsiniz. Ama geri ödeme garanti değildir; onlar kontrol eder.

Yapılacaklar:
☐ Faturayı ekle
☐ Ödeme dekontunu ekle
☐ Varsa detaylı Leistungsaufstellung ekle
☐ Yazılı cevap iste

Sonraki adım: İstersen sana Almanca e-posta veya PDF mektup hazırlayayım.`);
  }
  if (route.currentUserGoal === "reimbursement") {
    return cleanText(`Das kann möglich sein, ist aber nicht sicher. Krankenkasse oder Versicherung müssen es prüfen.

Was du brauchst:
- Rechnung
- Zahlungsnachweis
- falls vorhanden: Leistungsaufstellung

Nächster Schritt: Rechnung und Zahlungsnachweis bei Krankenkasse/Versicherung einreichen.

Wenn du möchtest, schreibe ich dir daraus eine E-Mail oder einen PDF-Brief.`);
  }
  return buildShortAnswerV151(route, meta, context, frage);
}



// ===============================
// V15.3 ACCEPTED OVERPAYMENT SHORT ANSWER FIX
// Reason:
// - If user says Jobcenter overpayment is correct / they received too much,
//   the chat must not write a long legal explanation.
// - Do not claim "rechtlich korrekt" or cite fixed percentages as certainty.
// - Give a short, safe next-step answer.
// ===============================
function strongAcceptedOverpaymentQuestionV153(frage = "", context = "") {
  const q = normCleanV152(`${frage}\n${context}`);
  const acceptedCue = /(tamam\s+dogru|tamam\s+doğru|dogru|doğru|stimmt|ist\s+richtig|hakli|haklı|kabul|fazla\s+para\s+ald|fazla\s+odeme|fazla\s+ödeme|zu\s+viel\s+bekommen|zu\s+viel\s+geld\s+bekommen|ueberzahlung|überzahlung)/i.test(q);
  const socialDebtCue = /(jobcenter|burgergeld|buergergeld|sgb|rueckforderung|rückforderung|aufrechnung|bescheid|bedarfsgemeinschaft|jc|sozialamt|regelleistung)/i.test(q);
  return acceptedCue && socialDebtCue;
}

function buildAcceptedOverpaymentShortAnswerV153(route = {}, meta = {}, context = "", frage = "") {
  const lang = route.userLanguage || detectUserLanguageFromQuestion(frage, "de");

  // V15.4 Feinschliff:
  // Bei einer reinen Bestätigung wie „Tamam doğru, fazla para aldık“ keine Briefdaten wiederholen.
  // Der Nutzer bestätigt nur den Sachverhalt. Also kurz führen: Optionen + nächster Schritt.
  if (lang === "tr") {
    return cleanText(`Tamam, anladım.

Seçenekler:
☐ Kesintiyi kabul etmek
☐ Kesinti fazla geliyorsa daha düşük kesinti istemek
☐ Ödemeyi erteleme istemek
☐ Mümkünse tek seferde ödemek

Önemli: Kesinti sizi zorluyorsa Jobcenter’a yazılı olarak daha düşük kesinti veya Stundung (ödeme erteleme) isteyebilirsiniz.

İstersen sana Jobcenter için kısa Almanca dilekçe hazırlayayım.`);
  }
  return cleanText(`Verstanden.

Optionen:
☐ Aufrechnung akzeptieren
☐ niedrigere monatliche Aufrechnung beantragen
☐ Stundung beantragen
☐ einmalig zahlen, falls möglich

Wichtig: Wenn die monatliche Kürzung zu hoch ist, solltest du schriftlich eine niedrigere Aufrechnung oder Stundung beantragen.

Wenn du möchtest, schreibe ich dir einen kurzen deutschen Antrag an das Jobcenter.`);
}

function buildForcedChatAnswer({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const currentContext = contextCurrentOnlyV151(meta, briefText, kurz, details);
  const route = makeRouteV152({ frage, frageMode, meta, briefText, kurz, details, historyText });

  if (route.templateBlocked) {
    return cleanText(`Das wäre wahrscheinlich die falsche Vorlage.

Schreib kurz, an wen es gehen soll:
- an die Stelle aus dem Brief
- an Krankenkasse / Versicherung
- an Amtsgericht / Rechtsantragstelle
- an Jobcenter / Sozialamt

Dann erstelle ich den richtigen Text.`);
  }

  const explicitDraftNow = route.isWriteRequest && route.requestedFormat !== "none";
  if (route.wantsGuidance && !explicitDraftNow) {
    return buildShortGuideCleanV152(route, meta, currentContext);
  }

  if (route.isWriteRequest && route.requestedFormat === "none" && !/(brief|mektup|dilekce|dilekçe|schreiben|vorlage|yaz|hazirla|hazırla)/i.test(normCleanV152(frage))) {
    return cleanText(`Möchtest du eine E-Mail, einen PDF-Brief oder beides?

Der offizielle Text wird in der Sprache der empfangenden Stelle erstellt.`);
  }

  if (route.isWriteRequest || route.requestedFormat !== "none") {
    const fmt = route.requestedFormat === "none" ? "pdf" : route.requestedFormat;
    const draft = makeOfficialDraftV151(route, meta, currentContext, fmt);
    return wrapAsEmailOrPdfV151(draft, route, fmt);
  }

  if (route.currentUserGoal === "accepted_overpayment") {
    return buildAcceptedOverpaymentShortAnswerV153(route, meta, currentContext, frage);
  }

  if (["reimbursement", "payment_plan", "contract_cancel", "legal_aid", "benefit_check", "paid_proof"].includes(route.currentUserGoal)) {
    return buildShortAnswerCleanV152(route, meta, currentContext, frage);
  }

  return "";
}


// ===============================
// V15.5 FINAL OVERRIDE - ACCEPTED OVERPAYMENT MUST STAY ULTRA SHORT
// Reason:
// Some older fallback/router path could still add amount/reference details.
// This override returns before any route/prompt can repeat Betrag or Mein Zeichen.
// Keep at very end of file.
// ===============================
function acceptedOverpaymentUltraShortV155(frage = "", context = "") {
  const q = normCleanV152(`${frage}\n${context}`);
  const acceptedCue = /(tamam\s+dogru|tamam\s+doğru|dogru|doğru|evet\s+dogru|evet\s+doğru|stimmt|ist\s+richtig|ja\s+richtig|hakli|haklı|kabul|fazla\s+para\s+ald|fazla\s+odeme|fazla\s+ödeme|zu\s+viel\s+bekommen|zu\s+viel\s+geld\s+bekommen|ueberzahlung|überzahlung)/i.test(q);
  const socialDebtCue = /(jobcenter|burgergeld|buergergeld|sgb|rueckforderung|rückforderung|aufrechnung|bescheid|bedarfsgemeinschaft|jc|sozialamt|regelleistung)/i.test(q);
  return acceptedCue && socialDebtCue;
}

function acceptedOverpaymentUltraShortAnswerV155(frage = "") {
  const lang = detectUserLanguageFromQuestion(frage, "de");
  if (lang === "tr") {
    return cleanText(`Tamam, anladım.

Seçenekler:
☐ Kesintiyi kabul etmek
☐ Kesinti fazla geliyorsa daha düşük kesinti istemek
☐ Ödemeyi erteleme istemek
☐ Mümkünse tek seferde ödemek

Önemli: Kesinti sizi zorluyorsa Jobcenter’a yazılı olarak daha düşük kesinti veya Stundung isteyebilirsiniz.

İstersen sana Jobcenter için kısa Almanca dilekçe hazırlayayım.`);
  }
  return cleanText(`Verstanden.

Optionen:
☐ Aufrechnung akzeptieren
☐ niedrigere monatliche Aufrechnung beantragen
☐ Stundung beantragen
☐ einmalig zahlen, falls möglich

Wichtig: Wenn die monatliche Kürzung zu hoch ist, solltest du schriftlich eine niedrigere Aufrechnung oder Stundung beantragen.

Wenn du möchtest, schreibe ich dir einen kurzen deutschen Antrag an das Jobcenter.`);
}

const buildForcedChatAnswer_V154 = buildForcedChatAnswer;
function buildForcedChatAnswer({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const currentContext = contextCurrentOnlyV151(meta, briefText, kurz, details);

  // Absolute first route: user confirms Jobcenter overpayment is correct.
  // Do not repeat amount, reference numbers or full Bescheid details.
  if (acceptedOverpaymentUltraShortV155(frage, currentContext)) {
    return acceptedOverpaymentUltraShortAnswerV155(frage);
  }

  return buildForcedChatAnswer_V154({ frage, frageMode, meta, briefText, kurz, details, historyText });
}



// ============================================================
// HILFE24 V16 FINAL ROUTER - CASE RELATION + ANSWER TYPES + TEMPLATE GUARD
// Purpose:
// 1) decide same_case/new_case/uncertain_case before answering
// 2) choose one of 8 answer types
// 3) block wrong templates
// 4) keep follow-up answers short
// Keep this block at the very end of server.js.
// ============================================================

function v16Norm(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9äöüßçğışİ\s@.\-\/]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function v16Has(text = "", patterns = []) {
  const q = v16Norm(text);
  return patterns.some((p) => typeof p === "string" ? q.includes(v16Norm(p)) : p.test(q));
}

function v16Lang(frage = "", fallback = "de") {
  return detectUserLanguageFromQuestion(frage, fallback || "de");
}

function v16CurrentContext(meta = {}, briefText = "", kurz = "", details = "") {
  return [
    JSON.stringify(meta || {}),
    briefText || "",
    kurz || "",
    details || ""
  ].join("\n").slice(0, 25000);
}

function v16IsPureFormatOrVagueWrite(frage = "") {
  const q = v16Norm(frage);
  return /^(pdf|brief|mektup|dilekce|dilekçe|email|e mail|mail|antwort|cevap|schreib mir eine antwort|schreib antwort|benim icin cevap yaz|bana cevap yaz|yaz|hazirla|hazırla)$/.test(q);
}

function v16DetectCaseRelation({ frage = "", meta = {}, briefText = "", kurz = "", details = "", historyText = "" }) {
  const q = v16Norm(frage);
  const current = v16Norm(v16CurrentContext(meta, briefText, kurz, details));

  if (v16Has(q, [
    /neuer brief|neues schreiben|anderer brief|anderes thema|anderer fall|neuer fall|neues anliegen|jetzt geht es um|jetzt habe ich|başka|baska|simdi baska|şimdi başka|bu baska|bu başka|new case|another case/
  ])) {
    return {
      caseRelation: "new_case",
      confidence: 0.95,
      reason: "Nutzer signalisiert neues Thema oder neuen Brief.",
      useOldCaseData: false,
      ignoreOldChatHistory: true,
      needsClarification: false,
      clarificationQuestion: ""
    };
  }

  if (v16Has(q, [/mein freund hat auch|meine freundin hat auch|arkadasimda|arkadasim da|başka biri|baska biri|anderer person|andere person|für meinen freund|fur meinen freund/])) {
    return {
      caseRelation: "new_case",
      confidence: 0.85,
      reason: "Andere Person oder anderer Fall wird erwähnt.",
      useOldCaseData: false,
      ignoreOldChatHistory: true,
      needsClarification: false,
      clarificationQuestion: ""
    };
  }

  if (v16Has(q, [/fehler|falsch|stimmt nicht|yanlis|yanlış|ich verstehe nicht|anlamadim|anlamadım|kannst du mir helfen|hilf mir$/]) && q.length < 45) {
    const lang = v16Lang(frage);
    return {
      caseRelation: "uncertain_case",
      confidence: 0.45,
      reason: "Kurze unklare Aussage ohne klare Fallzuordnung.",
      useOldCaseData: false,
      ignoreOldChatHistory: true,
      needsClarification: true,
      clarificationQuestion: lang === "tr" ? "Bu soru önceki mektupla mı ilgili, yoksa yeni bir konu mu?" : "Geht es noch um den vorherigen Brief oder ist das ein neuer Fall?"
    };
  }

  if (v16Has(q, [
    /was soll ich|was muss ich|wie geht es weiter|welche unterlagen|schreib mir|mach mir|ich kann das nicht zahlen|nicht zahlen|tamam dogru|tamam doğru|bunu odedim|bunu ödedim|evet|danke|ok|okay|an wen|hangi belgeler|simdi ne yapayim|şimdi ne yapayım/
  ])) {
    return {
      caseRelation: "same_case",
      confidence: 0.8,
      reason: "Typische Folgefrage oder Bestätigung zum aktuellen Fall.",
      useOldCaseData: true,
      ignoreOldChatHistory: false,
      needsClarification: false,
      clarificationQuestion: ""
    };
  }

  if (current.length > 20) {
    return {
      caseRelation: "same_case",
      confidence: 0.65,
      reason: "Aktueller Briefkontext ist vorhanden und kein Fallwechsel-Signal erkannt.",
      useOldCaseData: true,
      ignoreOldChatHistory: false,
      needsClarification: false,
      clarificationQuestion: ""
    };
  }

  const lang = v16Lang(frage);
  return {
    caseRelation: "uncertain_case",
    confidence: 0.4,
    reason: "Kein sicherer aktueller Fall erkennbar.",
    useOldCaseData: false,
    ignoreOldChatHistory: true,
    needsClarification: true,
    clarificationQuestion: lang === "tr" ? "Bu soru önceki mektupla mı ilgili, yoksa yeni bir konu mu?" : "Geht es um den vorherigen Brief oder um einen neuen Fall?"
  };
}

function v16DetectCaseGroupAndType(currentContext = "", frage = "") {
  const t = v16Norm(`${frage}\n${currentContext}`);

  const result = { caseGroup: "unknown", caseType: "unknown_document", riskLevel: "medium" };

  if (v16Has(t, [/amtsgericht|landgericht|gericht|staatsanwaltschaft|polizei|anklage|straf|ladung|umladung|hauptverhandlung|strafbefehl|bussgeld|bußgeld|mahkeme|savcilik|savcılık|duruşma|durusma|avukat|anwalt|pflichtverteidiger|beratungshilfe/])) return { caseGroup: "court_police", caseType: v16Has(t, [/avukat|anwalt|beratungshilfe|pflichtverteidiger/]) ? "legal_aid" : "court_letter", riskLevel: "high" };
  if (v16Has(t, [/inkasso|mahnung|forderung|glaubiger|gläubiger|gerichtsvollzieher|vollstreckung|vermogensauskunft|vermögensauskunft|mahnbescheid|pfandung|pfändung/])) return { caseGroup: "debt_collection", caseType: "debt_collection_letter", riskLevel: "high" };
  if (v16Has(t, [/p konto|p-konto|pfandungsschutzkonto|pfändungsschutzkonto|kontopfandung|kontopfändung|bank|sparkasse|postbank|lastschrift zuruck|lastschrift zurück|konto gesperrt/])) return { caseGroup: "banking", caseType: "bank_garnishment_or_account", riskLevel: "high" };
  if (v16Has(t, [/finanzamt|steuernummer|einkommensteuer|steuerbescheid|saumniszuschlag|säumniszuschlag|steuer|zoll/])) return { caseGroup: "tax_office", caseType: "tax_letter", riskLevel: "high" };
  if (v16Has(t, [/jobcenter|burgergeld|buergergeld|bürgergeld|sgb ii|aufrechnung|rueckforderung|rückforderung|bedarfsgemeinschaft|sozialamt|wohngeld|grundsicherung|mitwirkung/])) return { caseGroup: "social_benefits", caseType: v16Has(t, [/rueckforderung|rückforderung|aufrechnung|zu viel|fazla/]) ? "jobcenter_overpayment" : "social_benefit_letter", riskLevel: "medium" };
  if (v16Has(t, [/pflegekasse|pflegegrad|pflegegeld|mdk|medizinischer dienst|entlastungsbetrag|verhinderungspflege|kurzzeitpflege/])) return { caseGroup: "care_insurance", caseType: "care_level_or_care_benefit", riskLevel: "medium" };
  if (v16Has(t, [/rentenversicherung|rentenkasse|erwerbsminderung|erwerbsminderungsrente|reha|kontenklarung|kontenklärung|versicherungsverlauf/])) return { caseGroup: "pension_insurance", caseType: "pension_or_rehab", riskLevel: "medium" };
  if (v16Has(t, [/schwerbehindert|gdb|grad der behinderung|merkzeichen|versorgungsamt|behindertenausweis/])) return { caseGroup: "disability_office", caseType: "gdb_or_disability_card", riskLevel: "medium" };
  if (v16Has(t, [/krankenkasse|krankenversicherung|zahnarzt|zahn|dzr|rechnung|pzr|goz|bema|zuzahlung|krankengeld|hilfsmittel|medizin|arzt|doktor|sigorta|geri odeme|geri ödeme|fatura/])) return { caseGroup: "health_insurance", caseType: v16Has(t, [/dzr|zahnarzt|zahn|pzr|goz|bema/]) ? "dental_or_dzr_invoice" : "health_insurance_letter", riskLevel: "low" };
  if (v16Has(t, [/finanz schutzbrief|finanz-schutzbrief|versicherungsschein|kreditanfrage|kredit|kredi|schutzbrief|vertrag|widerruf|kundigung|kündigung|abo|sepa|lastschrift|sigorta iptal/])) return { caseGroup: "contracts", caseType: "insurance_or_contract", riskLevel: "medium" };
  if (v16Has(t, [/vermieter|miete|nebenkosten|kaution|raumung|räumung|wohnung|hausverwaltung|heizung|mietschulden/])) return { caseGroup: "housing", caseType: "housing_or_rent", riskLevel: v16Has(t, [/raumung|räumung|kündigung|kundigung/]) ? "high" : "medium" };
  if (v16Has(t, [/arbeitgeber|arbeitnehmer|lohn|gehalt|abmahnung|arbeitszeugnis|krankmeldung|schuldanerkenntnis|lohnabtretung|personalabteilung|kündigung|kundigung/])) return { caseGroup: "employment", caseType: "employment_letter", riskLevel: v16Has(t, [/kündigung|kundigung|schuldanerkenntnis|lohnabtretung/]) ? "high" : "medium" };
  if (v16Has(t, [/familienkasse|kindergeld|kinderzuschlag|unterhaltsvorschuss|jugendamt|kita|schule|klassenfahrt|bildung und teilhabe|but|schulessen/])) return { caseGroup: "family_school", caseType: "family_or_school_benefit", riskLevel: "low" };
  if (v16Has(t, [/auslanderbehorde|ausländerbehörde|aufenthalt|visum|duldung|arbeitserlaubnis|einburgerung|einbürgerung|abschiebung|bamf/])) return { caseGroup: "immigration", caseType: "immigration_letter", riskLevel: v16Has(t, [/abschiebung|frist|ablehnung/]) ? "high" : "medium" };
  if (v16Has(t, [/bussgeld|bußgeld|blitzer|fahrverbot|punkt|kfz|zulassungsstelle|tuv|tüv|unfall|werkstatt|fahrzeugsteuer/])) return { caseGroup: "vehicle_traffic", caseType: "vehicle_or_traffic", riskLevel: v16Has(t, [/fahrverbot|frist|einspruch/]) ? "high" : "medium" };
  if (v16Has(t, [/bestellung|retoure|rucksendung|rücksendung|reklamation|garantie|gewahrleistung|gewährleistung|online shop|rückerstattung|ruckerstattung|fitnessstudio|streaming/])) return { caseGroup: "consumer_contracts", caseType: "consumer_contract", riskLevel: "low" };

  return result;
}

function v16DetectUserGoal(frage = "", currentContext = "", caseGroup = "") {
  const q = v16Norm(frage);
  const all = v16Norm(`${frage}\n${currentContext}`);

  if (v16Has(q, [/tamam dogru|tamam doğru|evet dogru|evet doğru|stimmt|ja richtig|zu viel bekommen|fazla para aldik|fazla para aldık|fazla odeme|fazla ödeme|ueberzahlung|überzahlung/]) && caseGroup === "social_benefits") return "accepted_overpayment";
  if (v16Has(q, [/geri al|geri odeme|geri ödeme|erstattung|zuruckbekommen|zurückbekommen|kostenubernahme|kostenübernahme|sigortadan|krankenkasse|versicherung.*zahlen|refund|reimburse/])) return "reimbursement";
  if (v16Has(q, [/taksit|ratenzahlung|rate|stundung|nicht zahlen|nicht bezahlen|kann das nicht zahlen|odeyemem|ödeyemem|para yok/])) return "payment_problem";
  if (v16Has(q, [/bunu odedim|bunu ödedim|schon bezahlt|bereits bezahlt|zahlungsnachweis|dekont|uberwiesen|überwiesen/])) return "paid_proof";
  if (v16Has(q, [/widerruf|kundigen|kündigen|kündigung|kundigung|iptal|fesih|vertrag los|sigortayi sil|sigortayı sil|kredi olmadi|kredi olmadı/])) return "contract_cancel";
  if (v16Has(q, [/avukat|anwalt|beratungshilfe|pflichtverteidiger|para odemeden|para ödemeden|rechtliche hilfe/])) return "legal_aid";
  if (v16Has(q, [/widerspruch|einspruch|itiraz|stimmt nicht|falsch|bestreiten|ablehnung|abgelehnt/])) return "appeal_or_dispute";
  if (v16Has(q, [/welche unterlagen|hangi belgeler|was brauche ich|mitnehmen|checkliste|liste|tek tek/])) return "documents_checklist";
  if (v16Has(q, [/was soll ich|was muss ich|ne yapayim|ne yapayım|nasil yapayim|nasıl yapayım|wie weiter|nächster schritt|nachster schritt/])) return "guidance";
  if (v16Has(q, [/frist|termin|bis wann|deadline|duruşma|durusma/])) return "deadline_or_appointment";
  if (v16Has(q, [/was passiert|wenn ich nichts|folge|konsequenz|ne olur/])) return "consequence";
  if (v16Has(q, [/was bedeutet|ne demek|anlami|anlamı|erklare|erklär|verstehe nicht/])) return "understand";
  if (v16Has(all, [/pflegegrad|pflegegeld|rente|reha|schwerbehindert|gdb|kinderzuschlag|unterhaltsvorschuss|wohngeld|was kann ich bekommen|steht mir zu/])) return "benefit_check";
  return "answer_question";
}

function v16RequestedFormat(frage = "", frageMode = "") {
  if (wantsBothEmailAndPdf(frage, frageMode)) return "both";
  if (wantsPdfOutput(frage, frageMode)) return "pdf";
  if (wantsEmailOutput(frage, frageMode)) return "email";
  return "none";
}

function v16IsWriteRequest(frage = "", frageMode = "") {
  const q = v16Norm(`${frage} ${frageMode}`);
  return v16RequestedFormat(frage, frageMode) !== "none" || v16Has(q, [/schreib|formuliere|erstelle|mach mir|vorlage|antwort schreiben|dilekce|dilekçe|mektup|hazirla|hazırla|e posta|eposta|mail|yaz/]);
}

function v16DetectAnswerType({ frage = "", caseRelation = {}, userGoal = "", riskLevel = "medium", requestedFormat = "none", isWriteRequest = false, caseGroup = "" }) {
  const q = v16Norm(frage);

  if (caseRelation.caseRelation === "uncertain_case" && caseRelation.needsClarification) return "clarification";

  if (v16Has(q, [/nein|hayir|hayır|falsch|yanlis|yanlış|ich bin|ben .* annesiyim|mutter|vater|tochter|sohn|adresse raus|name falsch|nicht der|nicht die|korrigier/])) return "correction_confirmed";

  if (isWriteRequest && requestedFormat === "email") return "draft_email";
  if (isWriteRequest && requestedFormat === "pdf") return "draft_pdf";
  if (isWriteRequest && requestedFormat === "both") return "draft_email";
  if (isWriteRequest && requestedFormat === "none") return "clarification";

  if (riskLevel === "high" && userGoal === "deadline_or_appointment") return "warning";
  if (userGoal === "consequence" || v16Has(q, [/frist lauft|frist läuft|morgen ab|haftbefehl|raumung|räumung|vollstreckung|pfandung|pfändung/])) return "warning";

  if (userGoal === "documents_checklist" || v16Has(q, [/checkliste|hangi belgeler|welche unterlagen|was brauche ich|tek tek/])) return "checklist";
  if (userGoal === "guidance" || userGoal === "payment_problem" || userGoal === "paid_proof" || userGoal === "contract_cancel") return "next_steps";
  return "short_answer";
}

function v16TemplateRules(caseGroup = "unknown", caseType = "unknown_document", userGoal = "answer_question") {
  const base = {
    allowedTemplates: ["general_answer"],
    forbiddenTemplates: [],
    targetParty: "Stelle aus dem Schreiben",
    selectedTemplate: "general_answer"
  };

  const set = (targetParty, selectedTemplate, allowedTemplates, forbiddenTemplates) => ({ targetParty, selectedTemplate, allowedTemplates, forbiddenTemplates });

  if (caseGroup === "social_benefits") return set("Jobcenter / Sozialamt / zuständige Leistungsstelle", userGoal === "accepted_overpayment" ? "lower_deduction_request" : userGoal === "payment_problem" ? "stundung_request" : userGoal === "appeal_or_dispute" ? "objection_request" : "social_review_request", ["lower_deduction_request", "stundung_request", "payment_plan_request", "objection_request", "submit_documents", "deadline_extension", "social_review_request", "general_answer"], ["insurance_reimbursement", "dzr_installment", "legal_aid_request", "contract_cancellation"]);
  if (caseGroup === "health_insurance") {
    const reimbursement = userGoal === "reimbursement" || v16Has(userGoal, ["reimbursement"]);
    return set(reimbursement ? "Krankenkasse / Versicherung" : "Krankenkasse / Rechnungssteller", reimbursement ? "insurance_reimbursement" : userGoal === "payment_problem" ? "medical_installment_request" : "health_review_request", ["insurance_reimbursement", "cost_coverage_request", "submit_payment_proof", "medical_installment_request", "invoice_clarification", "health_review_request", "general_answer"], ["legal_aid_request", "contract_cancellation", "court_response"]);
  }
  if (caseGroup === "care_insurance") return set("Pflegekasse", "care_request", ["care_level_application", "care_level_objection", "upgrade_request", "care_aid_request", "submit_documents", "general_answer"], ["dzr_installment", "contract_cancellation", "legal_aid_request"]);
  if (caseGroup === "pension_insurance") return set("Deutsche Rentenversicherung", "pension_request", ["pension_objection", "rehab_application", "disability_pension_application", "submit_documents", "account_clarification", "general_answer"], ["insurance_reimbursement", "dzr_installment", "contract_cancellation"]);
  if (caseGroup === "disability_office") return set("Versorgungsamt / zuständige Behörde", "gdb_request", ["disability_application", "gdb_objection", "gdb_increase_request", "merkzeichen_request", "submit_documents", "general_answer"], ["pflegegrad_application", "insurance_reimbursement", "dzr_installment"]);
  if (caseGroup === "court_police") return set("Gericht / Rechtsantragstelle / zuständige Stelle", userGoal === "legal_aid" ? "legal_aid_request" : "court_clarification", ["legal_aid_request", "public_defender_check", "appointment_reschedule", "sickness_notice_to_court", "neutral_court_response", "court_clarification", "general_answer"], ["insurance_reimbursement", "dzr_installment", "contract_cancellation", "debt_acknowledgement", "confession_template"]);
  if (caseGroup === "debt_collection") return set("Inkassobüro / Gläubiger", userGoal === "payment_problem" ? "installment_offer" : userGoal === "appeal_or_dispute" ? "dispute_debt" : "request_debt_breakdown", ["request_debt_breakdown", "request_proof", "dispute_debt", "installment_offer", "stundung_request", "submit_payment_proof", "without_admission_response", "general_answer"], ["debt_acknowledgement", "insurance_reimbursement", "legal_aid_request"]);
  if (caseGroup === "contracts") return set("Vertragspartner / Versicherung / Anbieter", "contract_cancellation", ["withdrawal_request", "contract_cancellation", "proof_of_contract_request", "stop_direct_debit_request", "refund_request", "contract_copy_request", "general_answer"], ["insurance_reimbursement", "dzr_installment", "jobcenter_objection", "legal_aid_request"]);
  if (caseGroup === "banking") return set("Bank / Gläubiger / Vollstreckungsgericht", "bank_clarification", ["p_account_clarification", "garnishment_clarification", "chargeback_request", "bank_contact_request", "submit_proof", "general_answer"], ["insurance_reimbursement", "dzr_installment", "contract_cancellation"]);
  if (caseGroup === "tax_office") return set("Finanzamt", userGoal === "payment_problem" ? "tax_stundung_request" : "tax_clarification", ["tax_objection_check", "tax_stundung_request", "tax_installment_request", "submit_tax_documents", "tax_clarification", "general_answer"], ["jobcenter_objection", "insurance_reimbursement", "dzr_installment"]);
  if (caseGroup === "housing") return set("Vermieter / Hausverwaltung / zuständige Stelle", "housing_request", ["utility_bill_review_request", "request_receipts_inspection", "deposit_return_request", "defect_notice", "rent_debt_installment", "housing_help_request", "general_answer"], ["insurance_reimbursement", "dzr_installment", "court_criminal_response"]);
  if (caseGroup === "employment") return set("Arbeitgeber / Personalabteilung", "employment_request", ["request_payslip", "request_employment_certificate", "sick_note_submission", "repayment_review_request", "neutral_employer_response", "general_answer"], ["automatic_debt_acknowledgement", "wage_assignment_confirmation", "insurance_reimbursement", "dzr_installment"]);
  if (caseGroup === "family_school") return set("Jobcenter / Kommune / Schule / Familienkasse / Jugendamt", "family_benefit_request", ["but_cost_coverage_request", "school_trip_cost_request", "kita_fee_reduction_request", "child_benefit_request", "child_supplement_request", "advance_maintenance_request", "submit_documents", "general_answer"], ["insurance_reimbursement", "dzr_installment", "court_criminal_response"]);
  if (caseGroup === "immigration") return set("Ausländerbehörde / BAMF / zuständige Stelle", "immigration_request", ["submit_immigration_documents", "appointment_reschedule", "deadline_extension", "residence_request", "work_permit_request", "request_clarification", "general_answer"], ["insurance_reimbursement", "dzr_installment", "jobcenter_objection"]);
  if (caseGroup === "vehicle_traffic") return set("Bußgeldstelle / Versicherung / Zulassungsstelle", "traffic_vehicle_request", ["traffic_fine_objection_check", "installment_request", "insurance_claim_report", "submit_vehicle_documents", "request_clarification", "general_answer"], ["insurance_reimbursement", "dzr_installment", "jobcenter_objection"]);
  if (caseGroup === "consumer_contracts") return set("Unternehmen / Kundenservice", "consumer_request", ["withdrawal_request", "cancellation_request", "refund_request", "complaint_request", "warranty_claim", "proof_of_contract_request", "general_answer"], ["jobcenter_objection", "insurance_reimbursement", "dzr_installment", "court_criminal_response"]);

  return base;
}

function v16BuildRoute({ frage = "", frageMode = "", meta = {}, briefText = "", kurz = "", details = "", historyText = "" }) {
  const currentContext = v16CurrentContext(meta, briefText, kurz, details);
  const caseRelation = v16DetectCaseRelation({ frage, meta, briefText, kurz, details, historyText });
  const caseInfo = v16DetectCaseGroupAndType(currentContext, frage);
  const userGoal = v16DetectUserGoal(frage, currentContext, caseInfo.caseGroup);
  const requestedFormat = v16RequestedFormat(frage, frageMode);
  const isWriteRequest = v16IsWriteRequest(frage, frageMode);
  const answerType = v16DetectAnswerType({ frage, caseRelation, userGoal, riskLevel: caseInfo.riskLevel, requestedFormat, isWriteRequest, caseGroup: caseInfo.caseGroup });
  const rules = v16TemplateRules(caseInfo.caseGroup, caseInfo.caseType, userGoal);

  let selectedTemplate = rules.selectedTemplate;
  if (answerType === "draft_email" || answerType === "draft_pdf") {
    if (userGoal === "reimbursement") selectedTemplate = "insurance_reimbursement";
    if (userGoal === "payment_problem") selectedTemplate = caseInfo.caseGroup === "social_benefits" ? "lower_deduction_request" : "stundung_request";
    if (userGoal === "legal_aid") selectedTemplate = "legal_aid_request";
    if (userGoal === "contract_cancel") selectedTemplate = "contract_cancellation";
    if (userGoal === "paid_proof") selectedTemplate = "submit_payment_proof";
  }

  const templateAllowed = !rules.forbiddenTemplates.includes(selectedTemplate) && (rules.allowedTemplates.includes(selectedTemplate) || selectedTemplate === "general_answer");
  const needsClarification = caseRelation.needsClarification || answerType === "clarification" || ((answerType === "draft_email" || answerType === "draft_pdf") && (!templateAllowed || caseInfo.caseGroup === "unknown" || v16IsPureFormatOrVagueWrite(frage)));

  const lang = v16Lang(frage, getLanguageMeta("de").code);
  let clarificationQuestion = caseRelation.clarificationQuestion || "";
  if (!clarificationQuestion && needsClarification) {
    clarificationQuestion = lang === "tr"
      ? "Bunu nereye göndermek istiyorsun: mektuptaki yere mi, yoksa başka bir kuruma mı?"
      : "An wen soll die Antwort gehen: an die Stelle aus dem Brief oder an eine andere Stelle?";
  }

  return {
    caseRelation: caseRelation.caseRelation,
    caseConfidence: caseRelation.confidence,
    useOldCaseData: caseRelation.useOldCaseData,
    ignoreOldChatHistory: caseRelation.ignoreOldChatHistory,
    answerType: needsClarification ? "clarification" : answerType,
    caseGroup: caseInfo.caseGroup,
    caseType: caseInfo.caseType,
    userGoal,
    shouldCreateDraft: !needsClarification && (answerType === "draft_email" || answerType === "draft_pdf"),
    shouldAskClarification: needsClarification,
    repeatCaseDetails: ["draft_email", "draft_pdf"].includes(answerType) || userGoal === "deadline_or_appointment",
    requestedFormat,
    targetParty: rules.targetParty,
    selectedTemplate,
    allowedTemplates: rules.allowedTemplates,
    forbiddenTemplates: rules.forbiddenTemplates,
    templateAllowed,
    blockReason: templateAllowed ? "" : "Template passt nicht zu Falltyp und Nutzerziel.",
    riskLevel: caseInfo.riskLevel,
    maxLines: answerType === "warning" ? 2 : answerType === "checklist" ? 8 : answerType === "next_steps" ? 5 : answerType === "correction_confirmed" ? 3 : 5,
    userLanguage: lang,
    clarificationQuestion
  };
}

function v16ShortFollowup(frage = "", route = {}) {
  const lang = route.userLanguage || v16Lang(frage);
  if (lang === "tr") {
    if (route.userGoal === "accepted_overpayment") return acceptedOverpaymentUltraShortAnswerV155(frage);
    if (route.userGoal === "payment_problem") return cleanText(`Tamam, anladım.

Şimdi önemli olan ödeme şeklini yazılı istemek.

Seçenekler:
☐ Daha düşük taksit istemek
☐ Stundung (ödemeyi erteleme) istemek
☐ Önce borcun dökümünü istemek

İstersen sana kısa Almanca yazı hazırlayayım.`);
    if (route.userGoal === "paid_proof") return cleanText(`Tamam.

Aynı borcu tekrar ödeme.

Yapılacaklar:
☐ Ödeme dekontunu gönder
☐ Numara/Aktenzeichen yaz
☐ Ödemenin hesaba işlendiğine dair yazılı onay iste

İstersen sana kısa Almanca mesaj hazırlayayım.`);
    if (route.userGoal === "contract_cancel") return cleanText(`Bu durumda konu para iadesi değil, sözleşme iptali olabilir.

Yapılacaklar:
☐ Widerruf iste
☐ Hilfsweise Kündigung yaz
☐ Yeni ödeme çekilmemesini iste
☐ Yazılı onay iste

İstersen Almanca e-posta hazırlayayım.`);
    if (route.userGoal === "legal_aid") return cleanText(`Evet, Bürgergeld alıyorsanız avukat yardımı kontrol edilebilir.

Yapılacaklar:
☐ Mahkeme yazısı
☐ Aktenzeichen
☐ Güncel Jobcenter/Bürgergeld Bescheidi
☐ Kimlik
☐ Amtsgericht/Rechtsantragstelle’ye sor

Özellikle Strafsache varsa Pflichtverteidiger de sorulmalı.`);
    if (route.userGoal === "reimbursement") return cleanText(`Evet, sigortaya/Krankenkasse’ye gönderebilirsiniz. Geri ödeme garanti değildir; onlar kontrol eder.

Gerekenler:
☐ Fatura
☐ Ödeme dekontu
☐ Varsa detaylı Leistungsaufstellung

İstersen Almanca e-posta hazırlayayım.`);
  }

  if (route.userGoal === "accepted_overpayment") return acceptedOverpaymentUltraShortAnswerV155(frage);
  if (route.userGoal === "payment_problem") return cleanText(`Verstanden.

Jetzt geht es um die Zahlungsform.

Optionen:
☐ niedrigere Rate beantragen
☐ Stundung beantragen
☐ Forderungsaufstellung verlangen

Wenn du möchtest, schreibe ich dir einen kurzen deutschen Text.`);
  if (route.userGoal === "paid_proof") return cleanText(`Dann nicht nochmal zahlen.

Nächste Schritte:
☐ Zahlungsnachweis senden
☐ Nummer/Aktenzeichen nennen
☐ schriftliche Bestätigung verlangen

Wenn du möchtest, schreibe ich dir eine kurze Nachricht.`);
  if (route.userGoal === "contract_cancel") return cleanText(`Das ist eher ein Vertrags-/Kündigungsthema.

Nächste Schritte:
☐ Widerruf erklären
☐ hilfsweise kündigen
☐ weitere Abbuchungen stoppen lassen
☐ schriftliche Bestätigung verlangen`);
  if (route.userGoal === "legal_aid") return cleanText(`Das kann möglich sein, ist aber nicht garantiert.

Du brauchst:
☐ Gerichtsschreiben
☐ Aktenzeichen
☐ aktuellen Bürgergeld-/Jobcenter-Bescheid
☐ Ausweis

Frage beim Amtsgericht/Rechtsantragstelle nach Beratungshilfe und ggf. Pflichtverteidiger.`);
  if (route.userGoal === "reimbursement") return cleanText(`Das kann möglich sein, ist aber nicht sicher.

Nächste Schritte:
☐ Rechnung einreichen
☐ Zahlungsnachweis beilegen
☐ Erstattung/Kostenübernahme schriftlich prüfen lassen

Wenn du möchtest, schreibe ich dir eine E-Mail.`);
  return "";
}

function v16BuildChecklist(route = {}, meta = {}) {
  const lang = route.userLanguage || "de";
  const ref = getPrimaryReference(meta);
  if (lang === "tr") {
    const items = ["Mektup / belge", ref ? `Aktenzeichen/Numara: ${ref}` : "Aktenzeichen/Numara", "Kimlik", "Gelir belgesi veya Jobcenter Bescheidi varsa", "Ödeme dekontu varsa", "Eksik belgelerin kopyası"];
    return cleanText(`Kontrol listesi:

${items.slice(0, 6).map(x => `☐ ${x}`).join("\n")}

Sonraki adım: Bu belgelerle yetkili yere yazılı başvur.`);
  }
  const items = ["Brief / Schreiben", ref ? `Aktenzeichen/Nummer: ${ref}` : "Aktenzeichen/Nummer", "Ausweis", "Bescheid/Nachweis über Einkommen falls nötig", "Zahlungsnachweis falls vorhanden", "fehlende Unterlagen als Kopie"];
  return cleanText(`Checkliste:

${items.slice(0, 6).map(x => `☐ ${x}`).join("\n")}

Nächster Schritt: Mit diesen Unterlagen schriftlich bei der zuständigen Stelle melden.`);
}

function v16Warning(route = {}, meta = {}, frage = "") {
  const lang = route.userLanguage || v16Lang(frage);
  if (lang === "tr") return "Dikkat: Burada süre, mahkeme/termin, icra veya para riski olabilir. Bunu bekletmeyin; emin değilseniz yetkili yere veya danışma yerine hemen sorun.";
  return "Achtung: Hier kann eine Frist, ein Termin, Vollstreckung oder ein Geldrisiko wichtig sein. Nicht liegen lassen; bei Unsicherheit sofort bei der zuständigen Stelle oder Beratung nachfragen.";
}

function v16CorrectionConfirmed(frage = "") {
  const lang = v16Lang(frage);
  if (lang === "tr") return cleanText(`Tamam, düzeltiyorum.

Bu bilgiyi artık dikkate alacağım.

İstersen metni buna göre yeniden hazırlayayım.`);
  return cleanText(`Verstanden, ich korrigiere das.

Diese Angabe wird jetzt berücksichtigt.

Wenn du möchtest, erstelle ich den Text damit neu.`);
}

function v16BuildDraft(route = {}, meta = {}, context = "") {
  const fmt = route.answerType === "draft_email" ? "email" : "pdf";
  const group = route.caseGroup;
  const goal = route.userGoal;

  if (group === "court_police" && goal === "legal_aid") {
    const pdf = buildLegalAidPdfOutputV15(meta, context);
    if (fmt === "email") return cleanText(`Empfänger: Amtsgericht / Rechtsantragstelle

${pdf.replace(/^PDF-BRIEF:\s*/i, "")}`);
    return pdf;
  }

  if (group === "contracts" || goal === "contract_cancel") {
    if (fmt === "email") return buildProfessionalOutput(meta, context, "vertrag_versicherung", "cancel");
    return buildPdfOnlyOutput(meta, context, "vertrag_versicherung", "cancel");
  }

  if (goal === "reimbursement") {
    if (fmt === "email") return buildProfessionalOutput(meta, context, "gesundheit", "reimbursement");
    return buildPdfOnlyOutput(meta, context, "gesundheit", "reimbursement");
  }

  if (goal === "payment_problem") {
    const domain = group === "tax_office" ? "finanzamt" : group === "debt_collection" ? "inkasso" : group === "employment" ? "arbeit" : detectDomain(context);
    const intent = group === "health_insurance" && route.caseType === "dental_or_dzr_invoice" ? "installments" : "no_money";
    if (fmt === "email") return buildProfessionalOutput(meta, context, domain, intent);
    return buildPdfOnlyOutput(meta, context, domain, intent);
  }

  if (goal === "paid_proof") {
    const domain = detectDomain(context);
    if (fmt === "email") return buildProfessionalOutput(meta, context, domain, "paid");
    return buildPdfOnlyOutput(meta, context, domain, "paid");
  }

  const domain = detectDomain(context);
  if (fmt === "email") return buildProfessionalOutput(meta, context, domain, "reply");
  return buildPdfOnlyOutput(meta, context, domain, "pdf");
}

function v16BuildAnswer(route = {}, meta = {}, context = "", frage = "") {
  if (route.answerType === "clarification") return route.clarificationQuestion;
  if (route.answerType === "correction_confirmed") return v16CorrectionConfirmed(frage);
  if (route.answerType === "warning") return v16Warning(route, meta, frage);
  if (route.answerType === "checklist") return v16BuildChecklist(route, meta);
  if (route.answerType === "draft_email" || route.answerType === "draft_pdf") return v16BuildDraft(route, meta, context);

  const follow = v16ShortFollowup(frage, route);
  if (follow) return follow;

  const lang = route.userLanguage || v16Lang(frage);
  if (route.answerType === "next_steps") {
    if (lang === "tr") return cleanText(`Yapılacaklar:
☐ Önce yazıdaki süre/numara/bilgileri kontrol et
☐ Yetkili yere yazılı sor
☐ Cevabı sakla
☐ Gerekirse belge ekle

İstersen sana kısa Almanca mesaj hazırlayayım.`);
    return cleanText(`Nächste Schritte:
☐ Frist, Nummer und Betrag prüfen
☐ zuständige Stelle schriftlich kontaktieren
☐ Antwort/Nachweis aufbewahren
☐ falls nötig Unterlagen beilegen

Wenn du möchtest, schreibe ich dir einen kurzen Text.`);
  }

  if (lang === "tr") return cleanText(`Kısaca: Bu konuda kesin karar veremem, ama yazılı olarak kontrol ettirmek güvenli yoldur.

Sonraki adım: Yetkili yere kısa bir mesaj gönderip yazılı cevap iste.

İstersen sana Almanca metin hazırlayayım.`);
  return cleanText(`Kurz gesagt: Das sollte schriftlich geprüft werden. Eine sichere Entscheidung kann nur die zuständige Stelle treffen.

Nächster Schritt: Stelle kurz anschreiben und schriftliche Antwort verlangen.

Wenn du möchtest, formuliere ich dir den Text.`);
}

// V16.1: Do not capture buildForcedChatAnswer here. Function declarations are hoisted, so capturing by name can capture this final wrapper itself.
// Use the last legacy router explicitly as fallback to avoid accidental recursion.
const buildForcedChatAnswer_BEFORE_V16 = (typeof buildForcedChatAnswer_LEGACY_5 === "function")
  ? buildForcedChatAnswer_LEGACY_5
  : function () { return ""; };
function buildForcedChatAnswer({ frage, frageMode, meta, briefText, kurz, details, historyText }) {
  const currentContext = v16CurrentContext(meta, briefText, kurz, details);
  const route = v16BuildRoute({ frage, frageMode, meta, briefText, kurz, details, historyText });

  // V16 owns all follow-up/guidance/draft/correction routes.
  if (["clarification", "correction_confirmed", "warning", "checklist", "next_steps", "short_answer", "draft_email", "draft_pdf"].includes(route.answerType)) {
    return v16BuildAnswer(route, meta, currentContext, frage);
  }

  return buildForcedChatAnswer_BEFORE_V16({ frage, frageMode, meta, briefText, kurz, details, historyText });
}
