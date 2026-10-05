// tests/input-validation.test.js
//
// Malformed ids/dates/times must become 400s at the route layer, never raw
// Postgres errors (500s). Guards the shared validators in src/lib/validate.js.
const { test } = require("node:test");
const assert = require("node:assert");
const { UUID_RE, isValidDate, isValidTime, isEndAfterStart, isDayOfWeek } = require("../src/lib/validate");

test("UUID_RE accepts v4-shaped ids, rejects the rest", () => {
  assert.ok(UUID_RE.test("123e4567-e89b-12d3-a456-426614174000"));
  for (const bad of ["", "not-a-uuid", "123", "order-1", "123e4567-e89b-12d3-a456-42661417400Z"]) {
    assert.ok(!UUID_RE.test(bad), bad);
  }
});

test("isValidDate accepts real calendar dates only", () => {
  assert.ok(isValidDate("2026-10-04"));
  assert.ok(isValidDate("2024-02-29")); // leap year
  for (const bad of ["", "2026-2-4", "04/10/2026", "2026-13-01", "2026-02-30", "2023-02-29", "2026-00-10", null, 123]) {
    assert.ok(!isValidDate(bad), String(bad));
  }
});

test("isValidTime accepts HH:MM around the clock", () => {
  assert.ok(isValidTime("00:00"));
  assert.ok(isValidTime("09:30"));
  assert.ok(isValidTime("23:59"));
  for (const bad of ["", "9:30", "24:00", "12:60", "ab:cd", "12:30:00", null]) {
    assert.ok(!isValidTime(bad), String(bad));
  }
});

test("isEndAfterStart compares clock order, isDayOfWeek needs integers 0-6", () => {
  assert.ok(isEndAfterStart("09:00", "17:00"));
  assert.ok(!isEndAfterStart("17:00", "09:00"));
  assert.ok(!isEndAfterStart("09:00", "09:00"));
  assert.ok(isDayOfWeek(0) && isDayOfWeek(6));
  assert.ok(!isDayOfWeek(2.5) && !isDayOfWeek(7) && !isDayOfWeek(-1) && !isDayOfWeek("3"));
});
