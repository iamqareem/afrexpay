// migrations/1751500000001_payments.js
//
// Scope: Stripe + listings deposit, end to end. PayPal and payments on
// products/bookings extend this same shape later — not built here.
//
// Design decision worth flagging explicitly (not made silently): a
// reservation deposit is NOT an extension of `inquiries`. An inquiry is a
// plain lead — no money, no state beyond "sent." A deposit is a paid hold
// on a listing, closer in shape to a booking than to a lead. Rather than
// overload `inquiries` with optional payment fields (mixing two different
// meanings in one table depending on which columns are populated),
// `listing_reservations` is its own table — same reasoning that already
// kept services out of `products` and kept media polymorphic instead of
// special-cased per vertical.

exports.up = (pgm) => {
  pgm.sql(`
    -- ---- per-tenant payment provider credentials ----
    -- Bring-your-own-keys, not Stripe Connect: each tenant pastes their own
    -- account's keys. secret_key and webhook_secret are stored encrypted
    -- (see src/lib/crypto.js) — this table holds live financial
    -- credentials, a materially higher-stakes secret than anything else
    -- this schema has stored so far (JWT_SECRET etc. are server-side env
    -- vars, never in the DB at all).
    CREATE TABLE payment_credentials (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider                TEXT NOT NULL CHECK (provider IN ('stripe', 'paypal')),
      secret_key_encrypted    TEXT,          -- Stripe secret key (sk_...), encrypted
      publishable_key         TEXT,          -- Stripe publishable key (pk_...) — not sensitive, safe to return to the client
      webhook_secret_encrypted TEXT,         -- used to verify this tenant's webhook signature
      mode                    TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
      enabled                 BOOLEAN NOT NULL DEFAULT false,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, provider)
    );

    -- ---- listings: deposit is opt-in, per listing ----
    -- Nullable and additive — a listing with no deposit_amount_minor set
    -- behaves exactly as before (plain inquiry form, no payment step).
    -- Nothing about existing listings changes unless a merchant sets this.
    ALTER TABLE listings ADD COLUMN deposit_amount_minor INTEGER;

    -- ---- listing reservations — a paid hold, not a lead ----
    CREATE TABLE listing_reservations (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      listing_id            UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      name                  TEXT NOT NULL,
      phone                 TEXT NOT NULL,
      message               TEXT,
      deposit_amount_minor  INTEGER NOT NULL,  -- snapshot at reservation time — a later listing price/deposit edit never rewrites history
      currency              CHAR(3) NOT NULL DEFAULT 'UGX',
      payment_status        TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
      stripe_checkout_session_id TEXT UNIQUE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_listing_reservations_tenant_id ON listing_reservations (tenant_id);
    CREATE INDEX idx_listing_reservations_listing_id ON listing_reservations (listing_id);

    -- ---- payments: a polymorphic transaction ledger ----
    -- Same entity_type/entity_id pattern already proven for the media
    -- table —
    -- covers listing_reservations today, extends to orders/bookings later
    -- without a new table per vertical. provider_reference is UNIQUE so a
    -- webhook that fires more than once (Stripe does not guarantee
    -- exactly-once delivery) can't record the same payment twice.
    CREATE TABLE payments (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entity_type         TEXT NOT NULL CHECK (entity_type IN ('listing_reservation')),
      entity_id           UUID NOT NULL,
      provider            TEXT NOT NULL CHECK (provider IN ('stripe', 'paypal')),
      provider_reference  TEXT NOT NULL,
      amount_minor        INTEGER NOT NULL,
      currency            CHAR(3) NOT NULL DEFAULT 'UGX',
      status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
      raw_event           JSONB,          -- latest webhook payload, for support/debugging a flow that's otherwise a black box
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider, provider_reference)
    );
    CREATE INDEX idx_payments_tenant_id ON payments (tenant_id);
    CREATE INDEX idx_payments_entity ON payments (entity_type, entity_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS payments;
    DROP TABLE IF EXISTS listing_reservations;
    ALTER TABLE listings DROP COLUMN IF EXISTS deposit_amount_minor;
    DROP TABLE IF EXISTS payment_credentials;
  `);
};
