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
  a.setTab("home"); // home never bounces
  assert.strictEqual(a.tab, "home");
});

test("setTab does not bounce before the registry loads (first paint)", () => {
  const a = adminApp();
  a.verticals = {};
  a.setTab("orders");
  assert.strictEqual(a.tab, "orders");
});

test("legacy settings hashes land on home, where those sections live", () => {
  const a = adminApp();
  a.verticals = {
    products: { dashboardTabs: ["products", "orders"] },
    services: { dashboardTabs: ["services", "availability", "bookings"] },
    listings: { dashboardTabs: ["listings", "inquiries", "reservations"] },
  };
  a.config = { vertical: "listings" };
  for (const legacy of ["config", "payments", "domain"]) {
    a.tab = "home";
    // readTabFromHash path without a DOM: emulate the mapping branch
    a.setTab(legacy);
    assert.strictEqual(a.tab, "home", legacy);
  }
  assert.deepStrictEqual(
    a.tabOrder(),
    ["home", "listings", "inquiries", "reservations"],
    "only home is global now"
  );
  assert.strictEqual(typeof a.scrollToId, "function");
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
test("POS category filter and line-size merge", () => {
  const { adminApp } = require("../admin/js/app.js");
  const a = adminApp();
  a.products = [
    { id: "p1", name: "Shirt", category: "Wear", price_minor: 5, currency: "UGX", sizes: ["S", "M"], stock_qty: 10 },
    { id: "p2", name: "Mug", category: null, price_minor: 3, currency: "UGX", sizes: ["One"], stock_qty: null },
  ];
  assert.deepStrictEqual(a.posCategories(), ["Wear"]);
  assert.strictEqual(a.posMatches().length, 2);
  a.posCategory = "Wear";
  assert.strictEqual(a.posMatches().length, 1);

  a.posPickedSize = { p1: "S" };
  a.posAdd(a.products[0]);
  a.posPickedSize = { p1: "M" };
  a.posAdd(a.products[0]);
  assert.strictEqual(a.posCart.length, 2, "different sizes stay separate lines");
  a.posChangeLineSize(1, "S");
  assert.strictEqual(a.posCart.length, 1, "same size folds together");
  assert.strictEqual(a.posCart[0].qty, 2);
  assert.deepStrictEqual(a.posCart[0].sizes, ["S", "M"]);
});

test("preparePhoto rejects hostile types instantly, before any upload", async () => {
  const a = adminApp();
  const heic = await a.preparePhoto({ name: "img.heic", type: "image/heic", size: 5_000_000 });
  assert.ok(heic.error.includes("HEIC"), `got: ${heic.error}`);
  const pdf = await a.preparePhoto({ name: "doc.pdf", type: "application/pdf", size: 100 });
  assert.ok(pdf.error.includes("JPEG, PNG, or WebP"), `got: ${pdf.error}`);
});

test("preparePhoto passes fitting JPEGs through untouched", async () => {
  const a = adminApp();
  const file = Object.assign(new Blob(["x"], { type: "image/jpeg" }), { name: "a.jpg" });
  const out = await a.preparePhoto(file);
  assert.strictEqual(out.blob, file);
  assert.strictEqual(out.error, undefined);
});

test("preparePhoto fails clean (never throws) when the browser cannot shrink", async () => {
  const a = adminApp();
  // Node has no createImageBitmap — same path as an ancient browser.
  const big = Object.assign(new Blob(["x"], { type: "image/jpeg" }), { name: "big.jpg" });
  Object.defineProperty(big, "size", { value: 5_000_000 });
  const out = await a.preparePhoto(big);
  assert.ok(out.error.includes("smaller file"), `got: ${out.error}`);
});

test("uploadPhotoFiles refuses overlap and empty picks without fetching", async () => {
  const a = adminApp();
  const origFetch = global.fetch;
  let fetched = false;
  global.fetch = async () => { fetched = true; return { ok: true }; };
  try {
    a.uploadingPhotos = true;
    await a.uploadPhotoFiles([Object.assign(new Blob(["x"], { type: "image/jpeg" }), { name: "a.jpg" })], "product", "p1");
    assert.strictEqual(a.toast.kind, "error");
    assert.strictEqual(fetched, false);
    a.uploadingPhotos = false;
    await a.uploadPhotoFiles([], "product", "p1");
    assert.ok(a.toast.message.includes("No image"));
    assert.strictEqual(fetched, false);
  } finally {
    global.fetch = origFetch;
  }
});

test("uploadPhotoFiles preflights, sends prepared blobs, clears progress", async () => {
  const a = adminApp();
  const sent = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => { sent.push(url); return { ok: true }; };
  let reloaded = null;
  a.reloadPhotoList = async (t, id) => { reloaded = [t, id]; };
  try {
    await a.uploadPhotoFiles(
      [
        Object.assign(new Blob(["x"], { type: "image/jpeg" }), { name: "a.jpg" }),
        { name: "b.pdf", type: "application/pdf", size: 100 },
      ],
      "service", "svc-1"
    );
    assert.strictEqual(sent.length, 1, "rejected file must never be sent");
    assert.strictEqual(sent[0], "/api/media");
    assert.deepStrictEqual(reloaded, ["service", "svc-1"]);
    assert.strictEqual(a.uploadingPhotos, false);
    assert.strictEqual(a.uploadProgress, "");
    assert.ok(a.toast.message.includes("Photo uploaded"));
  } finally {
    global.fetch = origFetch;
  }
});

test("home tab collapses rarely-touched sections, shows upload progress", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "admin", "index.html"), "utf8");
  const details = html.match(/<details class="home-details"/g) || [];
  assert.strictEqual(details.length, 3, `expected 3 collapsible sections, found ${details.length}`);
  for (const id of ["store-discovery", "store-payments", "store-domain"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} anchor missing`);
  }
  const progress = html.match(/x-text="uploadProgress"/g) || [];
  assert.strictEqual(progress.length, 3, "each photo manager needs a progress readout");
  const js = fs.readFileSync(path.join(__dirname, "..", "admin", "js", "app.js"), "utf8");
  assert.ok(js.includes('closest("details")'), "scrollToId must open collapsed sections");
  const css = fs.readFileSync(path.join(__dirname, "..", "admin", "css", "style.css"), "utf8");
  assert.ok(css.includes(".home-details"), "collapsible styling missing");
  assert.ok(/stat-value[^}]*1\.15rem/.test(css), "stat values must use the reduced scale");
});
