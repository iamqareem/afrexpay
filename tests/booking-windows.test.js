// tests/booking-windows.test.js — pure slot-window containment used by
// createBooking (src/modules/bookings/booking.service.js). Minutes are
// offsets from UTC midnight; windows are { start: "HH:MM", end: "HH:MM" }.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkSlotInWindows } = require("../src/modules/bookings/booking.service");

const DAY = [{ start: "09:00", end: "17:00" }]; // 540..1020
const SPLIT = [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }];

test("aligned slot inside window is ok", () => {
  assert.equal(checkSlotInWindows(540, 600, 60, DAY), "ok"); // 09:00-10:00
  assert.equal(checkSlotInWindows(600, 660, 60, DAY), "ok"); // 10:00-11:00
  assert.equal(checkSlotInWindows(960, 1020, 60, DAY), "ok"); // exact end edge
});

test("slot outside window is outside", () => {
  assert.equal(checkSlotInWindows(480, 540, 60, DAY), "outside"); // before open
  assert.equal(checkSlotInWindows(1020, 1080, 60, DAY), "outside"); // after close
  assert.equal(checkSlotInWindows(120, 180, 60, DAY), "outside"); // 02:00 attack
  assert.equal(checkSlotInWindows(500, 600, 60, DAY), "outside"); // straddles open
  assert.equal(checkSlotInWindows(960, 1080, 60, DAY), "outside"); // straddles close
});

test("inside but off-grid is misaligned", () => {
  assert.equal(checkSlotInWindows(555, 615, 60, DAY), "misaligned"); // 09:15
  assert.equal(checkSlotInWindows(570, 630, 60, DAY), "misaligned"); // 09:30 vs 60-min grid
});

test("30-minute grid aligns on the half hour", () => {
  assert.equal(checkSlotInWindows(570, 600, 30, DAY), "ok");
  assert.equal(checkSlotInWindows(585, 615, 30, DAY), "misaligned");
});

test("split days enforce each window independently", () => {
  assert.equal(checkSlotInWindows(540, 600, 60, SPLIT), "ok"); // morning
  assert.equal(checkSlotInWindows(840, 900, 60, SPLIT), "ok"); // afternoon
  assert.equal(checkSlotInWindows(780, 840, 60, SPLIT), "outside"); // lunch gap
  assert.equal(checkSlotInWindows(720, 840, 120, SPLIT), "outside"); // spans gap
});

test("malformed windows are skipped, not trusted", () => {
  assert.equal(checkSlotInWindows(540, 600, 60, []), "outside");
  assert.equal(checkSlotInWindows(540, 600, 60, null), "outside");
  assert.equal(checkSlotInWindows(540, 600, 60, [{ start: null, end: null }]), "outside");
  assert.equal(checkSlotInWindows(540, 600, 60, [{ start: "xx", end: "yy" }]), "outside");
  assert.equal(checkSlotInWindows(540, 600, 60, [{ start: "18:00", end: "09:00" }]), "outside"); // overnight
});

test("bad durations fail closed", () => {
  assert.equal(checkSlotInWindows(540, 600, 0, DAY), "outside");
  assert.equal(checkSlotInWindows(540, 600, -30, DAY), "outside");
  assert.equal(checkSlotInWindows(540, 600, 1.5, DAY), "outside");
});
