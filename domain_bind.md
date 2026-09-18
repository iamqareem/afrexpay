This is a real feature to build, not a quick patch — but it's very doable given how the codebase is already structured. Let me walk through the design decision first, since it changes what "verification" even means here, then give you the pieces in order.

## The one thing that makes this different from the afrexpay.app wildcard work

Your Cloudflare API token is scoped to the `afrexpay.app` zone only — it has zero authority over `256estates.com` or any other domain a merchant owns. So DNS-01 is off the table for custom domains entirely. The standard approach (how Vercel/Netlify/Shopify all do "bring your own domain") is:

1. Merchant points their domain's DNS at your platform (A record to your VPS IP, or CNAME for a subdomain like `www.256estates.com`).
2. Your backend does a live DNS check to confirm that actually happened — that check *is* the ownership proof, since only someone who controls the domain's DNS could point it at you.
3. Caddy issues a cert **per-domain, on first real visit**, via HTTP-01 (not DNS-01) — using its `on_demand_tls` feature, gated by an `ask` endpoint your backend exposes so Caddy doesn't attempt (and rate-limit-burn) certs for domains nobody's actually verified.

That's the shape of the whole feature. Here's the build, in the order to apply it.

---

## 1. Migration — add the columns

```bash
nano ~/afrexpay/app/migrations/1751500000003_custom-domains.js
```

```js
// migrations/1751500000003_custom-domains.js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tenants ADD COLUMN custom_domain TEXT UNIQUE;
    ALTER TABLE tenants ADD COLUMN custom_domain_verified_at TIMESTAMPTZ;
    CREATE INDEX idx_tenants_custom_domain ON tenants (custom_domain);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_tenants_custom_domain;
    ALTER TABLE tenants DROP COLUMN IF EXISTS custom_domain_verified_at;
    ALTER TABLE tenants DROP COLUMN IF EXISTS custom_domain;
  `);
};
```

`custom_domain_verified_at IS NULL` means "claimed but not proven" — that's the flag everything else gates on.

```bash
cd ~/afrexpay/app
npm run migrate:up
```

## 2. Domain service — the actual logic

```bash
mkdir -p ~/afrexpay/app/src/modules/domains
nano ~/afrexpay/app/src/modules/domains/domain.service.js
```

```js
// src/modules/domains/domain.service.js
const dns = require("node:dns").promises;
const pool = require("../../db/pool");

const BASE_DOMAIN = process.env.BASE_DOMAIN || "afrexpay.com";

const RESERVED = new Set([BASE_DOMAIN, `www.${BASE_DOMAIN}`]);

function isValidDomain(domain) {
  if (!domain || typeof domain !== "string") return false;
  const d = domain.trim().toLowerCase();
  if (RESERVED.has(d) || d.endsWith(`.${BASE_DOMAIN}`)) return false; // can't shadow the platform's own namespace
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
}

async function setCustomDomain(tenantId, rawDomain) {
  const domain = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!isValidDomain(domain)) {
    const err = new Error("That doesn't look like a valid domain.");
    err.status = 400;
    throw err;
  }
  // Changing the domain always resets verification — a stale verified_at on
  // a *different* string would be meaningless, and re-verifying is cheap.
  const { rows } = await pool.query(
    `UPDATE tenants SET custom_domain = $2, custom_domain_verified_at = NULL
     WHERE id = $1 RETURNING custom_domain, custom_domain_verified_at`,
    [tenantId, domain]
  );
  return rows[0];
}

async function getDomainStatus(tenantId) {
  const { rows } = await pool.query(
    `SELECT custom_domain, custom_domain_verified_at FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return rows[0];
}

// The actual proof-of-ownership check: does the domain's DNS resolve to the
// same IP(s) as BASE_DOMAIN right now? Deliberately compares against
// BASE_DOMAIN's live A records instead of a hardcoded server IP, so this
// keeps working correctly even if the VPS's IP ever changes.
async function verifyCustomDomain(tenantId) {
  const { rows } = await pool.query(`SELECT custom_domain FROM tenants WHERE id = $1`, [tenantId]);
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
  const verified = domainIps.length > 0 && domainIps.some((ip) => baseIps.includes(ip));

  if (verified) {
    await pool.query(`UPDATE tenants SET custom_domain_verified_at = now() WHERE id = $1`, [tenantId]);
  }
  return { verified, domain };
}

// Used by the /api/domains/ask endpoint that Caddy calls before issuing a
// cert for a hostname it doesn't otherwise recognize — must stay a fast,
// narrow, public-safe lookup: exact string match against a *verified*
// domain only, nothing else.
async function isDomainVerified(hostname) {
  const { rows } = await pool.query(
    `SELECT 1 FROM tenants WHERE custom_domain = $1 AND custom_domain_verified_at IS NOT NULL`,
    [hostname]
  );
  return rows.length > 0;
}

module.exports = { setCustomDomain, getDomainStatus, verifyCustomDomain, isDomainVerified };
```

## 3. Two route files — tenant-scoped management, plus the public Caddy hook

These need to live in **separate routers**, mounted in different places — the management routes need `req.tenant` (post-`tenantResolver`, like everything else in the dashboard); the `ask` endpoint is called by Caddy with no tenant context at all and must be reachable *before* `tenantResolver` would otherwise 404 it.

```bash
nano ~/afrexpay/app/src/modules/domains/domain.routes.js
```
```js
// src/modules/domains/domain.routes.js — tenant-scoped, mounted after tenantResolver.
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { setCustomDomain, getDomainStatus, verifyCustomDomain } = require("./domain.service");

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
  res.json(await getDomainStatus(req.tenant.id));
});

router.patch("/", authRequired, async (req, res) => {
  try {
    const result = await setCustomDomain(req.tenant.id, req.body?.domain || "");
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/verify", authRequired, async (req, res) => {
  try {
    const result = await verifyCustomDomain(req.tenant.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
```

```bash
nano ~/afrexpay/app/src/modules/domains/ask.routes.js
```
```js
// src/modules/domains/ask.routes.js — public, no auth, no tenant context.
// This is Caddy's on_demand_tls "ask" callback: before issuing a cert for
// any hostname it doesn't already have a static Caddyfile block for, Caddy
// GETs this with ?domain=<hostname> and only proceeds on a 200. Keeping
// this outside tenantResolver is deliberate — that middleware 404s any
// Host it doesn't recognize as BASE_DOMAIN/subdomain, which would reject
// Caddy's own request to *this* backend before ever reaching the check.
const express = require("express");
const { isDomainVerified } = require("./domain.service");

const router = express.Router();

router.get("/", async (req, res) => {
  const domain = (req.query.domain || "").toLowerCase();
  if (domain && (await isDomainVerified(domain))) {
    return res.status(200).send("ok");
  }
  res.status(404).send("not a recognized domain");
});

module.exports = router;
```

## 4. Wire both into app.js

```bash
nano ~/afrexpay/app/src/app.js
```

Add near the other route requires, at the top:
```js
const domainRoutes = require("./modules/domains/domain.routes");
const domainAskRoutes = require("./modules/domains/ask.routes");
```

Mount `ask` early, right after the Stripe webhook line (same "outside the normal tenant flow" reasoning as that one already documents):
```js
app.use("/api/payments/stripe/webhook", stripeWebhookRoutes);
app.use("/api/domains/ask", domainAskRoutes);
```

Mount the tenant-scoped one down with the rest, after `tenantResolver`:
```js
app.use("/api/config", configRoutes);
app.use("/api/domains", domainRoutes);
```

## 5. tenant-resolver.js — recognize custom domains, not just subdomains

```bash
nano ~/afrexpay/app/src/middleware/tenant-resolver.js
```

Add a second fetch function and use it as a fallback when `extractSubdomain` comes back null but the host also isn't the bare base domain:

```js
async function fetchTenantByCustomDomain(hostname) {
  const { rows } = await pool.query(
    `SELECT t.id, t.subdomain, t.business_name, t.status,
            sc.config, sc.theme_slug
     FROM tenants t
     LEFT JOIN store_configs sc ON sc.tenant_id = t.id
     WHERE t.custom_domain = $1 AND t.custom_domain_verified_at IS NOT NULL`,
    [hostname]
  );
  return rows[0] || null;
}
```

Then in `tenantResolver`, change this block:
```js
if (!subdomain) {
  return res.status(404).json({ error: "No store found for this address." });
}
```
to:
```js
if (!subdomain) {
  const hostname = (req.headers.host || "").split(":")[0];
  const tenant = await fetchTenantByCustomDomain(hostname);
  if (!tenant) return res.status(404).json({ error: "No store found for this address." });
  if (tenant.status === "suspended" || tenant.status === "cancelled") {
    return res.status(403).json({ error: "This store is not currently available." });
  }
  req.tenant = tenant;
  return next();
}
```
(No caching on this path for now, matching the `?tenant=` override's reasoning already in this file — custom domains are low-volume compared to subdomain traffic, and correctness during rollout matters more than shaving one query.)

Export the new function too:
```js
module.exports = { tenantResolver, extractSubdomain, invalidateTenantCache };
```
stays the same — `fetchTenantByCustomDomain` doesn't need to be exported, it's only used internally.

Restart:
```bash
pm2 restart afrexpay
```

---

That's the whole backend. Given how much ground this covers, I want to pause here rather than also hand you the Caddy catch-all block and admin UI in the same message — the Caddy piece touches your shared production proxy again, and I'd rather you confirm `curl http://127.0.0.1:4004/api/domains/ask?domain=test.com` returns a `404 not a recognized domain` cleanly first (proves the backend half works) before we go anywhere near Caddy. Want to run the migration + these files now and check that curl, then we do the admin UI + Caddy in the next pass?
