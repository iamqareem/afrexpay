// migrations/1789709203218_payments-ledger-hardening.js
//
// The original UNIQUE(provider, provider_reference) covered rows of every
// status — including 'failed' audit rows. An underpaid/currency-mismatched
// attempt inserts 'failed' under the same reference a later legitimate
// retry needs, so the retry's 'succeeded' insert hits 23505 and the
// customer stays 'pending' forever despite paying in full. Scope the
// uniqueness guarantee to what it actually protects (exactly-once
// 'succeeded' recording under at-least-once webhook delivery) and let
// 'failed' rows use distinct references (see mark*Paid).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_provider_reference_key;
    CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_succeeded_uniq
      ON payments (provider, provider_reference) WHERE status = 'succeeded';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS payments_provider_reference_succeeded_uniq;
    ALTER TABLE payments ADD CONSTRAINT payments_provider_provider_reference_key UNIQUE (provider, provider_reference);
  `);
};
