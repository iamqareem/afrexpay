// src/modules/store-config/config.service.js
const pool = require("../../db/pool");

async function getConfig(tenantId) {
  const { rows } = await pool.query(
    `SELECT config, theme_slug FROM store_configs WHERE tenant_id = $1`,
    [tenantId]
  );
  return rows[0] || { config: {}, theme_slug: "hangtag" };
}

async function updateConfig(tenantId, configPatch) {
  const { rows } = await pool.query(
    `UPDATE store_configs
     SET config = config || $2::jsonb, updated_at = now()
     WHERE tenant_id = $1
     RETURNING config, theme_slug`,
    [tenantId, JSON.stringify(configPatch)]
  );
  return rows[0];
}

async function setThemeSlug(tenantId, themeSlug) {
  const { rows } = await pool.query(
    `UPDATE store_configs SET theme_slug = $2, updated_at = now() WHERE tenant_id = $1 RETURNING config, theme_slug`,
    [tenantId, themeSlug]
  );
  return rows[0];
}

module.exports = { getConfig, updateConfig, setThemeSlug };
