// src/modules/payments/providers/index.js
// Explicit registry of payment providers — no dynamic loading, same
// philosophy as verticals.js and theme-server.js's whitelist.

const stripe = require("../stripe.provider");
const paypal = require("./paypal.provider");

const REGISTRY = {
  stripe,
  paypal,
};

function getProvider(id) {
  const provider = REGISTRY[id];
  if (!provider) {
    const err = new Error(`Unknown payment provider: ${id}. Available: ${Object.keys(REGISTRY).join(", ")}`);
    err.status = 400;
    throw err;
  }
  return provider;
}

function listProviders() {
  return Object.keys(REGISTRY);
}

module.exports = { getProvider, listProviders, REGISTRY };