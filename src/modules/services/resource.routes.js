// src/modules/services/resource.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listResources, createResource, updateResource, deleteResource } = require("./resource.service");

const router = express.Router();

// All merchant-only — staff/chairs are back-office configuration.
router.get("/", authRequired, async (req, res) => {
  res.json(await listResources(req.tenant.id));
});

router.post("/", authRequired, async (req, res) => {
  const { name, serviceIds } = req.body || {};
  if (!name || (serviceIds !== undefined && !Array.isArray(serviceIds))) {
    return res.status(400).json({ error: "name is required; serviceIds must be an array of service ids." });
  }
  try {
    const resource = await createResource(req.tenant.id, { name, serviceIds: serviceIds || [] });
    res.status(201).json(resource);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not create resource." });
  }
});

router.patch("/:id", authRequired, async (req, res) => {
  const { name, active, serviceIds } = req.body || {};
  if (serviceIds !== undefined && !Array.isArray(serviceIds)) {
    return res.status(400).json({ error: "serviceIds must be an array of service ids." });
  }
  try {
    const updated = await updateResource(req.tenant.id, req.params.id, { name, active, serviceIds });
    if (!updated) return res.status(404).json({ error: "Resource not found." });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not update resource." });
  }
});

router.delete("/:id", authRequired, async (req, res) => {
  try {
    const deleted = await deleteResource(req.tenant.id, req.params.id);
    if (!deleted) return res.status(404).json({ error: "Resource not found." });
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not delete resource." });
  }
});

module.exports = router;
