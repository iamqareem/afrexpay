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

test("newer toasts survive older timers", async () => {
  const a = adminApp();
  a.showToast("first", "ok");
  await new Promise((r) => setTimeout(r, 50));
  a.showToast("second", "error");
  assert.strictEqual(a.toast.message, "second");
  // Wait past the first toast's full lifetime: only its own timer fired.
  await new Promise((r) => setTimeout(r, 3100));
  assert.strictEqual(a.toast, null);
});

test("formatBookingTime never renders Invalid Date", () => {
  const a = adminApp();
  assert.strictEqual(a.formatBookingTime("garbage"), "garbage");
  assert.strictEqual(a.formatBookingTime(null), null);
  const good = a.formatBookingTime('["2026-10-04T10:00:00Z",)');
  assert.ok(!good.includes("Invalid Date"), good);
});

test("saveWeeklyHours rejects half-filled days with a named error", async () => {
  const a = adminApp();
  let fetched = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetched = true;
    return { ok: true, json: async () => ({}) };
  };
  try {
    a.weeklyHours[1] = { startTime: "09:00", endTime: "" }; // Monday half set
    await a.saveWeeklyHours();
    assert.strictEqual(fetched, false, "must not save a half-filled day");
    assert.strictEqual(a.hoursSaving, false);
    assert.ok(a.toast && a.toast.kind === "error", "must explain which day");
    assert.ok(a.toast.message.includes("Monday"), a.toast.message);
  } finally {
    global.fetch = originalFetch;
  }
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

test("failed registry/config loads latch an error state instead of looping", async () => {
  const { adminApp } = require("../admin/js/app.js");
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  try {
    const a = adminApp();
    await a.loadConfig();
    assert.strictEqual(a.bootstrapFailed, true);
    assert.strictEqual(a.homeLoading(), false, "must not skeleton-loop on boot failure");

    const b = adminApp();
    await b.loadVerticals();
    assert.strictEqual(b.bootstrapFailed, true);
    assert.strictEqual(b.homeLoading(), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("retryBootstrap re-arms skeletons and re-latches while broken", async () => {
  const { adminApp } = require("../admin/js/app.js");
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  try {
    const a = adminApp();
    a.verticals = {};
    await a.retryBootstrap();
    assert.strictEqual(a.bootstrapFailed, true, "still broken → latched again, not looping");
    assert.strictEqual(a.loading.products, false, "loaders settle even on failure");
  } finally {
    global.fetch = originalFetch;
  }
});
