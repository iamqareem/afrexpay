// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/modules/discovery/agent.routes.js — read-only agent API (v1).
//
// For AI shopping assistants: stable JSON over the existing public catalog
// queries (same visibility rules, same list caps), with absolute detail
// URLs and images so an agent can recommend, link, and hand off to the
// existing public order/booking/inquiry endpoints + hosted checkout.
// Mounted at /api/agent/v1 in app.js. Writes are deliberately absent —
// agents use the storefront's public POST endpoints like any shopper.
const express = require("express");
const { feedLimiter } = require("../../middleware/rate-limits");
const {
  canonicalBaseForTenant,
  getStoreName,
  getStoreDescription,
} = require("../../lib/seo");
const { resolveVertical } = require("../../verticals");
const { getTenantCurrency } = require("../store-config/config.service");
const { listProducts } = require("../products/product.service");
const { listServices } = require("../services/service.service");
const { listListings } = require("../listings/listing.service");
const { countCatalog, toFeedProduct, toAgentService, toAgentListing } = require("./discovery.service");

const router = express.Router();
router.use(feedLimiter);

function baseFor(req) {
  return canonicalBaseForTenant(req.tenant, req.headers.host).replace(/\/+$/, "");
}

router.get("/store", async (req, res) => {
  const base = baseFor(req);
  let catalog;
  try {
    catalog = await countCatalog(req.tenant.id);
  } catch (err) {
    console.error("agent store counts failed:", err.message);
  }
  res.json({
    name: getStoreName(req.tenant),
    description: getStoreDescription(req.tenant),
    url: `${base}/`,
    vertical: resolveVertical(req.tenant.config?.vertical),
    currency: await getTenantCurrency(req.tenant.id),
    ...(catalog ? { catalog } : {}),
    links: {
      products: `${base}/api/agent/v1/products`,
      services: `${base}/api/agent/v1/services`,
      listings: `${base}/api/agent/v1/listings`,
      feeds: { productsJson: `${base}/feed/products.json`, productsCsv: `${base}/feed/products.csv` },
      llms: `${base}/llms.txt`,
    },
    checkout: {
      type: "hosted-redirect",
      note: "Place orders via the public POST endpoints, then redirect the shopper to the hosted Stripe/PayPal URL from the checkout endpoint.",
    },
  });
});

// Product search: same caps as the public catalog (limit ≤ 100 via the
// shared parser), shaped with absolute URLs for agents.
router.get("/products", async (req, res) => {
  const base = baseFor(req);
  const rows = await listProducts(req.tenant.id, req.query);
  const items = rows.map((row) => toFeedProduct(row, base, getStoreName(req.tenant)));
  res.json({ count: items.length, items });
});

router.get("/services", async (req, res) => {
  const base = baseFor(req);
  const rows = await listServices(req.tenant.id, req.query);
  res.json({ count: rows.length, items: rows.map((row) => toAgentService(row, base)) });
});

router.get("/listings", async (req, res) => {
  const base = baseFor(req);
  const rows = await listListings(req.tenant.id, req.query);
  res.json({ count: rows.length, items: rows.map((row) => toAgentListing(row, base)) });
});

module.exports = router;
