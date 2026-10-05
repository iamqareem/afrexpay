// src/lib/flag-cancelled-payment.js
//
// When a verified provider webhook arrives for an entity that is already
// cancelled, mark*Paid correctly refuses to confirm — but the customer may
// still have been charged at the provider. That needs a human (refund),
// not silence: log loudly with everything ops needs to find the money.
// Table/column names are whitelisted, never interpolated from input.
// Scope: orders + bookings only — listing_reservations has no status
// lifecycle (no cancelled state exists to guard), so there is nothing to
// flag there; the TABLES whitelist intentionally excludes it.
const pool = require("../db/pool");

const TABLES = {
  orders: { entityType: "order", sessionFields: new Set(["stripe_checkout_session_id", "paypal_checkout_session_id"]) },
  bookings: { entityType: "booking", sessionFields: new Set(["stripe_checkout_session_id", "paypal_checkout_session_id"]) },
};

async function flagCancelledPayment({ tenantId, sessionId, provider, table, sessionIdField }) {
  try {
    const config = TABLES[table];
    if (!config || !config.sessionFields.has(sessionIdField)) return;
    const { rows } = await pool.query(
      `SELECT id FROM ${table}
       WHERE tenant_id = $1 AND status = 'cancelled'
         AND (${sessionIdField} = $2 OR id IN (
           SELECT entity_id FROM checkout_sessions
           WHERE provider = $3 AND session_id = $2 AND tenant_id = $1 AND entity_type = $4
         ))`,
      [tenantId, sessionId, provider, config.entityType]
    );
    for (const row of rows) {
      console.error(
        `PAID-AFTER-CANCEL: ${provider} webhook for cancelled ${config.entityType} ${row.id} (tenant ${tenantId}). ` +
        `Funds may have moved — review and refund if so.`
      );
    }
  } catch (err) {
    console.error("flagCancelledPayment lookup failed:", err.message);
  }
}

module.exports = { flagCancelledPayment };
