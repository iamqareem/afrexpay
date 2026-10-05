// src/modules/notify-matrix/matrix.routes.js
const express = require("express");
const authRequired = require("../../middleware/auth-required");
const { getConfig, setMatrixRoomIfUnset } = require("../store-config/config.service");
const { createOrderRoom, inviteToRoom, roomExists } = require("./matrix.service");

const router = express.Router();

// Matrix user ID spec: @localpart:server — server may be a bare
// hostname (matrix.org), localhost/dev setups (@user:localhost,
// @bot:localhost:8008, bare IPs), with an optional port. Only the shape
// is checked here; the homeserver itself rejects unknown IDs.
const MATRIX_ID_RE = /^@[^:\s]+:[^\s:]+(?::\d+)?$/;

router.post("/connect", authRequired, async (req, res) => {
  const { matrixUserId } = req.body || {};
  if (!matrixUserId || !MATRIX_ID_RE.test(matrixUserId)) {
    return res.status(400).json({ error: "Enter a valid Matrix ID, e.g. @yourname:matrix.org" });
  }

  // Stale-room recovery, tried at most once: if the stored room is gone
  // (deleted, bot kicked), the invite 404s — clear the reference and redo
  // the first-connect path instead of wedging the merchant on a dead room.
  const isUnknownRoom = (err) => /M_NOT_FOUND|not found|unknown.*room|not.*in.*room|404/i.test(err?.message || "");

  const doInvite = async (roomId) => inviteToRoom(roomId, matrixUserId);

  try {
    const { config } = await getConfig(req.tenant.id);
    let roomId = config?.matrixRoomId;

    if (roomId) {
      // Already has a room — this call is a reconnect or "invite someone else."
      try {
        await doInvite(roomId);
      } catch (err) {
        // M_NOT_FOUND is ambiguous (dead room vs bad user ID) — probe the
        // room before concluding anything. A healthy room means the USER
        // id is bad: surface that instead of minting a replacement room.
        if (!isUnknownRoom(err)) throw err;
        if (await roomExists(roomId)) throw err;
        console.error(`Matrix room ${roomId} is stale — recreating.`);
        roomId = null;
      }
    }
    if (!roomId) {
      // First time connecting (or stale room above) — create the room and
      // save it, merchant never sees or handles the room ID at all.
      const created = await createOrderRoom(`${req.tenant.business_name} orders`, matrixUserId);
      const saved = await setMatrixRoomIfUnset(req.tenant.id, created);
      roomId = saved.roomId;
      if (!saved.created && saved.roomId) {
        // Lost a concurrent first-connect race — adopt the winner's room
        // AND invite into it (the invite went to our orphaned room).
        console.error(`Matrix connect race for tenant ${req.tenant.id}: using existing room.`);
        await doInvite(saved.roomId);
      }
      if (!roomId) {
        throw new Error("Could not persist the notification room.");
      }
    }

    res.json({ connected: true, invited: matrixUserId });
  } catch (err) {
    console.error("Matrix connect failed:", err.message);
    res.status(502).json({ error: "Could not reach the notification service. Try again shortly." });
  }
});

module.exports = router;
// Exported for unit tests (the homeserver itself is the real validator).
module.exports.MATRIX_ID_RE = MATRIX_ID_RE;
