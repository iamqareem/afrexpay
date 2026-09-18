const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveCurrencyByCountry, SUPPORTED_CURRENCIES, formatPrice } = require("../src/lib/currency");

test("SUPPORTED_CURRENCIES list covers global major currencies", () => {
  assert.ok(SUPPORTED_CURRENCIES.includes("USD"));
  assert.ok(SUPPORTED_CURRENCIES.includes("EUR"));
  assert.ok(SUPPORTED_CURRENCIES.includes("GBP"));
  assert.ok(SUPPORTED_CURRENCIES.includes("CAD"));
  assert.ok(SUPPORTED_CURRENCIES.includes("AUD"));
  assert.ok(SUPPORTED_CURRENCIES.includes("UGX"));
  assert.ok(SUPPORTED_CURRENCIES.includes("KES"));
  assert.ok(SUPPORTED_CURRENCIES.includes("NGN"));
});

test("resolveCurrencyByCountry maps country codes to default currencies", () => {
  assert.equal(resolveCurrencyByCountry("US"), "USD");
  assert.equal(resolveCurrencyByCountry("GB"), "GBP");
  assert.equal(resolveCurrencyByCountry("DE"), "EUR");
  assert.equal(resolveCurrencyByCountry("FR"), "EUR");
  assert.equal(resolveCurrencyByCountry("CA"), "CAD");
  assert.equal(resolveCurrencyByCountry("AU"), "AUD");
  assert.equal(resolveCurrencyByCountry("UG"), "UGX");
  assert.equal(resolveCurrencyByCountry("KE"), "KES");
  assert.equal(resolveCurrencyByCountry("NG"), "NGN");
  assert.equal(resolveCurrencyByCountry("UNKNOWN"), "USD"); // Default fallback
});

test("formatPrice correctly formats amounts with standard symbols", () => {
  assert.equal(formatPrice(45000, "UGX"), "UGX 45,000");
  assert.equal(formatPrice(1999, "USD"), "$19.99");
  assert.equal(formatPrice(2500, "EUR"), "€25.00");
  assert.equal(formatPrice(1550, "GBP"), "£15.50");
});
