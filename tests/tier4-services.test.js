// tests/tier4-services.test.js
//
// Tier-4 service contracts: resource delete bound, atomic media reorder,
// conditional Matrix room write. DB-free via stubbed pool.
const { test } = require("node:test");
const assert = require("node:assert");

const pool = require("../src/db/pool");
const resourceService = require("../src/modules/services/resource.service");
const mediaService = require("../src/modules/media/media.service");
const configService = require("../src/modules/store-config/config.service");
const matrixRoutes = require("../src/modules/notify-matrix/matrix.routes");

test("MATRIX_ID_RE accepts standard, localhost, IP and port forms", () => {
  const { MATRIX_ID_RE } = matrixRoutes;
  for (const good of ["@user:matrix.org", "@user:localhost", "@bot:localhost:8008", "@a:192.168.1.5", "@a:host:443"]) {
    assert.ok(MATRIX_ID_RE.test(good), good);
  }
  for (const bad of ["", "user:matrix.org", "@user", "@user:", "@:matrix.org", "@user:exa mple.com"]) {
    assert.ok(!MATRIX_ID_RE.test(bad), JSON.stringify(bad));
  }
});

test("deleteResource blocks only live (pending/confirmed) bookings, not history", async () => {
  const calls = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text, values) => {
      calls.push({ text, values });
      if (/FROM resources WHERE tenant_id/.test(text) && /service_id FROM/.test(text)) {
        return { rows: [{ service_id: "svc-1" }] };
      }
      if (/FROM bookings/.test(text)) {
        assert.match(text, /status IN \('pending', 'confirmed'\)/, "must count live bookings only");
        return { rows: [{ n: 1 }] }; // blocked
      }
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    await assert.rejects(() => resourceService.deleteResource("t1", "r1"), /upcoming bookings/);
  } finally {
    pool.connect = originalConnect;
  }
});

test("deleteResource allows delete when only completed history references the resource", async () => {
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (text) => {
      if (/FROM resources WHERE tenant_id/.test(text) && /service_id FROM/.test(text)) {
        return { rows: [{ service_id: "svc-1" }] };
      }
      if (/FROM bookings/.test(text)) return { rows: [{ n: 0 }] };
      if (/FROM resources/.test(text) && /siblings|id !=/.test(text)) return { rows: [{ n: 1 }] };
      if (/^DELETE FROM resources/.test(text.trim())) return { rows: [] };
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(text.trim())) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    const result = await resourceService.deleteResource("t1", "r1");
    assert.deepStrictEqual(result, { id: "r1" });
  } finally {
    pool.connect = originalConnect;
  }
});

test("setSortOrders reorders atomically in one statement", async () => {
  const seen = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    seen.push({ text, values });
    return { rows: [{ id: "m1" }, { id: "m2" }] };
  };
  try {
    const matched = await mediaService.setSortOrders("t1", ["m1", "m2"]);
    assert.deepStrictEqual(matched, ["m1", "m2"]);
    assert.strictEqual(seen.length, 1, "must be a single statement, not N updates");
    assert.match(seen[0].text, /unnest\(\$2::uuid\[\]\) WITH ORDINALITY/);
    assert.match(seen[0].text, /RETURNING/);
    assert.deepStrictEqual(seen[0].values, ["t1", ["m1", "m2"]]);
  } finally {
    pool.query = original;
  }
});

test("setMatrixRoomIfUnset writes only when no room is stored", async () => {
  const seen = [];
  const original = pool.query;
  pool.query = async (text, values) => {
    seen.push({ text, values });
    if (/matrixRoomId' IS NULL/.test(text)) return { rows: [] }; // lost the race
    if (/FROM store_configs/.test(text)) {
      return { rows: [{ config: { matrixRoomId: "winner-room" } }] };
    }
    return { rows: [] };
  };
  try {
    const result = await configService.setMatrixRoomIfUnset("t1", "orphan-room");
    assert.strictEqual(result.created, false);
    assert.strictEqual(result.roomId, "winner-room");
    assert.ok(seen.some((c) => /jsonb_set\(config, '\{matrixRoomId\}'/.test(c.text)));
  } finally {
    pool.query = original;
  }
});
