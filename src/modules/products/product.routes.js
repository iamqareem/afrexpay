// src/modules/products/product.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listProducts, getProductBySlug, createProduct, updateProduct, deactivateProduct } = require("./product.service");
const { validateProduct } = require("../../lib/catalog-validation");
const { UUID_RE } = require("../../lib/validate");
const { isValidSlug } = require("../../lib/slug");

const router = express.Router();

router.get("/", async (req, res) => {
  const products = await listProducts(req.tenant.id, req.query);
  res.json(products);
});

// Public detail for crawlable /p/:slug storefront URLs. Fixed "slug"
// segment (not GET /:id): a future "fetch one product" GET /:id would
// otherwise swallow /slug/<anything> depending on registration order.
router.get("/slug/:slug", async (req, res) => {
  if (!isValidSlug(req.params.slug)) return res.status(404).json({ error: "Product not found." });
  const product = await getProductBySlug(req.tenant.id, req.params.slug);
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json(product);
});

router.post("/", authRequired, async (req, res) => {
  const err = validateProduct(req.body, { forUpdate: false });
  if (err) {
    return res.status(400).json({ error: err });
  }
  try {
    const product = await createProduct(req.tenant.id, req.body);
    res.status(201).json(product);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: `SKU "${sku}" already exists for this store.` });
    }
    console.error("Create product failed:", err);
    res.status(500).json({ error: "Could not create product." });
  }
});

router.patch("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Product not found." });
  }
  const err = validateProduct(req.body, { forUpdate: true });
  if (err) {
    return res.status(400).json({ error: err });
  }
  const updated = await updateProduct(req.tenant.id, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Product not found." });
  res.json(updated);
});

router.delete("/:id", authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Product not found." });
  }
  const result = await deactivateProduct(req.tenant.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Product not found." });
  res.status(204).send();
});

module.exports = router;
