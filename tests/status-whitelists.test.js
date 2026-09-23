// tests/status-whitelists.test.js — status vocabularies must mirror the
// Postgres enums in migrations/1751500000000_initial-schema.js. If a
// migration adds a status, these tests fail until the whitelist follows.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ORDER_STATUSES } = require("../src/modules/orders/order.service");
const { BOOKING_STATUSES } = require("../src/modules/bookings/booking.service");
const { EXCEPTION_STATUSES } = require("../src/modules/services/availability.service");

test("ORDER_STATUSES mirrors order_status enum", () => {
  assert.deepEqual([...ORDER_STATUSES].sort(), ["cancelled", "confirmed", "fulfilled", "pending"]);
});

test("BOOKING_STATUSES mirrors booking_status enum", () => {
  assert.deepEqual([...BOOKING_STATUSES].sort(), ["cancelled", "completed", "confirmed", "pending"]);
});

test("EXCEPTION_STATUSES covers both exception kinds", () => {
  assert.deepEqual([...EXCEPTION_STATUSES].sort(), ["blocked", "open"]);
});

test("whitelists reject unknown statuses", () => {
  for (const list of [ORDER_STATUSES, BOOKING_STATUSES, EXCEPTION_STATUSES]) {
    assert.ok(!list.includes("paid"));
    assert.ok(!list.includes(""));
    assert.ok(!list.includes("CONFIRMED"));
  }
});
