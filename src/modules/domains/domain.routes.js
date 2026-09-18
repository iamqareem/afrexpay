// src/modules/domains/domain.routes.js — tenant-scoped, mounted AFTER tenantResolver.
// These three routes handle the lifecycle of a merchant's custom domain from
// the dashboard: read current status, claim a new domain, and trigger the
// live DNS verification check.
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { setCustomDomain, getDomainStatus, verifyCustomDomain } = require("./domain.service");

const router = express.Router();

// GET /api/domains — return the tenant's current custom_domain + verified_at
router.get("/", authRequired, async (req, res) => {
  try {
    res.json(await getDomainStatus(req.tenant.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PATCH /api/domains — set or update the custom domain string.
// Always resets verification — see domain.service.js for rationale.
router.patch("/", authRequired, async (req, res) => {
  try {
    const result = await setCustomDomain(req.tenant.id, req.body?.domain || "");
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/domains/verify — trigger a live DNS check.
// Returns { verified: bool, domain: string }. The frontend polls this after
// the merchant says they've updated their DNS.
router.post("/verify", authRequired, async (req, res) => {
  try {
    const result = await verifyCustomDomain(req.tenant.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
