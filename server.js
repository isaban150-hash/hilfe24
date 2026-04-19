const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function getLanguageName(lang) {
  if (lang === "tr") return "Türkisch";
  if (lang === "bg") return "Bulgarisch";
  return "Deutsch";
}

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

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      return res.send("Fehler: Keine Antwort von KI");
    }

    const text = data.candidates[0].content.parts[0].text;
    res.send(text);

  } catch (err) {
    console.log("FEHLER /test:", err);
    res.send("Fehler bei Erklärung.");
  }
});

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
- sagen, dass der Brief verstanden wurde
- ruhig und respektvoll klingen
- einfach formuliert sein

Wenn es um fehlende Unterlagen geht, kann die Antwort sagen, dass die Unterlagen nachgereicht werden.

Brief:
${userText}`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      return res.send("Fehler: Keine Antwort von KI");
    }

    const text = data.candidates[0].content.parts[0].text;
    res.send(text);

  } catch (err) {
    console.log("FEHLER /antwort:", err);
    res.send("Fehler bei Antwort.");
  }
});

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
- Sehr einfache Sprache
- Kurze Sätze
- Keine Fachwörter
- Antworte nur auf die Frage
- Gib praktische Hilfe
- Wenn möglich, zeige einfache Lösungen
- Wenn etwas nicht sicher ist, sage ehrlich, dass man nachfragen sollte
- Wenn es um Geld geht, nenne wenn passend auch:
  - Ratenzahlung fragen
  - Fristverlängerung fragen
  - schnell Kontakt aufnehmen
  - nicht ignorieren

Antwort:`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      return res.send("Fehler bei Antwort.");
    }

    const text = data.candidates[0].content.parts[0].text;
    res.send(text);

  } catch (err) {
    console.log("FEHLER /frage:", err);
    res.send("Fehler bei Antwort.");
  }
});

app.post("/general", async (req, res) => {
  const question = req.body.question || "";
  const lang = req.body.lang || "de";
  const targetLanguage = getLanguageName(lang);

  try {
    const prompt = `Ein Mensch hat eine Frage zu Geld, Unterstützung oder Hilfe im Alltag.

Frage:
${question}

WICHTIG:
- Antworte komplett auf ${targetLanguage}
- Sehr einfache Sprache
- Kurze Sätze
- Keine Fachwörter

GIB IMMER KONKRETE HILFE:

Nenne klare Möglichkeiten wie:
- Wohngeld beantragen
- Unterstützung bei der Stadt fragen
- Hilfe vom Jobcenter prüfen
- Hilfe von der Krankenkasse prüfen
- Unterstützung für Kinder prüfen
- Fahrkarten-Zuschuss prüfen
- Hilfe für Möbel oder Wohnung prüfen
- Ratenzahlung vereinbaren
- Bei Problemen dort anrufen

WICHTIG:
- Schreibe immer konkrete Schritte
- Nicht nur erklären
- Sag den Leuten, was sie tun können
- Mache keine sicheren Zusagen

Wenn etwas nicht sicher ist:
- Das könnte möglich sein
- Du kannst dort nachfragen
- Es kann sinnvoll sein, das prüfen zu lassen

Am Ende IMMER:

WAS DU JETZT MACHEN KANNST:
- 2 bis 5 einfache Schritte

Wenn nichts passt:
Bitte frage direkt bei der zuständigen Stelle nach.`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      return res.send("Fehler bei Antwort.");
    }

    const text = data.candidates[0].content.parts[0].text;
    res.send(text);

  } catch (err) {
    console.log("FEHLER /general:", err);
    res.send("Fehler bei Antwort.");
  }
});

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

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: image
                  }
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      return res.send("TEXT NICHT KLAR ERKENNBAR");
    }

    const text = data.candidates[0].content.parts[0].text;
    res.send(text);

  } catch (err) {
    console.log("FEHLER /scan:", err);
    res.send("Fehler beim Bild-Scan.");
  }
});

app.listen(3000, () => {
  console.log("Server läuft auf http://localhost:3000");
});