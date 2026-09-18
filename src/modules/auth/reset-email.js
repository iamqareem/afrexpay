// src/modules/auth/reset-email.js
// Pluggable delivery for password reset links: real SMTP if configured,
// otherwise the link is logged to the console — makes local dev and testing
// workable without needing mail credentials set up on day one.
const nodemailer = require("nodemailer");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

let transporter = null;
if (SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

async function sendResetEmail(toEmail, resetLink) {
  if (!transporter) {
    console.log(`\n[DEV MODE — no SMTP configured] Password reset link for ${toEmail}:\n  ${resetLink}\n`);
    return;
  }

  await transporter.sendMail({
    from: SMTP_FROM,
    to: toEmail,
    subject: "Reset your afrexpay password",
    text: `Reset your password: ${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p>Reset your password: <a href="${resetLink}">${resetLink}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
  });
}

module.exports = { sendResetEmail };
