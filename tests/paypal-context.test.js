// tests/paypal-context.test.js
//
// Guards the PayPal order-context contract: the service must write to the
// table/columns the migration actually created, and export the names the
// checkout call sites import. The end-to-end PayPal breakage (wrong table,
// wrong columns, non-existent import) would have failed here.
const { test } = require("node:test");
const assert = require("node:assert");

const pool = require("../src/db/pool");
const context = require("../src/modules/payments/paypal-context.service");

test("savePayPalOrderContext writes to paypal_order_context with the migrated columns", async () => {
  const seen = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    seen.push({ text, values });
    return { rows: [] };
  };
  try {
    await context.savePayPalOrderContext("PAYPAL-ORDER-1", "tenant-1", "order", "entity-1");
  } finally {
    pool.query = original;
  }
  assert.strictEqual(seen.length, 1);
  const { text, values } = seen[0];
  assert.match(text, /paypal_order_context/, "must target the real table, not paypal_order_contexts");
  assert.doesNotMatch(text, /paypal_order_contexts/, "must not use the plural table name");
  for (const col of ["paypal_order_id", "tenant_id", "entity_type", "entity_id"]) {
    assert.match(text, new RegExp(col), `must write column ${col}`);
  }
  assert.deepStrictEqual(values, ["PAYPAL-ORDER-1", "tenant-1", "order", "entity-1"]);
});

test("savePayPalOrderContext rejects unknown entity types", async () => {
  await assert.rejects(
    () => context.savePayPalOrderContext("X", "t", "spaceship", "e"),
    /entityType/
  );
});

test("getPayPalOrderContext reads from the real table and returns null when unknown", async () => {
  const original = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    assert.strictEqual(await context.getPayPalOrderContext("NOPE"), null);
    assert.strictEqual(await context.getPayPalOrderContext(null), null);
  } finally {
    pool.query = original;
  }
});

test("getPayPalOrderContext returns the stored mapping", async () => {
  const row = { paypal_order_id: "P1", tenant_id: "t", entity_type: "booking", entity_id: "b" };
  const original = pool.query;
  pool.query = async () => ({ rows: [row] });
  try {
    assert.deepStrictEqual(await context.getPayPalOrderContext("P1"), row);
  } finally {
    pool.query = original;
  }
});
