// src/modules/payments/paypal-context.service.js
//
// Service for storing and retrieving PayPal order context
//
const pool = require('../../db/pool');

// Stores the context of a PayPal order
async function setPayPalOrderContext(orderId, entityType, tenantId) {
  const query = {
    text: `INSERT INTO paypal_order_contexts (order_id, entity_type, tenant_id) VALUES ($1, $2, $3) ON CONFLICT (order_id) DO UPDATE SET entity_type = $2, tenant_id = $3`, 
    values: [orderId, entityType, tenantId],
  };
  await pool.query(query);
}

// Retrieves the context of a PayPal order
async function getPayPalOrderContext(orderId) {
  const query = {
    text: `SELECT entity_type, tenant_id FROM paypal_order_contexts WHERE order_id = $1`, 
    values: [orderId],
  };
  const result = await pool.query(query);
  return result.rows[0];
}

module.exports = { setPayPalOrderContext, getPayPalOrderContext };