// src/modules/domains/ask.routes.js — public, no auth, no tenant context.
//
// This is Caddy's on_demand_tls "ask" callback. Before issuing a TLS cert
// for any hostname it doesn't already have a static Caddyfile block for,
// Caddy GETs this endpoint with ?domain=<hostname> and only proceeds on a
// 200 response.
//
// Deliberately mounted BEFORE tenantResolver in app.js: tenantResolver 404s
// any host it doesn't recognize as BASE_DOMAIN or a subdomain thereof, which
// would reject Caddy's own request before the check could run. The ask
// endpoint has no tenant context — it just needs to know whether the hostname
// is a *verified* custom domain.
const express = require("express");
const { isDomainVerified } = require("./domain.service");

const router = express.Router();

router.get("/", async (req, res) => {
  const domain = (req.query.domain || "").toLowerCase().trim();
  if (domain && (await isDomainVerified(domain))) {
    return res.status(200).send("ok");
  }
  res.status(404).send("not a recognized domain");
});

module.exports = router;
