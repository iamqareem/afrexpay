// tests/verticals.test.js — registry shape, resolution, theme compatibility.
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

test("registry covers all three verticals with non-empty tabs and themes", () => {
  for (const key of ["products", "services", "listings"]) {
    assert.ok(VALID_VERTICALS.has(key), key);
    assert.ok(VERTICALS[key].dashboardTabs.length > 0, `${key} tabs`);
    assert.ok(VERTICALS[key].compatibleThemes.length > 0, `${key} themes`);
  }
  assert.equal(DEFAULT_VERTICAL, "products");
});

test("every compatible theme exists in the registry with matching vertical", () => {
  for (const [vertical, entry] of Object.entries(VERTICALS)) {
    for (const themeId of entry.compatibleThemes) {
      const theme = THEMES_REGISTRY[themeId];
      assert.ok(theme, `theme ${themeId} registered`);
      assert.equal(theme.vertical, vertical);
      assert.ok(theme.label && theme.description, `theme ${themeId} has copy`);
    }
  }
});

test("resolveVertical falls back to default for unknown input", () => {
  assert.equal(resolveVertical("services"), "services");
  assert.equal(resolveVertical("nope"), DEFAULT_VERTICAL);
  assert.equal(resolveVertical(undefined), DEFAULT_VERTICAL);
  assert.equal(resolveVertical(null), DEFAULT_VERTICAL);
  assert.equal(resolveVertical(""), DEFAULT_VERTICAL);
});

test("getThemesForVertical returns the right sets", () => {
  const ids = (v) => getThemesForVertical(v).map((t) => t.id);
  assert.ok(ids("products").includes("hangtag"));
  assert.ok(ids("services").includes("booking-slots"));
  assert.ok(ids("services").includes("resort"));
  assert.ok(ids("listings").includes("listing-grid"));
  assert.deepEqual(ids("unknown-vertical"), ids("products"));
});

test("isThemeCompatible guards vertical/theme pairing", () => {
  assert.equal(isThemeCompatible("products", "hangtag"), true);
  assert.equal(isThemeCompatible("services", "resort"), true);
  assert.equal(isThemeCompatible("services", "hangtag"), false);
  assert.equal(isThemeCompatible("products", "resort"), false);
  assert.equal(isThemeCompatible("products", "no-such-theme"), false);
  assert.equal(isThemeCompatible("products", null), false);
});

test("getThemeDetails falls back to hangtag for unknown slugs", () => {
  assert.equal(getThemeDetails("resort").id, "resort");
  assert.equal(getThemeDetails("no-such-theme").id, "hangtag");
});
