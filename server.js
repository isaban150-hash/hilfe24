const express = require("express");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(express.static(process.cwd()));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(express.static(process.cwd()));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});
function getLanguageName(lang) {
  if (lang === "tr") return "Türkisch";
  if (lang === "bg") return "Bulgarisch";
  return "Deutsch";
}

const express = require("express");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(express.static(process.cwd()));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});
function getLanguageName(lang) {
  if (lang === "tr") return "Türkisch";
  if (lang === "bg") return "Bulgarisch";
  return "Deutsch";
}

async function askGemini(prompt, imageBase64 = null) {
  const body = {
    contents: [
      {
        parts: imageBase64
          ? [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: imageBase64
                }
              }
            ]
          : [{ text: prompt }]
      }
    ]
  };

  const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }
);

const data = await response.json();
return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
    throw new Error("Keine Antwort von Gemini");
  }

  return data.candidates[0].content.parts[0].text || "";
}

// 🔹 Brief erklären
app.post("/test", async (req, res) => {
  const userText = req.body.text || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Erkläre dieses Schreiben extrem einfach für jemanden, der wenig oder kein Deutsch kann.

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- sehr einfache Sprache
- kurze klare Sätze
- keine Fachwörter
- keine unnötigen langen Texte

Erkenne selbst, was das für ein Schreiben ist.
Es kann zum Beispiel sein:
- Behörde
- Rechnung
- Mahnung
- Inkasso
- Vermieter
- Schule
- Versicherung
- Krankenkasse
- Jobcenter
- Vertrag
- Kündigung
- Werbung
- Angebot
- allgemeine Information
- oder etwas anderes

Nutze genau diese Struktur, aber vollständig in ${targetLanguage} übersetzt:

1. WAS IST DAS FÜR EIN SCHREIBEN
2. WAS STEHT DRIN
3. IST DAS WICHTIG ODER EHER UNWICHTIG
4. MUSST DU ETWAS TUN
5. WAS MUSST DU JETZT TUN
6. GIBT ES EINE FRIST
7. WIE DRINGEND IST DAS
8. WELCHE HILFE KÖNNTE NOCH MÖGLICH SEIN
9. WAS KANNST DU JETZT MACHEN, WENN DU UNSICHER BIST

REGELN:
- Wenn es Werbung oder ein Angebot ist, dann klar sagen, dass man meistens nichts tun muss
- Wenn der Brief hilfreich sein könnte, dann das deutlich sagen
- Wenn Geld, Frist, Mahnung, Behörde oder wichtige Unterlagen erwähnt werden, dann als wichtig bewerten
- Wenn keine Frist genannt wird, schreibe klar: keine Frist genannt
- Bei Dringlichkeit immer NUR diese deutschen Wörter benutzen:
  - niedrig
  - mittel
  - hoch
- Diese 3 Wörter NICHT übersetzen
- Auch wenn die ganze Antwort auf Türkisch oder Bulgarisch ist, muss die Dringlichkeit immer auf Deutsch stehen

ZUSÄTZLICH:
- Die Person kennt sich nicht aus
- Erkläre nicht nur den Brief
- Zeige einfache Wege
- Nenne nur Hilfen, die sinnvoll sein könnten
- Mache keine sicheren Zusagen
- Schreibe lieber:
  - Das könnte möglich sein
  - Du kannst dort nachfragen
  - Oft gibt es Hilfe
  - Es kann sinnvoll sein, das prüfen zu lassen

Wenn es um Geld, Rechnung, Mahnung, Inkasso oder offene Beträge geht, nenne wenn passend auch:
- Ratenzahlung fragen
- nicht ignorieren
- schnell melden
- Teilzahlung fragen

Wenn nichts Sinnvolles erkennbar ist, schreibe:
Keine zusätzliche Hilfe klar erkennbar

Schreiben:
${userText}`;

    const text = await askGemini(prompt);
    res.send(text);
  } catch (err) {
    console.log("FEHLER /test:", err);
    res.send("Fehler bei Erklärung.");
  }
});

// 🔹 Antwort schreiben
app.post("/antwort", async (req, res) => {
  const userText = req.body.text || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Schreibe eine klare und höfliche Antwort auf diesen Brief.

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- sehr einfache Sprache
- kurz und direkt
- keine komplizierten Wörter

Die Antwort soll:
- ruhig und respektvoll klingen
- einfach formuliert sein
- helfen, direkt etwas abzuschicken

Wenn es um fehlende Unterlagen geht, kann die Antwort sagen, dass die Unterlagen nachgereicht werden.

Wenn es um Geld geht, kann die Antwort höflich fragen:
- ob Ratenzahlung möglich ist
- ob man etwas mehr Zeit bekommen kann

Brief:
${userText}`;

    const text = await askGemini(prompt);
    res.send(text);
  } catch (err) {
    console.log("FEHLER /antwort:", err);
    res.send("Fehler bei Antwort.");
  }
});

// 🔹 Frage zu einem Brief
app.post("/frage", async (req, res) => {
  const userText = req.body.text || "";
  const question = req.body.question || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Ein Mensch hat einen Brief bekommen und hat dazu eine Frage.

Brief:
${userText}

Frage:
${question}

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- sehr einfache Sprache
- kurze Sätze
- keine Fachwörter
- antworte nur auf die Frage
- gib praktische Hilfe
- wenn möglich, zeige einfache Lösungen
- wenn etwas nicht sicher ist, sage ehrlich, dass man nachfragen sollte

Wenn es um Geld geht, nenne wenn passend auch:
- Ratenzahlung fragen
- Fristverlängerung fragen
- schnell Kontakt aufnehmen
- nicht ignorieren

Antworte ruhig, klar und hilfreich.`;

    const text = await askGemini(prompt);
    res.send(text);
  } catch (err) {
    console.log("FEHLER /frage:", err);
    res.send("Fehler bei Antwort.");
  }
});

// 🔹 Allgemeine Fragen – breit, nicht nur Anträge
app.post("/general", async (req, res) => {
  const question = req.body.question || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Ein Mensch hat eine allgemeine Frage.

Frage:
${question}

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- sehr einfache Sprache
- kurze klare Sätze
- keine Fachwörter
- ruhig und hilfreich antworten

Die Frage kann zu ganz verschiedenen Themen sein, zum Beispiel:
- Hilfe, Unterstützung, Geld, Anträge
- Alltag und Haushalt
- Gesundheit allgemein
- Familie und Kinder
- Wohnen
- Strom, Heizung, Kosten
- Wissen über Länder oder Städte
- normale Alltagsfragen
- oder etwas anderes

REGELN:
- Antworte passend zur Frage
- Nicht nur auf Behörden oder Anträge festlegen
- Wenn die Frage eine normale Wissensfrage ist, beantworte sie einfach
- Wenn die Frage eine Alltagsfrage ist, gib einfache praktische Tipps
- Wenn die Frage um Hilfe oder Geld geht, nenne konkrete Möglichkeiten
- Wenn etwas nicht sicher ist oder von Ort, Zeit oder Einkommen abhängt, sage ehrlich:
  - Das kann unterschiedlich sein
  - Du kannst dort nachfragen
  - Das sollte man prüfen
- Mache keine sicheren Zusagen bei Ansprüchen oder Geld
- Wenn es passt, nenne einfache nächste Schritte

Wenn die Frage um Hilfe oder Unterstützung geht, kannst du je nach Frage passende Beispiele nennen wie:
- Wohngeld prüfen
- Unterstützung bei der Stadt fragen
- Hilfe vom Jobcenter prüfen
- Hilfe von der Krankenkasse prüfen
- Unterstützung für Kinder prüfen
- Fahrkarten-Zuschuss prüfen
- Hilfe für Möbel oder Wohnung prüfen
- Beratungsstelle fragen
- Antrag stellen
- dort anrufen und nachfragen

Wenn die Frage eine Wissensfrage ist:
- antworte normal und einfach
- keine unnötig langen Texte

Wenn die Frage eine Haushaltsfrage ist:
- antworte praktisch und einfach
- Schritt für Schritt, wenn sinnvoll

Am Ende, wenn es passt, füge diesen Abschnitt an:

WAS DU JETZT MACHEN KANNST:
- 2 bis 5 einfache Schritte

Wenn die Frage nur Wissen will und kein Handeln nötig ist, dann antworte einfach ohne unnötige Extra-Abschnitte.`;

    const text = await askGemini(prompt);
    res.send(text);
  } catch (err) {
    console.log("FEHLER /general:", err);
    res.send("Fehler bei Antwort.");
  }
});

// 🔹 Bild zu Text (OCR über Gemini)
app.post("/scan", async (req, res) => {
  const image = req.body.image || "";

  try {
    const prompt = `Lies den gesamten Text aus diesem Bild aus.

WICHTIG:
- Antworte nur mit dem erkannten Text
- Keine Erklärung
- Keine Zusammenfassung
- Keine Übersetzung
- Sprache des Bildes nicht verändern
- Wenn kaum Text lesbar ist, schreibe genau:
TEXT NICHT KLAR ERKENNBAR`;

    const text = await askGemini(prompt, image);
    res.send(text || "TEXT NICHT KLAR ERKENNBAR");
  } catch (err) {
    console.log("FEHLER /scan:", err);
    res.send("TEXT NICHT KLAR ERKENNBAR");
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
    throw new Error("Keine Antwort von Gemini");
  }

  return data.candidates[0].content.parts[0].text || "";
}

// 🔹 Brief erklären
app.post("/test", async (req, res) => {
  const userText = req.body.text || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Erkläre dieses Schreiben extrem einfach für jemanden, der wenig oder kein Deutsch kann.

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- sehr einfache Sprache
- kurze klare Sätze
- keine Fachwörter
- keine unnötigen langen Texte

Erkenne selbst, was das für ein Schreiben ist.
Es kann zum Beispiel sein:
- Behörde
- Rechnung
- Mahnung
- Inkasso
- Vermieter
- Schule
- Versicherung
- Krankenkasse
- Jobcenter
- Vertrag
- Kündigung
- Werbung
- Angebot
- allgemeine Information
- oder etwas anderes

Nutze genau diese Struktur, aber vollständig in ${targetLanguage} übersetzt:

1. WAS IST DAS FÜR EIN SCHREIBEN
2. WAS STEHT DRIN
3. IST DAS WICHTIG ODER EHER UNWICHTIG
4. MUSST DU ETWAS TUN
5. WAS MUSST DU JETZT TUN
6. GIBT ES EINE FRIST
7. WIE DRINGEND IST DAS
8. WELCHE HILFE KÖNNTE NOCH MÖGLICH SEIN
9. WAS KANNST DU JETZT MACHEN, WENN DU UNSICHER BIST

REGELN:
- Wenn es Werbung oder ein Angebot ist, dann klar sagen, dass man meistens nichts tun muss
- Wenn der Brief hilfreich sein könnte, dann das deutlich sagen
- Wenn Geld, Frist, Mahnung, Behörde oder wichtige Unterlagen erwähnt werden, dann als wichtig bewerten
- Wenn keine Frist genannt wird, schreibe klar: keine Frist genannt
- Bei Dringlichkeit immer NUR diese deutschen Wörter benutzen:
  - niedrig
  - mittel
  - hoch
- Diese 3 Wörter NICHT übersetzen
- Auch wenn die ganze Antwort auf Türkisch oder Bulgarisch ist, muss die Dringlichkeit immer auf Deutsch stehen

ZUSÄTZLICH:
- Die Person kennt sich nicht aus
- Erkläre nicht nur den Brief
- Zeige einfache Wege
- Nenne nur Hilfen, die sinnvoll sein könnten
- Mache keine sicheren Zusagen
- Schreibe lieber:
  - Das könnte möglich sein
  - Du kannst dort nachfragen
  - Oft gibt es Hilfe
  - Es kann sinnvoll sein, das prüfen zu lassen

Wenn es um Geld, Rechnung, Mahnung, Inkasso oder offene Beträge geht, nenne wenn passend auch:
- Ratenzahlung fragen
- nicht ignorieren
- schnell melden
- Teilzahlung fragen

Wenn nichts Sinnvolles erkennbar ist, schreibe:
Keine zusätzliche Hilfe klar erkennbar

Schreiben:
${userText}`;

    const text = await askGemini(prompt);
    res.send(text);
  } catch (err) {
    console.log("FEHLER /test:", err);
    res.send("Fehler bei Erklärung.");
  }
});

// 🔹 Antwort schreiben
app.post("/antwort", async (req, res) => {
  const userText = req.body.text || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Schreibe eine klare und höfliche Antwort auf diesen Brief.

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- sehr einfache Sprache
- kurz und direkt
- keine komplizierten Wörter

Die Antwort soll:
- ruhig und respektvoll klingen
- einfach formuliert sein
- helfen, direkt etwas abzuschicken

Wenn es um fehlende Unterlagen geht, kann die Antwort sagen, dass die Unterlagen nachgereicht werden.

Wenn es um Geld geht, kann die Antwort höflich fragen:
- ob Ratenzahlung möglich ist
- ob man etwas mehr Zeit bekommen kann

Brief:
${userText}`;

    const text = await askGemini(prompt);
    res.send(text);
  } catch (err) {
    console.log("FEHLER /antwort:", err);
    res.send("Fehler bei Antwort.");
  }
});

// 🔹 Frage zu einem Brief
app.post("/frage", async (req, res) => {
  const userText = req.body.text || "";
  const question = req.body.question || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Ein Mensch hat einen Brief bekommen und hat dazu eine Frage.

Brief:
${userText}

Frage:
${question}

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- sehr einfache Sprache
- kurze Sätze
- keine Fachwörter
- antworte nur auf die Frage
- gib praktische Hilfe
- wenn möglich, zeige einfache Lösungen
- wenn etwas nicht sicher ist, sage ehrlich, dass man nachfragen sollte

Wenn es um Geld geht, nenne wenn passend auch:
- Ratenzahlung fragen
- Fristverlängerung fragen
- schnell Kontakt aufnehmen
- nicht ignorieren

Antworte ruhig, klar und hilfreich.`;

    const text = await askGemini(prompt);
    res.send(text);
  } catch (err) {
    console.log("FEHLER /frage:", err);
    res.send("Fehler bei Antwort.");
  }
});

// 🔹 Allgemeine Fragen – breit, nicht nur Anträge
app.post("/general", async (req, res) => {
  const question = req.body.question || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Ein Mensch hat eine allgemeine Frage.

Frage:
${question}

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- sehr einfache Sprache
- kurze klare Sätze
- keine Fachwörter
- ruhig und hilfreich antworten

Die Frage kann zu ganz verschiedenen Themen sein, zum Beispiel:
- Hilfe, Unterstützung, Geld, Anträge
- Alltag und Haushalt
- Gesundheit allgemein
- Familie und Kinder
- Wohnen
- Strom, Heizung, Kosten
- Wissen über Länder oder Städte
- normale Alltagsfragen
- oder etwas anderes

REGELN:
- Antworte passend zur Frage
- Nicht nur auf Behörden oder Anträge festlegen
- Wenn die Frage eine normale Wissensfrage ist, beantworte sie einfach
- Wenn die Frage eine Alltagsfrage ist, gib einfache praktische Tipps
- Wenn die Frage um Hilfe oder Geld geht, nenne konkrete Möglichkeiten
- Wenn etwas nicht sicher ist oder von Ort, Zeit oder Einkommen abhängt, sage ehrlich:
  - Das kann unterschiedlich sein
  - Du kannst dort nachfragen
  - Das sollte man prüfen
- Mache keine sicheren Zusagen bei Ansprüchen oder Geld
- Wenn es passt, nenne einfache nächste Schritte

Wenn die Frage um Hilfe oder Unterstützung geht, kannst du je nach Frage passende Beispiele nennen wie:
- Wohngeld prüfen
- Unterstützung bei der Stadt fragen
- Hilfe vom Jobcenter prüfen
- Hilfe von der Krankenkasse prüfen
- Unterstützung für Kinder prüfen
- Fahrkarten-Zuschuss prüfen
- Hilfe für Möbel oder Wohnung prüfen
- Beratungsstelle fragen
- Antrag stellen
- dort anrufen und nachfragen

Wenn die Frage eine Wissensfrage ist:
- antworte normal und einfach
- keine unnötig langen Texte

Wenn die Frage eine Haushaltsfrage ist:
- antworte praktisch und einfach
- Schritt für Schritt, wenn sinnvoll

Am Ende, wenn es passt, füge diesen Abschnitt an:

WAS DU JETZT MACHEN KANNST:
- 2 bis 5 einfache Schritte

Wenn die Frage nur Wissen will und kein Handeln nötig ist, dann antworte einfach ohne unnötige Extra-Abschnitte.`;

    const text = await askGemini(prompt);
    res.send(text);
  } catch (err) {
    console.log("FEHLER /general:", err);
    res.send("Fehler bei Antwort.");
  }
});

// 🔹 Bild zu Text (OCR über Gemini)
app.post("/scan", async (req, res) => {
  const image = req.body.image || "";

  try {
    const prompt = `Lies den gesamten Text aus diesem Bild aus.

WICHTIG:
- Antworte nur mit dem erkannten Text
- Keine Erklärung
- Keine Zusammenfassung
- Keine Übersetzung
- Sprache des Bildes nicht verändern
- Wenn kaum Text lesbar ist, schreibe genau:
TEXT NICHT KLAR ERKENNBAR`;

    const text = await askGemini(prompt, image);
    res.send(text || "TEXT NICHT KLAR ERKENNBAR");
  } catch (err) {
    console.log("FEHLER /scan:", err);
    res.send("TEXT NICHT KLAR ERKENNBAR");
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
