// src/modules/products/product.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { listProducts, createProduct, updateProduct, deactivateProduct } = require("./product.service");

const router = express.Router();

router.get("/", async (req, res) => {
  const products = await listProducts(req.tenant.id, req.query);
  res.json(products);
});

router.post("/", authRequired, async (req, res) => {
  const { sku, name, priceMinor, sizes } = req.body || {};
  if (!sku || !name || !Number.isInteger(priceMinor) || !Array.isArray(sizes)) {
    return res.status(400).json({ error: "sku, name, priceMinor (integer), and sizes (array) are required." });
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
  const updated = await updateProduct(req.tenant.id, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Product not found." });
  res.json(updated);
});

router.delete("/:id", authRequired, async (req, res) => {
  const result = await deactivateProduct(req.tenant.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Product not found." });
  res.status(204).send();
});

module.exports = router;
