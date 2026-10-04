// tests/stripe-webhook.test.js
//
// Offline round-trip of the exact verification call the webhook makes:
// sign a payload the same way Stripe does, then verify it. Guards the
// wiring (correct require path, correct argument shape) without network.
const { test } = require("node:test");
const assert = require("node:assert");
const Stripe = require("stripe");

const stripeProvider = require("../src/modules/payments/stripe.provider");

test("verifyWebhook accepts a properly signed payload", () => {
  const stripe = new Stripe("sk_dummy_not_used_for_webhook_verification");
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const event = stripeProvider.verifyWebhook({ payload, signature: header, webhookSecret: secret });
  assert.strictEqual(event.type, "checkout.session.completed");
});

test("verifyWebhook throws on a bad signature", () => {
  const payload = JSON.stringify({ id: "evt_test" });
  assert.throws(
    () => stripeProvider.verifyWebhook({ payload, signature: "t=1,v1=deadbeef", webhookSecret: "whsec_test_secret" }),
    /signature/i
  );
});

test("normalizePayment maps CHECKOUT.ORDER and PAYMENT.CAPTURE shapes", () => {
  const { normalizePayment } = require("../src/modules/payments/providers/paypal.provider");
  const approved = normalizePayment({
    event_type: "CHECKOUT.ORDER.COMPLETED",
    resource: { id: "ORDER-1", purchase_units: [{ amount: { value: "50.00", currency_code: "USD" } }] },
  });
  assert.strictEqual(approved.orderId, "ORDER-1");

  const captured = normalizePayment({
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-1",
      amount: { value: "50.00", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    },
  });
  assert.strictEqual(captured.orderId, "ORDER-1");
  assert.strictEqual(captured.captureId, "CAP-1");
  assert.strictEqual(captured.providerRef, "CAP-1");
  assert.strictEqual(captured.amountMinor, 5000);
});
