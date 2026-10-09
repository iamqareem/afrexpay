// tests/discovery.test.js
//
// PR3: machine-readable storefront surface — product feeds (JSON + Google
// Merchant CSV), per-store llms.txt, capability profile, read-only agent
// API shapes. Pure-function pins; the DB-backed fetchers follow the
// existing untested-service pattern (see tenant-currency.test.js stubs).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  toFeedProduct,
  toAgentService,
  toAgentListing,
  buildMerchantCsv,
} = require("../src/modules/discovery/discovery.service");
const { buildTenantLlmsTxt } = require("../src/lib/seo");

const BASE = "https://glow-salon.afrexpay.app";
const tenant = {
  subdomain: "glow-salon",
  business_name: "Glow Salon",
  custom_domain: null,
  custom_domain_verified_at: null,
  config: { storeName: "Glow", tagline: "Hair & beauty", vertical: "products" },
};
const row = {
  id: "p1", sku: "KF-1", slug: "arabica-coffee", name: "Arabica, \"Special\"",
  category: "Beans", price_minor: 5000, currency: "UGX", stock_qty: 3,
  blurb: "Fresh beans", cover_path: "abc.jpg",
};

test("feed product carries ACP fields with absolute link + image", () => {
  const item = toFeedProduct(row, BASE, "Glow");
  assert.strictEqual(item.title, 'Arabica, "Special"');
  assert.strictEqual(item.link, `${BASE}/p/arabica-coffee`);
  assert.strictEqual(item.image, `${BASE}/media/abc.jpg`);
  assert.strictEqual(item.price, "5000");
  assert.strictEqual(item.currency, "UGX");
  assert.strictEqual(item.availability, "in_stock");
  assert.strictEqual(item.brand, "Glow");
  assert.strictEqual(item.condition, "new");
  assert.strictEqual(item.mpn, "KF-1");
});

test("feed availability treats untracked stock as sellable, zero as out", () => {
  assert.strictEqual(toFeedProduct({ ...row, stock_qty: 0 }, BASE, "G").availability, "out_of_stock");
  assert.strictEqual(toFeedProduct({ ...row, stock_qty: null }, BASE, "G").availability, "in_stock");
  assert.strictEqual(toFeedProduct({ ...row, cover_path: null }, BASE, "G").image, null);
});

test("merchant CSV has header, price format, and RFC-4180 quoting", () => {
  const csv = buildMerchantCsv([toFeedProduct(row, BASE, "Glow")]);
  const lines = csv.trim().split("\n");
  assert.strictEqual(lines[0], "id,title,description,link,image_link,price,availability,brand,condition,mpn");
  assert.ok(lines[1].includes('"Arabica, ""Special"""'));
  assert.ok(lines[1].includes("5000 UGX"));
  assert.ok(lines[1].includes("in_stock"));
});

test("agent service/listing mappers link detail pages", () => {
  const svc = toAgentService(
    { id: "s1", slug: "haircut", name: "Haircut", description: "Cut", price_minor: 1999, currency: "USD", duration_minutes: 30 },
    BASE
  );
  assert.strictEqual(svc.link, `${BASE}/s/haircut`);
  assert.strictEqual(svc.price, "19.99");
  assert.strictEqual(svc.durationMinutes, 30);
  assert.strictEqual(svc.image, null);
  const lst = toAgentListing(
    { id: "l1", slug: "plot-12", title: "Plot 12", description: "", price_minor: 100, currency: "USD", location: "Kampala", listing_type: "sale", status: "active", thumbnail_path: "ph.jpg" },
    BASE
  );
  assert.strictEqual(lst.link, `${BASE}/l/plot-12`);
  assert.strictEqual(lst.image, `${BASE}/media/ph.jpg`);
  assert.strictEqual(lst.location, "Kampala");
  assert.strictEqual(lst.status, "active");
});

test("tenant llms.txt maps feeds, API, ordering rules", () => {
  const txt = buildTenantLlmsTxt(tenant, {
    canonicalBase: BASE,
    currency: "UGX",
    counts: { product: 4, service: 2, listing: 0 },
  });
  assert.ok(txt.startsWith("# Glow"));
  assert.ok(txt.includes(`${BASE}/feed/products.json`));
  assert.ok(txt.includes(`${BASE}/feed/products.csv`));
  assert.ok(txt.includes(`${BASE}/api/agent/v1/products?search=`));
  assert.ok(txt.includes("Never ask for card details"));
  assert.ok(txt.includes("Currency: UGX"));
  assert.ok(txt.includes("4 products"));
  const noCounts = buildTenantLlmsTxt(tenant, { canonicalBase: BASE });
  assert.ok(noCounts.includes(`${BASE}/llms.txt`) === false); // no self-link line by design
  assert.ok(noCounts.includes(`${BASE}/feed/products.json`));
});

test("platform llms.txt exists for base-domain crawlers", () => {
  const txt = fs.readFileSync(path.join(__dirname, "..", "public", "llms.txt"), "utf8");
  assert.ok(txt.includes("afrexpay.app"));
  assert.ok(txt.includes("/feed/products"));
  assert.ok(txt.includes("/api/agent/v1"));
});

test("discovery + agent routers load with the expected paths", () => {
  const discoveryRoutes = require("../src/modules/discovery/discovery.routes");
  const agentRoutes = require("../src/modules/discovery/agent.routes");
  assert.strictEqual(typeof discoveryRoutes, "function");
  assert.strictEqual(typeof agentRoutes, "function");
  const { feedLimiter } = require("../src/middleware/rate-limits");
  assert.strictEqual(typeof feedLimiter, "function");
});

test("catalog-slugs migration loads in repo CJS style", () => {
  const migration = require("../migrations/1791557487982_catalog-slugs.js");
  assert.strictEqual(typeof migration.up, "function");
  assert.strictEqual(typeof migration.down, "function");
});
