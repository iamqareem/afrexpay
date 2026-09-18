// src/modules/notify-matrix/matrix.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { getConfig, updateConfig } = require("../store-config/config.service");
const { createOrderRoom, inviteToRoom } = require("./matrix.service");

const router = express.Router();

// Matrix user ID spec: @localpart:domain — kept permissive since server
// names vary widely, this just catches obviously malformed input.
const MATRIX_ID_RE = /^@[^:\s]+:[^\s]+\.[^\s]+$/;

router.post("/connect", authRequired, async (req, res) => {
  const { matrixUserId } = req.body || {};
  if (!matrixUserId || !MATRIX_ID_RE.test(matrixUserId)) {
    return res.status(400).json({ error: "Enter a valid Matrix ID, e.g. @yourname:matrix.org" });
  }

  try {
    const { config } = await getConfig(req.tenant.id);
    let roomId = config?.matrixRoomId;

    if (roomId) {
      // Already has a room — this call is a reconnect or "invite someone else."
      await inviteToRoom(roomId, matrixUserId);
    } else {
      // First time connecting — create the room and save it, merchant never
      // sees or handles the room ID at all.
      roomId = await createOrderRoom(`${req.tenant.business_name} orders`, matrixUserId);
      await updateConfig(req.tenant.id, { matrixRoomId: roomId });
    }

    res.json({ connected: true, invited: matrixUserId });
  } catch (err) {
    console.error("Matrix connect failed:", err.message);
    res.status(502).json({ error: "Could not reach the notification service. Try again shortly." });
  }
});

module.exports = router;
