const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildStripeLineItems, handlePaymentMetadata } = require("../src/modules/payments/stripe-checkout-helpers");

test("buildStripeLineItems formats product order items for Stripe Checkout", () => {
  const items = [
    { productName: "Wireless Headphones", unitPriceMinor: 15000, qty: 2 },
    { productName: "USB-C Cable", unitPriceMinor: 1500, qty: 1 },
  ];
  const currency = "USD";

  const lineItems = buildStripeLineItems(items, currency);
  assert.equal(lineItems.length, 2);
  assert.equal(lineItems[0].price_data.product_data.name, "Wireless Headphones");
  assert.equal(lineItems[0].price_data.unit_amount, 15000);
  assert.equal(lineItems[0].quantity, 2);
  assert.equal(lineItems[0].price_data.currency, "usd");
});

test("buildStripeLineItems formats service booking for Stripe Checkout", () => {
  const booking = {
    serviceName: "Hair Styling & Wash",
    priceMinor: 4500,
    currency: "USD",
  };

  const lineItems = buildStripeLineItems(booking, "USD");
  assert.equal(lineItems.length, 1);
  assert.equal(lineItems[0].price_data.product_data.name, "Hair Styling & Wash");
  assert.equal(lineItems[0].price_data.unit_amount, 4500);
  assert.equal(lineItems[0].quantity, 1);
});

test("handlePaymentMetadata resolves entity types cleanly", () => {
  assert.equal(handlePaymentMetadata("order", "123").entityType, "order");
  assert.equal(handlePaymentMetadata("booking", "456").entityType, "booking");
  assert.equal(handlePaymentMetadata("listing_reservation", "789").entityType, "listing_reservation");
});
