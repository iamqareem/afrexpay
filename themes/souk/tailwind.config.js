/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#171008",
        surface: "#221709",
        surface2: "#2E2010",
        paper: "#F5EFE3",
        gold: "var(--accent, #C9963C)",
        brick: "var(--accent2, #8A4B2A)",
        muted: "#A89B85",
      },
      fontFamily: {
        display: ["Georgia", '"Times New Roman"', "serif"],
        body: ["Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.03em",
        widest2: "0.22em",
      },
    },
  },
  plugins: [],
};
