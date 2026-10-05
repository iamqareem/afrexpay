// src/modules/listings/reservation.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");
const { getProvider } = require("../payments/providers");
const { getDecryptedCredentials } = require("../payments/credentials.service");
const { recordCheckoutSession } = require("../payments/checkout-sessions.service");

async function createReservation(tenantId, { listingId, name, phone, message }) {
  const listingResult = await pool.query(
    `SELECT id, title, deposit_amount_minor, currency FROM listings WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
    [tenantId, listingId]
  );
  const listing = listingResult.rows[0];
  if (!listing) {
    throw Object.assign(new Error("Listing not found."), { status: 400 });
  }
  if (!listing.deposit_amount_minor) {
    throw Object.assign(new Error("This listing does not require a deposit."), { status: 400 });
  }

  const { rows } = await pool.query(
    `INSERT INTO listing_reservations (tenant_id, listing_id, name, phone, message, deposit_amount_minor, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tenantId, listingId, name, phone, message || null, listing.deposit_amount_minor, listing.currency]
  );
  return { ...rows[0], listingTitle: listing.title };
}

// Creates the Checkout session for an existing pending reservation
// and stores the session id for later webhook correlation. Separate from
const { savePayPalOrderContext } = require("../payments/paypal-context.service");

// createReservation so a customer who abandons checkout and comes back
// doesn't need a new reservation row — same reservation, a fresh session.
async function startCheckout(tenantId, reservationId, { successUrl, cancelUrl, provider = "stripe" }) {
  const credentials = await getDecryptedCredentials(tenantId, provider);
  if (!credentials || !credentials.secretKey) {
    throw Object.assign(new Error(`This store hasn't set up ${provider} payments yet.`), { status: 400 });
  }

  // Freshness + listing state: a hold older than the abandoned-checkout
  // TTL (same default as orders/bookings) or on a delisted property can
  // never be fulfilled — refuse before any provider session exists rather
  // than taking a deposit for nothing.
  const rawTtl = Number(process.env.ABANDONED_ORDER_TTL_MINUTES);
  const ttlMinutes = Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : 1440;
  const { rows } = await pool.query(
    `SELECT r.*, l.title AS listing_title FROM listing_reservations r
     JOIN listings l ON l.id = r.listing_id
     WHERE r.tenant_id = $1 AND r.id = $2 AND r.payment_status = 'pending'
       AND l.status = 'active'
       AND r.created_at > now() - make_interval(mins => $3)`,
    [tenantId, reservationId, ttlMinutes]
  );
  const reservation = rows[0];
  if (!reservation) {
    throw Object.assign(new Error("Reservation not found or already paid."), { status: 404 });
  }

  const paymentProvider = getProvider(provider);
  const { checkoutUrl, sessionId } = await paymentProvider.createCheckoutSession({
    ...credentials,
    amountMinor: reservation.deposit_amount_minor,
    currency: reservation.currency,
    successUrl,
    cancelUrl,
    metadata: {
      entityType: "listing_reservation",
      entityId: reservation.id,
      tenantId,
      description: `Deposit — ${reservation.listing_title}`,
    },
  });

  if (provider === "paypal") {
    await savePayPalOrderContext(sessionId, tenantId, "listing_reservation", reservation.id);
  }

  const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
  if (!["stripe_checkout_session_id", "paypal_checkout_session_id"].includes(sessionIdField)) {
    throw Object.assign(new Error("Invalid provider session field."), { status: 400 });
  }
  await pool.query(`UPDATE listing_reservations SET ${sessionIdField} = $2 WHERE tenant_id = $3 AND id = $1`, [reservationId, sessionId, tenantId]);
  // History, not just the current column (see startOrderCheckout).
  await recordCheckoutSession(provider, sessionId, tenantId, "listing_reservation", reservation.id);
  return { checkoutUrl };
}

// Called from the webhook handler once a checkout.session.completed event
// is verified. Idempotent by construction: the UNIQUE(provider,
// provider_reference) constraint on `payments` means a duplicate webhook
// delivery (Stripe does not guarantee exactly-once) fails the INSERT
// harmlessly rather than double-recording the payment or double-marking
// the reservation paid — caught and ignored by the caller.
async function markReservationPaid(tenantId, sessionId, amountMinor, currency, provider = "stripe", providerRef = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
    const { rows } = await client.query(
      `UPDATE listing_reservations SET payment_status = 'paid'
       WHERE tenant_id = $1 AND payment_status IN ('pending', 'failed')
         AND (${sessionIdField} = $2 OR id IN (
           SELECT entity_id FROM checkout_sessions
           WHERE provider = $3 AND session_id = $2 AND tenant_id = $1 AND entity_type = 'listing_reservation'
         ))
       RETURNING id, listing_id, name, phone, deposit_amount_minor, currency`,
      [tenantId, sessionId, provider]
    );
    const reservation = rows[0];
    if (!reservation) {
      // Already marked paid by an earlier delivery of the same webhook,
      // or the session id doesn't match any reservation — either way,
      // nothing new to do.
      await client.query("ROLLBACK");
      return null;
    }

    // Amount guard reads the RESERVATION snapshot (deposit locked at
    // reservation time), not the live listing row: a merchant editing the
    // deposit mid-flight must not turn a correct payment "underpaid", and
    // a deleted listing must not disable the guard entirely (the old
    // `expectedAmount &&` clause did exactly that for missing rows).
    const expectedAmount = reservation.deposit_amount_minor;
    const expectedCurrency = reservation.currency;
    if (!amountMinor || amountMinor !== expectedAmount) {
      await client.query("ROLLBACK");
      console.error(`Reservation ${reservation.id} underpaid: expected ${expectedAmount} ${expectedCurrency}, got ${amountMinor} ${currency}`);
      try {
        await pool.query(
          `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
           VALUES ($1, 'listing_reservation', $2, $3, $4, $5, $6, 'failed')`,
          [tenantId, reservation.id, provider, `${providerRef || sessionId}:failed:${Date.now()}`, amountMinor || 0, currency || expectedCurrency]
        );
      } catch {}
      return null;
    }
    if (currency && expectedCurrency && currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
      await client.query("ROLLBACK");
      console.error(`Reservation ${reservation.id} currency mismatch: expected ${expectedCurrency}, got ${currency}`);
      try {
        await pool.query(
          `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
           VALUES ($1, 'listing_reservation', $2, $3, $4, $5, $6, 'failed')`,
          [tenantId, reservation.id, provider, `${providerRef || sessionId}:failed:${Date.now()}`, amountMinor || 0, currency || expectedCurrency]
        );
      } catch {}
      return null;
    }

    const ref = providerRef || sessionId;
    await client.query(
      `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
       VALUES ($1, 'listing_reservation', $2, $3, $4, $5, $6, 'succeeded')`,
      [tenantId, reservation.id, provider, ref, amountMinor, currency]
    );

    await client.query("COMMIT");
    return reservation;
  } catch (err) {
    await client.query("ROLLBACK");
    // A UNIQUE violation on provider_reference means this exact payment
    // was already recorded by a prior webhook delivery — not a real
    // error, just Stripe's documented at-least-once delivery behavior.
    if (err.code === "23505") return null;
    throw err;
  } finally {
    client.release();
  }
}

// Public return-page helper (see getOrderPaymentStatus). listing_id is
// included so the storefront only celebrates a deposit for the listing the
// buyer is actually looking at.
async function getReservationPaymentStatus(tenantId, reservationId) {
  const { rows } = await pool.query(
    `SELECT id, listing_id, payment_status FROM listing_reservations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, reservationId]
  );
  return rows[0] || null;
}

const RESERVATION_PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

async function listReservations(tenantId, params = {}) {
  const { search, status, limit, offset, dir } = parseListParams(params);
  const conditions = [`r.tenant_id = $1`];
  const values = [tenantId];
  if (status) {
    if (!RESERVATION_PAYMENT_STATUSES.includes(status)) {
      throw Object.assign(
        new Error(`status must be one of: ${RESERVATION_PAYMENT_STATUSES.join(", ")}.`),
        { status: 400 }
      );
    }
    values.push(status);
    conditions.push(`r.payment_status = $${values.length}`);
  }
  if (search) conditions.push(searchCondition(values, ["r.name", "r.phone", "l.title"], search));
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT r.*, l.title AS listing_title FROM listing_reservations r
     JOIN listings l ON l.id = r.listing_id
     WHERE ${conditions.join(" AND ")} ORDER BY r.created_at ${dir}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

module.exports = { createReservation, startCheckout, markReservationPaid, listReservations, getReservationPaymentStatus };
