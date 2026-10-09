// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/modules/discovery/discovery.service.js — read-only catalog access for
// crawlable detail pages (/p/:slug, /s/:slug, /l/:slug) and sitemaps.
//
// Same visibility rules as the public list endpoints: only active products/
// services and non-off-market listings are discoverable. Unknown kinds
// return null rather than throwing — theme-server maps the URL prefix
// through KIND_BY_PREFIX first, this is the second gate.
const pool = require("../../db/pool");
const { minorToMajor, absoluteMediaUrl } = require("../../lib/seo");

const KIND_TABLE = { product: "products", service: "services", listing: "listings" };

// One entity + its cover photo (lowest sort_order wins, same lateral trick
// as the list endpoints) for per-entity <head> injection in theme-server.
async function getStorefrontEntity(tenantId, kind, slug) {
  const table = KIND_TABLE[kind];
  if (!table) return null;
  const visibility =
    kind === "listing" ? "AND t.status != 'off_market'" : "AND t.active = true";
  const { rows } = await pool.query(
    `SELECT t.*, m.storage_path AS cover_path
     FROM ${table} t
     LEFT JOIN LATERAL (
       SELECT storage_path FROM media
       WHERE tenant_id = t.tenant_id AND entity_type = $2 AND entity_id = t.id
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 1
     ) m ON true
     WHERE t.tenant_id = $1 AND t.slug = $3 ${visibility}`,
    [tenantId, kind, slug]
  );
  return rows[0] || null;
}

// Every indexable URL for one tenant's sitemap, newest first. Single
// round trip (UNION ALL, not three queries) — sitemaps are crawler-speed,
// but there's no reason to spend three.
async function listSitemapEntries(tenantId, { limit = 5000 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 5000, 1), 5000);
  const { rows } = await pool.query(
    `SELECT 'product' AS kind, slug, updated_at FROM products
      WHERE tenant_id = $1 AND slug IS NOT NULL AND active = true
     UNION ALL
     SELECT 'service' AS kind, slug, updated_at FROM services
      WHERE tenant_id = $1 AND slug IS NOT NULL AND active = true
     UNION ALL
     SELECT 'listing' AS kind, slug, updated_at FROM listings
      WHERE tenant_id = $1 AND slug IS NOT NULL AND status != 'off_market'
     ORDER BY updated_at DESC
     LIMIT $2`,
    [tenantId, cap]
  );
  return rows;
}

module.exports = { KIND_TABLE, getStorefrontEntity, listSitemapEntries, listFeedProducts, countCatalog, toFeedProduct, toAgentService, toAgentListing, buildMerchantCsv };

// ---- product feeds (PR3: shopping surfaces + agentic checkout) ----

// Feed rows: active, slugged products with cover photo, newest first.
// Own cap (not parseListParams): feeds are bulk snapshots, Merchant Center
// fetches the whole catalog in one go — 100-row pages would just mean
// 10x the requests for the same bytes.
async function listFeedProducts(tenantId, { limit = 500 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.slug, p.name, p.category, p.price_minor, p.currency,
            p.stock_qty, p.blurb, p.updated_at, m.storage_path AS cover_path
     FROM products p
     LEFT JOIN LATERAL (
       SELECT storage_path FROM media
       WHERE tenant_id = p.tenant_id AND entity_type = 'product' AND entity_id = p.id
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 1
     ) m ON true
     WHERE p.tenant_id = $1 AND p.slug IS NOT NULL AND p.active = true
     ORDER BY p.updated_at DESC
     LIMIT $2`,
    [tenantId, cap]
  );
  return rows;
}

async function countCatalog(tenantId) {
  const { rows } = await pool.query(
    `SELECT 'product' AS kind, COUNT(*)::int AS n FROM products
      WHERE tenant_id = $1 AND slug IS NOT NULL AND active = true
     UNION ALL
     SELECT 'service' AS kind, COUNT(*)::int AS n FROM services
      WHERE tenant_id = $1 AND slug IS NOT NULL AND active = true
     UNION ALL
     SELECT 'listing' AS kind, COUNT(*)::int AS n FROM listings
      WHERE tenant_id = $1 AND slug IS NOT NULL AND status != 'off_market'`,
    [tenantId]
  );
  const counts = { product: 0, service: 0, listing: 0 };
  for (const row of rows) {
    if (counts[row.kind] !== undefined) counts[row.kind] = row.n;
  }
  return counts;
}

function productAvailability(row) {
  const qty = row?.stock_qty;
  // NULL stock = untracked = sellable, not zero.
  return qty === null || qty === undefined || Number(qty) > 0 ? "in_stock" : "out_of_stock";
}

// One product shaped for machine consumers (ACP-compatible superset:
// id/title/price/availability/image/link plus store context). Pure —
// feeds, agent API, and tests share it.
function toFeedProduct(row, canonicalBase, storeName) {
  const base = String(canonicalBase || "").replace(/\/+$/, "");
  const image = absoluteMediaUrl(base, row?.cover_path);
  return {
    id: String(row?.id || ""),
    slug: String(row?.slug || ""),
    title: String(row?.name || ""),
    description: String(row?.blurb || ""),
    link: `${base}/p/${row?.slug}`,
    image: image || null,
    price: minorToMajor(row?.price_minor ?? 0, row?.currency),
    currency: String(row?.currency || "UGX"),
    availability: productAvailability(row),
    brand: String(storeName || ""),
    category: row?.category || null,
    condition: "new",
    mpn: row?.sku || null,
  };
}

// Agent-API shapes for services and listings (products reuse
// toFeedProduct). Pure mappers — routes stay thin, tests stay DB-free.
function toAgentService(row, canonicalBase) {
  const base = String(canonicalBase || "").replace(/\/+$/, "");
  return {
    id: String(row?.id || ""),
    slug: String(row?.slug || ""),
    title: String(row?.name || ""),
    description: String(row?.description || ""),
    link: `${base}/s/${row?.slug}`,
    image: null,
    price: minorToMajor(row?.price_minor ?? 0, row?.currency),
    currency: String(row?.currency || "UGX"),
    durationMinutes: row?.duration_minutes ?? null,
  };
}

function toAgentListing(row, canonicalBase) {
  const base = String(canonicalBase || "").replace(/\/+$/, "");
  return {
    id: String(row?.id || ""),
    slug: String(row?.slug || ""),
    title: String(row?.title || ""),
    description: String(row?.description || ""),
    link: `${base}/l/${row?.slug}`,
    image: absoluteMediaUrl(base, row?.thumbnail_path) || null,
    price: minorToMajor(row?.price_minor ?? 0, row?.currency),
    currency: String(row?.currency || "UGX"),
    location: row?.location || null,
    listingType: row?.listing_type || null,
    status: row?.status || null,
  };
}

function csvCell(value) {  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Google Merchant Center CSV: header + one row per product. Price format
// is "<major> <CURRENCY>" (e.g. "19.99 USD", "5000 UGX").
function buildMerchantCsv(items) {
  const header = ["id", "title", "description", "link", "image_link", "price", "availability", "brand", "condition", "mpn"];
  const lines = [header.join(",")];
  for (const item of items) {
    lines.push(
      [
        item.id, item.title, item.description, item.link, item.image || "",
        `${item.price} ${item.currency}`, item.availability, item.brand,
        item.condition, item.mpn || "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}
