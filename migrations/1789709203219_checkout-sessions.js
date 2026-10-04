// migrations/1789709203219_checkout-sessions.js
//
// Re-checkout overwrites the entity's *_checkout_session_id column, which
// orphans the previous provider session: it stays payable at Stripe/PayPal,
// but its webhook matches zero rows and the customer is charged while the
// order stays 'pending'. This history table records EVERY issued session so
// webhooks resolve against all of them, not just the current one.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS checkout_sessions (
      provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paypal')),
      session_id TEXT NOT NULL,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('order', 'booking', 'listing_reservation')),
      entity_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (provider, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_checkout_sessions_entity ON checkout_sessions (tenant_id, entity_type, entity_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS checkout_sessions;
  `);
};
