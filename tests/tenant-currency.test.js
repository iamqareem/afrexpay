// tests/tenant-currency.test.js
//
// New catalog rows inherit the store's configured currency instead of
// hardcoded UGX — switching settings must visibly work for rows created
// after the switch. Explicit client currency still wins. DB-free via stubs.
const { test } = require("node:test");
const assert = require("node:assert");

const pool = require("../src/db/pool");
const configService = require("../src/modules/store-config/config.service");
const productService = require("../src/modules/products/product.service");
const serviceService = require("../src/modules/services/service.service");
const listingService = require("../src/modules/listings/listing.service");

function stubPool({ configCurrency, failConfig = false }) {
  const seen = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    seen.push({ text, values });
    if (/config->>'currency'/.test(text)) {
      if (failConfig) throw new Error("db down");
      return { rows: configCurrency === undefined ? [] : [{ currency: configCurrency }] };
    }
    return { rows: [{ id: "new-id" }] };
  };
  return { seen, restore: () => { pool.query = original; } };
}

test("getTenantCurrency reads config, normalizes, and fails safe", async () => {
  let s = stubPool({ configCurrency: "kes" });
  try {
    assert.strictEqual(await configService.getTenantCurrency("t1"), "KES");
  } finally {
    s.restore();
  }
  s = stubPool({ configCurrency: "XX1" });
  try {
    assert.strictEqual(await configService.getTenantCurrency("t1"), "UGX");
  } finally {
    s.restore();
  }
  s = stubPool({ configCurrency: undefined });
  try {
    assert.strictEqual(await configService.getTenantCurrency("t1"), "UGX");
  } finally {
    s.restore();
  }
  s = stubPool({ failConfig: true });
  try {
    assert.strictEqual(await configService.getTenantCurrency("t1"), "UGX");
  } finally {
    s.restore();
  }
});

test("product create inherits the store currency; explicit wins", async () => {
  const s = stubPool({ configCurrency: "KES" });
  try {
    await productService.createProduct("t1", { sku: "a", name: "n", priceMinor: 5, sizes: ["M"] });
    const insert = s.seen.find((c) => /INSERT INTO products/.test(c.text));
    assert.strictEqual(insert.values[5], "KES");

    await productService.createProduct("t1", { sku: "b", name: "n", priceMinor: 5, sizes: ["M"], currency: "USD" });
    const insert2 = s.seen.filter((c) => /INSERT INTO products/.test(c.text))[1];
    assert.strictEqual(insert2.values[5], "USD");
  } finally {
    s.restore();
  }
});

test("service and listing creates inherit the store currency", async () => {
  const s = stubPool({ configCurrency: "TZS" });
  const originalConnect = pool.connect;
  pool.connect = async () => ({ query: async () => ({ rows: [] }), release: () => {} });
  try {
    await serviceService.createService("t1", { name: "n", durationMinutes: 30, priceMinor: 5 });
    const svc = s.seen.find((c) => /INSERT INTO services/.test(c.text));
    assert.strictEqual(svc.values[5], "TZS");

    await listingService.createListing("t1", { title: "t", listingType: "sale", priceMinor: 5 });
    const lst = s.seen.find((c) => /INSERT INTO listings/.test(c.text));
    assert.strictEqual(lst.values[5], "TZS");
  } finally {
    pool.connect = originalConnect;
    s.restore();
  }
});
