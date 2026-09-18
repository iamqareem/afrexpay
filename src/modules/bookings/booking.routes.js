// src/modules/bookings/booking.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { createBooking, listBookings, updateBookingStatus, startBookingCheckout } = require("./booking.service");
const { getConfig } = require("../store-config/config.service");
const { notifyNewOrder } = require("../notify-matrix/matrix.service");

const router = express.Router();

router.post("/", async (req, res) => {
  const { serviceId, customerName, phone, startTime } = req.body || {};
  if (!serviceId || !customerName || !phone || !startTime) {
    return res.status(400).json({ error: "serviceId, customerName, phone, and startTime are required." });
  }
  try {
    const booking = await createBooking(req.tenant.id, req.body);
    res.status(201).json(booking);

    getConfig(req.tenant.id)
      .then(({ config }) =>
        notifyNewOrder(config?.matrixRoomId, req.tenant.business_name, {
          id: booking.id,
          customerName: booking.customer_name,
          phone: booking.phone,
          address: `Booking: ${booking.serviceName} at ${new Date(booking.time_range.split(",")[0].replace(/[[("]/g, "")).toLocaleString()}`,
          deliveryNotes: booking.notes,
          totalMinor: booking.price_minor,
          currency: booking.currency,
          items: [{ name: booking.serviceName, size: "—", qty: 1, unitPriceMinor: booking.price_minor }],
        })
      )
      .catch((err) => console.error("Could not load config for Matrix notification:", err.message));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not create booking." });
    if (!err.status) console.error("Create booking failed:", err);
  }
});

router.post("/:id/checkout", async (req, res) => {
  const { successUrl, cancelUrl } = req.body || {};
  if (!successUrl || !cancelUrl) {
    return res.status(400).json({ error: "successUrl and cancelUrl are required." });
  }

  try {
    const { checkoutUrl } = await startBookingCheckout(req.tenant.id, req.params.id, { successUrl, cancelUrl });
    res.json({ checkoutUrl });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not start checkout." });
  }
});

router.get("/", authRequired, async (req, res) => {
  if (req.query.status && !["pending", "confirmed", "cancelled", "completed"].includes(req.query.status)) {
    return res.status(400).json({ error: "status must be one of: pending, confirmed, cancelled, completed." });
  }
  res.json(await listBookings(req.tenant.id, req.query));
});

router.patch("/:id", authRequired, async (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "confirmed", "cancelled", "completed"].includes(status)) {
    return res.status(400).json({ error: "status must be one of: pending, confirmed, cancelled, completed." });
  }
  const updated = await updateBookingStatus(req.tenant.id, req.params.id, status);
  if (!updated) return res.status(404).json({ error: "Booking not found." });
  res.json(updated);
});

module.exports = router;
