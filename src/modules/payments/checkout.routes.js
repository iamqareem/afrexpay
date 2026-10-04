// src/modules/payments/checkout.routes.js
//
// Handles PayPal checkout sessions
//
const express = require('express');
const { getDecryptedCredentials } = require('./credentials.service');
const { getProvider } = require('./providers');
const { setPayPalOrderContext } = require('./paypal-context.service');

const router = express.Router();

// Creates a PayPal checkout session
router.post('/paypal/:entityType/:entityId', async (req, res) => {
  const { entityType, entityId } = req.params;
  const { amountMinor, currency, successUrl, cancelUrl, description } = req.body;
  
  try {
    const credentials = await getDecryptedCredentials(req.tenant.id, 'paypal');
    if (!credentials || !credentials.enabled) {
      return res.status(400).json({ error: 'PayPal is not configured or enabled for this tenant.' });
    }
    
    const paypalProvider = getProvider('paypal');
    const { checkoutUrl, sessionId } = await paypalProvider.createCheckoutSession({
      clientId: credentials.publishableKey,
      clientSecret: credentials.secretKey,
      mode: credentials.mode,
      amountMinor,
      currency,
      successUrl,
      cancelUrl,
      metadata: {
        entityType,
        entityId,
        description,
      },
    });
    
    // Store the context for the PayPal order
    await setPayPalOrderContext(sessionId, entityType, req.tenant.id);
    
    res.json({ checkoutUrl });
  } catch (err) {
    console.error('Failed to create PayPal checkout session:', err);
    res.status(500).json({ error: 'Could not create PayPal checkout session.' });
  }
});

module.exports = router;