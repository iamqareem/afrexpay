// src/lib/checkout-redirects.js
//
// successUrl/cancelUrl arrive from the storefront and are handed to
// Stripe/PayPal as post-payment return targets. Unvalidated, an attacker
// can start a legitimate checkout with successUrl=https://evil.tld/... and
// send the trusted provider URL to a shopper — payment happens, then the
// shopper lands on a phishing page. These must point back at the store
// being paid (its subdomain, its verified custom domain, or the platform
// site itself), never at an arbitrary host.
const BASE_DOMAIN = (process.env.BASE_DOMAIN || "afrexpay.com").toLowerCase();

function tenantHosts(tenant) {
  const hosts = new Set([BASE_DOMAIN, `www.${BASE_DOMAIN}`]);
  if (tenant?.subdomain) hosts.add(`${String(tenant.subdomain).toLowerCase()}.${BASE_DOMAIN}`);
  if (tenant?.custom_domain) hosts.add(String(tenant.custom_domain).toLowerCase());
  return hosts;
}

function assertSafeRedirect(url, label, hosts) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw Object.assign(new Error(`${label} must be a valid absolute URL.`), { status: 400 });
  }
  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost =
    process.env.NODE_ENV !== "production" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]");
  if (!isLocalhost && parsed.protocol !== "https:") {
    throw Object.assign(new Error(`${label} must use https.`), { status: 400 });
  }
  if (!isLocalhost && !hosts.has(hostname)) {
    throw Object.assign(new Error(`${label} must point back to this store.`), { status: 400 });
  }
}

function assertSafeCheckoutRedirects(successUrl, cancelUrl, tenant) {
  const hosts = tenantHosts(tenant);
  assertSafeRedirect(successUrl, "successUrl", hosts);
  assertSafeRedirect(cancelUrl, "cancelUrl", hosts);
}

module.exports = { assertSafeCheckoutRedirects, tenantHosts };
