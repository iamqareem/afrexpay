// src/modules/services/availability.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listWindows, setWindows, addException, listExceptions, deleteException, getAvailableSlots, EXCEPTION_STATUSES } = require("./availability.service");

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
    if (typeof w.dayOfWeek !== "number" || w.dayOfWeek < 0 || w.dayOfWeek > 6 || !w.startTime || !w.endTime) {
      return res.status(400).json({ error: "Each window needs dayOfWeek (0-6), startTime, and endTime." });
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
  const deleted = await deleteException(req.tenant.id, req.params.id);
  if (!deleted) return res.status(404).json({ error: "Exception not found." });
  res.status(204).end();
});

router.post("/exceptions", authRequired, async (req, res) => {
  const { date, isAvailable, startTime, endTime } = req.body || {};
  if (!date) {
    return res.status(400).json({ error: "date is required (YYYY-MM-DD)." });
  }
  const result = await addException(req.tenant.id, { date, isAvailable: !!isAvailable, startTime, endTime });
  res.status(201).json(result);
});

// Public — the storefront's booking picker calls this to show free slots.
router.get("/slots", async (req, res) => {
  const { serviceId, date } = req.query;
  if (!serviceId || !date) {
    return res.status(400).json({ error: "serviceId and date query params are required." });
  }
  const result = await getAvailableSlots(req.tenant.id, serviceId, date);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
