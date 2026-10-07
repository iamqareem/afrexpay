// src/modules/store-qr/store-qr.routes.js — the platform-wide store QR engine.
//
// Two faces, one resolver (src/lib/store-qr.js):
//   GET /api/store-qr  (merchant-only) — { url, svg } JSON for the dashboard
//     card: inline SVG preview, copy-link, SVG download.
//   GET /qr.svg        (public) — raw SVG bytes for every storefront footer
//     as <img src="/qr.svg">. Tenant comes from the Host header like any
//     other storefront request, so zero per-theme configuration exists.
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { storeQrSvg } = require("../../lib/store-qr");

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
  try {
    res.json(await storeQrSvg(req.tenant));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not make the store QR." });
  }
});

async function serveQrSvg(req, res) {
  try {
    const { svg } = await storeQrSvg(req.tenant);
    res.type("image/svg+xml").send(svg);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not make the store QR." });
  }
}

module.exports = { router, serveQrSvg };
