// src/modules/media/media.service.js
const pool = require("../../db/pool");

async function recordMedia({ tenantId, entityType, entityId, storagePath, mimeType, sizeBytes }) {
  const { rows } = await pool.query(
    `INSERT INTO media (tenant_id, entity_type, entity_id, storage_path, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, entityType, entityId, storagePath, mimeType, sizeBytes]
  );
  return rows[0];
}

// Returns the deleted row's storage_path so the caller can remove the file
// from disk too — this function only touches the DB, not the filesystem,
// to keep the two concerns separable (the route handles unlinking).
async function deleteMedia(tenantId, mediaId) {
  const { rows } = await pool.query(
    `DELETE FROM media WHERE tenant_id = $1 AND id = $2 RETURNING storage_path, entity_type, entity_id`,
    [tenantId, mediaId]
  );
  return rows[0] || null;
}

async function setSortOrder(tenantId, mediaId, sortOrder) {
  const { rows } = await pool.query(
    `UPDATE media SET sort_order = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, mediaId, sortOrder]
  );
  return rows[0] || null;
}

async function listMediaForEntity(tenantId, entityType, entityId) {
  const { rows } = await pool.query(
    `SELECT id, storage_path, sort_order FROM media WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY sort_order, created_at`,
    [tenantId, entityType, entityId]
  );
  return rows;
}

module.exports = { recordMedia, deleteMedia, setSortOrder, listMediaForEntity };
