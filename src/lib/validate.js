// src/lib/validate.js — shared input validators so malformed values become
// 400s at the route layer instead of raw Postgres errors (500s) one layer
// down. Pure functions, unit-tested.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isValidDate(str) {
  if (typeof str !== "string") return false;
  const m = DATE_RE.exec(str);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // Calendar-real check (rejects 2026-02-30): round-trip through UTC.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function isValidTime(str) {
  return typeof str === "string" && TIME_RE.test(str);
}

// "09:30" -> 570. Non-string inputs return false (never throw) so
// malformed values stay 400s instead of becoming TypeErrors (500s).
function isEndAfterStart(startTime, endTime) {
  if (!isValidTime(startTime) || !isValidTime(endTime)) return false;
  const toMin = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return toMin(endTime) > toMin(startTime);
}

function isDayOfWeek(n) {
  return Number.isInteger(n) && n >= 0 && n <= 6;
}

// Pragmatic address format (not RFC-complete on purpose): catches typos
// and junk like "foo" while never rejecting a real address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = { UUID_RE, EMAIL_RE, isValidDate, isValidTime, isEndAfterStart, isDayOfWeek };
