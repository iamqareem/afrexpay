// src/modules/listings/reservation.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { publicWriteLimiter } = require("../../middleware/rate-limits");
const { createReservation, startCheckout, listReservations, getReservationPaymentStatus } = require("./reservation.service");
const { assertSafeCheckoutRedirects } = require("../../lib/checkout-redirects");

const router = express.Router();

// Public — a customer submits their details for a listing that requires a
// deposit. This only creates the pending reservation row; no payment has
// happened yet, no Stripe call yet.
router.post("/", publicWriteLimiter, async (req, res) => {
  const { listingId, name, phone } = req.body || {};
  if (!listingId || !name || !phone) {
    return res.status(400).json({ error: "listingId, name, and phone are required." });
  }
  try {
    const reservation = await createReservation(req.tenant.id, req.body);
    res.status(201).json(reservation);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not create reservation." });
    if (!err.status) console.error("Create reservation failed:", err);
  }
});

// Public — starts a Stripe Checkout session for an existing pending
// reservation. Separate step from creation so the customer's browser can
// be redirected to Stripe's hosted page, then back to successUrl/cancelUrl
// on this same storefront.
// Public — server-side truth for the deposit celebration banner.
// listing_id lets the storefront check the deposit belongs to the listing
// on screen. Tenant-scoped, ids unguessable.
router.get("/:id/status", async (req, res) => {
  const row = await getReservationPaymentStatus(req.tenant.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Reservation not found." });
  res.json({ id: row.id, listing_id: row.listing_id, payment_status: row.payment_status });
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
    const result = await startCheckout(req.tenant.id, req.params.id, { successUrl, cancelUrl, provider });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not start checkout." });
    if (!err.status) console.error("Start checkout failed:", err);
  }
});

router.get("/", authRequired, async (req, res) => {
  res.json(await listReservations(req.tenant.id, req.query));
});

module.exports = router;
