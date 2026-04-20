const express = require("express");
const cors = require("cors");

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server läuft auf Port " + PORT);
});
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
