/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        surface: "#1e293b",
        surface2: "#334155",
        paper: "#f8fafc",
        gold: "var(--accent, #38bdf8)",
        brick: "var(--accent2, #f43f5e)",
        muted: "#94a3b8",
      },
      fontFamily: {
        display: ["Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
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
