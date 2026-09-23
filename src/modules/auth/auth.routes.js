// src/modules/auth/auth.routes.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("./auth.controller");
const { getThemesForVertical } = require("../../verticals");

const router = express.Router();

// In-memory store — fine for a single process. If this ever runs as multiple
// instances behind a load balancer, swap in a shared store (e.g. Redis) or
// each instance tracks its own counts independently and the limit becomes
// "N per instance" instead of "N total".
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in a few minutes." },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many stores created from this address. Try again later." },
});

const resetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset requests. Try again later." },
});

// Public theme catalog for the signup wizard (base domain, no tenant yet).
// Theme metadata is already public — every storefront renders it — so no
// auth needed. resolveVertical falls back to products on bad input, same
// as the wizard's previous hardcoded fallback. Single source of truth:
// src/verticals.js; the wizard's inline list is offline fallback only.
router.get("/themes", (req, res) => {
  const themes = getThemesForVertical(req.query.vertical).map((t) => ({
    id: t.id,
    label: t.label,
    subCategory: t.subCategory,
    desc: t.description,
  }));
  res.json({ themes });
});

router.post("/signup", signupLimiter, controller.signup);
router.post("/login", loginLimiter, controller.login);
router.post("/logout", controller.logout);
router.post("/request-password-reset", resetRequestLimiter, controller.requestPasswordReset);
router.post("/reset-password", loginLimiter, controller.resetPassword);

module.exports = router;
