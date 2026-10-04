// tests/payment-status.test.js
//
// The storefront confirmation screens verify payment against these
// endpoints instead of trusting the forgeable ?paid=1 query param.
// Guards: tenant scoping, exact columns, null (→ 404) when unknown.
const { test } = require("node:test");
const assert = require("node:assert");

const pool = require("../src/db/pool");
const orderService = require("../src/modules/orders/order.service");
const bookingService = require("../src/modules/bookings/booking.service");
const reservationService = require("../src/modules/listings/reservation.service");

async function captureStatusCall(serviceFn, ...args) {
  const seen = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    seen.push({ text, values });
    return { rows: [] };
  };
  try {
    const result = await serviceFn(...args);
    return { seen, result };
  } finally {
    pool.query = original;
  }
}

test("getOrderPaymentStatus is tenant-scoped and selects payment columns", async () => {
  const { seen, result } = await captureStatusCall(orderService.getOrderPaymentStatus, "t1", "o1");
  assert.strictEqual(result, null);
  assert.strictEqual(seen.length, 1);
  assert.match(seen[0].text, /FROM orders WHERE tenant_id = \$1 AND id = \$2/);
  assert.match(seen[0].text, /payment_status/);
  assert.deepStrictEqual(seen[0].values, ["t1", "o1"]);
});

test("getBookingPaymentStatus is tenant-scoped", async () => {
  const { seen, result } = await captureStatusCall(bookingService.getBookingPaymentStatus, "t1", "b1");
  assert.strictEqual(result, null);
  assert.match(seen[0].text, /FROM bookings WHERE tenant_id = \$1 AND id = \$2/);
  assert.match(seen[0].text, /payment_status/);
});

test("getReservationPaymentStatus includes listing_id for on-screen matching", async () => {
  const { seen, result } = await captureStatusCall(
    reservationService.getReservationPaymentStatus, "t1", "r1"
  );
  assert.strictEqual(result, null);
  assert.match(seen[0].text, /FROM listing_reservations WHERE tenant_id = \$1 AND id = \$2/);
  assert.match(seen[0].text, /listing_id/);
  assert.match(seen[0].text, /payment_status/);
});

test("status helpers return the row when present", async () => {
  const row = { id: "o1", status: "confirmed", payment_status: "paid" };
  const original = pool.query;
  pool.query = async () => ({ rows: [row] });
  try {
    assert.deepStrictEqual(await orderService.getOrderPaymentStatus("t1", "o1"), row);
  } finally {
    pool.query = original;
  }
});
