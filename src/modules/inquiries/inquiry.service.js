// src/modules/inquiries/inquiry.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");

async function createInquiry(tenantId, { listingId, name, phone, message }) {
  const listingResult = await pool.query(
    `SELECT id, title FROM listings WHERE tenant_id = $1 AND id = $2`,
    [tenantId, listingId]
  );
  const listing = listingResult.rows[0];
  if (!listing) {
    throw Object.assign(new Error("Listing not found."), { status: 400 });
  }

  const { rows } = await pool.query(
    `INSERT INTO inquiries (tenant_id, listing_id, name, phone, message) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, listingId, name, phone, message || null]
  );
  return { ...rows[0], listingTitle: listing.title };
}

async function listInquiries(tenantId, params = {}) {
  const { search, limit, offset, dir } = parseListParams(params);
  const conditions = [`i.tenant_id = $1`];
  const values = [tenantId];
  if (search) conditions.push(searchCondition(values, ["i.name", "i.phone", "i.message", "l.title"], search));
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT i.*, l.title AS listing_title
     FROM inquiries i JOIN listings l ON l.id = i.listing_id
     WHERE ${conditions.join(" AND ")} ORDER BY i.created_at ${dir}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

module.exports = { createInquiry, listInquiries };
