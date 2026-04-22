function getLanguageMeta(lang) {
  switch ((lang || "de").toLowerCase()) {
    case "tr":
      return {
        code: "tr",
        label: "Türkisch",
        instruction: `
Schreibe auf natürlichem, leicht verständlichem Türkisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an den vorgegebenen Informationen.
Ändere keine Bedeutung.
Formuliere vorsichtig.
Mache aus Zielen, Planungen oder Unterstützungsangeboten keine festen Pflichten.
Wenn etwas im Deutschen neutral formuliert ist, muss es auch im Türkischen neutral bleiben.
Wenn etwas nicht sicher ist, darf es nicht als sichere Tatsache erscheinen.
Vermeide im Türkischen unnötig harte Pflichtwörter wie "gerekmektedir", "zorundadır", "mutlaka", wenn die Information nicht eindeutig eine Pflicht ist.
Wenn etwas nur geplant, besprochen oder vorgesehen ist, formuliere weicher und natürlicher.
`
      };
    case "bg":
      return {
        code: "bg",
        label: "Bulgarisch",
        instruction: `
Schreibe auf natürlichem, leicht verständlichem Bulgarisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an den vorgegebenen Informationen.
`
      };
    case "ar":
      return {
        code: "ar",
        label: "Arabisch",
        instruction: `
Schreibe auf natürlichem, leicht verständlichem Arabisch.
Nicht wörtlich.
Nicht steif.
Nicht wie Google Translate.
Bleibe sehr nah an den vorgegebenen Informationen.
`
      };
    default:
      return {
        code: "de",
        label: "Deutsch",
        instruction: `
Schreibe auf natürlichem, einfachem Deutsch.
`
      };
  }
}
