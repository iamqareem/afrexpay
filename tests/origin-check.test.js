// tests/origin-check.test.js
//
// Stateless CSRF guard: foreign origins refused on mutations, own origins
// (subdomain, custom domain, platform) allowed, headerless non-browser
// callers unaffected, safe methods untouched.
const { test } = require("node:test");
const assert = require("node:assert");
// auth.service snapshots JWT_SECRET at require time — set before importing.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-origin-check";
const { requestOrigin, isAllowedOrigin } = require("../src/lib/origin-check");

const tenant = { subdomain: "glow-salon", custom_domain: "shop.example.com", custom_domain_verified_at: "2026-01-01T00:00:00Z" };

test("requestOrigin prefers Origin, falls back to Referer origin, null when absent", () => {
  assert.strictEqual(
    requestOrigin({ headers: { origin: "https://a.test", referer: "https://b.test/x" } }),
    "https://a.test"
  );
  assert.strictEqual(
    requestOrigin({ headers: { referer: "https://b.test/some/page?q=1" } }),
    "https://b.test"
  );
  assert.strictEqual(requestOrigin({ headers: {} }), null);
  assert.strictEqual(requestOrigin({ headers: { referer: "not a url" } }), null);
});

test("isAllowedOrigin accepts the tenant subdomain, custom domain and platform hosts", () => {
  for (const origin of [
    "https://glow-salon.afrexpay.com",
    "https://shop.example.com",
    "https://afrexpay.com",
    "https://www.afrexpay.com",
  ]) {
    assert.strictEqual(isAllowedOrigin(origin, tenant), true, origin);
  }
});

test("isAllowedOrigin refuses unverified custom domains", () => {
  const unverified = { subdomain: "glow-salon", custom_domain: "shop.example.com", custom_domain_verified_at: null };
  assert.strictEqual(isAllowedOrigin("https://shop.example.com", unverified), false);
});

test("isAllowedOrigin refuses attacker tenants, lookalikes and other tenants", () => {
  for (const origin of [
    "https://evil.afrexpay.com",
    "https://other-shop.afrexpay.com",
    "https://glow-salon.afrexpay.com.evil.tld",
    "https://afrexpay.com.evil.tld",
    "not-a-url",
    "",
  ]) {
    assert.strictEqual(isAllowedOrigin(origin, tenant), false, origin);
  }
});

test("authRequired refuses cross-origin mutations but allows reads and headerless clients", async () => {
  const authRequired = require("../src/middleware/auth-required");
  const { issueToken } = require("../src/modules/auth/auth.service");
  const pool = require("../src/db/pool");
  const tenantRow = { id: "tenant-1", subdomain: "glow-salon", custom_domain: null, custom_domain_verified_at: null };
  const token = issueToken({ tenantId: "tenant-1", subdomain: "glow-salon", uid: "u9", tv: 3 });
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [{ token_version: 3 }] });
  try {

  const run = (method, headers) =>
    new Promise((resolve) => {
      const req = { method, headers, cookies: { afrexpay_session: token }, tenant: tenantRow };
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          resolve({ status: this.statusCode, body });
        },
      };
      authRequired(req, res, () => resolve({ status: "next", auth: req.auth }));
    });

  await (async () => {
    // Same-origin mutation passes with auth attached.
    assert.strictEqual(
      (await run("PATCH", { origin: "https://glow-salon.afrexpay.com" })).status,
      "next"
    );
    // Foreign-origin mutation refused.
    const blocked = await run("PATCH", { origin: "https://evil.afrexpay.com" });
    assert.strictEqual(blocked.status, 403);
    // Headerless mutation (curl/scripts) still passes — no victim browser, no CSRF.
    assert.strictEqual((await run("PATCH", {})).status, "next");
    // Reads are never origin-gated.
    assert.strictEqual(
      (await run("GET", { origin: "https://evil.afrexpay.com" })).status,
      "next"
    );
  })();
  } finally {
    pool.query = originalQuery;
  }
});
