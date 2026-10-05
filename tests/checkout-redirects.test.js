// tests/checkout-redirects.test.js
//
// successUrl/cancelUrl must point back at the store being paid, never at
// an arbitrary host (post-payment phishing via a trusted provider URL).
const { test } = require("node:test");
const assert = require("node:assert");
const { assertSafeCheckoutRedirects } = require("../src/lib/checkout-redirects");

const tenant = { subdomain: "glow-salon", custom_domain: "shop.example.com", custom_domain_verified_at: "2026-01-01T00:00:00Z" };
const unverifiedTenant = { subdomain: "glow-salon", custom_domain: "shop.example.com", custom_domain_verified_at: null };

test("accepts the tenant subdomain and custom domain over https", () => {
  assert.doesNotThrow(() =>
    assertSafeCheckoutRedirects(
      "https://glow-salon.afrexpay.com/order/1?paid=1",
      "https://shop.example.com/cancel",
      tenant
    )
  );
});

test("rejects merely-claimed (unverified) custom domains", () => {
  assert.throws(
    () =>
      assertSafeCheckoutRedirects(
        "https://shop.example.com/x",
        "https://glow-salon.afrexpay.com/y",
        unverifiedTenant
      ),
    /must point back to this store/
  );
});

test("rejects attacker hosts", () => {
  assert.throws(
    () =>
      assertSafeCheckoutRedirects(
        "https://evil.tld/clone-of-store",
        "https://glow-salon.afrexpay.com/cancel",
        tenant
      ),
    /successUrl must point back to this store/
  );
  assert.throws(
    () =>
      assertSafeCheckoutRedirects(
        "https://glow-salon.afrexpay.com/ok",
        "https://evil.tld/cancel",
        tenant
      ),
    /cancelUrl must point back to this store/
  );
});

test("rejects non-https and malformed URLs", () => {
  assert.throws(
    () => assertSafeCheckoutRedirects("http://glow-salon.afrexpay.com/x", "https://shop.example.com/y", tenant),
    /must use https/
  );
  assert.throws(
    () => assertSafeCheckoutRedirects("not-a-url", "https://shop.example.com/y", tenant),
    /valid absolute URL/
  );
});

test("rejects lookalike subdomains", () => {
  assert.throws(
    () =>
      assertSafeCheckoutRedirects(
        "https://glow-salon.afrexpay.com.evil.tld/x",
        "https://shop.example.com/y",
        tenant
      ),
    /must point back/
  );
});
