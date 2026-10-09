// tests/seo-entities.test.js
//
// PR2: crawlable detail URLs (/p/:slug, /s/:slug, /l/:slug) with per-entity
// heads + typed JSON-LD, and a full tenant sitemap. All pure-function
// pins — DB-backed lookups follow the existing untested-service pattern.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  ENTITY_PATH_RE,
  KIND_BY_PREFIX,
  PATH_PREFIX_BY_KIND,
  getEntityName,
  getEntityDescription,
  truncateDescription,
  minorToMajor,
  absoluteMediaUrl,
  buildEntityJsonLd,
  injectEntitySeoIntoHtml,
  buildTenantSitemapXml,
} = require("../src/lib/seo");
const { slugify, isValidSlug, slugError } = require("../src/lib/slug");
const { validateProduct, validateService, validateListing } = require("../src/lib/catalog-validation");

const tenant = {
  subdomain: "glow-salon",
  business_name: "Glow Salon",
  custom_domain: null,
  custom_domain_verified_at: null,
  config: { storeName: "Glow", tagline: "Hair & beauty" },
};
const product = {
  slug: "arabica-coffee", name: "Arabica Coffee", blurb: "Fresh beans",
  price_minor: 5000, currency: "UGX", stock_qty: 3,
};

test("slugify lowercases, strips diacritics, collapses separators", () => {
  assert.strictEqual(slugify("Café au Lait!"), "cafe-au-lait");
  assert.strictEqual(slugify("  --Hello__World-- "), "hello-world");
  assert.strictEqual(slugify("!!!"), "");
  assert.strictEqual(slugify("a".repeat(200)).length <= 80, true);
});

test("slug validation accepts kbd slugs, rejects paths/uppercase/empty", () => {
  assert.ok(isValidSlug("arabica-coffee"));
  assert.ok(isValidSlug("item-2"));
  assert.ok(!isValidSlug("Arabica"));
  assert.ok(!isValidSlug("a/b"));
  assert.ok(!isValidSlug(""));
  assert.ok(!isValidSlug("a--b"));
  assert.strictEqual(slugError("ok-slug"), null);
  assert.ok(slugError("Bad Slug").includes("slug must be"));
});

test("catalog validators reject bad slugs, accept absent ones", () => {
  const goodProduct = { sku: "s", name: "n", sizes: [], priceMinor: 1 };
  assert.strictEqual(validateProduct(goodProduct, { forUpdate: false }), null);
  assert.ok(validateProduct({ ...goodProduct, slug: "Bad!" }, { forUpdate: false }).includes("slug"));
  assert.strictEqual(
    validateService({ name: "n", durationMinutes: 30, priceMinor: 1 }, { forUpdate: false }),
    null
  );
  assert.ok(
    validateListing({ title: "t", listingType: "sale", priceMinor: 1, slug: "x y" }, { forUpdate: false }).includes("slug")
  );
});

test("entity path regex routes /p /s /l and rejects the rest", () => {
  assert.deepStrictEqual([..."/p/arabica-coffee".match(ENTITY_PATH_RE)].slice(1), ["p", "arabica-coffee"]);
  assert.deepStrictEqual([..."/s/haircut/".match(ENTITY_PATH_RE)].slice(1), ["s", "haircut"]);
  assert.ok(!ENTITY_PATH_RE.test("/"));
  assert.ok(!ENTITY_PATH_RE.test("/p/"));
  assert.ok(!ENTITY_PATH_RE.test("/api/products"));
  assert.ok(!ENTITY_PATH_RE.test("/p/a/b"));
  assert.strictEqual(KIND_BY_PREFIX.p, "product");
  assert.strictEqual(KIND_BY_PREFIX.s, "service");
  assert.strictEqual(KIND_BY_PREFIX.l, "listing");
  assert.strictEqual(PATH_PREFIX_BY_KIND.listing, "l");
});

test("minorToMajor honors zero-decimal currencies", () => {
  assert.strictEqual(minorToMajor(5000, "UGX"), "5000");
  assert.strictEqual(minorToMajor(1999, "USD"), "19.99");
  assert.strictEqual(minorToMajor(0, "KES"), "0.00");
});

test("entity names/descriptions fall back per kind", () => {
  assert.strictEqual(getEntityName(product, "product"), "Arabica Coffee");
  assert.strictEqual(getEntityName({ title: "Plot 12" }, "listing"), "Plot 12");
  assert.strictEqual(getEntityDescription(product, "product"), "Fresh beans");
  assert.strictEqual(getEntityDescription({ description: "Cut", location: "Kampala" }, "service"), "Cut");
  assert.strictEqual(truncateDescription("a".repeat(500)).length <= 156, true);
  assert.strictEqual(truncateDescription("short"), "short");
});

test("product JSON-LD is a Product with Offer + availability", () => {
  const tag = buildEntityJsonLd({
    kind: "product", entity: product,
    canonicalUrl: "https://glow-salon.afrexpay.app/p/arabica-coffee",
    imageUrl: "https://glow-salon.afrexpay.app/media/abc.jpg",
  });
  assert.ok(tag.includes('"@type":"Product"'));
  assert.ok(tag.includes('"price":"5000"'));
  assert.ok(tag.includes('"priceCurrency":"UGX"'));
  assert.ok(tag.includes("schema.org/InStock"));
  assert.ok(tag.includes("abc.jpg"));
  const out = buildEntityJsonLd({
    kind: "product", entity: { ...product, stock_qty: 0 },
    canonicalUrl: "https://x/", imageUrl: "",
  });
  assert.ok(out.includes("schema.org/OutOfStock"));
});

test("service/listing JSON-LD use their schema.org types", () => {
  const svc = buildEntityJsonLd({
    kind: "service",
    entity: { name: "Haircut", description: "Cut", price_minor: 1999, currency: "USD" },
    canonicalUrl: "https://x/s/haircut", imageUrl: "",
  });
  assert.ok(svc.includes('"@type":"Service"'));
  assert.ok(svc.includes('"price":"19.99"'));
  const lst = buildEntityJsonLd({
    kind: "listing",
    entity: { title: "Plot", location: "Kampala", price_minor: 100, currency: "USD", status: "sold" },
    canonicalUrl: "https://x/l/plot", imageUrl: "",
  });
  assert.ok(lst.includes("RealEstateListing"));
  assert.ok(lst.includes("Kampala"));
  assert.ok(lst.includes("schema.org/OutOfStock"));
});

test("entity injection titles, canonicalizes, and images the page", () => {
  const raw = '<html><head><title>Storefront</title></head><body></body></html>';
  const out = injectEntitySeoIntoHtml(raw, {
    tenant, kind: "product", entity: product,
    canonicalUrl: "https://glow-salon.afrexpay.app/p/arabica-coffee",
    imageUrl: "https://glow-salon.afrexpay.app/media/abc.jpg",
  });
  assert.ok(out.includes("<title>Arabica Coffee — Glow</title>"));
  assert.ok(out.includes('rel="canonical" href="https://glow-salon.afrexpay.app/p/arabica-coffee"'));
  assert.ok(out.includes('property="og:image"'));
  assert.ok(out.includes("summary_large_image"));
  assert.ok(out.includes('"@type":"Product"'));
  assert.ok(!out.includes(">Storefront</title>"));
});

test("entity JSON-LD escapes merchant HTML", () => {
  const out = buildEntityJsonLd({
    kind: "product",
    entity: { ...product, name: '"><script>alert(1)</script>' },
    canonicalUrl: "https://x/", imageUrl: "",
  });
  assert.ok(!out.includes("<script>alert"));
});

test("absoluteMediaUrl builds tenant-scoped image URLs", () => {
  assert.strictEqual(
    absoluteMediaUrl("https://glow-salon.afrexpay.app", "abc.jpg"),
    "https://glow-salon.afrexpay.app/media/abc.jpg"
  );
  assert.strictEqual(absoluteMediaUrl("https://x/", ""), "");
  assert.strictEqual(absoluteMediaUrl("", "abc.jpg"), "");
});

test("full sitemap lists home + entity URLs with lastmod", () => {
  const xml = buildTenantSitemapXml("https://glow-salon.afrexpay.app", [
    { loc: "https://glow-salon.afrexpay.app/", changefreq: "daily", priority: "1.0" },
    { loc: "https://glow-salon.afrexpay.app/p/arabica-coffee", lastmod: "2026-10-09", changefreq: "weekly", priority: "0.8" },
  ]);
  assert.ok(xml.startsWith("<?xml"));
  assert.ok(xml.includes("<loc>https://glow-salon.afrexpay.app/</loc>"));
  assert.ok(xml.includes("<loc>https://glow-salon.afrexpay.app/p/arabica-coffee</loc>"));
  assert.ok(xml.includes("<lastmod>2026-10-09</lastmod>"));
  // home-only default still holds for callers without catalog access
  const minimal = buildTenantSitemapXml("https://glow-salon.afrexpay.app");
  assert.ok(minimal.includes("https://glow-salon.afrexpay.app/"));
  assert.ok(!minimal.includes("/p/"));
});
