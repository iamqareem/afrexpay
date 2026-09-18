/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        surface: "#FFFFFF",
        surfaceVariant: "#F3F4F6", // Gray 100
        onSurface: "#1F2937", // Gray 800
        onSurfaceVariant: "#6B7280", // Gray 500
        primary: "var(--accent, #2563EB)", // Blue 600
        onPrimary: "#FFFFFF",
      },
      fontFamily: {
        sans: ["-apple-system", "system-ui", "Helvetica Neue", "Arial", "sans-serif"],
      },
      borderRadius: {
        '4xl': '2rem',
        'full': '9999px',
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        'float': '0 10px 40px -4px rgba(0, 0, 0, 0.1)',
      }
    },
  },
  plugins: [],
};
