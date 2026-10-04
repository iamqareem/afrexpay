// src/modules/store-config/config.service.js
const pool = require("../../db/pool");

async function getConfig(tenantId) {
  const { rows } = await pool.query(
    `SELECT config, theme_slug FROM store_configs WHERE tenant_id = $1`,
    [tenantId]
  );
  return rows[0] || { config: {}, theme_slug: "hangtag" };
}

// Recursive merge for config patches: plain objects merge key-by-key,
// everything else (arrays included) is replaced wholesale. Without this,
// the old top-level `config || patch` merge deleted sibling nested keys
// whenever a partial nested object was saved.
function deepMergeConfig(base, patch) {
  if (Array.isArray(patch) || typeof patch !== "object" || patch === null) {
    return patch;
  }
  const out = (base && typeof base === "object" && !Array.isArray(base)) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? deepMergeConfig(out[key], value)
        : value;
  }
  return out;
}

async function updateConfig(tenantId, configPatch) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query(
      `SELECT config FROM store_configs WHERE tenant_id = $1 FOR UPDATE`,
      [tenantId]
    );
    const merged = deepMergeConfig(existing[0]?.config || {}, configPatch || {});
    // Upsert, not bare UPDATE: a tenant with no store_configs row (legacy
    // or raced signup) used to get a silent `null` 200 with nothing
    // written. Now the row is created with the merged config instead.
    const { rows } = await client.query(
      `INSERT INTO store_configs (tenant_id, config, theme_slug)
       VALUES ($1, $2::jsonb, 'hangtag')
       ON CONFLICT (tenant_id) DO UPDATE
         SET config = $2::jsonb, updated_at = now()
       RETURNING config, theme_slug`,
      [tenantId, JSON.stringify(merged)]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function setThemeSlug(tenantId, themeSlug) {
  // Same upsert rationale as updateConfig: never silently drop a write.
  const { rows } = await pool.query(
    `INSERT INTO store_configs (tenant_id, config, theme_slug)
     VALUES ($1, '{"vertical": "products"}'::jsonb, $2)
     ON CONFLICT (tenant_id) DO UPDATE
       SET theme_slug = $2, updated_at = now()
     RETURNING config, theme_slug`,
    [tenantId, themeSlug]
  );
  return rows[0];
}

module.exports = { getConfig, updateConfig, setThemeSlug, deepMergeConfig };
