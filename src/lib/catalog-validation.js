// src/lib/catalog-validation.js — value guards for merchant catalog writes.
//
// POST routes used to check shapes (integer, array) but not values, and
// PATCH routes forwarded req.body straight through: negative prices flowed
// into order totals and Stripe unit_amounts, bogus currencies reached the
// provider APIs, and bad listing enums died as raw PG 500s. These pure
// validators run at the route layer so every failure is a 400 with a
// human message. Unit-tested.
const { SUPPORTED_CURRENCIES } = require("./currency");
const { slugError } = require("./slug");

const LISTING_TYPES = ["sale", "rent"];
const LISTING_STATUSES = ["active", "pending", "sold", "rented", "off_market"];

function isNonNegativeInteger(n) {
  return Number.isInteger(n) && n >= 0;
}

function currencyError(currency) {
  if (currency === undefined || currency === null || currency === "") return null;
  if (!SUPPORTED_CURRENCIES.includes(String(currency).toUpperCase())) {
    return `currency must be one of: ${SUPPORTED_CURRENCIES.join(", ")}.`;
  }
  return null;
}

function priceError(priceMinor, { required }) {
  if (priceMinor === undefined || priceMinor === null || priceMinor === "") {
    return required ? "priceMinor (a whole-number price of 0 or more) is required." : null;
  }
  if (!isNonNegativeInteger(priceMinor)) {
    return "priceMinor must be a whole number of 0 or more.";
  }
  return null;
}

function optionalIntError(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (!isNonNegativeInteger(value)) return `${field} must be a whole number of 0 or more.`;
  return null;
}

function validateProduct(body, { forUpdate }) {
  const b = body || {};
  if (!forUpdate) {
    if (!b.sku || !b.name) return "sku and name are required.";
    if (!Array.isArray(b.sizes)) return "sizes (array) is required.";
  }
  if (b.active !== undefined && typeof b.active !== "boolean") {
    return "active must be a boolean (lets merchants reactivate a deactivated product).";
  }
  return (
    slugError(b.slug) ||
    priceError(b.priceMinor, { required: !forUpdate }) ||
    currencyError(b.currency) ||
    optionalIntError(b.stockQty, "stockQty")
  );
}

function validateListing(body, { forUpdate }) {
  const b = body || {};
  if (!forUpdate) {
    if (!b.title) return "title is required.";
    if (!LISTING_TYPES.includes(b.listingType)) {
      return `listingType must be one of: ${LISTING_TYPES.join(", ")}.`;
    }
  } else {
    if (b.listingType !== undefined && !LISTING_TYPES.includes(b.listingType)) {
      return `listingType must be one of: ${LISTING_TYPES.join(", ")}.`;
    }
    if (b.status !== undefined && !LISTING_STATUSES.includes(b.status)) {
      return `status must be one of: ${LISTING_STATUSES.join(", ")}.`;
    }
  }
  return (
    slugError(b.slug) ||
    priceError(b.priceMinor, { required: !forUpdate }) ||
    currencyError(b.currency) ||
    optionalIntError(b.depositAmountMinor, "depositAmountMinor") ||
    optionalIntError(b.bedrooms, "bedrooms") ||
    optionalIntError(b.bathrooms, "bathrooms") ||
    optionalIntError(b.areaSqm, "areaSqm")
  );
}

function validateService(body, { forUpdate }) {
  const b = body || {};
  if (!forUpdate && !b.name) return "name is required.";
  if (b.durationMinutes !== undefined) {
    if (!Number.isInteger(b.durationMinutes) || b.durationMinutes <= 0) {
      return "durationMinutes must be a positive whole number of minutes.";
    }
  } else if (!forUpdate) {
    return "durationMinutes (positive integer) is required.";
  }
  return (
    slugError(b.slug) ||
    priceError(b.priceMinor, { required: !forUpdate }) ||
    currencyError(b.currency)
  );
}

module.exports = {
  LISTING_TYPES, LISTING_STATUSES,
  validateProduct, validateListing, validateService,
  isNonNegativeInteger, currencyError,
};
