// src/modules/services/resource.service.js
//
// Staff / chairs / rooms. Each resource belongs to exactly ONE service —
// no sharing, no link matrix. A booking takes an optional resourceId
// (validated below) or auto-assigns the first free one.
const pool = require("../../db/pool");

async function listResources(tenantId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.service_id, s.name AS service_name, r.created_at
     FROM resources r JOIN services s ON s.id = r.service_id
     WHERE r.tenant_id = $1 ORDER BY s.created_at, r.created_at`,
    [tenantId]
  );
  return rows;
}

// Resource ids for one service, oldest first (per-service defaults win ties).
async function serviceResourceIds(tenantId, serviceId) {
  const { rows } = await pool.query(
    `SELECT r.id FROM resources r
     JOIN services s ON s.id = r.service_id
     WHERE r.tenant_id = $1 AND r.service_id = $2 AND s.active = true
     ORDER BY r.created_at`,
    [tenantId, serviceId]
  );
  return rows.map((r) => r.id);
}

// Pure: first id not in the busy set, or null. Unit-tested.
function pickFreeResource(resourceIds, busyIds) {
  const busy = new Set((busyIds || []).map(String));
  for (const id of resourceIds || []) {
    if (!busy.has(String(id))) return id;
  }
  return null;
}

async function createResource(tenantId, { name, serviceId }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw Object.assign(new Error("Resource name is required."), { status: 400 });
  }
  const svc = await pool.query(
    `SELECT id FROM services WHERE tenant_id = $1 AND id = $2 AND active = true`,
    [tenantId, serviceId]
  );
  if (!svc.rows[0]) {
    throw Object.assign(new Error("Service not found for this store."), { status: 400 });
  }
  const { rows } = await pool.query(
    `INSERT INTO resources (tenant_id, service_id, name) VALUES ($1, $2, $3)
     RETURNING id, name, service_id, created_at`,
    [tenantId, serviceId, cleanName]
  );
  return rows[0];
}

async function deleteResource(tenantId, resourceId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT service_id FROM resources WHERE tenant_id = $1 AND id = $2`,
      [tenantId, resourceId]
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    // Only live bookings block the delete — completed history must not
    // hold a resource hostage forever. The message promises "upcoming",
    // so the query checks exactly that (pending/confirmed), not all time.
    const refs = await client.query(
      `SELECT COUNT(*)::int AS n FROM bookings
       WHERE tenant_id = $1 AND resource_id = $2 AND status IN ('pending', 'confirmed')`,
      [tenantId, resourceId]
    );
    if (refs.rows[0].n > 0) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Resource has upcoming bookings — cancel them first."), { status: 400 });
    }
    const siblings = await client.query(
      `SELECT COUNT(*)::int AS n FROM resources
       WHERE tenant_id = $1 AND service_id = $2 AND id != $3`,
      [tenantId, existing.rows[0].service_id, resourceId]
    );
    if (siblings.rows[0].n === 0) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("A service needs at least one resource — rename it instead."), { status: 400 });
    }
    await client.query(`DELETE FROM resources WHERE tenant_id = $1 AND id = $2`, [tenantId, resourceId]);
    await client.query("COMMIT");
    return { id: resourceId };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listResources,
  serviceResourceIds,
  pickFreeResource,
  createResource,
  deleteResource,
};
