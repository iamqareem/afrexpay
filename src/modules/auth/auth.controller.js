// src/modules/auth/auth.controller.js
const { createTenantWithOwner, verifyLogin, issueToken, createPasswordResetToken, resetPasswordWithToken } = require("./auth.service");
const { sendResetEmail } = require("./reset-email");
const { invalidateTenantCache, extractSubdomain } = require("../../middleware/tenant-resolver");

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
// Pragmatic format check (not RFC-complete on purpose): catches typos and
// junk like "foo" while never rejecting a real address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE_DOMAIN = process.env.BASE_DOMAIN || "afrexpay.com";

// Words that would collide with the platform itself, look official, or are
// conventionally reserved on the internet — none of these should ever
// resolve to a merchant's storefront.
const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "admin", "app", "mail", "email", "smtp", "ftp", "ns1", "ns2",
  "dashboard", "blog", "help", "support", "status", "docs", "cdn", "static",
  "assets", "media", "staging", "dev", "test", "demo", "root", "afrexpay",
  "store", "shop", "signup", "login", "auth", "billing", "account",
  "security", "webmail", "portal", "system", "internal",
]);

// Signup happens on the base domain, but the session needs to work on the
// merchant's own subdomain afterward — a host-only cookie set on
// afrexpay.com would never be sent to 256-merch.afrexpay.com. Scoping the
// cookie to .afrexpay.com fixes that. Localhost doesn't support subdomain
// cookie scoping the same way, so dev just uses a host-only cookie.
function cookieOptions() {
  const opts = {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600 * 1000,
    secure: process.env.NODE_ENV === "production",
  };
  if (!BASE_DOMAIN.includes("localhost")) {
    opts.domain = `.${BASE_DOMAIN}`;
  }
  return opts;
}

const { verifyToken, getUserTokenVersion } = require("./auth.service");

async function sessionStatus(req, res) {
  // Lightweight auth probe for the admin boot: no tenant lookup, no data
  // queries — but the SAME bar as data endpoints (uid + live token
  // version). A signature-only check let stale pre-revocation sessions
  // pass the probe and then 401 on every data call, leaving the dashboard
  // in an infinite skeleton loop instead of the login screen.
  const token = req.cookies?.afrexpay_session;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const payload = verifyToken(token);
    if (!payload.uid) {
      return res.status(401).json({ error: "Session expired or invalid. Log in again." });
    }
    const current = await getUserTokenVersion(payload.uid);
    if (current === null || current !== payload.tv) {
      return res.status(401).json({ error: "Session expired or invalid. Log in again." });
    }
    res.json({ tenantId: payload.tenantId, subdomain: payload.subdomain });
  } catch {
    res.status(401).json({ error: "Session expired or invalid. Log in again." });
  }
}

const { VALID_VERTICALS, isThemeCompatible } = require("../../verticals");
const { validatePassword } = require("../../lib/password-validator");

async function signup(req, res) {
  let { businessName, subdomain, email, password, vertical, themeSlug } = req.body || {};

  if (!businessName || !subdomain || !email || !password) {
    return res.status(400).json({ error: "businessName, subdomain, email, and password are required." });
  }
  // Canonical form: login/reset match LOWER(email), so a stored
  // " Admin@X.com " would register fine and then never match again.
  // Normalize once here — every later lookup just works.
  email = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!SUBDOMAIN_RE.test(subdomain)) {
    return res.status(400).json({ error: "Subdomain must be lowercase letters, numbers, and hyphens only." });
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return res.status(400).json({ error: `"${subdomain}" is reserved. Please choose a different store address.` });
  }
  const passVal = validatePassword(password, { businessName, subdomain, email });
  if (!passVal.valid) {
    return res.status(400).json({ error: passVal.error });
  }
  if (vertical && !VALID_VERTICALS.has(vertical)) {
    return res.status(400).json({ error: `Invalid business category. Choose one of: ${[...VALID_VERTICALS].join(", ")}` });
  }
  if (vertical && themeSlug && !isThemeCompatible(vertical, themeSlug)) {
    return res.status(400).json({ error: "Selected theme is not compatible with the chosen business category." });
  }

  try {
    const tenant = await createTenantWithOwner({ businessName, subdomain, email, password, vertical, themeSlug });
    // Clears any cached "not found" for this subdomain — belt-and-braces:
    // nothing currently probes a subdomain before signup, but if a
    // "check availability" feature is ever added, this guarantees a
    // fresh signup is visible immediately regardless of a prior lookup,
    // rather than depending on the negative-cache TTL to expire first.
    invalidateTenantCache(subdomain);
    const token = issueToken({ tenantId: tenant.id, subdomain: tenant.subdomain, uid: tenant.userId, tv: tenant.tokenVersion ?? 0 });
    res
      .cookie("afrexpay_session", token, cookieOptions())
      .status(201)
      .json({ subdomain: tenant.subdomain });
  } catch (err) {
    if (err.code === "23505") {
      // unique_violation — either subdomain or email already taken
      return res.status(409).json({ error: "That subdomain or email is already in use." });
    }
    console.error("Signup failed:", err);
    res.status(500).json({ error: "Could not create the store. Try again." });
  }
}

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const session = await verifyLogin({ email: String(email).trim(), password });
  if (!session) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  // If the request arrived on a tenant subdomain (merchant's own /admin),
  // the credentials must belong to *that* tenant — not some other one.
  // On the bare base domain (extractSubdomain returns null) there's no
  // tenant to match against, so the check is skipped (signup redirect flow).
  const subdomain = extractSubdomain(req.headers.host);
  if (subdomain && session.subdomain !== subdomain) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const token = issueToken({ tenantId: session.tenantId, subdomain: session.subdomain, uid: session.userId, tv: session.tokenVersion ?? 0 });
  res
    .cookie("afrexpay_session", token, cookieOptions())
    .json({ subdomain: session.subdomain });
}

function logout(req, res) {
  const opts = cookieOptions();
  // clearCookie must use the same path/domain/sameSite/secure as the
  // original set, otherwise the browser keeps the stale cookie and the
  // session silently survives the logout.
  res.clearCookie("afrexpay_session", {
    path: opts.path,
    domain: opts.domain,
    sameSite: opts.sameSite,
    secure: opts.secure,
    httpOnly: opts.httpOnly,
  }).status(204).send();
}

async function requestPasswordReset(req, res) {
  let { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }
  email = String(email).trim();

  try {
    const rawToken = await createPasswordResetToken(email);
    if (rawToken) {
      // Always the base domain, never req.headers.host — a request made
      // from a merchant's own subdomain (the normal case, since this is
      // triggered from the admin login screen) would otherwise build a link
      // pointing at that subdomain, where there's no reset page to land on.
      const resetLink = `${req.protocol}://${BASE_DOMAIN}/reset.html?token=${rawToken}`;
      await sendResetEmail(email, resetLink);
    }
  } catch (err) {
    console.error("Password reset request failed:", err.message);
    // Still fall through to the generic response below — an internal error
    // here shouldn't reveal anything either.
  }

  // Identical response whether or not the email exists — an attacker
  // probing this endpoint learns nothing about which emails are registered.
  res.json({ message: "If that email is registered, a reset link has been sent." });
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required." });
  }
  // Same strength rules as signup — the reset page promises them in its
  // checklist, so the server must enforce them too. No identity metadata
  // (business/subdomain/email) is available here, so only the strength
  // rules apply; similarity is still enforced where metadata exists.
  const passVal = validatePassword(newPassword, {});
  if (!passVal.valid) {
    return res.status(400).json({ error: passVal.error });
  }

  const success = await resetPasswordWithToken(token, newPassword);
  if (!success) {
    return res.status(400).json({ error: "This reset link is invalid or has expired." });
  }
  res.json({ message: "Password updated. You can now log in." });
}

module.exports = { signup, login, logout, requestPasswordReset, resetPassword, sessionStatus, SUBDOMAIN_RE, EMAIL_RE, RESERVED_SUBDOMAINS, cookieOptions };
