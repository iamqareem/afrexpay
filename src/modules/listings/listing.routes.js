// src/modules/listings/listing.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listListings, createListing, updateListing, removeListing } = require("./listing.service");
const { validateListing } = require("../../lib/catalog-validation");
const { UUID_RE } = require("../../lib/validate");

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await listListings(req.tenant.id, req.query));
});

router.post("/", authRequired, async (req, res) => {
  const createErr = validateListing(req.body, { forUpdate: false });
  if (createErr) {
    return res.status(400).json({ error: createErr });
  }
  const listing = await createListing(req.tenant.id, req.body);
  res.status(201).json(listing);
});

router.patch("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Listing not found." });
  }
  const patchErr = validateListing(req.body, { forUpdate: true });
  if (patchErr) {
    return res.status(400).json({ error: patchErr });
  }
  const updated = await updateListing(req.tenant.id, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Listing not found." });
  res.json(updated);
});

router.delete("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Listing not found." });
  }
  const result = await removeListing(req.tenant.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Listing not found." });
  res.status(204).send();
});

module.exports = router;
