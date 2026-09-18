// src/lib/currency.js
// Multi-currency resolution & region-based currency detection module

const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "AED",
  "UGX", "KES", "TZS", "NGN", "GHS", "ZAR"
];

const COUNTRY_CURRENCY_MAP = {
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  AU: "AUD",
  JP: "JPY",
  AE: "AED",
  DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", IE: "EUR", FI: "EUR", PT: "EUR", GR: "EUR",
  UG: "UGX",
  KE: "KES",
  TZ: "TZS",
  NG: "NGN",
  GH: "GHS",
  ZA: "ZAR",
};

function resolveCurrencyByCountry(countryCode) {
  if (!countryCode) return "USD";
  const code = String(countryCode).toUpperCase().trim();
  return COUNTRY_CURRENCY_MAP[code] || "USD";
}

function detectCurrencyFromRequest(req) {
  if (!req || !req.headers) return "USD";
  const countryHeader =
    req.headers["cf-ipcountry"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["x-country-code"] ||
    req.headers["x-geo-country"];

  if (countryHeader && typeof countryHeader === "string") {
    return resolveCurrencyByCountry(countryHeader);
  }
  return "USD";
}

function formatPrice(priceMinor, currency = "USD") {
  const code = String(currency).toUpperCase();
  const minor = Number(priceMinor) || 0;

  const zeroDecimal = ["UGX", "JPY", "KES", "TZS", "NGN", "GHS"];
  if (zeroDecimal.includes(code)) {
    return `${code} ${Math.round(minor).toLocaleString()}`;
  }

  const units = (minor / 100).toFixed(2);
  const symbols = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    CAD: "CA$",
    AUD: "A$",
    AED: "AED ",
  };

  const symbol = symbols[code] || `${code} `;
  return `${symbol}${Number(units).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

module.exports = {
  SUPPORTED_CURRENCIES,
  COUNTRY_CURRENCY_MAP,
  resolveCurrencyByCountry,
  detectCurrencyFromRequest,
  formatPrice,
};
