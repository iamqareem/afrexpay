const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getProvider, listProviders, REGISTRY } = require("../src/modules/payments/providers");

test("registry lists exactly stripe and paypal", () => {
  assert.deepEqual(listProviders().sort(), ["paypal", "stripe"]);
  assert.deepEqual(Object.keys(REGISTRY).sort(), ["paypal", "stripe"]);
});

test("getProvider resolves known providers", () => {
  assert.equal(getProvider("stripe"), REGISTRY.stripe);
  assert.equal(getProvider("paypal"), REGISTRY.paypal);
});

test("getProvider rejects unknown providers with 400", () => {
  for (const bad of ["bitcoin", "STRIPE", "", null, undefined]) {
    assert.throws(() => getProvider(bad), (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Unknown payment provider/);
      return true;
    });
  }
});

test("each provider exposes the checkout contract", () => {
  for (const p of listProviders()) {
    assert.equal(typeof REGISTRY[p].createCheckoutSession, "function", `${p} checkout`);
    assert.equal(typeof REGISTRY[p].verifyWebhook, "function", `${p} webhook verify`);
  }
});
