const { test } = require("node:test");
const assert = require("node:assert/strict");
const Checkout = require("../public/js/afrexpay-checkout.js");

test("endpointFor maps all three entity types", () => {
  assert.deepEqual(Checkout.endpointFor("order"), { path: "/api/orders", param: "order" });
  assert.deepEqual(Checkout.endpointFor("booking"), { path: "/api/bookings", param: "booking" });
  assert.deepEqual(Checkout.endpointFor("listing_reservation"), { path: "/api/listing-reservations", param: "reservation" });
});

test("endpointFor rejects unknown types", () => {
  assert.equal(Checkout.endpointFor("product"), null);
  assert.equal(Checkout.endpointFor(""), null);
  assert.equal(Checkout.endpointFor(null), null);
  assert.equal(Checkout.endpointFor(undefined), null);
});

test("render is exposed", () => {
  assert.equal(typeof Checkout.render, "function");
});
