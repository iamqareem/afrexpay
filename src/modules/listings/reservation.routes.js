// src/modules/listings/reservation.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { createReservation, startCheckout, listReservations } = require("./reservation.service");

const router = express.Router();

// Public — a customer submits their details for a listing that requires a
// deposit. This only creates the pending reservation row; no payment has
// happened yet, no Stripe call yet.
router.post("/", async (req, res) => {
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
router.post("/:id/checkout", async (req, res) => {
  const { successUrl, cancelUrl } = req.body || {};
  if (!successUrl || !cancelUrl) {
    return res.status(400).json({ error: "successUrl and cancelUrl are required." });
  }
  try {
    const result = await startCheckout(req.tenant.id, req.params.id, { successUrl, cancelUrl });
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
