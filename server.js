const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server läuft");
});

app.get("/test", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: "Sag mir Hallo auf Deutsch" }],
            },
          ],
        }),
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Fehler bei Gemini" });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
