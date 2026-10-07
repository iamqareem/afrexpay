// tests/order-transitions.test.js
//
// Forward-only order lifecycle + stock restore on merchant cancel.
// DB-free via stubbed pool.
const { test } = require("node:test");
const assert = require("node:assert");

const pool = require("../src/db/pool");
const orderService = require("../src/modules/orders/order.service");

function stubStatus(current) {
  const calls = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text, values) => {
      calls.push({ text, values });
      if (/SELECT status FROM orders/.test(text)) {
        assert.match(text, /FOR UPDATE/, "read-check-write must lock the row");
        return current ? { rows: [{ status: current }] } : { rows: [] };
      }
      if (/UPDATE orders SET status/.test(text)) {
        return { rows: [{ id: "o1", status: values[2] }] };
      }
      return { rows: [] };
    },
    release: () => {},
  });
  return { calls, restore: () => { pool.connect = originalConnect; } };
}

test("legal forward moves succeed", async () => {
  for (const [from, to] of [["pending", "confirmed"], ["pending", "cancelled"], ["confirmed", "fulfilled"], ["confirmed", "cancelled"]]) {
    const { restore } = stubStatus(from);
    try {
      const updated = await orderService.updateOrderStatus("t1", "o1", to);
      assert.strictEqual(updated.status, to, `${from} -> ${to}`);
    } finally {
      restore();
    }
  }
});

test("resurrection and de-confirmation fail with human 400s", async () => {
  for (const [from, to] of [["cancelled", "confirmed"], ["fulfilled", "cancelled"], ["confirmed", "pending"], ["pending", "fulfilled"]]) {
    const { restore } = stubStatus(from);
    try {
      await assert.rejects(() => orderService.updateOrderStatus("t1", "o1", to), new RegExp(`Cannot move order from '${from}'`));
    } finally {
      restore();
    }
  }
  // Unknown order still 404s.
  const { restore } = stubStatus(null);
  try {
    assert.strictEqual(await orderService.updateOrderStatus("t1", "nope", "confirmed"), null);
  } finally {
    restore();
  }
});

test("merchant cancel restores stock aggregated per product", async () => {
  const calls = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text) => {
      calls.push(text);
      if (/SELECT status FROM orders/.test(text)) return { rows: [{ status: "confirmed" }] };
      if (/UPDATE orders SET status/.test(text)) return { rows: [{ id: "o1", status: "cancelled" }] };
      if (/UPDATE products p SET stock_qty/.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    const updated = await orderService.updateOrderStatus("t1", "o1", "cancelled");
    assert.strictEqual(updated.status, "cancelled");
    const restore = calls.find((t) => /UPDATE products p SET stock_qty/.test(t));
    assert.ok(restore, "cancel must restore stock");
    assert.match(restore, /SUM\(qty\)[^]*GROUP BY product_id/, "aggregated, not fan-out");
    assert.match(restore, /stock_qty IS NOT NULL/, "untracked stock untouched");
  } finally {
    pool.connect = originalConnect;
  }
});

test("non-cancel moves never touch stock", async () => {
  const calls = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text) => {
      calls.push(text);
      if (/SELECT status FROM orders/.test(text)) return { rows: [{ status: "pending" }] };
      if (/UPDATE orders SET status/.test(text)) return { rows: [{ id: "o1", status: "confirmed" }] };
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    await orderService.updateOrderStatus("t1", "o1", "confirmed");
    assert.ok(!calls.some((t) => /UPDATE products/.test(t)));
  } finally {
    pool.connect = originalConnect;
  }
});
