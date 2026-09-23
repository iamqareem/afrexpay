// src/modules/bookings/booking.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");

// Postgres error code for exclusion constraint violation — this is how a
// double-booking attempt surfaces. Not a magic number pulled from nowhere:
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const EXCLUSION_VIOLATION = "23P01";

// Mirrors the booking_status ENUM in migrations/1751500000000_initial-schema.js.
const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "completed"];

// Pure slot-window check (no DB) — unit-tested in tests/booking-windows.test.js.
// Minutes are offsets from UTC midnight of the booking date; windows are
// { start: "HH:MM", end: "HH:MM" } in the same frame.
// Returns "ok" | "outside" | "misaligned".
function checkSlotInWindows(slotStartMin, slotEndMin, durationMinutes, windows) {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return "outside";
  let insideAnyWindow = false;
  let aligned = false;
  for (const w of windows || []) {
    if (!w.start || !w.end) continue;
    const [wsH, wsM] = String(w.start).split(":").map(Number);
    const [weH, weM] = String(w.end).split(":").map(Number);
    if ([wsH, wsM, weH, weM].some((n) => Number.isNaN(n))) continue;
    const winStartMin = wsH * 60 + wsM;
    const winEndMin = weH * 60 + weM;
    if (winEndMin <= winStartMin) continue;
    if (slotStartMin >= winStartMin && slotEndMin <= winEndMin) {
      insideAnyWindow = true;
      if ((slotStartMin - winStartMin) % durationMinutes === 0) aligned = true;
      break;
    }
  }
  if (!insideAnyWindow) return "outside";
  if (!aligned) return "misaligned";
  return "ok";
}

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

  // ---- Availability window enforcement: slot must sit inside merchant's
  // working hours for that date and align to the service's duration grid.
  // Previously this check only lived in GET /availability/slots (UI helper),
  // so a direct POST /api/bookings could book 02:00 outside hours.
  {
    const dateStr = start.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
    const dayOfWeek = start.getUTCDay();

    const exRes = await pool.query(
      `SELECT is_available, start_time, end_time FROM availability_exceptions WHERE tenant_id = $1 AND date = $2`,
      [tenantId, dateStr]
    );
    const ex = exRes.rows[0];
    let windows;
    if (ex) {
      if (!ex.is_available) {
        throw Object.assign(new Error("This store is closed on the selected date."), { status: 400 });
      }
      if (!ex.start_time || !ex.end_time) {
        throw Object.assign(new Error("Working hours not configured for the selected date."), { status: 400 });
      }
      windows = [{ start: ex.start_time, end: ex.end_time }];
    } else {
      const winRes = await pool.query(
        `SELECT start_time, end_time FROM availability_windows WHERE tenant_id = $1 AND day_of_week = $2 ORDER BY start_time`,
        [tenantId, dayOfWeek]
      );
      if (winRes.rows.length === 0) {
        throw Object.assign(new Error("This store is closed on the selected day."), { status: 400 });
      }
      windows = winRes.rows.map((r) => ({ start: r.start_time, end: r.end_time }));
    }

    const duration = service.duration_minutes;
    const dayStartUtc = new Date(`${dateStr}T00:00:00Z`);
    const slotStartMin = Math.round((start.getTime() - dayStartUtc.getTime()) / 60000);
    const slotEndMin = Math.round((end.getTime() - dayStartUtc.getTime()) / 60000);

    const verdict = checkSlotInWindows(slotStartMin, slotEndMin, duration, windows);
    if (verdict === "outside") {
      throw Object.assign(new Error("Requested time is outside working hours."), { status: 400 });
    }
    if (verdict === "misaligned") {
      throw Object.assign(new Error(`Time must align to ${duration}-minute slots from window start.`), { status: 400 });
    }
  }

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
const { savePayPalOrderContext } = require("../payments/paypal-context.service");

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
    amountMinor: booking.price_minor,
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

  if (provider === "paypal") {
    await savePayPalOrderContext(sessionId, tenantId, "booking", booking.id);
  }

  const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
  if (!["stripe_checkout_session_id", "paypal_checkout_session_id"].includes(sessionIdField)) {
    throw Object.assign(new Error("Invalid provider session field."), { status: 400 });
  }
  await pool.query(
    `UPDATE bookings SET ${sessionIdField} = $2, payment_status = 'pending' WHERE tenant_id = $3 AND id = $1`,
    [booking.id, sessionId, tenantId]
  );
  return { checkoutUrl };
}

async function markBookingPaid(tenantId, sessionId, amountMinor, currency, provider = "stripe", providerRef = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
    const { rows } = await client.query(
      `UPDATE bookings SET payment_status = 'paid', status = 'confirmed'
       WHERE tenant_id = $1 AND ${sessionIdField} = $2 AND payment_status = 'pending'
       RETURNING *`,
      [tenantId, sessionId]
    );
    const booking = rows[0];
    if (!booking) {
      await client.query("ROLLBACK");
      return null;
    }

    if (!amountMinor || amountMinor < booking.price_minor) {
      await client.query("ROLLBACK");
      console.error(`Booking ${booking.id} underpaid: expected ${booking.price_minor} ${booking.currency}, got ${amountMinor} ${currency}`);
      try {
        await pool.query(
          `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
           VALUES ($1, 'booking', $2, $3, $4, $5, $6, 'failed')`,
          [tenantId, booking.id, provider, providerRef || sessionId, amountMinor || 0, currency || booking.currency]
        );
      } catch {}
      return null;
    }
    if (currency && booking.currency && currency.toUpperCase() !== booking.currency.toUpperCase()) {
      await client.query("ROLLBACK");
      console.error(`Booking ${booking.id} currency mismatch: expected ${booking.currency}, got ${currency}`);
      try {
        await pool.query(
          `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
           VALUES ($1, 'booking', $2, $3, $4, $5, $6, 'failed')`,
          [tenantId, booking.id, provider, providerRef || sessionId, amountMinor || 0, currency || booking.currency]
        );
      } catch {}
      return null;
    }

    const ref = providerRef || sessionId;
    await client.query(
      `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
       VALUES ($1, 'booking', $2, $3, $4, $5, $6, 'succeeded')`,
      [tenantId, booking.id, provider, ref, amountMinor, currency]
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

module.exports = { createBooking, listBookings, updateBookingStatus, startBookingCheckout, markBookingPaid, checkSlotInWindows, BOOKING_STATUSES };
