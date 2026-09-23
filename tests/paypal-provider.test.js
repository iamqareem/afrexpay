const { test } = require("node:test");
const assert = require("node:assert/strict");
const paypalProvider = require("../src/modules/payments/providers/paypal.provider");

test("money handles standard currencies with two decimal places", () => {
  assert.equal(paypalProvider.money(1500, "USD"), "15.00");
  assert.equal(paypalProvider.money(99, "EUR"), "0.99");
  assert.equal(paypalProvider.money(10000, "GBP"), "100.00");
});

test("money handles zero-decimal currencies correctly without dividing by 100", () => {
  assert.equal(paypalProvider.money(1500, "UGX"), "1500");
  assert.equal(paypalProvider.money(500, "JPY"), "500");
  assert.equal(paypalProvider.money(2500, "RWF"), "2500");
});

test("normalizePayment extracts orderId and captureId correctly from PAYMENT.CAPTURE.COMPLETED event", () => {
  const event = {
    id: "WH-12345",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-998877",
      amount: {
        value: "25.00",
        currency_code: "USD",
      },
      supplementary_data: {
        related_ids: {
          order_id: "ORD-112233",
        },
      },
    },
  };

  const normalized = paypalProvider.normalizePayment(event);
  assert.equal(normalized.orderId, "ORD-112233");
  assert.equal(normalized.captureId, "CAP-998877");
  assert.equal(normalized.providerRef, "CAP-998877");
  assert.equal(normalized.amountMinor, 2500);
  assert.equal(normalized.currency, "USD");
});

test("normalizePayment extracts zero-decimal amounts correctly from PAYMENT.CAPTURE.COMPLETED event", () => {
  const event = {
    id: "WH-54321",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-111",
      amount: {
        value: "15000",
        currency_code: "UGX",
      },
      supplementary_data: {
        related_ids: {
          order_id: "ORD-222",
        },
      },
    },
  };

  const normalized = paypalProvider.normalizePayment(event);
  assert.equal(normalized.orderId, "ORD-222");
  assert.equal(normalized.captureId, "CAP-111");
  assert.equal(normalized.amountMinor, 15000);
  assert.equal(normalized.currency, "UGX");
});
