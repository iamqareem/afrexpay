// tests/tenant-resolver.test.js — pure subdomain extraction + cache helpers.
// fetchTenant hits Postgres, so only the pure parts are covered here.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractSubdomain, invalidateTenantCache } = require("../src/middleware/tenant-resolver");

const BASE = process.env.BASE_DOMAIN || "afrexpay.com";

test("extractSubdomain returns null for missing/empty hosts", () => {
  assert.equal(extractSubdomain(null), null);
  assert.equal(extractSubdomain(undefined), null);
  assert.equal(extractSubdomain(""), null);
});

test("extractSubdomain returns null for the base domain and www", () => {
  assert.equal(extractSubdomain(BASE), null);
  assert.equal(extractSubdomain(`www.${BASE}`), null);
  assert.equal(extractSubdomain(`${BASE}:3000`), null);
});

test("extractSubdomain pulls the subdomain and strips ports", () => {
  assert.equal(extractSubdomain(`256-merch.${BASE}`), "256-merch");
  assert.equal(extractSubdomain(`256-merch.${BASE}:3000`), "256-merch");
  assert.equal(extractSubdomain(`a.b.${BASE}`), "a.b");
});

test("extractSubdomain rejects foreign hosts", () => {
  assert.equal(extractSubdomain("example.com"), null);
  assert.equal(extractSubdomain(`256-merch.${BASE}.evil.com`), null);
  assert.equal(extractSubdomain("localhost:3000"), null);
});

test("invalidateTenantCache never throws, even for unknown slugs", () => {
  assert.doesNotThrow(() => invalidateTenantCache("no-such-store"));
  assert.doesNotThrow(() => invalidateTenantCache(""));
});
