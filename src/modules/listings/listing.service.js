// src/modules/listings/listing.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");
const { uniqueSlug, isValidSlug } = require("../../lib/slug");
const { getTenantCurrency } = require("../store-config/config.service");

async function listListings(tenantId, params = {}) {
  // Pulls one thumbnail per listing (lowest sort_order, tiebreak by
  // oldest) in the same round trip — avoids an N+1 media fetch per card
  // in the grid. Detail view still hits /api/media/for/listing/:id for
  // the full photo set.
  const { search, limit, offset, dir } = parseListParams(params);
  const conditions = [`l.tenant_id = $1`, `l.status != 'off_market'`];
  const values = [tenantId];
  if (search) conditions.push(searchCondition(values, ["l.title", "l.location"], search));
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT l.*, m.storage_path AS thumbnail_path
     FROM listings l
      LEFT JOIN LATERAL (
        SELECT storage_path FROM media
        WHERE tenant_id = l.tenant_id AND entity_type = 'listing' AND entity_id = l.id
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1
      ) m ON true
     WHERE ${conditions.join(" AND ")}
     ORDER BY l.created_at ${dir}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

async function getListing(tenantId, listingId) {
  const { rows } = await pool.query(`SELECT * FROM listings WHERE tenant_id = $1 AND id = $2`, [tenantId, listingId]);
  return rows[0] || null;
}

async function getListingBySlug(tenantId, slug) {
  const { rows } = await pool.query(
    `SELECT * FROM listings WHERE tenant_id = $1 AND slug = $2 AND status != 'off_market'`,
    [tenantId, slug]
  );
  return rows[0] || null;
}

async function createListing(tenantId, data) {
  const { title, description, listingType, priceMinor, bedrooms, bathrooms, areaSqm, location, depositAmountMinor } = data;
  const currency = data.currency || (await getTenantCurrency(tenantId));
  const slug = await uniqueSlug("listings", tenantId, data.slug && isValidSlug(data.slug) ? data.slug : title);
  const { rows } = await pool.query(
    `INSERT INTO listings (tenant_id, slug, title, description, listing_type, price_minor, currency, bedrooms, bathrooms, area_sqm, location, deposit_amount_minor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [tenantId, slug, title, description || null, listingType, priceMinor, currency || "UGX", bedrooms ?? null, bathrooms ?? null, areaSqm ?? null, location || null, depositAmountMinor ?? null]
  );
  return rows[0];
}

async function updateListing(tenantId, listingId, data) {
  const fields = [];
  const values = [tenantId, listingId];
  const columnMap = {
    title: "title", description: "description", listingType: "listing_type", status: "status",
    priceMinor: "price_minor", currency: "currency", bedrooms: "bedrooms", bathrooms: "bathrooms",
    areaSqm: "area_sqm", location: "location", depositAmountMinor: "deposit_amount_minor",
  };
  // Merchant-supplied slug only (renames keep the old slug). Format already
  // enforced by validateListing at the route layer.
  if (data.slug !== undefined) {
    values.push(await uniqueSlug("listings", tenantId, data.slug));
    fields.push(`slug = $${values.length}`);
  }
  for (const [key, column] of Object.entries(columnMap)) {
    if (data[key] !== undefined) {
      values.push(data[key]);
      fields.push(`${column} = $${values.length}`);
    }
  }
  if (fields.length === 0) return getListing(tenantId, listingId);
  const { rows } = await pool.query(
    `UPDATE listings SET ${fields.join(", ")}, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function removeListing(tenantId, listingId) {
  const { rows } = await pool.query(
    `UPDATE listings SET status = 'off_market', updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, listingId]
  );
  return rows[0] || null;
}

module.exports = { listListings, getListing, getListingBySlug, createListing, updateListing, removeListing };
