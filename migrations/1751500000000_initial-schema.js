// migrations/1751500000000_initial-schema.js
//
// Consolidated from what was previously 5 incremental migrations, collapsed
// into one now that nothing is in production — no live data to migrate
// around, so there's no value in preserving the incremental history. This
// is the full schema as of today, written directly rather than replayed.
//
// One deliberate design change from the original incremental version: media
// is fully polymorphic from the start. There is no product_id column and no
// products.image_path column — products link to their photos through
// entity_type='product' + entity_id exactly the same way services and
// listings do. The original build special-cased products (a single
// image_path column, plus a product_id shorthand on uploads) because
// products came first and services/listings were added later; keeping that
// special case around after listings proved the polymorphic pattern works
// was accumulating debt for no real benefit. Pre-production is exactly the
// right time to remove it, before any merchant's product photos are stored
// under the old shape.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
    CREATE EXTENSION IF NOT EXISTS btree_gist; -- needed for the bookings exclusion constraint below

    -- ---- tenants & auth ----
    CREATE TYPE tenant_status AS ENUM ('trial', 'active', 'suspended', 'cancelled');

    CREATE TABLE tenants (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subdomain       TEXT NOT NULL UNIQUE,
      business_name   TEXT NOT NULL,
      status          tenant_status NOT NULL DEFAULT 'trial',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_tenants_subdomain ON tenants (subdomain);

    CREATE TYPE user_role AS ENUM ('owner', 'staff');

    CREATE TABLE users (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      role            user_role NOT NULL DEFAULT 'owner',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at   TIMESTAMPTZ
    );
    CREATE INDEX idx_users_tenant_id ON users (tenant_id);

    CREATE TABLE password_reset_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens (user_id);

    -- ---- store config ----
    -- config.vertical ('products' | 'services' | 'listings') and theme_slug
    -- drive which dashboard tabs and storefront theme a tenant gets — see
    -- src/verticals.js for the registry that validates both against a known
    -- set before either ever decides what runs.
    CREATE TABLE store_configs (
      tenant_id       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      config          JSONB NOT NULL DEFAULT '{"vertical": "products"}'::jsonb,
      theme_slug      TEXT NOT NULL DEFAULT 'hangtag',
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ---- products & orders ----
    CREATE TABLE products (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sku             TEXT NOT NULL,
      name            TEXT NOT NULL,
      category        TEXT,
      price_minor     INTEGER NOT NULL,
      currency        CHAR(3) NOT NULL DEFAULT 'UGX',
      sizes           TEXT[] NOT NULL DEFAULT '{}',
      stock_qty       INTEGER,          -- null = untracked, otherwise decremented on order
      blurb           TEXT,
      active          BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, sku)
    );
    CREATE INDEX idx_products_tenant_id ON products (tenant_id) WHERE active;

    CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'fulfilled', 'cancelled');

    CREATE TABLE orders (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      customer_name   TEXT NOT NULL,
      phone           TEXT NOT NULL,
      address         TEXT NOT NULL,
      delivery_notes  TEXT,
      status          order_status NOT NULL DEFAULT 'pending',
      total_minor     INTEGER NOT NULL,
      currency        CHAR(3) NOT NULL DEFAULT 'UGX',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_orders_tenant_id ON orders (tenant_id);
    CREATE INDEX idx_orders_created_at ON orders (created_at DESC);

    CREATE TABLE order_items (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id        UUID NOT NULL REFERENCES products(id),
      product_name      TEXT NOT NULL,   -- snapshot at order time — survives product edits/deletes
      size              TEXT NOT NULL,
      qty               INTEGER NOT NULL CHECK (qty > 0),
      unit_price_minor  INTEGER NOT NULL -- snapshot, never re-read live product price after the fact
    );
    CREATE INDEX idx_order_items_order_id ON order_items (order_id);

    -- ---- services, availability & bookings ----
    CREATE TABLE services (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      description       TEXT,
      duration_minutes  INTEGER NOT NULL CHECK (duration_minutes > 0),
      price_minor       INTEGER NOT NULL,
      currency          CHAR(3) NOT NULL DEFAULT 'UGX',
      active            BOOLEAN NOT NULL DEFAULT true,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_services_tenant_id ON services (tenant_id) WHERE active;

    CREATE TABLE availability_windows (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, matches EXTRACT(DOW FROM ...)
      start_time    TIME NOT NULL,
      end_time      TIME NOT NULL CHECK (end_time > start_time),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_availability_windows_tenant_id ON availability_windows (tenant_id);

    CREATE TABLE availability_exceptions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      date          DATE NOT NULL,
      is_available  BOOLEAN NOT NULL DEFAULT false,
      start_time    TIME,
      end_time      TIME,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, date)
    );

    CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');

    CREATE TABLE bookings (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      service_id        UUID NOT NULL REFERENCES services(id),
      customer_name     TEXT NOT NULL,
      phone             TEXT NOT NULL,
      notes             TEXT,
      status            booking_status NOT NULL DEFAULT 'pending',
      price_minor       INTEGER NOT NULL,
      currency          CHAR(3) NOT NULL DEFAULT 'UGX',
      time_range        TSTZRANGE NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- The core guarantee: Postgres itself refuses two overlapping,
      -- non-cancelled bookings for the same tenant. See README "Services &
      -- bookings" for how this was tested directly against the constraint.
      EXCLUDE USING gist (tenant_id WITH =, time_range WITH &&) WHERE (status != 'cancelled')
    );
    CREATE INDEX idx_bookings_tenant_id ON bookings (tenant_id);
    CREATE INDEX idx_bookings_service_id ON bookings (service_id);
    CREATE INDEX idx_bookings_time_range ON bookings USING gist (time_range);

    -- ---- real estate listings & inquiries ----
    CREATE TYPE listing_type AS ENUM ('sale', 'rent');
    CREATE TYPE listing_status AS ENUM ('active', 'pending', 'sold', 'rented', 'off_market');

    CREATE TABLE listings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      description     TEXT,
      listing_type    listing_type NOT NULL,
      status          listing_status NOT NULL DEFAULT 'active',
      price_minor     INTEGER NOT NULL,
      currency        CHAR(3) NOT NULL DEFAULT 'UGX',
      bedrooms        SMALLINT,
      bathrooms       SMALLINT,
      area_sqm        INTEGER,
      location        TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_listings_tenant_id ON listings (tenant_id) WHERE status = 'active';

    CREATE TABLE inquiries (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      listing_id    UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      phone         TEXT NOT NULL,
      message       TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_inquiries_tenant_id ON inquiries (tenant_id);
    CREATE INDEX idx_inquiries_listing_id ON inquiries (listing_id);

    -- ---- media — fully polymorphic, no per-vertical special case ----
    -- Every photo, for every vertical, links the same way: entity_type +
    -- entity_id. Products, services, and listings are all "just an entity"
    -- to this table — there is no image_path column anywhere else in the
    -- schema, and no product_id shorthand here. One code path, one mental
    -- model, regardless of which vertical a tenant is on.
    CREATE TABLE media (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entity_type     TEXT NOT NULL CHECK (entity_type IN ('product', 'service', 'listing', 'unassigned')),
      entity_id       UUID,
      storage_path    TEXT NOT NULL,
      mime_type       TEXT NOT NULL,
      width           INTEGER,
      height          INTEGER,
      size_bytes      INTEGER,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_media_entity ON media (entity_type, entity_id);
    CREATE INDEX idx_media_tenant_id ON media (tenant_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS media;
    DROP TABLE IF EXISTS inquiries;
    DROP TABLE IF EXISTS listings;
    DROP TYPE IF EXISTS listing_status;
    DROP TYPE IF EXISTS listing_type;
    DROP TABLE IF EXISTS bookings;
    DROP TYPE IF EXISTS booking_status;
    DROP TABLE IF EXISTS availability_exceptions;
    DROP TABLE IF EXISTS availability_windows;
    DROP TABLE IF EXISTS services;
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders;
    DROP TYPE IF EXISTS order_status;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS store_configs;
    DROP TABLE IF EXISTS password_reset_tokens;
    DROP TABLE IF EXISTS users;
    DROP TYPE IF EXISTS user_role;
    DROP TABLE IF EXISTS tenants;
    DROP TYPE IF EXISTS tenant_status;
  `);
};
