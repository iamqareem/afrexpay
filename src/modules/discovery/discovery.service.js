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

module.exports = { KIND_TABLE, getStorefrontEntity, listSitemapEntries };
