// src/modules/services/resource.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listResources, createResource, deleteResource } = require("./resource.service");

const router = express.Router();

// All merchant-only — staff/chairs are back-office configuration.
router.get("/", authRequired, async (req, res) => {
  res.json(await listResources(req.tenant.id));
});

router.post("/", authRequired, async (req, res) => {
  const { name, serviceId } = req.body || {};
  if (!name || !serviceId) {
    return res.status(400).json({ error: "name and serviceId are required." });
  }
  try {
    const resource = await createResource(req.tenant.id, { name, serviceId });
    res.status(201).json(resource);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not create resource." });
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
