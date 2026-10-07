// src/modules/orders/order.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { publicWriteLimiter } = require("../../middleware/rate-limits");
const { createOrder, listOrders, getOrderPaymentStatus, startOrderCheckout, markOrderCashPaid, markOrderChannel, updateOrderStatus, ORDER_STATUSES } = require("./order.service");
const QRCode = require("qrcode");
const { EMAIL_RE } = require("../../lib/validate");
const { sendCheckoutLinkEmail } = require("../../lib/mailer");
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
  if (items.some((i) => !i || !UUID_RE.test(i.productId))) {
    return res.status(400).json({ error: "Every item needs a valid productId." });
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

// POS cash tender (owner-operated): collect offline money for an open
// order. No provider involved — the ledger records provider 'cash'.
router.post("/:id/collect-cash", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Order not found." });
  }
  const { tenderedMinor } = req.body || {};
  try {
    const result = await markOrderCashPaid(req.tenant.id, req.params.id, { tenderedMinor });
    if (!result) {
      return res.status(400).json({ error: "Order cannot be collected (already paid, cancelled, or missing)." });
    }
    // Same merchant ping as paid webhooks.
    getConfig(req.tenant.id)
      .then(({ config }) =>
        notifyNewOrder(config?.matrixRoomId, req.tenant.business_name, {
          id: result.order.id,
          customerName: result.order.customer_name,
          phone: result.order.phone,
          address: result.order.address,
          totalMinor: result.order.total_minor,
          currency: result.order.currency,
          items: [{ name: "POS sale (cash)", size: "—", qty: 1, unitPriceMinor: result.order.total_minor }],
        })
      )
      .catch((err) => console.error("Could not load config for Matrix notification:", err.message));
    res.json({ id: result.order.id, payment_status: "paid", changeMinor: result.changeMinor });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not collect payment." });
  }
});

// POS card tender: mint a provider session and either hand back its QR
// (customer scans on their own phone) or email the pay link. Reuses the
// storefront checkout machinery — no new money code, same webhook confirm.
router.post("/:id/pay-link", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Order not found." });
  }
  const { provider = "stripe", email } = req.body || {};
  const cleanEmail = email === undefined || email === null ? null : String(email).trim();
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: "Enter a valid customer email address." });
  }
  try {
    // Return URLs point back at this same admin hatch (a tenant host, so
    // the allowlist holds); truth still comes from polling /:id/status.
    const host = String(req.headers.host || "").split(":")[0];
    const here = `https://${host}/admin/`;
    const successUrl = `${here}#tab=pos&order=${req.params.id}&paid=1`;
    const cancelUrl = `${here}#tab=pos&order=${req.params.id}`;
    assertSafeCheckoutRedirects(successUrl, cancelUrl, req.tenant);
    const { checkoutUrl } = await startOrderCheckout(req.tenant.id, req.params.id, {
      successUrl, cancelUrl, provider,
    });
    await markOrderChannel(req.tenant.id, req.params.id, "pos");
    if (cleanEmail) {
      const order = (await getOrderPaymentStatus(req.tenant.id, req.params.id)) || {};
      await sendCheckoutLinkEmail({
        to: cleanEmail,
        storeName: req.tenant.business_name,
        orderId: req.params.id,
        amountText: `${order.currency || ""} ${(order.total_minor ?? 0).toLocaleString()}`,
        checkoutUrl,
      });
      return res.json({ checkoutUrl, emailed: true });
    }
    const qrSvg = await QRCode.toString(checkoutUrl, { type: "svg", margin: 1, width: 256 });
    res.json({ checkoutUrl, qrSvg });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not create pay link." });
  }
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
