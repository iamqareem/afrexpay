// src/modules/payments/credentials.service.js
const pool = require("../../db/pool");
const { encrypt, decrypt } = require("../../lib/crypto");

// Never returns decrypted secrets to the caller by default — the dashboard
// only ever needs to know a key is set and show the publishable key
// (which is meant to be public). Decryption only happens where a secret is
// actually about to be used to call Stripe (checkout session creation,
// webhook verification), never for display.
async function getCredentialsSummary(tenantId, provider) {
  const { rows } = await pool.query(
    `SELECT provider, publishable_key, mode, enabled,
            (secret_key_encrypted IS NOT NULL) AS has_secret_key,
            (webhook_secret_encrypted IS NOT NULL) AS has_webhook_secret
     FROM payment_credentials WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider]
  );
  return rows[0] || null;
}

async function getDecryptedCredentials(tenantId, provider) {
  const { rows } = await pool.query(
    `SELECT secret_key_encrypted, publishable_key, webhook_secret_encrypted, mode, enabled
     FROM payment_credentials WHERE tenant_id = $1 AND provider = $2 AND enabled = true`,
    [tenantId, provider]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    secretKey: row.secret_key_encrypted ? decrypt(row.secret_key_encrypted) : null,
    publishableKey: row.publishable_key,
    webhookSecret: row.webhook_secret_encrypted ? decrypt(row.webhook_secret_encrypted) : null,
    mode: row.mode,
  };
}

async function upsertCredentials(tenantId, provider, { secretKey, publishableKey, webhookSecret, mode, enabled }) {
  // Read the existing row first and merge in JS, rather than trying to
  // make one SQL statement serve two different defaulting rules at once
  // (a brand-new row needs real defaults for NOT NULL columns; an existing
  // row needs untouched fields left alone) — that combination doesn't
  // resolve cleanly through COALESCE against the same bound parameter, so
  // explicit merge here is both simpler and actually correct.
  const { rows: existingRows } = await pool.query(
    `SELECT secret_key_encrypted, publishable_key, webhook_secret_encrypted, mode, enabled
     FROM payment_credentials WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider]
  );
  const existing = existingRows[0];

  const merged = {
    secretKeyEncrypted: secretKey ? encrypt(secretKey) : (existing ? existing.secret_key_encrypted : null),
    publishableKey: publishableKey !== undefined ? publishableKey : (existing ? existing.publishable_key : null),
    webhookSecretEncrypted: webhookSecret ? encrypt(webhookSecret) : (existing ? existing.webhook_secret_encrypted : null),
    // A credential set is never live-by-accident: defaults to 'test' mode
    // and enabled=false on first creation, only changes when explicitly
    // provided, same principle either way.
    mode: mode !== undefined ? mode : (existing ? existing.mode : "test"),
    enabled: enabled !== undefined ? enabled : (existing ? existing.enabled : false),
  };

  const { rows } = await pool.query(
    `INSERT INTO payment_credentials (tenant_id, provider, secret_key_encrypted, publishable_key, webhook_secret_encrypted, mode, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       secret_key_encrypted = $3, publishable_key = $4, webhook_secret_encrypted = $5,
       mode = $6, enabled = $7, updated_at = now()
     RETURNING provider, publishable_key, mode, enabled`,
    [tenantId, provider, merged.secretKeyEncrypted, merged.publishableKey, merged.webhookSecretEncrypted, merged.mode, merged.enabled]
  );
  return rows[0];
}

module.exports = { getCredentialsSummary, getDecryptedCredentials, upsertCredentials };
