// src/lib/crypto.js
//
// Encrypts secrets before they're stored in payment_credentials — a raw
// Stripe secret key sitting in plaintext in a TEXT column is a real
// liability the moment a DB backup exists anywhere. This requires a
// server-side master key (PAYMENT_ENCRYPTION_KEY, 32 bytes / 64 hex chars)
// that lives in .env, never in the database — the same trust boundary as
// JWT_SECRET, one level more serious since this protects money-moving
// credentials, not just sessions.
const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function getKey() {
  const keyHex = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      "PAYMENT_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(keyHex, "hex");
}

// Returns a single string: iv, authTag, and ciphertext concatenated and
// base64-encoded, so it fits in one TEXT column with no extra columns to
// keep in sync.
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(encoded) {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
