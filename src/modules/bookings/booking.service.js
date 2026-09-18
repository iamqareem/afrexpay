// src/modules/bookings/booking.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");

// Postgres error code for exclusion constraint violation — this is how a
// double-booking attempt surfaces. Not a magic number pulled from nowhere:
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const EXCLUSION_VIOLATION = "23P01";

async function createBooking(tenantId, { serviceId, customerName, phone, notes, startTime }) {
  const serviceResult = await pool.query(
    `SELECT id, name, duration_minutes, price_minor, currency FROM services WHERE tenant_id = $1 AND id = $2 AND active = true`,
    [tenantId, serviceId]
  );
  const service = serviceResult.rows[0];
  if (!service) {
    throw Object.assign(new Error("Service not found."), { status: 400 });
  }

  const start = new Date(startTime);
  if (isNaN(start.getTime())) {
    throw Object.assign(new Error("Invalid start time."), { status: 400 });
  }
  const end = new Date(start.getTime() + service.duration_minutes * 60000);

  try {
    const { rows } = await pool.query(
      `INSERT INTO bookings (tenant_id, service_id, customer_name, phone, notes, price_minor, currency, time_range)
       VALUES ($1, $2, $3, $4, $5, $6, $7, tstzrange($8, $9))
       RETURNING id, customer_name, phone, notes, price_minor, currency, time_range, status, created_at`,
      [tenantId, service.id, customerName, phone, notes || null, service.price_minor, service.currency, start.toISOString(), end.toISOString()]
    );
    return { ...rows[0], serviceName: service.name };
  } catch (err) {
    if (err.code === EXCLUSION_VIOLATION) {
      // This is the double-booking case, caught at the database layer —
      // the application never had to compute or trust its own "is this
      // slot free" check to prevent the conflict, Postgres just refused it.
      throw Object.assign(new Error("That time slot was just booked by someone else. Please pick another."), { status: 409 });
    }
    throw err;
  }
}

async function listBookings(tenantId, params = {}) {
  const { search, status, limit, offset, dir } = parseListParams(params);
  const conditions = [`b.tenant_id = $1`];
  const values = [tenantId];
  if (search) conditions.push(searchCondition(values, ["b.customer_name", "b.phone", "s.name"], search));
  if (status) {
    values.push(status);
    conditions.push(`b.status = $${values.length}`);
  }
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT b.*, s.name AS service_name
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE ${conditions.join(" AND ")} ORDER BY b.time_range ${dir}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

async function updateBookingStatus(tenantId, bookingId, status) {
  const { rows } = await pool.query(
    `UPDATE bookings SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, bookingId, status]
  );
  return rows[0] || null;
}

const { getProvider } = require("../payments/providers");
const { getDecryptedCredentials } = require("../payments/credentials.service");
const { buildStripeLineItems } = require("../payments/stripe-checkout-helpers");

async function startBookingCheckout(tenantId, bookingId, { successUrl, cancelUrl, provider = "stripe" }) {
  const credentials = await getDecryptedCredentials(tenantId, provider);
  if (!credentials || !credentials.secretKey) {
    throw Object.assign(new Error(`This store hasn't set up ${provider} payments yet.`), { status: 400 });
  }

  const { rows } = await pool.query(
    `SELECT b.*, s.name AS service_name FROM bookings b
     JOIN services s ON s.id = b.service_id
     WHERE b.tenant_id = $1 AND b.id = $2`,
    [tenantId, bookingId]
  );
  const booking = rows[0];
  if (!booking) {
    throw Object.assign(new Error("Booking not found."), { status: 404 });
  }
  if (booking.payment_status === "paid") {
    throw Object.assign(new Error("Booking is already paid."), { status: 400 });
  }

  const lineItems = buildStripeLineItems(
    { serviceName: booking.service_name, priceMinor: booking.price_minor },
    booking.currency
  );

  const paymentProvider = getProvider(provider);
  const { checkoutUrl, sessionId } = await paymentProvider.createCheckoutSession({
    ...credentials,
    lineItems,
    currency: booking.currency,
    successUrl,
    cancelUrl,
    metadata: {
      entityType: "booking",
      entityId: booking.id,
      tenantId,
      description: `Booking — ${booking.service_name}`,
    },
  });

  const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
  await pool.query(
    `UPDATE bookings SET ${sessionIdField} = $2, payment_status = 'pending' WHERE id = $1`,
    [booking.id, sessionId]
  );
  return { checkoutUrl };
}

async function markBookingPaid(tenantId, sessionId, amountMinor, currency, provider = "stripe") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
    const { rows } = await client.query(
      `UPDATE bookings SET payment_status = 'paid', status = 'confirmed'
       WHERE tenant_id = $1 AND ${sessionIdField} = $2
       RETURNING *`,
      [tenantId, sessionId]
    );
    const booking = rows[0];
    if (!booking) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
       VALUES ($1, 'booking', $2, $3, $4, $5, $6, 'succeeded')`,
      [tenantId, booking.id, provider, sessionId, amountMinor, currency]
    );

    await client.query("COMMIT");
    return booking;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return null;
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createBooking, listBookings, updateBookingStatus, startBookingCheckout, markBookingPaid };
