// tests/home-stats.test.js — Home tab aggregates (admin/js/app.js).
// Getters are pure functions of loaded lists; instantiate the component
// directly with fixture rows, no DOM or network involved.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { adminApp } = require("../admin/js/app.js");

const NOW = new Date();
const iso = (d) => d.toISOString();
const daysAgo = (n) => iso(new Date(NOW.getTime() - n * 86400000));

function appWith(fixture) {
  const a = adminApp();
  Object.assign(a, {
    orders: [], bookings: [], products: [],
    inquiries: [], reservations: [],
    ...fixture,
  });
  return a;
}

test("sameDay compares calendar days, rejects garbage", () => {
  const a = adminApp();
  assert.equal(a.sameDay(NOW, new Date()), true);
  assert.equal(a.sameDay(daysAgo(1), NOW), false);
  assert.equal(a.sameDay("not-a-date", NOW), false);
  assert.equal(a.sameDay(NOW, undefined), false);
});

test("bookingStart parses Postgres range text", () => {
  const a = adminApp();
  const d = a.bookingStart('["2026-08-01 14:00:00+00","2026-08-01 14:45:00+00")');
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCHours(), 14);
  assert.equal(a.bookingStart("garbage"), null);
  assert.equal(a.bookingStart(null), null);
});

test("homeRevenueToday sums paid orders today, grouped by currency", () => {
  const a = appWith({
    orders: [
      { payment_status: "paid", total_minor: 5000, currency: "UGX", created_at: iso(NOW), status: "confirmed" },
      { payment_status: "paid", total_minor: 3000, currency: "UGX", created_at: iso(NOW), status: "confirmed" },
      { payment_status: "paid", total_minor: 10, currency: "USD", created_at: iso(NOW), status: "confirmed" },
      { payment_status: "unpaid", total_minor: 9999, currency: "UGX", created_at: iso(NOW), status: "pending" },
      { payment_status: "paid", total_minor: 7777, currency: "UGX", created_at: daysAgo(2), status: "fulfilled" },
    ],
  });
  const rev = a.homeRevenueToday();
  assert.deepEqual(rev.find((r) => r.currency === "UGX"), { currency: "UGX", total: 8000 });
  assert.deepEqual(rev.find((r) => r.currency === "USD"), { currency: "USD", total: 10 });
  assert.equal(rev.length, 2);
});

test("homeFulfillment queues confirmed oldest-first, capped at 5", () => {
  const mk = (n, h) => ({
    status: "confirmed", created_at: iso(new Date(NOW.getTime() - h * 3600000)),
    customer_name: `C${n}`, total_minor: 1000, currency: "UGX",
  });
  const a = appWith({ orders: [mk(1, 1), mk(2, 5), mk(3, 2), mk(4, 3), mk(5, 4), mk(6, 6),
    { status: "pending", created_at: iso(NOW), customer_name: "P" },
    { status: "fulfilled", created_at: iso(NOW), customer_name: "F" },
    { status: "cancelled", created_at: iso(NOW), customer_name: "X" }] });
  const q = a.homeFulfillment();
  assert.equal(q.length, 5);
  assert.equal(q[0].customer_name, "C6"); // oldest first
  assert.ok(q.every((o) => o.status === "confirmed"));
});

test("homeBookingsToday uses slot start, skips cancelled", () => {
  const today = iso(NOW).slice(0, 10);
  const range = (h) => `["${today} ${String(h).padStart(2, "0")}:00:00+00","${today} ${String(h + 1).padStart(2, "0")}:00:00+00")`;
  const a = appWith({
    bookings: [
      { status: "confirmed", time_range: range(10), customer_name: "Morning" },
      { status: "pending", time_range: range(14), customer_name: "Afternoon" },
      { status: "cancelled", time_range: range(11), customer_name: "Gone" },
      { status: "confirmed", time_range: "garbage", customer_name: "Broken" },
    ],
  });
  const names = a.homeBookingsToday().map((b) => b.customer_name).sort();
  assert.deepEqual(names, ["Afternoon", "Morning"]);
});

test("homePendingBookings lists pending oldest-first, capped", () => {
  const a = appWith({
    bookings: [
      { status: "pending", created_at: iso(NOW), customer_name: "New" },
      { status: "pending", created_at: daysAgo(1), customer_name: "Old" },
      { status: "confirmed", created_at: iso(NOW), customer_name: "Done" },
    ],
  });
  const q = a.homePendingBookings();
  assert.deepEqual(q.map((b) => b.customer_name), ["Old", "New"]);
});

test("homeLowStock skips untracked, sorts emptiest first", () => {
  const a = appWith({
    products: [
      { sku: "A", name: "Low", stock_qty: 2 },
      { sku: "B", name: "Zero", stock_qty: 0 },
      { sku: "C", name: "Fine", stock_qty: 50 },
      { sku: "D", name: "Infinite", stock_qty: null },
      { sku: "E", name: "Edge", stock_qty: 5 },
    ],
  });
  assert.deepEqual(a.homeLowStock().map((p) => p.sku), ["B", "A", "E"]);
});

test("homeNewInquiries and homePendingReservations filter correctly", () => {
  const a = appWith({
    inquiries: [
      { name: "Today", created_at: iso(NOW), listing_title: "Plot" },
      { name: "Old", created_at: daysAgo(3), listing_title: "Shop" },
    ],
    reservations: [
      { name: "Waiting", payment_status: "unpaid", created_at: iso(NOW) },
      { name: "Paid", payment_status: "paid", created_at: iso(NOW) },
    ],
  });
  assert.deepEqual(a.homeNewInquiries().map((i) => i.name), ["Today"]);
  assert.deepEqual(a.homePendingReservations().map((r) => r.name), ["Waiting"]);
});

test("homeActivity merges newest-first, capped at 6, skips bad dates", () => {
  const a = appWith({
    orders: [{ customer_name: "O", total_minor: 100, currency: "UGX", created_at: iso(NOW) }],
    bookings: [{ customer_name: "B", service_name: "Cut", created_at: daysAgo(1) }],
    inquiries: [{ name: "I", listing_title: "Plot", created_at: "junk" }],
  });
  const act = a.homeActivity();
  assert.equal(act.length, 2);
  assert.equal(act[0].kind, "order");
  assert.equal(act[1].kind, "booking");
  assert.equal(act[0].tab, "orders");
});
