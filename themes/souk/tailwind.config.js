/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        // Every surface color rides a CSS var (listing-grid pattern) so
        // [data-theme="light"] can re-skin the theme without a second
        // stylesheet. Fallbacks are the dark luxe defaults, so first paint
        // before any JS runs is pixel-identical to today.
        ink: "var(--ink, #171008)",
        surface: "var(--surface, #221709)",
        surface2: "var(--surface2, #2E2010)",
        paper: "var(--paper, #F5EFE3)",
        gold: "var(--accent, #C9963C)",
        brick: "var(--accent2, #8A4B2A)",
        muted: "var(--muted, #A89B85)",
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
