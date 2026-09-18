// migrations/1751500000002_multi-vertical-payments.js
// Scope: Extending Stripe payments to Products (orders) and Services (bookings) verticals

exports.up = (pgm) => {
  pgm.sql(`
    -- Add payment_status and stripe_checkout_session_id to orders
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT UNIQUE;

    -- Add payment_status and stripe_checkout_session_id to bookings
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT UNIQUE;

    -- Update payments ledger constraint to allow entity_type IN ('listing_reservation', 'order', 'booking')
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_entity_type_check;
    ALTER TABLE payments ADD CONSTRAINT payments_entity_type_check CHECK (entity_type IN ('listing_reservation', 'order', 'booking'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE orders DROP COLUMN IF EXISTS stripe_checkout_session_id;
    ALTER TABLE orders DROP COLUMN IF EXISTS payment_status;
    ALTER TABLE bookings DROP COLUMN IF EXISTS stripe_checkout_session_id;
    ALTER TABLE bookings DROP COLUMN IF EXISTS payment_status;
  `);
};
