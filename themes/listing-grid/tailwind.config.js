/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink, #1a1a18)",
        surface: "var(--surface, #232320)",
        surface2: "var(--surface2, #2c2c28)",
        paper: "var(--paper, #f5f3ee)",
        accent: "var(--accent, #3A7D5C)",
        accent2: "var(--accent2, #E8A0A0)",
        muted: "var(--muted, #9b9890)",
        onaccent: "var(--on-accent, #1a1a18)",
      },
      fontFamily: { display: ["Georgia", "serif"], body: ["-apple-system", "Helvetica Neue", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
};
