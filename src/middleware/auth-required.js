// src/middleware/auth-required.js
// Guards merchant-facing admin routes (editing config/products). Must run
// AFTER tenant-resolver, so req.tenant is already set — this only checks that
// the logged-in session actually belongs to *this* tenant, not some other one.
//
// CSRF: the session cookie is scoped to `.BASE_DOMAIN`, so a hostile tenant
// subdomain can fire credentialed requests at this one. Browsers attach
// Origin (or Referer) to every state-changing request, so a foreign stated
// origin is refused outright — no tokens, no sessions, no frontend changes.
// Safe methods skip the check (reads change nothing); callers with neither
// header are non-browser clients, where CSRF does not apply. Webhooks never
// pass through here (they verify signatures instead), so they are unaffected.
const { verifyToken, getUserTokenVersion } = require("../modules/auth/auth.service");
const { requestOrigin, isAllowedOrigin } = require("../lib/origin-check");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function authRequired(req, res, next) {
  if (!req.tenant) {
    return res.status(401).json({ error: "Not logged in." });
  }

  const token = req.cookies?.afrexpay_session;
  if (!token) {
    return res.status(401).json({ error: "Not logged in." });
  }

  try {
    const payload = verifyToken(token);
    if (payload.tenantId !== req.tenant.id) {
      return res.status(403).json({ error: "Not authorized for this store." });
    }
    // Revocation: sessions carry the user's id + token version. A password
    // reset bumps the version, killing every pre-reset session — including
    // stolen ones. Tokens minted before uid existed are rejected outright
    // (one re-login after deploy) so nothing irrevocable survives.
    if (!payload.uid) {
      return res.status(401).json({ error: "Session expired or invalid. Log in again." });
    }
    try {
      const current = await getUserTokenVersion(payload.uid);
      if (current === null || current !== payload.tv) {
        return res.status(401).json({ error: "Session expired or invalid. Log in again." });
      }
    } catch (err) {
      console.error("Session version check failed:", err.message);
      return res.status(500).json({ error: "Could not verify session. Try again." });
    }
    if (!SAFE_METHODS.has(req.method)) {
      const origin = requestOrigin(req);
      if (origin && !isAllowedOrigin(origin, req.tenant)) {
        return res.status(403).json({ error: "Cross-origin request refused." });
      }
    }
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "Session expired or invalid. Log in again." });
  }
}

module.exports = authRequired;
