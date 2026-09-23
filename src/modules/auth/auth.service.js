// src/modules/auth/auth.service.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const pool = require("../../db/pool");

const { resolveVertical, isThemeCompatible, VERTICALS } = require("../../verticals");

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = "7d";

async function createTenantWithOwner({ businessName, subdomain, email, password, vertical, themeSlug }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const resolvedVertical = resolveVertical(vertical);
  const selectedTheme = (themeSlug && isThemeCompatible(resolvedVertical, themeSlug))
    ? themeSlug
    : VERTICALS[resolvedVertical].compatibleThemes[0];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(
      `INSERT INTO tenants (subdomain, business_name) VALUES ($1, $2) RETURNING id, subdomain`,
      [subdomain, businessName]
    );
    const tenant = tenantResult.rows[0];

    await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'owner')`,
      [tenant.id, email, passwordHash]
    );

    // Seed store_configs with the selected vertical and theme_slug
    await client.query(
      `INSERT INTO store_configs (tenant_id, config, theme_slug) VALUES ($1, $2::jsonb, $3)`,
      [tenant.id, JSON.stringify({ vertical: resolvedVertical }), selectedTheme]
    );

    await client.query("COMMIT");
    return tenant;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function verifyLogin({ email, password }) {
  const { rows } = await pool.query(
    `SELECT u.id, u.tenant_id, u.password_hash, u.role, t.subdomain
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE LOWER(u.email) = LOWER($1)`,
    [email]
  );
  const user = rows[0];
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  return { userId: user.id, tenantId: user.tenant_id, subdomain: user.subdomain, role: user.role };
}

function issueToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // throws if invalid/expired
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Returns the raw token to send by email, or null if the email doesn't
// match any account — the caller must respond identically either way, so a
// bad actor can't use this endpoint to discover which emails are registered.
async function createPasswordResetToken(email) {
  const { rows } = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
  const user = rows[0];
  if (!user) return null;

  const rawToken = crypto.randomBytes(32).toString("hex");
  // Only the hash is stored — a database leak alone can't be used to reset
  // anyone's password, the raw token only ever exists in the emailed link.
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );
  return rawToken;
}

async function resetPasswordWithToken(rawToken, newPassword) {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Atomic: claim the token only if still unused and not expired. The
    // FOR UPDATE locks the row so concurrent POSTs with the same token
    // cannot both succeed; the second sees used_at already set and gets 0 rows.
    const { rows } = await client.query(
      `UPDATE password_reset_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING id, user_id`,
      [tokenHash]
    );
    const record = rows[0];
    if (!record) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, record.user_id]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createTenantWithOwner, verifyLogin, issueToken, verifyToken,
  createPasswordResetToken, resetPasswordWithToken,
};
