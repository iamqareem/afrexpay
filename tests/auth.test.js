// tests/auth.test.js — JWT issue/verify, auth-required middleware, and the
// signup validation constants exported from the auth controller.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-16-chars-min";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { issueToken, verifyToken } = require("../src/modules/auth/auth.service");
const authRequired = require("../src/middleware/auth-required");
const { SUBDOMAIN_RE, RESERVED_SUBDOMAINS, cookieOptions } = require("../src/modules/auth/auth.controller");

const SECRET = process.env.JWT_SECRET;

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return { json: (body) => { res.body = body; return res; } };
  };
  return res;
}

test("issueToken/verifyToken round-trips the session payload", () => {
  const token = issueToken({ tenantId: "tenant-1", subdomain: "my-store" });
  const payload = verifyToken(token);
  assert.equal(payload.tenantId, "tenant-1");
  assert.equal(payload.subdomain, "my-store");
});

test("verifyToken rejects tampered, wrong-secret, and expired tokens", () => {
  const token = issueToken({ tenantId: "t", subdomain: "s" });
  assert.throws(() => verifyToken(token.slice(0, -2) + "xx"));
  const foreign = jwt.sign({ tenantId: "t" }, "a-different-16-char-secret");
  assert.throws(() => verifyToken(foreign));
  const expired = jwt.sign({ tenantId: "t", exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  assert.throws(() => verifyToken(expired));
});

test("authRequired rejects requests without a session cookie", () => {
  const res = makeRes();
  let nexted = false;
  authRequired({ cookies: {}, tenant: { id: "t1" } }, res, () => { nexted = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nexted, false);
});

test("authRequired passes matching tenants and sets req.auth", () => {
  const token = issueToken({ tenantId: "t1", subdomain: "s" });
  const req = { cookies: { afrexpay_session: token }, tenant: { id: "t1" } };
  const res = makeRes();
  let nexted = false;
  authRequired(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.auth.tenantId, "t1");
});

test("authRequired rejects cross-tenant sessions and bad tokens", () => {
  const other = issueToken({ tenantId: "t2", subdomain: "other" });
  const res1 = makeRes();
  let nexted = false;
  authRequired({ cookies: { afrexpay_session: other }, tenant: { id: "t1" } }, res1, () => { nexted = true; });
  assert.equal(res1.statusCode, 403);
  assert.equal(nexted, false);

  const res2 = makeRes();
  authRequired({ cookies: { afrexpay_session: "garbage" }, tenant: { id: "t1" } }, res2, () => { nexted = true; });
  assert.equal(res2.statusCode, 401);
  assert.equal(nexted, false);
});

test("SUBDOMAIN_RE allows lowercase/digits/hyphens, rejects the rest", () => {
  assert.ok(SUBDOMAIN_RE.test("my-store"));
  assert.ok(SUBDOMAIN_RE.test("shop123"));
  assert.ok(!SUBDOMAIN_RE.test("My-Store"));
  assert.ok(!SUBDOMAIN_RE.test("has space"));
  assert.ok(!SUBDOMAIN_RE.test("-leading"));
  assert.ok(!SUBDOMAIN_RE.test("under_score"));
});

test("RESERVED_SUBDOMAINS blocks platform namespaces only", () => {
  for (const word of ["www", "api", "admin", "afrexpay", "login", "support"]) {
    assert.ok(RESERVED_SUBDOMAINS.has(word), word);
  }
  assert.ok(!RESERVED_SUBDOMAINS.has("my-store"));
});

test("cookieOptions is httpOnly/lax with a 7-day life and base-domain scope", () => {
  const opts = cookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.maxAge, 7 * 24 * 3600 * 1000);
  const base = process.env.BASE_DOMAIN || "afrexpay.com";
  if (base.includes("localhost")) {
    assert.equal(opts.domain, undefined);
  } else {
    assert.equal(opts.domain, `.${base}`);
  }
});
