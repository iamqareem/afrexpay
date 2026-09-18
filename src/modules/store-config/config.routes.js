// src/modules/store-config/config.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { getConfig, updateConfig, setThemeSlug } = require("./config.service");
const { VALID_THEMES } = require("../../middleware/theme-server");
const { VERTICALS, VALID_VERTICALS, getThemesForVertical, isThemeCompatible, THEMES_REGISTRY } = require("../../verticals");
const { invalidateTenantCache } = require("../../middleware/tenant-resolver");

const router = express.Router();

// Public — the storefront frontend fetches this to render brand copy/colors.
router.get("/", async (req, res) => {
  const result = await getConfig(req.tenant.id);
  res.json(result);
});

// Merchant-only — editing your own store's config.
router.patch("/", authRequired, async (req, res) => {
  if (typeof req.body !== "object" || req.body === null) {
    return res.status(400).json({ error: "Body must be a JSON object of config fields to update." });
  }
  if (req.body.vertical !== undefined && !VALID_VERTICALS.has(req.body.vertical)) {
    return res.status(400).json({ error: `Unknown vertical. Choose one of: ${[...VALID_VERTICALS].join(", ")}` });
  }

  const updated = await updateConfig(req.tenant.id, req.body);

  // If vertical changed and current theme is not compatible, auto-switch to a compatible default
  if (req.body.vertical && !isThemeCompatible(req.body.vertical, req.tenant.theme_slug)) {
    const defaultTheme = VERTICALS[req.body.vertical].compatibleThemes[0];
    await setThemeSlug(req.tenant.id, defaultTheme);
  }

  invalidateTenantCache(req.tenant.subdomain);
  res.json(updated);
});

// Public-ish — registry lookup for dashboard tabs and vertical selector.
router.get("/verticals", authRequired, (req, res) => {
  res.json(VERTICALS);
});

// Merchant-only — themes list filtered by tenant's vertical (or specified vertical).
router.get("/themes", authRequired, (req, res) => {
  const requestedVertical = req.query.vertical || req.tenant.config?.vertical || "products";
  const compatibleThemes = getThemesForVertical(requestedVertical);
  res.json({
    themes: compatibleThemes,
    allThemes: Object.values(THEMES_REGISTRY),
    current: req.tenant.theme_slug,
    vertical: requestedVertical,
  });
});

router.patch("/theme", authRequired, async (req, res) => {
  const { themeSlug } = req.body || {};
  if (!VALID_THEMES.has(themeSlug)) {
    return res.status(400).json({ error: `Unknown theme. Choose one of: ${[...VALID_THEMES].join(", ")}` });
  }

  const tenantVertical = req.tenant.config?.vertical || "products";
  if (!isThemeCompatible(tenantVertical, themeSlug)) {
    return res.status(400).json({
      error: `Theme '${themeSlug}' is not compatible with business category '${tenantVertical}'.`,
    });
  }

  const updated = await setThemeSlug(req.tenant.id, themeSlug);
  invalidateTenantCache(req.tenant.subdomain);
  res.json(updated);
});

module.exports = router;
