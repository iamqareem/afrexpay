// src/modules/orders/order.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { publicWriteLimiter } = require("../../middleware/rate-limits");
const { createOrder, listOrders, getOrderPaymentStatus, startOrderCheckout, updateOrderStatus, ORDER_STATUSES } = require("./order.service");
const { getConfig } = require("../store-config/config.service");
const { notifyNewOrder } = require("../notify-matrix/matrix.service");
const { assertSafeCheckoutRedirects } = require("../../lib/checkout-redirects");
const { UUID_RE } = require("../../lib/validate");

const router = express.Router();

router.post("/", publicWriteLimiter, async (req, res) => {
  const { customerName, phone, address, items } = req.body || {};
  if (!customerName || !phone || !address || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "customerName, phone, address, and at least one item are required." });
  }
  try {
    const order = await createOrder(req.tenant.id, req.body);
    res.status(201).json(order);

    getConfig(req.tenant.id)
      .then(({ config }) => notifyNewOrder(config?.matrixRoomId, req.tenant.business_name, order))
      .catch((err) => console.error("Could not load config for Matrix notification:", err.message));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not place order." });
    if (!err.status) console.error("Create order failed:", err);
  }
});

// Public — the buyer's own return page asks here whether the order is
// actually paid instead of trusting the ?paid=1 query param. Tenant-scoped,
// ids unguessable.
router.get("/:id/status", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Order not found." });
  }
  const row = await getOrderPaymentStatus(req.tenant.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Order not found." });
  res.json({ id: row.id, status: row.status, payment_status: row.payment_status });
});

router.post("/:id/checkout", publicWriteLimiter, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Order not found." });
  }
  const { successUrl, cancelUrl, provider } = req.body || {};
  if (!successUrl || !cancelUrl) {
    return res.status(400).json({ error: "successUrl and cancelUrl are required." });
  }
  try {
    assertSafeCheckoutRedirects(successUrl, cancelUrl, req.tenant);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  try {
    const { checkoutUrl } = await startOrderCheckout(req.tenant.id, req.params.id, { successUrl, cancelUrl, provider });
    res.json({ checkoutUrl });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not start checkout." });
  }
});

router.get("/", authRequired, async (req, res) => {
  if (req.query.status && !ORDER_STATUSES.includes(req.query.status)) {
    return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(", ")}.` });
  }
  const orders = await listOrders(req.tenant.id, req.query);
  res.json(orders);
});

router.patch("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Order not found." });
  }
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(", ")}.` });
  }
  const updated = await updateOrderStatus(req.tenant.id, req.params.id, status);
  if (!updated) return res.status(404).json({ error: "Order not found." });
  res.json(updated);
});

module.exports = router;
