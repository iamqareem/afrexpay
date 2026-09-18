// tests/matrix.test.js — Matrix notification message formatting (pure).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatOrderMessage } = require("../src/modules/notify-matrix/matrix.service");

function sampleOrder() {
  return {
    id: "order-uuid-1234567890",
    customer_name: "Jane Doe",
    phone: "0771000000",
    address: "Kampala",
    delivery_notes: "Leave at gate",
    currency: "UGX",
    total_minor: 45000,
    items: [{ qty: 2, product_name: "Soap", size: "L", unit_price_minor: 20000 }],
  };
}

test("text body carries store, order, customer, items, and total", () => {
  const { text } = formatOrderMessage("Luna Shop", sampleOrder());
  assert.ok(text.includes("Luna Shop"));
  assert.ok(text.includes("order-uu")); // id sliced to 8 chars
  assert.ok(text.includes("Jane Doe"));
  assert.ok(text.includes("0771000000"));
  assert.ok(text.includes("2× Soap"));
  assert.ok(text.includes("45,000"));
  assert.ok(text.includes("Notes: Leave at gate"));
});

test("camelCase order shape renders identically", () => {
  const { text } = formatOrderMessage("Luna Shop", {
    id: "abcdef123456",
    customerName: "John",
    phone: "0772000000",
    address: "Entebbe",
    currency: "USD",
    totalMinor: 1999,
    items: [{ qty: 1, name: "Tee", size: "M", unitPriceMinor: 1999 }],
  });
  assert.ok(text.includes("John"));
  assert.ok(text.includes("1× Tee"));
});

test("missing store name falls back and absent notes leave no trace", () => {
  const order = sampleOrder();
  delete order.delivery_notes;
  const { text, html } = formatOrderMessage("", order);
  assert.ok(text.includes("your store"));
  assert.ok(!text.includes("Notes:"));
  assert.ok(html.includes("<ul>") && html.includes("<li>"));
  assert.ok(html.includes("New order"));
});
