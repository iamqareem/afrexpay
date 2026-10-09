// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/app.js — this file is the map of the system: every module's routes
// mounted in one place. To see what the platform does, read this file.
const express = require("express");
const path = require("node:path");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");
const { tenantResolver, extractSubdomain } = require("./middleware/tenant-resolver");
const { serveStorefront } = require("./middleware/theme-server");
const { serveMedia } = require("./middleware/media-server");

const authRoutes = require("./modules/auth/auth.routes");
const configRoutes = require("./modules/store-config/config.routes");
const productRoutes = require("./modules/products/product.routes");
const orderRoutes = require("./modules/orders/order.routes");
const mediaRoutes = require("./modules/media/media.routes");
const matrixRoutes = require("./modules/notify-matrix/matrix.routes");
const serviceRoutes = require("./modules/services/service.routes");
const availabilityRoutes = require("./modules/services/availability.routes");
const resourceRoutes = require("./modules/services/resource.routes");
const bookingRoutes = require("./modules/bookings/booking.routes");
const listingRoutes = require("./modules/listings/listing.routes");
const inquiryRoutes = require("./modules/inquiries/inquiry.routes");
const reservationRoutes = require("./modules/listings/reservation.routes");
const paymentCredentialsRoutes = require("./modules/payments/credentials.routes");
const stripeWebhookRoutes = require("./modules/payments/webhook.routes");
const domainRoutes = require("./modules/domains/domain.routes");
const domainAskRoutes = require("./modules/domains/ask.routes");
const { router: storeQrRouter, serveQrSvg } = require("./modules/store-qr/store-qr.routes");

const app = express();

// Trust the first hop (Caddy, or whatever reverse proxy sits in front in
// production) so req.ip is the real client IP — without this, rate limiting
// would see every request as coming from the proxy and limit all merchants
// together as one.
app.set("trust proxy", 1);

// contentSecurityPolicy is deliberately disabled here, not left at helmet's
// default: Alpine.js evaluates expressions via `new Function()`, which needs
// 'unsafe-eval' in script-src, and both the admin and public pages use
// inline style="" attributes, which need 'unsafe-inline' in style-src.
// Helmet's default strict CSP would silently break the dashboard rather than
// showing an obvious error. The other headers (frameguard, noSniff, HSTS,
// referrer policy) still apply and don't have that conflict.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Mounted BEFORE express.json(): Stripe's webhook signature verification
// needs the exact raw request bytes, which webhook.routes.js reads itself
// via express.raw() — if the global JSON parser below ran first, it would
// consume and re-serialize the body, breaking every signature check in a
// way that looks like "the secret must be wrong" but isn't. This route
// also identifies its tenant from the URL path (/:tenantId), not the Host
// header, so it correctly sits outside the tenantResolver chain too —
// Stripe calls this URL directly, with no subdomain-routing concept at all.
app.use("/api/payments/webhook", stripeWebhookRoutes);

// Caddy's on_demand_tls "ask" callback — must be outside the tenantResolver
// chain for the same reason as stripeWebhookRoutes above: tenantResolver
// would 404 Caddy's own request (it calls this with no matching Host).
app.use("/api/domains/ask", domainAskRoutes);

app.use(express.json());
app.use(cookieParser());

// Signup/login aren't tenant-scoped by subdomain (a new merchant doesn't have
// one yet) — mounted before the resolver, on the base domain only.
app.use("/api/auth", authRoutes);

// Shared pay-now component for every storefront theme. Served on ALL hosts
// (base + tenant subdomains) before tenant resolution: it carries no tenant
// data, and themes reference it as /js/afrexpay-checkout.js. A per-theme
// copy would re-create the drift this file exists to kill.
app.get("/js/afrexpay-checkout.js", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "js", "afrexpay-checkout.js"));
});

// Requests to the bare base domain (afrexpay.com, no subdomain) get the
// marketing/signup site, not a tenant storefront — checked before tenant
// resolution so it never gets caught by the "no store found" 404 below.
// Instantiated once: the old per-request express.static() churned a
// handler object on every base-domain hit for no reason.
const baseStatic = express.static(path.join(__dirname, "..", "public"));
const BASE_DOMAIN = (process.env.BASE_DOMAIN || "afrexpay.com").toLowerCase();
app.use((req, res, next) => {
  // Host check is load-bearing: extractSubdomain() is null for custom
  // domains too, and serving public/ for those hijacked every verified
  // custom storefront with the marketing site.
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const isBase = host === BASE_DOMAIN || host === `www.${BASE_DOMAIN}`;
  if (isBase && !req.path.startsWith("/api")) {
    return baseStatic(req, res, next);
  }
  next();
});

// The merchant admin dashboard is the same static bundle for every tenant
// (unlike the storefront, it doesn't need theme-awareness) — but it still
// needs req.tenant set, since it manages whichever store the subdomain
// points at, so it's mounted after the resolver, not before.
app.use(tenantResolver);

// Dashboards are merchant-only: never index them. Meta noindex lives in
// admin/index.html; this header covers non-HTML assets under /admin too.
app.use("/admin", (req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});
app.use("/admin", express.static(path.join(__dirname, "..", "admin")));

app.use("/api/config", configRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/matrix", matrixRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/resources", resourceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/inquiries", inquiryRoutes);
// Sibling namespace, not nested under /api/listings — if listingRoutes
// ever grows a GET /:id route (a natural future addition, "fetch one
// listing's detail"), a nested /api/listings/reservations path would
// silently start matching that instead, since Express tries mounted
// routers in registration order and /:id matches any single segment
// including the literal string "reservations". A sibling path removes
// that collision risk entirely rather than depending on an invariant
// that's easy to break without realizing why.
app.use("/api/listing-reservations", reservationRoutes);
app.use("/api/payments/credentials", paymentCredentialsRoutes);
app.use("/api/domains", domainRoutes);
app.use("/api/store-qr", storeQrRouter);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, tenant: req.tenant.subdomain });
});

// Tenant-scoped product photos. The JSON 404 keeps /media misses in the
// API's error shape — without it they fall through to Express's default
// HTML 404 (the storefront catch-all below deliberately excludes /media).
app.use("/media", serveMedia);
app.use("/media", (req, res) => {
  res.status(404).json({ error: "Media not found." });
});

// Public per-store QR image for every storefront footer (<img src="/qr.svg">).
// Mounted after tenant resolution (needs req.tenant) and before the
// storefront catch-all, which would otherwise swallow the path.
app.get("/qr.svg", serveQrSvg);

// Per-tenant crawl files. Same placement rule as /qr.svg: they need
// req.tenant and must beat the storefront catch-all, which would otherwise
// serve index.html with a 200 for /robots.txt and /sitemap.xml (invalid for
// crawlers). Base-domain robots/sitemap are static files in public/ and are
// served before the resolver — these two only ever fire for tenant hosts
// (subdomains + verified custom domains).
app.get("/robots.txt", (req, res) => {
  const { canonicalBaseForTenant, buildTenantRobotsTxt } = require("./lib/seo");
  const canonicalBase = canonicalBaseForTenant(req.tenant, req.headers.host);
  res.type("text/plain").send(buildTenantRobotsTxt(canonicalBase));
});
app.get("/sitemap.xml", async (req, res) => {
  const { canonicalBaseForTenant, buildTenantSitemapXml, PATH_PREFIX_BY_KIND } = require("./lib/seo");
  const { listSitemapEntries } = require("./modules/discovery/discovery.service");
  const canonicalBase = canonicalBaseForTenant(req.tenant, req.headers.host).replace(/\/+$/, "");
  let entries;
  try {
    const rows = await listSitemapEntries(req.tenant.id);
    entries = [{ loc: `${canonicalBase}/`, changefreq: "daily", priority: "1.0" }];
    for (const row of rows) {
      const prefix = PATH_PREFIX_BY_KIND[row.kind];
      if (!prefix || !row.slug) continue;
      entries.push({
        loc: `${canonicalBase}/${prefix}/${row.slug}`,
        ...(row.updated_at ? { lastmod: new Date(row.updated_at).toISOString().slice(0, 10) } : {}),
        changefreq: "weekly",
        priority: "0.8",
      });
    }
  } catch (dbErr) {
    // The sitemap must stay valid XML even when the catalog query fails —
    // crawlers retry a home-only sitemap, they choke on a 500.
    console.error("Tenant sitemap entries failed:", dbErr.message);
    entries = undefined; // home-only default in buildTenantSitemapXml
  }
  res.type("application/xml").send(buildTenantSitemapXml(canonicalBase, entries));
});

// Everything else is the public storefront — theme picked per tenant.
// Segment-anchored: the old prefix negative-lookahead also swallowed
// legitimate slugs like /apiary, /administrator-sale and /media-kit (they
// fell through to a 404 instead of the storefront).
app.get(/^(?!\/api(\/|$)|\/admin(\/|$)|\/media(\/|$)).*/, serveStorefront);

// Centralized error handler — must be last. Catches anything a route didn't
// handle itself (Express 5 forwards rejected async handlers here
// automatically). Always responds with a plain { error } JSON shape and
// never leaks a stack trace to the client, whatever the actual cause was.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.publicMessage || "Something went wrong. Please try again." });
});

module.exports = app;
