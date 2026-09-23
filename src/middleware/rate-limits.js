// src/middleware/rate-limits.js — shared limiters for public (unauthenticated)
// write paths. Same in-memory store caveat as auth.routes.js: single process
// only; behind multiple instances each tracks its own counts.
const rateLimit = require("express-rate-limit");

// Storefront checkout + lead capture: generous enough for real shoppers
// behind one NAT IP, tight enough to blunt script floods. Booking creation
// is the most expensive (window lookups + exclusion insert), hence shares
// the same budget rather than a looser one.
const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this address. Try again in a few minutes." },
});

module.exports = { publicWriteLimiter };
