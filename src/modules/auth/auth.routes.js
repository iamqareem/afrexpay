// src/modules/auth/auth.routes.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("./auth.controller");

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

router.post("/signup", signupLimiter, controller.signup);
router.post("/login", loginLimiter, controller.login);
router.post("/logout", controller.logout);
router.post("/request-password-reset", resetRequestLimiter, controller.requestPasswordReset);
router.post("/reset-password", loginLimiter, controller.resetPassword);

module.exports = router;
