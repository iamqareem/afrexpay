/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#14120F",
        surface: "#1E1B17",
        surface2: "#26221D",
        paper: "#F1ECE1",
        gold: "var(--accent, #D9A441)",
        brick: "var(--accent2, #B23A2E)",
        muted: "#8C8577",
      },
      fontFamily: {
        display: ['"Arial Black"', "Helvetica Neue", "Arial", "sans-serif"],
        body: ["Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        widest2: "0.25em",
      },
    },
  },
  plugins: [],
};
