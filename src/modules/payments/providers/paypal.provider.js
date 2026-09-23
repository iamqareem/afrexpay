// src/modules/payments/providers/paypal.provider.js
// PayPal Checkout provider — redirect flow (hosted checkout), same
// PCI boundary as Stripe: card data never touches this server.
// Uses @paypal/checkout-server-sdk (PayPal's official Node SDK).
const paypal = require("@paypal/checkout-server-sdk");
const crypto = require("node:crypto");

// ISO 4217 zero-decimal currencies (currencies where 1 unit is not subdivided by 100)
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"
]);

function client(clientId, clientSecret, mode = "sandbox") {
  const environment = mode === "live"
    ? new paypal.core.LiveEnvironment(clientId, clientSecret)
    : new paypal.core.SandboxEnvironment(clientId, clientSecret);
  return new paypal.core.PayPalHttpClient(environment);
}

function money(minor, currency = "USD") {
  const code = (currency || "USD").toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) {
    return String(Math.round(minor || 0));
  }
  return ((minor || 0) / 100).toFixed(2);
}

// Create a PayPal Checkout order and return the approval URL + order ID.
// The buyer is redirected to the approval URL, completes payment on PayPal,
// then returns to our successUrl (or cancelUrl).
async function createCheckoutSession({
  clientId,
  clientSecret,
  lineItems,
  amountMinor,
  currency = "USD",
  successUrl,
  cancelUrl,
  metadata,
  mode = "sandbox",
}) {
  const paypalClient = client(clientId, clientSecret, mode);
  const currCode = (currency || "USD").toUpperCase();

  let totalAmountValue;
  if (amountMinor !== undefined && amountMinor !== null) {
    totalAmountValue = money(amountMinor, currCode);
  } else if (Array.isArray(lineItems) && lineItems.length > 0) {
    const sumMinor = lineItems.reduce((acc, item) => {
      const price = item.unit_amount?.value ? parseFloat(item.unit_amount.value) * 100 : (item.price_data?.unit_amount || 0);
      const qty = item.quantity || 1;
      return acc + (price * qty);
    }, 0);
    totalAmountValue = money(sumMinor, currCode);
  } else {
    totalAmountValue = "0.00";
  }

  const purchaseUnit = {
    amount: {
      currency_code: currCode,
      value: totalAmountValue,
    },
    description: metadata?.description || "Payment",
  };

  if (metadata?.entityId) {
    purchaseUnit.custom_id = String(metadata.entityId);
  }

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [purchaseUnit],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: successUrl,
          cancel_url: cancelUrl,
          brand_name: metadata?.brandName || "afrexpay",
          locale: "en-US",
          landing_page: "LOGIN",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      },
    },
  });

  const order = await paypalClient.execute(request);

  const approveLink = order.result.links.find((l) => l.rel === "approve");
  if (!approveLink) {
    throw new Error("PayPal order created but no approval link returned.");
  }

  return {
    checkoutUrl: approveLink.href,
    sessionId: order.result.id,
  };
}

// Capture a PayPal order after the buyer returns from approval.
async function captureOrder({ clientId, clientSecret, orderId, mode = "sandbox" }) {
  const paypalClient = client(clientId, clientSecret, mode);
  const request = new paypal.orders.OrdersCaptureRequest(orderId);
  request.requestBody({});
  return await paypalClient.execute(request);
}

// Verify a PayPal webhook notification via PayPal's verify API.
// Production hardening: fetches a PayPal access token with the tenant's
// own client credentials and calls POST /v1/notifications/verify-webhook-signature
// with the raw transmission headers + webhook_id (stored as webhookSecret).
// Structure-only fallback is rejected — a forged POST without a valid
// PayPal signature must never mark an order paid.
async function verifyWebhook({ payload, headers, webhookSecret, clientId, clientSecret, mode = "sandbox" }) {
  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const certUrl = headers["paypal-cert-url"];
  const transmissionSig = headers["paypal-transmission-sig"];
  const authAlgo = headers["paypal-auth-algo"];

  if (!transmissionId || !transmissionTime || !certUrl || !transmissionSig || !authAlgo) {
    throw new Error("Missing PayPal webhook transmission headers.");
  }
  if (!webhookSecret) throw new Error("PayPal webhook ID not configured.");
  if (!clientId || !clientSecret) throw new Error("PayPal client credentials not configured for webhook verification.");

  let event;
  try {
    event = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    throw new Error("Invalid webhook payload: not JSON.");
  }

  if (!event.id || !event.event_type || !event.resource) {
    throw new Error("Invalid PayPal webhook event structure.");
  }

  const base = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  // 1) OAuth — client_credentials
  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`PayPal OAuth failed: ${tokenRes.status} ${body.slice(0, 200)}`);
  }
  const { access_token } = await tokenRes.json();
  if (!access_token) throw new Error("PayPal OAuth did not return access_token.");

  // 2) Verify signature
  const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: webhookSecret,
      webhook_event: event,
    }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    throw new Error(`PayPal verify call failed: ${verifyRes.status} ${body.slice(0, 200)}`);
  }
  const result = await verifyRes.json();
  if (result.verification_status !== "SUCCESS") {
    throw new Error(`PayPal webhook verification failed: ${result.verification_status}`);
  }

  return event;
}

// Normalize PayPal capture/completion event to our common shape.
function normalizePayment(event) {
  const resource = event.resource || {};

  let orderId = null;
  let captureId = null;

  if (event.event_type && event.event_type.startsWith("CHECKOUT.ORDER.")) {
    orderId = resource.id;
    captureId = resource.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;
  } else if (event.event_type && event.event_type.startsWith("PAYMENT.CAPTURE.")) {
    captureId = resource.id;
    orderId = resource.supplementary_data?.related_ids?.order_id || null;
  }

  if (!orderId) orderId = resource.id || event.id;
  if (!captureId) captureId = orderId;

  // CHECKOUT.ORDER events carry amount in purchase_units[0].amount, not resource.amount
  let amountObj = resource.amount || resource.seller_payable_breakdown?.gross_amount || null;
  if (!amountObj && resource.purchase_units?.[0]?.amount) {
    amountObj = resource.purchase_units[0].amount;
  }
  if (!amountObj) amountObj = {};
  const amountValue = amountObj.value || "0";
  const currency = (amountObj.currency_code || "USD").toUpperCase();
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);

  const amountMinor = isZeroDecimal
    ? Math.round(parseFloat(amountValue))
    : Math.round(parseFloat(amountValue) * 100);

  return {
    orderId,
    captureId,
    providerRef: captureId,
    amountMinor,
    currency,
    entityType: "order", // default, will be overridden by context lookup
  };
}

module.exports = {
  createCheckoutSession,
  captureOrder,
  verifyWebhook,
  normalizePayment,
  money,
  ZERO_DECIMAL_CURRENCIES,
};