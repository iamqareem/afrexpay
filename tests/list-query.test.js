// tests/list-query.test.js — shared list-endpoint param parsing
// (src/lib/list-query.js) plus the status vocabularies the routes
// validate against. DB-free by design.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseListParams, searchCondition, DEFAULT_LIMIT, MAX_LIMIT } = require("../src/lib/list-query");
const { ORDER_STATUSES } = require("../src/modules/orders/order.service");
const { EXCEPTION_STATUSES } = require("../src/modules/services/availability.service");

test("defaults: no params means first page, capped limit, DESC", () => {
  assert.deepEqual(parseListParams({}), { search: null, status: null, limit: DEFAULT_LIMIT, offset: 0, dir: "DESC" });
  assert.deepEqual(parseListParams(), { search: null, status: null, limit: DEFAULT_LIMIT, offset: 0, dir: "DESC" });
});

test("limit is clamped, never below 1 or above MAX_LIMIT", () => {
  assert.equal(parseListParams({ limit: "10" }).limit, 10);
  assert.equal(parseListParams({ limit: "0" }).limit, DEFAULT_LIMIT);
  assert.equal(parseListParams({ limit: "-5" }).limit, DEFAULT_LIMIT);
  assert.equal(parseListParams({ limit: "abc" }).limit, DEFAULT_LIMIT);
  assert.equal(parseListParams({ limit: "99999" }).limit, MAX_LIMIT);
});

test("offset must be a non-negative integer", () => {
  assert.equal(parseListParams({ offset: "20" }).offset, 20);
  assert.equal(parseListParams({ offset: "-1" }).offset, 0);
  assert.equal(parseListParams({ offset: "x" }).offset, 0);
});

test("dir accepts only asc/desc, falls back to the resource default", () => {
  assert.equal(parseListParams({ dir: "asc" }).dir, "ASC");
  assert.equal(parseListParams({ dir: "ASC" }).dir, "ASC");
  assert.equal(parseListParams({ dir: "desc" }).dir, "DESC");
  assert.equal(parseListParams({ dir: "drop table" }).dir, "DESC");
  assert.equal(parseListParams({ dir: "asc" }, { defaultDir: "ASC" }).dir, "ASC");
  assert.equal(parseListParams({}, { defaultDir: "ASC" }).dir, "ASC");
});

test("search is trimmed, length-capped, null when empty", () => {
  assert.equal(parseListParams({ search: "  acme  " }).search, "acme");
  assert.equal(parseListParams({ search: "" }).search, null);
  assert.equal(parseListParams({ search: "   " }).search, null);
  assert.equal(parseListParams({ search: "x".repeat(500) }).search.length, 100);
  assert.equal(parseListParams({ search: 42 }).search, null);
});

test("status passes through untouched (routes whitelist it)", () => {
  assert.equal(parseListParams({ status: "paid" }).status, "paid");
  assert.equal(parseListParams({}).status, null);
  assert.equal(parseListParams({ status: "" }).status, null);
});

test("searchCondition binds one placeholder across columns", () => {
  const values = ["tenant-1"];
  const sql = searchCondition(values, ["customer_name", "phone"], "acme");
  assert.equal(sql, "(customer_name ILIKE $2 OR phone ILIKE $2)");
  assert.deepEqual(values, ["tenant-1", "%acme%"]);
});

test("ORDER_STATUSES mirrors the order_status Postgres enum", () => {
  assert.deepEqual([...ORDER_STATUSES].sort(), ["cancelled", "confirmed", "fulfilled", "pending"]);
});

test("EXCEPTION_STATUSES covers both exception kinds", () => {
  assert.deepEqual([...EXCEPTION_STATUSES].sort(), ["blocked", "open"]);
});
