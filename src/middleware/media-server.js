// src/middleware/media-server.js
// Product photos live in data/media/<tenant_id>/<filename>, mounted from the
// host at ./data/media (see docker-compose.yml). This scopes every request
// to the resolved tenant's own folder so one tenant can never reference
// another's files by guessing an ID.
const express = require("express");
const path = require("node:path");

const MEDIA_DIR = path.join(__dirname, "..", "..", "data", "media");

const handlerCache = new Map();

function getHandler(tenantId) {
  if (handlerCache.has(tenantId)) return handlerCache.get(tenantId);
  const handler = express.static(path.join(MEDIA_DIR, tenantId));
  handlerCache.set(tenantId, handler);
  return handler;
}

function serveMedia(req, res, next) {
  getHandler(req.tenant.id)(req, res, next);
}

module.exports = { serveMedia, MEDIA_DIR };
