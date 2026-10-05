// tests/reassessment-fixes.test.js
//
// Reassessment round: mixed-currency rejection, reservation snapshot guard,
// reservation status filter, session probe, validator type safety.
// DB-free via stubbed pool.
const { test } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-reassessment";

const pool = require("../src/db/pool");
const orderService = require("../src/modules/orders/order.service");
const reservationService = require("../src/modules/listings/reservation.service");
const { isEndAfterStart } = require("../src/lib/validate");
const authController = require("../src/modules/auth/auth.controller");
const { issueToken } = require("../src/modules/auth/auth.service");

test("isEndAfterStart returns false (never throws) on non-string input", () => {
  for (const [a, b] of [[null, "09:00"], ["09:00", undefined], [null, null], [930, 1700]]) {
    assert.strictEqual(isEndAfterStart(a, b), false, JSON.stringify([a, b]));
  }
});

test("createOrder rejects mixed-currency carts", async () => {
  const products = {
    p1: { id: "p1", name: "A", price_minor: 1000, currency: "UGX", sizes: ["M"], stock_qty: null },
    p2: { id: "p2", name: "B", price_minor: 10, currency: "USD", sizes: ["M"], stock_qty: null },
  };
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text, values) => {
      if (/^\s*BEGIN/i.test(text)) return { rows: [] };
      if (/FROM products WHERE/.test(text)) {
        const row = products[values[1]];
        return { rows: row ? [row] : [] };
      }
      if (/INSERT INTO orders/.test(text)) assert.fail("mixed cart must never be inserted");
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    await assert.rejects(
      () => orderService.createOrder("t1", {
        customerName: "C", phone: "P", address: "A",
        items: [
          { productId: "p1", size: "M", qty: 1 },
          { productId: "p2", size: "M", qty: 1 },
        ],
      }),
      /same currency/
    );
  } finally {
    pool.connect = originalConnect;
  }
});

test("createOrder still accepts single-currency carts", async () => {
  const product = { id: "p1", name: "A", price_minor: 1000, currency: "UGX", sizes: ["M"], stock_qty: null };
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text, values) => {
      if (/^\s*BEGIN|^\s*COMMIT/i.test(text)) return { rows: [] };
      if (/FROM products WHERE/.test(text)) return { rows: [product] };
      if (/INSERT INTO orders/.test(text)) return { rows: [{ id: "o1", created_at: new Date().toISOString() }] };
      if (/INSERT INTO order_items/.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    const order = await orderService.createOrder("t1", {
      customerName: "C", phone: "P", address: "A",
      items: [{ productId: "p1", size: "M", qty: 2 }],
    });
    assert.strictEqual(order.totalMinor, 2000);
    assert.strictEqual(order.currency, "UGX");
  } finally {
    pool.connect = originalConnect;
  }
});

test("reservation guard uses the snapshot, never the live listing row", async () => {
  const calls = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text, values) => {
      calls.push({ text, values });
      if (/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/i.test(text)) return { rows: [] };
      if (/UPDATE listing_reservations SET payment_status/.test(text)) {
        return {
          rows: [{
            id: "r1", listing_id: "l1", name: "N", phone: "P",
            deposit_amount_minor: 5000, currency: "UGX", // snapshot at reservation time
          }],
        };
      }
      if (/INSERT INTO payments/.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  });
  const originalQuery = pool.query;
  pool.query = async (text, values) => {
    calls.push({ text, values });
    return { rows: [] };
  };
  try {
    // Correct snapshot amount pays even though no listings row is consulted.
    const paid = await reservationService.markReservationPaid("t1", "sess-1", 5000, "UGX", "stripe");
    assert.ok(paid, "snapshot-correct payment must confirm");
    assert.ok(
      !calls.some((c) => /FROM listings/.test(c.text)),
      "must not consult the live listing row at all"
    );
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  }
});

test("listReservations filters by payment status and rejects unknown ones", async () => {
  const seen = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    seen.push({ text, values });
    return { rows: [] };
  };
  try {
    await reservationService.listReservations("t1", { status: "paid" });
    const q = seen[0];
    assert.match(q.text, /r\.payment_status = \$2/);
    assert.deepStrictEqual(q.values.slice(0, 2), ["t1", "paid"]);
    await assert.rejects(() => reservationService.listReservations("t1", { status: "bogus" }), /status must be one of/);
  } finally {
    pool.query = original;
  }
});

test("sessionStatus verifies the cookie with no database or tenant", async () => {
  const token = issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 0 });
  let body;
  const res = { status(c) { this.code = c; return this; }, json(b) { body = b; } };
  await authController.sessionStatus({ cookies: { afrexpay_session: token } }, res);
  assert.deepStrictEqual(body, { tenantId: "t1", subdomain: "s" });

  let code;
  const res2 = { status(c) { code = c; return this; }, json() {} };
  await authController.sessionStatus({ cookies: {} }, res2);
  assert.strictEqual(code, 401);
});
