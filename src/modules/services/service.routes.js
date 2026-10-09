// src/modules/services/service.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listServices, getServiceBySlug, createService, updateService, deactivateService } = require("./service.service");
const { validateService } = require("../../lib/catalog-validation");
const { UUID_RE } = require("../../lib/validate");
const { isValidSlug } = require("../../lib/slug");

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await listServices(req.tenant.id, req.query));
});

// Public detail for crawlable /s/:slug storefront URLs. Fixed "slug"
// segment (not GET /:id) so a future GET /:id can't swallow it.
router.get("/slug/:slug", async (req, res) => {
  if (!isValidSlug(req.params.slug)) return res.status(404).json({ error: "Service not found." });
  const service = await getServiceBySlug(req.tenant.id, req.params.slug);
  if (!service) return res.status(404).json({ error: "Service not found." });
  res.json(service);
});

router.post("/", authRequired, async (req, res) => {
  const createErr = validateService(req.body, { forUpdate: false });
  if (createErr) {
    return res.status(400).json({ error: createErr });
  }
  const service = await createService(req.tenant.id, req.body);
  res.status(201).json(service);
});

router.patch("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Service not found." });
  }
  const patchErr = validateService(req.body, { forUpdate: true });
  if (patchErr) {
    return res.status(400).json({ error: patchErr });
  }
  const updated = await updateService(req.tenant.id, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Service not found." });
  res.json(updated);
});

router.delete("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Service not found." });
  }
  const result = await deactivateService(req.tenant.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Service not found." });
  res.status(204).send();
});

module.exports = router;
