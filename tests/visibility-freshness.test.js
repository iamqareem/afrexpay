// tests/visibility-freshness.test.js
//
// Inquiries only on visible listings; reservation checkout requires an
// active listing and a fresh hold. DB-free via stubbed pool.
const { test } = require("node:test");
const assert = require("node:assert");

const pool = require("../src/db/pool");
const { encrypt } = require("../src/lib/crypto");

process.env.PAYMENT_ENCRYPTION_KEY =
  process.env.PAYMENT_ENCRYPTION_KEY || "cd".repeat(32);
const inquiryService = require("../src/modules/inquiries/inquiry.service");
const reservationService = require("../src/modules/listings/reservation.service");

test("inquiries are refused on off_market listings", async () => {
  const original = pool.query;
  pool.query = async (text) => {
    if (/FROM listings/.test(text)) {
      assert.match(text, /status != 'off_market'/, "must mirror storefront visibility");
      return { rows: [] }; // delisted
    }
    return { rows: [] };
  };
  try {
    await assert.rejects(
      () => inquiryService.createInquiry("t1", { listingId: "l1", name: "N", phone: "P" }),
      /no longer available/
    );
  } finally {
    pool.query = original;
  }
});

test("reservation checkout requires an active listing and a fresh hold", async () => {
  const seen = [];
  const original = pool.query;
  pool.query = async (text) => {
    seen.push(text);
    if (/FROM payment_credentials/.test(text)) {
      return {
        rows: [{
          secret_key_encrypted: encrypt("sk_test_123"),
          publishable_key: "pk_test_123",
          webhook_secret_encrypted: encrypt("whsec_test"),
          mode: "test",
        }],
      };
    }
    return { rows: [] };
  };
  try {
    await assert.rejects(
      () => reservationService.startCheckout("t1", "r1", {
        successUrl: "https://x.test/ok", cancelUrl: "https://x.test/no", provider: "stripe",
      }),
      /not found or already paid/
    );
    const sql = seen.find((t) => /FROM listing_reservations/.test(t));
    assert.match(sql, /l\.status = 'active'/, "delisted property must not be payable");
    assert.match(sql, /created_at > now\(\)/, "stale holds must not be payable");
  } finally {
    pool.query = original;
  }
});
