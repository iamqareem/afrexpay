// tests/availability.test.js — Postgres tstzrange overlap parsing used by
// slot computation (src/modules/services/availability.service.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rangesOverlap } = require("../src/modules/services/availability.service");

const RANGE = '["2026-08-01 14:00:00+00","2026-08-01 14:45:00+00")';
const D = (s) => new Date(s);

test("detects a genuine overlap", () => {
  assert.equal(rangesOverlap(RANGE, D("2026-08-01T14:30:00Z"), D("2026-08-01T15:00:00Z")), true);
  assert.equal(rangesOverlap(RANGE, D("2026-08-01T13:00:00Z"), D("2026-08-01T14:15:00Z")), true);
  assert.equal(rangesOverlap(RANGE, D("2026-08-01T14:00:00Z"), D("2026-08-01T14:45:00Z")), true);
});

test("adjacent slots do not overlap (half-open ranges)", () => {
  assert.equal(rangesOverlap(RANGE, D("2026-08-01T14:45:00Z"), D("2026-08-01T15:30:00Z")), false);
  assert.equal(rangesOverlap(RANGE, D("2026-08-01T13:00:00Z"), D("2026-08-01T14:00:00Z")), false);
});

test("distant slots and malformed input never match", () => {
  assert.equal(rangesOverlap(RANGE, D("2026-08-01T16:00:00Z"), D("2026-08-01T17:00:00Z")), false);
  assert.equal(rangesOverlap("not-a-range", D("2026-08-01T14:30:00Z"), D("2026-08-01T15:00:00Z")), false);
  assert.equal(rangesOverlap("", D("2026-08-01T14:30:00Z"), D("2026-08-01T15:00:00Z")), false);
});
