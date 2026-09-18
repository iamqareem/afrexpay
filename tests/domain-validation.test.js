// tests/domain-validation.test.js — custom-domain eligibility (pure).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isValidDomain } = require("../src/modules/domains/domain.service");

const BASE = process.env.BASE_DOMAIN || "afrexpay.com";

test("accepts ordinary external domains, case-insensitively", () => {
  assert.equal(isValidDomain("shop.example.com"), true);
  assert.equal(isValidDomain("SHOP.EXAMPLE.COM"), true);
  assert.equal(isValidDomain("  shop.example.com  "), true);
  assert.equal(isValidDomain("my-hotel.co.ug"), true);
});

test("rejects the platform's own namespace", () => {
  assert.equal(isValidDomain(BASE), false);
  assert.equal(isValidDomain(`www.${BASE}`), false);
  assert.equal(isValidDomain(`shop.${BASE}`), false);
  assert.equal(isValidDomain(`deep.shop.${BASE}`), false);
});

test("rejects garbage and non-hostname input", () => {
  assert.equal(isValidDomain(""), false);
  assert.equal(isValidDomain(null), false);
  assert.equal(isValidDomain(undefined), false);
  assert.equal(isValidDomain(123), false);
  assert.equal(isValidDomain("not a domain"), false);
  assert.equal(isValidDomain("singlelabel"), false);
  assert.equal(isValidDomain("https://shop.example.com"), false);
});
