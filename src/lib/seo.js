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

function buildStorefrontHeadTags({ title, description, canonicalUrl, robotsContent }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const c = escapeHtml(canonicalUrl);
  const lines = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    robotsContent ? `<meta name="robots" content="${escapeHtml(robotsContent)}" />` : "",
    c ? `<link rel="canonical" href="${c}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    c ? `<meta property="og:url" content="${c}" />` : "",
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].filter(Boolean);
  return lines.join("\n  ");
}

function buildStoreJsonLd({ name, description, canonicalBase }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: String(name || "Store"),
    url: String(canonicalBase || ""),
    description: String(description || ""),
  };
  // JSON.stringify is safe inside <script type="application/ld+json"> except
  // for HTML-significant chars — escape <, >, & and the literal </script>
  // sequence so a merchant's tagline can never break out of the JSON block.
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/<\/script/gi, "<\\/script");
  return `<script type="application/ld+json">${json}</script>`;
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
  const injection = `  ${tags}\n  ${jsonLd}\n  `;

  let out = String(html);
  out = out.replace(/<title[^>]*>.*?<\/title>/is, `<title>${escapeHtml(title)}</title>`);
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${injection}</head>`);
  } else {
    out = `${injection}${out}`;
  }
  return out;
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

// PR1 minimal sitemap: home only, so /sitemap.xml is valid XML instead of
// falling through to the storefront HTML shell. PR2 expands this with
// per-entity URLs once slugs + detail routes land.
function buildTenantSitemapXml(canonicalBase) {
  const base = String(canonicalBase || "").replace(/\/+$/, "");
  const loc = base ? `${base}/` : "/";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${escapeHtml(loc)}</loc>`,
    "    <changefreq>daily</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
    "</urlset>",
    "",
  ].join("\n");
}

module.exports = {
  escapeHtml,
  getStoreName,
  getStoreDescription,
  getSeoTitle,
  canonicalBaseForTenant,
  canonicalUrlForRequest,
  buildStorefrontHeadTags,
  buildStoreJsonLd,
  injectSeoIntoHtml,
  buildTenantRobotsTxt,
  buildTenantSitemapXml,
};
