// src/modules/payments/checkout-sessions.service.js
//
// History of every provider checkout session ever issued, across rotations.
// mark*Paid matches webhooks against this table (not just the entity's
// current session column), so a customer who pays on a superseded Stripe
// URL is still credited instead of charged-while-pending.
const pool = require("../../db/pool");

const VALID_ENTITY_TYPES = new Set(["order", "booking", "listing_reservation"]);
const VALID_PROVIDERS = new Set(["stripe", "paypal"]);

async function recordCheckoutSession(provider, sessionId, tenantId, entityType, entityId) {
  if (!VALID_PROVIDERS.has(provider) || !sessionId || !tenantId || !entityId || !VALID_ENTITY_TYPES.has(entityType)) {
    throw Object.assign(
      new Error("provider (stripe|paypal), sessionId, tenantId, entityType and entityId are required."),
      { status: 400 }
    );
  }
  await pool.query(
    `INSERT INTO checkout_sessions (provider, session_id, tenant_id, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, session_id) DO NOTHING`,
    [provider, sessionId, tenantId, entityType, entityId]
  );
}

module.exports = { recordCheckoutSession };
