// tests/routes-load.test.js
//
// Boot regression test: every route module + the provider registry must
// load without throwing. This catches broken require paths (e.g. the
// webhook's `require("../stripe.provider")` that 400'd every Stripe
// webhook) at commit time instead of in production.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");

function routeFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...routeFiles(full));
    } else if (/\.routes\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("every *.routes.js module loads", () => {
  const files = routeFiles(path.join(SRC, "modules"));
  assert.ok(files.length > 5, `expected several route modules, found ${files.length}`);
  for (const file of files) {
    assert.doesNotThrow(
      () => require(file),
      `route module failed to load: ${path.relative(SRC, file)}`
    );
  }
});

test("payment provider registry exposes both providers with the checkout interface", () => {
  const { getProvider, listProviders } = require("../src/modules/payments/providers");
  assert.deepStrictEqual(new Set(listProviders()), new Set(["stripe", "paypal"]));
  for (const id of listProviders()) {
    const provider = getProvider(id);
    assert.strictEqual(typeof provider.createCheckoutSession, "function", `${id} needs createCheckoutSession`);
    assert.strictEqual(typeof provider.verifyWebhook, "function", `${id} needs verifyWebhook`);
  }
  // PayPal events need normalization (order vs capture shapes); Stripe
  // sessions are normalized inline in webhook.routes.js from metadata.
  const paypal = getProvider("paypal");
  assert.strictEqual(typeof paypal.normalizePayment, "function", "paypal needs normalizePayment");
});

test("webhook handler resolves the real Stripe verifier (no dangling require)", () => {
  const stripeProvider = require("../src/modules/payments/stripe.provider");
  assert.strictEqual(typeof stripeProvider.verifyWebhook, "function");
});

test("PayPal context service exports match what checkout call sites import", () => {
  const context = require("../src/modules/payments/paypal-context.service");
  assert.strictEqual(typeof context.savePayPalOrderContext, "function", "savePayPalOrderContext must exist");
  assert.strictEqual(typeof context.getPayPalOrderContext, "function", "getPayPalOrderContext must exist");
});
