// src/modules/payments/stripe.provider.js
//
// One provider, one file, one consistent interface — createCheckoutSession
// and verifyWebhook. When PayPal is added, paypal.provider.js implements
// the same two functions and a small registry (like verticals.js /
// theme-server.js's whitelist) picks between them by tenant config. Not a
// dynamic plugin loader — two known providers, explicit.
//
// Deliberately uses Stripe's hosted Checkout (redirect flow), not Stripe
// Elements embedded in our own page. Checkout means card data never
// touches this server or this codebase at all — the browser goes to a
// page Stripe hosts and controls. That keeps this platform out of PCI
// SAQ D territory entirely; that scope boundary is load-bearing, not a
// style preference — building a raw card-number form here would be a real
// compliance mistake, not just extra work.
const Stripe = require("stripe");

function client(secretKey) {
  return new Stripe(secretKey);
}

async function createCheckoutSession({ secretKey, lineItems, amountMinor, currency, successUrl, cancelUrl, metadata }) {
  const stripe = client(secretKey);
  const items = lineItems || [
    {
      price_data: {
        currency: (currency || "usd").toLowerCase(),
        product_data: { name: metadata?.description || "Payment" },
        unit_amount: amountMinor,
      },
      quantity: 1,
    },
  ];

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: items,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
  });
  return { checkoutUrl: session.url, sessionId: session.id };
}

// Verifies the raw request body against this tenant's own webhook signing
// secret. Throws on any mismatch — the caller must treat a thrown error as
// "reject this request," never as "process it anyway."
function verifyWebhook({ payload, signature, webhookSecret }) {
  // A fresh Stripe client with no real key works fine here — webhook
  // signature verification is a static crypto check, it doesn't call the
  // Stripe API or need a valid account key at all.
  const stripe = client("sk_dummy_not_used_for_webhook_verification");
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

module.exports = { createCheckoutSession, verifyWebhook };
