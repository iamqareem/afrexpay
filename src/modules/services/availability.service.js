// src/modules/services/availability.service.js
const pool = require("../../db/pool");
const { parseListParams } = require("../../lib/list-query");

// Merchant-facing status words; the column itself is boolean.
const EXCEPTION_STATUSES = ["open", "blocked"];

async function listWindows(tenantId) {
  const { rows } = await pool.query(
    `SELECT id, day_of_week, start_time, end_time FROM availability_windows WHERE tenant_id = $1 ORDER BY day_of_week, start_time`,
    [tenantId]
  );
  return rows;
}

async function setWindows(tenantId, windows) {
  // Full replace, not incremental patch — a weekly schedule is small and
  // merchants think of it as "here's my whole week," so replacing it
  // wholesale on every save avoids reconciling adds/removes/edits as three
  // separate operations for what's really one mental action.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM availability_windows WHERE tenant_id = $1`, [tenantId]);
    for (const w of windows) {
      await client.query(
        `INSERT INTO availability_windows (tenant_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)`,
        [tenantId, w.dayOfWeek, w.startTime, w.endTime]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return listWindows(tenantId);
}

async function addException(tenantId, { date, isAvailable, startTime, endTime }) {
  const { rows } = await pool.query(
    `INSERT INTO availability_exceptions (tenant_id, date, is_available, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, date) DO UPDATE SET is_available = $3, start_time = $4, end_time = $5
     RETURNING *`,
    [tenantId, date, isAvailable, startTime || null, endTime || null]
  );
  return rows[0];
}

async function listExceptions(tenantId, params = {}) {
  const { status, limit, offset, dir } = parseListParams(params, { defaultDir: "ASC" });
  const conditions = [`tenant_id = $1`];
  const values = [tenantId];
  if (status === "open" || status === "blocked") {
    values.push(status === "open");
    conditions.push(`is_available = $${values.length}`);
  }
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id, date, is_available, start_time, end_time FROM availability_exceptions
     WHERE ${conditions.join(" AND ")} ORDER BY date ${dir}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

async function deleteException(tenantId, exceptionId) {
  const { rows } = await pool.query(
    `DELETE FROM availability_exceptions WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, exceptionId]
  );
  return rows[0] || null;
}

// Computes free slots for a given service on a given date, at the service's
// own duration granularity. Reads the day's window (exception overrides the
// weekly recurring one if present), then subtracts any existing non-cancelled
// bookings that overlap each candidate slot.
async function getAvailableSlots(tenantId, serviceId, dateStr) {
  const serviceResult = await pool.query(
    `SELECT duration_minutes FROM services WHERE tenant_id = $1 AND id = $2 AND active = true`,
    [tenantId, serviceId]
  );
  const service = serviceResult.rows[0];
  if (!service) return { error: "Service not found." };

  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay();

  const exceptionResult = await pool.query(
    `SELECT is_available, start_time, end_time FROM availability_exceptions WHERE tenant_id = $1 AND date = $2`,
    [tenantId, dateStr]
  );
  const exception = exceptionResult.rows[0];

  let windows;
  if (exception) {
    if (!exception.is_available) return { slots: [] }; // explicit blackout day
    if (!exception.start_time || !exception.end_time) return { slots: [] };
    windows = [{ start: exception.start_time, end: exception.end_time }];
  } else {
    const windowResult = await pool.query(
      `SELECT start_time, end_time FROM availability_windows WHERE tenant_id = $1 AND day_of_week = $2 ORDER BY start_time`,
      [tenantId, dayOfWeek]
    );
    if (windowResult.rows.length === 0) return { slots: [] }; // no recurring hours set for this weekday
    windows = windowResult.rows.map((r) => ({ start: r.start_time, end: r.end_time }));
  }

  // Existing bookings that day, for conflict-checking against candidate slots.
  const bookingsResult = await pool.query(
    `SELECT time_range FROM bookings
     WHERE tenant_id = $1 AND service_id = $3 AND status != 'cancelled'
       AND time_range && tstzrange($2::date, ($2::date + interval '1 day'))`,
    [tenantId, dateStr, serviceId]
  );
  const bookedRanges = bookingsResult.rows.map((r) => r.time_range);

  const durationMs = service.duration_minutes * 60 * 1000;
  const dayStart = new Date(`${dateStr}T00:00:00Z`);

  const slots = [];
  for (const w of windows) {
    if (!w.start || !w.end) continue;
    const [wsH, wsM] = w.start.split(":").map(Number);
    const [weH, weM] = w.end.split(":").map(Number);
    if ([wsH, wsM, weH, weM].some((n) => Number.isNaN(n))) continue;
    const slotStart0 = new Date(dayStart.getTime() + (wsH * 60 + wsM) * 60000);
    const windowEndTime = new Date(dayStart.getTime() + (weH * 60 + weM) * 60000);
    if (windowEndTime <= slotStart0) continue;
    let cursor = new Date(slotStart0);
    while (cursor.getTime() + durationMs <= windowEndTime.getTime()) {
      const slotEnd = new Date(cursor.getTime() + durationMs);
      const overlapsExisting = bookedRanges.some((rangeStr) => rangesOverlap(rangeStr, cursor, slotEnd));
      if (!overlapsExisting) {
        slots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
      }
      cursor = slotEnd; // back-to-back slots at the service's own duration granularity
    }
  }
  slots.sort((a, b) => new Date(a.start) - new Date(b.start));

  return { slots };
}

// Postgres returns tstzrange as a string like ["2026-08-01 14:00:00+00","2026-08-01 14:45:00+00")
// — parsed here rather than pulled apart in SQL, since the overlap check
// itself already happened server-side when fetching bookedRanges; this is
// just re-deriving bounds for the slot-generation loop above.
function rangesOverlap(pgRangeStr, slotStart, slotEnd) {
  const match = pgRangeStr.match(/[\[(]"?([^,"]+)"?,"?([^,")]+)"?[\])]/);
  if (!match) return false;
  const [, startStr, endStr] = match;
  const existingStart = new Date(startStr);
  const existingEnd = new Date(endStr);
  return slotStart < existingEnd && existingStart < slotEnd;
}

module.exports = { listWindows, setWindows, addException, listExceptions, deleteException, getAvailableSlots, rangesOverlap, EXCEPTION_STATUSES };
