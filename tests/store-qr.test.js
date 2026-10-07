// tests/store-qr.test.js
//
// One canonical store URL feeds the dashboard card, the public /qr.svg and
// every theme footer. A QR pointing anywhere but the live storefront would
// be a printed lie — these pin the resolution rules.
const { test } = require("node:test");
const assert = require("node:assert");
const { storePublicUrl, storeQrSvg } = require("../src/lib/store-qr");

test("subdomain stores resolve to their https subdomain URL", () => {
  assert.strictEqual(
    storePublicUrl({ subdomain: "Glow-Salon", custom_domain: null, custom_domain_verified_at: null }),
    "https://glow-salon.afrexpay.com"
  );
});

test("verified custom domains win over the subdomain", () => {
  assert.strictEqual(
    storePublicUrl({
      subdomain: "glow-salon",
      custom_domain: "Shop.Example.com",
      custom_domain_verified_at: "2026-01-01T00:00:00Z",
    }),
    "https://shop.example.com"
  );
});

test("merely-claimed domains never leak into the QR", () => {
  assert.strictEqual(
    storePublicUrl({ subdomain: "glow-salon", custom_domain: "evil.example.com", custom_domain_verified_at: null }),
    "https://glow-salon.afrexpay.com"
  );
});

test("tenant without subdomain throws instead of encoding garbage", () => {
  assert.throws(() => storePublicUrl({}), /no subdomain/i);
});

test("storeQrSvg returns scannable SVG for the resolved URL", async () => {
  const { url, svg } = await storeQrSvg({ subdomain: "s", custom_domain: null, custom_domain_verified_at: null });
  assert.strictEqual(url, "https://s.afrexpay.com");
  assert.ok(svg.startsWith("<svg"), "must be inline-renderable SVG");
  assert.ok(svg.includes("</svg>"));
});
