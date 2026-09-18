// src/modules/services/service.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listServices, createService, updateService, deactivateService } = require("./service.service");

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await listServices(req.tenant.id, req.query));
});

router.post("/", authRequired, async (req, res) => {
  const { name, durationMinutes, priceMinor } = req.body || {};
  if (!name || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(priceMinor)) {
    return res.status(400).json({ error: "name, durationMinutes (positive integer), and priceMinor (integer) are required." });
  }
  const service = await createService(req.tenant.id, req.body);
  res.status(201).json(service);
});

router.patch("/:id", authRequired, async (req, res) => {
  const updated = await updateService(req.tenant.id, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Service not found." });
  res.json(updated);
});

router.delete("/:id", authRequired, async (req, res) => {
  const result = await deactivateService(req.tenant.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Service not found." });
  res.status(204).send();
});

module.exports = router;
