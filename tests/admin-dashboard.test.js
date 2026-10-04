// tests/admin-dashboard.test.js
//
// Regression guards for the Tier-3 dashboard fixes. adminApp() is DOM-free
// for these paths (location access is try/caught inside setTab).
const { test } = require("node:test");
const assert = require("node:assert");
const { adminApp } = require("../admin/js/app.js");

const VERTICALS = {
  products: { dashboardTabs: ["products", "orders"] },
  services: { dashboardTabs: ["services", "availability", "bookings"] },
  listings: { dashboardTabs: ["listings", "inquiries", "reservations"] },
};

test("money() renders missing amounts as em dash, real zero as zero", () => {
  const a = adminApp();
  assert.strictEqual(a.money(null, "UGX"), "—");
  assert.strictEqual(a.money(undefined, "UGX"), "—");
  assert.strictEqual(a.money("", "UGX"), "—");
  assert.strictEqual(a.money(0, "UGX"), "UGX 0");
  assert.ok(a.money(5000, "UGX").includes("5,000"));
});

test("setTab bounces hidden vertical tabs home once the registry is loaded", () => {
  const a = adminApp();
  a.verticals = VERTICALS;
  a.config = { vertical: "listings" };
  a.setTab("orders"); // products-vertical tab on a listings store
  assert.strictEqual(a.tab, "home");
  a.setTab("inquiries");
  assert.strictEqual(a.tab, "inquiries");
  a.setTab("payments"); // always-visible tabs never bounce
  assert.strictEqual(a.tab, "payments");
});

test("setTab does not bounce before the registry loads (first paint)", () => {
  const a = adminApp();
  a.verticals = {};
  a.setTab("orders");
  assert.strictEqual(a.tab, "orders");
});

test("exceptionIsOpen treats string 'false' as closed", () => {
  const a = adminApp();
  a.exceptionForm.isAvailable = false;
  assert.strictEqual(a.exceptionIsOpen(), false);
  a.exceptionForm.isAvailable = "false"; // what the select actually yields
  assert.strictEqual(a.exceptionIsOpen(), false);
  a.exceptionForm.isAvailable = "true";
  assert.strictEqual(a.exceptionIsOpen(), true);
  a.exceptionForm.isAvailable = true;
  assert.strictEqual(a.exceptionIsOpen(), true);
});

test("markSkippedVerticalsDone clears only hidden verticals", () => {
  const a = adminApp();
  a.verticals = VERTICALS;
  a.config = { vertical: "listings" };
  a.markSkippedVerticalsDone();
  assert.strictEqual(a.loading.services, false);
  assert.strictEqual(a.loading.bookings, false);
  assert.strictEqual(a.loading.listings, true); // visible → untouched
  assert.strictEqual(a.loading.inquiries, true);
});
