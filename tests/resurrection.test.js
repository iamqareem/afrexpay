// tests/resurrection.test.js
//
// Proves the booking-resurrection pair is dead:
//  1. A verified late payment for a sweep-cancelled booking must NOT flip
//     it back to confirmed (and must flag for human refund review).
//  2. PATCH status transitions are forward-only (cancelled/completed are
//     terminal — no resurrection, no exclusion-constraint 500s).
//  3. Fresh checkout on a cancelled/completed booking is refused before any
//     provider session exists.
//  4. The live happy path still confirms (no over-blocking).
//
// DB-free: pool.connect/pool.query are stubbed per test and restored after.
const { test } = require("node:test");
const assert = require("node:assert");

process.env.PAYMENT_ENCRYPTION_KEY =
  process.env.PAYMENT_ENCRYPTION_KEY || "ab".repeat(32);
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-resurrection";

const pool = require("../src/db/pool");
const { encrypt } = require("../src/lib/crypto");
const bookingService = require("../src/modules/bookings/booking.service");
const orderService = require("../src/modules/orders/order.service");

function stubPool({ connectQuery, query }) {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const calls = [];
  pool.connect = async () => ({
    query: async (text, values) => {
      calls.push({ via: "client", text, values });
      return connectQuery(text, values);
    },
    release: () => {},
  });
  pool.query = async (text, values) => {
    calls.push({ via: "pool", text, values });
    return query ? query(text, values) : { rows: [] };
  };
  return { calls, restore: () => { pool.connect = originalConnect; pool.query = originalQuery; } };
}

const cancelledBookingRow = {
  id: "booking-1", status: "cancelled", payment_status: "pending",
  price_minor: 5000, currency: "UGX",
};

test("late payment for a sweep-cancelled booking does NOT resurrect it", async () => {
  const { calls, restore } = stubPool({
    connectQuery: async (text) => {
      if (/^\s*BEGIN|COMMIT|ROLLBACK/i.test(text)) return { rows: [] };
      if (/UPDATE bookings SET payment_status = 'paid'/.test(text)) {
        // The status guard is what makes this 0 rows for cancelled rows.
        assert.match(text, /status != 'cancelled'/, "markBookingPaid must exclude cancelled rows");
        assert.match(text, /checkout_sessions/, "history fallback must survive the guard");
        return { rows: [] }; // cancelled row matches nothing
      }
      if (/INSERT INTO payments/.test(text)) {
        assert.fail("no ledger write may happen for a refused resurrection");
      }
      return { rows: [] };
    },
    query: async (text) => {
      if (/FROM bookings/.test(text) && /status = 'cancelled'/.test(text)) {
        return { rows: [{ id: "booking-1" }] }; // flag lookup finds it
      }
      return { rows: [] };
    },
  });
  try {
    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    let result;
    try {
      result = await bookingService.markBookingPaid("t1", "sess-old", 5000, "UGX", "stripe");
    } finally {
      console.error = origError;
    }
    assert.strictEqual(result, null, "cancelled booking must not confirm");
    assert.ok(
      calls.some((c) => /FROM bookings/.test(c.text) && /cancelled/.test(c.text)),
      "must run the paid-after-cancel flag lookup"
    );
    assert.ok(
      errors.some((e) => /PAID-AFTER-CANCEL/.test(e) && /booking-1/.test(e)),
      "must loudly flag possible moved funds for human refund review"
    );
    assert.ok(
      !calls.some((c) => /INSERT INTO payments/.test(c.text) && /'succeeded'/.test(c.text)),
      "no succeeded ledger row for a refused payment"
    );
  } finally {
    restore();
  }
});

test("live pending booking still confirms (no over-blocking)", async () => {
  const live = { id: "booking-2", status: "pending", payment_status: "pending", price_minor: 5000, currency: "UGX" };
  const { restore } = stubPool({
    connectQuery: async (text) => {
      if (/^\s*BEGIN|COMMIT|ROLLBACK/i.test(text)) return { rows: [] };
      if (/UPDATE bookings SET payment_status = 'paid'/.test(text)) return { rows: [live] };
      if (/INSERT INTO payments/.test(text)) return { rows: [] };
      return { rows: [] };
    },
  });
  try {
    const result = await bookingService.markBookingPaid("t1", "sess-live", 5000, "UGX", "stripe");
    assert.deepStrictEqual(result, live);
  } finally {
    restore();
  }
});

test("late payment for a sweep-cancelled order does NOT resurrect it either", async () => {
  const { restore } = stubPool({
    connectQuery: async (text) => {
      if (/^\s*BEGIN|COMMIT|ROLLBACK/i.test(text)) return { rows: [] };
      if (/UPDATE orders SET payment_status = 'paid'/.test(text)) {
        assert.match(text, /status != 'cancelled'/, "markOrderPaid must exclude cancelled rows");
        return { rows: [] };
      }
      if (/INSERT INTO payments/.test(text)) assert.fail("no ledger write on refusal");
      return { rows: [] };
    },
    query: async () => ({ rows: [{ id: "order-9" }] }),
  });
  try {
    assert.strictEqual(await orderService.markOrderPaid("t1", "sess-old", 9000, "UGX", "stripe"), null);
  } finally {
    restore();
  }
});

test("booking status transitions are forward-only", async () => {
  const { restore } = stubPool({
    query: async (text, values) => {
      if (/SELECT status FROM bookings/.test(text)) {
        const id = values[1];
        const statusById = { b1: "pending", b2: "cancelled", b3: "completed", b4: "confirmed" };
        return statusById[id] ? { rows: [{ status: statusById[id] }] } : { rows: [] };
      }
      if (/UPDATE bookings SET status/.test(text)) {
        return { rows: [{ id: values[1], status: values[2] }] };
      }
      return { rows: [] };
    },
  });
  try {
    // Legal moves work.
    assert.strictEqual((await bookingService.updateBookingStatus("t", "b1", "confirmed")).status, "confirmed");
    assert.strictEqual((await bookingService.updateBookingStatus("t", "b4", "completed")).status, "completed");
    assert.strictEqual((await bookingService.updateBookingStatus("t", "b1", "cancelled")).status, "cancelled");
    // Resurrections fail with a human 400, never reach UPDATE.
    await assert.rejects(() => bookingService.updateBookingStatus("t", "b2", "confirmed"), /Cannot move booking from 'cancelled'/);
    await assert.rejects(() => bookingService.updateBookingStatus("t", "b3", "confirmed"), /Cannot move booking from 'completed'/);
    await assert.rejects(() => bookingService.updateBookingStatus("t", "b4", "pending"), /Cannot move booking from 'confirmed' to 'pending'/);
    // Unknown booking still 404s.
    assert.strictEqual(await bookingService.updateBookingStatus("t", "nope", "confirmed"), null);
  } finally {
    restore();
  }
});

test("fresh checkout on a cancelled booking is refused before any provider session", async () => {
  const { calls, restore } = stubPool({
    query: async (text) => {
      if (/FROM payment_credentials/.test(text)) {
        return {
          rows: [{
            secret_key_encrypted: encrypt("sk_test_123"),
            publishable_key: "pk_test_123",
            webhook_secret_encrypted: encrypt("whsec_test"),
            mode: "test",
          }],
        };
      }
      if (/FROM bookings/.test(text)) return { rows: [cancelledBookingRow] };
      return { rows: [] };
    },
  });
  try {
    await assert.rejects(
      () => bookingService.startBookingCheckout("t1", "booking-1", {
        successUrl: "https://x.test/ok", cancelUrl: "https://x.test/no", provider: "stripe",
      }),
      /no longer available for payment/
    );
    assert.ok(
      !calls.some((c) => /checkout_sessions|stripe|paypal.*checkout/i.test(c.text) && /INSERT/.test(c.text)),
      "no session may be recorded for a dead booking"
    );
  } finally {
    restore();
  }
});

test("fresh checkout on a cancelled order is refused too", async () => {
  const { restore } = stubPool({
    query: async (text) => {
      if (/FROM payment_credentials/.test(text)) {
        return {
          rows: [{
            secret_key_encrypted: encrypt("sk_test_123"),
            publishable_key: "pk_test_123",
            webhook_secret_encrypted: encrypt("whsec_test"),
            mode: "test",
          }],
        };
      }
      if (/FROM orders/.test(text)) {
        return { rows: [{ id: "o1", status: "cancelled", payment_status: "pending", total_minor: 100, currency: "UGX" }] };
      }
      if (/FROM order_items/.test(text)) return { rows: [] };
      return { rows: [] };
    },
  });
  try {
    await assert.rejects(
      () => orderService.startOrderCheckout("t1", "o1", {
        successUrl: "https://x.test/ok", cancelUrl: "https://x.test/no", provider: "stripe",
      }),
      /no longer available for payment/
    );
  } finally {
    restore();
  }
});
