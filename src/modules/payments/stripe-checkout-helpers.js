// src/modules/payments/stripe-checkout-helpers.js
// Helpers for building Stripe Checkout line items across Products, Services, and Listings

function buildStripeLineItems(payload, currency = "USD") {
  const curr = String(currency).toLowerCase();

  if (Array.isArray(payload)) {
    return payload.map((item) => ({
      price_data: {
        currency: curr,
        product_data: {
          name: item.productName || item.name || "Product Item",
        },
        unit_amount: Math.round(Number(item.unitPriceMinor || item.priceMinor || 0)),
      },
      quantity: Number(item.qty || 1),
    }));
  }

  const name = payload.serviceName || payload.listingTitle || payload.name || "Service / Holding Fee";
  const amount = Math.round(Number(payload.priceMinor || payload.depositAmountMinor || payload.amountMinor || 0));

  return [
    {
      price_data: {
        currency: curr,
        product_data: {
          name,
        },
        unit_amount: amount,
      },
      quantity: 1,
    },
  ];
}

function handlePaymentMetadata(entityType, entityId) {
  return {
    entityType: String(entityType),
    entityId: String(entityId),
  };
}

module.exports = {
  buildStripeLineItems,
  handlePaymentMetadata,
};
