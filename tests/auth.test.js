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

// authRequired is async (DB version check) — drive it to settlement and
// report whether next() ran or which status was sent.
const pool = require("../src/db/pool");
async function runAuth(req) {
  let nexted = false;
  const res = makeRes();
  await authRequired(req, res, () => { nexted = true; });
  return { nexted, statusCode: res.statusCode, body: res.body, req };
}

// Stubs the token_version lookup by user id. Restores pool.query after.
function stubTokenVersion(versionByUser) {
  const original = pool.query;
  pool.query = async (text, values) => {
    if (/SELECT token_version FROM users/.test(text)) {
      const v = versionByUser[values[0]];
      return v === undefined ? { rows: [] } : { rows: [{ token_version: v }] };
    }
    return { rows: [] };
  };
  return () => { pool.query = original; };
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

test("authRequired passes matching tenants and sets req.auth", async () => {
  const restore = stubTokenVersion({ u1: 0 });
  try {
    const token = issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 0 });
    const { nexted, req } = await runAuth({ cookies: { afrexpay_session: token }, tenant: { id: "t1" } });
    assert.equal(nexted, true);
    assert.equal(req.auth.tenantId, "t1");
  } finally {
    restore();
  }
});

test("authRequired rejects cross-tenant sessions and bad tokens", async () => {
  const other = issueToken({ tenantId: "t2", subdomain: "other", uid: "u2", tv: 0 });
  const r1 = await runAuth({ cookies: { afrexpay_session: other }, tenant: { id: "t1" } });
  assert.equal(r1.statusCode, 403);
  assert.equal(r1.nexted, false);

  const r2 = await runAuth({ cookies: { afrexpay_session: "garbage" }, tenant: { id: "t1" } });
  assert.equal(r2.statusCode, 401);
  assert.equal(r2.nexted, false);
});

test("authRequired rejects legacy tokens without a uid claim", async () => {
  const token = issueToken({ tenantId: "t1", subdomain: "s" });
  const r = await runAuth({ cookies: { afrexpay_session: token }, tenant: { id: "t1" } });
  assert.equal(r.statusCode, 401);
  assert.equal(r.nexted, false);
});

test("authRequired rejects sessions revoked by password reset (version bump)", async () => {
  const restore = stubTokenVersion({ u1: 1 }); // reset bumped stored version to 1
  try {
    const stale = issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 0 });
    const r = await runAuth({ cookies: { afrexpay_session: stale }, tenant: { id: "t1" } });
    assert.equal(r.statusCode, 401);
    assert.equal(r.nexted, false);

    const fresh = issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 1 });
    const r2 = await runAuth({ cookies: { afrexpay_session: fresh }, tenant: { id: "t1" } });
    assert.equal(r2.nexted, true);
  } finally {
    restore();
  }
});

test("authRequired rejects sessions for deleted users", async () => {
  const restore = stubTokenVersion({}); // no row for anyone
  try {
    const token = issueToken({ tenantId: "t1", subdomain: "s", uid: "ghost", tv: 0 });
    const r = await runAuth({ cookies: { afrexpay_session: token }, tenant: { id: "t1" } });
    assert.equal(r.statusCode, 401);
    assert.equal(r.nexted, false);
  } finally {
    restore();
  }
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

test("sessionStatus enforces uid + live version like data endpoints", async () => {
  const { sessionStatus } = require("../src/modules/auth/auth.controller");
  const run = async (cookies) => {
    let code = null;
    let body = null;
    // Top-level json (the 200 path) AND status().json (the 401 paths).
    const res = {
      json: (b) => { body = b; },
      status: (c) => { code = c; return { json: (b) => { body = b; } }; },
    };
    await sessionStatus({ cookies }, res);
    return { code, body };
  };
  const original = pool.query;
  pool.query = async () => ({ rows: [{ token_version: 2 }] });
  try {
    // Fresh session passes with tenant identity.
    const fresh = issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 2 });
    const ok = await run({ afrexpay_session: fresh });
    assert.equal(ok.code, null); // res.json without status = 200 path
    assert.deepEqual(ok.body, { tenantId: "t1", subdomain: "s" });

    // Stale pre-revocation session (no uid) lands on login, not a loop.
    const legacy = issueToken({ tenantId: "t1", subdomain: "s" });
    assert.equal((await run({ afrexpay_session: legacy })).code, 401);

    // Version-bumped session (post-reset) is rejected.
    const stale = issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 1 });
    assert.equal((await run({ afrexpay_session: stale })).code, 401);

    // No cookie at all.
    assert.equal((await run({})).code, 401);
  } finally {
    pool.query = original;
  }
});
