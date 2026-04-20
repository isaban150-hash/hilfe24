const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.json({ ok: true, message: "Server laeuft sauber" });
});

app.post("/api/brief", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text) {
      return res.status(400).json({ error: "Kein Text gesendet" });
    }

    const antwort = `Erklaerung:

Das Jobcenter sagt:
- Deine Unterlagen wurden geprueft
- Es fehlen noch:
  - Kontoauszuege der letzten 3 Monate
  - Mietvertrag

Was du tun musst:
Reiche die Unterlagen bis spaetestens 30.04.2026 ein.

Wenn du nichts schickst:
Dein Antrag kann nicht weiter bearbeitet werden.`;

    res.json({ result: antwort });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server Fehler" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server laeuft auf Port " + PORT);
});
