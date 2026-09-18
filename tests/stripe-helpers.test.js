// tests/stripe-helpers.test.js — Checkout line-item builders + metadata shape.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildStripeLineItems, handlePaymentMetadata } = require("../src/modules/payments/stripe-checkout-helpers");

test("array payload maps order items with name/price fallbacks", () => {
  const items = [
    { productName: "Headphones", unitPriceMinor: 15000, qty: 2 },
    { name: "Cable", priceMinor: 1500 }, // qty defaults to 1
    {}, // fully bare item still produces a sane row
  ];
  const rows = buildStripeLineItems(items, "USD");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].price_data.product_data.name, "Headphones");
  assert.equal(rows[0].price_data.unit_amount, 15000);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].price_data.currency, "usd");
  assert.equal(rows[1].price_data.product_data.name, "Cable");
  assert.equal(rows[1].quantity, 1);
  assert.equal(rows[2].price_data.product_data.name, "Product Item");
});

test("currency is lowercased and amounts are rounded to whole minor units", () => {
  const [row] = buildStripeLineItems([{ productName: "X", unitPriceMinor: 19.99, qty: 1 }], "UGX");
  assert.equal(row.price_data.currency, "ugx");
  assert.equal(row.price_data.unit_amount, 20);
});

test("single-object payload covers service, listing, and generic shapes", () => {
  const [svc] = buildStripeLineItems({ serviceName: "Swim Session", priceMinor: 4500 }, "USD");
  assert.equal(svc.price_data.product_data.name, "Swim Session");
  assert.equal(svc.price_data.unit_amount, 4500);
  assert.equal(svc.quantity, 1);

  const [lst] = buildStripeLineItems({ listingTitle: "Lake Villa", depositAmountMinor: 200000 }, "UGX");
  assert.equal(lst.price_data.product_data.name, "Lake Villa");
  assert.equal(lst.price_data.unit_amount, 200000);

  const [gen] = buildStripeLineItems({}, "USD");
  assert.equal(gen.price_data.product_data.name, "Service / Holding Fee");
});

test("handlePaymentMetadata coerces entity references to strings", () => {
  assert.deepEqual(handlePaymentMetadata("order", "123"), { entityType: "order", entityId: "123" });
  assert.deepEqual(handlePaymentMetadata("booking", 456), { entityType: "booking", entityId: "456" });
  assert.deepEqual(handlePaymentMetadata("listing_reservation", "789"), {
    entityType: "listing_reservation",
    entityId: "789",
  });
});
