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

app.use(express.json({ limit: "70mb" }));
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
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^\s*[-–—]\s{2,}/gm, "- ")
    .replace(/^\s*\d+\.\s*/gm, "")
    .replace(/Sonst ist Ihr gesamtes Geld weg\.?/gi, "Ohne P-Konto ist dein Guthaben deutlich schlechter geschützt.")
    .replace(/Sonst ist dein gesamtes Geld weg\.?/gi, "Ohne P-Konto ist dein Guthaben deutlich schlechter geschützt.")
    .replace(/das gesamte Geld ist weg\.?/gi, "Guthaben über dem geschützten Betrag kann gesperrt oder abgeführt werden.")
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

  function normalizePersonArray(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => normalizePerson(item))
      .filter(Boolean);
  }

  return {
    absender_original: normalizeString(info.absender_original),
    absender_kurz: normalizeString(info.absender_kurz),
    email_adresse: normalizeString(info.email_adresse),
    briefart: normalizeString(info.briefart),
    betroffene_person: normalizePerson(info.betroffene_person),
    empfaenger: normalizePerson(info.empfaenger),
    betroffene_personen: normalizePersonArray(info.betroffene_personen),
    zeugen: normalizePersonArray(info.zeugen),
    angeklagte_beschuldigte: normalizePersonArray(info.angeklagte_beschuldigte),
    weitere_genannte_personen: normalizePersonArray(info.weitere_genannte_personen),
    aktenzeichen_gericht: normalizeString(info.aktenzeichen_gericht),
    aktenzeichen_staatsanwaltschaft: normalizeString(info.aktenzeichen_staatsanwaltschaft),
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
      ["de", "tr", "bg", "ar", "ro", "en", "unklar"],
      "unklar"
    ),

    brief_schwierigkeit: normalizeChoice(
      info.brief_schwierigkeit,
      ["leicht", "mittel", "ernst", "unklar"],
      "unklar"
    ),
    was_will_der_absender: normalizeString(info.was_will_der_absender),
    muss_handeln: normalizeChoice(
      info.muss_handeln,
      ["ja", "nein", "unklar"],
      "unklar"
    ),
    geld_betroffen: normalizeChoice(
      info.geld_betroffen,
      ["ja", "nein", "unklar"],
      "unklar"
    ),
    risiko_kurz: normalizeString(info.risiko_kurz),
    erster_sicherer_schritt: normalizeString(info.erster_sicherer_schritt),
    daten_unsicher: normalizeArray(info.daten_unsicher),

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

Erklärung zum Brief:
- Es gibt nur einen Haupt-Erklärblock.
- Die Erklärung muss so lang sein wie nötig und so kurz wie möglich.
- Leichter Brief: wenige klare Sätze.
- Mittlerer Brief: etwas mehr Erklärung.
- Ernster/komplizierter Brief: mehrere kurze Abschnitte oder kurze Liste, aber keine Textwand.
- Der Nutzer muss verstehen: Was ist das? Worum geht es? Was ist wichtig? Was muss ich tun? Gibt es Frist, Termin, Geld oder Risiko?
- Keine Datenbox wiederholen. Keine Paragraphen ausbreiten. Keine Romane.
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

ROLLEN-ERKENNUNG BEI MEHREREN PERSONEN:
Viele Briefe nennen mehrere Menschen. Dann darfst du nicht einfach irgendeinen Namen als betroffene Person nehmen.
Erkenne Rollen getrennt:
- empfaenger: Person im Adressfeld / Empfänger des Briefes
- betroffene_personen: Personen, gegen die sich der Beschluss/Forderung/Bescheid wirklich richtet
- zeugen: Personen, die im Brief ausdrücklich als Zeugen genannt werden
- angeklagte_beschuldigte: Angeklagte, Beschuldigte oder Betroffene im Straf-/Gerichtsverfahren
- weitere_genannte_personen: andere erkennbare Personen, z. B. Anwalt, Sachbearbeiter nur wenn als Person relevant
Bei Gericht/Polizei/Staatsanwaltschaft unbedingt unterscheiden:
Empfänger ≠ Angeklagter ≠ Zeuge ≠ Sachbearbeiter.
Wenn mehrere Personen genannt sind, schreibe in unsicherheiten: "Mehrere Personen genannt – Rolle bitte prüfen".
Für die Kurz-Erklärung keine falsche einzelne Person behaupten, wenn mehrere Personen betroffen sind.

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
- Bank / Kontopfändung / P-Konto
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

V8 UNIVERSAL LETTER UNDERSTANDING:
Zerlege jeden Brief zuerst in feste Bausteine. Denke nicht in einzelnen Spezialfällen, sondern allgemein:

1. Absender: Wer schreibt oder übermittelt den Brief?
2. Empfänger: An wen ist der Brief adressiert?
3. Personen & Rollen: Welche Personen stehen im Brief und welche Rolle haben sie?
   Beispiele: Empfänger, Antragsteller, Versicherte Person, Patient, Kunde, Schuldner, Gläubiger, Zeuge, Angeklagter, Beschuldigter, Kind, Elternteil, Vermieter, Mieter, Sachbearbeiter, Anwalt, Bevollmächtigter.
4. Briefart: Bescheid, Rechnung, Mahnung, Inkasso, Termin, Einladung, Kündigung, Anhörung, Ablehnung, Bewilligung, Rückforderung, Vertrag, Information, Werbung, Arztbrief, Gericht/Polizei.
5. Thema: Worum geht es wirklich? Geld, Termin, Unterlagen, Antrag, Leistung, Strafe, Vertrag, Gesundheit, Wohnung, Schule, Arbeit.
6. Absicht des Absenders: Was will der Absender? Zahlung, Antwort, Unterlagen, Termin, Prüfung, Information, Bestätigung, Kündigung, nichts.
7. Handlungspflicht: Muss der Nutzer reagieren? ja/nein/unklar.
8. Frist/Termin/Datum: Gibt es Frist, Termin, Zahlungsziel, Widerspruchsfrist, Abgabedatum oder Rechtsbehelf?
9. Geld: Geht es um Betrag, Forderung, Rechnung, Erstattung, monatlichen Abzug, Kosten oder Gebühren?
10. Risiko: Was kann passieren, wenn nichts gemacht wird? Nur nennen, wenn es im Brief steht oder sehr klar aus Briefart folgt.
11. Unsicherheit: Welche Daten sind unsicher? Name, Aktenzeichen, Betrag, Frist, Datum, Personenzuordnung.
12. Erster sicherer Schritt: Der einfachste und sicherste erste Schritt für den Nutzer.

SCHWIERIGKEITSSTUFE:
- leicht: Werbung, reine Information, einfache Terminbestätigung, einfache Rechnung ohne Risiko.
- mittel: Krankenkasse, Schule, Versicherung, Vermieter, normale Rechnung/Forderung, Unterlagennachforderung.
- ernst: Gericht, Polizei, Staatsanwaltschaft, Inkasso, Vollstreckung, Jobcenter, Rückforderung, Aufrechnung, Kündigung, Mahnbescheid, Pfändung, Frist/Rechtsbehelf.

AUSGABE-PRINZIP:
Außen soll Hilfe24 leicht bleiben. Kein langer Roman. Der Server soll innen mehr verstehen, aber außen nur das Wichtigste geben.



V8.6.6 FEINE BRIEFARTEN:
Sortiere Briefe genauer. Nutze nicht zu schnell "Inkasso/Forderung".
- Stadt / Kommune / öffentlich-rechtliche Mahnung: wenn Stadt, Stadtkasse, Kassenzeichen, Gebühren, Verwaltungsgebühr oder kommunale Forderung vorkommen.
- Rundfunkbeitrag / Beitragsservice / Vollstreckungsankündigung: wenn Beitragsservice, Rundfunkbeitrag, Beitragskonto oder ARD ZDF Deutschlandradio vorkommen.
- Finanzamt / Steuerschuld / Mahnung / Vollstreckungsankündigung: wenn Finanzamt, Einkommensteuer, Steuernummer, Säumniszuschlag, Mahnung, sofort fällig, Vollstreckungsstelle oder Vollstreckungsankündigung vorkommen.
- Staatsanwaltschaft / Geldauflage / Zahlungsaufforderung: wenn Staatsanwaltschaft, Geldauflage, Strafsache, Zahlungsaufforderung, Frist zur Zahlung, Einstellung gegen Auflage oder Verfahren kann weitergehen vorkommen.
- Anklageschrift / Strafsache / Amtsgericht: wenn Anklageschrift, Angeschuldigter, Staatsanwaltschaft, Hauptverfahren, Zulassung der Anklage, Beweismittel oder Fahren ohne Fahrerlaubnis vorkommen.
- Zahnarztrechnung / DZR / zahnärztliche Behandlung: wenn DZR, Zahnarzt, Zahnarztrechnung, GOZ, BEMA, Leistungsposition, Zahnnummer, Faktor, Labor oder Materialkosten vorkommen.
- Arbeitsvertrag / Änderungsvereinbarung: wenn Arbeitgeber, Arbeitsvertrag, Änderungsvereinbarung, befristet, unbefristet, Arbeitszeit, Gehalt oder Anstellung vorkommen.

DETAILFRAGEN-REGEL:
Wenn der Nutzer später nach konkreten Details fragt, z. B. "Welche Behandlung war das?", "Wofür ist die Rechnung?", "Was wurde genau gemacht?", sollen die relevanten Details aus dem Schreiben gelesen werden.
Wenn diese Details nicht sicher erkennbar sind, nicht nur "prüfe selbst" schreiben. Stattdessen genau sagen, welche Seite oder welchen Ausschnitt benötigt wird.
Beispiele:
- Zahnarzt/DZR: Seite mit Leistungspositionen, GOZ/BEMA-Nummern, Leistungsbeschreibung, Zahnnummer, Faktor, Labor/Materialkosten.
- Arbeitsvertrag: Seite/Abschnitt mit Änderung, Datum, Befristung, Unterschrift.
- Finanzamt: Seite mit Berechnung, Steuerjahr, Fälligkeit, Steuernummer, Rechtsbehelf.
- Gericht/Anklage: Seite mit Tatvorwurf, Frist, Aktenzeichen, Beweismitteln.

FACHLICHE SORTIERUNG V8.6.6:
- Staatsanwaltschaft/Geldauflage: nicht als Inkasso/Rechnung behandeln. Erkläre: Geldauflage in einer Strafsache; fristgerecht zahlen oder sofort Ratenzahlung/Stundung beantragen; bei Nichtzahlung kann Verfahren/weitere Maßnahme folgen.
- Finanzamt/Mahnung: nicht als normale Rechnung behandeln. Erkläre: offene Steuer, sofort fällig, Säumniszuschlag möglich, Vollstreckung möglich; bei Zahlungsproblem Stundung/Ratenzahlung und Aussetzung der Vollstreckung beantragen.
- Rundfunkbeitrag: nicht als privates Inkasso behandeln. Erkläre: öffentlich-rechtliche Beitragsforderung; Beitragsnummer wichtig; bei Jobcenter/Bürgergeld Bescheid erneut senden und Befreiung/rückwirkende Befreiung prüfen.
- Anklageschrift: nicht nur "Gericht/Polizei". Erkläre: Gericht hat Anklageschrift übersandt, Zulassung/Hauptverfahren wird geprüft, 1-Woche-Frist für Einwände/Beweise/Zeugen, normale E-Mail reicht oft nicht.
- Zahnarztrechnung/DZR: aktiv nach Behandlung/Positionen suchen. Wenn nicht sichtbar: genaue Seite mit GOZ/BEMA/Leistungsbeschreibung verlangen.

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
Bei Justiz/Gericht/Staatsanwaltschaft:
- aktenzeichen_staatsanwaltschaft: z. B. "42 Js 1643/25"
- aktenzeichen_gericht: z. B. "22 Ds-42 Js 1643/25-293/25"
Wenn beide vorkommen, beide getrennt übernehmen.
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

BANK / KONTO / P-KONTO / KONTOPFÄNDUNG:
Wenn es um Bank, Konto, Kontopfändung, Pfändungsschutzkonto, P-Konto, Freibetrag oder gesperrtes Konto geht:
- Erkläre allgemein: Ein P-Konto schützt nur den gesetzlichen Freibetrag, nicht automatisch das ganze Konto und nicht automatisch die Forderung.
- Nicht behaupten, dass die Pfändung falsch ist.
- Prüfen: Wer pfändet? Welcher Gläubiger? Welcher Betrag? Gibt es ein Aktenzeichen? Ist das Konto wirklich als P-Konto geführt? Reicht der Freibetrag? Wird eine P-Konto-Bescheinigung benötigt?
- Nächster Schritt: Bank kontaktieren und bei Unsicherheit Schuldnerberatung/Verbraucherzentrale/Sozialberatung nutzen.
- Ratenzahlung nur als Möglichkeit nennen, wenn Forderung und Betrag stimmen und der Nutzer zahlen kann.

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

GERICHT / POLIZEI / STAATSANWALTSCHAFT:
- Immer vorsichtig und sachlich erklären.
- Keine Schuld behaupten.
- Rollen sauber trennen: Empfänger, Angeklagter/Beschuldigter, Zeuge, Anwalt, Gericht/Staatsanwaltschaft.
- Bei Ordnungsgeld/Ordnungshaft klar sagen: ernst nehmen, Grund/Nachweise prüfen, rechtliche Hilfe erwägen.
- Wenn mehrere Personen genannt werden, in der Erklärung sagen: "Der Brief nennt mehrere Personen. Bitte prüfen, wer genau handeln muss."
- Aktenzeichen von Gericht und Staatsanwaltschaft getrennt erfassen, wenn beide sichtbar sind.

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

FÜR "erster_sicherer_schritt":
Der erste sichere Schritt, der fast nie schadet. Beispiele:
- Brief vollständig aufbewahren und Frist prüfen.
- Betrag und Absender prüfen.
- Bei Unsicherheit schriftlich nachfragen.
- Bei Gericht/Inkasso/Behörde Beratung holen.
- Bei Termin: Termin prüfen und rechtzeitig absagen/verschieben, wenn man nicht kann.

FÜR "daten_unsicher":
Liste alle kritischen Daten, die nicht sicher gelesen oder nicht sicher zugeordnet wurden. Beispiele: Name, Aktenzeichen, Betrag, Frist, Datum, Personenzuordnung.

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
"empfaenger": "",
"betroffene_personen": [],
"zeugen": [],
"angeklagte_beschuldigte": [],
"weitere_genannte_personen": [],
"aktenzeichen_gericht": "",
"aktenzeichen_staatsanwaltschaft": "",
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
  "brief_schwierigkeit": "unklar",
  "was_will_der_absender": "",
  "muss_handeln": "unklar",
  "geld_betroffen": "unklar",
  "risiko_kurz": "",
  "erster_sicherer_schritt": "",
  "daten_unsicher": [],
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


function renderBalancedExplanationGerman(info) {
  const sender = String(info.absender_kurz || info.absender_original || "").trim();
  const briefart = String(info.briefart || "").trim();
  const topic = String(info.worum_geht_es || "").trim();
  const summary = String(info.kurz_gesagt || "").trim();
  const amount = String(info.betrag || "").trim();
  const deadline = String(info.frist || "").trim();
  const appointment = String(info.termin || "").trim();
  const consequence = String(info.folge_wenn_nichts || "").trim();
  const firstStep = String(info.erster_sicherer_schritt || info.naechster_schritt || "").trim();
  const actions = dedupe(info.was_ist_zu_tun || []);
  const important = dedupe(info.wichtigste_punkte || []);
  const references = dedupe(info.referenzen || []);
  const depth = detectDetailDepth(info);

  const joined = [briefart, topic, summary, consequence, firstStep, actions.join(" "), important.join(" ")].join(" ").toLowerCase();
  const lines = [];

  function clean(text) {
    return String(text || "").trim().replace(/\s+/g, " ").replace(/[.;,\s]+$/g, "");
  }

  function add(text, max = 180) {
    let c = clean(text);
    if (!c) return;
    if (c.length > max) {
      let cut = c.slice(0, max).trim();
      const last = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
      if (last > 80) cut = cut.slice(0, last).trim();
      c = cut.replace(/[,:;\s]+$/g, "");
    }
    const sentence = c + ".";
    if (!lines.some((x) => x.toLowerCase() === sentence.toLowerCase())) lines.push(sentence);
  }

  function actionHint() {
    if (appointment) return "Wenn du den Termin nicht wahrnehmen kannst, solltest du rechtzeitig absagen oder einen neuen Termin anfragen";
    if (hasAny(joined, ["inkasso", "vollstreckung", "vollstreckungstitel", "forderung"])) return "Prüfe zuerst, ob Forderung, Titel, Betrag und Aktenzeichen wirklich stimmen";
    if (hasAny(joined, ["jobcenter", "rückforderung", "aufrechnung", "widerspruch", "bescheid"])) return "Prüfe, ob der Bescheid und der Betrag stimmen, und achte auf die Widerspruchsfrist";
    if (hasAny(joined, ["gericht", "polizei", "staatsanwaltschaft", "ordnungsgeld", "ladung"])) return "Nimm den Brief ernst und prüfe, ob du schnell schriftlich reagieren oder Nachweise einreichen musst";
    if (hasAny(joined, ["rechnung", "zahlung", "gebühr"])) return "Prüfe, ob Rechnung, Leistung und Betrag stimmen, bevor du zahlst";
    if (hasAny(joined, ["unterlagen", "nachweis", "nachreichen"])) return "Sammle die genannten Unterlagen und reiche sie rechtzeitig ein";
    if (firstStep) return firstStep;
    if (actions[0]) return actions[0];
    return "Prüfe den Brief und bewahre ihn auf";
  }

  if (briefart && sender) add(`Das ist ein ${briefart} von ${sender}`, 130);
  else if (sender) add(`Der Brief kommt von ${sender}`, 120);
  else if (briefart) add(`Das ist ein ${briefart}`, 100);
  else add("Das ist ein Schreiben", 80);

  if (topic) add(`Es geht um ${topic}`, depth === "ernst" ? 230 : 180);
  else if (summary) add(summary, depth === "ernst" ? 230 : 180);

  if (amount && hasAny(joined, ["rechnung", "forderung", "rückforderung", "aufrechnung", "inkasso", "zahlung", "gebühr", "ordnungsgeld"])) {
    add(`Es geht um einen Betrag von ${amount}`, 110);
  }

  if (appointment) add(`Wichtig ist der Termin: ${appointment}`, 130);
  if (deadline) add(`Wichtig ist die Frist: ${deadline}`, 150);

  add(actionHint(), 210);

  if (consequence && depth !== "leicht") {
    add(`Wenn du nichts machst, können Nachteile entstehen: ${consequence}`, depth === "ernst" ? 240 : 190);
  }

  if (depth === "ernst") {
    if (references.length > 0) add("Prüfe wichtige Nummern oder Aktenzeichen im Originalbrief", 120);
    add("Wenn du unsicher bist, hole dir Hilfe bei der zuständigen Stelle, einer Beratungsstelle oder einer fachkundigen Person", 170);
  }

  const maxLines = depth === "leicht" ? 5 : depth === "mittel" ? 7 : 9;
  return dedupe(lines).slice(0, maxLines).join("\n");
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

  let parsed;

  try {
    parsed = extractJson(raw);
  } catch (error) {
    console.error("Übersetzung konnte nicht als JSON gelesen werden:", error.message || error);
    return {
      kurz: protectedKurz.text,
      details: localizeDetailHeadings(protectedDetails.text, langMeta.code)
    };
  }

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
    kurz: kurz || protectedKurz.text,
    details: localizeDetailHeadings(detailsRaw || protectedDetails.text, langMeta.code)
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
      risk: "Risiko",
      recipient: "Empfänger",
      affectedPeople: "Betroffene Personen",
      witnesses: "Zeugen",
      defendant: "Angeklagte/Beschuldigte",
      courtReference: "Aktenzeichen Gericht",
      prosecutorReference: "Aktenzeichen Staatsanwaltschaft",
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
      risk: "Risk",
      recipient: "Alıcı",
      affectedPeople: "İlgili kişiler",
      witnesses: "Tanıklar",
      defendant: "Sanık/Şüpheli",
      courtReference: "Mahkeme dosya numarası",
      prosecutorReference: "Savcılık dosya numarası",
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
      risk: "Риск",
      recipient: "Получател",
      affectedPeople: "Засегнати лица",
      witnesses: "Свидетели",
      defendant: "Обвиняем/подсъдим",
      courtReference: "Номер на съда",
      prosecutorReference: "Номер на прокуратурата",
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
      risk: "Risc",
      recipient: "Destinatar",
      affectedPeople: "Persoane vizate",
      witnesses: "Martori",
      defendant: "Inculpat/suspect",
      courtReference: "Număr instanță",
      prosecutorReference: "Număr parchet",
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
      risk: "الخطر",
      recipient: "المستلم",
      affectedPeople: "الأشخاص المعنيون",
      witnesses: "الشهود",
      defendant: "المتهم",
      courtReference: "رقم المحكمة",
      prosecutorReference: "رقم النيابة",
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
      recipient: "Recipient",
      affectedPeople: "Affected people",
      witnesses: "Witnesses",
      defendant: "Defendant/suspect",
      courtReference: "Court file number",
      prosecutorReference: "Prosecution file number",
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

  const fineLabels = {
    prosecutorPayment: { de: "Staatsanwaltschaft / Geldauflage / Zahlungsaufforderung", tr: "Savcılık / para yükümlülüğü / ödeme yazısı", bg: "Прокуратура / парична вноска / искане за плащане", ro: "Parchet / obligație de plată / somație", ar: "النيابة / غرامة أو مبلغ في قضية / طلب دفع", en: "Prosecution / payment order / criminal case" },
    indictment: { de: "Anklageschrift / Strafsache / Amtsgericht", tr: "İddianame / Ceza davası / Mahkeme", bg: "Обвинителен акт / наказателно дело / съд", ro: "Rechizitoriu / cauză penală / instanță", ar: "لائحة اتهام / قضية جنائية / محكمة", en: "Indictment / criminal case / court" },
    broadcast: { de: "Rundfunkbeitrag / Beitragsservice / Vollstreckungsankündigung", tr: "Rundfunkbeitrag / Beitragsservice / icra uyarısı", bg: "Радио-телевизионна такса / принудително събиране", ro: "Taxă radio-TV / Beitragsservice / executare", ar: "رسوم البث / خدمة الاشتراك / تنفيذ", en: "Broadcast fee / collection / enforcement" },
    tax: { de: "Finanzamt / Steuerschuld / Mahnung / Vollstreckungsankündigung", tr: "Maliye / vergi borcu / ödeme uyarısı", bg: "Данъчна служба / данъчно задължение / предупреждение", ro: "Finanțe / datorie fiscală / somație", ar: "مصلحة الضرائب / دين ضريبي / إنذار", en: "Tax office / tax debt / enforcement warning" },
    dental: { de: "Zahnarztrechnung / DZR", tr: "Diş hekimi faturası / DZR", bg: "Зъболекарска фактура / DZR", ro: "Factură dentist / DZR", ar: "فاتورة طبيب أسنان / DZR", en: "Dental invoice / DZR" },
    work: { de: "Arbeitsvertrag / Änderungsvereinbarung", tr: "İş sözleşmesi / değişiklik", bg: "Трудов договор / изменение", ro: "Contract de muncă / modificare", ar: "عقد عمل / تعديل", en: "Employment contract / amendment" },
    publicClaim: { de: "Stadt / öffentliche Mahnung", tr: "Belediye / resmi ödeme uyarısı", bg: "Община / публично вземане", ro: "Primărie / somație publică", ar: "بلدية / مطالبة رسمية", en: "City / public claim" },
    bank: { de: "Bank / Pfändung / P-Konto", tr: "Banka / Haciz / P-Konto", bg: "Банка / Запор / P-Konto", ro: "Bancă / poprire / P-Konto", ar: "بنك / حجز / حساب P-Konto", en: "Bank / garnishment / P-Konto" }
  };

  if (hasAny(text, ["geldauflage", "zahlungsaufforderung", "staatsanwaltschaft", "auflage", "strafverfahren", "verfahren weiter", "einstellung gegen auflage"])) return (fineLabels.prosecutorPayment[lang] || fineLabels.prosecutorPayment.de);
  if (hasAny(text, ["anklageschrift", "hauptverfahren", "zulassung der anklage", "angeschuldig", "strafgericht", "fahren ohne fahrerlaubnis"])) return (fineLabels.indictment[lang] || fineLabels.indictment.de);
  if (hasAny(text, ["rundfunkbeitrag", "beitragsservice", "beitragskonto", "ard zdf", "deutschlandradio", "rundfunkgebühr"])) return (fineLabels.broadcast[lang] || fineLabels.broadcast.de);
  if (hasAny(text, ["finanzamt", "einkommensteuer", "steuerbescheid", "steuernummer", "säumniszuschlag", "vollstreckungsstelle", "steuerforderung", "steuerart", "sofort fällig"])) return (fineLabels.tax[lang] || fineLabels.tax.de);
  if (hasAny(text, ["dzr", "zahnarzt", "zahnärzt", "goz", "bema", "zahnnummer", "labor", "materialkosten", "zahnersatz"])) return (fineLabels.dental[lang] || fineLabels.dental.de);
  if (hasAny(text, ["änderungsvereinbarung", "arbeitsvertrag", "arbeitgeber", "anstellung", "unbefristet", "befristet", "arbeitszeit", "gehalt"])) return (fineLabels.work[lang] || fineLabels.work.de);
  if (hasAny(text, ["stadt", "stadtkasse", "kassenzeichen", "verwaltungsgebühr", "gebührenbescheid", "öffentliche forderung"])) return (fineLabels.publicClaim[lang] || fineLabels.publicClaim.de);
  if (hasAny(text, ["p-konto", "pfändungsschutzkonto", "kontopfändung", "konto gepfändet", "bank", "freibetrag"])) return (fineLabels.bank[lang] || fineLabels.bank.de);
  if (hasAny(text, ["inkasso", "vollstreckungstitel", "vollstreckung", "gerichtsvollzieher", "pfändung"])) return H.types.inkasso;
  if (hasAny(text, ["jobcenter", "bürgergeld", "aufrechnung", "rückforderung", "bescheid", "rechtsbehelf", "widerspruch"])) return H.types.jobcenter;
  if (hasAny(text, ["gericht", "polizei", "staatsanwaltschaft"])) return H.types.policeCourt;
  if (hasAny(text, ["rechnung"])) return H.types.invoice;
  if (hasAny(text, ["mahnung", "forderung"])) return H.types.claim;
  if (hasAny(text, ["termin", "einladung", "ladung"])) return H.types.appointment;
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
  if (info.erster_sicherer_schritt) {
    steps.unshift(info.erster_sicherer_schritt);
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

function listValue(items) {
  const arr = dedupe(Array.isArray(items) ? items : []).filter(Boolean);
  return arr.join(", ");
}

function inferSpecialDataKind(info) {
  const text = buildLetterContext(info || {});
  if (hasAny(text, ["finanzamt", "steuernummer", "einkommensteuer", "säumniszuschlag", "vollstreckungsankündigung", "steuerforderung"])) return "tax";
  if (hasAny(text, ["rundfunkbeitrag", "beitragsservice", "beitragskonto", "ard zdf", "deutschlandradio"])) return "broadcast";
  if (hasAny(text, ["geldauflage", "staatsanwaltschaft", "zahlungsaufforderung", "strafverfahren"])) return "prosecutor_payment";
  if (hasAny(text, ["anklageschrift", "hauptverfahren", "zulassung der anklage", "angeschuldig", "fahren ohne fahrerlaubnis"])) return "indictment";
  if (hasAny(text, ["dzr", "zahnarzt", "zahnärzt", "goz", "bema", "zahnnummer", "labor", "materialkosten", "zahnersatz"])) return "dental";
  if (hasAny(text, ["änderungsvereinbarung", "arbeitsvertrag", "arbeitgeber", "befristet", "unbefristet", "arbeitszeit", "gehalt"])) return "work";
  return "default";
}

function firstReferenceLike(info, words) {
  const refs = dedupe(info.referenzen || []);
  const lowerWords = (words || []).map((x) => String(x).toLowerCase());
  const hit = refs.find((ref) => {
    const r = String(ref || "").toLowerCase();
    return lowerWords.some((w) => r.includes(w));
  });
  return hit || refs[0] || "";
}

function pushDataRow(rows, key, label, value, fallbackStatus = "check") {
  const v = normalizeString(value);
  if (!v) return;
  rows.push({ key, label, value: v, status: fallbackStatus });
}

function buildRoleAwareDataRows(info, L, safe, values) {
  const rows = [];
  const kind = inferSpecialDataKind(info);
  const sender = values.senderValue;
  const amount = values.amountValue;
  const deadline = values.deadlineValue;
  const reference = values.referenceValue;

  if (kind === "tax") {
    pushDataRow(rows, "sender", L.sender || "Absender", sender, sender === L.check ? "check" : "safe");
    pushDataRow(rows, "tax_reference", "Steuernummer/Aktenzeichen", firstReferenceLike(info, ["steuer", "nummer", "zeichen"]) || reference, "check");
    pushDataRow(rows, "tax_type", "Steuerart/Jahr", hasAny(buildLetterContext(info), ["einkommensteuer"]) ? "Einkommensteuer" : "Bitte prüfen", "check");
    pushDataRow(rows, "amount", "Gesamtbetrag", amount, amount === L.check ? "check" : "safe");
    pushDataRow(rows, "deadline", "Fällig/Frist", deadline, deadline === L.check ? "check" : "safe");
    return rows.filter((row) => row.value && row.value !== "").slice(0, 7);
  }

  if (kind === "broadcast") {
    pushDataRow(rows, "sender", L.sender || "Absender", sender, sender === L.check ? "check" : "safe");
    pushDataRow(rows, "broadcast_reference", "Beitragsnummer", firstReferenceLike(info, ["beitrag", "konto", "nummer"]) || reference, "check");
    pushDataRow(rows, "amount", L.amount || "Betrag", amount, amount === L.check ? "check" : "safe");
    pushDataRow(rows, "deadline", L.deadline || "Frist/Termin", deadline, deadline === L.check ? "check" : "safe");
    if (info.risiko_kurz) pushDataRow(rows, "risk", L.risk || "Risiko", info.risiko_kurz, "check");
    return rows.filter((row) => row.value && row.value !== "").slice(0, 6);
  }

  if (kind === "prosecutor_payment") {
    pushDataRow(rows, "sender", L.sender || "Absender", sender, sender === L.check ? "check" : "safe");
    pushDataRow(rows, "type", "Art", "Geldauflage / Zahlungsaufforderung", "safe");
    pushDataRow(rows, "amount", L.amount || "Betrag", amount, amount === L.check ? "check" : "safe");
    pushDataRow(rows, "deadline", L.deadline || "Frist/Termin", deadline, deadline === L.check ? "check" : "safe");
    pushDataRow(rows, "reference", L.reference || "Aktenzeichen", reference, "check");
    return rows.filter((row) => row.value && row.value !== "").slice(0, 7);
  }

  if (kind === "dental") {
    pushDataRow(rows, "sender", "Rechnungssteller", sender, sender === L.check ? "check" : "safe");
    pushDataRow(rows, "person", L.person || "Patient", values.personValue, safe.personSafe ? "safe" : "check");
    pushDataRow(rows, "amount", L.amount || "Betrag", amount, amount === L.check ? "check" : "safe");
    pushDataRow(rows, "reference", "Rechnungsnummer/Referenz", reference, "check");
    pushDataRow(rows, "deadline", L.deadline || "Frist/Termin", deadline, deadline === L.check ? "check" : "safe");
    return rows.filter((row) => row.value && row.value !== "").slice(0, 6);
  }

  const recipient = normalizeString(info.empfaenger);
  const affected = listValue(info.betroffene_personen);
  const witnesses = listValue(info.zeugen);
  const defendants = listValue(info.angeklagte_beschuldigte);
  const courtRef = normalizeString(info.aktenzeichen_gericht);
  const prosecutorRef = normalizeString(info.aktenzeichen_staatsanwaltschaft);

  if (recipient) rows.push({ key: "recipient", label: L.recipient || "Empfänger", value: recipient, status: "check" });
  if (affected) rows.push({ key: "affected_people", label: L.affectedPeople || "Betroffene Personen", value: affected, status: "check" });
  if (witnesses) rows.push({ key: "witnesses", label: L.witnesses || "Zeugen", value: witnesses, status: "check" });
  if (defendants) rows.push({ key: "defendant", label: L.defendant || "Angeklagte/Beschuldigte", value: defendants, status: "check" });

  rows.push({ key: "person", label: L.person, value: values.personValue, status: safe.personSafe ? "safe" : "check" });
  rows.push({ key: "sender", label: L.sender, value: values.senderValue, status: values.senderValue === L.check ? "check" : "safe" });
  rows.push({ key: "amount", label: L.amount, value: values.amountValue, status: values.amountValue === L.check ? "check" : "safe" });
  rows.push({ key: "deadline", label: L.deadline, value: values.deadlineValue, status: values.deadlineValue === L.check ? "check" : "safe" });
  if (info.risiko_kurz) rows.push({ key: "risk", label: L.risk || "Risiko", value: info.risiko_kurz, status: "check" });

  if (prosecutorRef) rows.push({ key: "prosecutor_reference", label: L.prosecutorReference || "Aktenzeichen Staatsanwaltschaft", value: prosecutorRef, status: "check" });
  if (courtRef) rows.push({ key: "court_reference", label: L.courtReference || "Aktenzeichen Gericht", value: courtRef, status: "check" });
  rows.push({ key: "reference", label: L.reference, value: values.referenceValue, status: safe.referencesSafe ? "safe" : "check" });

  return rows.filter((row) => row.value && row.value !== "");
}


function buildHelpTip(info, lang) {
  const code = getLanguageMeta(lang).code;
  const text = [
    info.briefart,
    info.worum_geht_es,
    info.kurz_gesagt,
    info.folge_wenn_nichts,
    info.naechster_schritt,
    (info.wichtigste_punkte || []).join(" "),
    (info.was_ist_zu_tun || []).join(" "),
    (info.passende_aktionen || []).join(" ")
  ].join(" ").toLowerCase();

  const tips = {
    de: {
      inkasso: "Prüfe zuerst Forderung, Betrag und Titel. Wenn du möchtest, kann ich dir helfen, eine sachliche Nachricht zur Forderungsprüfung zu schreiben.",
      jobcenter: "Prüfe Betrag, Frist und Bescheid. Wenn du möchtest, kann ich dir helfen, eine Frage ans Jobcenter oder einen Widerspruch vorzubereiten.",
      gericht: "Nimm den Brief ernst. Wenn du einen Grund oder Nachweis hast, kann ich dir helfen, eine ruhige Erklärung zu formulieren.",
      krankenkasse: "Prüfe, ob Unterlagen fehlen oder ob eine Erstattung möglich sein könnte. Ich kann dir helfen, eine kurze Nachricht an die Krankenkasse zu schreiben.",
      rechnung: "Prüfe zuerst Leistung, Betrag und Zahlungsfrist. Wenn etwas unklar ist, kann ich dir eine Nachfrage oder Reklamation formulieren.",
      termin: "Wenn du den Termin nicht wahrnehmen kannst, kann ich dir helfen, eine kurze Bitte um Verschiebung zu schreiben.",
      default: "Wenn du möchtest, helfe ich dir beim nächsten Schritt: Antwort schreiben, Unterlagenliste erstellen oder prüfen, ob ein Antrag sinnvoll sein könnte."
    },
    tr: {
      inkasso: "Önce alacağı, tutarı ve varsa belgeyi kontrol et. İstersen alacağı kontrol ettirmek için sakin bir mesaj yazmana yardım edebilirim.",
      jobcenter: "Tutarı, süreyi ve kararı kontrol et. İstersen Jobcenter'a soru yazmana veya itirazı hazırlamana yardım edebilirim.",
      gericht: "Bu yazıyı ciddiye al. Geçerli bir nedenin veya belgen varsa, bunu sakin bir şekilde açıklayan bir yazı hazırlamana yardım edebilirim.",
      krankenkasse: "Eksik evrak veya geri ödeme ihtimali var mı kontrol et. İstersen sağlık sigortasına kısa bir mesaj yazmana yardım edebilirim.",
      rechnung: "Önce hizmeti, tutarı ve ödeme süresini kontrol et. Bir şey net değilse soru veya itiraz mesajı yazmana yardım edebilirim.",
      termin: "Randevuya gidemiyorsan, erteleme için kısa bir mesaj yazmana yardım edebilirim.",
      default: "İstersen bir sonraki adımda yardım ederim: cevap yazmak, evrak listesi yapmak veya başvuru gerekip gerekmediğini kontrol etmek."
    },
    bg: {
      inkasso: "Първо провери задължението, сумата и документа. Ако искаш, мога да ти помогна да напишеш спокойно съобщение за проверка на вземането.",
      jobcenter: "Провери сумата, срока и решението. Ако искаш, мога да ти помогна с въпрос до Jobcenter или с подготовка на възражение.",
      gericht: "Вземи писмото сериозно. Ако имаш причина или доказателство, мога да ти помогна да напишеш спокойно обяснение.",
      krankenkasse: "Провери дали липсват документи или дали може да има възстановяване на разходи. Мога да ти помогна с кратко съобщение до здравната каса.",
      rechnung: "Първо провери услугата, сумата и срока за плащане. Ако нещо е неясно, мога да ти помогна с въпрос или рекламация.",
      termin: "Ако не можеш да отидеш на термина, мога да ти помогна да напишеш кратка молба за преместване.",
      default: "Ако искаш, мога да ти помогна със следващата стъпка: отговор, списък с документи или проверка дали е нужен Antrag."
    },
    ro: {
      inkasso: "Verifică mai întâi datoria, suma și titlul. Dacă vrei, te pot ajuta să scrii un mesaj pentru verificarea creanței.",
      jobcenter: "Verifică suma, termenul și decizia. Dacă vrei, te pot ajuta să scrii o întrebare către Jobcenter sau să pregătești o contestație.",
      gericht: "Ia scrisoarea în serios. Dacă ai un motiv sau dovadă, te pot ajuta să formulezi o explicație calmă.",
      krankenkasse: "Verifică dacă lipsesc documente sau dacă poate exista rambursare. Te pot ajuta să scrii un mesaj scurt către casa de sănătate.",
      rechnung: "Verifică mai întâi serviciul, suma și termenul de plată. Dacă ceva este neclar, te pot ajuta cu o întrebare sau reclamație.",
      termin: "Dacă nu poți merge la programare, te pot ajuta să scrii o cerere scurtă de amânare.",
      default: "Dacă vrei, te ajut cu următorul pas: răspuns, listă de documente sau verificarea unei posibile cereri."
    },
    ar: {
      inkasso: "تحقق أولًا من المطالبة والمبلغ والوثيقة المذكورة. إذا أردت، أساعدك في كتابة رسالة هادئة لطلب التحقق من المطالبة.",
      jobcenter: "تحقق من المبلغ والمهلة والقرار. إذا أردت، أساعدك في كتابة سؤال إلى Jobcenter أو تحضير اعتراض.",
      gericht: "تعامل مع الرسالة بجدية. إذا كان لديك سبب أو دليل، أساعدك في صياغة توضيح هادئ.",
      krankenkasse: "تحقق هل توجد مستندات ناقصة أو إمكانية استرداد تكاليف. أستطيع مساعدتك في كتابة رسالة قصيرة للتأمين الصحي.",
      rechnung: "تحقق أولًا من الخدمة والمبلغ وموعد الدفع. إذا كان هناك شيء غير واضح، أساعدك في كتابة سؤال أو اعتراض.",
      termin: "إذا لم تستطع حضور الموعد، أساعدك في كتابة طلب قصير لتغيير الموعد.",
      default: "إذا أردت، أساعدك في الخطوة التالية: كتابة رد، إعداد قائمة مستندات أو فحص ما إذا كان طلب ما مناسبًا."
    },
    en: {
      inkasso: "First check the claim, amount and title. I can help you write a calm message asking for verification.",
      jobcenter: "Check the amount, deadline and decision. I can help you write a question to the Jobcenter or prepare an objection.",
      gericht: "Take this letter seriously. If you had a reason or proof, I can help you write a calm explanation.",
      krankenkasse: "Check whether documents are missing or reimbursement could be possible. I can help you write a short message to the health insurance.",
      rechnung: "First check the service, amount and payment deadline. If something is unclear, I can help you write a question or complaint.",
      termin: "If you cannot attend the appointment, I can help you write a short request to reschedule.",
      default: "I can help with the next step: writing a reply, making a document list or checking whether an application could be useful."
    }
  };

  const T = tips[code] || tips.de;

  if (hasAny(text, ["p-konto", "pfändungsschutzkonto", "kontopfändung", "konto gepfändet", "freibetrag", "bank"])) {
    const bankTips = {
      de: "Prüfe bei der Bank, ob das Konto als P-Konto geführt wird, welcher Freibetrag gilt und ob eine P-Konto-Bescheinigung nötig ist. Die Forderung selbst solltest du getrennt prüfen.",
      tr: "Bankadan hesabın P-Konto olarak kayıtlı olup olmadığını, hangi tutarın korunduğunu ve belge gerekip gerekmediğini kontrol et. Borcu ayrıca kontrol etmelisin.",
      bg: "Провери в банката дали сметката е P-Konto, какъв е защитеният минимум и дали е нужна бележка. Самото задължение провери отделно.",
      ro: "Verifică la bancă dacă contul este P-Konto, ce sumă este protejată și dacă este nevoie de adeverință. Datoria trebuie verificată separat.",
      ar: "تحقق مع البنك هل الحساب مسجل كـ P-Konto، وما هو المبلغ المحمي، وهل تحتاج إلى شهادة. يجب فحص المطالبة نفسها بشكل منفصل.",
      en: "Check with the bank whether the account is a P-Konto, which amount is protected and whether a certificate is needed. Check the claim separately."
    };
    return bankTips[code] || bankTips.de;
  }
  if (hasAny(text, ["inkasso", "mahnbescheid", "vollstreck", "pfändung", "forderung"])) return T.inkasso;
  if (hasAny(text, ["jobcenter", "bürgergeld", "rückforderung", "aufrechnung", "bescheid", "widerspruch"])) return T.jobcenter;
  if (hasAny(text, ["gericht", "polizei", "staatsanwaltschaft", "ordnungsgeld", "ladung", "zeuge", "termin" ])) return T.gericht;
  if (hasAny(text, ["krankenkasse", "aok", "versicherung", "pflege", "hilfsmittel", "erstattung"])) return T.krankenkasse;
  if (hasAny(text, ["rechnung", "zahlung", "gebühr", "kosten", "betrag"])) return T.rechnung;
  if (hasAny(text, ["termin", "einladung", "randevu", "appointment"])) return T.termin;

  return T.default;
}


function buildLetterContext(info, extra = "") {
  return [
    info.briefart,
    info.absender_original,
    info.absender_kurz,
    info.worum_geht_es,
    info.kurz_gesagt,
    info.folge_wenn_nichts,
    info.naechster_schritt,
    info.betrag,
    (info.wichtigste_punkte || []).join(" "),
    (info.was_ist_zu_tun || []).join(" "),
    (info.passende_aktionen || []).join(" "),
    (info.referenzen || []).join(" "),
    extra
  ].join(" ").toLowerCase();
}

function isBankPkontoLetter(info, extra = "") {
  const text = buildLetterContext(info || {}, extra);
  return hasAny(text, [
    "p-konto",
    "pfändungsschutzkonto",
    "kontopfändung",
    "konto gepfändet",
    "kontosperre",
    "konto gesperrt",
    "freibetrag",
    "postbank",
    "pfändungsbeschluss",
    "überweisungsbeschluss",
    "drittschuldner"
  ]);
}

function isLikelyAlreadyPkonto(info, extra = "") {
  const text = buildLetterContext(info || {}, extra);
  return hasAny(text, [
    "bereits ein p-konto",
    "schon ein p-konto",
    "ist ein p-konto",
    "als p-konto geführt",
    "pfändungsschutzkonto geführt",
    "konto ist bereits",
    "bereits als pfändungsschutzkonto"
  ]);
}

function isCourtPoliceLetter(info) {
  const text = buildLetterContext(info || {});
  return hasAny(text, ["gericht", "polizei", "staatsanwaltschaft", "ladung", "straf", "zeuge", "beschuldig", "angeklagt"]);
}

function buildCompactDataRows(info, L, safe, values) {
  const rows = [];
  const sender = values.senderValue || L.check;
  const amount = values.amountValue || L.check;
  const deadline = values.deadlineValue || L.check;
  const reference = values.referenceValue || L.check;

  rows.push({ key: "sender", label: L.sender, value: sender, status: sender === L.check ? "check" : "safe" });
  rows.push({ key: "amount", label: L.amount, value: amount, status: amount === L.check ? "check" : "safe" });
  rows.push({ key: "deadline", label: L.deadline, value: deadline, status: deadline === L.check ? "check" : "safe" });
  rows.push({ key: "reference", label: L.reference, value: reference, status: safe.referencesSafe ? "safe" : "check" });

  if (safe.personSafe && values.personValue && values.personValue !== L.check) {
    rows.unshift({ key: "person", label: L.person, value: values.personValue, status: "safe" });
  }

  return rows.filter((row) => row.value && row.value !== "").slice(0, 5);
}

function buildBankDataRows(info, L, safe, values) {
  const rows = [];
  const sender = values.senderValue || L.check;
  const amount = values.amountValue || L.check;
  const reference = values.referenceValue || L.check;
  const deadline = values.deadlineValue || L.check;

  rows.push({ key: "sender", label: L.sender, value: sender, status: sender === L.check ? "check" : "safe" });
  rows.push({ key: "amount", label: L.amount, value: amount, status: amount === L.check ? "check" : "safe" });
  rows.push({ key: "reference", label: L.reference, value: reference, status: safe.referencesSafe ? "safe" : "check" });
  rows.push({ key: "deadline", label: L.deadline, value: deadline, status: deadline === L.check ? "check" : "safe" });

  return rows.filter((row) => row.value && row.value !== "").slice(0, 4);
}

function buildBankPkontoActions(lang) {
  const code = getLanguageMeta(lang).code;
  const map = {
    de: ["P-Konto-Status prüfen", "Freibetrag klären", "Bank kontaktieren", "Bescheinigung prüfen", "Schuldnerberatung finden"],
    tr: ["P-Konto durumunu kontrol et", "Korunan tutarı netleştir", "Bankayla iletişime geç", "Belge gerekip gerekmediğini sor", "Borç danışmanlığı bul"],
    bg: ["Провери P-Konto статуса", "Изясни защитената сума", "Свържи се с банката", "Провери дали трябва удостоверение", "Намери консултация за дългове"],
    ro: ["Verifică statutul P-Konto", "Clarifică suma protejată", "Contactează banca", "Verifică adeverința", "Caută consiliere pentru datorii"],
    ar: ["تحقق من حالة P-Konto", "استفسر عن المبلغ المحمي", "تواصل مع البنك", "تحقق من الشهادة المطلوبة", "ابحث عن استشارة ديون"],
    en: ["Check P-Konto status", "Clarify protected amount", "Contact the bank", "Check certificate", "Find debt advice"]
  };
  return map[code] || map.de;
}

function renderBankPkontoExplanation(info, lang, sourceMode = "text") {
  const code = getLanguageMeta(lang).code;
  const amount = normalizeString(info.betrag);
  const deadline = normalizeString(info.frist || info.termin);
  const already = isLikelyAlreadyPkonto(info);

  const maps = {
    de: {
      head: "Die Bank informiert dich über eine Kontopfändung.",
      protect: "Ein P-Konto schützt nicht das ganze Konto, sondern nur den monatlichen Freibetrag.",
      already: "Prüfe bei der Bank, ob dein Konto wirklich als P-Konto geführt wird und welcher Freibetrag gilt.",
      notYet: "Prüfe zuerst, ob dein Konto bereits als P-Konto geführt wird. Wenn nicht, beantrage die Umwandlung sofort bei der Bank.",
      check: "Prüfe zusätzlich Gläubiger, Betrag und Aktenzeichen im Brief.",
      amount: "Betrag: ",
      deadline: "Frist/Termin: ",
      risk: "Wenn du nichts machst, kann Guthaben über dem geschützten Betrag gesperrt oder an den Gläubiger überwiesen werden."
    },
    tr: {
      head: "Banka sana hesap haczi hakkında bilgi veriyor.",
      protect: "P-Konto tüm hesabı değil, sadece aylık korunan tutarı korur.",
      already: "Bankadan hesabın gerçekten P-Konto olarak kayıtlı olup olmadığını ve korunan tutarı kontrol et.",
      notYet: "Önce hesabın P-Konto olarak kayıtlı olup olmadığını kontrol et. Değilse, bankadan hemen dönüştürme iste.",
      check: "Ayrıca alacaklıyı, tutarı ve numarayı mektupta kontrol et.",
      amount: "Tutar: ",
      deadline: "Süre/Randevu: ",
      risk: "Hiçbir şey yapmazsan, korunan tutarın üzerindeki para bloke edilebilir veya alacaklıya gönderilebilir."
    },
    bg: {
      head: "Банката те информира за запор на сметката.",
      protect: "P-Konto не защитава цялата сметка, а само месечната защитена сума.",
      already: "Провери в банката дали сметката наистина е P-Konto и каква сума е защитена.",
      notYet: "Първо провери дали сметката вече е P-Konto. Ако не е, поискай веднага преобразуване в банката.",
      check: "Провери също кредитора, сумата и номера в писмото.",
      amount: "Сума: ",
      deadline: "Срок/термин: ",
      risk: "Ако не направиш нищо, пари над защитената сума могат да бъдат блокирани или преведени на кредитора."
    },
    ro: {
      head: "Banca te informează despre o poprire pe cont.",
      protect: "Un P-Konto nu protejează tot contul, ci doar suma lunară protejată.",
      already: "Verifică la bancă dacă acest cont este într-adevăr P-Konto și ce sumă este protejată.",
      notYet: "Verifică mai întâi dacă acest cont este deja P-Konto. Dacă nu, cere imediat transformarea la bancă.",
      check: "Verifică și creditorul, suma și numărul de dosar din scrisoare.",
      amount: "Sumă: ",
      deadline: "Termen/programare: ",
      risk: "Dacă nu faci nimic, banii peste suma protejată pot fi blocați sau virați creditorului."
    },
    ar: {
      head: "البنك يُبلغك بوجود حجز على الحساب.",
      protect: "حساب P-Konto لا يحمي الحساب كله، بل يحمي فقط المبلغ الشهري المحمي.",
      already: "تحقق مع البنك هل الحساب مسجل فعلًا كـ P-Konto وما هو المبلغ المحمي.",
      notYet: "تحقق أولًا هل الحساب مسجل بالفعل كـ P-Konto. إذا لم يكن كذلك، اطلب التحويل فورًا من البنك.",
      check: "تحقق أيضًا من الدائن والمبلغ ورقم الملف في الرسالة.",
      amount: "المبلغ: ",
      deadline: "المهلة/الموعد: ",
      risk: "إذا لم تفعل شيئًا، قد يتم حجز المال فوق المبلغ المحمي أو تحويله إلى الدائن."
    },
    en: {
      head: "The bank informs you about an account garnishment.",
      protect: "A P-Konto does not protect the whole account, only the monthly protected amount.",
      already: "Check with the bank whether this account is really a P-Konto and which amount is protected.",
      notYet: "First check whether the account is already a P-Konto. If not, request the conversion immediately at the bank.",
      check: "Also check the creditor, amount and reference number in the letter.",
      amount: "Amount: ",
      deadline: "Deadline/appointment: ",
      risk: "If nothing is done, money above the protected amount may be blocked or transferred to the creditor."
    }
  };

  const T = maps[code] || maps.de;
  const lines = [
    T.head,
    T.protect,
    already ? T.already : T.notYet,
    T.check
  ];

  if (amount) lines.push(T.amount + amount + ".");
  if (deadline) lines.push(T.deadline + deadline + ".");
  lines.push(T.risk);

  return dedupe(lines).slice(0, 7).join("\n");
}

function postProcessFinalExplanation(text, lang, mode = "wichtiger_brief") {
  let out = cleanText(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  out = out
    .replace(/Sonst ist Ihr gesamtes Geld weg\.?/gi, "Ohne P-Konto ist dein Guthaben deutlich schlechter geschützt.")
    .replace(/Sonst ist dein gesamtes Geld weg\.?/gi, "Ohne P-Konto ist dein Guthaben deutlich schlechter geschützt.")
    .replace(/Sie verlieren es\.?/gi, "Guthaben über dem geschützten Betrag kann abgeführt werden.")
    .replace(/du verlierst es\.?/gi, "Guthaben über dem geschützten Betrag kann abgeführt werden.")
    .replace(/Beantrage SOFORT ein Pfändungsschutzkonto \(P-Konto\) bei der Postbank\.?/gi, "Prüfe zuerst, ob dein Konto bereits als P-Konto geführt wird. Wenn nicht, beantrage die Umwandlung sofort bei der Bank.")
    .replace(/Beantrage sofort ein Pfändungsschutzkonto \(P-Konto\)[^.]*\.?/gi, "Prüfe zuerst, ob dein Konto bereits als P-Konto geführt wird. Wenn nicht, beantrage die Umwandlung sofort bei der Bank.")
    .replace(/P-Konto beantragen:/gi, "P-Konto-Status prüfen:")
    .replace(/Ihr Konto ist dann nicht mehr komplett blockiert\.?/gi, "Der geschützte Freibetrag bleibt dann grundsätzlich verfügbar.")
    .replace(/dein Konto ist dann nicht mehr komplett blockiert\.?/gi, "Der geschützte Freibetrag bleibt dann grundsätzlich verfügbar.")
    .replace(/Pfändungsschutzkonto \(P-Konto\) umzuwandeln/gi, "P-Konto-Status und Freibetrag zu klären");

  return clampBalancedExplanation(out, getLanguageMeta(lang).code, mode);
}

function buildPkontoReplyTemplate(meta = {}, lang = "de", context = "") {
  const code = getLanguageMeta(lang).code;
  const already = isLikelyAlreadyPkonto(meta, context);
  const ref = Array.isArray(meta.referenzen) && meta.referenzen.length ? meta.referenzen[0] : "[Zeichen bitte aus dem Brief übernehmen]";
  const person = meta.person_sicher && meta.person ? meta.person : "[Name]";

  // Offizielle Antwort an eine deutsche Bank bleibt bewusst auf Deutsch.
  const middle = already
    ? `Mein Konto wird nach meinem Kenntnisstand bereits als Pfändungsschutzkonto (P-Konto) geführt.\n\nBitte bestätigen Sie mir schriftlich:\n- ob mein Konto aktuell als P-Konto geführt wird,\n- welcher Freibetrag derzeit geschützt ist,\n- ob eine zusätzliche P-Konto-Bescheinigung benötigt wird,\n- welche Beträge aktuell gesperrt oder freigegeben sind.`
    : `Ich habe Ihr Schreiben zur Kontopfändung erhalten.\n\nBitte teilen Sie mir mit, wie ich mein Konto schnellstmöglich als Pfändungsschutzkonto (P-Konto) führen lassen kann.\n\nBitte bestätigen Sie mir außerdem, welcher Freibetrag geschützt ist und ob eine zusätzliche P-Konto-Bescheinigung benötigt wird.`;

  return cleanText(`Empfänger: Bitte E-Mail-Adresse oder Anschrift aus dem Brief übernehmen\n\nBetreff: Bitte um Klärung zur Kontopfändung / P-Konto – ${ref}\n\nSehr geehrte Damen und Herren,\n\n${middle}\n\nBitte teilen Sie mir auch mit, welche nächsten Schritte aus Ihrer Sicht erforderlich sind.\n\nMit freundlichen Grüßen\n\n${person}`);
}

async function buildHelperCardsFromInfo(info, lang, sourceMode = "text") {
  const langCode = getLanguageMeta(lang).code;
  const L = simpleLabelDict(langCode);
  const safe = getSafeCriticalMeta(info, sourceMode);
  const mustReact = info.muss_handeln === "ja" ? "yes" : (info.muss_handeln === "nein" ? "no" : inferMustReact(info));
  const moneyAffected = info.geld_betroffen === "ja" ? "yes" : (info.geld_betroffen === "nein" ? "no" : inferMoneyAffected(info));
  const personValue = safe.personSafe && safe.personForOfficialText ? safe.personForOfficialText : L.check;
  const senderValue = info.absender_kurz || info.absender_original || L.check;
  const amountValue = info.betrag || L.check;
  const deadlineValue = info.frist || info.termin || L.check;
  const referenceValue = safe.referencesSafe && (info.referenzen || []).length ? (info.referenzen || []).join(", ") : L.check;
  const isBank = isBankPkontoLetter(info);

  let nextSteps = buildDeterministicNextSteps(info, langCode);
  let suggestedActions = buildSuggestedActions(info, langCode);

  if (isBank) {
    const bankSteps = {
      de: ["Kläre mit der Bank, ob dein Konto als P-Konto geführt wird.", "Prüfe, welcher Freibetrag geschützt ist.", "Prüfe Gläubiger, Betrag und Aktenzeichen im Brief.", "Hole Hilfe bei Schuldnerberatung oder Verbraucherzentrale, wenn du unsicher bist."],
      tr: ["Bankadan hesabın P-Konto olup olmadığını netleştir.", "Hangi tutarın korunduğunu kontrol et.", "Alacaklıyı, tutarı ve numarayı mektupta kontrol et.", "Emin değilsen borç danışmanlığından yardım al."],
      bg: ["Изясни с банката дали сметката е P-Konto.", "Провери каква сума е защитена.", "Провери кредитора, сумата и номера в писмото.", "Ако не си сигурен, потърси консултация за дългове."],
      ro: ["Clarifică la bancă dacă acest cont este P-Konto.", "Verifică ce sumă este protejată.", "Verifică creditorul, suma și numărul din scrisoare.", "Cere consiliere dacă nu ești sigur."],
      ar: ["استفسر من البنك هل الحساب P-Konto.", "تحقق من المبلغ المحمي.", "راجع الدائن والمبلغ ورقم الملف في الرسالة.", "اطلب استشارة ديون إذا كنت غير متأكد."],
      en: ["Clarify with the bank whether this account is a P-Konto.", "Check which amount is protected.", "Check creditor, amount and reference number in the letter.", "Get debt advice if you are unsure."]
    };
    nextSteps = bankSteps[langCode] || bankSteps.de;
    suggestedActions = buildBankPkontoActions(langCode);
  }

  const firstStep = nextSteps[0] || L.firstStepDefault;
  const briefartLabel = simpleBriefartLabel(info, langCode);
  const urgencyLabel = simpleUrgencyLabel(info, langCode);
  const unsafeParts = [];
  if (!safe.referencesSafe) unsafeParts.push(L.reference);
  if ((info.unsicherheiten || []).length) unsafeParts.push(L.check);
  const unsafeNotice = unsafeParts.length ? L.unsafe : "";
  const whatsappParts = [];
  const H = helperTextDict(langCode);
  if (info.absender_kurz || info.absender_original) whatsappParts.push(`${H.from} ${info.absender_kurz || info.absender_original}`);
  if (info.betrag) whatsappParts.push(`${H.amount}: ${info.betrag}`);
  if (info.frist) whatsappParts.push(`${H.deadline}: ${info.frist}`);
  if (info.termin) whatsappParts.push(`${H.appointment}: ${info.termin}`);

  const values = { personValue, senderValue, amountValue, deadlineValue, referenceValue };
  const dataRows = isBank
    ? buildBankDataRows(info, L, safe, values)
    : (isCourtPoliceLetter(info) ? buildRoleAwareDataRows(info, L, safe, values) : buildCompactDataRows(info, L, safe, values));

  return {
    briefart_label: briefartLabel,
    trust_label: unsafeNotice ? L.medium : L.good,
    trust_note: unsafeNotice || "",
    urgency_label: urgencyLabel,
    urgency_reason: info.frist || info.termin || info.folge_wenn_nichts || "",
    must_react_label: mustReact === "yes" ? L.yes : (mustReact === "no" ? L.no : L.check),
    money_label: moneyAffected === "yes" ? L.yes : (moneyAffected === "no" ? L.no : L.check),
    first_step: firstStep,
    help_tip: buildHelpTip(info, langCode),
    next_steps: nextSteps,
    unsafe_notice: unsafeNotice,
    data_rows: dataRows,
    suggested_actions: suggestedActions,
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
      "p-konto",
      "pfändungsschutzkonto",
      "kontopfändung",
      "konto gesperrt",
      "freibetrag",
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
      "mahnung",
      "geldauflage",
      "rundfunkbeitrag",
      "beitragsservice",
      "finanzamt",
      "säumniszuschlag",
      "anklageschrift"
    ])
  );
}

function buildQualityModeType(info) {
  const text = [info.briefart, info.worum_geht_es, info.kurz_gesagt, info.folge_wenn_nichts, (info.wichtigste_punkte || []).join(" ")].join(" ").toLowerCase();
  if (hasAny(text, ["geldauflage", "zahlungsaufforderung", "staatsanwaltschaft", "auflage", "einstellung gegen auflage", "strafverfahren weiter"])) return "staatsanwaltschaft_geldauflage";
  if (hasAny(text, ["anklageschrift", "hauptverfahren", "zulassung der anklage", "angeschuldig", "strafverfahren", "fahren ohne fahrerlaubnis"])) return "anklageschrift_strafsache";
  if (hasAny(text, ["rundfunkbeitrag", "beitragsservice", "beitragskonto", "ard zdf", "deutschlandradio"])) return "rundfunkbeitrag_vollstreckung";
  if (hasAny(text, ["finanzamt", "einkommensteuer", "steuerbescheid", "steuernummer", "säumniszuschlag", "steuerforderung", "vollstreckungsankündigung", "sofort fällig"])) return "finanzamt_steuer";
  if (hasAny(text, ["dzr", "zahnarzt", "zahnärzt", "goz", "bema", "zahnnummer", "labor", "materialkosten", "zahnersatz"])) return "zahnarztrechnung_dzr";
  if (hasAny(text, ["änderungsvereinbarung", "arbeitsvertrag", "arbeitgeber", "unbefristet", "befristet", "arbeitszeit", "gehalt"])) return "arbeitsvertrag_aenderung";
  if (hasAny(text, ["stadt", "stadtkasse", "kassenzeichen", "verwaltungsgebühr", "gebührenbescheid"])) return "stadt_oeffentliche_mahnung";
  if (hasAny(text, ["p-konto", "pfändungsschutzkonto", "kontopfändung", "konto gepfändet", "freibetrag", "bank"])) return "bank_pfaendung_pkonto";
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



function clampBalancedExplanation(text, lang, mode = "wichtiger_brief") {
  const clean = cleanText(text).replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return "";

  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s*/.test(line));

  const maxLines = mode === "bank_pfaendung_pkonto" ? 7 : (["staatsanwaltschaft_geldauflage", "anklageschrift_strafsache", "rundfunkbeitrag_vollstreckung", "finanzamt_steuer", "inkasso_vollstreckung", "jobcenter_bescheid", "gericht_polizei"].includes(mode) ? 8 : 6);
  const maxChars = lang === "ar" ? 980 : 780;

  let result = lines.length > 1 ? lines.slice(0, maxLines).join("\n") : clean;

  if (result.length > maxChars) {
    result = result.slice(0, maxChars).trim();
    const lastEnd = Math.max(result.lastIndexOf("."), result.lastIndexOf("!"), result.lastIndexOf("?"), result.lastIndexOf("؟"));
    if (lastEnd > 300) result = result.slice(0, lastEnd + 1).trim();
  }

  return result.trim();
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
Du bist Hilfe24 Qualitätsmodus V8: Universal Letter Understanding.

${buildHilfe24TextSystemRules()}

Ziel:
Erstelle einen einzigen guten Erklärblock zum Brief. Nicht zu kurz, nicht zu lang. Der Nutzer soll verstehen, was im Brief steht und was jetzt zu tun ist.

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
- Bei Bank/P-Konto/Kontopfändung: P-Konto nur als Schutz des Freibetrags erklären. Nicht schreiben, dass alles frei ist. Prüfen lassen: Pfändung, Gläubiger, Betrag, Freibetrag, Bescheinigung und Bankkontakt.
- Bei Bank/P-Konto/Kontopfändung NICHT schreiben: "Sonst ist Ihr gesamtes Geld weg". Besser: "Guthaben über dem geschützten Betrag kann gesperrt oder abgeführt werden."
- Bei Bank/P-Konto/Kontopfändung NICHT automatisch "P-Konto beantragen" schreiben, wenn der Brief oder Kontext nahelegt, dass bereits ein P-Konto besteht. Dann: Status und Freibetrag bestätigen lassen.
- Bei Jobcenter/Bescheid: Widerspruchsfrist, Rückforderung, Aufrechnung und Beratung klar nennen.
- Bei Gericht/Polizei: keine Rechtsberatung, Termin/Frist ernst nehmen, bei Unsicherheit Beratung/Anwalt erwähnen.
- Keine langen Textwände.
- Es gibt nur eine Erklärung, keinen getrennten Kurztext und Langtext.
- Die Erklärung darf bei wichtigen Briefen länger sein, aber nur mit kurzen Sätzen und klarer Struktur.
- Erkläre so viel wie nötig und so wenig wie möglich.
- Bei ernsten Briefen maximal 6 bis 8 kurze Zeilen nutzen. Bei einfachen Briefen reichen 3 bis 5 Zeilen.
- Keine Abschnitte mit langen Zwischenüberschriften wie "Das bedeutet es für Sie" oder "Ich kann Ihnen helfen".

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
  brief_schwierigkeit: info.brief_schwierigkeit,
  was_will_der_absender: info.was_will_der_absender,
  muss_handeln: info.muss_handeln,
  geld_betroffen: info.geld_betroffen,
  risiko_kurz: info.risiko_kurz,
  erster_sicherer_schritt: info.erster_sicherer_schritt,
  daten_unsicher: info.daten_unsicher,
  folge_wenn_nichts: info.folge_wenn_nichts,
  wichtigste_punkte: info.wichtigste_punkte,
  was_ist_zu_tun: info.was_ist_zu_tun,
  naechster_schritt: info.naechster_schritt,
  unsicherheiten: info.unsicherheiten
}, null, 2)}

AKTUELLE ERKLÄRUNG:
${translated.kurz}

Antworte nur mit gültigem JSON:
{
  "kurz": "",
  "first_step": "",
  "next_steps": [],
  "suggested_actions": ["kurze Aktion als Text", "zweite Aktion als Text"],
  "whatsapp_summary": ""
}
`
    }
  ]);

  let parsed;

  try {
    parsed = extractJson(raw);
  } catch (error) {
    console.error("Qualitätsmodus konnte nicht als JSON gelesen werden:", error.message || error);
    parsed = {};
  }

  const kurz = clampBalancedExplanation(parsed.kurz || translated.kurz, langCode, mode);
  const details = "";
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

  const shortDe = cleanText(renderBalancedExplanationGerman(safeInfoForShort));
  const detailTemplateDe = "";

  let translated = await translateFinalTextsIfNeeded(shortDe, detailTemplateDe, langCode);
  let helper = await buildHelperCardsFromInfo(info, langCode, sourceMode);

  const qualityResult = await improveQualityTextsIfNeeded(info, translated, helper, langCode, sourceMode);
  translated = qualityResult.translated;
  helper = qualityResult.helper;

  const qualityMode = buildQualityModeType(info);

  if (isBankPkontoLetter(info)) {
    translated.kurz = renderBankPkontoExplanation(info, langCode, sourceMode);
    helper = {
      ...helper,
      quality_mode: true,
      quality_type: "bank_pfaendung_pkonto",
      suggested_actions: buildBankPkontoActions(langCode)
    };
  }

  translated.kurz = postProcessFinalExplanation(translated.kurz, langCode, qualityMode);

  return {
    ok: true,
    quality_ok: true,
    hinweis: "",
    kurz: translated.kurz,
    details: "",
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
      must_react: info.muss_handeln === "ja" ? "yes" : (info.muss_handeln === "nein" ? "no" : inferMustReact(info)),
      money_affected: info.geld_betroffen === "ja" ? "yes" : (info.geld_betroffen === "nein" ? "no" : inferMoneyAffected(info)),
      brief_schwierigkeit: info.brief_schwierigkeit,
      quality_type: buildQualityModeType(info),
      bank_pkonto: isBankPkontoLetter(info),
      pkonto_already_possible: isLikelyAlreadyPkonto(info),
      was_will_der_absender: info.was_will_der_absender,
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

    if (bild.imageData.length > 23000000) {
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




function postProcessQuestionAnswer(answer = "", meta = {}) {
  let out = cleanText(answer || "");

  const safeReplacement = "Bitte senden Sie mir eine aktuelle Forderungsaufstellung zu.";
  out = out.replace(new RegExp("Ich bestätige die offene Forderung[^.?!]*(?:[.?!]|$)", "gi"), safeReplacement);
  out = out.replace(new RegExp("Ich bestätige die Forderung[^.?!]*(?:[.?!]|$)", "gi"), safeReplacement);
  out = out.replace(new RegExp("ich bestätige[^.?!]*Forderung[^.?!]*(?:[.?!]|$)", "gi"), safeReplacement);

  out = out.replace(new RegExp("monatlich\\s+monatlich", "gi"), "monatlich");
  out = out.replace(new RegExp("Aktenzeichen\\/Nummer\\s+Aktenzeichen:", "gi"), "Aktenzeichen:");
  out = out.replace(new RegExp("Aktenzeichen\\/zur Nummer\\s+Aktenzeichen:", "gi"), "Aktenzeichen:");

  const detectedName = getDetectedPersonNameUniversal(meta);
  if (detectedName) out = out.replace(/\[Name\]/g, detectedName);

  return cleanText(out);
}
function sanitizeFinalAnswerText(answer = "", meta = {}) {
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

  out = out
    .replace(/Sonst ist Ihr gesamtes Geld weg\.?/gi, "Ohne P-Konto ist dein Guthaben deutlich schlechter geschützt.")
    .replace(/Sonst ist dein gesamtes Geld weg\.?/gi, "Ohne P-Konto ist dein Guthaben deutlich schlechter geschützt.")
    .replace(/Sie verlieren es\.?/gi, "Guthaben über dem geschützten Betrag kann abgeführt werden.")
    .replace(/du verlierst es\.?/gi, "Guthaben über dem geschützten Betrag kann abgeführt werden.");

  if (meta && meta.bank_pkonto && meta.pkonto_already_possible) {
    out = out
      .replace(/Bitte informieren Sie mich, wie ich mein Konto schnellstmöglich in ein Pfändungsschutzkonto \(P-Konto\) umwandeln kann\./gi, "Bitte bestätigen Sie mir schriftlich, ob mein Konto aktuell als Pfändungsschutzkonto (P-Konto) geführt wird und welcher Freibetrag geschützt ist.")
      .replace(/wie ich mein Konto schnellstmöglich als Pfändungsschutzkonto \(P-Konto\) führen lassen kann/gi, "ob mein Konto aktuell als Pfändungsschutzkonto (P-Konto) geführt wird und welcher Freibetrag geschützt ist")
      .replace(/P-Konto beantragen/gi, "P-Konto-Status prüfen");
  }

  return cleanText(out);
}


function normalizeQuestionText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?؟،,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

function isPoliteSmallTalkQuestion(text) {
  const clean = normalizeQuestionText(text);

  const politeTexts = new Set([
    "danke", "dankeschön", "danke schön", "vielen dank", "ok", "okay", "alles klar", "verstanden", "habe verstanden", "super", "top", "ja", "passt", "gut", "perfekt",
    "teşekkürler", "teşekkür ederim", "sağ ol", "sagol", "tamam", "okey", "oldu", "evet", "iyi", "süper",
    "благодаря", "мерси", "добре", "ок", "да", "супер",
    "mulțumesc", "mersi", "bine", "da", "ok",
    "thanks", "thank you", "ok", "okay", "yes", "great", "perfect",
    "شكرا", "شكرًا", "تمام", "حسنا", "نعم"
  ]);

  return politeTexts.has(clean);
}

function politeSmallTalkReply(lang) {
  const code = getLanguageMeta(lang).code;
  const replies = {
    de: "Gerne. Schreib deine nächste Frage.",
    tr: "Rica ederim. Sonraki sorunu yazabilirsin.",
    bg: "Моля. Напиши следващия си въпрос.",
    ar: "على الرحب والسعة. اكتب سؤالك التالي.",
    ro: "Cu plăcere. Scrie următoarea întrebare.",
    en: "You’re welcome. Write your next question."
  };
  return replies[code] || replies.de;
}

function buildQuestionFallbackAnswer(frageMode, meta, lang) {
  const code = getLanguageMeta(lang).code;
  const sender = normalizeString(meta.absender || meta.absender_kurz || "");
  const amount = normalizeString(meta.betrag || "");
  const deadline = normalizeString(meta.frist || meta.termin || "");

  if (code === "tr") {
    if (frageMode === "reply") {
      return "Şu anda hazır cevap metni oluşturulamadı. Lütfen tekrar dene.\n\nİpucu: Resmi bir kuruma yazacaksan metin Almanca hazırlanmalıdır.";
    }
    return [
      sender ? `Bu yazı ${sender} tarafından gönderilmiş.` : "Bu yazı önemli olabilir.",
      amount ? `Tutar: ${amount}.` : "Tutar varsa lütfen mektuptan kontrol et.",
      deadline ? `Süre/termin: ${deadline}.` : "Süre varsa lütfen mektuptan kontrol et.",
      "İlk adım: bilgileri mektuptan kontrol et ve emin değilsen ilgili kuruma yaz."
    ].join("\n");
  }

  if (code === "bg") {
    if (frageMode === "reply") {
      return "В момента готовият текст за отговор не можа да бъде създаден. Моля, опитай отново.\n\nСъвет: Ако пишеш до германска институция, текстът трябва да бъде на немски.";
    }
    return [
      sender ? `Писмото е изпратено от ${sender}.` : "Това писмо може да е важно.",
      amount ? `Сума: ${amount}.` : "Ако има сума, провери я в писмото.",
      deadline ? `Срок/термин: ${deadline}.` : "Ако има срок, провери го в писмото.",
      "Първа стъпка: провери данните в писмото и ако не си сигурен, пиши до съответната институция."
    ].join("\n");
  }

  if (code === "ro") {
    return [
      sender ? `Scrisoarea este de la ${sender}.` : "Această scrisoare poate fi importantă.",
      amount ? `Sumă: ${amount}.` : "Dacă există o sumă, verific-o în scrisoare.",
      deadline ? `Termen/programare: ${deadline}.` : "Dacă există un termen, verifică-l în scrisoare.",
      "Primul pas: verifică datele din scrisoare și, dacă nu ești sigur, scrie instituției responsabile."
    ].join("\n");
  }

  if (code === "ar") {
    return [
      sender ? `هذه الرسالة من ${sender}.` : "قد تكون هذه الرسالة مهمة.",
      amount ? `المبلغ: ${amount}.` : "إذا كان هناك مبلغ، يرجى التحقق منه في الرسالة.",
      deadline ? `الموعد/المهلة: ${deadline}.` : "إذا كانت هناك مهلة، يرجى التحقق منها في الرسالة.",
      "الخطوة الأولى: تحقق من البيانات في الرسالة، وإذا كنت غير متأكد فاكتب إلى الجهة المسؤولة."
    ].join("\n");
  }

  if (code === "en") {
    return [
      sender ? `This letter is from ${sender}.` : "This letter may be important.",
      amount ? `Amount: ${amount}.` : "If there is an amount, check it in the letter.",
      deadline ? `Deadline/appointment: ${deadline}.` : "If there is a deadline, check it in the letter.",
      "First step: check the details in the letter and, if you are unsure, write to the responsible office."
    ].join("\n");
  }

  if (frageMode === "reply") {
    return "Die Antwortvorlage konnte gerade nicht erstellt werden. Bitte versuche es nochmal.\n\nWichtig: Wenn es um eine deutsche Behörde, ein Gericht, Inkasso oder eine Krankenkasse geht, sollte die fertige Antwort auf Deutsch geschrieben werden.";
  }

  return [
    sender ? `Der Brief ist von ${sender}.` : "Dieser Brief kann wichtig sein.",
    amount ? `Betrag: ${amount}.` : "Wenn ein Betrag genannt wird, prüfe ihn im Brief.",
    deadline ? `Frist/Termin: ${deadline}.` : "Wenn eine Frist genannt wird, prüfe sie im Brief.",
    "Erster Schritt: Prüfe die Daten im Brief und schreibe bei Unsicherheit an die zuständige Stelle."
  ].join("\n");
}


function isOfficialReplyMode(frageMode, frage) {
  const mode = String(frageMode || "").toLowerCase();
  const q = normalizeQuestionText(frage);
  if (mode === "reply") return true;
  return hasAny(q, [
    "schreib", "antwort", "e-mail", "email", "brief", "vorlage", "pdf", "whatsapp",
    "cevap", "mail", "yaz", "писмо", "отговор", "scrie", "răspuns", "اكتب", "رد"
  ]);
}

function looksLikeHumanName(value) {
  const v = normalizeString(value).replace(/[^\p{L}\s.'-]/gu, "").trim();
  if (!v || v.length < 4 || v.length > 70) return false;
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  if (hasAny(v.toLowerCase(), ["antwort", "email", "brief", "ratenzahlung", "zahlung", "danke", "ok", "hallo", "bitte"])) return false;
  return parts.every((part) => part.length >= 2);
}

function containsUserProvidedName(frage, historyText = "") {
  const text = String(frage + "\n" + historyText).toLowerCase();
  if (/\b(ich heiße|mein name ist|name ist|benim adım|adım|казвам се|името ми е|mă numesc|numele meu este|my name is|اسمي)\b/i.test(text)) return true;

  // Wenn Hilfe24 direkt nach dem Namen gefragt hat, reicht eine reine Namensantwort.
  if (hasAny(text, ["vollständiger name", "name für die unterschrift", "welchen namen", "imza için", "пълното име", "numele complet", "full name", "الاسم الكامل"])) {
    return looksLikeHumanName(frage);
  }

  return false;
}

function extractNameFromReplyFlow(frage, meta = {}, historyText = "") {
  if (meta && meta.person_sicher === true && normalizeString(meta.person)) return normalizeString(meta.person);
  if (containsUserProvidedName(frage, historyText) && looksLikeHumanName(frage)) return normalizeString(frage).replace(/[^\p{L}\s.'-]/gu, "").trim();
  return "[Name]";
}

function shouldAskForMissingOfficialData(meta, frageMode, frage, historyText = "") {
  if (!isOfficialReplyMode(frageMode, frage)) return false;

  const hasSafeName = Boolean(meta && meta.person_sicher === true && normalizeString(meta.person));
  if (!hasSafeName && !containsUserProvidedName(frage, historyText)) {
    return { needed: true, reason: "name" };
  }

  return { needed: false, reason: "" };
}

function buildMissingOfficialDataQuestion(reason, meta, lang) {
  const code = getLanguageMeta(lang).code;
  const replies = {
    de: {
      name: "Ich kann den Text schreiben. Mir fehlt nur dein vollständiger Name für die Unterschrift.\n\nWie soll ich den Namen eintragen?"
    },
    tr: {
      name: "Metni yazabilirim. Sadece imza için tam adın eksik.\n\nHangi adı yazayım?"
    },
    bg: {
      name: "Мога да напиша текста. Липсва само пълното име за подпис.\n\nКакво име да впиша?"
    },
    ro: {
      name: "Pot scrie textul. Îmi lipsește doar numele complet pentru semnătură.\n\nCe nume să trec?"
    },
    ar: {
      name: "أستطيع كتابة النص. ينقصني فقط الاسم الكامل للتوقيع.\n\nما الاسم الذي أكتبه؟"
    },
    en: {
      name: "I can write the text. I only need your full name for the signature.\n\nWhich name should I use?"
    }
  };
  const dict = replies[code] || replies.de;
  return dict[reason] || dict.name;
}

function explainOnlineBankingSimple(lang) {
  const code = getLanguageMeta(lang).code;
  const texts = {
    de: "Online-Banking-Postfach = du loggst dich bei deiner Bank ein und schreibst dort eine sichere Nachricht an die Bank.",
    tr: "Online-Banking mesaj kutusu = bankanın uygulamasına veya sitesine girip bankaya güvenli mesaj yazman demek.",
    bg: "Online-Banking поща = влизаш в банковото приложение или сайта и пишеш сигурно съобщение до банката.",
    ro: "Mesageria din online banking = intri în aplicația sau site-ul băncii și trimiți un mesaj sigur către bancă.",
    ar: "صندوق رسائل البنك الإلكتروني = تدخل إلى تطبيق أو موقع البنك وتكتب رسالة آمنة للبنك.",
    en: "Online banking inbox = you log in to your bank app or website and send a secure message to the bank."
  };
  return texts[code] || texts.de;
}

function shortenOfficialTemplateAnswer(answer, frageMode, lang) {
  let out = cleanText(answer).replace(/\n{3,}/g, "\n\n").trim();
  if (String(frageMode || "").toLowerCase() !== "reply") return out;

  // Entferne typische lange Nachträge nach fertigen Vorlagen.
  out = out.replace(/\n\n(?:Was du jetzt tun musst|Du kannst den Text direkt kopieren|Achte darauf|Ich kann dir auch helfen|Wenn du möchtest)[\s\S]*$/i, "").trim();
  out = out.replace(/\n\n(?:Sende den Text ab|Prüfe den Freibetrag)[\s\S]*$/i, "").trim();

  // Entferne zu lange Einleitungen vor Empfänger/Betreff.
  const idxEmp = out.search(/(^|\n)Empfänger:/i);
  const idxBetreff = out.search(/(^|\n)Betreff:/i);
  const idx = idxEmp >= 0 ? idxEmp : idxBetreff;
  if (idx > 160) {
    const prefix = lang === "tr" ? "Kısa metin:" : lang === "bg" ? "Кратък текст:" : lang === "ro" ? "Text scurt:" : lang === "ar" ? "نص قصير:" : lang === "en" ? "Short text:" : "Hier ist ein kurzer Text:";
    out = prefix + "\n\n" + out.slice(idx).trim();
  }

  return out;
}

function isDetailQuestionV865(frage) {
  const q = normalizeQuestionText(frage);
  return hasAny(q, [
    "welche behandlung", "was wurde gemacht", "wofür ist", "wofür ist diese rechnung", "positionen", "leistungsposition", "goz", "bema", "zahnbehandlung",
    "was ändert sich", "was wurde geändert", "arbeitsvertrag", "änderungsvereinbarung",
    "was wirft", "vorwurf", "anklageschrift", "tatvorwurf", "wer ist zeuge",
    "berechnung", "steuer", "säumnis", "beitragsnummer", "beitragskonto"
  ]);
}

function cleanUselessCheckYourselfPhrasesV865(text) {
  let out = cleanText(text);
  out = out.replace(/(?:Schau|Sehen|Prüfe) Sie (?:bitte )?(?:selbst )?(?:auf|in) (?:der|dem|den) (?:detaillierten )?(?:Rechnung|Brief|Schreiben) nach\.?/gi,
    "Lade bitte die Seite oder den Ausschnitt hoch, auf dem die einzelnen Details stehen. Dann lese ich sie dir genau heraus.");
  out = out.replace(/Du musst .* selbst .* prüfen\.?/gi,
    "Wenn die Stelle auf dem Foto nicht lesbar ist, lade bitte den passenden Ausschnitt hoch. Dann prüfe ich es für dich.");
  return cleanText(out);
}

function clampChatAnswerV864(answer, frageMode, frage, lang) {
  let out = cleanText(answer)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\*\s{2,}/g, "- ")
    .trim();

  out = shortenOfficialTemplateAnswer(out, frageMode, lang);
  out = cleanUselessCheckYourselfPhrasesV865(out);

  const mode = String(frageMode || "free").toLowerCase();
  const q = normalizeQuestionText(frage);

  if (mode === "reply") {
    return out;
  }

  const isDetail = isDetailQuestionV865(frage);
  const maxChars = isDetail ? 1250 : (mode === "next_steps" ? 520 : mode === "deadline" ? 480 : mode === "consequence" ? 620 : 700);
  const lines = out.split("\n").map(x => x.trim()).filter(Boolean);

  let maxLines = 6;
  if (mode === "next_steps") maxLines = 4;
  if (mode === "deadline") maxLines = 4;
  if (mode === "consequence") maxLines = 5;
  if (hasAny(q, ["was soll ich tun", "was muss ich tun", "ne yap", "what should i do"])) maxLines = 4;
  if (isDetail) maxLines = 10;

  if (lines.length > maxLines) {
    out = lines.slice(0, maxLines).join("\n");
  }

  if (out.length > maxChars) {
    out = out.slice(0, maxChars).trim();
    const lastEnd = Math.max(out.lastIndexOf("."), out.lastIndexOf("!"), out.lastIndexOf("?"), out.lastIndexOf("؟"));
    if (lastEnd > 180) out = out.slice(0, lastEnd + 1).trim();
  }

  return cleanText(out);
}



function chatContextText(meta = {}, briefText = "", kurz = "", details = "", frage = "", historyText = "") {
  return [
    meta.briefart,
    meta.absender,
    meta.betrag,
    meta.frist,
    meta.termin,
    Array.isArray(meta.unterlagen) ? meta.unterlagen.join(" ") : "",
    Array.isArray(meta.referenzen) ? meta.referenzen.join(" ") : "",
    Array.isArray(meta.referenzen_erkannt_roh) ? meta.referenzen_erkannt_roh.join(" ") : "",
    Array.isArray(meta.passende_aktionen) ? meta.passende_aktionen.join(" ") : "",
    meta.risiko_kurz,
    meta.naechster_schritt,
    meta.was_will_der_absender,
    briefText,
    kurz,
    details,
    frage,
    historyText
  ].join(" ").toLowerCase();
}

function getPrimaryReference(meta = {}, fallback = "Nummer/Aktenzeichen bitte aus dem Brief übernehmen") {
  if (Array.isArray(meta.referenzen) && meta.referenzen.length) return meta.referenzen[0];
  if (Array.isArray(meta.referenzen_erkannt_roh) && meta.referenzen_erkannt_roh.length) return meta.referenzen_erkannt_roh[0];
  return fallback;
}

function detectUniversalDocumentDomain(context = "") {
  const text = String(context || "").toLowerCase();

  if (hasAny(text, ["gericht", "amtsgericht", "landgericht", "staatsanwaltschaft", "polizei", "straf", "anklage", "ladung", "zeuge", "beschuldig", "angeklagt", "geldauflage", "strafbefehl"])) return "justiz";
  if (hasAny(text, ["jobcenter", "bürgergeld", "sozialamt", "wohngeld", "familienkasse", "kindergeld", "rente", "rentenversicherung", "jugendamt", "ausländerbehörde", "stadt", "gemeinde", "kreis", "behörde", "amt"])) return "behoerde";
  if (hasAny(text, ["finanzamt", "steuer", "steuernummer", "säumnis", "einkommensteuer", "umsatzsteuer"])) return "steuer";
  if (hasAny(text, ["krankenkasse", "pflegekasse", "aok", "barmer", "tk", "dak", "md", "pflegegrad", "krankengeld", "hilfsmittel", "arztbrief", "befund", "krankenhaus", "apotheke"])) return "gesundheit";
  if (hasAny(text, ["bank", "konto", "p-konto", "pfändungsschutz", "kontopfändung", "freibetrag", "kredit", "dispo", "rücklastschrift"])) return "bank";
  if (hasAny(text, ["inkasso", "forderung", "mahnung", "rechnung", "zahlungserinnerung", "vollstreckung", "gerichtsvollzieher", "ratenzahlung", "schuld", "gläubiger"])) return "zahlung";
  if (hasAny(text, ["rundfunk", "beitragsservice", "beitragsnummer", "ard zdf", "deutschlandradio"])) return "beitrag";
  if (hasAny(text, ["miete", "vermieter", "wohnung", "nebenkosten", "kaution", "räumung", "mieterhöhung", "betriebskosten"])) return "wohnung";
  if (hasAny(text, ["arbeitgeber", "arbeitsvertrag", "änderungsvereinbarung", "kündigung", "abmahnung", "lohn", "gehalt", "arbeitszeit", "urlaub", "krankmeldung"])) return "arbeit";
  if (hasAny(text, ["versicherung", "haftpflicht", "kfz", "hausrat", "rechtsschutz", "schaden", "police", "versicherungsnummer"])) return "versicherung";
  if (hasAny(text, ["schule", "kita", "eltern", "kind", "klassenfahrt", "fehlzeiten", "unterhalt"])) return "familie_schule";
  if (hasAny(text, ["bußgeld", "blitzer", "anhörungsbogen", "fahrverbot", "punkte", "kennzeichen", "verkehr", "zulassung", "tüv"])) return "verkehr";
  if (hasAny(text, ["vertrag", "kündigung", "widerruf", "abo", "strom", "gas", "internet", "handyvertrag", "fitness", "anbieter", "preiserhöhung"])) return "vertrag";
  if (hasAny(text, ["zahnarzt", "zahnärzt", "dzr", "goz", "bema", "labor", "materialkosten", "behandlung", "rechnungsnummer"])) return "rechnung_detail";
  if (hasAny(text, ["phishing", "fake", "betrug", "gewinnspiel", "paket-sms", "link klicken", "daten eingeben"])) return "betrug";

  return "allgemein";
}

function detectUniversalChatIntent(frage = "", frageMode = "free") {
  const mode = String(frageMode || "free").toLowerCase();
  const q = normalizeQuestionText(frage);

  if (isPoliteSmallTalkQuestion(frage)) return "smalltalk";
  if (mode === "reply" || hasAny(q, ["schreib", "antwort", "e-mail", "email", "brief", "vorlage", "pdf", "whatsapp", "text schreiben", "cevap", "yaz", "писмо", "отговор", "scrie", "răspuns", "اكتب", "رد"])) return "reply";
  if (hasAny(q, ["kann nicht zahlen", "nicht bezahlen", "nicht auf einmal", "kein geld", "ratenzahlung", "rate", "stundung", "zahlungsaufschub", "ödeyemem", "taksit", "не мога да платя", "nu pot plăti", "cannot pay", "installment", "تقسيط"])) return "cannot_pay";
  if (hasAny(q, ["schon geschickt", "bereits geschickt", "nachweis geschickt", "bescheid geschickt", "befreit", "befreiung", "nachweis wurde", "gönderdim", "изпратено", "trimis", "already sent", "exemption", "أرسلت", "إعفاء"])) return "proof_sent";
  if (mode === "next_steps" || hasAny(q, ["was soll ich tun", "was muss ich tun", "was jetzt", "nächster schritt", "wie weiter", "ne yap", "какво да направя", "ce fac", "what should i do", "ماذا أفعل"])) return "next_steps";
  if (mode === "deadline" || hasAny(q, ["bis wann", "frist", "termin", "deadline", "son tarih", "срок", "termen", "مهلة"])) return "deadline";
  if (mode === "consequence" || hasAny(q, ["wenn ich nichts", "passiert wenn", "folge", "ignorieren", "nichts mache", "ne olur", "какво ще стане", "ce se întâmplă", "what happens", "ماذا يحدث"])) return "consequence";
  if (hasAny(q, ["unterlagen", "anlagen", "anhängen", "mitschicken", "welche dokumente", "was brauche ich", "documents", "belge", "документи", "atașez", "مستندات"])) return "attachments";
  if (hasAny(q, ["telefon", "anrufen", "am telefon", "was soll ich sagen", "rufen", "call", "phone", "telefon aç", "обадя", "sun", "اتصال"])) return "phone_script";
  if (hasAny(q, ["noch kürzer", "kürzer", "kurz", "einfacher", "einfach erklären", "verstehe nicht", "shorter", "simpler", "daha kısa", "по-кратко", "mai scurt", "أقصر"])) return "simplify";
  if (hasAny(q, ["welche behandlung", "was wurde gemacht", "wofür", "positionen", "leistungsposition", "goz", "bema", "rechnungsposition", "was ändert sich", "was wurde geändert", "vorwurf", "wer ist zeuge", "berechnung", "details", "hangi", "какво", "ce", "what exactly"])) return "detail";
  if (hasAny(q, ["muss ich reagieren", "muss ich was machen", "muss ich überhaupt", "nichts tun", "brauche ich reagieren", "do i have to", "zorunda", "трябва ли", "trebuie", "هل يجب"])) return "must_react";
  if (hasAny(q, ["widerspruch", "einspruch", "ablehnung", "bescheid falsch", "nicht einverstanden", "objection", "contest", "itiraz", "възражение", "contestație", "اعتراض"])) return "objection";
  if (hasAny(q, ["erstattung", "zurückbekommen", "krankenkasse zahlt", "übernimmt", "refund", "reimbursement", "geri ödeme", "възстановяване", "rambursare", "استرداد"])) return "reimbursement";
  if (hasAny(q, ["forderung prüfen", "stimmt die forderung", "ist das richtig", "schon bezahlt", "zahlungsnachweis", "check claim", "borç", "дълг", "creanță"])) return "check_claim";
  if (hasAny(q, ["verstanden", "hast du verstanden", "ok verstanden", "understood", "anladın", "разбра", "ai înțeles", "فهمت"])) return "understood";

  return "free";
}

function buildUniversalNextSteps(meta = {}, domain = "allgemein") {
  const steps = [];
  const amount = normalizeString(meta.betrag || "");
  const deadline = normalizeString(meta.frist || meta.termin || "");
  const ref = getPrimaryReference(meta, "");

  if (amount) steps.push(`Betrag prüfen: ${amount}.`);
  if (deadline) steps.push(`Frist/Termin prüfen: ${deadline}.`);
  if (ref) steps.push(`Nummer/Aktenzeichen bereithalten: ${ref}.`);

  if (domain === "justiz") steps.push("Nichts Unüberlegtes schreiben und bei Unsicherheit rechtliche Hilfe holen.");
  else if (domain === "gesundheit") steps.push("Bei medizinischen Fragen Arzt, Apotheke oder Krankenkasse kontaktieren.");
  else if (domain === "betrug") steps.push("Nicht klicken, nichts zahlen und keine Daten senden, bis der Absender geprüft ist.");
  else if (domain === "bank") steps.push("Bank schriftlich kontaktieren und Status/Freigabe klären.");
  else if (domain === "zahlung" || domain === "steuer" || domain === "beitrag") steps.push("Wenn du nicht zahlen kannst: schriftlich Ratenzahlung, Stundung oder Klärung beantragen.");
  else steps.push("Wenn etwas unklar ist: schriftlich bei der zuständigen Stelle nachfragen.");

  return dedupe(steps).slice(0, 4);
}

function buildUniversalCannotPay(meta = {}, domain = "allgemein") {
  const amount = normalizeString(meta.betrag || "den Betrag");
  const ref = getPrimaryReference(meta);
  const extra = hasAny(String(meta.risiko_kurz || meta.briefart || "").toLowerCase(), ["vollstreck", "pfänd", "mahnung"]) || ["steuer", "beitrag", "zahlung", "bank"].includes(domain)
    ? "4. Um Stopp weiterer Maßnahmen bis zur Antwort bitten."
    : "4. Um schriftliche Bestätigung bitten.";

  return cleanText(`Dann nicht ignorieren, sondern schriftlich Zahlungsaufschub, Ratenzahlung oder Stundung anfragen.

1. Nummer/Aktenzeichen nennen: ${ref}.
2. Betrag nennen: ${amount}.
3. Eine realistische monatliche Rate vorschlagen.
${extra}

Welche monatliche Rate wäre möglich?`);
}

function buildUniversalProofSent(meta = {}, domain = "allgemein") {
  const ref = getPrimaryReference(meta);
  return cleanText(`Dann den Nachweis nochmal senden und schriftlich Prüfung verlangen.

1. Nummer/Aktenzeichen nennen: ${ref}.
2. Nachweis erneut anhängen.
3. Schreiben: „Der Nachweis wurde bereits eingereicht, ich füge ihn vorsorglich erneut bei.“
4. Um Stopp weiterer Maßnahmen bis zur Prüfung bitten.

Soll ich dir eine kurze Nachricht dafür schreiben?`);
}

function buildUniversalAttachments(meta = {}, domain = "allgemein") {
  const common = ["Nummer/Aktenzeichen oder Kundennummer", "das Schreiben selbst", "dein Name und Kontaktdaten"];
  const domainItems = {
    steuer: ["Steuernummer", "Mahnung/Bescheid", "kurze Begründung, warum Zahlung nicht sofort möglich ist"],
    beitrag: ["Beitragsnummer", "Befreiungsnachweis/Bescheid", "Nachweis erneut als Anlage"],
    behoerde: ["Bescheid oder Nachweis", "Kundennummer/BG-Nummer", "fehlende Unterlagen"],
    gesundheit: ["Rechnung", "Verordnung/Arztbericht", "Versichertennummer"],
    zahlung: ["Forderungsschreiben", "Zahlungsnachweise, falls schon bezahlt", "Vertrags-/Rechnungsunterlagen, falls vorhanden"],
    bank: ["Bank-Schreiben", "Nachweis/Bescheinigung, falls vorhanden", "Kontodaten nur soweit nötig"],
    justiz: ["Gerichtsschreiben", "Aktenzeichen", "Nachweise/Beweise nur nach Prüfung oder Beratung"],
    rechnung_detail: ["Rechnung", "Seite mit Leistungspositionen", "Versicherungs-/Krankenkassendaten, falls Erstattung gefragt ist"]
  };
  const items = domainItems[domain] || common;
  return "Wahrscheinlich brauchst du:\n" + dedupe(items).slice(0, 5).map((x) => `- ${x}`).join("\n");
}

function buildUniversalPhoneScript(meta = {}, domain = "allgemein") {
  const ref = getPrimaryReference(meta);
  const amount = normalizeString(meta.betrag || "");
  return cleanText(`Sag am Telefon kurz:

Guten Tag, mein Name ist [Name].
Ich rufe wegen Ihres Schreibens an.
Meine Nummer / mein Aktenzeichen ist: ${ref}.
${amount ? "Es geht um den Betrag " + amount + "." : ""}
Ich möchte klären, was ich jetzt tun muss.
Welche Unterlagen oder nächsten Schritte sind nötig?`);
}

function buildUniversalDetailRequest(meta = {}, domain = "allgemein") {
  if (domain === "rechnung_detail" || domain === "gesundheit") {
    return cleanText(`Ich kann die genaue Leistung auf dem aktuellen Foto nicht sicher erkennen.

Bitte lade die Seite mit den einzelnen Positionen hoch.
Wichtig sind:
1. Leistungsbeschreibung
2. Positionsnummern, z. B. GOZ/BEMA oder Rechnungsposition
3. Datum / Behandlungstag
4. Einzelbeträge

Dann erkläre ich dir genau, wofür die Rechnung ist.`);
  }

  if (domain === "arbeit") {
    return "Bitte lade die Stelle hoch, wo die Änderung steht. Wichtig sind: Was ändert sich, ab wann gilt es, muss unterschrieben werden und ob es befristet ist.";
  }

  if (domain === "justiz") {
    return "Bitte lade die Seite mit Vorwurf, Frist, Termin oder Rechtsbehelf hoch. Dann erkläre ich dir genau, was gemeint ist, ohne etwas zu erfinden.";
  }

  return "Ich erkenne diese Detailinformation noch nicht sicher. Lade bitte die Seite oder den Ausschnitt hoch, auf dem die Details stehen. Dann lese ich es dir genau heraus.";
}

function buildUniversalConsequence(meta = {}, domain = "allgemein") {
  const risk = normalizeString(meta.risiko_kurz || meta.folge_wenn_nichts || "");
  if (risk) return `Mögliche Folge: ${risk}\n\nNächster sicherer Schritt: schriftlich klären und Frist/Betrag prüfen.`;
  if (domain === "justiz") return "Wenn du nicht reagierst, können Fristen verloren gehen oder ein Verfahren weiterlaufen. Nicht ignorieren und bei Unsicherheit rechtliche Hilfe holen.";
  if (["zahlung", "steuer", "beitrag", "bank"].includes(domain)) return "Wenn du nichts machst, können weitere Kosten, Mahnung oder Vollstreckung folgen. Deshalb schriftlich klären oder Zahlung/Ratenzahlung prüfen.";
  if (domain === "behoerde") return "Wenn du nichts machst, können Leistungen, Fristen oder Ansprüche betroffen sein. Prüfe die Frist und reagiere schriftlich.";
  return "Wenn du nichts machst, kann je nach Brief ein Nachteil entstehen. Prüfe Frist, Geld, Termin und ob eine Antwort verlangt wird.";
}

function buildUniversalMustReact(meta = {}, domain = "allgemein") {
  const must = String(meta.must_react || meta.muss_handeln || "").toLowerCase();
  const hasCritical = Boolean(meta.frist || meta.termin || meta.betrag || domain === "justiz" || domain === "bank");
  if (must === "no" || must === "nein") return "Wahrscheinlich musst du nicht direkt reagieren. Bewahre den Brief aber auf und prüfe, ob wirklich keine Frist oder Zahlung genannt ist.";
  if (hasCritical) return "Ja, wahrscheinlich solltest du reagieren. Prüfe Frist/Termin/Betrag und kläre den nächsten Schritt schriftlich.";
  return "Unklar. Ich sehe noch nicht sicher, ob du reagieren musst. Lade bei Bedarf die Rückseite oder den Teil mit Frist/Rechtsbehelf hoch.";
}

function buildUniversalObjection(meta = {}, domain = "allgemein") {
  if (domain === "justiz") return "Bei Gericht/Strafsache bitte keinen Widerspruchstext ohne Beratung schreiben. Frist prüfen, Unterlagen sammeln und möglichst Anwalt/Beratungsstelle kontaktieren.";
  return "Wenn du nicht einverstanden bist, prüfe zuerst Frist, Begründung und Aktenzeichen. Danach kann eine kurze fristwahrende Antwort sinnvoll sein. Soll ich dir dafür einen neutralen Text vorbereiten?";
}

function buildUniversalReimbursement(meta = {}, domain = "allgemein") {
  return "Erstattung kann möglich sein, aber ich darf sie nicht versprechen. Lade Rechnung/Leistungsübersicht hoch und frage bei Krankenkasse, Versicherung oder zuständiger Stelle schriftlich nach. Ich kann dir dafür eine kurze Anfrage schreiben.";
}

function buildUniversalCheckClaim(meta = {}, domain = "allgemein") {
  const amount = normalizeString(meta.betrag || "");
  return cleanText(`Zahle nicht blind, wenn etwas unklar ist.

Prüfe:
1. Wer fordert das Geld?
2. Wofür ist der Betrag${amount ? " " + amount : ""}?
3. Gibt es Aktenzeichen/Rechnungsnummer?
4. Wurde vielleicht schon bezahlt?

Wenn du willst, schreibe ich dir eine kurze Anfrage zur Forderungsprüfung.`);
}

function buildUniversalShorter(meta = {}, domain = "allgemein") {
  const steps = buildUniversalNextSteps(meta, domain).slice(0, 3);
  return "Kurz:\n" + steps.map((s) => `- ${s.replace(/\.$/, "")}`).join("\n");
}

function buildUniversalUnderstood(meta = {}, domain = "allgemein") {
  const amount = normalizeString(meta.betrag || "");
  const deadline = normalizeString(meta.frist || meta.termin || "");
  const parts = [];
  if (amount) parts.push(`Betrag: ${amount}.`);
  if (deadline) parts.push(`Frist/Termin: ${deadline}.`);
  const next = buildUniversalNextSteps(meta, domain)[0] || "Nicht ignorieren und schriftlich klären.";
  return cleanText(`Ja, verstanden.

${parts.join("\n")}
Nächster Schritt: ${next}`);
}

function buildUniversalNextStepsAnswer(meta = {}, domain = "allgemein") {
  return "Das sind die nächsten Schritte:\n" + buildUniversalNextSteps(meta, domain).slice(0, 4).map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function buildUniversalDeterministicChat({ frage, frageMode, meta, briefText, kurz, details, historyText, lang }) {
  const context = chatContextText(meta, briefText, kurz, details, frage, historyText);
  const domain = detectUniversalDocumentDomain(context);
  const intent = detectUniversalChatIntent(frage, frageMode);

  if (intent === "smalltalk") return politeSmallTalkReply(lang);
  if (intent === "understood") return buildUniversalUnderstood(meta, domain);
  if (intent === "simplify") return buildUniversalShorter(meta, domain);
  if (intent === "cannot_pay") return buildUniversalCannotPay(meta, domain);
  if (intent === "proof_sent") return buildUniversalProofSent(meta, domain);
  if (intent === "next_steps") return buildUniversalNextStepsAnswer(meta, domain);
  if (intent === "attachments") return buildUniversalAttachments(meta, domain);
  if (intent === "phone_script") return buildUniversalPhoneScript(meta, domain);
  if (intent === "detail") return buildUniversalDetailRequest(meta, domain);
  if (intent === "consequence") return buildUniversalConsequence(meta, domain);
  if (intent === "must_react") return buildUniversalMustReact(meta, domain);
  if (intent === "objection") return buildUniversalObjection(meta, domain);
  if (intent === "reimbursement") return buildUniversalReimbursement(meta, domain);
  if (intent === "check_claim") return buildUniversalCheckClaim(meta, domain);

  return "";
}



app.post("/api/daten-pruefen", async (req, res) => {
  try {
    const bilder = req.body.bilder || [];
    const lang = (req.body.lang || "de").toLowerCase();
    const langMeta = getLanguageMeta(lang);

    if (!Array.isArray(bilder) || bilder.length === 0) {
      return res.status(400).json({ ok: false, error: "Keine Bilder gesendet" });
    }

    if (bilder.length > 3) {
      return res.status(400).json({ ok: false, error: "Maximal 3 Bilder möglich." });
    }

    const parts = [
      {
        text: `
Du bist Hilfe24. Prüfe NUR die kritischen Daten aus den hochgeladenen Brief-Fotos.

Sprache für die Antwort: ${langMeta.label}

ZIEL:
Der Nutzer will Name, Aktenzeichen, Datum, Frist und Betrag genauer prüfen.
Du sollst nicht den ganzen Brief neu erklären.

WICHTIGE REGELN:
- Nichts erfinden.
- Wenn ein Wert klar lesbar ist: anzeigen.
- Wenn ein Wert wahrscheinlich ist, aber nicht 100% sicher: schreibe "vermutlich ... – bitte prüfen" in der Sprache des Nutzers.
- Wenn ein Wert nicht sicher lesbar ist: schreibe "nicht sicher erkannt" in der Sprache des Nutzers.
- Bei mehreren Personen: nach Rollen trennen, z. B. Empfänger, betroffene Person, Zeuge, Angeklagter/Beschuldigter, weitere genannte Personen.
- Aktenzeichen/Nummern exakt mit Punkten, Schrägstrichen und Bindestrichen übernehmen, wenn sicher lesbar.
- Wenn mehrere Aktenzeichen da sind, getrennt nennen.
- Antwort kurz und listenartig.

Prüfe diese Daten:
- Empfänger / Adressat
- betroffene Person
- weitere Personen und Rollen
- Absender
- Datum des Schreibens
- Aktenzeichen / Geschäftszeichen / Kundennummer / Rechnungsnummer
- Betrag / Forderung / Kosten
- Frist / Termin

Antworte als kurzer Text in ${langMeta.label}.
Keine Markdown-Tabelle.
Keine lange Erklärung.
`
      }
    ];

    let pageIndex = 1;
    for (const bild of bilder) {
      if (!bild || !bild.imageData || !bild.mimeType) continue;
      if (String(bild.imageData).length > 15000000) {
        return res.status(400).json({ ok: false, error: "Ein Bild ist zu groß." });
      }
      parts.push({ text: `\nFOTO ${pageIndex}: Ganzseite oder Nahaufnahme. Nutze Nahaufnahmen besonders für Name, Datum, Aktenzeichen, Betrag und Frist.\n` });
      parts.push({ inline_data: { mime_type: bild.mimeType, data: bild.imageData } });
      pageIndex++;
    }

    const raw = await callGemini(parts);
    const text = cleanText(raw)
      .replace(/```[a-z]*\n?/gi, "")
      .replace(/```/g, "")
      .trim();

    return res.json({ ok: true, text });
  } catch (error) {
    console.error("Fehler /api/daten-pruefen:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Fehler bei der Datenprüfung"
    });
  }
});

// V8.6.4: kurzer Universal-Chat mit fehlenden Daten und Audio-freundlichen Antworten
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
    const chatHistory = Array.isArray(req.body.chatHistory) ? req.body.chatHistory.slice(-10) : [];
    const chatHistoryText = chatHistory
      .map((entry) => {
        const role = entry && entry.role === "user" ? "Nutzer" : "Hilfe24";
        const text = cleanText(entry && entry.text ? entry.text : "").slice(0, 1200);
        return text ? `${role}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");

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

    if (isPoliteSmallTalkQuestion(frage)) {
      return res.json({
        ok: true,
        antwort: politeSmallTalkReply(lang)
      });
    }

    const deterministicShortcut = buildUniversalDeterministicChat({
      frage,
      frageMode,
      meta,
      briefText,
      kurz: erklaerungKurz,
      details: erklaerungDetails,
      historyText: chatHistoryText,
      lang
    });

    if (deterministicShortcut) {
      return res.json({
        ok: true,
        antwort: deterministicShortcut
      });
    }

    const missingOfficialData = shouldAskForMissingOfficialData(meta, frageMode, frage, chatHistoryText);
    if (missingOfficialData.needed) {
      return res.json({
        ok: true,
        antwort: buildMissingOfficialDataQuestion(missingOfficialData.reason, meta, lang)
      });
    }

    if (frageMode === "reply" && (meta.bank_pkonto || isBankPkontoLetter(meta, `${briefText} ${erklaerungKurz} ${erklaerungDetails} ${frage}`))) {
      const template = buildPkontoReplyTemplate(meta, lang, `${briefText} ${erklaerungKurz} ${erklaerungDetails} ${frage}`);
      const hint = explainOnlineBankingSimple(lang);
      return res.json({
        ok: true,
        antwort: cleanText(`${hint}

${template}`)
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

BISHERIGER CHAT ZU DIESEM BRIEF:
${chatHistoryText || "Noch kein vorheriger Chat."}

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
Beantworte die Frage konkret anhand des Schreibens, der Erklärung, der erkannten Daten, des bisherigen Chats und der Nutzerfrage.
Hilf nicht nur beim Verstehen, sondern auch beim nächsten praktischen Schritt.
Denke allgemein mit: Antwort schreiben, Antrag prüfen, Erstattung prüfen, Unterlagenliste, Frist prüfen, Beratung suchen, Ratenzahlung, Widerspruch, Termin verschieben oder Daten genauer prüfen.
Biete solche Hilfe nur passend und kurz an. Nicht überladen.

OBERSTE REGEL:
Der Nutzer braucht eine klare Alltagshilfe. Nicht labern. Nicht dramatisieren. Nicht wie ein langer KI-Aufsatz schreiben. Keine Einleitung wie „Okay“ oder „Hier ist deine Hilfe“. Direkt mit der Antwort starten.


UNIVERSAL-LOGIK V8.6.9:
Du darfst dich nicht auf einzelne Testbriefe fixieren.
Erkenne zuerst die Nutzerabsicht: Zahlungsproblem, Nachweis schon geschickt, Antwort schreiben, Unterlagen, Telefonat, Frist, Termin, Forderung prüfen, Widerspruch prüfen, Erstattung prüfen, einfacher erklären oder Detailfrage.
Dann nutze die Briefdaten nur als Kontext.
Wenn der Nutzer eine neue Information gibt, wiederhole nicht die komplette Brief-Erklärung.
Antworte dann direkt mit dem nächsten sicheren Schritt.

CHAT-REGEL V8.6:
Du antwortest wie in einem echten laufenden Chat zu genau diesem Brief.
Nutze den bisherigen Chat aktiv. Der Nutzer muss nicht alles wiederholen.
Wenn der Nutzer schreibt „und dann?“, „was ist damit?“, „noch eine Frage“, „kann ich das?“, beziehe dich auf den aktuellen Brief und die vorherigen Chatnachrichten.
Wiederhole nicht jedes Mal die komplette Brief-Erklärung.
Antworte freundlich, hilfsbereit und beruhigend, aber ohne zu labern.
Klinge wie ein guter Alltagshelfer: „Ich erkläre es dir einfach“, aber nur wenn es natürlich passt.
Gib nach einer Antwort höchstens einen kurzen Hilfe-Hinweis, z. B.:
- Ich kann dir auch eine kurze Antwort schreiben.
- Ich kann dir eine Unterlagenliste machen.
- Ich kann prüfen, ob ein Antrag, eine Erstattung oder Beratung sinnvoll sein könnte.
- Ich kann dir helfen, die nächsten Schritte zu sortieren.
Mache keine falschen Versprechen. Schreibe „könnte möglich sein“, „prüfen lassen“ oder „bei der zuständigen Stelle nachfragen“, wenn etwas unsicher ist.
Wenn der Nutzer nach Name, Aktenzeichen, Betrag, Datum oder Frist fragt und die Daten unsicher sind, sage, dass er „Daten genauer prüfen“ nutzen oder das Original prüfen soll.
Wenn der Nutzer eine Antwortvorlage verlangt, schreibe direkt den fertigen Text, aber nutze keine unsicheren Namen oder Aktenzeichen.

CHAT-REGEL V8.6.6 – PRAKTISCH, JE NACH FRAGE:
- Grundsatz: so kurz wie möglich, so ausführlich wie nötig.
- Smalltalk wie Hallo, Danke, Ok: 1 kurzer Satz.
- "Was soll ich tun?": maximal 3 klare Schritte.
- "Bis wann?": Frist/Termin + Bedeutung + nächster Schritt, maximal 4 kurze Zeilen.
- "Schreib mir eine Antwort/E-Mail/Brief": maximal 1 kurzer Satz davor, dann direkt fertiger Text. Kein langer Nachtrag.
- Detailfragen wie "Welche Zahnbehandlung war das?", "Wofür ist die Rechnung?", "Was wurde genau gemacht?", "Was ändert sich im Vertrag?", "Was ist der Vorwurf?": ausführlicher antworten, aber gegliedert. Lies aktiv aus dem Schreiben heraus.
- Wenn das Detail nicht sicher erkennbar ist: nicht "prüfe selbst" schreiben. Sage genau, welche Seite oder welchen Ausschnitt der Nutzer hochladen soll.
- Schreibe gut vorlesbar: kurze Sätze, keine Markdown-Sterne, keine unnötigen Sonderzeichen.

BRIEFARTEN V8.6.6 FEIN SORTIEREN:
- Stadt/Behörde Mahnung ≠ privates Inkasso.
- Rundfunkbeitrag/Beitragsservice ≠ normales Inkasso.
- Staatsanwaltschaft/Anklageschrift ≠ Inkasso/Forderung.
- Finanzamt/Steuerforderung hat eigene Logik: Steuerjahr, Betrag, Fälligkeit, Einspruch, Stundung/Ratenzahlung.
- Zahnarztrechnung/DZR hat eigene Logik: Praxis, Patient, Behandlungstag, GOZ/BEMA, Leistungspositionen, Eigenanteil, Erstattung prüfen.
- Arbeitsvertrag/Änderungsvereinbarung hat eigene Logik: was ändert sich, ab wann, befristet/unbefristet, Unterschrift nötig.

CHAT-FÜHRUNG V8.6.6:
- Wenn der Nutzer schreibt "verstanden?", "ok?", "hast du verstanden?": kurz bestätigen und den Kern in 2-3 Sätzen sagen.
- Wenn der Nutzer sagt "Ich kann nicht alles zahlen" oder "Ich kann den Betrag nicht auf einmal zahlen": direkt Ratenzahlung/Stundung erklären, relevante Nummer/Betrag nennen und nach realistischer Rate fragen oder kurzen Antrag anbieten.
- Bei Finanzamt: Stundung oder Ratenzahlung beantragen, Steuernummer/Betrag nennen, um Aussetzung der Vollstreckung bis zur Entscheidung bitten.
- Bei Rundfunkbeitrag + Jobcenter/Bürgergeld: Bescheid erneut senden, Beitragsnummer nennen, Befreiung/rückwirkende Befreiung prüfen und um Aussetzung der Vollstreckung bitten.
- Bei Staatsanwaltschaft/Geldauflage: fristgerecht zahlen oder sofort schriftlich Ratenzahlung/Stundung beantragen. Nicht als normales Inkasso behandeln.
- Bei Anklageschrift: Frist 1 Woche ernst nehmen, keine Aussage/Schuldeingeständnis ohne Beratung, Einwände/Beweise/Zeugen nur sauber einreichen; normale E-Mail reicht nicht, wenn das Schreiben das sagt.
- Bei Zahnarzt/DZR: wenn Behandlung/Positionen nicht sichtbar sind, nicht abwimmeln. Genau sagen: lade die Seite mit GOZ/BEMA, Leistungsbeschreibung, Zahnnummer, Faktor, Material/Labor hoch.

FEHLENDE-DATEN-REGEL V8.6.6:
Wenn der Nutzer eine E-Mail, Antwort oder einen Brief will, prüfe zuerst:
- sicherer Name für die Unterschrift
- sichere Referenz/Aktenzeichen/Beitragsnummer/Steuernummer/Kassenzeichen
- Empfänger/E-Mail/Adresse oder sicherer Übermittlungsweg
Wenn der Name fehlt, frage kurz nach dem vollständigen Namen statt eine fertige Vorlage mit falschem Namen zu bauen.
Wenn nur Aktenzeichen/Datum unsicher ist, überlade den Betreff nicht mit Platzhaltern. Lieber weglassen oder kurz schreiben: "Aktenzeichen bitte aus dem Brief übernehmen".
Bei Inkasso/Ratenzahlung kurz warnen: Eine Ratenzahlung kann als Anerkennung der Forderung gewertet werden. Bei Unsicherheit erst Forderungsaufstellung verlangen.

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

BEI ANKLAGESCHRIFT / STRAFSACHE / GERICHT:
- Briefart genau nennen: Anklageschrift / Strafsache / Amtsgericht, wenn passend.
- Vorwurf konkret erklären: was, wann, wo, welches Fahrzeug/Handlung, soweit sichtbar.
- Frist "eine Woche" oder andere Fristen klar hervorheben.
- Normale E-Mail reicht nicht, wenn das Schreiben das sagt. Dann Post, Geschäftsstelle zu Protokoll oder sicherer elektronischer Weg.
- Keine Schuldeingeständnisse formulieren. Bei Antworttext neutral bleiben.

BEI RUNDFUNKBEITRAG / BEITRAGSSERVICE:
- Nicht nur Inkasso schreiben. Nenne Rundfunkbeitrag / Beitragsservice / Vollstreckung.
- Beitragsnummer oder Beitragskonto gezielt beachten.
- Bei Ratenzahlung: schriftlich beantragen, Betrag nennen, Forderungsaufstellung verlangen, Bestätigung abwarten.

BEI FINANZAMT / STEUER:
- Steuerart/Jahr, Betrag, Fälligkeit und Steuernummer prüfen.
- Optionen kurz nennen: zahlen, Einspruch prüfen, Stundung/Ratenzahlung beantragen, Finanzamt kontaktieren.
- Bei drohender Vollstreckung schnell handeln, aber keine Panik machen.

BEI ZAHNARZTRECHNUNG / DZR:
- Nicht nur sagen "prüfe die Rechnung".
- Suche aktiv nach GOZ/BEMA, Leistungsbeschreibung, Zahnnummer, Behandlungstag, Faktor, Labor/Materialkosten.
- Wenn die Detailseite fehlt, bitte genau darum: Seite mit Leistungspositionen/GOZ/BEMA hochladen.
- Erkläre, ob es nach Zahnreinigung, Füllung, Krone, Brücke, Prothese, Wurzelbehandlung oder Material/Labor aussieht, aber nur wenn sichtbar.

BEI ARBEITSVERTRAG / ÄNDERUNGSVEREINBARUNG:
- Erkläre konkret, was sich ändert, ab wann es gilt, ob es befristet/unbefristet ist und ob unterschrieben werden muss.
- Wenn es nur eine bestätigte Änderung ist, sage auch, was gleich bleibt.

BEI BANK / P-KONTO / KONTOPFÄNDUNG:
- Erkläre: Ein P-Konto schützt grundsätzlich nur den Freibetrag, nicht automatisch die ganze Forderung.
- Nicht behaupten, dass die Pfändung falsch oder erledigt ist.
- Nicht schreiben: "Sonst ist Ihr gesamtes Geld weg". Schreibe ruhiger: "Guthaben über dem geschützten Betrag kann gesperrt oder abgeführt werden."
- Wenn bereits ein P-Konto bestehen könnte: NICHT "P-Konto beantragen" schreiben, sondern "P-Konto-Status und Freibetrag bei der Bank bestätigen lassen".
- Prüfen: Bankstatus P-Konto, Freibetrag, Gläubiger, Betrag, Aktenzeichen und ob eine Bescheinigung nötig ist.
- Bei Unsicherheit Schuldnerberatung, Verbraucherzentrale oder Sozialberatung empfehlen.
- Ratenzahlung nur nennen, wenn der Nutzer danach fragt oder zahlen will.
- Bei Antwortvorlage an die Bank: Status, Freibetrag, gesperrte/freigegebene Beträge und Bescheinigung erfragen. Keine Zahlungszusage.

BEI STAATSANWALTSCHAFT / GELDAUFLAGE:
- Nicht als Inkasso oder normale Rechnung behandeln.
- Kurz sagen: Es ist eine Geldauflage/Zahlungsaufforderung in einer Strafsache.
- Wenn Zahlung nicht möglich ist: sofort schriftlich Ratenzahlung oder Stundung beantragen.
- Bei Unsicherheit Anwalt/Beratungsstelle empfehlen.

BEI FINANZAMT / STEUERSCHULD / VOLLSTRECKUNG:
- Nicht als normale Rechnung behandeln.
- Nenne Steuernummer, Steuerart/Jahr, Betrag, Säumniszuschlag und Fälligkeit, wenn erkannt.
- Bei Zahlungsproblem: Stundung oder Ratenzahlung beantragen und um Aussetzung der Vollstreckung bitten.
- Frage nach realistischer Rate, wenn eine konkrete Vorlage gebraucht wird.

BEI RUNDFUNKBEITRAG / BEITRAGSSERVICE:
- Nicht als privates Inkasso behandeln.
- Beitragsnummer ist wichtig.
- Wenn Jobcenter/Bürgergeld/Bescheid genannt wird: Bescheid erneut senden, Befreiung/rückwirkende Befreiung prüfen und Vollstreckung aussetzen lassen.

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
    antwort = clampChatAnswerV864(antwort, frageMode, frage, lang);

    if (frageMode === "next_steps") {
      antwort = shortenNextStepsAnswer(antwort, lang);
      antwort = postProcessQuestionAnswer(antwort, meta);
      antwort = clampChatAnswerV864(antwort, frageMode, frage, lang);
    }

    return res.json({
      ok: true,
      antwort
    });


  } catch (error) {
    console.error("Fehler /api/frage:", error);

    try {
      const meta = req.body && req.body.meta && typeof req.body.meta === "object" ? req.body.meta : {};
      const frageModeFallback = cleanText((req.body && req.body.frageMode) || "free");
      const langFallback = ((req.body && req.body.lang) || "de").toLowerCase();

      return res.json({
        ok: true,
        fallback: true,
        antwort: buildQuestionFallbackAnswer(frageModeFallback, meta, langFallback)
      });
    } catch (fallbackError) {
      return res.status(500).json({
        ok: false,
        error: "Die Frage konnte gerade nicht beantwortet werden. Bitte versuche es nochmal."
      });
    }
  }
});

 

 



// V8.7 Universal-Chat: echte Absichtslogik statt Brief-Wiederholung.
// Diese Funktionen überschreiben die älteren Universal-Funktionen weiter oben.
function extractUniversalRate(text = "") {
  const s = String(text || "").toLowerCase().replace(/,/g, ".");
  const m = s.match(/(\d{1,5}(?:\.\d{1,2})?)\s*(?:€|eur|euro)?\s*(?:monatlich|im monat|pro monat|rate|raten|monthly)?/i);
  if (!m) return "";
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (!hasAny(s, ["€", "eur", "euro", "monat", "rate", "zahlen", "ratenzahlung"])) return "";
  return `${String(n).replace(".", ",")} € monatlich`;
}

function looksLikePersonNameUniversal(text = "") {
  const raw = cleanText(String(text || "")).trim();
  if (!raw || raw.length > 80) return false;
  const low = raw.toLowerCase();
  if (hasAny(low, ["ich ", "kann", "nicht", "zahlen", "antwort", "brief", "email", "e-mail", "rate", "euro", "€", "unterlagen", "was", "wie", "warum", "frist", "termin"])) return false;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((p) => /^[A-Za-zÄÖÜäöüßÇĞİŞçğışéèêáàâóòôúùû-]{2,}$/.test(p));
}

function lastAssistantAskedUniversal(historyText = "", kind = "") {
  const h = String(historyText || "").toLowerCase();
  if (kind === "name") return hasAny(h, ["vollständiger name", "namen eintragen", "name für die unterschrift", "wie soll ich den namen"]);
  if (kind === "rate") return hasAny(h, ["welche monatliche rate", "welche rate", "realistische rate", "rate kannst", "monatlich zahlen"]);
  if (kind === "reason") return hasAny(h, ["welchen grund", "warum", "grund eintragen"]);
  return false;
}

function historyIndicatesReplyUniversal(historyText = "") {
  return hasAny(String(historyText || "").toLowerCase(), ["schreib", "antwort", "e-mail", "email", "brief", "text schreiben", "vorlage"]);
}

function historyIndicatesPaymentUniversal(historyText = "", context = "") {
  const h = `${historyText || ""} ${context || ""}`.toLowerCase();
  return hasAny(h, ["nicht zahlen", "nicht bezahlen", "ratenzahlung", "rate", "stundung", "zahlungsaufschub", "forderung", "mahnung", "rechnung", "betrag", "vollstreck"]);
}

function extractLikelyNameFromUniversalHistory(historyText = "") {
  const lines = String(historyText || "").split(/\n+/).reverse();
  for (const line of lines) {
    const m = line.match(/Nutzer:\s*(.+)$/i);
    if (!m) continue;
    const val = cleanText(m[1] || "").trim();
    if (looksLikePersonNameUniversal(val)) return val;
  }
  return "";
}

function extractUniversalEmail(context = "", meta = {}) {
  const possible = [meta.email, meta.empfaenger_email, meta.absender_email, meta.kontakt_email].filter(Boolean).join(" ");
  const source = `${possible} ${context || ""}`;
  const m = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : "";
}

function getUniversalRecipientLine(meta = {}, context = "") {
  const email = extractUniversalEmail(context, meta);
  if (email) return email;
  const abs = normalizeString(meta.absender || meta.absender_kurz || "");
  if (abs) return `${abs} – E-Mail/Adresse aus dem Brief übernehmen`;
  return "E-Mail/Adresse aus dem Brief übernehmen";
}

function safeUniversalRef(meta = {}) {
  let ref = normalizeString(getPrimaryReference(meta, ""));
  if (!ref || /bitte/i.test(ref)) return "";
  ref = ref
    .replace(/^(aktenzeichen|az|kundennummer|kunden-nr\.?|nummer|versicherungsnummer|beitragsnummer|steuernummer)\s*[:#-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return ref;
}

function getUniversalAmount(meta = {}) {
  return normalizeString(meta.betrag || meta.geldbetrag || meta.gesamtbetrag || "");
}

function buildUniversalCannotPay(meta = {}, domain = "allgemein") {
  const ref = safeUniversalRef(meta);
  const amount = getUniversalAmount(meta);
  const lines = [
    "Dann brauchen wir eine Lösung mit Ratenzahlung, Stundung oder Zahlungsaufschub.",
    "",
    "1. Prüfe kurz, ob der Betrag stimmt.",
    ref ? `2. Nummer/Aktenzeichen nennen: ${ref}.` : "2. Nummer/Aktenzeichen aus dem Brief nennen.",
    amount ? `3. Betrag nennen: ${amount}.` : "3. Betrag aus dem Brief nennen.",
    "4. Um schriftliche Bestätigung bitten.",
    "",
    "Welche monatliche Rate kannst du realistisch zahlen?"
  ];
  return cleanText(lines.join("\n"));
}

function buildUniversalProofSent(meta = {}, domain = "allgemein") {
  const ref = safeUniversalRef(meta);
  return cleanText(`Dann den Nachweis nochmal senden und Prüfung verlangen.

1. ${ref ? "Nummer/Aktenzeichen nennen: " + ref + "." : "Nummer/Aktenzeichen aus dem Brief nennen."}
2. Nachweis erneut anhängen.
3. Um erneute Prüfung bitten.
4. Bis zur Prüfung um Stopp weiterer Maßnahmen bitten.

Soll ich dir eine kurze Nachricht dafür schreiben?`);
}

function buildUniversalPaymentTemplate({ meta = {}, context = "", name = "", rate = "" }) {
  const recipient = getUniversalRecipientLine(meta, context);
  const ref = safeUniversalRef(meta);
  const amount = getUniversalAmount(meta);
  const cleanRate = normalizeUniversalRateForText(rate);
  const subjectParts = [];
  if (cleanRate) subjectParts.push("Ratenzahlung");
  subjectParts.push("Klärung zum Schreiben");
  if (ref) subjectParts.push(`Aktenzeichen/Nummer ${ref}`);
  const subject = subjectParts.join(" / ");
  const refText = ref ? ` unter der Nummer ${ref}` : "";
  const amountText = amount ? ` über ${amount}` : "";

  const body = cleanRate
    ? `Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben${refText}${amountText}.

Bitte senden Sie mir eine aktuelle Forderungsaufstellung zu und prüfen Sie die Forderung.

Ohne Anerkennung einer Rechtspflicht schlage ich, falls die Forderung berechtigt ist, eine monatliche Ratenzahlung von ${cleanRate} vor.

Bitte bestätigen Sie mir schriftlich, ob Sie mit dieser Ratenzahlung einverstanden sind.

Mit freundlichen Grüßen

${name || "[Name]"}`
    : `Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben${refText}${amountText}.

Bitte prüfen Sie den Vorgang und teilen Sie mir schriftlich mit, welche nächsten Schritte erforderlich sind.

Mit freundlichen Grüßen

${name || "[Name]"}`;

  return cleanText(`Empfänger: ${recipient}

Betreff: ${subject}

${body}`)
        .replace(/monatlich\s+monatlich/gi, "monatlich")
    .trim();
}

function buildUniversalProofTemplate({ meta = {}, context = "", name = "" }) {
  const recipient = getUniversalRecipientLine(meta, context);
  const ref = safeUniversalRef(meta);
  const subject = ref ? `Nachweis erneut eingereicht – ${ref}` : "Nachweis erneut eingereicht";
  return cleanText(`Empfänger: ${recipient}

Betreff: ${subject}

Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben${ref ? " unter der Nummer " + ref : ""}.

Der erforderliche Nachweis wurde bereits eingereicht. Vorsorglich reiche ich ihn erneut ein.

Bitte prüfen Sie den Vorgang erneut und setzen Sie weitere Maßnahmen bis zur Prüfung aus.

Bitte bestätigen Sie mir den Eingang schriftlich.

Mit freundlichen Grüßen

${name || "[Name]"}`);
}

function buildUniversalReplyQuestionOrTemplate({ frage = "", meta = {}, context = "", historyText = "" }) {
  const q = normalizeQuestionText(frage);
  const historyName = extractLikelyNameFromUniversalHistory(historyText);
  const metaName = normalizeString(meta.person || meta.name || "");
  const name = looksLikePersonNameUniversal(frage) ? cleanText(frage).trim() : (historyName || metaName || "");
  const rate = extractUniversalRate(frage) || extractUniversalRate(historyText);
  const payment = historyIndicatesPaymentUniversal(historyText, context) || Boolean(rate) || hasAny(q, ["ratenzahlung", "rate", "stundung", "nicht zahlen", "nicht bezahlen"]);
  const proof = hasAny(`${q} ${historyText}`.toLowerCase(), ["nachweis", "bescheid", "schon geschickt", "bereits geschickt", "befreiung", "unterlagen"]);

  if (!name) {
    return "Ich kann den Text schreiben. Mir fehlt nur der vollständige Name für die Unterschrift.\n\nWie soll ich den Namen eintragen?";
  }

  if (payment && !rate) {
    return "Welche monatliche Rate soll ich eintragen?\n\nSchreib zum Beispiel: 20 € monatlich.";
  }

  if (proof && !payment) {
    return buildUniversalProofTemplate({ meta, context, name });
  }

  return buildUniversalPaymentTemplate({ meta, context, name, rate });
}

function buildUniversalRateFollowup({ frage = "", meta = {}, context = "", historyText = "" }) {
  const rate = extractUniversalRate(frage);
  if (!rate) return "";
  const name = extractLikelyNameFromUniversalHistory(historyText) || normalizeString(meta.person || meta.name || "");
  if (!historyIndicatesPaymentUniversal(historyText, context) && !lastAssistantAskedUniversal(historyText, "rate")) return "";
  if (!name) return "Ich trage die Rate ein. Mir fehlt nur noch der vollständige Name für die Unterschrift.";
  return buildUniversalPaymentTemplate({ meta, context, name, rate });
}

function buildUniversalNameFollowup({ frage = "", meta = {}, context = "", historyText = "" }) {
  if (!looksLikePersonNameUniversal(frage)) return "";
  if (!lastAssistantAskedUniversal(historyText, "name")) return "";
  const name = cleanText(frage).trim();
  const rate = extractUniversalRate(historyText);
  const payment = historyIndicatesPaymentUniversal(historyText, context) || Boolean(rate);
  if (payment && !rate) return "Welche monatliche Rate soll ich eintragen?\n\nSchreib zum Beispiel: 20 € monatlich.";
  if (hasAny(historyText.toLowerCase(), ["nachweis", "bescheid", "befreiung", "unterlagen"]) && !payment) {
    return buildUniversalProofTemplate({ meta, context, name });
  }
  return buildUniversalPaymentTemplate({ meta, context, name, rate });
}

function buildUniversalNextStepsAnswer(meta = {}, domain = "allgemein") {
  const steps = buildUniversalNextSteps(meta, domain).slice(0, 3);
  return "Das sind die nächsten Schritte:\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function buildUniversalDeterministicChat({ frage, frageMode, meta, briefText, kurz, details, historyText, lang }) {
  const context = chatContextText(meta, briefText, kurz, details, frage, historyText);
  const domain = detectUniversalDocumentDomain(context);
  const intent = detectUniversalChatIntent(frage, frageMode);

  if (intent === "smalltalk") return politeSmallTalkReply(lang);

  const nameFollowup = buildUniversalNameFollowup({ frage, meta, context, historyText });
  if (nameFollowup) return nameFollowup;

  const rateFollowup = buildUniversalRateFollowup({ frage, meta, context, historyText });
  if (rateFollowup) return rateFollowup;

  if (intent === "cannot_pay") return buildUniversalCannotPay(meta, domain);
  if (intent === "proof_sent") return buildUniversalProofSent(meta, domain);
  if (intent === "reply") return buildUniversalReplyQuestionOrTemplate({ frage, meta, context, historyText });

  if (intent === "understood") return buildUniversalUnderstood(meta, domain);
  if (intent === "simplify") return buildUniversalShorter(meta, domain);
  if (intent === "next_steps") return buildUniversalNextStepsAnswer(meta, domain);
  if (intent === "attachments") return buildUniversalAttachments(meta, domain);
  if (intent === "phone_script") return buildUniversalPhoneScript(meta, domain);
  if (intent === "detail") return buildUniversalDetailRequest(meta, domain);
  if (intent === "consequence") return buildUniversalConsequence(meta, domain);
  if (intent === "must_react") return buildUniversalMustReact(meta, domain);
  if (intent === "objection") return buildUniversalObjection(meta, domain);
  if (intent === "reimbursement") return buildUniversalReimbursement(meta, domain);
  if (intent === "check_claim") return buildUniversalCheckClaim(meta, domain);

  return "";
}


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



// V8.7.1 Universal Chat Final: stärkere allgemeine Absichtslogik.
// Ziel: nicht einzelne Briefe, sondern Nutzerproblem -> fehlende Daten -> fertige Lösung.
function getDetectedPersonNameUniversal(meta = {}) {
  const candidates = [
    meta.person,
    meta.name,
    meta.betroffene_person,
    meta.empfaenger,
    meta.empfänger,
    meta.adressat,
    meta.kunde,
    meta.patient,
    meta.arbeitnehmer,
    meta.angeklagter,
    meta.beschuldigter
  ];

  for (const c of candidates) {
    const val = normalizeString(c || "");
    if (!val || /bitte|prüfen|unbekannt|keine/i.test(val)) continue;
    const cleaned = val
      .replace(/^(herr|frau)\s+/i, "")
      .replace(/\s*,.*$/, "")
      .trim();
    if (looksLikePersonNameUniversal(cleaned)) return cleaned;
  }
  return "";
}

function userSaysUseKnownNameUniversal(text = "") {
  const q = normalizeQuestionText(text);
  return hasAny(q, [
    "namen weißt du", "name weißt du", "steht im brief", "steht doch im brief", "hast du schon", "kennst du schon",
    "nimm den namen", "übernimm den namen", "name ist im brief", "den namen hast du"
  ]);
}

function normalizeUniversalRateForText(rate = "") {
  const r = normalizeString(rate || "");
  if (!r) return "";
  const m = r.match(/(\d{1,5}(?:[,.]\d{1,2})?)/);
  if (!m) return r.replace(/\s*monatlich\s*monatlich/gi, " monatlich");
  return `${m[1].replace(".", ",")} € monatlich`;
}

function detectUniversalChatIntent(frage = "", frageMode = "free") {
  const mode = String(frageMode || "free").toLowerCase();
  const q = normalizeQuestionText(frage);

  if (isPoliteSmallTalkQuestion(frage)) return "smalltalk";
  if (hasAny(q, ["kann nicht zahlen", "nicht bezahlen", "nicht auf einmal", "kein geld", "ratenzahlung", "rate", "raten", "stundung", "zahlungsaufschub", "in raten", "monatlich zahlen", "ödeyemem", "taksit", "не мога да платя", "nu pot plăti", "cannot pay", "installment", "تقسيط"])) return "cannot_pay";
  if (mode === "reply" || hasAny(q, ["schreib", "antwort", "e-mail", "email", "mail", "brief", "vorlage", "pdf", "whatsapp", "text schreiben", "text fertig", "fertigen text", "vernünftigen text", "mach mir", "fertig machen", "kopieren", "direkt einfügen", "cevap", "yaz", "писмо", "отговор", "scrie", "răspuns", "اكتب", "رد"])) return "reply";
  if (hasAny(q, ["schon geschickt", "bereits geschickt", "nachweis geschickt", "bescheid geschickt", "befreit", "befreiung", "nachweis wurde", "unterlagen geschickt", "gönderdim", "изпратено", "trimis", "already sent", "exemption", "أرسلت", "إعفاء"])) return "proof_sent";
  if (mode === "next_steps" || hasAny(q, ["was soll ich tun", "was muss ich tun", "was jetzt", "nächster schritt", "wie weiter", "was kann ich jetzt", "dagegen tun", "ne yap", "какво да направя", "ce fac", "what should i do", "ماذا أفعل"])) return "next_steps";
  if (mode === "deadline" || hasAny(q, ["bis wann", "frist", "termin", "deadline", "son tarih", "срок", "termen", "مهلة"])) return "deadline";
  if (mode === "consequence" || hasAny(q, ["wenn ich nichts", "passiert wenn", "folge", "ignorieren", "nichts mache", "ne olur", "какво ще стане", "ce se întâmplă", "what happens", "ماذا يحدث"])) return "consequence";
  if (hasAny(q, ["unterlagen", "anlagen", "anhängen", "mitschicken", "welche dokumente", "was brauche ich", "documents", "belge", "документи", "atașez", "مستندات"])) return "attachments";
  if (hasAny(q, ["telefon", "anrufen", "am telefon", "was soll ich sagen", "rufen", "call", "phone", "telefon aç", "обадя", "sun", "اتصال"])) return "phone_script";
  if (hasAny(q, ["noch kürzer", "kürzer", "kurz", "einfacher", "einfach erklären", "verstehe nicht", "shorter", "simpler", "daha kısa", "по-кратко", "mai scurt", "أقصر"])) return "simplify";
  if (hasAny(q, ["welche behandlung", "was wurde gemacht", "wofür", "positionen", "leistungsposition", "goz", "bema", "rechnungsposition", "was ändert sich", "was wurde geändert", "vorwurf", "wer ist zeuge", "berechnung", "details", "hangi", "какво", "ce", "what exactly"])) return "detail";
  if (hasAny(q, ["muss ich reagieren", "muss ich was machen", "muss ich überhaupt", "nichts tun", "brauche ich reagieren", "do i have to", "zorunda", "трябва ли", "trebuie", "هل يجب"])) return "must_react";
  if (hasAny(q, ["widerspruch", "einspruch", "ablehnung", "bescheid falsch", "nicht einverstanden", "objection", "contest", "itiraz", "възражение", "contestație", "اعتراض"])) return "objection";
  if (hasAny(q, ["erstattung", "zurückbekommen", "krankenkasse zahlt", "übernimmt", "refund", "reimbursement", "geri ödeme", "възстановяване", "rambursare", "استرداد"])) return "reimbursement";
  if (hasAny(q, ["forderung prüfen", "stimmt die forderung", "ist das richtig", "schon bezahlt", "zahlungsnachweis", "check claim", "borç", "дълг", "creanță"])) return "check_claim";
  if (hasAny(q, ["verstanden", "hast du verstanden", "ok verstanden", "understood", "anladın", "разбра", "ai înțeles", "فهمت"])) return "understood";

  return "free";
}

function buildUniversalCannotPay(meta = {}, domain = "allgemein") {
  const ref = safeUniversalRef(meta);
  const amount = getUniversalAmount(meta);
  return cleanText([
    "Dann brauchen wir eine Lösung mit Ratenzahlung, Stundung oder Zahlungsaufschub.",
    "",
    "1. Prüfe kurz, ob der Betrag stimmt.",
    ref ? `2. Nummer/Aktenzeichen nennen: ${ref}.` : "2. Nummer/Aktenzeichen aus dem Brief nennen.",
    amount ? `3. Betrag nennen: ${amount}.` : "3. Betrag aus dem Brief nennen.",
    "4. Um schriftliche Bestätigung bitten.",
    "",
    "Welche monatliche Rate kannst du realistisch zahlen?"
  ].join("\n"));
}

function buildUniversalPaymentTemplate({ meta = {}, context = "", name = "", rate = "" }) {
  const recipient = getUniversalRecipientLine(meta, context);
  const ref = safeUniversalRef(meta);
  const amount = getUniversalAmount(meta);
  const cleanRate = normalizeUniversalRateForText(rate);
  const subjectParts = [];
  if (cleanRate) subjectParts.push("Ratenzahlung");
  subjectParts.push("Klärung zum Schreiben");
  if (ref) subjectParts.push(`Aktenzeichen/Nummer ${ref}`);
  const subject = subjectParts.join(" / ");

  const body = cleanRate
    ? `Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben${ref ? " zum Aktenzeichen/zur Nummer " + ref : ""}${amount ? " über " + amount : ""}.

Bitte senden Sie mir eine aktuelle Aufstellung und prüfen Sie die Forderung.

Ohne Anerkennung einer Rechtspflicht schlage ich, falls die Forderung berechtigt ist, eine monatliche Ratenzahlung von ${cleanRate} vor.

Bitte bestätigen Sie mir schriftlich, ob Sie mit dieser Ratenzahlung einverstanden sind.

Mit freundlichen Grüßen

${name || "[Name]"}`
    : `Sehr geehrte Damen und Herren,

ich beziehe mich auf Ihr Schreiben${ref ? " unter der Nummer " + ref : ""}.

Bitte prüfen Sie den Vorgang und teilen Sie mir schriftlich mit, welche nächsten Schritte erforderlich sind.

Mit freundlichen Grüßen

${name || "[Name]"}`;

  return cleanText(`Empfänger: ${recipient}

Betreff: ${subject}

${body}`)
        .trim();
}

function buildUniversalReplyQuestionOrTemplate({ frage = "", meta = {}, context = "", historyText = "" }) {
  const q = normalizeQuestionText(frage);
  const detectedName = getDetectedPersonNameUniversal(meta);
  const historyName = extractLikelyNameFromUniversalHistory(historyText);
  const userName = looksLikePersonNameUniversal(frage) ? cleanText(frage).trim() : "";
  const name = userName || historyName || (userSaysUseKnownNameUniversal(frage) ? detectedName : detectedName);
  const rate = extractUniversalRate(frage) || extractUniversalRate(historyText);
  const payment = historyIndicatesPaymentUniversal(historyText, context) || Boolean(rate) || hasAny(q, ["ratenzahlung", "rate", "stundung", "nicht zahlen", "nicht bezahlen", "in raten", "monatlich"]);
  const proof = hasAny(`${q} ${historyText}`.toLowerCase(), ["nachweis", "bescheid", "schon geschickt", "bereits geschickt", "befreiung", "unterlagen"]);

  if (!name) {
    return "Ich kann den Text schreiben. Mir fehlt nur der vollständige Name für die Unterschrift.\n\nWie soll ich den Namen eintragen?";
  }

  if (payment && !rate) {
    return "Welche monatliche Rate soll ich eintragen?\n\nSchreib zum Beispiel: 20 € monatlich.";
  }

  if (proof && !payment) {
    return buildUniversalProofTemplate({ meta, context, name });
  }

  return buildUniversalPaymentTemplate({ meta, context, name, rate });
}

function buildUniversalRateFollowup({ frage = "", meta = {}, context = "", historyText = "" }) {
  const rate = extractUniversalRate(frage);
  if (!rate) return "";
  const name = extractLikelyNameFromUniversalHistory(historyText) || getDetectedPersonNameUniversal(meta);
  if (!historyIndicatesPaymentUniversal(historyText, context) && !lastAssistantAskedUniversal(historyText, "rate")) return "";
  if (!name) return "Ich trage die Rate ein. Mir fehlt nur noch der vollständige Name für die Unterschrift.";
  return buildUniversalPaymentTemplate({ meta, context, name, rate });
}

function buildUniversalNameFollowup({ frage = "", meta = {}, context = "", historyText = "" }) {
  const detectedName = getDetectedPersonNameUniversal(meta);
  const name = looksLikePersonNameUniversal(frage)
    ? cleanText(frage).trim()
    : (userSaysUseKnownNameUniversal(frage) ? detectedName : "");

  if (!name) return "";
  if (!lastAssistantAskedUniversal(historyText, "name") && !historyIndicatesReplyUniversal(historyText)) return "";
  const rate = extractUniversalRate(historyText);
  const payment = historyIndicatesPaymentUniversal(historyText, context) || Boolean(rate);
  if (payment && !rate) return "Welche monatliche Rate soll ich eintragen?\n\nSchreib zum Beispiel: 20 € monatlich.";
  if (hasAny(historyText.toLowerCase(), ["nachweis", "bescheid", "befreiung", "unterlagen"]) && !payment) {
    return buildUniversalProofTemplate({ meta, context, name });
  }
  return buildUniversalPaymentTemplate({ meta, context, name, rate });
}


function postProcessQuestionAnswer(answer = "", meta = {}) {
  let out = cleanText(answer || "");

  const safeReplacement = "Bitte senden Sie mir eine aktuelle Forderungsaufstellung zu.";
  out = out.replace(new RegExp("Ich bestätige die offene Forderung[^.?!]*(?:[.?!]|$)", "gi"), safeReplacement);
  out = out.replace(new RegExp("Ich bestätige die Forderung[^.?!]*(?:[.?!]|$)", "gi"), safeReplacement);
  out = out.replace(new RegExp("ich bestätige[^.?!]*Forderung[^.?!]*(?:[.?!]|$)", "gi"), safeReplacement);

  out = out.replace(new RegExp("monatlich\\s+monatlich", "gi"), "monatlich");
  out = out.replace(new RegExp("Aktenzeichen\\/Nummer\\s+Aktenzeichen:", "gi"), "Aktenzeichen:");
  out = out.replace(new RegExp("Aktenzeichen\\/zur Nummer\\s+Aktenzeichen:", "gi"), "Aktenzeichen:");

  const detectedName = getDetectedPersonNameUniversal(meta);
  if (detectedName) out = out.replace(/\[Name\]/g, detectedName);

  return cleanText(out);
}
app.listen(PORT, () => {
  console.log(`Hilfe24 Server läuft auf Port ${PORT}`);
});
