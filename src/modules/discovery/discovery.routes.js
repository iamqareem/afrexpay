// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/modules/discovery/discovery.routes.js — machine-readable storefront
// surface: product feeds, llms.txt, capability profile.
//
// Mounted at "/" (after tenantResolver, before the storefront catch-all in
// app.js): these are root paths (/feed/..., /llms.txt, /.well-known/...)
// that need req.tenant and must beat the catch-all, same placement rule as
// /qr.svg and /robots.txt. Everything here is read-only and rate-limited.
const express = require("express");
const { feedLimiter } = require("../../middleware/rate-limits");
const {
  canonicalBaseForTenant,
  getStoreName,
  getStoreDescription,
  buildTenantLlmsTxt,
} = require("../../lib/seo");
const { resolveVertical } = require("../../verticals");
const { getTenantCurrency } = require("../store-config/config.service");
const {
  listFeedProducts,
  countCatalog,
  toFeedProduct,
  buildMerchantCsv,
} = require("./discovery.service");

const router = express.Router();
router.use(feedLimiter);

function baseFor(req) {
  return canonicalBaseForTenant(req.tenant, req.headers.host).replace(/\/+$/, "");
}

// ACP-compatible JSON: id/title/price/availability/image/link plus store
// context — the same shape ChatGPT-style shopping surfaces ingest.
router.get("/feed/products.json", async (req, res) => {
  const base = baseFor(req);
  const storeName = getStoreName(req.tenant);
  const rows = await listFeedProducts(req.tenant.id, { limit: req.query.limit });
  const products = rows.map((row) => toFeedProduct(row, base, storeName));
  res.json({
    store: { name: storeName, url: `${base}/` },
    updated: new Date().toISOString(),
    count: products.length,
    products,
  });
});

// Google Merchant Center CSV: header + one row per product, price as
// "<major> <CURRENCY>". Upload cadence is the merchant's Merchant Center
// schedule — this endpoint always reflects the live catalog.
router.get("/feed/products.csv", async (req, res) => {
  const base = baseFor(req);
  const rows = await listFeedProducts(req.tenant.id, { limit: req.query.limit });
  const items = rows.map((row) => toFeedProduct(row, base, getStoreName(req.tenant)));
  res.type("text/csv").send(buildMerchantCsv(items));
});

// Plain-text shop map for AI assistants (fetched like robots.txt).
// Counts are best-effort: a failed COUNT still yields a valid file.
router.get("/llms.txt", async (req, res) => {
  const base = baseFor(req);
  let counts;
  try {
    counts = await countCatalog(req.tenant.id);
  } catch (err) {
    console.error("llms.txt counts failed:", err.message);
  }
  const currency = await getTenantCurrency(req.tenant.id);
  res.type("text/plain").send(buildTenantLlmsTxt(req.tenant, { canonicalBase: base, currency, counts }));
});

// Capability profile (UCP-style well-known URL): what this store sells,
// in which currency, and which machine endpoints exist. Checkout stays a
// hosted redirect — agents send shoppers there, they never take card data.
router.get("/.well-known/store-profile.json", async (req, res) => {
  const base = baseFor(req);
  let counts;
  try {
    counts = await countCatalog(req.tenant.id);
  } catch (err) {
    console.error("store-profile counts failed:", err.message);
  }
  const currency = await getTenantCurrency(req.tenant.id);
  res.json({
    protocol: "afrexpay-agent-v1",
    store: {
      name: getStoreName(req.tenant),
      description: getStoreDescription(req.tenant),
      url: `${base}/`,
      vertical: resolveVertical(req.tenant.config?.vertical),
      currency,
    },
    catalog: counts || undefined,
    endpoints: {
      store: `${base}/api/agent/v1/store`,
      products: `${base}/api/agent/v1/products`,
      services: `${base}/api/agent/v1/services`,
      listings: `${base}/api/agent/v1/listings`,
    },
    feeds: {
      productsJson: `${base}/feed/products.json`,
      productsCsv: `${base}/feed/products.csv`,
    },
    llms: `${base}/llms.txt`,
    checkout: {
      type: "hosted-redirect",
      providers: ["stripe", "paypal"],
      note: "Per-store availability varies — see /api/config/payment-methods. Never collect card details inside chat.",
    },
  });
});

module.exports = router;
