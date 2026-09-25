// tests/abandoned-orders.test.js — releaseAbandonedOrders() SQL contract.
// Uses an injected fake { query } client; no database needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { releaseAbandonedOrders } = require("../src/modules/orders/order.service");

function fakeDb(result = { cancelled: 2, restored: 3 }) {
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [result] };
    },
  };
}

test("targets only pending+pending orders older than TTL", async () => {
  const db = fakeDb();
  const out = await releaseAbandonedOrders(db, { olderThanMinutes: 60 });
  assert.deepEqual(out, { cancelled: 2, restored: 3 });
  const { sql, values } = db.calls[0];
  assert.ok(sql.includes("status = 'pending' AND payment_status = 'pending'"), "abandoned predicate");
  assert.ok(sql.includes("make_interval"), "TTL interval");
  assert.deepEqual(values, [60]);
  // Cash orders (payment_status='unpaid') must never match.
  assert.ok(!sql.includes("unpaid"));
});

test("restores stock only on tracked lines, atomically", async () => {
  const db = fakeDb();
  await releaseAbandonedOrders(db, {});
  const { sql } = db.calls[0];
  assert.ok(sql.includes("stock_qty = p.stock_qty + oi.qty"), "adds back line qty");
  assert.ok(sql.includes("p.stock_qty IS NOT NULL"), "skips untracked stock");
  assert.ok(sql.includes("WITH cancelled AS"), "single atomic statement");
  assert.ok(sql.includes("SET status = 'cancelled'"), "cancels, never deletes");
});

test("defaults to 24h TTL and rejects bad input", async () => {
  const db = fakeDb();
  await releaseAbandonedOrders(db);
  assert.deepEqual(db.calls[0].values, [1440]);
  await assert.rejects(releaseAbandonedOrders(db, { olderThanMinutes: 0 }), /positive number/);
  await assert.rejects(releaseAbandonedOrders(db, { olderThanMinutes: -5 }), /positive number/);
  await assert.rejects(releaseAbandonedOrders(db, { olderThanMinutes: NaN }), /positive number/);
});
