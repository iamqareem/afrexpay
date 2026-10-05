// tests/theme-contracts.test.js
//
// Storefront source tripwires: reintroducing a forged-paid banner, a fake
// price, or wiping slot selection on non-409 errors fails here. These assert
// on source shape (no DOM harness exists for themes); behavior is covered
// by review + the status-endpoint tests.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function themeSrc(relative) {
  return fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
}

test("no theme trusts ?paid=1 for the paid banner", () => {
  const files = [
    "themes/hangtag/js/app.js",
    "themes/backmarket/js/app.js",
    "themes/souk/js/app.js",
    "themes/automobile/js/app.js",
    "themes/electronics/js/app.js",
    "themes/yeezy/js/app.js",
    "themes/booking-slots/js/app.js",
    "themes/resort/js/app.js",
    "themes/listing-grid/js/app.js",
  ];
  for (const f of files) {
    const src = themeSrc(f);
    assert.ok(!src.includes('get("paid")'), `${f} must not read the paid query param`);
    assert.ok(src.includes("/status"), `${f} must verify against the status endpoint`);
  }
});

test("backmarket shows the merchant price, never an invented was-price", () => {
  const src = themeSrc("themes/backmarket/js/app.js");
  assert.ok(!src.includes("Math.random"), "no randomized pricing");
  assert.ok(!src.includes("originalPrice"), "no invented original price");
});

test("resort and booking-slots refresh slots on 409 only", () => {
  for (const f of ["themes/resort/js/app.js", "themes/booking-slots/js/app.js"]) {
    assert.ok(themeSrc(f).includes("failedStatus === 409"), `${f} must scope slot refresh to conflicts`);
  }
});

test("new-listings prices in per-listing currency", () => {
  const grid = themeSrc("themes/new-listings/js/components/ListingGrid.js");
  assert.ok(grid.includes("l.currency ||"), "grid must prefer the listing currency");
  const detail = themeSrc("themes/new-listings/js/components/DetailView.js");
  assert.ok(detail.includes("l.currency ||"), "detail must prefer the listing currency");
});

test("booking/inquiry submits guard against double-click", () => {
  for (const f of [
    "themes/booking-slots/js/app.js",
    "themes/resort/js/app.js",
    "themes/listing-grid/js/app.js",
    "themes/new-listings/js/components/InquiryForm.js",
  ]) {
    assert.ok(themeSrc(f).includes('disabled = true'), `${f} must disable submit while sending`);
  }
});

test("slot date defaults use local time, not UTC", () => {
  for (const f of ["themes/booking-slots/js/app.js", "themes/resort/js/app.js"]) {
    assert.ok(!themeSrc(f).includes("toISOString().slice(0, 10)"), `${f} must not default to the UTC date`);
  }
});
