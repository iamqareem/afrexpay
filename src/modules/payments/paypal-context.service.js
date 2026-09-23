// src/modules/payments/paypal-context.service.js
const pool = require("../../db/pool");

async function savePayPalOrderContext(paypalOrderId, tenantId, entityType, entityId) {
  await pool.query(
    `INSERT INTO paypal_order_context (paypal_order_id, tenant_id, entity_type, entity_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (paypal_order_id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       entity_type = EXCLUDED.entity_type,
       entity_id = EXCLUDED.entity_id`,
    [paypalOrderId, tenantId, entityType, entityId]
  );
}

async function getPayPalOrderContext(paypalOrderId) {
  const { rows } = await pool.query(
    `SELECT paypal_order_id, tenant_id, entity_type, entity_id, created_at
     FROM paypal_order_context WHERE paypal_order_id = $1`,
    [paypalOrderId]
  );
  return rows[0] || null;
}

module.exports = { savePayPalOrderContext, getPayPalOrderContext };
