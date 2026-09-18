// src/modules/services/service.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");

async function listServices(tenantId, params = {}) {
  const { search, limit, offset, dir } = parseListParams(params, { defaultDir: "ASC" });
  const conditions = [`tenant_id = $1`, `active = true`];
  const values = [tenantId];
  if (search) conditions.push(searchCondition(values, ["name", "description"], search));
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id, name, description, duration_minutes, price_minor, currency
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

async function createService(tenantId, data) {
  const { name, description, durationMinutes, priceMinor, currency } = data;
  const { rows } = await pool.query(
    `INSERT INTO services (tenant_id, name, description, duration_minutes, price_minor, currency)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, name, description || null, durationMinutes, priceMinor, currency || "UGX"]
  );
  return rows[0];
}

async function updateService(tenantId, serviceId, data) {
  const fields = [];
  const values = [tenantId, serviceId];
  const columnMap = { name: "name", description: "description", durationMinutes: "duration_minutes", priceMinor: "price_minor", currency: "currency" };
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

module.exports = { listServices, getService, createService, updateService, deactivateService };
