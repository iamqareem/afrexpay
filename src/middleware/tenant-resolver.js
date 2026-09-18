// src/middleware/tenant-resolver.js
// Resolves which merchant this request is for, from the subdomain — this is
// the piece that replaces the old CLIENT_SLUG env var. One running process,
// unlimited tenants: a new merchant goes live the instant their row exists,
// no restart needed.
//
// This runs before every route in the app, so it's the one place request
// volume translates directly into DB load. Cached in-process with a short
// TTL — cheap, no external dependency (Redis etc.), and correct for a
// single-instance deployment. If this app is ever run as multiple
// instances behind a load balancer, this cache becomes "per instance,"
// same caveat as the rate limiter already documents — a shared cache
// (Redis) would be the upgrade at that point, not before.
const pool = require("../db/pool");

const BASE_DOMAIN = process.env.BASE_DOMAIN || "afrexpay.com";

// No dev-domain special cases live here. Local subdomain testing goes
// through the ?tenant= query override below, or through real DNS (a local
// bind9/Unbound resolver, or hosts-file entries) resolving to whatever
// BASE_DOMAIN is set to in .env for that environment — the resolution
// engine itself only ever knows about BASE_DOMAIN, nothing else.
function extractSubdomain(host) {
  if (!host) return null;
  const hostname = host.split(":")[0]; // strip port, e.g. 'glow-salon.afrexpay.com:3000'
  if (hostname === BASE_DOMAIN || hostname === `www.${BASE_DOMAIN}`) return null;
  if (!hostname.endsWith(`.${BASE_DOMAIN}`)) return null;
  return hostname.slice(0, -(BASE_DOMAIN.length + 1)); // strip '.BASE_DOMAIN' suffix, keep everything before it
}

// ---- cache ----
// Map<subdomain, { tenant: row|null, expiresAt: number }>
// A null `tenant` value is a cached "not found" — short TTL, since an
// unknown subdomain is cheap to re-check and caching it too long would
// mean a newly-signed-up tenant stays invisible for the TTL window if
// someone requested that exact subdomain moments before it was created.
const cache = new Map();

const POSITIVE_TTL_MS = Number(process.env.TENANT_CACHE_TTL_MS) || 30_000;
const NEGATIVE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 5_000; // bound memory against subdomain-probing traffic

function getCached(slug) {
  const entry = cache.get(slug);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(slug);
    return undefined;
  }
  return entry.tenant; // may be null (cached negative)
}

function setCached(slug, tenant) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Insertion-order eviction (Maps preserve insertion order) — not a
    // true LRU, but cheap and sufficient: this only matters under
    // adversarial probing of many nonexistent subdomains, and eviction
    // just means a slightly earlier cache miss for the oldest entries,
    // never incorrect data.
    cache.delete(cache.keys().next().value);
  }
  const ttl = tenant ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  cache.set(slug, { tenant, expiresAt: Date.now() + ttl });
}

// Exported so routes that change cached fields (config, theme_slug, status)
// can drop the stale entry immediately instead of waiting out the TTL —
// see config.routes.js.
function invalidateTenantCache(slug) {
  cache.delete(slug);
}

async function fetchTenant(slug) {
  const { rows } = await pool.query(
    `SELECT t.id, t.subdomain, t.business_name, t.status,
            sc.config, sc.theme_slug
     FROM tenants t
     LEFT JOIN store_configs sc ON sc.tenant_id = t.id
     WHERE t.subdomain = $1`,
    [slug]
  );
  return rows[0] || null;
}

// Fallback lookup for requests arriving on a verified custom domain rather
// than on the platform's own subdomain. Not cached (unlike the subdomain
// path) — custom domains are low-volume compared to subdomain traffic, and
// a single DB query per request is fine. Correctness during rollout matters
// more than shaving one query here.
async function fetchTenantByCustomDomain(hostname) {
  const { rows } = await pool.query(
    `SELECT t.id, t.subdomain, t.business_name, t.status,
            sc.config, sc.theme_slug
     FROM tenants t
     LEFT JOIN store_configs sc ON sc.tenant_id = t.id
     WHERE t.custom_domain = $1
       AND t.custom_domain_verified_at IS NOT NULL`,
    [hostname]
  );
  return rows[0] || null;
}

async function tenantResolver(req, res, next) {
  const subdomain = extractSubdomain(req.headers.host);

  // Dev/testing convenience: ?tenant=256-merch overrides subdomain
  // detection entirely. This bypasses the cache on purpose — a developer
  // testing multiple tenants against the same running process via this
  // override should never see a stale cached value from a moment ago.
  if (req.query.tenant) {
    const slug = req.query.tenant;
    try {
      const tenant = await fetchTenant(slug);
      if (!tenant) return res.status(404).json({ error: `No store found for "${slug}".` });
      if (tenant.status === "suspended" || tenant.status === "cancelled") {
        return res.status(403).json({ error: "This store is not currently available." });
      }
      req.tenant = tenant;
      return next();
    } catch (err) {
      console.error("Tenant resolution failed:", err);
      return res.status(500).json({ error: "Could not resolve store." });
    }
  }

  if (!subdomain) {
    // Not a platform subdomain — try matching against a verified custom domain
    // before returning a 404. This is the path that makes custom domains work
    // for all tenant-scoped routes without any per-route changes.
    const hostname = (req.headers.host || "").split(":")[0];
    try {
      const tenant = await fetchTenantByCustomDomain(hostname);
      if (!tenant) return res.status(404).json({ error: "No store found for this address." });
      if (tenant.status === "suspended" || tenant.status === "cancelled") {
        return res.status(403).json({ error: "This store is not currently available." });
      }
      req.tenant = tenant;
      return next();
    } catch (err) {
      console.error("Custom domain resolution failed:", err);
      return res.status(500).json({ error: "Could not resolve store." });
    }
  }

  try {
    let tenant = getCached(subdomain);
    if (tenant === undefined) {
      tenant = await fetchTenant(subdomain);
      setCached(subdomain, tenant);
    }

    if (!tenant) {
      return res.status(404).json({ error: `No store found for "${subdomain}".` });
    }
    if (tenant.status === "suspended" || tenant.status === "cancelled") {
      return res.status(403).json({ error: "This store is not currently available." });
    }

    req.tenant = tenant; // every downstream controller reads req.tenant.id
    next();
  } catch (err) {
    console.error("Tenant resolution failed:", err);
    res.status(500).json({ error: "Could not resolve store." });
  }
}

module.exports = { tenantResolver, extractSubdomain, invalidateTenantCache };
