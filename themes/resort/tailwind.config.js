/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#0d1b1a",
        surface: "#122625",
        surface2: "#1c3532",
        paper: "#f6f1e5",
        sand: "#e9dfc9",
        accent: "var(--accent, #c9a227)",
        accent2: "var(--accent2, #2a9d8f)",
        muted: "#93a8a3",
      },
      fontFamily: { display: ["Georgia", "serif"], body: ["-apple-system", "Helvetica Neue", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
};
