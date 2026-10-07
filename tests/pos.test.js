// tests/pos.test.js
//
// Point-of-sale tender: cash collection guards + ledger shape, channel
// marking, checkout-link email composition. DB-free via stubbed pool.
const { test } = require("node:test");
const assert = require("node:assert");

const pool = require("../src/db/pool");
const orderService = require("../src/modules/orders/order.service");
const { sendCheckoutLinkEmail, setMailTransportForTests } = require("../src/lib/mailer");
const { adminApp } = require("../admin/js/app.js");

// Stubs both pool.query (pre-checks, flag lookups) and pool.connect
// (transactions). Scripts route on SQL text; unmatched traffic returns
// empty rows.
function stubDb(script) {
  const calls = [];
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const handle = async (text, values) => {
    calls.push({ text, values });
    return script(text, values);
  };
  pool.connect = async () => ({ query: handle, release: () => {} });
  pool.query = handle;
  return { calls, restore: () => { pool.connect = originalConnect; pool.query = originalQuery; } };
}
const stubConnect = stubDb;

const openOrder = {
  id: "o1", status: "pending", payment_status: "unpaid",
  total_minor: 5000, currency: "UGX",
};

test("cash collect pays, records change, writes the cash ledger row", async () => {
  const { calls, restore } = stubConnect(async (text) => {
    if (/^\s*BEGIN|^\s*COMMIT/i.test(text)) return { rows: [] };
    if (/SELECT id, status, payment_status, total_minor FROM orders/.test(text)) {
      return { rows: [{ ...openOrder }] };
    }
    if (/UPDATE orders SET payment_status = 'paid'/.test(text)) {
      assert.match(text, /channel = 'pos'/, "POS collection brands the channel");
      return { rows: [{ ...openOrder, payment_status: "paid", status: "confirmed" }] };
    }
    if (/INSERT INTO payments/.test(text)) return { rows: [] };
    return { rows: [] };
  });
  try {
    const result = await orderService.markOrderCashPaid("t1", "o1", { tenderedMinor: 7000 });
    assert.strictEqual(result.changeMinor, 2000);
    assert.strictEqual(result.order.payment_status, "paid");
    const ledger = calls.find((c) => /INSERT INTO payments/.test(c.text));
    assert.deepStrictEqual(ledger.values.slice(0, 4), ["t1", "o1", "cash:o1", 5000]);
    assert.strictEqual(ledger.values[4], "UGX");
  } finally {
    restore();
  }
});

test("cash collect refuses short tender, dead orders, and lost races", async () => {
  const byId = {
    c1: { ...openOrder, id: "c1", status: "cancelled" },
    p1: { ...openOrder, id: "p1", status: "confirmed", payment_status: "paid" },
  };
  const { restore } = stubConnect(async (text, values) => {
    if (/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/i.test(text)) return { rows: [] };
    if (/SELECT id, status, payment_status, total_minor FROM orders/.test(text)) {
      const row = byId[values[1]];
      return { rows: row ? [row] : values[1] === "o1" ? [{ ...openOrder }] : [] };
    }
    // UPDATE matches nothing: lost race (double-collect, concurrent cancel).
    if (/UPDATE orders SET payment_status = 'paid'/.test(text)) return { rows: [] };
    return { rows: [] };
  });
  try {
    assert.strictEqual(await orderService.markOrderCashPaid("t1", "missing", { tenderedMinor: 5000 }), null);
    await assert.rejects(() => orderService.markOrderCashPaid("t1", "c1", { tenderedMinor: 5000 }), /no longer be collected/);
    await assert.rejects(() => orderService.markOrderCashPaid("t1", "p1", { tenderedMinor: 5000 }), /no longer be collected/);
    await assert.rejects(
      () => orderService.markOrderCashPaid("t1", "o1", { tenderedMinor: 100 }),
      /must cover the order total/
    );
    assert.strictEqual(await orderService.markOrderCashPaid("t1", "o1", { tenderedMinor: 5000 }), null);
  } finally {
    restore();
  }
});

test("markOrderChannel validates and marks", async () => {
  await assert.rejects(() => orderService.markOrderChannel("t1", "o1", "drone"), /Unknown order channel/);
  const original = pool.query;
  pool.query = async () => ({ rows: [{ id: "o1" }] });
  try {
    assert.deepStrictEqual(await orderService.markOrderChannel("t1", "o1", "pos"), { id: "o1" });
  } finally {
    pool.query = original;
  }
});

test("checkout-link email composes over the platform SMTP creds", async () => {
  const sent = [];
  setMailTransportForTests(async (msg) => { sent.push(msg); return { messageId: "x" }; });
  try {
    await sendCheckoutLinkEmail({
      to: "cust@example.com", storeName: "Shop", orderId: "order-abcdef",
      amountText: "UGX 5,000", checkoutUrl: "https://pay.example/c",
    });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, "cust@example.com");
    assert.ok(sent[0].text.includes("https://pay.example/c"));
    assert.ok(sent[0].html.includes("https://pay.example/c"));
    assert.ok(sent[0].subject.includes("order-ab"), sent[0].subject);
  } finally {
    setMailTransportForTests(null);
  }
});

test("checkout-link email without SMTP configured fails loudly", async () => {
  setMailTransportForTests(null);
  const hadHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    await assert.rejects(
      () => sendCheckoutLinkEmail({ to: "a@b.co", storeName: "S", orderId: "o", amountText: "1", checkoutUrl: "u" }),
      /not configured/
    );
  } finally {
    if (hadHost !== undefined) process.env.SMTP_HOST = hadHost;
  }
});

test("POS cart math respects stock caps and merges lines", () => {
  const a = adminApp();
  const shirt = { id: "p1", name: "Shirt", price_minor: 5000, currency: "UGX", sizes: ["M"], stock_qty: 2 };
  a.posAdd(shirt);
  a.posAdd(shirt);
  assert.strictEqual(a.posCartCount(), 2);
  assert.strictEqual(a.posCartTotal(), 10000);
  a.posAdd(shirt); // capped at 2
  assert.strictEqual(a.posCartCount(), 2);
  assert.ok(a.toast, "cap explains itself");
  a.posChangeQty(0, -2);
  assert.strictEqual(a.posCart.length, 0);
});

test("posEnabledProvider prefers Stripe, falls back, or reports none", () => {
  const a = adminApp();
  a.stripeStatus = { enabled: false };
  a.paypalStatus = { enabled: false };
  assert.strictEqual(a.posEnabledProvider("stripe"), null);
  a.paypalStatus = { enabled: true };
  assert.strictEqual(a.posEnabledProvider("stripe"), "paypal");
  a.stripeStatus = { enabled: true };
  assert.strictEqual(a.posEnabledProvider("paypal"), "paypal");
  assert.strictEqual(a.posEnabledProvider("stripe"), "stripe");
});

test("product list pulls cover thumbnails in one query", async () => {
  const productService = require("../src/modules/products/product.service");
  const seen = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    seen.push({ text, values });
    return { rows: [] };
  };
  try {
    await productService.listProducts("t1", {});
    const q = seen[0].text;
    assert.match(q, /LEFT JOIN LATERAL/, "must join thumbnails laterally");
    assert.match(q, /thumbnail_path/, "must project the cover path");
    assert.match(q, /ORDER BY sort_order ASC/, "cover = lowest sort order");
    assert.strictEqual(seen.length, 1, "single query, no N+1");
  } finally {
    pool.query = original;
  }
});
