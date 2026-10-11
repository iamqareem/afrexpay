/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#141414",
        surface: "#1c1c1e",
        surface2: "#242426",
        paper: "#f2f2f0",
        accent: "var(--accent, #4C5FD5)",
        accent2: "var(--accent2, #F4A340)",
        muted: "#8a8a8e",
      },
      fontFamily: { display: ["Georgia", "serif"], body: ["-apple-system", "Helvetica Neue", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
};
