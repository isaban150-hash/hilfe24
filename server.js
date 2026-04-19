const express = require("express");
const cors = require("cors");
const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function getLanguageName(lang) {
  if (lang === "tr") return "Türkisch";
  if (lang === "bg") return "Bulgarisch";
  if (lang === "ar") return "Arabisch";
  return "Deutsch";
}

function getModeText(mode) {
  if (mode === "pro") {
    return `
WICHTIG:
- Antworte professionell
- klar
- korrekt
- höflich
- gut formuliert
- nicht kindlich
- keine unnötig langen Texte`;
  }

  return `
WICHTIG:
- Antworte extrem einfach
- wie für einen Menschen, der kaum schwere Wörter versteht
- sehr kurze Sätze
- sehr einfache Wörter
- keine Fachwörter
- ruhig und klar`;
}

async function askGemini(parts) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
    console.log("GEMINI API FEHLER:", JSON.stringify(data));
    throw new Error("Gemini API Fehler");
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Keine Antwort erhalten.";
}

// OCR / Bild lesen
app.post("/scan", async (req, res) => {
  try {
    const image = req.body.image || "";

    if (!image) {
      return res.json({ result: "Kein Bild gesendet." });
    }

    const prompt = `Lies den gesamten Text aus diesem Bild aus.

WICHTIG:
- Antworte nur mit dem erkannten Text
- Keine Erklärung
- Keine Zusammenfassung
- Keine Übersetzung
- Sprache des Bildes nicht verändern
- Wenn kaum Text lesbar ist, schreibe genau:
TEXT NICHT KLAR ERKENNBAR`;

    const result = await askGemini([
      { text: prompt },
      {
        inline_data: {
          mime_type: "image/jpeg",
          data: image
        }
      }
    ]);

    res.json({ result });
  } catch (err) {
    console.log("FEHLER /scan:", err);
    res.status(500).json({ result: "TEXT NICHT KLAR ERKENNBAR" });
  }
});

// Dokument erklären
app.post("/erklaeren", async (req, res) => {
  try {
    const text = req.body.text || "";
    const lang = req.body.lang || "de";
    const mode = req.body.mode || "simple";
    const targetLanguage = getLanguageName(lang);

    if (!text.trim()) {
      return res.json({ result: "Kein Text vorhanden." });
    }

    const prompt = `Erkläre dieses Schreiben oder Dokument.

Sprache:
- Antworte komplett auf ${targetLanguage}

${getModeText(mode)}

REGELN:
- Erkenne selbst, was das für ein Dokument ist
- Das kann sein:
  - Brief
  - Rechnung
  - Mahnung
  - Jobcenter
  - Gericht
  - Krankenkasse
  - Schule
  - Werbung
  - Vertrag
  - Medikamenten-Info
  - Arztbrief
  - allgemeine Information
  - oder etwas anderes

Wenn Modus = einfach:
- erkläre so, dass auch ein Mensch mit wenig Sprache es versteht

Wenn Modus = professionell:
- erkläre klar und erwachsen
- aber trotzdem verständlich

Nutze diese Struktur:
1. WAS IST DAS
2. WAS STEHT DRIN
3. WAS MUSST DU TUN
4. WIE DRINGEND IST DAS
5. WELCHE HILFE KÖNNTE MÖGLICH SEIN

WICHTIG:
- Wenn es Werbung ist, klar sagen, dass man meist nichts tun muss
- Wenn eine Frist da ist, klar nennen
- Wenn Geld oder Behörde vorkommt, deutlich sagen, dass es wichtig sein kann
- Dringlichkeit nur mit diesen deutschen Wörtern:
  - niedrig
  - mittel
  - hoch

Text:
${text}`;

    const result = await askGemini([{ text: prompt }]);
    res.json({ result });
  } catch (err) {
    console.log("FEHLER /erklaeren:", err);
    res.status(500).json({ result: "Fehler beim Erklären." });
  }
});

// Antwort auf Schreiben verfassen
app.post("/antwort", async (req, res) => {
  try {
    const text = req.body.text || "";
    const lang = req.body.lang || "de";
    const mode = req.body.mode || "simple";
    const targetLanguage = getLanguageName(lang);

    if (!text.trim()) {
      return res.json({ result: "Kein Text vorhanden." });
    }

    const prompt = `Schreibe eine passende Antwort auf dieses Schreiben.

Sprache:
- Antworte komplett auf ${targetLanguage}

${getModeText(mode)}

REGELN:
- Wenn Modus = professionell:
  - höflich
  - korrekt
  - wie echte E-Mail oder echter Brief
- Wenn Modus = einfach:
  - trotzdem höflich
  - aber sehr leicht verständlich

Die Antwort soll direkt kopierbar sein.
Keine Erklärung davor.
Keine Erklärung danach.
Nur den fertigen Text.

Schreiben:
${text}`;

    const result = await askGemini([{ text: prompt }]);
    res.json({ result });
  } catch (err) {
    console.log("FEHLER /antwort:", err);
    res.status(500).json({ result: "Fehler beim Schreiben der Antwort." });
  }
});

// Etwas erledigen / professionellen Text bauen
app.post("/erledigen", async (req, res) => {
  try {
    const task = req.body.task || "";
    const target = req.body.target || "sonstiges";
    const lang = req.body.lang || "de";
    const mode = req.body.mode || "simple";
    const targetLanguage = getLanguageName(lang);

    if (!task.trim()) {
      return res.json({ result: "Keine Aufgabe vorhanden." });
    }

    const prompt = `Ein Mensch braucht Hilfe, um einen Text zu schreiben oder etwas zu erledigen.

Sprache:
- Antworte komplett auf ${targetLanguage}

Ziel:
- Erstelle einen fertigen Text
- passend für: ${target}

MODUS:
- ${mode === "pro" ? "professionell" : "einfach"}

WICHTIG:
- Wenn Ziel Jobcenter, Vermieter, Krankenkasse, Schule oder Arbeit ist:
  - schreibe korrekt und höflich
  - wie eine echte E-Mail oder Nachricht
- Wenn Ziel Arzt / Pflege / Dokumentation ist:
  - schreibe klar, korrekt, sachlich
- Wenn Modus = einfach:
  - einfach formulieren
  - aber trotzdem brauchbar
- Wenn Modus = professionell:
  - erwachsen
  - klar
  - sauber
  - professionell

Nur den fertigen Text ausgeben.
Keine Einleitung.
Keine Erklärung danach.

Aufgabe:
${task}`;

    const result = await askGemini([{ text: prompt }]);
    res.json({ result });
  } catch (err) {
    console.log("FEHLER /erledigen:", err);
    res.status(500).json({ result: "Fehler beim Erstellen des Textes." });
  }
});

// Allgemeine Fragen
app.post("/frage", async (req, res) => {
  try {
    const frage = req.body.frage || "";
    const lang = req.body.lang || "de";
    const mode = req.body.mode || "simple";
    const targetLanguage = getLanguageName(lang);

    if (!frage.trim()) {
      return res.json({ result: "Keine Frage vorhanden." });
    }

    const prompt = `Beantworte diese allgemeine Frage.

Sprache:
- Antworte komplett auf ${targetLanguage}

${getModeText(mode)}

REGELN:
- Die Frage kann sein über:
  - Erdkunde
  - Religion
  - Wirtschaft
  - Sport
  - Medikamente
  - Alltag
  - Beruf
  - Umschulung
  - Ausbildung
  - Rechte oder Ansprüche
  - oder normales Wissen

- Wenn die Frage eine Wissensfrage ist:
  - antworte klar und direkt
- Wenn es um Ansprüche oder Hilfe geht:
  - erkläre vorsichtig
  - mache keine falschen Versprechen
  - sage, wenn etwas geprüft werden sollte
- Wenn es um Medikamente geht:
  - einfach erklären
  - keine erfundene Behandlung anweisen
  - bei Unsicherheit Arzt oder Apotheke erwähnen

Wenn es passt, füge am Ende hinzu:
WAS DU JETZT MACHEN KANNST:
- 2 bis 4 einfache Schritte

Frage:
${frage}`;

    const result = await askGemini([{ text: prompt }]);
    res.json({ result });
  } catch (err) {
    console.log("FEHLER /frage:", err);
    res.status(500).json({ result: "Fehler bei der Beantwortung der Frage." });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
