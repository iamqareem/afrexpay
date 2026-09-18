// tests/currency.test.js — currency resolution, request detection, formatting.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SUPPORTED_CURRENCIES,
  resolveCurrencyByCountry,
  detectCurrencyFromRequest,
  formatPrice,
} = require("../src/lib/currency");

test("resolveCurrencyByCountry handles case, whitespace, and fallbacks", () => {
  assert.equal(resolveCurrencyByCountry("ug"), "UGX");
  assert.equal(resolveCurrencyByCountry("  KE "), "KES");
  assert.equal(resolveCurrencyByCountry("xx"), "USD");
  assert.equal(resolveCurrencyByCountry(""), "USD");
  assert.equal(resolveCurrencyByCountry(null), "USD");
  assert.equal(resolveCurrencyByCountry(undefined), "USD");
});

test("detectCurrencyFromRequest reads geo headers in priority order", () => {
  assert.equal(detectCurrencyFromRequest({ headers: { "cf-ipcountry": "UG" } }), "UGX");
  assert.equal(detectCurrencyFromRequest({ headers: { "x-vercel-ip-country": "NG" } }), "NGN");
  assert.equal(detectCurrencyFromRequest({ headers: { "x-country-code": "JP" } }), "JPY");
  assert.equal(detectCurrencyFromRequest({ headers: { "x-geo-country": "GH" } }), "GHS");
  assert.equal(detectCurrencyFromRequest({ headers: {} }), "USD");
  assert.equal(detectCurrencyFromRequest(null), "USD");
  assert.equal(detectCurrencyFromRequest({}), "USD");
});

test("formatPrice renders zero-decimal currencies without fractions", () => {
  assert.equal(formatPrice(45000, "UGX"), "UGX 45,000");
  assert.equal(formatPrice(1000, "JPY"), "JPY 1,000");
  assert.equal(formatPrice(5000, "KES"), "KES 5,000");
  assert.equal(formatPrice(2500, "NGN"), "NGN 2,500");
});

test("formatPrice renders decimal currencies with symbols", () => {
  assert.equal(formatPrice(1999, "USD"), "$19.99");
  assert.equal(formatPrice(2500, "EUR"), "€25.00");
  assert.equal(formatPrice(1550, "GBP"), "£15.50");
  assert.equal(formatPrice(2000, "CAD"), "CA$20.00");
  assert.equal(formatPrice(2000, "AUD"), "A$20.00");
});

test("formatPrice falls back gracefully for unknown codes and bad input", () => {
  assert.ok(formatPrice(2000, "XYZ").startsWith("XYZ "));
  assert.equal(formatPrice(0, "USD"), "$0.00");
  assert.equal(formatPrice("abc", "USD"), "$0.00");
  assert.ok(SUPPORTED_CURRENCIES.includes("USD"));
  assert.ok(SUPPORTED_CURRENCIES.includes("UGX"));
});
