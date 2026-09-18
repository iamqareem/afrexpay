/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        // Exact Yeezy colors from their CSS
        ink: "#000000",
        surface: "#FFFFFF",
        surface2: "#F5F5F5",
        paper: "#000000",
        gold: "#000000",
        brick: "#8A8A8A",
        muted: "#000000b3",
        // Additional Yeezy colors
        'yeezy-bg': '#fff',
        'yeezy-primary': '#000',
        'yeezy-secondary': '#000000b3',
        'yeezy-border': '#0000001f',
        'yeezy-overlay': '#000000a6',
        'yeezy-hover': '#0000000a',
      },
      fontFamily: {
        display: ['"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
        body: ['"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.03em",
        widest2: "0.15em",
      },
    },
  },
  plugins: [],
};
