const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  VERTICALS,
  VALID_VERTICALS,
  DEFAULT_VERTICAL,
  resolveVertical,
  THEMES_REGISTRY,
  getThemesForVertical,
  isThemeCompatible,
  getThemeDetails,
} = require("../src/verticals");

test("VERTICALS contains known business shapes", () => {
  assert.ok(VALID_VERTICALS.has("products"));
  assert.ok(VALID_VERTICALS.has("services"));
  assert.ok(VALID_VERTICALS.has("listings"));
});

test("resolveVertical returns valid vertical or fallback default", () => {
  assert.equal(resolveVertical("products"), "products");
  assert.equal(resolveVertical("services"), "services");
  assert.equal(resolveVertical("listings"), "listings");
  assert.equal(resolveVertical("unknown_shape"), DEFAULT_VERTICAL);
});

test("getThemesForVertical returns themes compatible with the given vertical", () => {
  const productThemes = getThemesForVertical("products");
  const serviceThemes = getThemesForVertical("services");
  const listingThemes = getThemesForVertical("listings");

  assert.ok(productThemes.some((t) => t.id === "hangtag"));
  assert.ok(productThemes.some((t) => t.id === "electronics"));
  assert.ok(productThemes.some((t) => t.id === "yeezy"));
  assert.ok(productThemes.some((t) => t.id === "backmarket"));
  assert.ok(productThemes.some((t) => t.id === "automobile"));

  assert.ok(serviceThemes.some((t) => t.id === "booking-slots"));
  assert.ok(serviceThemes.some((t) => t.id === "resort"));
  assert.ok(listingThemes.some((t) => t.id === "listing-grid"));
});

test("isThemeCompatible validates theme and vertical pairing", () => {
  assert.equal(isThemeCompatible("products", "hangtag"), true);
  assert.equal(isThemeCompatible("products", "electronics"), true);
  assert.equal(isThemeCompatible("products", "booking-slots"), false);

  assert.equal(isThemeCompatible("services", "booking-slots"), true);
  assert.equal(isThemeCompatible("services", "resort"), true);
  assert.equal(isThemeCompatible("services", "hangtag"), false);

  assert.equal(isThemeCompatible("listings", "listing-grid"), true);
  assert.equal(isThemeCompatible("listings", "electronics"), false);
});

test("getThemeDetails returns metadata for a given theme slug", () => {
  const details = getThemeDetails("electronics");
  assert.ok(details);
  assert.equal(details.id, "electronics");
  assert.equal(details.vertical, "products");
  assert.ok(details.subCategory);
});
