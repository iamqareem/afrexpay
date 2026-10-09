// src/modules/services/service.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");
const { uniqueSlug, isValidSlug } = require("../../lib/slug");
const { createResource } = require("./resource.service");
const { getTenantCurrency } = require("../store-config/config.service");

async function listServices(tenantId, params = {}) {
  const { search, limit, offset, dir } = parseListParams(params, { defaultDir: "ASC" });
  const conditions = [`tenant_id = $1`, `active = true`];
  const values = [tenantId];
  if (search) conditions.push(searchCondition(values, ["name", "description"], search));
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id, slug, name, description, duration_minutes, price_minor, currency
     FROM services WHERE ${conditions.join(" AND ")} ORDER BY created_at ${dir}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

async function getService(tenantId, serviceId) {
  const { rows } = await pool.query(`SELECT * FROM services WHERE tenant_id = $1 AND id = $2`, [tenantId, serviceId]);
  return rows[0] || null;
}

async function getServiceBySlug(tenantId, slug) {
  const { rows } = await pool.query(
    `SELECT * FROM services WHERE tenant_id = $1 AND slug = $2 AND active = true`,
    [tenantId, slug]
  );
  return rows[0] || null;
}

async function createService(tenantId, data) {
  const { name, description, durationMinutes, priceMinor } = data;
  const currency = data.currency || (await getTenantCurrency(tenantId));
  const slug = await uniqueSlug("services", tenantId, data.slug && isValidSlug(data.slug) ? data.slug : name);
  const { rows } = await pool.query(
    `INSERT INTO services (tenant_id, slug, name, description, duration_minutes, price_minor, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tenantId, slug, name, description || null, durationMinutes, priceMinor, currency || "UGX"]
  );
  // Every service gets a default resource so bookings keep working with
  // zero merchant action — same invariant as the migration backfill.
  await createResource(tenantId, { name: `Default — ${name}`, serviceId: rows[0].id });
  return rows[0];
}

async function updateService(tenantId, serviceId, data) {
  const fields = [];
  const values = [tenantId, serviceId];
  const columnMap = { name: "name", description: "description", durationMinutes: "duration_minutes", priceMinor: "price_minor", currency: "currency" };
  // Merchant-supplied slug only (renames keep the old slug). Format already
  // enforced by validateService at the route layer.
  if (data.slug !== undefined) {
    values.push(await uniqueSlug("services", tenantId, data.slug));
    fields.push(`slug = $${values.length}`);
  }
  for (const [key, column] of Object.entries(columnMap)) {
    if (data[key] !== undefined) {
      values.push(data[key]);
      fields.push(`${column} = $${values.length}`);
    }
  }
  if (fields.length === 0) return getService(tenantId, serviceId);
  const { rows } = await pool.query(
    `UPDATE services SET ${fields.join(", ")}, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function deactivateService(tenantId, serviceId) {
  const { rows } = await pool.query(
    `UPDATE services SET active = false, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, serviceId]
  );
  return rows[0] || null;
}

module.exports = { listServices, getService, getServiceBySlug, createService, updateService, deactivateService };
