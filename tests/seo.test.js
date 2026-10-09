// tests/seo.test.js
//
// PR1: storefronts + afrexpay.app are crawlable, dashboards never are.
// Tenant shells are static SPA files — these pin the per-request head
// injection (title/canonical/OG/JSON-LD) and the crawl files.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  escapeHtml,
  getStoreName,
  getStoreDescription,
  getSeoTitle,
  canonicalUrlForRequest,
  injectSeoIntoHtml,
  buildTenantRobotsTxt,
  buildTenantSitemapXml,
} = require("../src/lib/seo");

const tenant = {
  subdomain: "glow-salon",
  business_name: "Glow Salon",
  custom_domain: null,
  custom_domain_verified_at: null,
  config: { storeName: "Glow", storeNameAccent: "Salon", tagline: "Hair & beauty" },
};

test("store name prefers config.storeName over business_name", () => {
  assert.strictEqual(getStoreName(tenant), "Glow");
  assert.strictEqual(getStoreName({ subdomain: "s", business_name: "Biz", config: {} }), "Biz");
});

test("seo title combines name + tagline, honors explicit seoTitle", () => {
  assert.strictEqual(getSeoTitle(tenant), "Glow Salon — Hair & beauty");
  assert.strictEqual(
    getSeoTitle({ ...tenant, config: { ...tenant.config, seoTitle: "Custom" } }),
    "Custom"
  );
});

test("description falls back to tagline, never empty", () => {
  assert.strictEqual(getStoreDescription(tenant), "Hair & beauty");
  assert.ok(getStoreDescription({ subdomain: "s", config: {} }).length > 0);
});

test("canonical uses subdomain URL + request path", () => {
  const url = canonicalUrlForRequest(tenant, { path: "/", headers: { host: "x" } });
  assert.ok(url.startsWith("https://glow-salon."));
  assert.ok(url.endsWith("/"));
});

test("injection replaces placeholder title and adds canonical + JSON-LD", () => {
  const raw = '<html><head><title id="page-title">Storefront</title></head><body></body></html>';
  const out = injectSeoIntoHtml(raw, { tenant, canonicalUrl: "https://glow-salon.afrexpay.app/" });
  assert.ok(!out.includes(">Storefront</title>"));
  assert.ok(out.includes("Glow Salon"));
  assert.ok(out.includes('rel="canonical"'));
  assert.ok(out.includes("og:title"));
  assert.ok(out.includes("application/ld+json"));
  assert.ok(out.includes("https://glow-salon.afrexpay.app/"));
});

test("injection escapes merchant-controlled strings", () => {
  const evil = { ...tenant, config: { storeName: '"><script>alert(1)</script>', tagline: "x" } };
  const out = injectSeoIntoHtml('<html><head><title>T</title></head></html>', {
    tenant: evil,
    canonicalUrl: "https://glow-salon.afrexpay.app/",
  });
  assert.ok(!out.includes("<script>alert(1)"));
  assert.ok(out.includes("&lt;script&gt;"));
  assert.strictEqual(escapeHtml('a&b<"c">'), "a&amp;b&lt;&quot;c&quot;&gt;");
});

test("noindex config emits robots noindex", () => {
  const out = injectSeoIntoHtml('<html><head><title>T</title></head></html>', {
    tenant: { ...tenant, config: { ...tenant.config, noindex: true } },
    canonicalUrl: "https://glow-salon.afrexpay.app/",
  });
  assert.ok(out.includes('name="robots" content="noindex, nofollow"'));
});

test("tenant robots allows storefront, blocks admin/api, points at sitemap", () => {
  const txt = buildTenantRobotsTxt("https://glow-salon.afrexpay.app");
  assert.ok(txt.includes("Allow: /"));
  assert.ok(txt.includes("Disallow: /admin"));
  assert.ok(txt.includes("Disallow: /api/"));
  assert.ok(txt.includes("Sitemap: https://glow-salon.afrexpay.app/sitemap.xml"));
});

test("tenant sitemap is valid XML with home URL, not HTML shell", () => {
  const xml = buildTenantSitemapXml("https://glow-salon.afrexpay.app");
  assert.ok(xml.startsWith("<?xml"));
  assert.ok(xml.includes("<urlset"));
  assert.ok(xml.includes("https://glow-salon.afrexpay.app/"));
  assert.ok(!xml.includes("<html"));
});

test("admin shell carries noindex", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "admin", "index.html"), "utf8");
  assert.ok(html.includes('name="robots" content="noindex, nofollow"'));
});

test("public marketing head carries canonical + OG + JSON-LD", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.ok(html.includes('rel="canonical" href="https://afrexpay.app/"'));
  assert.ok(html.includes("og:title"));
  assert.ok(html.includes("application/ld+json"));
  assert.ok(!html.includes(".afrexpay.com"));
});

test("public robots + sitemap exist and are valid", () => {
  const robots = fs.readFileSync(path.join(__dirname, "..", "public", "robots.txt"), "utf8");
  assert.ok(robots.includes("Disallow: /admin"));
  assert.ok(robots.includes("Sitemap: https://afrexpay.app/sitemap.xml"));
  const sitemap = fs.readFileSync(path.join(__dirname, "..", "public", "sitemap.xml"), "utf8");
  assert.ok(sitemap.includes("<urlset"));
  assert.ok(sitemap.includes("https://afrexpay.app/"));
});
