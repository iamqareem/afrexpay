// tests/self-regressions.test.js
//
// Guards the self-found regressions: webhook registry lookup, custom_domain
// on both resolution paths, completed-guard, transition locking, strict
// reservation amounts, Matrix upsert + room probe.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const pool = require("../src/db/pool");
// matrix.service snapshots MATRIX_ACCESS_TOKEN at require time.
process.env.MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN || "test-token";
const bookingService = require("../src/modules/bookings/booking.service");
const reservationService = require("../src/modules/listings/reservation.service");
const configService = require("../src/modules/store-config/config.service");
const matrixService = require("../src/modules/notify-matrix/matrix.service");

function src(relative) {
  return fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
}

test("webhook resolves providers via the registry, never property access", () => {
  const webhook = src("src/modules/payments/webhook.routes.js");
  assert.ok(!webhook.includes('require("./providers")['), "dangling registry property access must be gone");
  assert.ok(webhook.includes("getProvider(provider)"), "must use the registry lookup");
  // And the lookup actually resolves both providers.
  const { getProvider } = require("../src/modules/payments/providers");
  assert.ok(getProvider("stripe") && getProvider("paypal"));
});

test("both tenant resolution paths select custom_domain", () => {
  const resolver = src("src/middleware/tenant-resolver.js");
  // fetchTenant (subdomain path) and fetchTenantByCustomDomain must both
  // project t.custom_domain — tenantHosts()/origin checks key off it.
  const hits = resolver.match(/SELECT t\.id, t\.subdomain, t\.business_name, t\.status, t\.custom_domain,/g) || [];
  assert.strictEqual(hits.length, 2, `expected 2 selects projecting custom_domain, found ${hits.length}`);
});

test("markBookingPaid refuses completed bookings too", async () => {
  const seen = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text, values) => {
      seen.push({ text, values });
      if (/^\s*BEGIN|^\s*ROLLBACK/i.test(text)) return { rows: [] };
      if (/UPDATE bookings SET payment_status/.test(text)) {
        assert.match(text, /status NOT IN \('cancelled', 'completed'\)/);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  });
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    assert.strictEqual(await bookingService.markBookingPaid("t1", "s", 100, "UGX", "stripe"), null);
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  }
});

test("updateBookingStatus locks the row across read-check-write", async () => {
  const seen = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text) => {
      seen.push(text);
      if (/FOR UPDATE/.test(text)) return { rows: [{ status: "pending" }] };
      if (/UPDATE bookings SET status/.test(text)) return { rows: [{ id: "b1", status: "confirmed" }] };
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    const updated = await bookingService.updateBookingStatus("t1", "b1", "confirmed");
    assert.strictEqual(updated.status, "confirmed");
    assert.ok(seen.some((t) => /FOR UPDATE/.test(t)), "must lock before checking");
    assert.ok(seen.some((t) => /^\s*COMMIT/i.test(t)), "must commit");
  } finally {
    pool.connect = originalConnect;
  }
});

test("reservation with NULL snapshot deposit fails closed (never paid)", async () => {
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text) => {
      if (/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/i.test(text)) return { rows: [] };
      if (/UPDATE listing_reservations SET payment_status/.test(text)) {
        return { rows: [{ id: "r1", listing_id: "l1", name: "N", phone: "P", deposit_amount_minor: null, currency: "UGX" }] };
      }
      if (/INSERT INTO payments/.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  });
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    // Any positive amount vs a NULL snapshot must NOT confirm.
    assert.strictEqual(await reservationService.markReservationPaid("t1", "s", 5000, "UGX", "stripe"), null);
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  }
});

test("setMatrixRoomIfUnset is a true upsert with conditional update", async () => {
  const seen = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    seen.push({ text, values });
    return { rows: [{ matrixRoomId: "room-1" }] };
  };
  try {
    const result = await configService.setMatrixRoomIfUnset("t1", "room-1");
    assert.deepStrictEqual(result, { roomId: "room-1", created: true });
    const sql = seen[0].text;
    assert.match(sql, /INSERT INTO store_configs/, "must create rowless tenants");
    assert.match(sql, /ON CONFLICT \(tenant_id\) DO UPDATE/, "must not clobber on conflict");
    assert.match(sql, /matrixRoomId' IS NULL/, "must only fill unset rooms");
  } finally {
    pool.query = original;
  }
});

test("roomExists distinguishes gone rooms from flaky networks", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({}) });
    assert.strictEqual(await matrixService.roomExists("!exists:host"), true);

    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ errcode: "M_NOT_FOUND" }) });
    assert.strictEqual(await matrixService.roomExists("!gone:host"), false);

    global.fetch = async () => { throw new Error("socket hang up"); };
    assert.strictEqual(await matrixService.roomExists("!x:host"), true, "flaky network must fail open");
  } finally {
    global.fetch = originalFetch;
  }
});
