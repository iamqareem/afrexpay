// ecosystem.config.js
//
// instances: 1 / exec_mode: "fork" is deliberate, not a default left
// unconsidered. src/middleware/tenant-resolver.js caches resolved tenants
// in a plain in-process Map — correct and fully tested for one process.
// pm2's cluster mode would run multiple independent Node processes behind
// the same port, each with its OWN cache; a merchant's config/theme edit
// would only invalidate the cache in whichever worker handled that PATCH
// request, leaving other workers serving stale data for up to
// TENANT_CACHE_TTL_MS. This app is Postgres-bound, not CPU-bound, so fork
// mode's single core is not a real bottleneck — cluster mode would be
// solving a scaling problem this app doesn't have yet, at the cost of a
// real correctness gap it would then have.
//
// If cluster mode is ever genuinely needed (real multi-core CPU pressure,
// not just "more instances feels safer"), the tenant cache needs to move
// to a shared store (Redis) first — see README "Tenant resolution" section.

module.exports = {
  apps: [
    {
      name: "afrexpay",
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
