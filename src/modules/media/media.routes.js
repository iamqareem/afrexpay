// src/modules/media/media.routes.js
const express = require("express");
const multer = require("multer");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const authRequired = require("../../middleware/auth-required");
const { MEDIA_DIR } = require("../../middleware/media-server");
const { recordMedia, deleteMedia, setSortOrder, listMediaForEntity } = require("./media.service");
const { getProduct } = require("../products/product.service");
const { getListing } = require("../listings/listing.service");
const { getService } = require("../services/service.service");

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Which entity types media can attach to, and how to confirm the given ID
// actually belongs to the requesting tenant before linking anything to it.
// A small explicit map, not a dynamic table-name lookup — same principle as
// the theme and vertical whitelists: never let request data decide which
// table gets queried. Every vertical is treated identically here — there is
// no product-specific shortcut anywhere in this file.
const ENTITY_OWNERSHIP_CHECKS = {
  product: getProduct,
  service: getService,
  listing: getListing,
};

// SVG is deliberately excluded — it can carry an embedded <script>, which is
// a real stored-XSS vector when the file is served back same-origin. JPEG/
// PNG/WebP have no equivalent risk.
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — plenty for product photos, keeps storage/backups cheap

// Client-supplied Content-Type (multer's file.mimetype) is just a header the
// uploader's browser sent — trivial to spoof with a renamed or hand-crafted
// file. Real validation reads the actual file bytes and checks the format's
// magic number, so a file claiming to be a JPEG has to actually start like one.
const MAGIC_NUMBERS = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // "RIFF" — WebP-specific "WEBP" marker checked separately below, at byte offset 8
};

function matchesMagicNumber(buffer, mimeType) {
  const signatures = MAGIC_NUMBERS[mimeType];
  if (!signatures) return false;
  const matchesAny = signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte));
  if (!matchesAny) return false;
  if (mimeType === "image/webp") {
    return buffer.slice(8, 12).toString("ascii") === "WEBP";
  }
  return true;
}

// Extension is derived from the validated mimetype, not the attacker-
// controlled originalname — otherwise evil.html with image/webp bytes
// would be stored as .html and served as text/html same-origin (XSS).
const EXT_BY_MIME = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(MEDIA_DIR, req.tenant.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || "";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, or WebP images are allowed."));
    }
    cb(null, true);
  },
});

// Every upload requires a real entityType + entityId — there is no
// "unlinked" upload path in practice (the schema still allows it via the
// 'unassigned' CHECK value, kept only as a safety net, not a feature).
router.post("/", authRequired, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const message = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? "Image must be under 2MB."
        : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    try {
      // Verify the file's actual bytes match its claimed type before doing
      // anything else with it — the fileFilter check above only looked at
      // the client-supplied header, which proves nothing on its own.
      const fd = fs.openSync(req.file.path, "r");
      const headerBuf = Buffer.alloc(12);
      fs.readSync(fd, headerBuf, 0, 12, 0);
      fs.closeSync(fd);

      if (!matchesMagicNumber(headerBuf, req.file.mimetype)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "File content doesn't match its declared type." });
      }

      const { entityType, entityId } = req.body;
      if (!entityType || !entityId) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "entityType and entityId are required." });
      }

      const ownershipCheck = ENTITY_OWNERSHIP_CHECKS[entityType];
      if (!ownershipCheck) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: `Unknown entity type. Choose one of: ${Object.keys(ENTITY_OWNERSHIP_CHECKS).join(", ")}` });
      }
      if (!UUID_RE.test(entityId)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Invalid entity id." });
      }
      // Confirm the entity actually belongs to this tenant before linking
      // anything — otherwise a forged id from another tenant would still
      // create a media row referencing it. The entity row itself can't be
      // overwritten cross-tenant (that update is already scoped by
      // tenant_id), but the dangling reference would still be wrong data
      // worth rejecting outright.
      const entity = await ownershipCheck(req.tenant.id, entityId);
      if (!entity) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: `${entityType} not found for this store.` });
      }

      const media = await recordMedia({
        tenantId: req.tenant.id,
        entityType,
        entityId,
        storagePath: req.file.filename,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      });

      res.status(201).json({ id: media.id, filename: req.file.filename });
    } catch (dbErr) {
      try { fs.unlinkSync(req.file.path); } catch {}
      console.error("Media record failed:", dbErr);
      res.status(500).json({ error: "Upload saved but could not be recorded. Try again." });
    }
  });
});

// Merchant-only — remove a photo. Deletes the DB row and the file on disk;
// the DB delete is tenant-scoped (deleteMedia's WHERE clause), so a
// merchant can never delete another tenant's photo by guessing an id —
// the query simply returns nothing to delete for a row it doesn't own.
router.delete("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid media id." });
  }
  const deleted = await deleteMedia(req.tenant.id, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Photo not found for this store." });
  }
  const filePath = path.join(MEDIA_DIR, req.tenant.id, deleted.storage_path);
  fs.unlink(filePath, (err) => {
    // A missing file on disk shouldn't block the DB delete from succeeding
    // (it already has) — just log it, since it points at drift between the
    // DB and filesystem worth knowing about but not worth failing the
    // request over.
    if (err && err.code !== "ENOENT") console.error("Could not remove media file:", err.message);
  });
  res.status(204).send();
});

// Merchant-only — reorder photos for an entity (drag-and-drop style: send
// the full ordered list of media ids, each gets its array index as
// sort_order). Full replace rather than incremental patch, same reasoning
// as availability windows — reordering is one mental action, not N
// separate edits.
router.put("/order", authRequired, async (req, res) => {
  const { mediaIds } = req.body || {};
  if (!Array.isArray(mediaIds) || mediaIds.some((id) => !UUID_RE.test(id))) {
    return res.status(400).json({ error: "mediaIds must be an array of valid media ids." });
  }
  for (let i = 0; i < mediaIds.length; i++) {
    await setSortOrder(req.tenant.id, mediaIds[i], i);
  }
  res.json({ ok: true });
});

// Public — every storefront theme fetches an entity's photos this same way,
// whatever vertical it's for. No separate "get the product image" endpoint.
router.get("/for/:entityType/:entityId", async (req, res) => {
  const { entityType, entityId } = req.params;
  if (!UUID_RE.test(entityId)) {
    return res.status(400).json({ error: "Invalid entity id." });
  }
  res.json(await listMediaForEntity(req.tenant.id, entityType, entityId));
});

module.exports = router;
// Pure validation helpers exported for unit tests — attaching them to
// the router keeps the single-export shape route mounting relies on.
module.exports.matchesMagicNumber = matchesMagicNumber;
module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
module.exports.MAX_SIZE_BYTES = MAX_SIZE_BYTES;
