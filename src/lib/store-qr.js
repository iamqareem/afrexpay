// src/lib/store-qr.js — one canonical store URL + its QR, shared by the
// dashboard card, the public /qr.svg (theme footers), and tests. A QR that
// pointed anywhere but the live storefront (unverified domain, wrong
// scheme) would be a printed lie, so the same resolver feeds everyone.
const QRCode = require("qrcode");

function baseDomain() {
  return (process.env.BASE_DOMAIN || "afrexpay.com").toLowerCase();
}

// Canonical public URL: verified custom domain wins, else the subdomain.
// Mirrors tenantHosts() but returns exactly one URL, never a set.
function storePublicUrl(tenant) {
  if (tenant?.custom_domain && tenant?.custom_domain_verified_at) {
    return `https://${String(tenant.custom_domain).toLowerCase()}`;
  }
  const sub = String(tenant?.subdomain || "").toLowerCase();
  if (!sub) throw Object.assign(new Error("Tenant has no subdomain."), { status: 400 });
  return `https://${sub}.${baseDomain()}`;
}

async function storeQrSvg(tenant) {
  const url = storePublicUrl(tenant);
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 256 });
  return { url, svg };
}

module.exports = { storePublicUrl, storeQrSvg };
