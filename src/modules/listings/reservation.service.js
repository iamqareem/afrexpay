// src/modules/listings/reservation.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");
const { getProvider } = require("../payments/providers");
const { getDecryptedCredentials } = require("../payments/credentials.service");

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

  const { rows } = await pool.query(
    `SELECT r.*, l.title AS listing_title FROM listing_reservations r
     JOIN listings l ON l.id = r.listing_id
     WHERE r.tenant_id = $1 AND r.id = $2 AND r.payment_status = 'pending'`,
    [tenantId, reservationId]
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
       WHERE tenant_id = $1 AND ${sessionIdField} = $2 AND payment_status = 'pending'
       RETURNING id, listing_id, name, phone`,
      [tenantId, sessionId]
    );
    const reservation = rows[0];
    if (!reservation) {
      // Already marked paid by an earlier delivery of the same webhook,
      // or the session id doesn't match any reservation — either way,
      // nothing new to do.
      await client.query("ROLLBACK");
      return null;
    }

    // Fetch expected deposit for amount guard (reservation row has listing_id)
    const listingRows = await client.query(
      `SELECT deposit_amount_minor, currency FROM listings WHERE tenant_id = $1 AND id = $2`,
      [tenantId, reservation.listing_id]
    );
    const expectedAmount = listingRows.rows[0]?.deposit_amount_minor;
    const expectedCurrency = listingRows.rows[0]?.currency;
    if (!amountMinor || (expectedAmount && amountMinor < expectedAmount)) {
      await client.query("ROLLBACK");
      console.error(`Reservation ${reservation.id} underpaid: expected ${expectedAmount} ${expectedCurrency}, got ${amountMinor} ${currency}`);
      try {
        await pool.query(
          `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
           VALUES ($1, 'listing_reservation', $2, $3, $4, $5, $6, 'failed')`,
          [tenantId, reservation.id, provider, providerRef || sessionId, amountMinor || 0, currency || expectedCurrency]
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
          [tenantId, reservation.id, provider, providerRef || sessionId, amountMinor || 0, currency || expectedCurrency]
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

async function listReservations(tenantId, params = {}) {
  const { search, limit, offset, dir } = parseListParams(params);
  const conditions = [`r.tenant_id = $1`];
  const values = [tenantId];
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

module.exports = { createReservation, startCheckout, markReservationPaid, listReservations };
