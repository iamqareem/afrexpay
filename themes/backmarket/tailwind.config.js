/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#1A1A1A",
        surface: "#FFFFFF",
        surface2: "#F7F7F8",
        paper: "#1A1A1A",
        gold: "#00AB84",
        brick: "#007A5E",
        muted: "#6B6B6B",
        accent: "#00AB84",
        accent2: "#007A5E",
      },
      fontFamily: {
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"SF Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
