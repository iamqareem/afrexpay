// tests/session-revocation.test.js
//
// Per-device logout: every token carries a jti; logout revokes exactly that
// session while siblings survive. Password-reset version bumps still kill
// everything. DB-free via stubbed pool.
const { test } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-revocation";

const pool = require("../src/db/pool");
const authService = require("../src/modules/auth/auth.service");
const authController = require("../src/modules/auth/auth.controller");
const authRequired = require("../src/middleware/auth-required");

// Routes pool traffic: version lookups per user map, revocation set by jti.
function stubAuthDb(versions, revoked) {
  const original = pool.query;
  pool.query = async (text, values) => {
    if (/SELECT token_version FROM users/.test(text)) {
      const v = versions[values[0]];
      return v === undefined ? { rows: [] } : { rows: [{ token_version: v }] };
    }
    if (/SELECT 1 FROM revoked_tokens/.test(text)) {
      return revoked.has(values[0]) ? { rows: [{ "?column?": 1 }] } : { rows: [] };
    }
    if (/INSERT INTO revoked_tokens/.test(text)) {
      revoked.add(values[0]);
      return { rows: [{ jti: values[0] }] };
    }
    return { rows: [] };
  };
  return () => { pool.query = original; };
}

function runAuth(req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve({ status: this.statusCode, body: this.body }); },
    };
    authRequired(req, res, () => resolve({ status: "next", req }));
  });
}

test("issueToken mints a unique jti per session", () => {
  const a = authService.issueToken({ tenantId: "t", subdomain: "s", uid: "u", tv: 0 });
  const b = authService.issueToken({ tenantId: "t", subdomain: "s", uid: "u", tv: 0 });
  const pa = authService.verifyToken(a);
  const pb = authService.verifyToken(b);
  assert.ok(pa.jti && pb.jti && pa.jti !== pb.jti, "sibling devices need distinct ids");
});

test("logout revokes exactly that session; siblings survive", async () => {
  const revoked = new Set();
  const restore = stubAuthDb({ u1: 0 }, revoked);
  try {
    const deviceA = authService.issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 0 });
    const deviceB = authService.issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 0 });

    let cleared = null;
    const res = {
      clearCookie: (k) => { cleared = k; return res; },
      status(c) { res.statusCode = c; return res; },
      send: () => {},
    };
    await authController.logout({ cookies: { afrexpay_session: deviceA } }, res);
    assert.strictEqual(cleared, "afrexpay_session");
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(revoked.size, 1, "one jti recorded");

    const tenant = { id: "t1" };
    const dead = await runAuth({ method: "GET", headers: {}, cookies: { afrexpay_session: deviceA }, tenant });
    assert.strictEqual(dead.status, 401, "logged-out device is dead");
    const alive = await runAuth({ method: "GET", headers: {}, cookies: { afrexpay_session: deviceB }, tenant });
    assert.strictEqual(alive.status, "next", "sibling device survives");
  } finally {
    restore();
  }
});

test("logout with garbage still clears the cookie", async () => {
  let cleared = null;
  const res = {
    clearCookie: (k) => { cleared = k; return res; },
    status(c) { res.statusCode = c; return res; },
    send: () => {},
  };
  await authController.logout({ cookies: { afrexpay_session: "garbage" } }, res);
  assert.strictEqual(cleared, "afrexpay_session");
  assert.strictEqual(res.statusCode, 204);
});

test("revoked sessions fail the session probe too", async () => {
  const revoked = new Set();
  const restore = stubAuthDb({ u1: 0 }, revoked);
  try {
    const token = authService.issueToken({ tenantId: "t1", subdomain: "s", uid: "u1", tv: 0 });
    const { jti } = authService.verifyToken(token);
    assert.strictEqual(await authService.isTokenRevoked(jti), false);
    await authService.revokeToken(jti, "u1", Date.now() + 3600000);
    assert.strictEqual(await authService.isTokenRevoked(jti), true);

    let code = null;
    const res = {
      status: (c) => { code = c; return { json: () => {} }; },
      json: () => {},
    };
    await authController.sessionStatus({ cookies: { afrexpay_session: token } }, res);
    assert.strictEqual(code, 401, "probe and data endpoints must agree");
  } finally {
    restore();
  }
});
