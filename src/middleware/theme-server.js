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
const {
  injectSeoIntoHtml,
  injectEntitySeoIntoHtml,
  canonicalUrlForRequest,
  canonicalBaseForTenant,
  absoluteMediaUrl,
  ENTITY_PATH_RE,
  KIND_BY_PREFIX,
} = require("../lib/seo");
const { getStorefrontEntity } = require("../modules/discovery/discovery.service");

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
const indexHtmlCache = new Map(); // themeSlug -> raw index.html (SEO tags injected per request)

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
    // it from there via /api/config and /api/products. SEO tags are injected
    // per request from req.tenant so crawlers see name/canonical/OG without
    // JS, while humans get the identical shell + client-side rendering.
    const indexPath = path.join(THEMES_DIR, themeSlug, "index.html");
    let raw = indexHtmlCache.get(themeSlug);
    if (raw === undefined) {
      try {
        raw = fs.readFileSync(indexPath, "utf8");
      } catch (readErr) {
        return next(readErr);
      }
      indexHtmlCache.set(themeSlug, raw);
    }
    // Detail URLs (/p/:slug, /s/:slug, /l/:slug) get per-entity heads.
    // Static-asset hits never reach here (handled above), so any match is
    // a genuine entity page or an unknown slug — never a false positive.
    const entityMatch = ENTITY_PATH_RE.exec(req.path);
    if (entityMatch) {
      serveEntityPage(req, res, next, raw, entityMatch);
      return;
    }
    try {
      const canonicalUrl = canonicalUrlForRequest(req.tenant, req);
      const html = injectSeoIntoHtml(raw, { tenant: req.tenant, canonicalUrl });
      res.type("html").send(html);
    } catch (seoErr) {
      next(seoErr);
    }
  });
}

// Detail page: same shell, entity-specific head (title, description,
// canonical, OG image, typed JSON-LD). Unknown slugs are a real 404 with a
// noindex shell — never a soft-404 200, which crawlers read as "index an
// empty page under a product URL".
async function serveEntityPage(req, res, next, raw, entityMatch) {
  try {
    const kind = KIND_BY_PREFIX[entityMatch[1]];
    const slug = entityMatch[2].toLowerCase();
    const entity = await getStorefrontEntity(req.tenant.id, kind, slug);
    const canonicalBase = canonicalBaseForTenant(req.tenant, req.headers.host).replace(/\/+$/, "");
    if (!entity || !entity.slug) {
      const noindexTenant = { ...req.tenant, config: { ...(req.tenant.config || {}), noindex: true } };
      const html = injectSeoIntoHtml(raw, { tenant: noindexTenant, canonicalUrl: `${canonicalBase}/` });
      return res.status(404).type("html").send(html);
    }
    const canonicalUrl = `${canonicalBase}/${entityMatch[1]}/${entity.slug}`;
    const imageUrl = absoluteMediaUrl(canonicalBase, entity.cover_path);
    const html = injectEntitySeoIntoHtml(raw, {
      tenant: req.tenant,
      kind,
      entity,
      canonicalUrl,
      imageUrl,
    });
    return res.type("html").send(html);
  } catch (err) {
    next(err);
  }
}

module.exports = { serveStorefront, VALID_THEMES, THEMES_DIR };
