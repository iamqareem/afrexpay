// src/modules/services/availability.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listWindows, setWindows, addException, listExceptions, deleteException, getAvailableSlots, EXCEPTION_STATUSES } = require("./availability.service");
const { publicWriteLimiter, slotsLimiter } = require("../../middleware/rate-limits");
const { UUID_RE, isValidDate, isValidTime, isEndAfterStart, isDayOfWeek } = require("../../lib/validate");

const router = express.Router();

// Merchant-only — weekly recurring hours.
router.get("/windows", authRequired, async (req, res) => {
  res.json(await listWindows(req.tenant.id));
});

router.put("/windows", authRequired, async (req, res) => {
  const { windows } = req.body || {};
  if (!Array.isArray(windows)) {
    return res.status(400).json({ error: "windows must be an array of { dayOfWeek, startTime, endTime }." });
  }
  for (const w of windows) {
    // Integer day (2.5 passes a range check but matches no weekday), real
    // HH:MM times, and end after start — the DB CHECKs reject the rest as
    // 500s, so catch them here as 400s with a usable message instead.
    if (!isDayOfWeek(w.dayOfWeek) || !isValidTime(w.startTime) || !isValidTime(w.endTime)) {
      return res.status(400).json({ error: "Each window needs dayOfWeek (integer 0-6) and startTime/endTime as HH:MM." });
    }
    if (!isEndAfterStart(w.startTime, w.endTime)) {
      return res.status(400).json({ error: "Each window needs endTime after startTime." });
    }
  }
  res.json(await setWindows(req.tenant.id, windows));
});

// Merchant-only — one-off exceptions (blackout days, extra hours).
router.get("/exceptions", authRequired, async (req, res) => {
  if (req.query.status && !EXCEPTION_STATUSES.includes(req.query.status)) {
    return res.status(400).json({ error: `status must be one of: ${EXCEPTION_STATUSES.join(", ")}.` });
  }
  res.json(await listExceptions(req.tenant.id, req.query));
});

router.delete("/exceptions/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Exception not found." });
  }
  const deleted = await deleteException(req.tenant.id, req.params.id);
  if (!deleted) return res.status(404).json({ error: "Exception not found." });
  res.status(204).end();
});

router.post("/exceptions", authRequired, async (req, res) => {
  const { date, isAvailable, startTime, endTime } = req.body || {};
  if (!isValidDate(date)) {
    return res.status(400).json({ error: "date is required as a real calendar date (YYYY-MM-DD)." });
  }
  // The dashboard select serializes to "true"/"false" strings — !!("false")
  // is true, which would open a day meant to be blocked. Coerce properly.
  const open = isAvailable === true || isAvailable === "true";
  if (open) {
    if (!isValidTime(startTime) || !isValidTime(endTime)) {
      return res.status(400).json({ error: "Open days need startTime and endTime as HH:MM." });
    }
    if (!isEndAfterStart(startTime, endTime)) {
      return res.status(400).json({ error: "endTime must be after startTime." });
    }
  }
  // A blocked day carries no hours — null them even if the client sent
  // some, so an "open with null times" row (which reads as a blackout
  // with no explanation) can never be written.
  const result = await addException(req.tenant.id, {
    date,
    isAvailable: open,
    startTime: open ? startTime : null,
    endTime: open ? endTime : null,
  });
  res.status(201).json(result);
});

// Public — the storefront's booking picker calls this to show free slots.
// Optional resourceId narrows to one staff/chair; response includes the
// eligible resources list when there's more than one to choose from.
router.get("/slots", slotsLimiter, async (req, res) => {
  const { serviceId, date, resourceId } = req.query;
  if (!serviceId || !date) {
    return res.status(400).json({ error: "serviceId and date query params are required." });
  }
  // Malformed ids/dates reach UUID columns and ::date casts, which throw
  // PG 22P02 as 500s — reject them here as 400s before any query runs.
  if (!UUID_RE.test(serviceId)) {
    return res.status(400).json({ error: "Invalid serviceId." });
  }
  if (resourceId && !UUID_RE.test(resourceId)) {
    return res.status(400).json({ error: "Invalid resourceId." });
  }
  if (!isValidDate(date)) {
    return res.status(400).json({ error: "date must be a real calendar date (YYYY-MM-DD)." });
  }
  const result = await getAvailableSlots(req.tenant.id, serviceId, date, resourceId || null);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
