// src/modules/domains/domain.service.js
const dns = require("node:dns").promises;
const pool = require("../../db/pool");

const BASE_DOMAIN = process.env.BASE_DOMAIN || "afrexpay.com";

// Platform's own namespace — merchants cannot shadow these.
const RESERVED = new Set([BASE_DOMAIN, `www.${BASE_DOMAIN}`]);

function isValidDomain(domain) {
  if (!domain || typeof domain !== "string") return false;
  const d = domain.trim().toLowerCase();
  if (RESERVED.has(d) || d.endsWith(`.${BASE_DOMAIN}`)) return false;
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
}

// Claims a custom domain for a tenant. Always resets verified_at to NULL:
// a stale verification timestamp attached to a *different* hostname string
// would be meaningless, and re-verifying is cheap compared to the confusion
// of thinking an old domain's proof covers a new one.
async function setCustomDomain(tenantId, rawDomain) {
  const domain = rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!isValidDomain(domain)) {
    const err = new Error("That doesn't look like a valid domain.");
    err.status = 400;
    throw err;
  }
  try {
    const { rows } = await pool.query(
      `UPDATE tenants
         SET custom_domain = $2, custom_domain_verified_at = NULL
       WHERE id = $1
       RETURNING custom_domain, custom_domain_verified_at`,
      [tenantId, domain]
    );
    return rows[0];
  } catch (err) {
    if (err.code === "23505") {
      const e = new Error("That domain is already claimed by another store.");
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

async function getDomainStatus(tenantId) {
  const { rows } = await pool.query(
    `SELECT custom_domain, custom_domain_verified_at FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return rows[0];
}

// Proof-of-ownership check: the custom domain's A records must overlap with
// BASE_DOMAIN's live A records. Comparing against BASE_DOMAIN's live IPs
// (rather than a hardcoded server IP) means this stays correct even if the
// VPS IP ever changes — no config update needed.
async function verifyCustomDomain(tenantId) {
  const { rows } = await pool.query(
    `SELECT custom_domain FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const domain = rows[0]?.custom_domain;
  if (!domain) {
    const err = new Error("No custom domain set for this store yet.");
    err.status = 400;
    throw err;
  }

  const [domainIps, baseIps] = await Promise.all([
    dns.resolve4(domain).catch(() => []),
    dns.resolve4(BASE_DOMAIN).catch(() => []),
  ]);
  const verified =
    domainIps.length > 0 && domainIps.some((ip) => baseIps.includes(ip));

  if (verified) {
    await pool.query(
      `UPDATE tenants SET custom_domain_verified_at = now() WHERE id = $1`,
      [tenantId]
    );
  }
  return { verified, domain };
}

// Used by the /api/domains/ask endpoint that Caddy calls before issuing a
// cert for a hostname it doesn't already have a static block for. Must stay
// fast, narrow, and public-safe: exact string match against a *verified*
// domain only — nothing else.
async function isDomainVerified(hostname) {
  const { rows } = await pool.query(
    `SELECT 1 FROM tenants
      WHERE custom_domain = $1
        AND custom_domain_verified_at IS NOT NULL`,
    [hostname]
  );
  return rows.length > 0;
}

module.exports = { setCustomDomain, getDomainStatus, verifyCustomDomain, isDomainVerified, isValidDomain };
