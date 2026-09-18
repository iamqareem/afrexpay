// migrations/1789709203213_add-paypal-support.js
// Scope: Add PayPal support — new session ID columns, drop provider CHECK constraints

exports.up = (pgm) => {
  pgm.sql(`
    -- Add PayPal checkout session ID columns to orders
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_checkout_session_id TEXT UNIQUE;

    -- Add PayPal checkout session ID columns to bookings
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paypal_checkout_session_id TEXT UNIQUE;

    -- Add PayPal checkout session ID columns to listing_reservations
    ALTER TABLE listing_reservations ADD COLUMN IF NOT EXISTS paypal_checkout_session_id TEXT UNIQUE;

    -- Drop the provider CHECK constraint on payment_credentials to allow
    -- any provider registered in the code registry (verticals.js style).
    -- The registry becomes the single validation point.
    ALTER TABLE payment_credentials DROP CONSTRAINT IF EXISTS payment_credentials_provider_check;

    -- Drop the provider CHECK constraint on payments for the same reason.
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_check;

    -- Add CHECK constraints that only ensure provider is not empty,
    -- validation of known providers happens in the code registry.
    ALTER TABLE payment_credentials ADD CONSTRAINT payment_credentials_provider_not_empty CHECK (provider <> '');
    ALTER TABLE payments ADD CONSTRAINT payments_provider_not_empty CHECK (provider <> '');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE orders DROP COLUMN IF EXISTS paypal_checkout_session_id;
    ALTER TABLE bookings DROP COLUMN IF EXISTS paypal_checkout_session_id;
    ALTER TABLE listing_reservations DROP COLUMN IF EXISTS paypal_checkout_session_id;

    ALTER TABLE payment_credentials DROP CONSTRAINT IF EXISTS payment_credentials_provider_not_empty;
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_not_empty;

    -- Note: Re-adding the original CHECK constraints would require
    -- knowing the exact provider list at migration time. For rollback,
    -- the application code registry still validates providers.
  `);
};