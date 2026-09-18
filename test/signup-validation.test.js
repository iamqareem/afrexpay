const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isThemeCompatible, VALID_VERTICALS } = require("../src/verticals");
const { validatePassword } = require("../src/lib/password-validator");

test("Signup payload vertical and theme validation logic", () => {
  const validPayload = {
    businessName: "Tech Hub",
    subdomain: "tech-hub",
    email: "owner@techhub.com",
    password: "Password123!",
    vertical: "products",
    themeSlug: "electronics",
  };

  assert.ok(VALID_VERTICALS.has(validPayload.vertical));
  assert.ok(isThemeCompatible(validPayload.vertical, validPayload.themeSlug));

  const invalidThemePayload = {
    ...validPayload,
    vertical: "services",
    themeSlug: "electronics",
  };
  assert.equal(isThemeCompatible(invalidThemePayload.vertical, invalidThemePayload.themeSlug), false);
});

test("Password strength and similarity validation rules", () => {
  const meta = {
    businessName: "Soko Shop",
    subdomain: "soko-shop",
    email: "owner@afrexpay.com",
  };

  // Weak password checks
  assert.equal(validatePassword("short", meta).valid, false);
  assert.equal(validatePassword("alllowercase123!", meta).valid, false);
  assert.equal(validatePassword("ALLUPPERCASE123!", meta).valid, false);
  assert.equal(validatePassword("NoDigitsSpecial", meta).valid, false);
  assert.equal(validatePassword("NoSpecialSymbol123", meta).valid, false);

  // Business name / subdomain / email similarity checks
  assert.equal(validatePassword("SokoShop123!", meta).valid, false);
  assert.equal(validatePassword("MySoko-Shop123!", meta).valid, false);
  assert.equal(validatePassword("OwnerAccount123!", meta).valid, false);

  // Valid password
  const validResult = validatePassword("Str0ngP@ssword2026", meta);
  assert.equal(validResult.valid, true);
});
