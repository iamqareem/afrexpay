// src/middleware/auth-required.js
// Guards merchant-facing admin routes (editing config/products). Must run
// AFTER tenant-resolver, so req.tenant is already set — this only checks that
// the logged-in session actually belongs to *this* tenant, not some other one.
const { verifyToken } = require("../modules/auth/auth.service");

function authRequired(req, res, next) {
  const token = req.cookies?.afrexpay_session;
  if (!token) {
    return res.status(401).json({ error: "Not logged in." });
  }

  try {
    const payload = verifyToken(token);
    if (payload.tenantId !== req.tenant.id) {
      return res.status(403).json({ error: "Not authorized for this store." });
    }
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "Session expired or invalid. Log in again." });
  }
}

module.exports = authRequired;
