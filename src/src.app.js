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
const bookingRoutes = require("./modules/bookings/booking.routes");
const listingRoutes = require("./modules/listings/listing.routes");
const inquiryRoutes = require("./modules/inquiries/inquiry.routes");
const reservationRoutes = require("./modules/listings/reservation.routes");
const paymentCredentialsRoutes = require("./modules/payments/credentials.routes");
const stripeWebhookRoutes = require("./modules/payments/webhook.routes");

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
app.use("/api/payments/stripe/webhook", stripeWebhookRoutes);

app.use(express.json());
app.use(cookieParser());

// Signup/login aren't tenant-scoped by subdomain (a new merchant doesn't have
// one yet) — mounted before the resolver, on the base domain only.
app.use("/api/auth", authRoutes);

// Requests to the bare base domain (afrexpay.com, no subdomain) get the
// marketing/signup site, not a tenant storefront — checked before tenant
// resolution so it never gets caught by the "no store found" 404 below.
app.use((req, res, next) => {
  const subdomain = extractSubdomain(req.headers.host);
  if (subdomain === null && !req.path.startsWith("/api")) {
    return express.static(path.join(__dirname, "..", "public"))(req, res, next);
  }
  next();
});

// The merchant admin dashboard is the same static bundle for every tenant
// (unlike the storefront, it doesn't need theme-awareness) — but it still
// needs req.tenant set, since it manages whichever store the subdomain
// points at, so it's mounted after the resolver, not before.
app.use(tenantResolver);

app.use("/admin", express.static(path.join(__dirname, "..", "admin")));

app.use("/api/config", configRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/matrix", matrixRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/availability", availabilityRoutes);
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

app.get("/api/health", (req, res) => {
  res.json({ ok: true, tenant: req.tenant.subdomain });
});

// Tenant-scoped product photos.
app.use("/media", serveMedia);

// Everything else is the public storefront — theme picked per tenant.
app.get(/^(?!\/api|\/admin|\/media).*/, serveStorefront);

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
