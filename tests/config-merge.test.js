// tests/config-merge.test.js
//
// updateConfig must deep-merge nested keys (a partial nested PATCH must
// not delete sibling keys) and upsert (a tenant with no store_configs row
// must get one, never a silent null 200).
const { test } = require("node:test");
const assert = require("node:assert");

const pool = require("../src/db/pool");
const configService = require("../src/modules/store-config/config.service");

test("deepMergeConfig merges nested objects key-by-key", () => {
  const { deepMergeConfig } = configService;
  assert.deepStrictEqual(
    deepMergeConfig(
      { storeName: "X", hero: { title: "T", subtitle: "S" }, tags: ["a"] },
      { hero: { title: "T2" } }
    ),
    { storeName: "X", hero: { title: "T2", subtitle: "S" }, tags: ["a"] }
  );
});

test("deepMergeConfig replaces arrays wholesale and tolerates nulls", () => {
  const { deepMergeConfig } = configService;
  assert.deepStrictEqual(deepMergeConfig({ a: [1, 2] }, { a: [3] }), { a: [3] });
  assert.deepStrictEqual(deepMergeConfig(null, { a: 1 }), { a: 1 });
  assert.deepStrictEqual(deepMergeConfig({ a: 1 }, null), null);
});

test("updateConfig merges against the stored config in a transaction", async () => {
  const calls = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text, values) => {
      calls.push({ text, values });
      if (/SELECT config FROM store_configs/.test(text)) {
        assert.match(text, /FOR UPDATE/, "must lock the row for the merge");
        return { rows: [{ config: { storeName: "X", hero: { title: "T", subtitle: "S" } } }] };
      }
      if (/INSERT INTO store_configs/.test(text)) {
        return { rows: [{ config: JSON.parse(values[1]), theme_slug: "hangtag" }] };
      }
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    const result = await configService.updateConfig("t1", { hero: { title: "T2" } });
    // Sibling key survives the partial nested patch.
    assert.deepStrictEqual(result.config, {
      storeName: "X",
      hero: { title: "T2", subtitle: "S" },
    });
    assert.ok(calls.some((c) => /^\s*BEGIN/i.test(c.text)), "must run in a transaction");
    assert.ok(calls.some((c) => /ON CONFLICT \(tenant_id\) DO UPDATE/.test(c.text)), "must upsert");
    assert.ok(calls.some((c) => /^\s*COMMIT/i.test(c.text)), "must commit");
  } finally {
    pool.connect = originalConnect;
  }
});

test("updateConfig creates the row when the tenant has none", async () => {
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text) => {
      if (/SELECT config FROM store_configs/.test(text)) return { rows: [] };
      if (/INSERT INTO store_configs/.test(text)) {
        return { rows: [{ config: { vertical: "listings" }, theme_slug: "hangtag" }] };
      }
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    const result = await configService.updateConfig("t-new", { vertical: "listings" });
    assert.ok(result, "must return the created row, never null");
    assert.strictEqual(result.config.vertical, "listings");
  } finally {
    pool.connect = originalConnect;
  }
});

test("setThemeSlug upserts instead of silently dropping the write", async () => {
  const calls = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    calls.push({ text, values });
    return { rows: [{ config: {}, theme_slug: values[1] }] };
  };
  try {
    const result = await configService.setThemeSlug("t1", "souk");
    assert.strictEqual(result.theme_slug, "souk");
    assert.ok(calls.some((c) => /ON CONFLICT \(tenant_id\) DO UPDATE/.test(c.text)), "must upsert");
  } finally {
    pool.query = original;
  }
});
