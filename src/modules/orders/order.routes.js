// src/modules/orders/order.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { publicWriteLimiter } = require("../../middleware/rate-limits");
const { createOrder, listOrders, startOrderCheckout, updateOrderStatus, ORDER_STATUSES } = require("./order.service");
const { getConfig } = require("../store-config/config.service");
const { notifyNewOrder } = require("../notify-matrix/matrix.service");

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

router.post("/:id/checkout", publicWriteLimiter, async (req, res) => {
  const { successUrl, cancelUrl } = req.body || {};
  if (!successUrl || !cancelUrl) {
    return res.status(400).json({ error: "successUrl and cancelUrl are required." });
  }

  try {
    const { checkoutUrl } = await startOrderCheckout(req.tenant.id, req.params.id, { successUrl, cancelUrl });
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
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(", ")}.` });
  }
  const updated = await updateOrderStatus(req.tenant.id, req.params.id, status);
  if (!updated) return res.status(404).json({ error: "Order not found." });
  res.json(updated);
});

module.exports = router;
