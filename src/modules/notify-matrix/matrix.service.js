// src/modules/notify-matrix/matrix.service.js
//
// Pushes a message into a merchant's Matrix room whenever an order lands.
// Uses the plain Matrix Client-Server HTTP API — no matrix-js-sdk needed,
// this is one PUT request. Point MATRIX_HOMESERVER_URL at your Synapse
// instance (e.g. http://localhost:8008) and MATRIX_ACCESS_TOKEN at a bot
// account's access token that has already joined every merchant's order
// room. This module doesn't handle joining rooms or account setup — that's
// a one-time step done outside the app (see README).
const crypto = require("node:crypto");

const HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL || "http://localhost:8008";
const ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN;
const REQUEST_TIMEOUT_MS = 8000;

// Wraps fetch with a hard timeout — without this, a hung or unreachable
// homeserver leaves the caller waiting indefinitely. That's just a leaked
// background promise for order notifications (fire-and-forget), but for
// /api/matrix/connect it's awaited directly in the request handler, so a
// hung homeserver would hang that HTTP response open forever.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Matrix homeserver did not respond within ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function money(minor, currency) {
  return `${currency || "UGX"} ${Number(minor).toLocaleString("en-UG")}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Builds both a plain-text body (required by the spec, shows up in
// notifications/clients that don't render HTML) and a formatted HTML body
// (renders nicely in Element and similar clients).
function formatOrderMessage(storeName, order) {
  const itemLines = order.items
    .map((i) => `  • ${i.qty}× ${i.product_name || i.name} (${i.size}) — ${money(i.unit_price_minor ?? i.unitPriceMinor, order.currency)}`)
    .join("\n");

  const text = [
    `New order — ${storeName || "your store"}`,
    `Order #${String(order.id).slice(0, 8)}`,
    `Customer: ${order.customer_name || order.customerName}`,
    `Phone: ${order.phone}`,
    `Address: ${order.address}`,
    order.delivery_notes || order.deliveryNotes ? `Notes: ${order.delivery_notes || order.deliveryNotes}` : null,
    "",
    itemLines,
    "",
    `Total: ${money(order.total_minor ?? order.totalMinor, order.currency)}`,
  ].filter(Boolean).join("\n");

  const html = [
    `<p><strong>New order — ${escapeHtml(storeName || "your store")}</strong></p>`,
    `<p>Order #${escapeHtml(String(order.id).slice(0, 8))}<br/>`,
    `Customer: ${escapeHtml(order.customer_name || order.customerName)}<br/>`,
    `Phone: ${escapeHtml(order.phone)}<br/>`,
    `Address: ${escapeHtml(order.address)}`,
    order.delivery_notes || order.deliveryNotes ? `<br/>Notes: ${escapeHtml(order.delivery_notes || order.deliveryNotes)}` : "",
    `</p>`,
    `<ul>${order.items.map((i) => `<li>${escapeHtml(i.qty)}× ${escapeHtml(i.product_name || i.name)} (${escapeHtml(i.size)}) — ${escapeHtml(money(i.unit_price_minor ?? i.unitPriceMinor, order.currency))}</li>`).join("")}</ul>`,
    `<p><strong>Total: ${escapeHtml(money(order.total_minor ?? order.totalMinor, order.currency))}</strong></p>`,
  ].join("");

  return { text, html };
}

async function sendMessage(roomId, { text, html }) {
  if (!ACCESS_TOKEN) {
    throw new Error("MATRIX_ACCESS_TOKEN is not set — skipping Matrix notification.");
  }
  const txnId = crypto.randomUUID();
  const url = `${HOMESERVER_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`;

  const res = await fetchWithTimeout(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      msgtype: "m.text",
      body: text,
      format: "org.matrix.custom.html",
      formatted_body: html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Matrix send failed: ${res.status} ${body}`);
  }
  return res.json();
}

// Fire-and-forget from the caller's perspective — logs failures instead of
// throwing, since a Matrix outage should never block or fail an order.
async function notifyNewOrder(roomId, storeName, order) {
  if (!roomId) return; // merchant hasn't set up a room yet — nothing to do
  try {
    await sendMessage(roomId, formatOrderMessage(storeName, order));
  } catch (err) {
    console.error("Matrix order notification failed:", err.message);
  }
}

async function matrixRequest(method, path, body) {
  if (!ACCESS_TOKEN) {
    throw new Error("MATRIX_ACCESS_TOKEN is not set.");
  }
  const res = await fetchWithTimeout(`${HOMESERVER_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Matrix request failed: ${res.status}`);
  }
  return data;
}

// Creates a private room for a merchant's orders and invites their Matrix ID
// in one call. Called once, the first time a merchant connects notifications
// — after this, their room_id is saved and reused.
async function createOrderRoom(roomName, matrixUserId) {
  const data = await matrixRequest("POST", "/_matrix/client/v3/createRoom", {
    name: roomName,
    preset: "trusted_private_chat",
    invite: [matrixUserId],
  });
  return data.room_id;
}

// Invites an additional (or replacement) Matrix ID into an existing order
// room — used when a merchant already has a room but wants to reconnect
// with a different account, or add a second person (e.g. staff).
async function inviteToRoom(roomId, matrixUserId) {
  await matrixRequest("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
    user_id: matrixUserId,
  });
}

module.exports = { notifyNewOrder, sendMessage, formatOrderMessage, createOrderRoom, inviteToRoom };
