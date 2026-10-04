// src/modules/payments/paypal-context.service.js
//
// Maps a PayPal order id to the platform entity it pays for, so the
// webhook can credit the right row. PayPal's webhook payload carries no
// merchant metadata, only its own order/capture ids — without this table
// the webhook would have to guess which order/booking/reservation an
// incoming capture belongs to.
//
// Table (migrations/1789709203215_paypal-order-context.js):
//   paypal_order_context(paypal_order_id PK, tenant_id, entity_type, entity_id)
const pool = require("../../db/pool");

const VALID_ENTITY_TYPES = new Set(["order", "booking", "listing_reservation"]);

// Written once per PayPal checkout creation, keyed by PayPal's own order
// id (the `sessionId` returned by createCheckoutSession for provider
// "paypal"). Re-writing the same PayPal order id refreshes the mapping
// rather than failing — checkout creation is retryable by design.
async function savePayPalOrderContext(paypalOrderId, tenantId, entityType, entityId) {
  if (!paypalOrderId || !tenantId || !entityId || !VALID_ENTITY_TYPES.has(entityType)) {
    throw Object.assign(
      new Error("paypalOrderId, tenantId, entityType (order|booking|listing_reservation) and entityId are required."),
      { status: 400 }
    );
  }
  await pool.query(
    `INSERT INTO paypal_order_context (paypal_order_id, tenant_id, entity_type, entity_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (paypal_order_id)
     DO UPDATE SET tenant_id = $2, entity_type = $3, entity_id = $4`,
    [paypalOrderId, tenantId, entityType, entityId]
  );
}

// Read by the webhook to resolve an incoming capture to its entity.
// Returns null (not throws) when unknown — the caller falls back to
// direct session-column matching instead of 500ing the webhook.
async function getPayPalOrderContext(paypalOrderId) {
  if (!paypalOrderId) return null;
  const { rows } = await pool.query(
    `SELECT paypal_order_id, tenant_id, entity_type, entity_id
     FROM paypal_order_context WHERE paypal_order_id = $1`,
    [paypalOrderId]
  );
  return rows[0] || null;
}

module.exports = { savePayPalOrderContext, getPayPalOrderContext };
