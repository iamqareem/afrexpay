// src/modules/services/resource.service.js
//
// Staff / chairs / rooms that can each take parallel bookings for the same
// service. A service with no explicit links means "any active resource"
// (default-open), so merchants who never touch this see identical behavior.
const pool = require("../../db/pool");

async function listResources(tenantId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.active, r.created_at,
            COALESCE(json_agg(rs.service_id) FILTER (WHERE rs.service_id IS NOT NULL), '[]') AS service_ids
     FROM resources r LEFT JOIN resource_services rs ON rs.resource_id = r.id
     WHERE r.tenant_id = $1 GROUP BY r.id ORDER BY r.created_at`,
    [tenantId]
  );
  return rows;
}

// Eligible resource ids for a service, oldest first (so per-service
// defaults created by the migration / createService win ties).
async function linkedResourceIds(tenantId, serviceId) {
  const { rows } = await pool.query(
    `SELECT r.id FROM resources r WHERE r.tenant_id = $1 AND r.active = true
     AND (NOT EXISTS (SELECT 1 FROM resource_services rs WHERE rs.service_id = $2)
          OR r.id IN (SELECT rs.resource_id FROM resource_services rs WHERE rs.service_id = $2))
     ORDER BY r.created_at`,
    [tenantId, serviceId]
  );
  return rows.map((r) => r.id);
}

// Pure: first linked id not in the busy set, or null. Unit-tested.
function pickFreeResource(linkedIds, busyIds) {
  const busy = new Set((busyIds || []).map(String));
  for (const id of linkedIds || []) {
    if (!busy.has(String(id))) return id;
  }
  return null;
}

async function servicesBelongToTenant(tenantId, serviceIds) {
  if (!serviceIds || serviceIds.length === 0) return true;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM services WHERE tenant_id = $1 AND id = ANY($2)`,
    [tenantId, serviceIds]
  );
  return rows[0].n === serviceIds.length;
}

async function createResource(tenantId, { name, serviceIds = [] }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw Object.assign(new Error("Resource name is required."), { status: 400 });
  }
  if (!(await servicesBelongToTenant(tenantId, serviceIds))) {
    throw Object.assign(new Error("One or more services do not belong to this store."), { status: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO resources (tenant_id, name) VALUES ($1, $2) RETURNING id, name, active, created_at`,
      [tenantId, cleanName]
    );
    for (const sid of serviceIds) {
      await client.query(
        `INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [rows[0].id, sid]
      );
    }
    await client.query("COMMIT");
    return { ...rows[0], service_ids: serviceIds };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function updateResource(tenantId, resourceId, { name, active, serviceIds }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id, active FROM resources WHERE tenant_id = $1 AND id = $2`,
      [tenantId, resourceId]
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    // Invariant: a tenant with services always keeps at least one active
    // resource. Without it, new bookings would carry NULL resource_id and
    // the exclusion constraint would silently stop protecting anything.
    if (active === false) {
      const others = await client.query(
        `SELECT COUNT(*)::int AS n FROM resources
         WHERE tenant_id = $1 AND id != $2 AND active = true`,
        [tenantId, resourceId]
      );
      const svcCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM services WHERE tenant_id = $1 AND active = true`,
        [tenantId]
      );
      if (svcCount.rows[0].n > 0 && others.rows[0].n === 0) {
        await client.query("ROLLBACK");
        throw Object.assign(new Error("Keep at least one active resource — rename it instead."), { status: 400 });
      }
    }
    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) {
        await client.query("ROLLBACK");
        throw Object.assign(new Error("Resource name cannot be empty."), { status: 400 });
      }
      await client.query(`UPDATE resources SET name = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, resourceId, cleanName]);
    }
    if (active !== undefined) {
      await client.query(`UPDATE resources SET active = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, resourceId, !!active]);
    }
    if (serviceIds !== undefined) {
      if (!(await servicesBelongToTenant(tenantId, serviceIds))) {
        await client.query("ROLLBACK");
        throw Object.assign(new Error("One or more services do not belong to this store."), { status: 400 });
      }
      await client.query(`DELETE FROM resource_services WHERE resource_id = $1`, [resourceId]);
      for (const sid of serviceIds) {
        await client.query(
          `INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [resourceId, sid]
        );
      }
    }
    await client.query("COMMIT");
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.active, r.created_at,
              COALESCE(json_agg(rs.service_id) FILTER (WHERE rs.service_id IS NOT NULL), '[]') AS service_ids
       FROM resources r LEFT JOIN resource_services rs ON rs.resource_id = r.id
       WHERE r.tenant_id = $1 AND r.id = $2 GROUP BY r.id`,
      [tenantId, resourceId]
    );
    return rows[0] || null;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function deleteResource(tenantId, resourceId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id FROM resources WHERE tenant_id = $1 AND id = $2`,
      [tenantId, resourceId]
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const refs = await client.query(
      `SELECT COUNT(*)::int AS n FROM bookings
       WHERE tenant_id = $1 AND resource_id = $2 AND status != 'cancelled'`,
      [tenantId, resourceId]
    );
    if (refs.rows[0].n > 0) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Resource has upcoming bookings — cancel or reassign them first."), { status: 400 });
    }
    const svcCount = await client.query(
      `SELECT COUNT(*)::int AS n FROM services WHERE tenant_id = $1 AND active = true`,
      [tenantId]
    );
    const others = await client.query(
      `SELECT COUNT(*)::int AS n FROM resources
       WHERE tenant_id = $1 AND id != $2 AND active = true`,
      [tenantId, resourceId]
    );
    if (svcCount.rows[0].n > 0 && others.rows[0].n === 0) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Keep at least one active resource — rename it instead."), { status: 400 });
    }
    await client.query(`DELETE FROM resource_services WHERE resource_id = $1`, [resourceId]);
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
  linkedResourceIds,
  pickFreeResource,
  createResource,
  updateResource,
  deleteResource,
};
