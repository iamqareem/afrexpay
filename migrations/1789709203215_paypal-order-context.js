// migrations/1789709203215_paypal-order-context.js
// Scope: Create paypal_order_context table for tracking PayPal Order ID -> entity context mapping

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS paypal_order_context (
      paypal_order_id TEXT PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('order', 'booking', 'listing_reservation')),
      entity_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_paypal_order_context_tenant ON paypal_order_context(tenant_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS paypal_order_context;
  `);
};
