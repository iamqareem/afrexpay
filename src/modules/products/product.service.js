// src/modules/products/product.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");
const { uniqueSlug, isValidSlug } = require("../../lib/slug");
const { getTenantCurrency } = require("../store-config/config.service");

async function listProducts(tenantId, params = {}) {
  const { search, limit, offset, dir } = parseListParams(params, { defaultDir: "ASC" });
  const conditions = [`tenant_id = $1`, `active = true`];
  const values = [tenantId];
  if (search) conditions.push(searchCondition(values, ["sku", "name", "category"], search));
  values.push(limit, offset);
  // Cover thumbnail per product (lowest sort_order wins), same lateral
  // pattern as listings — one query, no N+1 photo fetches for grids.
  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.slug, p.name, p.category, p.price_minor, p.currency, p.sizes, p.stock_qty, p.blurb,
            m.storage_path AS thumbnail_path
     FROM products p
     LEFT JOIN LATERAL (
       SELECT storage_path FROM media
       WHERE tenant_id = p.tenant_id AND entity_type = 'product' AND entity_id = p.id
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 1
     ) m ON true
     WHERE ${conditions.join(" AND ").replace("tenant_id", "p.tenant_id")} ORDER BY p.created_at ${dir}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

async function getProduct(tenantId, productId) {
  const { rows } = await pool.query(
    `SELECT * FROM products WHERE tenant_id = $1 AND id = $2`,
    [tenantId, productId]
  );
  return rows[0] || null;
}

async function getProductBySlug(tenantId, slug) {
  const { rows } = await pool.query(
    `SELECT * FROM products WHERE tenant_id = $1 AND slug = $2 AND active = true`,
    [tenantId, slug]
  );
  return rows[0] || null;
}

async function createProduct(tenantId, data) {
  const { sku, name, category, priceMinor, sizes, stockQty, blurb } = data;
  // Slug is minted once from the name (or a merchant-provided valid slug)
  // and never auto-changed afterwards — indexed detail URLs must stay put.
  const slug = await uniqueSlug("products", tenantId, data.slug && isValidSlug(data.slug) ? data.slug : name);
  // Explicit client currency wins (route-whitelisted); otherwise the row
  // inherits the store's configured currency instead of hardcoded UGX.
  const currency = data.currency || (await getTenantCurrency(tenantId));
  const { rows } = await pool.query(
    `INSERT INTO products (tenant_id, sku, slug, name, category, price_minor, currency, sizes, stock_qty, blurb)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [tenantId, sku, slug, name, category || null, priceMinor, currency || "UGX", sizes || [], stockQty ?? null, blurb || null]
  );
  return rows[0];
}

async function updateProduct(tenantId, productId, data) {
  const fields = [];
  const values = [tenantId, productId];
  // `active` is writable so a deactivated product can be reactivated
  // via PATCH (DELETE only deactivates — previously a one-way door).
  const columnMap = {
    name: "name", category: "category", priceMinor: "price_minor", currency: "currency",
    sizes: "sizes", stockQty: "stock_qty", blurb: "blurb", active: "active",
  };
  // A merchant-supplied slug is the only way the slug changes (renames keep
  // the old slug so detail URLs stay stable). Re-minted for uniqueness.
  // Format is already enforced by validateProduct at the route layer.
  if (data.slug !== undefined) {
    values.push(await uniqueSlug("products", tenantId, data.slug));
    fields.push(`slug = $${values.length}`);
  }
  for (const [key, column] of Object.entries(columnMap)) {
    if (data[key] !== undefined) {
      values.push(data[key]);
      fields.push(`${column} = $${values.length}`);
    }
  }
  if (fields.length === 0) return getProduct(tenantId, productId);

  const { rows } = await pool.query(
    `UPDATE products SET ${fields.join(", ")}, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function deactivateProduct(tenantId, productId) {
  const { rows } = await pool.query(
    `UPDATE products SET active = false, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, productId]
  );
  return rows[0] || null;
}

module.exports = { listProducts, getProduct, getProductBySlug, createProduct, updateProduct, deactivateProduct };
