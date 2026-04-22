const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const apiKey = process.env.GEMINI_API_KEY;
const MODEL = "gemini-2.5-flash";

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server läuft sauber" });
});

function getLanguageMeta(lang) {
  switch ((lang || "de").toLowerCase()) {
    case "tr":
      return {
        code: "tr",
        label: "Türkisch",
        instruction: `
Die Antwort muss vollständig auf natürlichem Türkisch sein.
Schreibe nicht wörtlich und nicht steif.
Schreibe so, wie ein normaler türkischsprachiger Mensch es im Alltag gut versteht.
Vermeide kaputte oder zu direkte Wort-für-Wort-Übersetzungen aus dem Deutschen.
Wenn etwas einfach gesagt werden kann, dann sage es einfach.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        instruction: `
Die Antwort muss vollständig auf natürlichem Bulgarisch sein.
Schreibe nicht wörtlich und nicht steif.
Schreibe so, wie ein normaler bulgarischsprachiger Mensch es im Alltag gut versteht.
Vermeide kaputte oder zu direkte Wort-für-Wort-Übersetzungen aus dem Deutschen.
Wenn etwas einfach gesagt werden kann, dann sage es einfach.
`
      };
    case "ar":
      return {
        code: "ar",
        label: "Arabisch",
        instruction: `
Die Antwort muss vollständig auf natürlichem, leicht verständlichem Arabisch sein.
Schreibe nicht wörtlich und nicht steif.
Vermeide unnatürliche oder zu direkte Wort-für-Wort-Übersetzungen aus dem Deutschen.
Schreibe klar, ruhig und einfach verständlich.
`
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        instruction: `
Die Antwort muss vollständig auf natürlichem, einfachem Deutsch sein.
Schreibe klar, ruhig und leicht verständlich.
`
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

function cleanAntwort(text) {
  if (!text) return "";

  return text
    .replace(/\*\*/g, "")
    .replace(/^\s*1\.\s*/gm, "")
    .replace(/^\s*2\.\s*/gm, "")
    .replace(/^\s*3\.\s*/gm, "")
    .replace(/^\s*-\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildUniversalPrompt({ langMeta, sourceType, contentRef }) {
  return `
Du bist Hilfe24, ein sehr guter Helfer für einfache Brief-Erklärungen.

Deine Aufgabe:
Lies ${sourceType} und erkläre den Inhalt sehr einfach, klar, direkt und menschlich.

Antwortsprache:
${langMeta.label}

Sprachqualität:
${langMeta.instruction}

Sehr wichtig zur Übersetzung:
Wenn die Antwort auf Türkisch, Bulgarisch oder Arabisch ist, dann sei besonders vorsichtig:
- Formuliere keine Handlung als feste Pflicht, wenn sie im Brief nicht eindeutig als Hauptpflicht genannt wird.
- Ziehe keine zu starke Schlussfolgerung aus einzelnen Sätzen.
- Bleibe näher an der wirklichen Aussage des Briefes.
- Wenn mehrere Dinge im Brief stehen, fasse sie neutral zusammen.
- Mache aus einer erwähnten Maßnahme oder einem Termin nicht automatisch die wichtigste Aufgabe.
- Übersetze sinngenau, nicht wörtlich.
- Schreibe natürlich und flüssig.
- Verfälsche nie die Bedeutung.
- Wenn im Brief ein genauer Dokumentname steht, übernimm die Bedeutung korrekt.
- Wenn ein Bescheid eingestellt, abgelehnt, gekündigt, aufgehoben oder beendet wurde, muss das in der Antwort klar bleiben.
- Schlechte oder steife Übersetzung ist verboten.
- Die Antwort darf nicht wie Google Translate klingen.

Wichtig:
Erkläre nicht nach einem starren Schema.
Erkläre nur die Punkte, die zu genau diesem Brief passen.
Wenn etwas im Brief nicht vorkommt, dann sprich es nicht künstlich an.
Wenn etwas auf Bildern nicht klar lesbar ist, dann sag das offen.
Erfinde nichts.
Vermute nichts als Tatsache.

Wenn mehrere Bilder zum selben Brief gehören, verbinde die Informationen sinnvoll.

Schreibe so, dass auch ein Mensch mit wenig Sprachkenntnissen oder wenig Erfahrung mit Briefen sofort versteht, worum es geht.

Regeln:
- Antworte vollständig in ${langMeta.label}.
- Schreibe in einfachen, normalen Sätzen.
- Schreibe natürlich und menschlich.
- Kein Beamtendeutsch.
- Keine unnötig schwere Fachsprache.
- Keine Einleitung wie "Gerne helfe ich dir".
- Keine Überschriften.
- Keine Listen mit 1., 2., 3.
- Kein Markdown.
- Keine Sternchen.
- Keine unnötigen Wiederholungen.
- Keine langen verschachtelten Sätze.
- Keine erfundenen Infos.
- Keine Vermutungen als Fakten.

Halte die Antwort sehr kurz.

Nenne nur die wirklich wichtigen Punkte.
Erkläre nur diese Sachen, wenn sie im Brief vorkommen:
- Worum es geht
- Was man jetzt tun muss
- Bis wann
- Was passiert, wenn man nichts macht

Wenn einer dieser Punkte im Brief nicht vorkommt, dann lass ihn weg.

Schreibe keine langen Erklärungen.
Schreibe keine Hintergrundgeschichte, wenn sie nicht direkt wichtig ist.
Schreibe keine zusätzlichen Beispiele.
Schreibe keine unnötigen Details.

Die Antwort soll im Normalfall kurz bleiben und meistens nicht länger als 5 bis 8 Sätze sein.

Wenn der Brief nur eine Information ist, dann antworte noch kürzer.
Wenn der Brief eine klare Handlung verlangt, dann sag diese Handlung direkt.
Schreibe keine Sätze, die nichts Neues sagen.
Wiederhole Fristen, Unterlagen oder Folgen nicht unnötig.

Du sollst selbst erkennen, was in diesem Brief wirklich wichtig ist.
Zum Beispiel:
- Ist es nur eine Information?
- Muss man etwas tun?
- Gibt es eine Frist?
- Fehlen Unterlagen?
- Muss man antworten, zahlen, erscheinen oder etwas einreichen?
- Kann etwas passieren, wenn man nichts macht?
- Ist der Brief dringend oder eher nur informativ?

Aber:
Sprich nur über diese Punkte, wenn sie wirklich im Brief vorkommen oder klar daraus folgen.
Wenn etwas nicht im Brief steht, erfinde es nicht.
Stelle keine Vermutung oder Interpretation als sichere Hauptaussage dar.
Wenn mehrere Dinge wichtig sind, übertreibe nicht einen einzelnen Punkt.
Wenn etwas nicht ganz eindeutig ist, formuliere vorsichtig und neutral.
Schreibe keine Sätze wie "das ist der wichtigste Punkt", wenn der Brief das nicht klar zeigt.
Wenn ein Termin oder eine Handlung genannt wird, mache daraus nur dann die Hauptaufgabe, wenn das im Brief eindeutig so gemeint ist.
Nenne angeforderte Unterlagen so genau wie möglich.
Vereinfache die Sprache, aber verfälsche nie die Bedeutung.
Wenn im Brief ein genauer Name für ein Dokument steht, dann benutze genau diesen Namen oder eine sehr nahe einfache Form davon.

Nenne nur die Informationen, die für die Person jetzt wirklich wichtig sind.
Lass unwichtige Zusatzinfos weg, auch wenn sie im Brief stehen, wenn sie für das Verstehen oder Handeln keine große Rolle spielen.

Wenn etwas unklar ist:
- Wenn etwas im Brief nicht ganz klar ist, sag offen, dass es nicht ganz klar ist.
- Wenn etwas auf dem Bild nicht gut lesbar ist, sag offen, dass ein Teil nicht gut lesbar ist.
- Wenn ein wichtiger Teil fehlt, sag offen, dass ein wichtiger Teil fehlt.

Wenn es hilfreich ist:
Du darfst am Ende 1 bis 2 kurze praktische Tipps geben.
Aber nur, wenn sie direkt zu diesem Brief passen und wirklich helfen.
Die Tipps sollen helfen, Fehler zu vermeiden oder den nächsten Schritt leichter zu machen.
Keine allgemeinen Lebensratschläge.
Keine erfundenen rechtlichen Aussagen.
Keine Tipps, die nicht wirklich zu diesem Brief passen.
Wenn keine sinnvollen Tipps passen, dann gib keine Tipps.

Bevor du antwortest, prüfe still für dich:
- Habe ich in der Übersetzung eine Handlung zu eindeutig oder zu streng formuliert?
- Bin ich in Türkisch, Bulgarisch oder Arabisch näher an der echten Bedeutung geblieben als an einer freien Nacherzählung?
- Habe ich einen Punkt zu stark betont, obwohl der Brief mehrere wichtige Punkte enthält?
- Habe ich etwas als sicher dargestellt, das nur wahrscheinlich oder nicht ganz eindeutig ist?
- Ist die Antwort kürzer möglich, ohne wichtige Bedeutung zu verlieren?
- Ist ein Satz doppelt?
- Ist etwas unnötig lang?
- Klingt die Sprache natürlich?
- Ist die Übersetzung sinngenau und menschlich?
Dann antworte in der besseren, kürzeren und natürlicheren Version.
- Habe ich einen Punkt zu stark betont, obwohl der Brief mehrere wichtige Punkte enthält?
- Habe ich etwas als sicher dargestellt, das nur wahrscheinlich oder nicht ganz eindeutig ist?

Ganz am Ende:
Schreibe immer einen einzigen kurzen Abschlusssatz.
Wenn in diesem Brief aktiv etwas getan werden muss, beginne den letzten Satz sinngemäß mit:
"Du musst jetzt nur ..."
Wenn in diesem Brief nichts aktiv getan werden muss, dann schreibe stattdessen einen kurzen klaren Satz, dass es nur eine Information ist.

${contentRef}
`;
}

app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;
    const lang = (req.body.lang || "de").toLowerCase();

    if (!text || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Kein Brieftext gesendet"
      });
    }

    const langMeta = getLanguageMeta(lang);

    const prompt = buildUniversalPrompt({
      langMeta,
      sourceType: "diesen Brief",
      contentRef: `Brief:\n${text}`
    });

    const raw = await callGemini([{ text: prompt }]);
    const erklaerung = cleanAntwort(raw);

    return res.json({
      ok: true,
      erklaerung
    });
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
    const bilder = req.body.bilder;
    const lang = (req.body.lang || "de").toLowerCase();

    if (!Array.isArray(bilder) || bilder.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Kein Bild gesendet"
      });
    }

    const langMeta = getLanguageMeta(lang);

    const prompt = buildUniversalPrompt({
      langMeta,
      sourceType: "die Bilder dieses Briefes",
      contentRef: "Bilder:"
    });

    const parts = [{ text: prompt }];

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
    const erklaerung = cleanAntwort(raw);

    return res.json({
      ok: true,
      erklaerung
    });
  } catch (error) {
    console.error("Fehler /api/brief-bild:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Serverfehler"
    });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
