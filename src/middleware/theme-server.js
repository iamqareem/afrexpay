// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/middleware/theme-server.js
// One process serves many tenants, and tenants can be on different themes —
// this picks the right static bundle per request instead of one fixed
// public/ folder. Static handlers are cached per theme_slug so we're not
// rebuilding an express.static instance on every request.
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const THEMES_DIR = path.join(__dirname, "..", "..", "themes");
const DEFAULT_THEME = "hangtag";

// theme_slug isn't settable through any API yet, but the moment a "pick
// your theme" dashboard feature ships, it will be — and fs.existsSync on an
// untrusted, unsanitized path is a path-traversal risk the instant that
// happens (a slug like "../../../etc" could resolve outside THEMES_DIR).
// Building an explicit whitelist once at startup, from what's actually on
// disk, means a malicious slug can never resolve to anything outside this
// set, regardless of what request data claims.
const VALID_THEMES = new Set(
  fs.readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
);

const staticHandlerCache = new Map();

function getStaticHandler(themeSlug) {
  if (staticHandlerCache.has(themeSlug)) return staticHandlerCache.get(themeSlug);
  const themeDir = path.join(THEMES_DIR, themeSlug);
  const handler = express.static(themeDir, { index: false }); // index:false — we serve index.html ourselves, below
  staticHandlerCache.set(themeSlug, handler);
  return handler;
}

function serveStorefront(req, res, next) {
  const themeSlug = VALID_THEMES.has(req.tenant.theme_slug) ? req.tenant.theme_slug : DEFAULT_THEME;

  const handler = getStaticHandler(themeSlug);

  handler(req, res, (err) => {
    if (err) return next(err);
    // No matching static file (e.g. the root path "/") — serve that theme's
    // index.html. This is the storefront's single HTML shell; app.js takes
    // it from there via /api/config and /api/products.
    const indexPath = path.join(THEMES_DIR, themeSlug, "index.html");
    res.sendFile(indexPath, (sendErr) => {
      if (sendErr) next(sendErr);
    });
  });
}

module.exports = { serveStorefront, VALID_THEMES, THEMES_DIR };
