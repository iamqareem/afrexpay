// src/modules/inquiries/inquiry.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { publicWriteLimiter } = require("../../middleware/rate-limits");
const { createInquiry, listInquiries } = require("./inquiry.service");
const { getConfig } = require("../store-config/config.service");
const { notifyNewOrder } = require("../notify-matrix/matrix.service");

const router = express.Router();

router.post("/", publicWriteLimiter, async (req, res) => {
  const { listingId, name, phone } = req.body || {};
  if (!listingId || !name || !phone) {
    return res.status(400).json({ error: "listingId, name, and phone are required." });
  }
  try {
    const inquiry = await createInquiry(req.tenant.id, req.body);
    res.status(201).json(inquiry);

    // Same notifier as orders/bookings — from the merchant's side this is
    // just "someone wants me to call them back," which fits the same shape.
    getConfig(req.tenant.id)
      .then(({ config }) =>
        notifyNewOrder(config?.matrixRoomId, req.tenant.business_name, {
          id: inquiry.id,
          customerName: inquiry.name,
          phone: inquiry.phone,
          address: `Inquiry about: ${inquiry.listingTitle}`,
          deliveryNotes: inquiry.message,
          totalMinor: 0,
          currency: "UGX",
          items: [{ name: inquiry.listingTitle, size: "—", qty: 1, unitPriceMinor: 0 }],
        })
      )
      .catch((err) => console.error("Could not load config for Matrix notification:", err.message));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not submit inquiry." });
    if (!err.status) console.error("Create inquiry failed:", err);
  }
});

router.get("/", authRequired, async (req, res) => {
  res.json(await listInquiries(req.tenant.id, req.query));
});

module.exports = router;
