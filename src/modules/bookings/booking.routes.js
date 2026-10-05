// src/modules/bookings/booking.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { publicWriteLimiter } = require("../../middleware/rate-limits");
const { createBooking, listBookings, getBookingPaymentStatus, updateBookingStatus, startBookingCheckout, BOOKING_STATUSES } = require("./booking.service");
const { getConfig } = require("../store-config/config.service");
const { notifyNewOrder } = require("../notify-matrix/matrix.service");
const { assertSafeCheckoutRedirects } = require("../../lib/checkout-redirects");
const { UUID_RE } = require("../../lib/validate");

const router = express.Router();

router.post("/", publicWriteLimiter, async (req, res) => {
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

// Public — server-side truth for the buyer's confirmation screen
// (see order.routes.js). Tenant-scoped, ids unguessable.
router.get("/:id/status", async (req, res) => {
  const row = await getBookingPaymentStatus(req.tenant.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Booking not found." });
  res.json({ id: row.id, status: row.status, payment_status: row.payment_status });
});

router.post("/:id/checkout", publicWriteLimiter, async (req, res) => {
  const { successUrl, cancelUrl } = req.body || {};
  if (!successUrl || !cancelUrl) {
    return res.status(400).json({ error: "successUrl and cancelUrl are required." });
  }
  try {
    assertSafeCheckoutRedirects(successUrl, cancelUrl, req.tenant);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  try {
    const { provider } = req.body || {};
    const { checkoutUrl } = await startBookingCheckout(req.tenant.id, req.params.id, { successUrl, cancelUrl, provider });
    res.json({ checkoutUrl });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not start checkout." });
  }
});

router.get("/", authRequired, async (req, res) => {
  if (req.query.status && !BOOKING_STATUSES.includes(req.query.status)) {
    return res.status(400).json({ error: `status must be one of: ${BOOKING_STATUSES.join(", ")}.` });
  }
  res.json(await listBookings(req.tenant.id, req.query));
});

router.patch("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Booking not found." });
  }
  const { status } = req.body || {};
  if (!BOOKING_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${BOOKING_STATUSES.join(", ")}.` });
  }
  try {
    const updated = await updateBookingStatus(req.tenant.id, req.params.id, status);
    if (!updated) return res.status(404).json({ error: "Booking not found." });
    res.json(updated);
  } catch (err) {
    // Illegal transitions (e.g. resurrecting a cancelled booking) land
    // here with err.status = 400 and a human message — surface it, don't
    // generic-500 it via the central handler.
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not update booking." });
  }
});

module.exports = router;
