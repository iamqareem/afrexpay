// tests/catalog-validation.test.js
//
// Merchant catalog writes: negative prices, bogus currencies and bad enums
// must fail at the route layer as 400s — never reach providers or die as
// PG 500s. Guards src/lib/catalog-validation.js.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  validateProduct, validateListing, validateService,
} = require("../src/lib/catalog-validation");

test("product create requires shape, rejects negative price and bogus currency", () => {
  assert.ok(validateProduct({}, { forUpdate: false }));
  assert.ok(validateProduct({ sku: "a", name: "b", priceMinor: 10, sizes: [] }, { forUpdate: false }) === null);
  assert.match(validateProduct({ sku: "a", name: "b", priceMinor: -5, sizes: [] }, { forUpdate: false }), /0 or more/);
  assert.match(validateProduct({ sku: "a", name: "b", priceMinor: 1.5, sizes: [] }, { forUpdate: false }), /whole number/);
  assert.match(validateProduct({ sku: "a", name: "b", priceMinor: 10, sizes: [], currency: "XXX" }, { forUpdate: false }), /currency must be one of/);
  assert.match(validateProduct({ sku: "a", name: "b", priceMinor: 10, sizes: [], stockQty: -1 }, { forUpdate: false }), /stockQty/);
});

test("product update validates only provided fields, allows reactivation", () => {
  assert.strictEqual(validateProduct({}, { forUpdate: true }), null);
  assert.strictEqual(validateProduct({ active: true }, { forUpdate: true }), null);
  assert.match(validateProduct({ active: "yes" }, { forUpdate: true }), /boolean/);
  assert.match(validateProduct({ priceMinor: -1 }, { forUpdate: true }), /0 or more/);
});

test("listing validates type, status, prices and deposit", () => {
  assert.ok(validateListing({ title: "t" }, { forUpdate: false }));
  assert.ok(validateListing({ title: "t", listingType: "zzz", priceMinor: 5 }, { forUpdate: false }));
  assert.strictEqual(validateListing({ title: "t", listingType: "sale", priceMinor: 5 }, { forUpdate: false }), null);
  assert.match(validateListing({ priceMinor: 5, status: "gone" }, { forUpdate: true }), /status must be one of/);
  assert.match(validateListing({ priceMinor: 5, listingType: "lease" }, { forUpdate: true }), /listingType/);
  assert.match(validateListing({ depositAmountMinor: -100 }, { forUpdate: true }), /depositAmountMinor/);
  for (const f of ["bedrooms", "bathrooms", "areaSqm"]) {
    assert.match(validateListing({ [f]: -1 }, { forUpdate: true }), new RegExp(f));
  }
});

test("service validates duration and price on create and patch", () => {
  assert.ok(validateService({ name: "n" }, { forUpdate: false }));
  assert.ok(validateService({ name: "n", durationMinutes: 0, priceMinor: 5 }, { forUpdate: false }));
  assert.strictEqual(validateService({ name: "n", durationMinutes: 30, priceMinor: 0 }, { forUpdate: false }), null);
  assert.match(validateService({ durationMinutes: 0 }, { forUpdate: true }), /positive/);
  assert.match(validateService({ priceMinor: -2 }, { forUpdate: true }), /0 or more/);
  assert.match(validateService({ currency: "XXX" }, { forUpdate: true }), /currency/);
});
