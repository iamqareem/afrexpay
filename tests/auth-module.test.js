// tests/auth-module.test.js
//
// Auth module round: canonical emails, format rejection, reset-token hygiene.
// DB-free via stubbed pool.
const { test } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-auth-module";

const pool = require("../src/db/pool");
const controller = require("../src/modules/auth/auth.controller");
const authService = require("../src/modules/auth/auth.service");

function mockRes() {
  const res = { statusCode: 200, body: null, cookies: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.cookie = (k, v) => { res.cookies[k] = v; return res; };
  return res;
}

test("EMAIL_RE accepts real addresses, rejects junk", () => {
  const { EMAIL_RE } = controller;
  for (const good of ["a@b.co", "Name@Example.COM", "x+y@sub.domain.org"]) {
    assert.ok(EMAIL_RE.test(good), good);
  }
  for (const bad of ["", "foo", "a@b", "a b@c.co", "@c.co", "a@"]) {
    assert.ok(!EMAIL_RE.test(bad), JSON.stringify(bad));
  }
});

test("signup stores the canonical email and rejects malformed ones", async () => {
  const calls = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text, values) => {
      calls.push({ text, values });
      if (/INSERT INTO tenants/.test(text)) return { rows: [{ id: "t1", subdomain: "my-shop" }] };
      if (/INSERT INTO users/.test(text)) return { rows: [{ id: "u1" }] };
      if (/INSERT INTO store_configs/.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    const res = mockRes();
    await controller.signup({
      body: { businessName: "B", subdomain: "my-shop", email: "  Admin@Example.COM ", password: "Str0ng!Pass" },
      headers: { host: "afrexpay.com" },
    }, res);
    assert.strictEqual(res.statusCode, 201);
    const userInsert = calls.find((c) => /INSERT INTO users/.test(c.text));
    assert.strictEqual(userInsert.values[1], "admin@example.com");

    const bad = mockRes();
    await controller.signup({
      body: { businessName: "B", subdomain: "my-shop", email: "not-an-email", password: "Str0ng!Pass" },
      headers: { host: "afrexpay.com" },
    }, bad);
    assert.strictEqual(bad.statusCode, 400);
  } finally {
    pool.connect = originalConnect;
  }
});

test("createPasswordResetToken purges spent/expired tokens before issuing", async () => {
  const calls = [];
  const original = pool.query;
  pool.query = async (text) => {
    calls.push(text);
    if (/SELECT id FROM users/.test(text)) return { rows: [{ id: "u1" }] };
    return { rows: [] };
  };
  try {
    const token = await authService.createPasswordResetToken("a@b.co");
    assert.ok(token);
    const purgeIdx = calls.findIndex((t) => /DELETE FROM password_reset_tokens WHERE user_id/.test(t));
    const insertIdx = calls.findIndex((t) => /INSERT INTO password_reset_tokens/.test(t));
    assert.ok(purgeIdx !== -1 && insertIdx !== -1 && purgeIdx < insertIdx, "purge must precede issue");
    assert.match(calls[purgeIdx], /used_at IS NOT NULL OR expires_at <= now\(\)/);
  } finally {
    pool.query = original;
  }
});

test("successful reset kills sibling reset links", async () => {
  const calls = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text) => {
      calls.push(text);
      if (/UPDATE password_reset_tokens SET used_at/.test(text)) {
        return { rows: [{ id: "tok-1", user_id: "u1" }] };
      }
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    const ok = await authService.resetPasswordWithToken("a".repeat(64), "An0ther!Strong");
    assert.strictEqual(ok, true);
    assert.ok(
      calls.some((t) => /DELETE FROM password_reset_tokens WHERE user_id/.test(t) && /id !=/.test(t)),
      "sibling links must die with the password change"
    );
  } finally {
    pool.connect = originalConnect;
  }
});
