// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/lib/slug.js — human-readable keys for crawlable detail URLs.
//
// Slugs are generated once from name/title at create time and stay stable
// afterwards: renaming a product must not rot an already-indexed URL.
// Uniqueness is per tenant (UNIQUE(tenant_id, slug) in the catalog-slugs
// migration), resolved by appending -2, -3, ... at write time.
const pool = require("../db/pool");

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;

function slugify(text, { maxLength = MAX_SLUG_LENGTH } = {}) {
  const slug = String(text ?? "")
    .normalize("NFKD") // Café -> Cafe (strip diacritics, crawlers prefer ascii)
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug.slice(0, maxLength).replace(/-+$/g, "");
}

function isValidSlug(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH &&
    SLUG_RE.test(value)
  );
}

function slugError(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!isValidSlug(value)) {
    return `slug must be ${MAX_SLUG_LENGTH} chars or fewer: lowercase letters, numbers, and single dashes (e.g. "arabica-coffee").`;
  }
  return null;
}

// Resolve a unique slug within one tenant's table. Tries base, then
// base-2, base-3, ... — catalog writes are merchant-speed, so a short
// EXISTS loop is cheaper than a fancier scheme and stays collision-safe
// under the UNIQUE(tenant_id, slug) index as the backstop.
async function uniqueSlug(table, tenantId, base, { allowedTables = ["products", "services", "listings"] } = {}) {
  if (!allowedTables.includes(table)) throw new Error(`Slug lookup on unknown table "${table}".`);
  const stem = slugify(base) || "item";
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = attempt === 1 ? stem : `${stem.slice(0, MAX_SLUG_LENGTH - String(attempt + 1).length)}-${attempt}`;
    const { rows } = await pool.query(
      `SELECT 1 FROM ${table} WHERE tenant_id = $1 AND slug = $2 LIMIT 1`,
      [tenantId, candidate]
    );
    if (rows.length === 0) return candidate;
  }
  // Practically unreachable (50 same-name rows) — uuid suffix guarantees it.
  const { rows } = await pool.query(`SELECT LEFT(gen_random_uuid()::text, 8) AS suffix`);
  return `${stem.slice(0, 71)}-${rows[0].suffix}`;
}

module.exports = { SLUG_RE, MAX_SLUG_LENGTH, slugify, isValidSlug, slugError, uniqueSlug };
