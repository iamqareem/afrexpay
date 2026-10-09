// migrations/1791557487982_catalog-slugs.js
//
// Crawlable detail URLs (/p/:slug, /s/:slug, /l/:slug) need a stable,
// human-readable key per catalog row. Slugs are generated from name/title
// at create time (see src/lib/slug.js), stable afterwards so indexed URLs
// never rot when a merchant renames something. Uniqueness is per tenant —
// two stores can both have /p/arabica-coffee, they live on different hosts.
//
// Backfill appends '-' + the first 8 uuid chars so pre-existing rows with
// identical names in one store can't collide with each other.
const BACKFILL = (table, source) => `
  UPDATE ${table}
  SET slug = LEFT(
    COALESCE(
      NULLIF(regexp_replace(lower(regexp_replace(${source}, '[^a-zA-Z0-9]+', '-', 'g')), '(^-+|-+$)', '', 'g'), ''),
      'item'
    ) || '-' || LEFT(id::text, 8),
    90
  )
  WHERE slug IS NULL;
`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS slug TEXT;
    ALTER TABLE services ADD COLUMN IF NOT EXISTS slug TEXT;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS slug TEXT;
  `);
  pgm.sql(BACKFILL("products", "name"));
  pgm.sql(BACKFILL("services", "name"));
  pgm.sql(BACKFILL("listings", "title"));
  pgm.sql(`
    ALTER TABLE products ADD CONSTRAINT products_slug_format_check
      CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
    ALTER TABLE services ADD CONSTRAINT services_slug_format_check
      CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
    ALTER TABLE listings ADD CONSTRAINT listings_slug_format_check
      CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_slug ON products (tenant_id, slug);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_services_tenant_slug ON services (tenant_id, slug);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_tenant_slug ON listings (tenant_id, slug);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_products_tenant_slug;
    DROP INDEX IF EXISTS idx_services_tenant_slug;
    DROP INDEX IF EXISTS idx_listings_tenant_slug;
    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_slug_format_check;
    ALTER TABLE services DROP CONSTRAINT IF EXISTS services_slug_format_check;
    ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_slug_format_check;
    ALTER TABLE products DROP COLUMN IF EXISTS slug;
    ALTER TABLE services DROP COLUMN IF EXISTS slug;
    ALTER TABLE listings DROP COLUMN IF EXISTS slug;
  `);
};
