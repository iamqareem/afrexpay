// tests/password-validator.test.js — strength + identity-similarity rules.
// Also pins the reset-parity contract: with no identity metadata (the
// reset-password context), strength rules still apply — length alone is
// never enough.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validatePassword } = require("../src/lib/password-validator");

test("rejects missing, non-string, and short passwords", () => {
  assert.equal(validatePassword("", {}).valid, false);
  assert.equal(validatePassword(null, {}).valid, false);
  assert.equal(validatePassword(12345, {}).valid, false);
  const short = validatePassword("Aa1!", {});
  assert.equal(short.valid, false);
  assert.match(short.error, /8 characters/);
});

test("rejects passwords missing a character class", () => {
  assert.match(validatePassword("alllowercase123!", {}).error, /uppercase/);
  assert.match(validatePassword("ALLUPPERCASE123!", {}).error, /lowercase/);
  assert.match(validatePassword("NoDigitsHere!!", {}).error, /number/);
  assert.match(validatePassword("NoSymbol1234", {}).error, /special symbol/);
});

test("rejects passwords containing business identity", () => {
  const meta = { businessName: "Soko Shop", subdomain: "soko-shop", email: "owner@afrexpay.com" };
  assert.match(validatePassword("SokoShop123!", meta).error, /business name/);
  assert.match(validatePassword("Mysoko-shop123!", meta).error, /business name|subdomain/);
  assert.match(validatePassword("OwnerAccount123!", meta).error, /email username/);
  // Short identity fragments (< 3 chars after normalize) are ignored.
  assert.equal(validatePassword("Str0ngP@ssword2026", meta).valid, true);
});

test("reset context (no metadata): strength still enforced, not just length", () => {
  // These all clear the old length-only reset check but must still fail.
  assert.equal(validatePassword("longenough1", {}).valid, false); // no upper/symbol
  assert.equal(validatePassword("alllowercase123!", {}).valid, false); // no upper
  assert.equal(validatePassword("ALLUPPERCASE123!", {}).valid, false); // no lower
  assert.equal(validatePassword("Str0ngP@ssword2026", {}).valid, true);
});

test("accepts a strong, unrelated password", () => {
  const result = validatePassword("Str0ngP@ssword2026", {
    businessName: "Kampala Tech",
    subdomain: "kampala-tech",
    email: "owner@store.com",
  });
  assert.equal(result.valid, true);
});
