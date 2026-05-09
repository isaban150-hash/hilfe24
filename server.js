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
  res.json({ ok: true, message: "Server läuft sauber", version: "v9.9-pdf-trigger-name-fix" });
});

function getTodayGerman() {
  return new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getLanguageMeta(lang) {
  switch ((lang || "de").toLowerCase()) {
    case "tr": return { code: "tr", label: "Türkisch", ttsLanguageCode: "tr-TR", ttsGender: "FEMALE" };
    case "bg": return { code: "bg", label: "Bulgarisch", ttsLanguageCode: "bg-BG", ttsGender: "FEMALE" };
    case "ar": return { code: "ar", label: "Arabisch", ttsLanguageCode: "ar-XA", ttsGender: "FEMALE" };
    case "ro": return { code: "ro", label: "Rumänisch", ttsLanguageCode: "ro-RO", ttsGender: "FEMALE" };
    case "en": return { code: "en", label: "Englisch", ttsLanguageCode: "en-US", ttsGender: "FEMALE" };
    default: return { code: "de", label: "Deutsch", ttsLanguageCode: "de-DE", ttsGender: "FEMALE" };
  }
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
  return hasAny(q, ["pdf", "pdf-brief", "brief als pdf", "als pdf", "download", "herunterladen", "ausdrucken"]);
}

function wantsEmailOutput(frage = "", frageMode = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();
  return hasAny(q, ["e-mail", "email", "mail", "per mail"]);
}

function wantsBothEmailAndPdf(frage = "", frageMode = "") {
  return wantsPdfOutput(frage, frageMode) && wantsEmailOutput(frage, frageMode);
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
    "beitragsservice", "stadt", "gemeinde", "landkreis", "agentur", "service", "verwaltung"
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
  return hasAny(q, ["schreib", "schreibe", "antwort", "professionelle antwort", "e-mail", "email", "mail", "brief", "vorlage", "fertig", "formuliere", "pdf", "text", "mach mir"]);
}

function detectIntent(frage = "", frageMode = "", historyText = "") {
  const q = String(`${frage} ${frageMode}`).toLowerCase();

  if (/^(ok|okay|danke|alles klar|verstanden|passt|ja)$/i.test(normalizeString(frage))) return "smalltalk";

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

function getRecipientLine(meta = {}, context = "") {
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
  const recipientAddress = getRecipientPostalAddress(meta, context);
  const subject = buildSubject(meta, domain, intent === "cancel" ? "cancel" : intent, context);
  const bodyIntent = intent === "pdf" ? inferIntentFromHistory(context) : intent;
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
  const recipient = getRecipientLine(meta, context);
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
  const intent = detectIntent(frage, frageMode, historyText);
  const wantsPdf = wantsPdfOutput(frage, frageMode);
  const wantsEmail = wantsEmailOutput(frage, frageMode);
  const wantsBoth = wantsBothEmailAndPdf(frage, frageMode);

  if (intent === "smalltalk") return "Gerne. Schreib deine nächste Frage.";

  // V9.6: Nutzerwunsch gewinnt. Kündigen/Widerrufen darf nicht zur Forderungsprüfung werden.
  if (wantsBoth) {
    const finalIntent = intent === "cancel" ? "cancel" : (intent || "reply");
    return buildEmailAndPdfOutput(meta, context, domain, finalIntent === "pdf" ? "reply" : finalIntent);
  }

  if (intent === "cancel") {
    if (wantsPdf) return buildPdfOnlyOutput(meta, context, domain, "cancel");
    return buildProfessionalOutput(meta, context, domain, "cancel");
  }

  if (intent === "pdf") {
    const rememberedIntent = inferIntentFromHistory(historyText || context);
    return buildPdfOnlyOutput(meta, context, domain, rememberedIntent && rememberedIntent !== "reply" ? rememberedIntent : "pdf");
  }
  if (intent === "reply") {
    if (wantsPdf) return buildEmailAndPdfOutput(meta, context, domain, "reply");
    return buildProfessionalOutput(meta, context, domain, "reply");
  }

  if (intent === "no_money") {
    if (wantsPdf) return buildPdfOnlyOutput(meta, context, domain, "no_money");
    if (wantsWrittenOutput(frage, frageMode)) return buildProfessionalOutput(meta, context, domain, "no_money");
    return buildNoMoneyShort(meta, domain);
  }
  if (intent === "installments") {
    if (wantsPdf) return buildEmailAndPdfOutput(meta, context, domain, "installments");
    return buildProfessionalOutput(meta, context, domain, "installments");
  }
  if (intent === "paid") {
    if (wantsPdf) return buildPdfOnlyOutput(meta, context, domain, "paid");
    return buildProfessionalOutput(meta, context, domain, "paid");
  }
  if (intent === "sent_proof") {
    if (wantsPdf) return buildPdfOnlyOutput(meta, context, domain, "sent_proof");
    return buildProfessionalOutput(meta, context, domain, "sent_proof");
  }
  if (intent === "dispute") {
    if (wantsPdf) return buildPdfOnlyOutput(meta, context, domain, "dispute");
    return buildProfessionalOutput(meta, context, domain, "dispute");
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

    const parts = [{ text: `Du bist Hilfe24. Prüfe nur die kritischen Daten aus den Fotos: Empfänger, betroffene Person, Absender, Datum, Nummern, Betrag, Frist, Termin. Antworte kurz in ${langMeta.label}. Nichts erfinden. IBAN/BIC/Telefon nicht als Aktenzeichen bezeichnen.` }];
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

    // V9.6: Qualitäts-Router läuft bewusst VOR Gemini.
    // Alte Testbrief-Sonderfälle dominieren nicht mehr.
    const forcedAnswer = buildForcedChatAnswer({
      frage,
      frageMode,
      meta,
      briefText,
      kurz: erklaerungKurz,
      details: erklaerungDetails,
      historyText: chatHistoryText
    });

    if (forcedAnswer) return res.json({ ok: true, antwort: forcedAnswer });

    const raw = await callGemini([{ text: `
Du bist Hilfe24, ein einfacher Alltagshelfer für Briefe.

Sprache des Nutzers: ${langMeta.label}
Heutiges Datum: ${getTodayGerman()}

Regeln:
- Antworte kurz, praktisch und menschlich.
- Nicht auf alte Testbriefe fixieren.
- P-Konto nur erwähnen, wenn wirklich P-Konto/Kontopfändung/Freibetrag im Kontext steht.
- Wenn es um Versicherung/Online-Vertrag/Kredit-Anfrage geht: Widerruf/Kündigung/Vertragsprüfung erklären.
- Firma/Absender niemals als Unterschrift verwenden.
- IBAN/BIC/Telefon/Adresse niemals als Aktenzeichen verwenden.
- Bei offiziellen Antworten an deutsche Stellen: Deutsch verwenden.

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
  console.log("Server läuft auf Port " + PORT + " | Hilfe24 v9.9 pdf trigger + name fix");
});
