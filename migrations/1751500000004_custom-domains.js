// migrations/1751500000003_custom-domains.js
// Adds the two columns that back the custom domain feature:
//   custom_domain            — the raw hostname string (e.g. "shop.256estates.com")
//                             UNIQUE so no two tenants can claim the same domain.
//   custom_domain_verified_at — NULL means "claimed but not yet verified via DNS";
//                             non-NULL means ownership has been confirmed and
//                             Caddy is allowed to issue a cert for this hostname.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tenants ADD COLUMN custom_domain TEXT UNIQUE;
    ALTER TABLE tenants ADD COLUMN custom_domain_verified_at TIMESTAMPTZ;
    CREATE INDEX idx_tenants_custom_domain ON tenants (custom_domain);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_tenants_custom_domain;
    ALTER TABLE tenants DROP COLUMN IF EXISTS custom_domain_verified_at;
    ALTER TABLE tenants DROP COLUMN IF EXISTS custom_domain;
  `);
};
