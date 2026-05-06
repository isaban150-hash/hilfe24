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

app.use(express.json({ limit: "45mb" }));
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


function shortenNextStepsAnswer(text, lang) {
  const clean = cleanText(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!clean) return "";

  const maxCharsByLang = {
    de: 430,
    tr: 430,
    bg: 500,
    ro: 500,
    en: 430,
    ar: 550
  };

  const maxChars = maxCharsByLang[lang] || 430;

  if (clean.length <= maxChars) {
    return clean;
  }

  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const keep = [];
  let total = 0;

  for (const line of lines) {
    const isHeading = line.endsWith(":");
    const isNumberedStep = /^\d+\./.test(line);

    if (isHeading) {
      keep.push(line);
      total += line.length + 1;
      continue;
    }

    if (isNumberedStep && keep.filter((x) => /^\d+\./.test(x)).length >= 3) {
      continue;
    }

    const nextTotal = total + line.length + 1;

    if (nextTotal > maxChars) {
      break;
    }

    keep.push(line);
    total = nextTotal;

    if (keep.length >= 8) break;
  }

  let result = keep.join("\n").trim();

  if (!result || result.length < 80) {
    result = clean.slice(0, maxChars).trim();
  }

  const sentenceEndings = [".", "!", "?", "؟"];
  const lastDot = Math.max(
    result.lastIndexOf("."),
    result.lastIndexOf("!"),
    result.lastIndexOf("?"),
    result.lastIndexOf("؟")
  );

  if (lastDot > 120) {
    result = result.slice(0, lastDot + 1).trim();
  }

  result = result.replace(/[,\s]+$/, "");

  if (!sentenceEndings.some((ending) => result.endsWith(ending))) {
    result += ".";
  }

  return result;
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

function normalizeActionArray(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item) return "";

      if (typeof item === "string") {
        return normalizeString(item);
      }

      if (typeof item === "object") {
        return normalizeString(
          item.label ||
          item.title ||
          item.name ||
          item.text ||
          item.action ||
          item.value ||
          item.code ||
          ""
        );
      }

      return normalizeString(item);
    })
    .filter((item) => item && item !== "[object Object]");
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

    passende_aktionen: normalizeActionArray(info.passende_aktionen)
  };
}


function buildHilfe24TextSystemRules() {
  return `
HILFE24-TEXTSYSTEM:
Schreibe nach diesen festen Regeln:

Human:
- Natürlich, ruhig und menschlich schreiben.
- Nicht wie Behörde, nicht wie Werbung, nicht wie ein langer KI-Aufsatz.

EL5:
- So einfach erklären, dass auch Menschen mit wenig Deutsch oder wenig Behördenwissen es verstehen.
- Kurze Sätze. Einfache Wörter. Eine Aussage pro Satz.
- Fachbegriffe direkt einfach erklären, wenn sie wichtig sind.

DLTR:
- Keine Romane. Keine Textwände. Keine unnötigen Details.
- Nur das schreiben, was der Nutzer jetzt wirklich braucht.

Listify:
- Wenn mehrere Punkte wichtig sind, kurze Listen nutzen.
- Maximal 3 bis 5 Punkte, außer der Nutzer fragt ausdrücklich nach mehr.

DataSafe:
- Namen, Beträge, Fristen, Termine, Aktenzeichen, Kundennummern und Rechnungsnummern nie raten.
- Wenn ein Wert nicht sicher lesbar ist: "Bitte prüfen" oder in unsicherheiten eintragen.
- Wenn mehrere Varianten möglich sind, keine Variante behaupten.

ActionFirst:
- Immer den nächsten praktischen Schritt nennen.
- Nicht nur erklären, sondern führen.

NoGuess:
- Keine Fristen, Folgen, Diagnosen, Ansprüche oder Zahlungen erfinden.
- Keine rechtliche Sicherheit behaupten.

AskOnlyWhenNeeded:
- Keine langen Antwortvorlagen automatisch erstellen.
- Antwort, Widerspruch, Ratenzahlung, Terminabsage oder E-Mail nur erstellen, wenn der Nutzer danach fragt oder eine Aktion auswählt.

Kurz erklärt:
- 3 bis maximal 5 kurze Sätze.
- Der Nutzer muss sofort verstehen: Was ist das? Worum geht es? Was ist wichtig? Muss ich etwas tun? Gibt es Frist, Termin, Geld oder Risiko?
- Keine langen Berechnungen, keine Paragraphen-Erklärung, keine Datenbox wiederholen.

Mehr Details:
- Die Detailtiefe richtet sich nach dem Brief:
  leicht = kaum Details
  mittel = kurze Details
  ernst = mehr Erklärung, aber gegliedert
- Auch bei ernsten Briefen keine Textwand.
- Höchstens 5 kleine Abschnitte.
- Jeder Abschnitt 1 bis 2 kurze Sätze.
`;
}

function detectDetailDepth(info) {
  const joined = [
    info.briefart,
    info.worum_geht_es,
    info.kurz_gesagt,
    info.folge_wenn_nichts,
    info.pflicht_oder_freiwillig,
    info.dringlichkeit,
    ...(info.wichtigste_punkte || []),
    ...(info.was_ist_zu_tun || [])
  ].join(" ").toLowerCase();

  if (hasAny(joined, [
    "gericht", "polizei", "staatsanwaltschaft", "ladung", "straf", "mahnbescheid",
    "vollstreckung", "vollstreckungstitel", "pfändung", "gerichtsvollzieher",
    "inkasso", "kündigung", "räumung", "rückforderung", "aufrechnung",
    "widerspruch", "rechtsbehelf", "sanktion", "minderung", "jobcenter",
    "ablehnung", "krankenkasse", "bescheid"
  ])) {
    return "ernst";
  }

  if (hasAny(joined, [
    "rechnung", "mahnung", "forderung", "zahlung", "frist", "termin",
    "unterlagen", "nachweise", "vermieter", "versicherung", "schule", "arbeit",
    "vertrag", "krank", "pflege", "rente"
  ])) {
    return "mittel";
  }

  return "leicht";
}

function shortenForDetail(text, max = 170) {
  const clean = String(text || "").trim().replace(/\s+/g, " ").replace(/\.$/, "");
  if (!clean) return "";
  if (clean.length <= max) return clean + ".";

  let cut = clean.slice(0, max).trim();
  const last = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  if (last > 70) cut = cut.slice(0, last).trim();
  cut = cut.replace(/[,:;\s]+$/, "");
  return cut + ".";
}

function buildExtractionPromptBase(inputMode) {
  return `
Du bist Hilfe24.

${buildHilfe24TextSystemRules()}

Aufgabe:
Du sollst ein Schreiben so verstehen wie ein erfahrener Alltagshelfer.
Nicht nur zusammenfassen.
Du musst erkennen, was für den Menschen wirklich wichtig ist.

Input:
${inputMode === "image" ? [
"Du bekommst Bilder eines Briefes / Schreibens. Die Bilder können Handyfotos sein. Lies sie sehr genau, Seite für Seite.",
"WICHTIG ZU DEN FOTOS:",
"- Es können ganze Seiten und Nahaufnahmen gemischt sein.",
"- Wenn ein Foto eine Nahaufnahme von Name, Datum, Aktenzeichen, Betrag, Frist oder Rechtsbehelf zeigt, nutze diese Nahaufnahme für die kritischen Daten stärker als ein weit entferntes Ganzseitenfoto.",
"- Vergleiche kritische Daten zwischen allen Fotos.",
"- Wenn Name, Betrag, Datum, Frist oder Aktenzeichen nicht eindeutig lesbar sind, nicht raten, sondern unsicherheiten eintragen.",
"- Bei Namen ist ein einzelner Buchstabe wichtig. Wenn Kalina/Karina/Ksenia oder ähnliche Varianten möglich sind, betroffene_person leer lassen und bei unsicherheiten Name bitte prüfen schreiben."
].join("\n") : "Du bekommst den Text eines Briefes / Schreibens."}

GENAUIGKEIT BEI BILDERN / OCR:
Wenn du Bilder bekommst, arbeite in dieser Reihenfolge:
1. Lies den Text auf jeder Seite zuerst möglichst wörtlich.
2. Unterscheide Seite 1, Seite 2 und Seite 3.
3. Nutze nur Text, der wirklich sichtbar ist.
4. Erkläre erst danach den Inhalt.

EXTREM WICHTIG BEI NAMEN:
- Namen niemals erraten.
- Namen nur übernehmen, wenn Vorname/Nachname im Adressfeld, bei "Patient", "Versicherte Person", "Kunde", "Rechnungsempfänger", "Betroffene Person" oder im klaren Satz erkennbar ist.
- Absendernamen, Firmen, Arztpraxen, Behörden, Städte, Sachbearbeiter und Zahnarztnamen NICHT als betroffene Person eintragen.
- Wenn der Name nur teilweise lesbar ist, trage ihn NICHT in "betroffene_person" ein. Schreibe stattdessen in "unsicherheiten": "Name nicht sicher lesbar".
- Wenn mehrere Namen vorkommen, wähle nur die Person, die wirklich vom Schreiben betroffen ist. Wenn unklar: leer lassen und Unsicherheit eintragen.

EXTREM WICHTIG BEI RECHNUNGEN:
- Unterscheide Rechnungssteller, Leistungserbringer, Patient/Empfänger und Versicherte Person.
- Unterscheide Rechnungsdatum, Behandlungsdatum, Leistungsdatum, Fälligkeitsdatum und Zugangs-/Erhalt-Datum.
- Bei Beträgen immer exakt Zahl, Komma/Punkt und Euro übernehmen.
- Bei Rechnungsnummern, Kundennummern, RG-Nummern, Mahnnummern und Aktenzeichen exakt übernehmen.
- Wenn die Zahlungsfrist nur "30 Tage nach Erhalt" oder "30 Tage nach Zugang" lautet, nicht automatisch ein konkretes Datum berechnen, außer das Schreiben nennt es klar.
- Wenn Erstattung/Krankenkasse/Versicherung möglich wirkt, nur als Prüfung formulieren, niemals als sichere Erstattung.

UNSICHERHEITEN AKTIV NUTZEN:
Wenn Fotoqualität, Name, Datum, Betrag, Frist, Aktenzeichen oder Absender nicht sicher lesbar sind, trage das in "unsicherheiten" ein.
Lieber leer lassen als falsch ausfüllen.

ZAHLEN- UND DATUMSPRÜFUNG:
- Prüfe jede Ziffer langsam und zweimal.
- Aus 1.393,37 Euro darf niemals 139,37 Euro werden.
- Aus 01.05.2026 darf niemals 01.05.2023 werden.
- Aus 31.05.2028 darf niemals 31.03.2026 werden.
- Übernimm Tausenderpunkte, Komma, Euro-Beträge und Jahreszahlen exakt aus dem Schreiben.
- Wenn eine Zahl wegen Falte/Schatten nicht sicher lesbar ist: leer lassen oder in unsicherheiten eintragen.
- Bei Jobcenter-Aufrechnung unterscheide: Gesamtforderung, monatlicher Aufrechnungsbetrag, Beginn, Ende, Widerspruchsfrist.

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
- Daten-Sicherheit ist wichtiger als eine schöne Antwort.
- Namen nur übernehmen, wenn sie im Adressfeld oder in der direkten Anrede klar lesbar sind.
- Wenn ein Name nur unsicher gelesen wurde, betroffene_person leer lassen und bei "unsicherheiten" eintragen.
- Beträge, Fristen, Daten, Aktenzeichen und Rechnungsnummern nur übernehmen, wenn sie klar lesbar sind.
- Wenn mehrere ähnliche Namen möglich sind, keinen Namen sicher behaupten.
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
Der Satz soll nur den Kern treffen: Was ist das Schreiben und worum geht es?
Keine Details, keine Berechnung, keine langen Behördenformulierungen.
Beträge, Fristen oder Termine nur nennen, wenn sie der zentrale Punkt des Schreibens sind.
Betroffene Person:
- Wenn im Adressfeld oder im Schreiben ein echter Vor- und Nachname der betroffenen Person steht, schreibe ihn in "betroffene_person".
- Keine Behörde, keine Firma, keine Stadt und keinen Absender als betroffene Person eintragen.
- Wenn kein sicherer Personenname erkennbar ist, leer lassen.
Gib genau dieses JSON zurück:
{
 "absender_original": "",
"absender_kurz": "",
"email_adresse": "",
"betroffene_person": "",
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
  const references = dedupe(info.referenzen || []);
  const uncertainties = dedupe(info.unsicherheiten || []);

  const fullContext = [
    sender,
    briefart,
    topic,
    summary,
    nextStep,
    consequence,
    actions.join(" "),
    references.join(" "),
    uncertainties.join(" ")
  ].join(" ").toLowerCase();

  const lines = [];

  function cleanSentence(text) {
    return String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[.;,\s]+$/g, "");
  }

  function shorten(text, max = 105) {
    const clean = cleanSentence(text);
    if (!clean) return "";
    if (clean.length <= max) return clean;

    const cut = clean.slice(0, max + 1);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 60 ? cut.slice(0, lastSpace) : clean.slice(0, max)).trim();
  }

  function pushLine(text, max = 105) {
    const clean = shorten(text, max);
    if (!clean) return;
    const sentence = clean + ".";

    if (!lines.some((line) => line.toLowerCase() === sentence.toLowerCase())) {
      lines.push(sentence);
    }
  }

  function hasContext(words) {
    return hasAny(fullContext, words);
  }

  function typeLine() {
    if (briefart && sender) return `Das ist ein ${briefart} von ${sender}`;
    if (sender) return `Das ist ein Schreiben von ${sender}`;
    if (briefart) return `Das ist ein ${briefart}`;
    return "Das ist ein Schreiben";
  }

  function topicLine() {
    if (hasContext(["rückforderung", "erstattung", "aufrechnung", "jobcenter", "bürgergeld"])) {
      if (amount) return `Es geht um eine Rückforderung oder Aufrechnung von ${amount}`;
      return "Es geht um eine Rückforderung oder Aufrechnung";
    }

    if (hasContext(["rechnung", "forderung", "mahnung", "inkasso"])) {
      if (amount) return `Es geht um eine Rechnung oder Forderung von ${amount}`;
      return "Es geht um eine Rechnung oder Forderung";
    }

    if (hasContext(["termin", "ladung", "einladung", "randevu"])) {
      return "Es geht um einen Termin";
    }

    if (hasContext(["unterlagen", "nachweise", "nachreichen", "einreichen"])) {
      return "Es geht um Unterlagen oder Nachweise";
    }

    if (summary) return summary;
    if (topic) return `Es geht um ${topic}`;
    return "";
  }

  function actionLine() {
    const firstAction = cleanSentence(actions[0]);
    const step = cleanSentence(nextStep);

    if (duty === "werbung") {
      return "Das wirkt wie Werbung oder ein Angebot; du musst wahrscheinlich nichts tun";
    }

    if (duty === "freiwillig") {
      return "Das ist wahrscheinlich freiwillig; du kannst selbst entscheiden";
    }

    if (duty === "information" && !deadline && !appointment && !amount) {
      return "Du musst wahrscheinlich nichts tun, solltest den Brief aber aufbewahren";
    }

    if (appointment) {
      return "Nimm den Termin wahr oder sage rechtzeitig ab, wenn du nicht kannst";
    }

    if (documents.length > 0 && hasContext(["unterlagen", "nachweise", "einreichen", "nachreichen", "schicken", "senden"])) {
      return "Reiche die genannten Unterlagen rechtzeitig ein";
    }

    if (amount && hasContext(["rechnung", "forderung", "mahnu", "inkasso", "rückforderung", "aufrechnung", "zahlen", "zahlung", "betrag"])) {
      return "Prüfe zuerst, ob die Forderung stimmt";
    }

    if (deadline && hasContext(["widerspruch", "rechtsbehelf", "frist", "antwort", "rückmeldung"])) {
      return "Wenn du nicht einverstanden bist, reagiere innerhalb der Frist";
    }

    if (step) return step;
    if (firstAction) return firstAction;

    if (deadline) return "Prüfe die Frist und reagiere rechtzeitig";
    if (amount) return "Prüfe den Betrag und kläre, ob du zahlen musst";

    return "Prüfe den Brief und bewahre ihn auf";
  }

  function deadlineOrDateLine() {
    if (appointment) return `Termin: ${appointment}`;

    if (deadline) {
      if (hasContext(["widerspruch", "rechtsbehelf"])) return `Widerspruchsfrist: ${deadline}`;
      return `Frist: ${deadline}`;
    }

    return "";
  }

  function moneyLine() {
    if (!amount) return "";

    const monthlyMatch = fullContext.match(/\b\d+[,.]\d{2}\s*euro\b|\b\d+[,.]\d{2}\s*€\b/i);

    if (hasContext(["aufrechnung", "monatlich", "einbehalten", "abgezogen"])) {
      const monthly = String(nextStep + " " + topic + " " + summary + " " + actions.join(" ")).match(/\b\d+[,.]\d{2}\s*(?:€|euro)\b/i);
      if (monthly && monthly[0] && monthly[0] !== amount) {
        return `Betrag: ${amount}; monatlicher Abzug: ${monthly[0]}`;
      }
    }

    return `Betrag: ${amount}`;
  }

  function consequenceLine() {
    const text = cleanSentence(consequence);

    if (!text) {
      if (urgency === "hoch") return "Ignoriere den Brief nicht";
      return "";
    }

    if (hasAny(text, ["keine nachteile", "keinerlei nachteile", "keinen nachteil"])) {
      return "Wenn du nichts machst, entstehen laut Brief wahrscheinlich keine Nachteile";
    }

    if (hasAny(text, ["vollstreckung", "pfändung", "gerichtsvollzieher"])) {
      return "Wenn du nichts machst, können weitere Kosten oder Vollstreckung folgen";
    }

    if (hasAny(text, ["kürzung", "minderung", "leistung", "bürgergeld", "jobcenter", "einbehalten"])) {
      return "Wenn du nichts machst, können Leistungen gekürzt oder einbehalten werden";
    }

    if (text.length <= 95) return `Wenn du nichts machst: ${text}`;

    return "Wenn du nichts machst, können Nachteile entstehen";
  }

  // Human + EL5 + DLTR + Listify:
  // Menschlich, einfach wie für Anfänger, keine langen Texte, kurze Liste.
  pushLine(typeLine(), 95);
  pushLine(topicLine(), 105);
  pushLine(actionLine(), 105);
  pushLine(deadlineOrDateLine(), 95);

  // Betrag nur zusätzlich zeigen, wenn noch Platz ist oder es zentral um Geld geht.
  if (lines.length < 4 || hasContext(["rechnung", "forderung", "rückforderung", "aufrechnung", "inkasso", "zahlung"])) {
    pushLine(moneyLine(), 115);
  }

  pushLine(consequenceLine(), 105);

  return dedupe(lines.filter(Boolean)).slice(0, 5).join("\n");
}

function renderDetailTemplateGerman(info) {
  const blocks = [];
  const sender = String(info.absender_kurz || info.absender_original || "").trim();
  const topic = String(info.worum_geht_es || "").trim();
  const consequence = String(info.folge_wenn_nichts || "").trim();
  const hiddenInfo = String(info.versteckte_wichtige_info || "").trim();
  const importantPoints = dedupe(info.wichtigste_punkte || []);
  const actions = dedupe(info.was_ist_zu_tun || []);
  const documents = dedupe(info.unterlagen || []);
  const references = dedupe(info.referenzen || []);
  const person = String(info.betroffene_person || "").trim();
  const depth = detectDetailDepth(info);

  if (sender) {
    blocks.push(`[[HEAD_FROM]]\nDer Brief ist von ${sender}.`);
  }

  if (person && depth !== "leicht") {
    blocks.push(`[[HEAD_PERSON]]\nDer Brief betrifft ${person}.`);
  }

  if (topic) {
    blocks.push(`[[HEAD_TOPIC]]\n${shortenForDetail(topic, depth === "ernst" ? 220 : 170)}`);
  }

  const importantLines = [];
  const maxPoints = depth === "ernst" ? 4 : depth === "mittel" ? 3 : 2;

  for (const p of importantPoints.slice(0, maxPoints)) {
    const s = shortenForDetail(p, 150);
    if (s) importantLines.push(s);
  }

  for (const a of actions.slice(0, depth === "ernst" ? 3 : 2)) {
    const s = shortenForDetail(a, 150);
    if (s) importantLines.push(s);
  }

  if (documents.length > 0 && depth !== "leicht") {
    importantLines.push(`Unterlagen prüfen: ${documents.slice(0, 3).join(", ")}.`);
  }

  if (references.length > 0 && depth === "ernst") {
    importantLines.push(`Nummern/Zeichen prüfen: ${references.slice(0, 3).join(", ")}.`);
  }

  if (hiddenInfo && depth === "ernst") {
    importantLines.push(shortenForDetail(hiddenInfo, 160));
  }

  if (importantLines.length > 0) {
    blocks.push(`[[HEAD_IMPORTANT]]\n${dedupe(importantLines).slice(0, depth === "ernst" ? 5 : 3).join("\n")}`);
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

  if (consequence && depth !== "leicht") {
    blocks.push(`[[HEAD_ELSE]]\n${shortenForDetail(consequence, depth === "ernst" ? 190 : 150)}`);
  }

  // Bei leichten Schreiben reichen 2-3 Blöcke. Bei ernsten Schreiben sind mehr Blöcke erlaubt, aber keine Textwand.
  const maxBlocks = depth === "ernst" ? 6 : depth === "mittel" ? 5 : 3;
  return blocks.slice(0, maxBlocks).join("\n\n");
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

function buildOcrPromptForImages() {
  return `
Du bist die OCR-Stufe von Hilfe24.

Aufgabe:
Lies die hochgeladenen Briefbilder so exakt wie möglich ab.
Du erklärst nichts. Du fasst nichts zusammen.
Du gibst nur den sichtbaren Text seitenweise wieder.

REGELN:
- Jede Seite einzeln mit SEITE 1, SEITE 2, SEITE 3 kennzeichnen.
- Namen, Beträge, Daten, Aktenzeichen, Rechnungsnummern und Paragrafen exakt übernehmen.
- Prüfe alle Ziffern langsam: 1.393,37 ist nicht 139,37.
- Prüfe Jahreszahlen langsam: 2026 ist nicht 2023.
- Wenn etwas wegen Falte/Schatten nicht sicher lesbar ist, schreibe [UNSICHER: ...].
- Keine fehlenden Wörter erfinden.
- Keine Adresse oder Zahl korrigieren, wenn du sie nicht sicher siehst.
- Keine Markdown-Codeblöcke.

Gib nur den abgelesenen Text zurück.
`;
}

async function buildRawTextFromImages(bilder) {
  const parts = [
    {
      text: buildOcrPromptForImages()
    }
  ];

  let pageIndex = 1;

  for (const bild of bilder) {
    if (!bild.imageData || !bild.mimeType) continue;

    parts.push({
      text: `\nSEITE ${pageIndex}: Bitte diese Seite exakt ablesen.\n`
    });

    parts.push({
      inline_data: {
        mime_type: bild.mimeType,
        data: bild.imageData
      }
    });

    pageIndex++;
  }

  const raw = await callGemini(parts);
  return cleanText(raw).slice(0, 18000);
}

async function verifyCriticalInfoFromImages(bilder, info, rawText) {
  const parts = [
    {
      text: `
Du bist die Sicherheitsprüfung von Hilfe24.

Du bekommst:
1. die Originalbilder
2. den OCR-Text
3. bereits erkannte JSON-Daten

Aufgabe:
Prüfe nur kritische Daten und korrigiere sie, wenn sie auf den Bildern oder im OCR-Text klar erkennbar sind.

KRITISCHE DATEN:
- betroffene_person
- absender_original / absender_kurz
- briefart
- frist
- termin
- folge_wenn_nichts
- betrag
- referenzen
- naechster_schritt
- wichtigste_punkte
- was_ist_zu_tun
- unsicherheiten

HARTE REGELN:
- Namen niemals raten.
- Wenn ein Name nicht sicher ist: betroffene_person leer lassen und "Name nicht sicher lesbar" in unsicherheiten eintragen.
- Wenn im Adressfeld ein klarer Name steht, genau diesen übernehmen.
- Beträge exakt übernehmen. Aus 1.393,37 darf niemals 139,37 werden.
- Jahreszahlen exakt übernehmen. Aus 2026 darf niemals 2023 werden.
- Aktenzeichen/Mein Zeichen exakt übernehmen.
- Bei Widerspruchsfrist "1 Monat nach Bekanntgabe" nicht als abgelaufen bewerten.
- Wenn etwas unklar ist, nicht schöner machen, sondern als unsicher markieren.

Antworte nur mit gültigem JSON im gleichen Schema.
Keine Markdown-Codeblöcke.

OCR-TEXT:
${String(rawText || "").slice(0, 18000)}

AKTUELLE JSON-DATEN:
${JSON.stringify(info, null, 2)}
`
    }
  ];

  let pageIndex = 1;

  for (const bild of bilder) {
    if (!bild.imageData || !bild.mimeType) continue;

    parts.push({
      text: `\nORIGINALBILD SEITE ${pageIndex}: Prüfe kritische Daten gegen dieses Bild.\n`
    });

    parts.push({
      inline_data: {
        mime_type: bild.mimeType,
        data: bild.imageData
      }
    });

    pageIndex++;
  }

  const rawJson = await callGemini(parts);
  return normalizeInfo(extractJson(rawJson));
}

async function buildInfoFromImages(bilder) {
  // V7.6 TURBO: Nur ein Gemini-Bildaufruf für die erste Analyse.
  // Die frühere Pipeline (OCR -> Textanalyse -> Bildprüfung) war genauer,
  // aber auf Smartphones oft 2-3 Minuten langsam.
  // Unsichere Daten werden deshalb lieber als "bitte prüfen" behandelt.
  const parts = [
    {
      text: buildExtractionPromptForImages() + `

V7.6 TURBO-REGELN:
- Arbeite schnell und direkt aus den Bildern.
- Die Bilder können ganze Seiten oder Nahaufnahmen sein.
- Nutze Nahaufnahmen besonders für Name, Datum, Aktenzeichen, Betrag, Frist und Rechtsbehelf.
- Wenn ein Name oder Aktenzeichen nicht eindeutig lesbar ist: leer lassen oder in unsicherheiten schreiben.
- Keine zweite Sicherheitsrunde. Deshalb lieber unsicher markieren als raten.
- Betrag, Datum und Frist nur übernehmen, wenn klar lesbar.
`
    }
  ];

  let pageIndex = 1;

  for (const bild of bilder) {
    if (!bild.imageData || !bild.mimeType) continue;

    parts.push({
      text: `
FOTO ${pageIndex}: Ganzseite oder Nahaufnahme. Bitte sorgfältig lesen.
`
    });

    parts.push({
      inline_data: {
        mime_type: bild.mimeType,
        data: bild.imageData
      }
    });

    pageIndex++;
  }

  const rawJson = await callGemini(parts);
  const info = normalizeInfo(extractJson(rawJson));

  if (!Array.isArray(info.unsicherheiten)) {
    info.unsicherheiten = [];
  }

  // Bei Bildanalyse Namen und Referenzen nicht blind als sicher behandeln.
  // Die Datenbox zeigt sie später bei Unsicherheit als "Bitte prüfen".
  return normalizeInfo(info);
}

function getSafeCriticalMeta(info, sourceMode = "text") {
  const uncertainties = dedupe(info.unsicherheiten || []);
  const uncertaintyText = uncertainties.join(" ").toLowerCase();
  const fromImage = sourceMode === "image";

  const personRaw = normalizeString(info.betroffene_person);
  const references = dedupe(info.referenzen || []);

  // Bei Fotos darf ein Name nicht als sicher gelten. Ein Buchstabe Unterschied ist zu riskant.
  const personSafe = Boolean(personRaw) && !fromImage && !hasAny(uncertaintyText, ["name", "person", "adress", "empfänger"]);

  // Aktenzeichen/Referenzen aus Fotos sind oft durch Punkte/Striche fehleranfällig.
  const referencesSafe = references.length > 0 && !fromImage && !hasAny(uncertaintyText, ["zeichen", "akten", "referenz", "nummer"]);

  return {
    personSafe,
    personForOfficialText: personSafe ? personRaw : "",
    personDisplay: personSafe ? personRaw : "",
    referencesSafe,
    referencesDisplay: referencesSafe ? references : references,
    criticalUncertainties: uncertainties
  };
}

function inferMustReact(info) {
  const combined = [
    info.briefart,
    info.worum_geht_es,
    info.frist,
    info.termin,
    info.folge_wenn_nichts,
    info.naechster_schritt,
    (info.was_ist_zu_tun || []).join(" "),
    (info.passende_aktionen || []).join(" ")
  ].join(" ").toLowerCase();

  if (info.pflicht_oder_freiwillig === "werbung" || info.pflicht_oder_freiwillig === "freiwillig") return "no";
  if (info.frist || info.termin || info.betrag) return "yes";
  if (hasAny(combined, ["widerspruch", "frist", "termin", "zahlen", "zahlung", "forderung", "mahnung", "unterlagen", "nachreichen", "kündigung", "gericht", "polizei", "anhörung", "aufrechnung", "rückforderung"])) return "yes";
  if (info.pflicht_oder_freiwillig === "information") return "maybe";
  return "maybe";
}

function inferMoneyAffected(info) {
  const combined = [
    info.briefart,
    info.worum_geht_es,
    info.betrag,
    info.folge_wenn_nichts,
    info.naechster_schritt,
    (info.was_ist_zu_tun || []).join(" ")
  ].join(" ").toLowerCase();

  if (info.betrag) return "yes";
  if (hasAny(combined, ["rechnung", "forderung", "mahnen", "inkasso", "rückforderung", "aufrechnung", "zahlung", "betrag", "kosten", "gebühr", "miete", "kaution", "erstattung", "geld", "leistung", "abzug"])) return "yes";
  return "maybe";
}


function simpleLabelDict(lang) {
  const maps = {
    de: {
      check: "Bitte prüfen",
      good: "Gut",
      medium: "Mittel",
      low: "Niedrig",
      unknown: "Unklar",
      yes: "Ja",
      no: "Nein",
      briefart: "Briefart",
      urgency: "Dringlichkeit",
      react: "Musst du reagieren?",
      money: "Geld betroffen?",
      person: "Name",
      sender: "Absender",
      amount: "Betrag",
      deadline: "Frist/Termin",
      reference: "Aktenzeichen/Nummer",
      unsafe: "Einige Daten konnten nicht sicher gelesen werden. Bitte prüfe Name, Datum und Aktenzeichen im Originalbrief.",
      firstStepDefault: "Prüfe zuerst, ob Betrag, Frist und Absender im Brief stimmen.",
      whatsappStart: "Kurz: "
    },
    tr: {
      check: "Lütfen kontrol et",
      good: "İyi",
      medium: "Orta",
      low: "Düşük",
      unknown: "Belirsiz",
      yes: "Evet",
      no: "Hayır",
      briefart: "Yazı türü",
      urgency: "Aciliyet",
      react: "Cevap vermen gerekiyor mu?",
      money: "Para konusu var mı?",
      person: "İsim",
      sender: "Gönderen",
      amount: "Tutar",
      deadline: "Süre/Randevu",
      reference: "Dosya/Numara",
      unsafe: "Bazı bilgiler kesin okunamadı. Lütfen isim, tarih ve numarayı asıl mektupta kontrol et.",
      firstStepDefault: "Önce tutar, süre ve gönderen bilgisinin doğru olup olmadığını kontrol et.",
      whatsappStart: "Kısaca: "
    },
    bg: {
      check: "Моля, провери",
      good: "Добра",
      medium: "Средна",
      low: "Ниска",
      unknown: "Неясно",
      yes: "Да",
      no: "Не",
      briefart: "Вид писмо",
      urgency: "Спешност",
      react: "Трябва ли да реагираш?",
      money: "Има ли пари?",
      person: "Име",
      sender: "Изпращач",
      amount: "Сума",
      deadline: "Срок/термин",
      reference: "Номер/знак",
      unsafe: "Някои данни не се четат сигурно. Провери името, датата и номера в оригиналното писмо.",
      firstStepDefault: "Първо провери дали сумата, срокът и изпращачът са правилни.",
      whatsappStart: "Накратко: "
    },
    ro: {
      check: "Te rog verifică",
      good: "Bună",
      medium: "Medie",
      low: "Scăzută",
      unknown: "Neclar",
      yes: "Da",
      no: "Nu",
      briefart: "Tip document",
      urgency: "Urgență",
      react: "Trebuie să reacționezi?",
      money: "Este vorba de bani?",
      person: "Nume",
      sender: "Expeditor",
      amount: "Sumă",
      deadline: "Termen/Programare",
      reference: "Număr/Dosar",
      unsafe: "Unele date nu au putut fi citite sigur. Verifică numele, data și numărul în scrisoarea originală.",
      firstStepDefault: "Verifică mai întâi suma, termenul și expeditorul din scrisoare.",
      whatsappStart: "Pe scurt: "
    },
    ar: {
      check: "يرجى التحقق",
      good: "جيد",
      medium: "متوسط",
      low: "منخفض",
      unknown: "غير واضح",
      yes: "نعم",
      no: "لا",
      briefart: "نوع الرسالة",
      urgency: "الأهمية",
      react: "هل يجب الرد؟",
      money: "هل يوجد مبلغ مالي؟",
      person: "الاسم",
      sender: "المرسل",
      amount: "المبلغ",
      deadline: "مهلة/موعد",
      reference: "رقم/ملف",
      unsafe: "بعض البيانات لم تُقرأ بشكل مؤكد. يرجى التحقق من الاسم والتاريخ والرقم في الرسالة الأصلية.",
      firstStepDefault: "تحقق أولًا من المبلغ والمهلة والمرسل في الرسالة.",
      whatsappStart: "باختصار: "
    },
    en: {
      check: "Please check",
      good: "Good",
      medium: "Medium",
      low: "Low",
      unknown: "Unclear",
      yes: "Yes",
      no: "No",
      briefart: "Document type",
      urgency: "Urgency",
      react: "Do you need to react?",
      money: "Money involved?",
      person: "Name",
      sender: "Sender",
      amount: "Amount",
      deadline: "Deadline/Appointment",
      reference: "Reference number",
      unsafe: "Some data could not be read safely. Please check name, date and reference number in the original letter.",
      firstStepDefault: "First check whether the amount, deadline and sender match the letter.",
      whatsappStart: "Short: "
    }
  };
  return maps[lang] || maps.de;
}


function helperTextDict(lang) {
  const maps = {
    de: {
      from: "von",
      amount: "Betrag",
      deadline: "Frist",
      appointment: "Termin",
      urgencyHigh: "Hoch",
      urgencyMedium: "Mittel",
      urgencyLow: "Niedrig",
      documentDefault: "Schreiben",
      types: {
        inkasso: "Inkasso / Forderung",
        jobcenter: "Bescheid",
        invoice: "Rechnung",
        claim: "Forderung / Mahnung",
        appointment: "Termin",
        policeCourt: "Gericht / Polizei",
        health: "Krankenkasse / Gesundheit",
        ad: "Angebot / Werbung"
      },
      steps: {
        checkMoney: "Prüfe, ob Betrag und Forderung stimmen.",
        checkDeadline: "Achte auf die Frist und notiere dir das Datum.",
        checkAppointment: "Prüfe den Termin und sage rechtzeitig ab, wenn du nicht kannst.",
        collectDocs: "Sammle die genannten Unterlagen oder Nachweise.",
        getHelp: "Wenn du unsicher bist, hole Beratung oder frage die Stelle schriftlich."
      },
      actions: {
        checkClaim: "Forderung prüfen",
        requestStatement: "Forderungsaufstellung anfordern",
        checkInstallments: "Ratenzahlung prüfen",
        seekAdvice: "Beratung suchen",
        checkObjection: "Widerspruch prüfen",
        checkAmount: "Betrag prüfen",
        checkInvoice: "Rechnung prüfen",
        clarifyPayment: "Zahlung klären",
        writeMessage: "Nachricht schreiben",
        checkAppointment: "Termin prüfen",
        prepareDocs: "Unterlagen vorbereiten",
        askQuestion: "Frage stellen",
        writeReply: "Antwort schreiben"
      }
    },
    tr: {
      from: "gönderen",
      amount: "Tutar",
      deadline: "Süre",
      appointment: "Randevu",
      urgencyHigh: "Yüksek",
      urgencyMedium: "Orta",
      urgencyLow: "Düşük",
      documentDefault: "Yazı",
      types: {
        inkasso: "Tahsilat / Alacak",
        jobcenter: "Karar yazısı",
        invoice: "Fatura",
        claim: "Alacak / İhtar",
        appointment: "Randevu",
        policeCourt: "Mahkeme / Polis",
        health: "Sağlık sigortası / Sağlık",
        ad: "Teklif / Reklam"
      },
      steps: {
        checkMoney: "Önce tutarın ve alacağın doğru olup olmadığını kontrol et.",
        checkDeadline: "Süreyi kontrol et ve tarihi not al.",
        checkAppointment: "Randevuyu kontrol et; gidemeyeceksen zamanında haber ver.",
        collectDocs: "İstenen belgeleri veya kanıtları hazırla.",
        getHelp: "Emin değilsen danışmanlık al veya kuruma yazılı olarak sor."
      },
      actions: {
        checkClaim: "Alacağı kontrol et",
        requestStatement: "Borç dökümü iste",
        checkInstallments: "Taksit seçeneğini kontrol et",
        seekAdvice: "Danışmanlık al",
        checkObjection: "İtirazı kontrol et",
        checkAmount: "Tutarı kontrol et",
        checkInvoice: "Faturayı kontrol et",
        clarifyPayment: "Ödemeyi netleştir",
        writeMessage: "Mesaj yaz",
        checkAppointment: "Randevuyu kontrol et",
        prepareDocs: "Belgeleri hazırla",
        askQuestion: "Soru sor",
        writeReply: "Cevap yaz"
      }
    },
    bg: {
      from: "от",
      amount: "Сума",
      deadline: "Срок",
      appointment: "Термин",
      urgencyHigh: "Висока",
      urgencyMedium: "Средна",
      urgencyLow: "Ниска",
      documentDefault: "Писмо",
      types: {
        inkasso: "Инкасо / Задължение",
        jobcenter: "Решение",
        invoice: "Фактура",
        claim: "Задължение / Напомняне",
        appointment: "Термин",
        policeCourt: "Съд / Полиция",
        health: "Здравна каса / Здраве",
        ad: "Оферта / Реклама"
      },
      steps: {
        checkMoney: "Първо провери дали сумата и задължението са правилни.",
        checkDeadline: "Провери срока и си запиши датата.",
        checkAppointment: "Провери термина; ако не можеш да отидеш, съобщи навреме.",
        collectDocs: "Подготви посочените документи или доказателства.",
        getHelp: "Ако не си сигурен, потърси консултация или попитай писмено съответната служба."
      },
      actions: {
        checkClaim: "Провери задължението",
        requestStatement: "Поискай разбивка на сумата",
        checkInstallments: "Провери плащане на вноски",
        seekAdvice: "Потърси консултация",
        checkObjection: "Провери възражение",
        checkAmount: "Провери сумата",
        checkInvoice: "Провери фактурата",
        clarifyPayment: "Изясни плащането",
        writeMessage: "Напиши съобщение",
        checkAppointment: "Провери термина",
        prepareDocs: "Подготви документи",
        askQuestion: "Задай въпрос",
        writeReply: "Напиши отговор"
      }
    },
    ro: {
      from: "de la",
      amount: "Sumă",
      deadline: "Termen",
      appointment: "Programare",
      urgencyHigh: "Ridicată",
      urgencyMedium: "Medie",
      urgencyLow: "Scăzută",
      documentDefault: "Document",
      types: {
        inkasso: "Recuperare creanță / Datorie",
        jobcenter: "Decizie",
        invoice: "Factură",
        claim: "Creanță / Somație",
        appointment: "Programare",
        policeCourt: "Instanță / Poliție",
        health: "Asigurare medicală / Sănătate",
        ad: "Ofertă / Publicitate"
      },
      steps: {
        checkMoney: "Verifică mai întâi dacă suma și creanța sunt corecte.",
        checkDeadline: "Verifică termenul și notează data.",
        checkAppointment: "Verifică programarea și anunță din timp dacă nu poți merge.",
        collectDocs: "Pregătește documentele sau dovezile menționate.",
        getHelp: "Dacă nu ești sigur, cere consiliere sau întreabă instituția în scris."
      },
      actions: {
        checkClaim: "Verifică creanța",
        requestStatement: "Cere detalierea datoriei",
        checkInstallments: "Verifică plata în rate",
        seekAdvice: "Caută consiliere",
        checkObjection: "Verifică contestația",
        checkAmount: "Verifică suma",
        checkInvoice: "Verifică factura",
        clarifyPayment: "Clarifică plata",
        writeMessage: "Scrie mesaj",
        checkAppointment: "Verifică programarea",
        prepareDocs: "Pregătește documente",
        askQuestion: "Pune o întrebare",
        writeReply: "Scrie răspuns"
      }
    },
    ar: {
      from: "من",
      amount: "المبلغ",
      deadline: "المهلة",
      appointment: "الموعد",
      urgencyHigh: "عالية",
      urgencyMedium: "متوسطة",
      urgencyLow: "منخفضة",
      documentDefault: "رسالة",
      types: {
        inkasso: "تحصيل / مطالبة مالية",
        jobcenter: "قرار رسمي",
        invoice: "فاتورة",
        claim: "مطالبة / إنذار",
        appointment: "موعد",
        policeCourt: "محكمة / شرطة",
        health: "تأمين صحي / صحة",
        ad: "عرض / إعلان"
      },
      steps: {
        checkMoney: "تحقق أولًا من صحة المبلغ والمطالبة.",
        checkDeadline: "تحقق من المهلة وسجل التاريخ.",
        checkAppointment: "تحقق من الموعد وأبلغ الجهة مبكرًا إذا لم تستطع الحضور.",
        collectDocs: "جهز المستندات أو الإثباتات المذكورة.",
        getHelp: "إذا لم تكن متأكدًا، اطلب استشارة أو اسأل الجهة كتابيًا."
      },
      actions: {
        checkClaim: "تحقق من المطالبة",
        requestStatement: "اطلب كشفًا بالمبلغ",
        checkInstallments: "تحقق من الدفع بالتقسيط",
        seekAdvice: "اطلب استشارة",
        checkObjection: "تحقق من الاعتراض",
        checkAmount: "تحقق من المبلغ",
        checkInvoice: "تحقق من الفاتورة",
        clarifyPayment: "وضح الدفع",
        writeMessage: "اكتب رسالة",
        checkAppointment: "تحقق من الموعد",
        prepareDocs: "جهز المستندات",
        askQuestion: "اطرح سؤالًا",
        writeReply: "اكتب ردًا"
      }
    },
    en: {
      from: "from",
      amount: "Amount",
      deadline: "Deadline",
      appointment: "Appointment",
      urgencyHigh: "High",
      urgencyMedium: "Medium",
      urgencyLow: "Low",
      documentDefault: "Document",
      types: {
        inkasso: "Debt collection / Claim",
        jobcenter: "Official decision",
        invoice: "Invoice",
        claim: "Claim / Reminder",
        appointment: "Appointment",
        policeCourt: "Court / Police",
        health: "Health insurance / Health",
        ad: "Offer / Advertising"
      },
      steps: {
        checkMoney: "First check whether the amount and claim are correct.",
        checkDeadline: "Check the deadline and write down the date.",
        checkAppointment: "Check the appointment and cancel in time if you cannot attend.",
        collectDocs: "Prepare the mentioned documents or proof.",
        getHelp: "If you are unsure, get advice or ask the office in writing."
      },
      actions: {
        checkClaim: "Check claim",
        requestStatement: "Request statement of claim",
        checkInstallments: "Check installment option",
        seekAdvice: "Get advice",
        checkObjection: "Check objection",
        checkAmount: "Check amount",
        checkInvoice: "Check invoice",
        clarifyPayment: "Clarify payment",
        writeMessage: "Write message",
        checkAppointment: "Check appointment",
        prepareDocs: "Prepare documents",
        askQuestion: "Ask question",
        writeReply: "Write reply"
      }
    }
  };
  return maps[lang] || maps.de;
}

function simpleBriefartLabel(info, lang = "de") {
  const H = helperTextDict(lang);
  const text = [info.briefart, info.worum_geht_es, info.kurz_gesagt, info.folge_wenn_nichts, (info.wichtigste_punkte || []).join(" ")].join(" ").toLowerCase();

  if (hasAny(text, ["inkasso", "vollstreckungstitel", "vollstreckung", "gerichtsvollzieher", "pfändung"])) return H.types.inkasso;
  if (hasAny(text, ["jobcenter", "bürgergeld", "aufrechnung", "rückforderung", "bescheid", "rechtsbehelf", "widerspruch"])) return H.types.jobcenter;
  if (hasAny(text, ["rechnung"])) return H.types.invoice;
  if (hasAny(text, ["mahnung", "forderung"])) return H.types.claim;
  if (hasAny(text, ["termin", "einladung", "ladung"])) return H.types.appointment;
  if (hasAny(text, ["gericht", "polizei", "staatsanwaltschaft"])) return H.types.policeCourt;
  if (hasAny(text, ["krankenkasse", "aok", "medizin", "arzt"])) return H.types.health;
  if (hasAny(text, ["werbung", "angebot"])) return H.types.ad;

  const raw = normalizeString(info.briefart);
  if (!raw) return H.documentDefault;
  if (/^(forderung|mahnung)$/i.test(raw)) return H.types.claim;
  return raw;
}

function simpleUrgencyLabel(info, lang) {
  const L = simpleLabelDict(lang);
  const H = helperTextDict(lang);
  const u = String(info.dringlichkeit || "unklar").toLowerCase();
  if (u === "hoch") return H.urgencyHigh;
  if (u === "mittel") return H.urgencyMedium;
  if (u === "niedrig") return H.urgencyLow;
  const text = [info.briefart, info.worum_geht_es, info.frist, info.termin, info.folge_wenn_nichts, (info.was_ist_zu_tun||[]).join(" ")].join(" ").toLowerCase();
  if (hasAny(text, ["widerspruch", "frist", "rechtsbehelf", "kündigung", "gericht", "polizei", "pfändung", "vollstreckung"])) return H.urgencyHigh;
  if (hasAny(text, ["betrag", "forderung", "rechnung", "aufrechnung", "rückforderung", "termin", "unterlagen"])) return H.urgencyMedium;
  return L.unknown;
}

function buildDeterministicNextSteps(info, lang) {
  const H = helperTextDict(lang);
  const text = [info.briefart, info.worum_geht_es, info.frist, info.termin, info.betrag, info.folge_wenn_nichts, info.naechster_schritt, (info.was_ist_zu_tun||[]).join(" ")].join(" ").toLowerCase();
  const steps = [];

  if (info.betrag || hasAny(text, ["forderung", "rechnung", "rückforderung", "aufrechnung", "zahlung"])) {
    steps.push(H.steps.checkMoney);
  }
  if (info.frist || hasAny(text, ["frist", "widerspruch", "rechtsbehelf"])) {
    steps.push(H.steps.checkDeadline);
  }
  if (info.termin) {
    steps.push(H.steps.checkAppointment);
  }
  if ((info.unterlagen || []).length || hasAny(text, ["unterlagen", "nachweise", "einreichen", "nachreichen"])) {
    steps.push(H.steps.collectDocs);
  }
  if (hasAny(text, ["jobcenter", "behörde", "bescheid", "widerspruch", "inkasso", "gericht", "polizei"])) {
    steps.push(H.steps.getHelp);
  }
  if (!steps.length) {
    steps.push(simpleLabelDict(lang).firstStepDefault);
  }
  return dedupe(steps).slice(0,4);
}

function buildSuggestedActions(info, lang) {
  const H = helperTextDict(lang);
  const text = [
    info.briefart,
    info.worum_geht_es,
    info.frist,
    info.termin,
    info.betrag,
    info.folge_wenn_nichts,
    info.naechster_schritt,
    (info.passende_aktionen || []).join(" "),
    (info.wichtigste_punkte || []).join(" ")
  ].join(" ").toLowerCase();

  const actions = [];

  if (hasAny(text, ["inkasso", "vollstreckung", "vollstreckungstitel", "gerichtsvollzieher", "pfändung"])) {
    actions.push(H.actions.checkClaim);
    actions.push(H.actions.requestStatement);
    actions.push(H.actions.checkInstallments);
    actions.push(H.actions.seekAdvice);
  } else if (hasAny(text, ["widerspruch", "rechtsbehelf", "bescheid", "aufrechnung", "rückforderung", "jobcenter", "bürgergeld"])) {
    actions.push(H.actions.checkObjection);
    actions.push(H.actions.checkAmount);
    actions.push(H.actions.seekAdvice);
  } else if (hasAny(text, ["rechnung", "forderung", "zahlung", "mahnung"])) {
    actions.push(H.actions.checkInvoice);
    actions.push(H.actions.clarifyPayment);
    actions.push(H.actions.writeMessage);
  }

  if (hasAny(text, ["termin", "ladung", "einladung"])) actions.push(H.actions.checkAppointment);
  if (hasAny(text, ["unterlagen", "nachweise", "einreichen", "nachreichen"])) actions.push(H.actions.prepareDocs);

  actions.push(H.actions.askQuestion);
  actions.push(H.actions.writeReply);
  return dedupe(actions).slice(0,5);
}

async function buildHelperCardsFromInfo(info, lang, sourceMode = "text") {
  const langCode = getLanguageMeta(lang).code;
  const L = simpleLabelDict(langCode);
  const safe = getSafeCriticalMeta(info, sourceMode);
  const mustReact = inferMustReact(info);
  const moneyAffected = inferMoneyAffected(info);
  const personValue = safe.personSafe && safe.personForOfficialText ? safe.personForOfficialText : L.check;
  const senderValue = info.absender_kurz || info.absender_original || L.check;
  const amountValue = info.betrag || L.check;
  const deadlineValue = info.frist || info.termin || L.check;
  const referenceValue = safe.referencesSafe && (info.referenzen || []).length ? (info.referenzen || []).join(", ") : L.check;
  const nextSteps = buildDeterministicNextSteps(info, langCode);
  const firstStep = nextSteps[0] || L.firstStepDefault;
  const briefartLabel = simpleBriefartLabel(info, langCode);
  const urgencyLabel = simpleUrgencyLabel(info, langCode);
  const unsafeParts = [];
  if (!safe.personSafe) unsafeParts.push(L.person);
  if (!safe.referencesSafe) unsafeParts.push(L.reference);
  if ((info.unsicherheiten || []).length) unsafeParts.push(L.check);
  const unsafeNotice = unsafeParts.length ? L.unsafe : "";
  const whatsappParts = [];
  const H = helperTextDict(langCode);
  if (info.absender_kurz || info.absender_original) whatsappParts.push(`${H.from} ${info.absender_kurz || info.absender_original}`);
  if (info.betrag) whatsappParts.push(`${H.amount}: ${info.betrag}`);
  if (info.frist) whatsappParts.push(`${H.deadline}: ${info.frist}`);
  if (info.termin) whatsappParts.push(`${H.appointment}: ${info.termin}`);

  return {
    briefart_label: briefartLabel,
    trust_label: unsafeNotice ? L.medium : L.good,
    trust_note: unsafeNotice || "",
    urgency_label: urgencyLabel,
    urgency_reason: info.frist || info.termin || info.folge_wenn_nichts || "",
    must_react_label: mustReact === "yes" ? L.yes : (mustReact === "no" ? L.no : L.check),
    money_label: moneyAffected === "yes" ? L.yes : (moneyAffected === "no" ? L.no : L.check),
    first_step: firstStep,
    next_steps: nextSteps,
    unsafe_notice: unsafeNotice,
    data_rows: [
      { key: "person", label: L.person, value: personValue, status: safe.personSafe ? "safe" : "check" },
      { key: "sender", label: L.sender, value: senderValue, status: senderValue === L.check ? "check" : "safe" },
      { key: "amount", label: L.amount, value: amountValue, status: amountValue === L.check ? "check" : "safe" },
      { key: "deadline", label: L.deadline, value: deadlineValue, status: deadlineValue === L.check ? "check" : "safe" },
      { key: "reference", label: L.reference, value: referenceValue, status: safe.referencesSafe ? "safe" : "check" }
    ],
    suggested_actions: buildSuggestedActions(info, langCode),
    whatsapp_summary: `${L.whatsappStart}${briefartLabel}${whatsappParts.length ? " – " + whatsappParts.join("; ") : ""}. ${firstStep}`,
    phone_script: ""
  };
}


function isHighRiskLetter(info) {
  const text = [
    info.briefart,
    info.worum_geht_es,
    info.kurz_gesagt,
    info.frist,
    info.termin,
    info.folge_wenn_nichts,
    info.naechster_schritt,
    info.betrag,
    (info.wichtigste_punkte || []).join(" "),
    (info.was_ist_zu_tun || []).join(" "),
    (info.passende_aktionen || []).join(" "),
    (info.referenzen || []).join(" ")
  ].join(" ").toLowerCase();

  return Boolean(
    info.dringlichkeit === "hoch" ||
    hasAny(text, [
      "inkasso",
      "vollstreckung",
      "vollstreckungstitel",
      "gerichtsvollzieher",
      "pfändung",
      "mahnbescheid",
      "gericht",
      "polizei",
      "staatsanwaltschaft",
      "kündigung",
      "widerspruch",
      "rechtsbehelf",
      "rückforderung",
      "aufrechnung",
      "jobcenter",
      "bürgergeld",
      "sanktion",
      "minderung",
      "krankenkasse",
      "ablehnung",
      "frist",
      "mahnung"
    ])
  );
}

function buildQualityModeType(info) {
  const text = [info.briefart, info.worum_geht_es, info.kurz_gesagt, info.folge_wenn_nichts, (info.wichtigste_punkte || []).join(" ")].join(" ").toLowerCase();
  if (hasAny(text, ["inkasso", "vollstreckung", "vollstreckungstitel", "pfändung", "gerichtsvollzieher"])) return "inkasso_vollstreckung";
  if (hasAny(text, ["jobcenter", "bürgergeld", "rückforderung", "aufrechnung", "sanktion", "minderung"])) return "jobcenter_bescheid";
  if (hasAny(text, ["gericht", "polizei", "staatsanwaltschaft", "ladung", "straf"] )) return "gericht_polizei";
  if (hasAny(text, ["krankenkasse", "aok", "pflege", "ablehnung", "hilfsmittel", "zuzahlung"])) return "krankenkasse";
  if (hasAny(text, ["rechnung", "mahnung", "forderung", "zahlung"])) return "rechnung_mahnung";
  return "wichtiger_brief";
}

function clampShortExplanation(text, lang) {
  const clean = cleanText(text).replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return "";

  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines.slice(0, 5).join("\n").trim();
  }

  const parts = clean
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?؟])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  let result = parts.slice(0, 4).join(" ").trim();

  const maxChars = lang === "ar" ? 620 : 520;
  if (result.length > maxChars) {
    result = result.slice(0, maxChars).trim();
    const lastEnd = Math.max(result.lastIndexOf("."), result.lastIndexOf("!"), result.lastIndexOf("?"), result.lastIndexOf("؟"));
    if (lastEnd > 180) result = result.slice(0, lastEnd + 1).trim();
  }

  return result || clean.slice(0, maxChars).trim();
}


function limitDetailText(text, lang, mode = "wichtiger_brief") {
  const clean = cleanText(text).replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return "";

  const blocks = clean
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const maxBlocks = mode === "wichtiger_brief" ? 4 : 5;
  const maxCharsPerBlock = lang === "ar" ? 360 : 300;

  const out = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = lines.length > 1 && lines[0].length < 60 ? lines[0] : "";
    const body = (title ? lines.slice(1).join(" ") : lines.join(" ")).replace(/\s+/g, " ").trim();
    let shortBody = body;
    if (shortBody.length > maxCharsPerBlock) {
      shortBody = shortBody.slice(0, maxCharsPerBlock).trim();
      const last = Math.max(shortBody.lastIndexOf("."), shortBody.lastIndexOf("!"), shortBody.lastIndexOf("?"), shortBody.lastIndexOf("؟"));
      if (last > 90) shortBody = shortBody.slice(0, last + 1).trim();
    }
    out.push(title ? `${title}\n${shortBody}`.trim() : shortBody);
    if (out.length >= maxBlocks) break;
  }

  return out.join("\n\n").trim();
}

async function improveQualityTextsIfNeeded(info, translated, helper, lang, sourceMode = "text") {
  const langMeta = getLanguageMeta(lang);
  const langCode = langMeta.code;

  if (!isHighRiskLetter(info)) {
    return {
      translated,
      helper
    };
  }

  const mode = buildQualityModeType(info);
  const safe = getSafeCriticalMeta(info, sourceMode);

  const raw = await callGemini([
    {
      text: `
Du bist Hilfe24 Qualitätsmodus V7.

${buildHilfe24TextSystemRules()}

Ziel:
Verbessere die Erklärung für einen wichtigen Brief. Schreibe menschlich, einfach, kurz und praktisch.

Ausgabesprache: ${langMeta.label}
Briefmodus: ${mode}

WICHTIGE REGELN:
- Keine neuen Daten erfinden.
- Name nur nennen, wenn person_sicher = true.
- Wenn person_sicher = false, keinen Namen verwenden und keine persönliche Anrede schreiben.
- Fristen nicht als abgelaufen behaupten, wenn Zugang/Bekanntgabe nicht sicher bekannt ist.
- Beträge, Daten, Aktenzeichen nur aus den erkannten Daten übernehmen.
- Bei Inkasso/Vollstreckung: nicht automatisch Zahlungszusage empfehlen. Erst Forderung, Titel, Betrag und Gläubiger prüfen, dann Ratenzahlung nur als Möglichkeit.
- Bei Inkasso/Vollstreckung nicht sicher schreiben: "Ein Gericht hat die Forderung bestätigt". Besser: "Im Schreiben wird ein Vollstreckungstitel erwähnt. Bitte prüfen, ob Titel, Forderung und Betrag wirklich stimmen."
- Bei Jobcenter/Bescheid: Widerspruchsfrist, Rückforderung, Aufrechnung und Beratung klar nennen.
- Bei Gericht/Polizei: keine Rechtsberatung, Termin/Frist ernst nehmen, bei Unsicherheit Beratung/Anwalt erwähnen.
- Keine langen Textwände.
- Kurztext maximal 4 kurze Zeilen und höchstens 4 kurze Sätze. Keine Details wie Gebühren, Gültigkeit oder lange Folgen in den Kurztext packen.
- Details adaptiv: leichte Briefe fast keine Details, mittlere Briefe kurze Details, ernste Briefe mehr Erklärung, aber maximal 5 kleine Abschnitte. Keine Textwand.

STIL:
Human + EL5 + DLTR + Listify
- menschlich
- sehr einfach
- keine Romane
- Listen statt Textwand

ERKANNTE DATEN:
${JSON.stringify({
  briefart: info.briefart,
  absender: info.absender_kurz || info.absender_original,
  person: safe.personForOfficialText,
  person_sicher: safe.personSafe,
  betrag: info.betrag,
  frist: info.frist,
  termin: info.termin,
  referenzen: safe.referencesSafe ? info.referenzen : [],
  referenzen_sicher: safe.referencesSafe,
  roh_referenzen: info.referenzen,
  dringlichkeit: info.dringlichkeit,
  pflicht_oder_freiwillig: info.pflicht_oder_freiwillig,
  folge_wenn_nichts: info.folge_wenn_nichts,
  wichtigste_punkte: info.wichtigste_punkte,
  was_ist_zu_tun: info.was_ist_zu_tun,
  naechster_schritt: info.naechster_schritt,
  unsicherheiten: info.unsicherheiten
}, null, 2)}

AKTUELLER KURZTEXT:
${translated.kurz}

AKTUELLE DETAILS:
${translated.details}

Antworte nur mit gültigem JSON:
{
  "kurz": "",
  "details": "",
  "first_step": "",
  "next_steps": [],
  "suggested_actions": ["kurze Aktion als Text", "zweite Aktion als Text"],
  "whatsapp_summary": ""
}
`
    }
  ]);

  const parsed = extractJson(raw);
  const kurz = clampShortExplanation(parsed.kurz || translated.kurz, langCode);
  const details = limitDetailText(cleanText(parsed.details || translated.details), langCode, mode);
  const nextSteps = normalizeArray(parsed.next_steps).slice(0, 4);
  const suggestedActions = normalizeActionArray(parsed.suggested_actions).slice(0, 5);
  const firstStep = normalizeString(parsed.first_step) || helper.first_step;
  const whatsappSummary = normalizeString(parsed.whatsapp_summary) || helper.whatsapp_summary;

  return {
    translated: {
      kurz,
      details
    },
    helper: {
      ...helper,
      quality_mode: true,
      quality_type: mode,
      first_step: firstStep,
      next_steps: nextSteps.length ? nextSteps : helper.next_steps,
      suggested_actions: suggestedActions.length ? suggestedActions : helper.suggested_actions,
      whatsapp_summary: whatsappSummary
    }
  };
}

async function buildFinalPayloadFromInfo(info, lang, sourceMode = "text") {
  const langCode = getLanguageMeta(lang).code;
  const safe = getSafeCriticalMeta(info, sourceMode);

  // Für die grüne Kurz-Erklärung bei Fotos keinen unsicheren Namen verwenden.
  const safeInfoForShort = {
    ...info,
    betroffene_person: safe.personForOfficialText,
    referenzen: safe.referencesSafe ? info.referenzen : info.referenzen
  };

  const shortDe = cleanText(renderShortByLanguage(safeInfoForShort, "de"));
  const detailTemplateDe = cleanText(renderDetailTemplateGerman(safeInfoForShort));

  let translated = await translateFinalTextsIfNeeded(shortDe, detailTemplateDe, langCode);
  let helper = await buildHelperCardsFromInfo(info, langCode, sourceMode);

  const qualityResult = await improveQualityTextsIfNeeded(info, translated, helper, langCode, sourceMode);
  translated = qualityResult.translated;
  helper = qualityResult.helper;

  return {
    ok: true,
    quality_ok: true,
    hinweis: "",
    kurz: translated.kurz,
    details: translated.details,
    helper,
    meta: {
      briefart: info.briefart,
      absender: info.absender_kurz || info.absender_original,
      email_adresse: info.email_adresse,
      person: safe.personForOfficialText,
      person_sicher: safe.personSafe,
      termin: info.termin,
      frist: info.frist,
      betrag: info.betrag,
      unterlagen: info.unterlagen,
      referenzen: safe.referencesSafe ? info.referenzen : [],
      referenzen_erkannt_roh: info.referenzen,
      referenzen_sicher: safe.referencesSafe,
      dringlichkeit: info.dringlichkeit,
      pflicht_oder_freiwillig: info.pflicht_oder_freiwillig,
      naechster_schritt: info.naechster_schritt,
      antwort_sprache: info.antwort_sprache,
      passende_aktionen: info.passende_aktionen,
      unsicherheiten: info.unsicherheiten,
      sourceMode,
      must_react: inferMustReact(info),
      money_affected: inferMoneyAffected(info)
    }
  };
}

async function buildFinalAnswerFromText(text, lang) {
  const info = await buildInfoFromText(text);
  return await buildFinalPayloadFromInfo(info, lang, "text");
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

    if (bild.imageData.length > 10000000) {
      return {
        ok: false,
        error: "Ein Bild ist zu groß. Bitte fotografiere die Seite klar, aber nicht zu nah, oder lade weniger Fotos hoch."
      };
    }
  }

  const info = await buildInfoFromImages(bilder);
  return await buildFinalPayloadFromInfo(info, lang, "image");
}

function looksGermanHeavyForAudio(text, lang) {
  const langCode = getLanguageMeta(lang).code;
  if (langCode === "de") return false;

  const clean = String(text || "").toLowerCase();
  if (!clean) return false;

  const germanMarkers = [
    "der brief", "die frist", "betrag", "forderung", "widerspruch",
    "jobcenter", "inkasso", "rechnung", "mah nung", "mahnung",
    "was du", "wenn du", "prüfe", "muss", "müssen", "unterlagen",
    "erkannt", "daten", "dringlichkeit", "geld betroffen", "antwort schreiben"
  ];

  let hits = 0;
  for (const marker of germanMarkers) {
    if (clean.includes(marker)) hits++;
  }

  return hits >= 2;
}

async function translateAudioTextIfNeeded(text, lang) {
  const langMeta = getLanguageMeta(lang);
  const clean = cleanText(text);

  if (!clean || langMeta.code === "de") return clean;
  if (!looksGermanHeavyForAudio(clean, langMeta.code)) return clean;

  const raw = await callGemini([
    {
      text: `
Übersetze diesen Vorlesetext vollständig in ${langMeta.label}.

Regeln:
- Keine deutschen Sätze behalten, außer offizielle Eigennamen wie Jobcenter, AOK, HFG Inkasso.
- Beträge, Daten, Aktenzeichen und Namen exakt erhalten.
- Kurz, natürlich und einfach schreiben.
- Keine zusätzlichen Informationen hinzufügen.
- Gib nur den übersetzten Text zurück, kein JSON, kein Markdown.

TEXT:
${clean.slice(0, 2500)}
`
    }
  ]);

  return cleanText(raw);
}

async function buildAudioText(text, lang) {
  return await translateAudioTextIfNeeded(text, lang);
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


function postProcessQuestionAnswer(answer, meta = {}) {
  let out = cleanText(answer);

  // In normalen Hilfe-Antworten keine lockere Namens-Anrede verwenden.
  // Das verhindert falsche Begrüßungen wie "Hallo Krassa," oder "Hallo Ksenia,".
  // Offizielle Antwortvorlagen mit "Sehr geehrte Damen und Herren" bleiben erhalten.
  out = out.replace(/^\s*(Hallo|Hi|Hey|Merhaba|Selam|Здравейте|Здравей|Bună|Salut|Hello|مرحبا|أهلاً)\s+[^,\n]{0,80},?\s*\n+/i, "");
  out = out.replace(/^\s*(Hallo|Hi|Hey|Merhaba|Selam|Здравейте|Здравей|Bună|Salut|Hello|مرحبا|أهلاً)\s+[^,\n]{0,80},?\s*/i, "");

  // Frist nicht als sicher abgelaufen behaupten, wenn kein Zugang/Bekanntgabe-Datum sicher bekannt ist.
  out = out.replace(/Die Widerspruchsfrist ist leider schon abgelaufen\.?/gi, "Die Widerspruchsfrist beträgt laut Schreiben 1 Monat nach Bekanntgabe. Bitte prüfe, wann der Brief angekommen ist.");
  out = out.replace(/Die Widerspruchsfrist ist schon abgelaufen\.?/gi, "Die Widerspruchsfrist beträgt laut Schreiben 1 Monat nach Bekanntgabe. Bitte prüfe, wann der Brief angekommen ist.");
  out = out.replace(/Die Frist ist leider schon abgelaufen\.?/gi, "Bitte prüfe die Frist im Brief und wann der Brief angekommen ist.");
  out = out.replace(/Die Frist ist schon abgelaufen\.?/gi, "Bitte prüfe die Frist im Brief und wann der Brief angekommen ist.");
  out = out.replace(/die Widerspruchsfrist[^.\n]{0,80}abgelaufen\.?/gi, "die Widerspruchsfrist beträgt laut Schreiben 1 Monat nach Bekanntgabe. Bitte prüfe, wann der Brief angekommen ist.");
  out = out.replace(/die Frist[^.\n]{0,80}abgelaufen\.?/gi, "die Frist muss anhand des Briefes und des Zugangsdatums geprüft werden.");

  return cleanText(out);
}

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

${buildHilfe24TextSystemRules()}

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

QUALITÄTSMODUS V7:
Bei wichtigen Briefen wie Inkasso, Vollstreckung, Gericht, Polizei, Jobcenter, Rückforderung, Aufrechnung, Krankenkasse, Kündigung, Mahnung oder Bescheid musst du besonders vorsichtig sein.
- Keine Namen erfinden.
- Keine lockere Anrede wie "Hallo Krassa" oder "Hallo Ksenia" verwenden.
- Wenn meta.person fehlt, schreibe keine persönliche Anrede und unterschreibe mit [Name].
- Keine Frist als abgelaufen behaupten, wenn das tatsächliche Zugangsdatum/Bekanntgabedatum nicht sicher bekannt ist.
- Bei Inkasso/Vollstreckung: erst Forderung/Titel prüfen; Ratenzahlung nur als Möglichkeit, keine Zahlungszusage erfinden.
- Bei fertigen Schreiben an Inkasso: fordere eine Forderungsaufstellung an und bitte um Aussetzung weiterer Maßnahmen bis zur Klärung, wenn passend.
- Bei Bescheid/Widerspruch: Frist nennen, aber nicht rechtlich abschließend bewerten.
- Schreibe Human + EL5 + DLTR + Listify: menschlich, sehr einfach, kurz, listenartig.

AUFGABE:
Beantworte die Frage konkret anhand des Schreibens, der Erklärung, der erkannten Daten und der Nutzerfrage.

OBERSTE REGEL:
Der Nutzer braucht eine klare Alltagshilfe. Nicht labern. Nicht dramatisieren. Nicht wie ein langer KI-Aufsatz schreiben. Keine Einleitung wie „Okay“ oder „Hier ist deine Hilfe“. Direkt mit der Antwort starten.

ANTWORT-STIL FÜR HILFE24:
Nutze immer diese 4 Regeln:
- Human: menschlich, ruhig, direkt, nicht wie Amtssprache.
- EL5: so einfach erklären, dass auch jemand ohne Behördenwissen es versteht.
- DLTR: keine langen Textblöcke, keine Romane, keine unnötigen Details.
- Listify: wenn mehrere Schritte nötig sind, als kurze Liste schreiben.

DATEN-SICHERHEIT:
- Namen, Beträge, Fristen, Termine, Aktenzeichen und Rechnungsnummern sind kritische Daten.
- Wenn meta.person_sicher nicht true ist, nenne KEINEN Namen und beginne fertige Texte neutral mit "Sehr geehrte Damen und Herren," oder passend neutral in der Nutzersprache.
- Erfinde niemals eine Anrede wie "Hallo [Name]", wenn der Name nicht sicher ist.
- Wenn meta.referenzen_sicher nicht true ist, übernimm kein Aktenzeichen in fertige Texte; schreibe stattdessen "Aktenzeichen bitte aus dem Brief übernehmen".
- Wenn eine Frist "nach Bekanntgabe" oder "nach Erhalt" lautet, behaupte nicht, sie sei abgelaufen. Sage: "Bitte prüfe, wann der Brief angekommen ist."
- Nutze bei Namen nur meta.person. Rate keinen neuen Namen aus dem Text.
- Wenn meta.person fehlt, schreibe keinen Namen.
- Wenn ein Name unsicher wirkt oder in unsicherheiten steht, schreibe: "Bitte Namen im Brief prüfen."
- Beträge, Fristen und Aktenzeichen nur nennen, wenn sie in den erkannten Daten oder im Kontext klar stehen.
- Keine Daten erfinden, auch nicht zur besseren Formulierung.
- Behaupte NICHT, dass eine Frist abgelaufen ist, wenn das Zugangsdatum/Bekanntgabedatum nicht sicher bekannt ist. Schreibe stattdessen: "Frist laut Schreiben: ... Bitte prüfen, wann der Brief angekommen ist."
- Keine lockere Namensanrede wie "Hallo [Name]", außer der Name steht sicher in meta.person. Wenn kein sicherer Name vorhanden ist, beginne direkt mit der Antwort.

SPRACHE:
- Erklärung an den Nutzer immer vollständig in ${langMeta.label}.
- Keine deutschen Erklärsätze mischen, wenn die Nutzersprache nicht Deutsch ist.
- Nur offizielle Namen wie Jobcenter, AOK, HFG Inkasso, Bürgergeld, Aktenzeichen dürfen unverändert bleiben.
- Fertige offizielle Antworttexte an deutsche Behörden, Gerichte, Jobcenter, Krankenkassen, Inkasso, Schulen oder Ämter immer auf Deutsch.
- Wenn unklar ist, welche Sprache die offizielle Stelle nutzt, nimm die Sprache des Schreibens.

ERKANNTE DATEN NUTZEN:
Wenn vorhanden, nutze diese Daten:
- person
- absender
- frist
- termin
- betrag
- unterlagen
- email_adresse
- referenzen
- antwort_sprache

WICHTIG ZUR PERSON:
Nenne die betroffene Person nur, wenn "person" in den erkannten Daten vorhanden ist und nicht in den Unsicherheiten steht.
Nutze ausschließlich diesen erkannten Wert. Rate keinen anderen Namen aus dem Originaltext.
Wenn kein sicherer Name erkannt wurde, keinen Namen erfinden.
Wenn du unsicher bist, schreibe nur: "Bitte Namen im Brief prüfen."

GRUNDREGELN:
SPEZIALREGEL FÜR GERICHT / POLIZEI / STAATSANWALTSCHAFT / STRAFSACHE:

Wenn es um Gericht, Polizei, Staatsanwaltschaft, Strafsache, Ermittlungsverfahren, Vernehmung, Strafantrag, Aktenzeichen, Ladung oder Termin geht:

- Keine rechtliche Sicherheit behaupten.
- Nicht schreiben, dass etwas endgültig erledigt ist, wenn das Schreiben das nicht klar sagt.
- Wenn der Brief nur informiert und keine Handlung verlangt, sage klar: Im Moment ist keine Antwort nötig.
- Wenn ein Termin genannt ist, nenne Termin, Uhrzeit, Ort und Risiko bei Nichterscheinen.
- Wenn eine Frist genannt ist, nenne die Frist klar.
- Wenn ein Aktenzeichen genannt ist, nenne es klar und sage, dass es aufbewahrt werden soll.
- Wenn eine Aussage, Stellungnahme oder ein Erscheinen verlangt wird, sage klar, was verlangt wird.
- Bei Strafsachen oder Unsicherheit kurz Anwalt/Beratungsstelle empfehlen.
- Keine Vorlage schreiben, wenn keine Antwort oder Handlung nötig ist.
- Wenn der Nutzer trotzdem eine Antwort will, schreibe eine kurze sachliche Antwort ohne Schuldeingeständnis.

SPEZIALREGEL FÜR JOBCENTER / BEHÖRDE / INKASSO / MAHNUNG / RÜCKFORDERUNG:

Wenn es um Geldforderung, Rückforderung, Inkasso, Mahnung, Erstattung, Vollstreckung, Bescheid oder Jobcenter geht:

- Schreibe nicht so, als wäre die Forderung automatisch richtig.
- Nutze Wörter wie "fordert", "verlangt", "möchte zurückhaben" oder "macht geltend".
- Vermeide harte Formulierungen wie "du schuldest", "du musst zahlen", "deine Schuld ist sicher".
- Sage klar: Erst prüfen, ob die Forderung stimmt.
- Wenn eine Frist genannt ist, nenne sie klar.
- Wenn ein Betrag genannt ist, nenne ihn klar.
- Wenn Referenzen vorhanden sind, übernimm sie in Antworttexte.
- Wenn die Forderung unklar ist, soll eine Forderungsaufstellung / Berechnung / Begründung verlangt werden.
- Bei Jobcenter oder Behörde: Wenn es ernst ist, erwähne kurz Beratung, Sozialberatung oder Anwalt.
- Bei drohender Vollstreckung: Bitte um Aussetzung bis zur Klärung erwähnen.
- Ratenzahlung nur vorschlagen, wenn der Nutzer zahlen will oder ausdrücklich danach fragt.

Bei fertigen Antworttexten an Jobcenter, Behörde oder Inkasso:
- Schreibe immer sachlich und höflich.
- Bitte um Prüfung der Forderung.
- Bitte um genaue Aufstellung / Berechnung.
- Bitte um Zusendung fehlender Unterlagen, wenn nötig.
- Falls Frist läuft, formuliere vorsorglich: "Hiermit lege ich vorsorglich Widerspruch ein, soweit dies fristwahrend erforderlich ist."
- Bitte darum, bis zur Klärung keine Vollstreckung oder weiteren Maßnahmen einzuleiten.
- Keine Zahlungszusage machen, außer der Nutzer verlangt ausdrücklich Ratenzahlung oder Zahlung.
SPEZIALREGEL FÜR GERICHT / POLIZEI / STAATSANWALTSCHAFT / STRAFSACHE:

Wenn es um Gericht, Polizei, Staatsanwaltschaft, Strafsache, Ermittlungsverfahren, Vernehmung, Strafantrag, Aktenzeichen, Ladung oder Termin geht:

- Keine rechtliche Sicherheit behaupten.
- Nicht schreiben, dass etwas endgültig erledigt ist, wenn das Schreiben das nicht klar sagt.
- Wenn der Brief nur informiert und keine Handlung verlangt, sage klar: Im Moment ist keine Antwort nötig.
- Wenn ein Termin genannt ist, nenne Termin, Uhrzeit, Ort und Risiko bei Nichterscheinen.
- Wenn eine Frist genannt ist, nenne die Frist klar.
- Wenn ein Aktenzeichen genannt ist, nenne es klar und sage, dass es aufbewahrt werden soll.
- Wenn eine Aussage, Stellungnahme oder ein Erscheinen verlangt wird, sage klar, was verlangt wird.
- Bei Strafsachen oder Unsicherheit kurz Anwalt/Beratungsstelle empfehlen.
- Keine Vorlage schreiben, wenn keine Antwort oder Handlung nötig ist.
- Wenn der Nutzer trotzdem eine Antwort will, schreibe eine kurze sachliche Antwort ohne Schuldeingeständnis.
- Keine Daten erfinden.
- Keine Fristen erfinden.
- Keine Beträge erfinden.
- Keine Namen erfinden.
- Keine Aktenzeichen erfinden.
- Wenn etwas fehlt, sage kurz, was fehlt.
- Wenn Frist, Termin, Betrag, Risiko oder Aktenzeichen vorhanden sind, nenne sie klar.
- Keine Panik machen.
- Keine falsche Sicherheit geben.
- Bei rechtlichen Themen keine Rechtsberatung behaupten. Nur verständlich erklären und bei Bedarf Anwalt/Beratungsstelle empfehlen.
- Bei Gesundheit keine Diagnose und keine Dosierung erfinden.

FRAGE-MODUS:

NEUE HILFE24-REGEL:
Der Nutzer will nicht nur eine Zusammenfassung.
Er will wissen, wie er praktisch mit dem Schreiben umgehen soll.

Antworte deshalb immer mit:
1. Was ist das Schreiben?
2. Was muss der Nutzer jetzt tun?
3. Was muss er zusätzlich prüfen?

Denke allgemein:
- Muss etwas bezahlt werden?
- Muss etwas eingereicht werden?
- Gibt es eine Frist oder einen Termin?
- Muss ein Beleg gespeichert werden?
- Kann eine Erstattung bei Krankenkasse, Versicherung, Jobcenter oder anderer Stelle möglich sein?
- Kann Ratenzahlung sinnvoll sein?
- Kann Widerspruch oder Prüfung sinnvoll sein?
- Muss Beratung/Anwalt/Arzt/Apotheke empfohlen werden?

Wichtig:
Keine Erstattung erfinden.
Keine Ansprüche versprechen.
Keine Fristen erfinden.
Keine Rechtsberatung geben.
Keine Diagnose geben.
Wenn etwas möglich ist, schreibe: "prüfen lassen" oder "bei der zuständigen Stelle nachfragen".
Wenn frageMode = "deadline":
Der Nutzer will die Frist wissen.
Antworte kurz mit:
- Frist / Termin
- Was bedeutet das?
- Was passiert, wenn die Frist verpasst wird?
Wenn keine sichere Frist erkannt wurde, sage klar: "Ich sehe keine sichere Frist. Bitte im Schreiben prüfen lassen."
Keine lange allgemeine Erklärung.

Wenn frageMode = "consequence":
Der Nutzer will wissen, was passiert, wenn er nichts macht.
Antworte mit:
- mögliche Folgen
- wie dringend es ist
- was er jetzt tun sollte
Keine fertige Vorlage schreiben, außer der Nutzer bittet darum.
Keine Panik machen, aber Risiko klar nennen.

Wenn frageMode = "reply":
Der Nutzer will eine Antwort schreiben.
WICHTIG: Beginne nie mit Hallo + Name. Nutze bei offiziellen Schreiben immer "Sehr geehrte Damen und Herren,". Wenn keine E-Mail/Brief nötig ist, sage kurz warum.

Erkläre maximal mit einem kurzen Satz.
Dann direkt einen fertigen Text zum Kopieren schreiben.
Bei deutschen Stellen immer Deutsch schreiben.
Wenn "person" vorhanden ist, mit diesem Namen unterschreiben.
Wenn "person" fehlt, mit [Name] unterschreiben.
Wenn email_adresse vorhanden ist, als Empfänger nutzen.
Wenn keine email_adresse vorhanden ist, schreibe:
Empfänger: Bitte E-Mail-Adresse aus dem Brief übernehmen.

Wenn frageMode = "free":
Beantworte die eigene Frage des Nutzers normal.
Nicht zu kurz, nicht zu lang, aber vollständig.
Wenn die Frage einfach ist, kurz antworten.
Wenn es um Gericht, Polizei, Frist, Geld, Inkasso, Gesundheit oder wichtige Folgen geht, darf die Antwort ausführlicher sein, aber trotzdem klar gegliedert.

BEREICH STILL ERKENNEN:
- Gericht / Polizei / Strafsache
- Behörde / Amt / Jobcenter / Krankenkasse / Rente / Schule
- Inkasso / Mahnung / Rechnung / Forderung
- Wohnung / Vermieter / Vertrag / Kündigung
- Arbeit / Pflege / Dokumentation
- Gesundheit / Medikamente
- Produkt / Technik / Screenshot / Betrug
- sonstiger Alltag

SPEZIALREGELN:

BEI INKASSO / MAHNUNG / FORDERUNG:
- Nicht automatisch Zahlung empfehlen.
- Forderung prüfen.
- Betrag und Frist nennen, wenn vorhanden.
- Wenn unklar: Nachweis oder Forderungsaufstellung verlangen.
- Ratenzahlung nur vorschlagen, wenn der Nutzer zahlen will oder danach fragt.
- Bei Druck, Drohung oder unklarer Forderung vorsichtig formulieren.

BEI GERICHT / POLIZEI / STRAFSACHE:
- Ernst nehmen.
- Nicht ignorieren.
- Keine Rechtsberatung behaupten.
- Frist, Termin und mögliche Folgen klar nennen.
- Bei Unsicherheit Anwalt oder Beratungsstelle empfehlen.

BEI BEHÖRDE / JOBCENTER / KRANKENKASSE / RENTE / SCHULE:
- Frist, Unterlagen, Termin und Folgen klar nennen.
- Sagen, was der Nutzer einreichen, unterschreiben, beantworten oder mitbringen muss.
- Wenn eine Antwort sinnvoll ist, kurz anbieten oder direkt vorbereiten, wenn der Nutzer das will.

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

REFERENZEN:
Referenzen wie Aktenzeichen, Kundennummer, BG-Nummer, Versicherungsnummer, Rechnungsnummer, Mahnnummer, "Mein Zeichen" oder "Ihr Zeichen" müssen in offiziellen Antworten übernommen werden, wenn sie vorhanden sind.
Keine Referenzen erfinden.

DEUTSCHE E-MAIL-FORM:
Wenn eine deutsche E-Mail erstellt wird, nutze dieses Format:

Empfänger: [E-Mail-Adresse oder Hinweis]

Betreff: [passender Betreff mit Termin/Referenz, wenn vorhanden]

Sehr geehrte Damen und Herren,

[Text]

Mit freundlichen Grüßen

[erkannte Person, sonst Name-Platzhalter]

NAMENSREGEL FÜR FERTIGE TEXTE:
Wenn "person" vorhanden ist, muss dieser Name unter "Mit freundlichen Grüßen" stehen.
Schreibe niemals nur "Mit freundlichen Grüßen" ohne Namen darunter.
Schreibe niemals [Name], wenn "person" vorhanden ist.
Wenn kein Name sicher erkannt wurde, schreibe:

Mit freundlichen Grüßen

[Name]

QUALITÄT:
Die Antwort soll sich wie Hilfe24 anfühlen:
einfach, klar, vollständig, ruhig, praktisch.
Nicht wie Amtssprache.
Nicht wie Werbung.
Nicht wie ein langer KI-Aufsatz.
    Nicht wie ein langer KI-Aufsatz.
`
      }
    ]);

    let antwort = cleanText(raw)
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    antwort = postProcessQuestionAnswer(antwort, meta);

    if (frageMode === "next_steps") {
      antwort = shortenNextStepsAnswer(antwort, lang);
      antwort = postProcessQuestionAnswer(antwort, meta);
    }

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
