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

test("soko uses per-row currency, escaper, and QR footer", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const js = fs.readFileSync(path.join(__dirname, "..", "themes/soko/js/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "themes/soko/index.html"), "utf8");
  assert.ok(js.includes("money(p.price_minor, p.currency)"), "feed prices per-row currency");
  assert.ok(js.includes("function esc("), "escaper defined");
  assert.ok(html.includes('/qr.svg'), "footer QR present");
  assert.ok(html.includes('id="track-timeline"'), "track view present");
  assert.ok(!js.includes('get("paid")'), "no paid-param trust");
});

test("shared checkout component defines each function exactly once", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "public/js/afrexpay-checkout.js"), "utf8");
  for (const fn of ["function startCheckout", "function render("]) {
    assert.strictEqual(src.split(fn).length - 1, 1, `${fn} must exist exactly once`);
  }
  assert.ok(!src.includes("function getAvailableMethods"), "dead first-copy definition must be gone");
});

test("no theme trusts ?paid=1 for the paid banner", () => {
  const files = [
    "themes/soko/js/app.js",
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

test("souk light/dark follows the listing-grid mechanism", () => {
  const js = themeSrc("themes/souk/js/app.js");
  const html = themeSrc("themes/souk/index.html");
  const css = themeSrc("themes/souk/src/input.css");
  const config = themeSrc("themes/souk/tailwind.config.js");
  assert.ok(html.includes('id="theme-toggle"'), "header toggle present");
  assert.ok(html.includes('id="theme-toggle-icon"'), "toggle icon present");
  assert.ok(js.includes("function initTheme("), "initTheme defined");
  assert.ok(js.includes('localStorage.getItem("theme")'), "shared theme key");
  assert.ok(js.includes('setAttribute("data-theme"'), "data-theme switch");
  assert.ok(css.includes('[data-theme="light"]'), "light override block");
  assert.ok(config.includes("var(--ink,"), "palette rides CSS vars");
  assert.ok(!/ink:\s*"#[0-9a-fA-F]{3,8}"/.test(config), "no static hex surface colors left");
});

test("souk hero cascade + spotlight are generic (no client hardcodes)", () => {
  const js = themeSrc("themes/souk/js/app.js");
  const html = themeSrc("themes/souk/index.html");
  assert.ok(!/heena/i.test(js + html), "no client category string in souk source");
  assert.ok(js.includes("spotlightCategory"), "spotlight pinned via merchant config");
  assert.ok(js.includes("heroImageUrl"), "hero override via merchant config");
  assert.ok(html.includes('id="hero-image"'), "hero image slot present");
  assert.ok(html.includes('id="spotlight-rail"'), "spotlight rail present");
  assert.ok(html.includes('id="spotlight-all"'), "spotlight shop-all present");
  assert.ok(js.includes("souk-rail") || themeSrc("themes/souk/src/input.css").includes("souk-rail"), "rail styling present");
  assert.ok(html.includes("souk-chips-bar"), "sticky chips bar present");
  assert.ok(js.includes("category"), "deep-linkable ?category= supported");
});

test("souk hero is image-left/text-right on desktop, stacked on mobile", () => {
  const html = themeSrc("themes/souk/index.html");
  const imgPos = html.indexOf('id="hero-image"');
  const textPos = html.indexOf('id="hero-line1"');
  assert.ok(imgPos !== -1 && textPos !== -1 && imgPos < textPos, "hero image must precede hero text in DOM");
  assert.ok(html.includes("md:flex-row"), "side-by-side row from tablet/desktop up");
  assert.ok(html.includes("flex-col"), "stacked column on mobile");
  assert.ok(html.includes("aspect-[4/3]"), "hero image has a fixed aspect so it cannot overlap text");
});
