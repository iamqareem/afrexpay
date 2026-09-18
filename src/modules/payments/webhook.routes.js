// src/modules/payments/webhook.routes.js
//
// This router is mounted BEFORE app.use(express.json()) in app.js, and
// uses express.raw() itself — Stripe's signature verification needs the
// exact raw bytes that were sent, not a re-serialized JSON.stringify of a
// parsed object, which can differ in whitespace/key order and would make
// every signature check fail. Getting this ordering wrong is a common,
// easy-to-miss Stripe integration bug — it fails silently in a way that
// looks like "the webhook secret must be wrong" when the real cause is
// body-parsing order.
//
// PayPal webhooks also need raw body for signature verification.
const express = require("express");
const pool = require("../../db/pool");
const { getProvider } = require("./providers");
const { getDecryptedCredentials } = require("./credentials.service");
const { markReservationPaid } = require("../listings/reservation.service");
const { markOrderPaid } = require("../orders/order.service");
const { markBookingPaid } = require("../bookings/booking.service");
const { getConfig } = require("../store-config/config.service");
const { notifyNewOrder } = require("../notify-matrix/matrix.service");

const router = express.Router();

// Stripe webhook endpoint (legacy path, kept for backward compatibility)
router.post("/stripe/:tenantId", express.raw({ type: "application/json" }), async (req, res) => {
  await handleStripeWebhook(req, res);
});

// PayPal webhook endpoint
router.post("/paypal/:tenantId", express.raw({ type: "application/json" }), async (req, res) => {
  await handlePayPalWebhook(req, res);
});

// Generic provider-agnostic handler for both
async function handleStripeWebhook(req, res) {
  const { tenantId } = req.params;
  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).json({ error: "Missing Stripe-Signature header." });
  }

  const credentials = await getDecryptedCredentials(tenantId, "stripe");
  if (!credentials || !credentials.webhookSecret) {
    return res.status(400).json({ error: "Webhook not configured." });
  }

  let event;
  try {
    const stripeProvider = require("./providers/stripe.provider");
    event = stripeProvider.verifyWebhook({
      payload: req.body,
      signature,
      webhookSecret: credentials.webhookSecret,
    });
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true });
  }

  await processPaymentEvent(tenantId, "stripe", event, res);
}

async function handlePayPalWebhook(req, res) {
  const { tenantId } = req.params;

  const credentials = await getDecryptedCredentials(tenantId, "paypal");
  if (!credentials || !credentials.webhookSecret) {
    return res.status(400).json({ error: "Webhook not configured." });
  }

  let event;
  try {
    const paypalProvider = require("./providers/paypal.provider");
    event = paypalProvider.verifyWebhook({
      payload: req.body.toString("utf8"),
      headers: req.headers,
      webhookSecret: credentials.webhookSecret,
    });
  } catch (err) {
    console.error("PayPal webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  // PayPal sends various event types; we care about completed captures
  const relevantTypes = [
    "CHECKOUT.ORDER.APPROVED",
    "PAYMENT.CAPTURE.COMPLETED",
    "PAYMENT.CAPTURE.DENIED",
    "PAYMENT.CAPTURE.REFUNDED",
    "PAYMENT.CAPTURE.PENDING",
  ];

  if (!relevantTypes.includes(event.event_type)) {
    return res.status(200).json({ received: true });
  }

  await processPaymentEvent(tenantId, "paypal", event, res);
}

async function processPaymentEvent(tenantId, provider, event, res) {
  try {
    const paymentProvider = require("./providers")[provider];
    const normalized = paymentProvider.normalizePayment ? paymentProvider.normalizePayment(event) : null;

    // For Stripe, entityType is in metadata; for PayPal, we need to infer or pass via custom fields
    // For now, we'll need to store the entity type in the session/order metadata
    // For simplicity, we'll check all three entity types by the session/order ID
    // In a real implementation, we'd pass the entity type through metadata

    let paidItem = null;
    let notifyPayload = null;

    // Try each entity type - the webhook will only match the correct one
    // because of the unique session ID per entity
    if (provider === "stripe") {
      // Stripe stores entityType in metadata
      const session = event.data.object;
      const entityType = session.metadata?.entityType;
      const currency = (session.currency || "usd").toUpperCase();
      const amountTotal = session.amount_total;
      const sessionId = session.id;

      if (entityType === "order") {
        paidItem = await markOrderPaid(tenantId, sessionId, amountTotal, currency, "stripe");
        if (paidItem) {
          notifyPayload = {
            id: paidItem.id,
            customerName: paidItem.customer_name,
            phone: paidItem.phone,
            address: paidItem.address,
            totalMinor: amountTotal,
            currency,
            items: [{ name: "Product Order (Stripe Paid)", size: "—", qty: 1, unitPriceMinor: amountTotal }],
          };
        }
      } else if (entityType === "booking") {
        paidItem = await markBookingPaid(tenantId, sessionId, amountTotal, currency, "stripe");
        if (paidItem) {
          notifyPayload = {
            id: paidItem.id,
            customerName: paidItem.customer_name,
            phone: paidItem.phone,
            address: "Service Booking (Stripe Paid)",
            totalMinor: amountTotal,
            currency,
            items: [{ name: "Service Appointment", size: "—", qty: 1, unitPriceMinor: amountTotal }],
          };
        }
      } else if (entityType === "listing_reservation") {
        paidItem = await markReservationPaid(tenantId, sessionId, amountTotal, currency, "stripe");
        if (paidItem) {
          notifyPayload = {
            id: paidItem.id,
            customerName: paidItem.name,
            phone: paidItem.phone,
            address: "Listing Reservation Deposit Paid",
            totalMinor: amountTotal,
            currency,
            items: [{ name: "Reservation Deposit", size: "—", qty: 1, unitPriceMinor: amountTotal }],
          };
        }
      }
    } else if (provider === "paypal") {
      // For PayPal, we need to determine entity type from the order ID
      // The order ID format could encode the entity type, or we check all
      // For now, we'll check the PayPal order metadata or try each type
      const normalizedPayment = require("./providers/paypal.provider").normalizePayment(event);
      const { providerRef, amountMinor, currency } = normalizedPayment;
      const orderId = event.resource?.id || event.resource?.supplementary_data?.related_ids?.order_id;

      // Try each entity type with the provider reference
      // The webhook will only match one because of the unique session ID per entity
      paidItem = await markOrderPaid(tenantId, providerRef, amountMinor, currency, "paypal");
      if (!paidItem) {
        paidItem = await markBookingPaid(tenantId, providerRef, amountMinor, currency, "paypal");
      }
      if (!paidItem) {
        paidItem = await markReservationPaid(tenantId, providerRef, amountMinor, currency, "paypal");
      }

      if (paidItem) {
        notifyPayload = {
          id: paidItem.id,
          customerName: paidItem.customer_name || paidItem.name,
          phone: paidItem.phone,
          address: paidItem.address || "PayPal Payment",
          totalMinor: amountMinor,
          currency,
          items: [{ name: "PayPal Payment", size: "—", qty: 1, unitPriceMinor: amountMinor }],
        };
      }
    }

    if (notifyPayload) {
      const tenantResult = await pool.query(`SELECT business_name FROM tenants WHERE id = $1`, [tenantId]);
      const businessName = tenantResult.rows[0]?.business_name;
      const { config } = await getConfig(tenantId);
      notifyNewOrder(config?.matrixRoomId, businessName, notifyPayload).catch((err) =>
        console.error("Matrix notification for paid item failed:", err.message)
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error(`Failed to process ${provider} webhook:`, err);
    res.status(500).json({ error: "Could not process webhook." });
  }
}

module.exports = router;
