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

// Single canonical zero-decimal set, shared by every provider and every
// display path. Stripe and PayPal publish the same list:
// Stripe: https://docs.stripe.com/currencies#zero-decimal
// PayPal: https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies/
// Notably KES/TZS/NGN/GHS/ZAR are DECIMAL on both — an earlier revision of
// this file wrongly listed NGN/GHS (and KES/TZS) as zero-decimal.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

function isZeroDecimal(code) {
  return ZERO_DECIMAL_CURRENCIES.has(String(code || "").toUpperCase());
}

function formatPrice(priceMinor, currency = "USD") {
  const code = String(currency).toUpperCase();
  const minor = Number(priceMinor) || 0;

  if (isZeroDecimal(code)) {
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
  ZERO_DECIMAL_CURRENCIES,
  isZeroDecimal,
  resolveCurrencyByCountry,
  detectCurrencyFromRequest,
  formatPrice,
};
