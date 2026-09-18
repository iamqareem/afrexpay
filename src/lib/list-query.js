// src/lib/list-query.js — shared, DB-free parsing for merchant list endpoints.
//
// Every list endpoint accepts ?search=&limit=&offset=&dir=; endpoints over a
// status-bearing table additionally accept ?status= (validated per-route
// against that table's real values, mirroring the booking PATCH style).
// Sort column stays fixed per resource — only the direction is user input,
// so there is no ORDER BY injection surface. LIMIT is clamped so one
// request can't dump an unbounded table.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 100;

function parseListParams(query = {}, { defaultDir = "DESC" } = {}) {
  const rawSearch = typeof query.search === "string" ? query.search.trim() : "";
  const search = rawSearch.slice(0, MAX_SEARCH_LENGTH) || null;

  let limit = Number.parseInt(query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  let offset = Number.parseInt(query.offset, 10);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  const rawDir = String(query.dir || "").toLowerCase();
  const dir = rawDir === "asc" ? "ASC" : rawDir === "desc" ? "DESC" : defaultDir;

  const status = typeof query.status === "string" && query.status ? query.status : null;

  return { search, status, limit, offset, dir };
}

// Builds a parameterized ILIKE disjunction across columns, reusing one
// placeholder. Caller owns the values array, so numbering stays correct.
// LIKE wildcards in the search itself (% _) just widen the match — the
// value is still bound, never interpolated.
function searchCondition(values, columns, search) {
  values.push(`%${search}%`);
  const ref = `$${values.length}`;
  return `(${columns.map((c) => `${c} ILIKE ${ref}`).join(" OR ")})`;
}

module.exports = { parseListParams, searchCondition, DEFAULT_LIMIT, MAX_LIMIT, MAX_SEARCH_LENGTH };
