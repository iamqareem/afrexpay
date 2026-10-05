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

// Atomic full-list reorder: one statement assigns every position, so a
// crash mid-loop can no longer leave half-applied ordering. Returns the
// matched ids — callers compare the count to reject foreign ids instead
// of silently "succeeding" on zero rows.
async function setSortOrders(tenantId, orderedIds) {
  const { rows } = await pool.query(
    `UPDATE media AS m SET sort_order = u.idx
     FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, idx)
     WHERE m.tenant_id = $1 AND m.id = u.id
     RETURNING m.id`,
    [tenantId, orderedIds]
  );
  return rows.map((r) => r.id);
}

async function listMediaForEntity(tenantId, entityType, entityId) {
  const { rows } = await pool.query(
    `SELECT id, storage_path, sort_order FROM media WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY sort_order, created_at`,
    [tenantId, entityType, entityId]
  );
  return rows;
}

module.exports = { recordMedia, deleteMedia, setSortOrder, setSortOrders, listMediaForEntity };
