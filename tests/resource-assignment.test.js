// tests/resource-assignment.test.js — pure auto-assign picker used by
// createBooking (src/modules/services/resource.service.js). No DB.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pickFreeResource } = require("../src/modules/services/resource.service");

test("picks first linked id not in the busy set", () => {
  assert.equal(pickFreeResource(["a", "b"], []), "a");
  assert.equal(pickFreeResource(["a", "b"], ["a"]), "b");
});

test("returns null when everything is busy", () => {
  assert.equal(pickFreeResource(["a", "b"], ["a", "b"]), null);
  assert.equal(pickFreeResource(["a"], ["a", "b", "c"]), null);
});

test("handles empty, null, and mixed-type inputs without throwing", () => {
  assert.equal(pickFreeResource([], []), null);
  assert.equal(pickFreeResource(null, null), null);
  assert.equal(pickFreeResource(undefined, undefined), null);
  // UUID strings vs objects coerce via String() on both sides.
  assert.equal(pickFreeResource(["a", "b"], [{}]), "a");
});

test("busy ids outside the linked set are ignored", () => {
  assert.equal(pickFreeResource(["a"], ["zzz"]), "a");
});
