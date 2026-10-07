// src/lib/mailer.js — shared SMTP delivery over the platform's own
// credentials (.env SMTP_*). Nodemailer only; no provider SDKs.
//
// One lazy transporter per send (email volume is tiny; this keeps tests
// hermetic and always picks up the current env). reset-email.js keeps its
// API and delegates here — new callers (POS pay-links) use sendMail or a
// dedicated composer below.
const nodemailer = require("nodemailer");

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function buildTransporter() {
  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

let transportOverride = null;
// Test hook (internal): bypass SMTP in the suite.
function setMailTransportForTests(fn) {
  transportOverride = fn || null;
}

async function sendMail({ to, subject, text, html }) {
  if (!to) throw Object.assign(new Error("Recipient email is required."), { status: 400 });
  const send = transportOverride
    ? transportOverride
    : async (msg) => buildTransporter().sendMail(msg);
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return send({ from, to, subject, text, html });
}

// POS card tender: the pay link for one specific order. Delivery failure
// throws (502 at the route) — the merchant must know the link didn't go
// out, never assume it did.
async function sendCheckoutLinkEmail({ to, storeName, orderId, amountText, checkoutUrl }) {
  if (!smtpConfigured() && !transportOverride) {
    throw Object.assign(new Error("Email is not configured on this store."), { status: 502 });
  }
  const shortId = String(orderId).slice(0, 8);
  const text =
    `Hi from ${storeName || "your store"} — complete your payment of ${amountText} here:\n${checkoutUrl}\n\n` +
    `Order #${shortId}. If you didn't expect this, just ignore it.`;
  const html =
    `<p>Hi from ${storeName || "your store"} — complete your payment of <strong>${amountText}</strong> here:</p>` +
    `<p><a href="${checkoutUrl}">Pay now</a></p>` +
    `<p>Order #${shortId}. If you didn't expect this, just ignore it.</p>`;
  return sendMail({ to, subject: `Complete your payment (order #${shortId})`, text, html });
}

module.exports = { sendMail, sendCheckoutLinkEmail, setMailTransportForTests, smtpConfigured };
