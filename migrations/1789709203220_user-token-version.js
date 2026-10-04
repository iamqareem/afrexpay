// migrations/1789709203220_user-token-version.js
//
// Session revocation: a `token_version` on users, mirrored into every JWT
// as `tv`. Password reset bumps it, which invalidates all previously
// issued sessions — before this, a stolen session survived resets for the
// full 7-day token life.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users DROP COLUMN IF EXISTS token_version;
  `);
};
