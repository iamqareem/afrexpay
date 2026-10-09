// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/lib/seo.js — shared SEO helpers for tenant storefronts.
//
// Storefront themes are static SPA shells (see theme-server.js): crawlers
// that don't run JS only see the placeholder <title>Storefront</title>.
// These helpers build a per-tenant <head> (title, description, canonical,
// Open Graph) from the tenant row + store_configs.config JSONB, and inject
// it into the served HTML with plain string replacement — no new runtime
// dependency, no per-theme fork.
const { storePublicUrl } = require("./store-qr");
const { isZeroDecimal } = require("./currency");

// Detail-URL prefixes: /p/:slug (products), /s/:slug (services),
// /l/:slug (listings). Single-segment on purpose — they live under the
// storefront catch-all in app.js, so two-segment paths would risk
// colliding with future theme pages.
const KIND_BY_PREFIX = { p: "product", s: "service", l: "listing" };
const PATH_PREFIX_BY_KIND = { product: "p", service: "s", listing: "l" };
const ENTITY_PATH_RE = /^\/(p|s|l)\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getStoreName(tenant) {
  const cfg = tenant?.config || {};
  return cfg.storeName || tenant?.business_name || tenant?.subdomain || "Store";
}

function getStoreDescription(tenant) {
  const cfg = tenant?.config || {};
  const name = getStoreName(tenant);
  return (
    cfg.seoDescription ||
    cfg.tagline ||
    cfg.heroSubtitle ||
    `${name} — shop online.`
  );
}

function getSeoTitle(tenant) {
  const cfg = tenant?.config || {};
  if (cfg.seoTitle) return String(cfg.seoTitle);
  const name = getStoreName(tenant);
  const accent = cfg.storeNameAccent ? ` ${cfg.storeNameAccent}` : "";
  const tagline = cfg.tagline ? ` — ${cfg.tagline}` : "";
  return `${name}${accent}${tagline}`;
}

function canonicalBaseForTenant(tenant, fallbackHost) {
  try {
    return storePublicUrl(tenant);
  } catch {
    const host = String(fallbackHost || "").split(":")[0].toLowerCase();
    return host ? `https://${host}` : "";
  }
}

// Canonical for the current page: base + path (no query). Home collapses to "/".
function canonicalUrlForRequest(tenant, req) {
  const base = canonicalBaseForTenant(tenant, req?.headers?.host).replace(/\/+$/, "");
  const rawPath = typeof req?.path === "string" ? req.path : "/";
  const pagePath = rawPath === "" ? "/" : rawPath;
  return `${base}${pagePath === "/" ? "/" : pagePath}`;
}

function buildStorefrontHeadTags({ title, description, canonicalUrl, robotsContent, imageUrl }) {
  // No <title> here — spliceHead owns the single title swap, so there is
  // exactly one <title> in the served document.
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const c = escapeHtml(canonicalUrl);
  const lines = [
    `<meta name="description" content="${d}" />`,
    robotsContent ? `<meta name="robots" content="${escapeHtml(robotsContent)}" />` : "",
    c ? `<link rel="canonical" href="${c}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    c ? `<meta property="og:url" content="${c}" />` : "",
    imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : "",
    `<meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].filter(Boolean);
  return lines.join("\n  ");
}

// JSON-LD script body escaping, shared by every JSON-LD builder: <, > and
// & are unicode-escaped so merchant-controlled strings can never break out
// of the script block (script content is CDATA-ish — only </script> ends
// it, but < also starts <!-- weirdness in old parsers; belt and braces).
function safeJsonLd(data) {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/<\/script/gi, "<\\/script");
  return `<script type="application/ld+json">${json}</script>`;
}

function buildStoreJsonLd({ name, description, canonicalBase }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: String(name || "Store"),
    url: String(canonicalBase || ""),
    description: String(description || ""),
  };
  return safeJsonLd(data);
}

// Shared splice: swap the placeholder <title>, inject tags before </head>.
function spliceHead(html, title, injection) {
  let out = String(html);
  out = out.replace(/<title[^>]*>.*?<\/title>/is, `<title>${escapeHtml(title)}</title>`);
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${injection}</head>`);
  } else {
    out = `${injection}${out}`;
  }
  return out;
}

// Replace the placeholder <title> and inject tags before </head>.
// If the shell has no </head> (shouldn't happen — all themes ship one),
// fall back to prepending so SEO output is never silently dropped.
function injectSeoIntoHtml(html, { tenant, canonicalUrl }) {
  const title = getSeoTitle(tenant);
  const description = getStoreDescription(tenant);
  const robotsContent = tenant?.config?.noindex ? "noindex, nofollow" : "";
  const tags = buildStorefrontHeadTags({ title, description, canonicalUrl, robotsContent });
  const jsonLd = buildStoreJsonLd({
    name: getStoreName(tenant),
    description,
    canonicalBase: canonicalUrl ? canonicalUrl.replace(/\/+$/, "").split("/").slice(0, 3).join("/") + "/" : "",
  });
  return spliceHead(html, title, `  ${tags}\n  ${jsonLd}\n  `);
}

// ---- per-entity detail SEO (/p/:slug, /s/:slug, /l/:slug) ----

function getEntityName(entity, kind) {
  if (!entity) return "Item";
  if (kind === "listing") return entity.title || "Listing";
  return entity.name || "Item";
}

function getEntityDescription(entity, kind) {
  if (!entity) return "";
  if (kind === "product") return entity.blurb || entity.category || "";
  if (kind === "service") return entity.description || "";
  return entity.description || entity.location || "";
}

// Meta descriptions truncate in search results (~155 chars) — keep the tag
// short at the source instead of shipping a paragraph crawlers cut anyway.
function truncateDescription(text, maxLength = 155) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength - 1).trimEnd()}…`;
}

// Minor-unit price (as stored) to the major-unit string JSON-LD wants,
// honoring the zero-decimal set (UGX/JPY have no fractional unit).
function minorToMajor(priceMinor, currency) {
  const minor = Number(priceMinor);
  if (!Number.isFinite(minor)) return "0";
  if (isZeroDecimal(currency)) return String(Math.round(minor));
  return (minor / 100).toFixed(2);
}

function absoluteMediaUrl(canonicalBase, storagePath) {
  if (!storagePath) return "";
  const base = String(canonicalBase || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/media/${encodeURIComponent(String(storagePath))}`;
}

function buildEntityJsonLd({ kind, entity, canonicalUrl, imageUrl }) {
  const name = getEntityName(entity, kind);
  const description = getEntityDescription(entity, kind);
  const offers = {
    "@type": "Offer",
    priceCurrency: String(entity?.currency || "UGX"),
    price: minorToMajor(entity?.price_minor ?? entity?.priceMinor ?? 0, entity?.currency),
    url: String(canonicalUrl || ""),
  };
  if (kind === "product") {
    // NULL stock means untracked (infinite for SEO purposes), not zero.
    const qty = entity?.stock_qty ?? entity?.stockQty;
    offers.availability =
      qty === null || qty === undefined || Number(qty) > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
  }
  if (kind === "listing" && ["sold", "rented"].includes(entity?.status)) {
    offers.availability = "https://schema.org/OutOfStock";
  }
  const data = {
    "@context": "https://schema.org",
    "@type": kind === "product" ? "Product" : kind === "service" ? "Service" : "RealEstateListing",
    name: String(name),
    url: String(canonicalUrl || ""),
    ...(description ? { description: String(description) } : {}),
    ...(imageUrl ? { image: [String(imageUrl)] } : {}),
    offers,
  };
  if (kind === "listing" && entity?.location) {
    data.address = { "@type": "PostalAddress", addressLocality: String(entity.location) };
  }
  return safeJsonLd(data);
}

function getEntityTitle(tenant, kind, entity) {
  return `${getEntityName(entity, kind)} — ${getStoreName(tenant)}`;
}

function injectEntitySeoIntoHtml(html, { tenant, kind, entity, canonicalUrl, imageUrl }) {
  const title = getEntityTitle(tenant, kind, entity);
  const description = truncateDescription(getEntityDescription(entity, kind) || getStoreDescription(tenant));
  const robotsContent = tenant?.config?.noindex ? "noindex, nofollow" : "";
  const tags = buildStorefrontHeadTags({ title, description, canonicalUrl, robotsContent, imageUrl });
  const jsonLd = buildEntityJsonLd({ kind, entity, canonicalUrl, imageUrl });
  return spliceHead(html, title, `  ${tags}\n  ${jsonLd}\n  `);
}

function buildTenantRobotsTxt(canonicalBase) {
  const base = String(canonicalBase || "").replace(/\/+$/, "");
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /api/",
    "Disallow: /media/",
    base ? `Sitemap: ${base}/sitemap.xml` : "",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

// entries: [{ loc, lastmod?, changefreq?, priority? }]. Defaults to home
// only (PR1 shape) so callers without catalog access still emit valid XML.
function buildTenantSitemapXml(canonicalBase, entries) {
  const base = String(canonicalBase || "").replace(/\/+$/, "");
  const urls =
    entries && entries.length
      ? entries
      : [{ loc: base ? `${base}/` : "/", changefreq: "daily", priority: "1.0" }];
  const body = urls
    .map((entry) => {
      const lines = [
        "  <url>",
        `    <loc>${escapeHtml(entry.loc)}</loc>`,
        entry.lastmod ? `    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : "",
        entry.changefreq ? `    <changefreq>${escapeHtml(entry.changefreq)}</changefreq>` : "",
        entry.priority ? `    <priority>${escapeHtml(entry.priority)}</priority>` : "",
        "  </url>",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    "</urlset>",
    "",
  ].join("\n");
}

// Per-store llms.txt: a plain-text map of the shop for AI assistants —
// what it sells, where the machine-readable catalog lives, and the rules
// for ordering on a shopper's behalf. Crawlers fetch it like robots.txt.
function buildTenantLlmsTxt(tenant, { canonicalBase, currency, counts } = {}) {
  const base = String(canonicalBase || "").replace(/\/+$/, "");
  const name = getStoreName(tenant);
  const description = getStoreDescription(tenant);
  const vertical = tenant?.config?.vertical || "products";
  const lines = [
    `# ${name}`,
    `> ${description}`,
    `> Shop: ${base}/`,
    "",
    "## Catalog feeds",
    `- Products (JSON): ${base}/feed/products.json`,
    `- Products (Google Merchant CSV): ${base}/feed/products.csv`,
    `- Sitemap: ${base}/sitemap.xml`,
    ...(counts
      ? [`> ${counts.product} products · ${counts.service} services · ${counts.listing} listings (vertical: ${vertical})`]
      : []),
    "",
    "## Agent API (read-only JSON)",
    `- Store: GET ${base}/api/agent/v1/store`,
    `- Search products: GET ${base}/api/agent/v1/products?search=&limit=`,
    `- Search services: GET ${base}/api/agent/v1/services?search=&limit=`,
    `- Search listings: GET ${base}/api/agent/v1/listings?search=&limit=`,
    `- Detail pages: ${base}/p/:slug, ${base}/s/:slug, ${base}/l/:slug`,
    "",
    "## Ordering on a shopper's behalf",
    `- Place orders: POST ${base}/api/orders (public lead capture, same as the storefront form).`,
    `- Card payment: POST ${base}/api/orders/:id/checkout returns a hosted Stripe/PayPal URL — redirect the shopper there. Never ask for card details inside chat.`,
    `- Availability and prices change: re-check the feed or API before promising anything.`,
    "",
    "## Rules",
    `- Currency: ${currency || "see API"}.`,
    "- Cache feeds; be polite (automated clients are rate-limited).",
    "",
  ];
  return lines.join("\n");
}

module.exports = {
  escapeHtml,
  KIND_BY_PREFIX,
  PATH_PREFIX_BY_KIND,
  ENTITY_PATH_RE,
  getStoreName,
  getStoreDescription,
  getSeoTitle,
  canonicalBaseForTenant,
  canonicalUrlForRequest,
  buildStorefrontHeadTags,
  buildStoreJsonLd,
  safeJsonLd,
  injectSeoIntoHtml,
  getEntityName,
  getEntityDescription,
  truncateDescription,
  minorToMajor,
  absoluteMediaUrl,
  buildEntityJsonLd,
  getEntityTitle,
  injectEntitySeoIntoHtml,
  buildTenantRobotsTxt,
  buildTenantSitemapXml,
  buildTenantLlmsTxt,
};
