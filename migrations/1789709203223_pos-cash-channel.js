// migrations/1789709203223_pos-cash-channel.js
//
// Point-of-sale tender: cash/offline collections need a ledger identity
// ('cash') and POS-originated orders need a channel marker ('pos') so the
// Orders list can badge them and reporting can split by channel.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_check;
    ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider IN ('stripe', 'paypal', 'cash'));
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'storefront';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE orders DROP COLUMN IF EXISTS channel;
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_check;
    ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider IN ('stripe', 'paypal'));
  `);
};
