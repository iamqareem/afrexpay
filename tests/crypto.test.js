// tests/crypto.test.js — payment-credential encryption (src/lib/crypto.js).
// The key is read from env per call, so each test sets it explicitly.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const GOOD_KEY = crypto.randomBytes(32).toString("hex");
const OTHER_KEY = crypto.randomBytes(32).toString("hex");

function withKey(key, fn) {
  const prev = process.env.PAYMENT_ENCRYPTION_KEY;
  process.env.PAYMENT_ENCRYPTION_KEY = key;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PAYMENT_ENCRYPTION_KEY;
    else process.env.PAYMENT_ENCRYPTION_KEY = prev;
  }
}

test("encrypt/decrypt round-trips a Stripe secret", () => {
  const { encrypt, decrypt } = require("../src/lib/crypto");
  withKey(GOOD_KEY, () => {
    const cipher = encrypt("sk_test_12345");
    assert.notEqual(cipher, "sk_test_12345");
    assert.equal(decrypt(cipher), "sk_test_12345");
  });
});

test("two encryptions of the same value differ (random IV)", () => {
  const { encrypt } = require("../src/lib/crypto");
  withKey(GOOD_KEY, () => {
    assert.notEqual(encrypt("sk_test_same"), encrypt("sk_test_same"));
  });
});

test("tampered ciphertext is rejected (GCM auth tag)", () => {
  const { encrypt, decrypt } = require("../src/lib/crypto");
  withKey(GOOD_KEY, () => {
    const cipher = encrypt("sk_test_12345");
    const tampered = cipher.slice(0, -4) + "AAAA";
    assert.throws(() => decrypt(tampered));
  });
});

test("decryption with the wrong key is rejected", () => {
  const { encrypt, decrypt } = require("../src/lib/crypto");
  const cipher = withKey(GOOD_KEY, () => encrypt("sk_test_12345"));
  withKey(OTHER_KEY, () => {
    assert.throws(() => decrypt(cipher));
  });
});

test("missing or short key throws a helpful error", () => {
  const { encrypt } = require("../src/lib/crypto");
  const prev = process.env.PAYMENT_ENCRYPTION_KEY;
  delete process.env.PAYMENT_ENCRYPTION_KEY;
  try {
    assert.throws(() => encrypt("x"), /PAYMENT_ENCRYPTION_KEY/);
    process.env.PAYMENT_ENCRYPTION_KEY = "too-short";
    assert.throws(() => encrypt("x"), /64-character hex/);
  } finally {
    if (prev === undefined) delete process.env.PAYMENT_ENCRYPTION_KEY;
    else process.env.PAYMENT_ENCRYPTION_KEY = prev;
  }
});
