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

const app = require("./app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`afrexpay platform running on port ${PORT}`);
});
