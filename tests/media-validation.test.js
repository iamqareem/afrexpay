// tests/media-validation.test.js — upload magic-byte checks + limits.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesMagicNumber, ALLOWED_TYPES, MAX_SIZE_BYTES } = require("../src/modules/media/media.routes");

function buf(bytes) {
  return Buffer.from(bytes);
}

test("JPEG must start with the FF D8 FF magic bytes", () => {
  assert.equal(matchesMagicNumber(buf([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), "image/jpeg"), true);
  assert.equal(matchesMagicNumber(buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), "image/jpeg"), false);
});

test("PNG must carry the full 8-byte signature", () => {
  assert.equal(
    matchesMagicNumber(buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), "image/png"),
    true
  );
  assert.equal(matchesMagicNumber(buf([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "image/png"), false);
});

test("WebP needs RIFF plus the WEBP marker at offset 8", () => {
  const good = Buffer.concat([Buffer.from("RIFF"), Buffer.from([10, 0, 0, 0]), Buffer.from("WEBP")]);
  assert.equal(matchesMagicNumber(good, "image/webp"), true);
  const fake = Buffer.concat([Buffer.from("RIFF"), Buffer.from([10, 0, 0, 0]), Buffer.from("XXXX")]);
  assert.equal(matchesMagicNumber(fake, "image/webp"), false);
});

test("unknown mime types never match", () => {
  const any = buf([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(matchesMagicNumber(any, "image/svg+xml"), false);
  assert.equal(matchesMagicNumber(any, "image/gif"), false);
});

test("allowlist is JPEG/PNG/WebP only with a 2MB cap", () => {
  assert.ok(ALLOWED_TYPES.has("image/jpeg"));
  assert.ok(ALLOWED_TYPES.has("image/png"));
  assert.ok(ALLOWED_TYPES.has("image/webp"));
  assert.ok(!ALLOWED_TYPES.has("image/svg+xml"));
  assert.ok(!ALLOWED_TYPES.has("image/gif"));
  assert.equal(MAX_SIZE_BYTES, 2 * 1024 * 1024);
});
