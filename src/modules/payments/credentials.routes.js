// src/modules/payments/credentials.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { getCredentialsSummary, upsertCredentials } = require("./credentials.service");

const router = express.Router();

const VALID_PROVIDERS = new Set(["stripe", "paypal"]);
const BASE_URL = process.env.PUBLIC_BASE_URL || `https://${process.env.BASE_DOMAIN || "afrexpay.com"}`;

router.get("/:provider", authRequired, async (req, res) => {
  if (!VALID_PROVIDERS.has(req.params.provider)) {
    return res.status(400).json({ error: `Unknown provider. Choose one of: ${[...VALID_PROVIDERS].join(", ")}` });
  }
  const summary = await getCredentialsSummary(req.tenant.id, req.params.provider);
  // Must match the live mount in src/app.js ("/api/payments/webhook" +
  // router paths "/stripe/:tenantId" and "/paypal/:tenantId"). A wrong
  // URL here means the merchant pastes a dead endpoint into their
  // provider dashboard and payments silently never confirm.
  const webhookUrl = `${BASE_URL}/api/payments/webhook/${req.params.provider}/${req.tenant.id}`;
  res.json({
    ...(summary || { provider: req.params.provider, enabled: false, has_secret_key: false, has_webhook_secret: false }),
    webhookUrl,
  });
});

router.put("/:provider", authRequired, async (req, res) => {
  if (!VALID_PROVIDERS.has(req.params.provider)) {
    return res.status(400).json({ error: `Unknown provider. Choose one of: ${[...VALID_PROVIDERS].join(", ")}` });
  }
  const { secretKey, publishableKey, webhookSecret, mode, enabled } = req.body || {};
  if (mode !== undefined && !["test", "live"].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'test' or 'live'." });
  }
  const updated = await upsertCredentials(req.tenant.id, req.params.provider, {
    secretKey, publishableKey, webhookSecret, mode, enabled,
  });
  res.json(updated);
});

module.exports = router;
