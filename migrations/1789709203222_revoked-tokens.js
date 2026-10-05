// migrations/1789709203222_revoked-tokens.js
//
// Per-device logout: every JWT carries a jti; logout records it here so
// that exact session dies immediately while sibling sessions (other
// devices) keep working. Rows carry the token's own expiry and are
// reaped on every revoke call, so the table stays tiny.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens (expires_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS revoked_tokens;
  `);
};
