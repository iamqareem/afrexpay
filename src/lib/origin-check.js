// src/lib/origin-check.js
//
// Stateless CSRF defense for cookie-authenticated admin mutations.
//
// Why this shape: the session cookie is scoped to `.BASE_DOMAIN`, so any
// tenant subdomain's JS can fire credentialed requests at any other tenant.
// JSON fetch is already neutered by the absence of CORS headers (preflight
// fails), but simple-request vectors (form POSTs) still reach the server.
// Browsers always attach Origin to POST/PATCH/PUT/DELETE (fetch and forms)
// and Referer as fallback — so a request whose stated origin is foreign is
// definitionally cross-site and refused. Requests with neither header come
// from curl/scripts, where there is no victim browser and hence no CSRF.
//
// Deliberately no sessions, tokens, or new dependencies: nothing the
// dashboard, storefronts, or provider webhooks do today has to change.
// Webhooks never pass through authRequired, so they are unaffected.
// Behind Caddy this needs nothing special — Origin/Referer are set by the
// browser end-to-end and forwarded untouched by the proxy.
const { tenantHosts } = require("./checkout-redirects");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The request's own origin: explicit Origin header first, else the origin
// of the Referer. Null when the client sent neither (non-browser caller).
function requestOrigin(req) {
  if (req.headers?.origin) return req.headers.origin;
  const referer = req.headers?.referer;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

// True when `origin` (a full origin string) belongs to this tenant.
function isAllowedOrigin(origin, tenant) {
  let hostname;
  try {
    hostname = new URL(String(origin)).hostname.toLowerCase();
  } catch {
    return false;
  }
  // Local dev (npm run dev, ?tenant= override): plain-http localhost has
  // no registrable-domain relationship to check, and there is no
  // attacker tenant on a developer's own loopback — allow it.
  if (process.env.NODE_ENV !== "production" && LOCAL_HOSTS.has(hostname)) return true;
  return tenantHosts(tenant).has(hostname);
}

module.exports = { requestOrigin, isAllowedOrigin };
