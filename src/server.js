// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/server.js — entry point only. All logic lives in app.js and the modules.
require("dotenv").config();

// Fail loudly at startup, not deep inside the first login attempt. A missing
// secret would otherwise surface as a cryptic jsonwebtoken error the first
// time someone tries to log in; a weak one would silently ship an
// insecure deployment.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error("JWT_SECRET is missing or too short (need at least 16 characters). Set it in .env before starting.");
  process.exit(1);
}
if (!process.env.PAYMENT_ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.PAYMENT_ENCRYPTION_KEY)) {
  console.error("PAYMENT_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}

const app = require("./app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`afrexpay platform running on port ${PORT}`);
});

// Hourly abandoned-checkout sweep (single pm2 fork = single timer, no
// duplicate runs). Env-gated: ABANDONED_SWEEP_ENABLED=false disables,
// ABANDONED_ORDER_TTL_MINUTES sets the abandon threshold (default 1440,
// matching Stripe's 24h session expiry — cancelling earlier would orphan
// a still-payable session).
if (process.env.ABANDONED_SWEEP_ENABLED !== "false") {
  const ttl = Number(process.env.ABANDONED_ORDER_TTL_MINUTES) || 1440;
  const sweep = async () => {
    try {
      const { releaseAbandonedOrders } = require("./modules/orders/order.service");
      const { cancelled, restored } = await releaseAbandonedOrders(undefined, { olderThanMinutes: ttl });
      if (cancelled > 0) console.log(`Abandoned sweep: cancelled ${cancelled} orders, restored stock on ${restored} lines.`);
    } catch (err) {
      console.error("Abandoned sweep failed:", err.message);
    }
  };
  const timer = setInterval(sweep, 60 * 60 * 1000);
  timer.unref();
}
