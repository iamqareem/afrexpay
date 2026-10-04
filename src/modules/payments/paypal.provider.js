// src/modules/payments/paypal.provider.js
//
// PayPal provider implementation
//
const paypal = require('@paypal/checkout-server-sdk');

// Helper function to create a PayPal client
function client(clientId, clientSecret, mode) {
  const environment = mode === 'sandbox' ? new paypal.core.SandboxEnvironment(clientId, clientSecret) : new paypal.core.LiveEnvironment(clientId, clientSecret);
  return new paypal.core.PayPalHttpClient(environment);
}

// Creates a PayPal checkout session
async function createCheckoutSession({ clientId, clientSecret, mode, lineItems, amountMinor, currency, successUrl, cancelUrl, metadata }) {
  const paypalClient = client(clientId, clientSecret, mode);
  
  const request = new paypal.orders.OrdersCreateRequest();
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: (currency || 'USD').toUpperCase(),
        value: (amountMinor / 100).toFixed(2),
      },
      description: metadata?.description || 'Payment',
      custom_id: metadata?.entityId,
    }],
    application_context: {
      return_url: successUrl,
      cancel_url: cancelUrl,
    },
  });
  
  const response = await paypalClient.execute(request);
  return {
    checkoutUrl: response.result.links.find(link => link.rel === 'approve').href,
    sessionId: response.result.id,
  };
}

// Verifies the PayPal webhook signature
async function verifyWebhook({ payload, headers, webhookSecret, clientId, clientSecret, mode }) {
  const paypalClient = client(clientId, clientSecret, mode);
  
  const request = new paypal.notifications.WebhooksEventVerifyRequest();
  request.requestBody({
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookSecret,
    webhook_event: payload,
  });
  
  const response = await paypalClient.execute(request);
  if (response.result.verification_status !== 'SUCCESS') {
    throw new Error('Invalid PayPal webhook signature');
  }
  
  return JSON.parse(payload);
}

// Normalizes PayPal payment event to a common format
function normalizePayment(event) {
  const purchaseUnit = event.resource.purchase_units[0];
  const amount = purchaseUnit.amount;
  
  return {
    orderId: event.resource.id,
    captureId: event.resource.purchase_units[0].payments.captures[0].id,
    providerRef: event.resource.purchase_units[0].payments.captures[0].id,
    amountMinor: Math.round(parseFloat(amount.value) * 100),
    currency: amount.currency_code,
  };
}

module.exports = { createCheckoutSession, verifyWebhook, normalizePayment };