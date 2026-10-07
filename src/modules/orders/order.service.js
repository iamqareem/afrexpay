// src/modules/orders/order.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");

// Mirrors the order_status ENUM in migrations/1751500000000_initial-schema.js.
// Validated in the route (400 on anything else) so Postgres never sees a
// value outside the enum — a bad status would otherwise surface as a raw
// 500 from the CHECK/enum cast instead of a readable error.
const ORDER_STATUSES = ["pending", "confirmed", "fulfilled", "cancelled"];

// Forward-only lifecycle mirroring bookings: cancelled/fulfilled are
// terminal (no resurrection, no de-confirming a paid order). Cancelling a
// live order restores its stock — the merchant path must agree with the
// abandoned-checkout sweep, which already restores on its own cancels.
const ORDER_TRANSITIONS = {
  pending: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["fulfilled", "cancelled"]),
  fulfilled: new Set(),
  cancelled: new Set(),
};

async function createOrder(tenantId, { customerName, phone, address, deliveryNotes, items }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Re-price every line server-side against the live product row — never
    // trust a client-sent price. Locks the row so concurrent orders against
    // limited stock can't both succeed past the available quantity.
    //
    // Items are locked in a consistent order (sorted by productId) across
    // every transaction — without this, two concurrent orders touching the
    // same two products in reversed order could deadlock (order A locks X
    // then waits on Y while order B locks Y then waits on X). Postgres
    // detects and aborts one side automatically rather than hanging forever,
    // but that's still a failed order for no real reason.
    const sortedItems = [...items].sort((a, b) => String(a.productId).localeCompare(String(b.productId)));

    const resolvedItems = [];
    let totalMinor = 0;

    for (const line of sortedItems) {
      const { rows } = await client.query(
        `SELECT id, name, price_minor, currency, sizes, stock_qty
         FROM products WHERE tenant_id = $1 AND id = $2 AND active = true FOR UPDATE`,
        [tenantId, line.productId]
      );
      const product = rows[0];
      if (!product) throw Object.assign(new Error(`Unknown product: ${line.productId}`), { status: 400 });

      const qty = Number(line.qty);
      if (!Number.isInteger(qty) || qty < 1) {
        throw Object.assign(new Error(`Invalid quantity for ${product.name}.`), { status: 400 });
      }
      if (!product.sizes.includes(line.size)) {
        throw Object.assign(new Error(`Invalid size "${line.size}" for ${product.name}.`), { status: 400 });
      }
      if (product.stock_qty !== null && product.stock_qty < qty) {
        throw Object.assign(new Error(`Not enough stock for ${product.name}.`), { status: 409 });
      }

      if (product.stock_qty !== null) {
        await client.query(`UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2 AND tenant_id = $3`, [qty, product.id, tenantId]);
      }

      resolvedItems.push({
        productId: product.id,
        name: product.name,
        size: line.size,
        qty,
        unitPriceMinor: product.price_minor,
        currency: product.currency,
      });
      totalMinor += product.price_minor * qty;
    }

    // Totals are a sum in ONE currency — mixing UGX lines with USD lines
    // would record nonsense (1010 UGX for "1000 UGX + 10 USD") and charge
    // it. Reject mixed carts outright; the storefront sells per-currency.
    const currencies = new Set(resolvedItems.map((i) => i.currency));
    if (currencies.size > 1) {
      throw Object.assign(
        new Error("All items in one order must share the same currency."),
        { status: 400 }
      );
    }

    const orderResult = await client.query(
      `INSERT INTO orders (tenant_id, customer_name, phone, address, delivery_notes, total_minor, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [tenantId, customerName, phone, address, deliveryNotes || null, totalMinor, resolvedItems[0]?.currency || "UGX"]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, size, qty, unit_price_minor)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.productId, item.name, item.size, item.qty, item.unitPriceMinor]
      );
    }

    await client.query("COMMIT");
    return {
      id: orderId,
      customerName,
      phone,
      address,
      deliveryNotes: deliveryNotes || null,
      totalMinor,
      currency: resolvedItems[0]?.currency || "UGX",
      items: resolvedItems,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const { getProvider } = require("../payments/providers");
const { getDecryptedCredentials } = require("../payments/credentials.service");
const { recordCheckoutSession } = require("../payments/checkout-sessions.service");
const { flagCancelledPayment } = require("../../lib/flag-cancelled-payment");
const { buildStripeLineItems } = require("../payments/stripe-checkout-helpers");
const { savePayPalOrderContext } = require("../payments/paypal-context.service");

async function startOrderCheckout(tenantId, orderId, { successUrl, cancelUrl, provider = "stripe" }) {
  const credentials = await getDecryptedCredentials(tenantId, provider);
  if (!credentials || !credentials.secretKey) {
    throw Object.assign(new Error(`This store hasn't set up ${provider} payments yet.`), { status: 400 });
  }

  const orderResult = await pool.query(
    `SELECT * FROM orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );
  const order = orderResult.rows[0];
  if (!order) {
    throw Object.assign(new Error("Order not found."), { status: 404 });
  }
  if (order.payment_status === "paid") {
    throw Object.assign(new Error("Order is already paid."), { status: 400 });
  }
  // Same rule as bookings: a cancelled order's stock/f fulfillment is gone —
  // refuse before any provider session exists.
  if (order.status === "cancelled") {
    throw Object.assign(new Error("This order is no longer available for payment."), { status: 400 });
  }

  const itemsResult = await pool.query(
    `SELECT product_name AS "productName", unit_price_minor AS "unitPriceMinor", qty FROM order_items WHERE order_id = $1`,
    [order.id]
  );
  const lineItems = buildStripeLineItems(itemsResult.rows, order.currency);

  const paymentProvider = getProvider(provider);
  const { checkoutUrl, sessionId } = await paymentProvider.createCheckoutSession({
    ...credentials,
    lineItems,
    amountMinor: order.total_minor,
    currency: order.currency,
    successUrl,
    cancelUrl,
    metadata: {
      entityType: "order",
      entityId: order.id,
      tenantId,
      description: `Order #${order.id.slice(0, 8)}`,
    },
  });

  if (provider === "paypal") {
    await savePayPalOrderContext(sessionId, tenantId, "order", order.id);
  }

  const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
  if (!["stripe_checkout_session_id", "paypal_checkout_session_id"].includes(sessionIdField)) {
    throw Object.assign(new Error("Invalid provider session field."), { status: 400 });
  }
  await pool.query(
    `UPDATE orders SET ${sessionIdField} = $2, payment_status = 'pending' WHERE tenant_id = $3 AND id = $1`,
    [order.id, sessionId, tenantId]
  );
  // History, not just the current column: a later re-checkout overwrites
  // sessionIdField above, but the earlier provider session stays payable —
  // its webhook must still resolve (see markOrderPaid).
  await recordCheckoutSession(provider, sessionId, tenantId, "order", order.id);
  return { checkoutUrl };
}

async function markOrderPaid(tenantId, sessionId, amountMinor, currency, provider = "stripe", providerRef = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
    const { rows } = await client.query(
      `UPDATE orders SET payment_status = 'paid', status = 'confirmed'
       WHERE tenant_id = $1 AND payment_status IN ('pending', 'failed') AND status != 'cancelled'
         AND (${sessionIdField} = $2 OR id IN (
           SELECT entity_id FROM checkout_sessions
           WHERE provider = $3 AND session_id = $2 AND tenant_id = $1 AND entity_type = 'order'
         ))
       RETURNING *`,
      [tenantId, sessionId, provider]
    );
    const order = rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      await flagCancelledPayment({ tenantId, sessionId, provider, table: "orders", sessionIdField });
      return null;
    }

    // Amount guard: a webhook reporting 0 or a currency mismatch must not
    // confirm the order. Stripe amounts are authoritative; PayPal amounts
    // come from the capture resource and could be spoofed if verification
    // were bypassed. Fail closed but leave an audit trail.
    if (!amountMinor || amountMinor !== order.total_minor) {
      await client.query("ROLLBACK");
      console.error(`Order ${order.id} underpaid: expected ${order.total_minor} ${order.currency}, got ${amountMinor} ${currency}`);
      try {
        await pool.query(
          `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
           VALUES ($1, 'order', $2, $3, $4, $5, $6, 'failed')`,
          [tenantId, order.id, provider, `${providerRef || sessionId}:failed:${Date.now()}`, amountMinor || 0, currency || order.currency]
        );
      } catch {}
      return null;
    }
    if (currency && order.currency && currency.toUpperCase() !== order.currency.toUpperCase()) {
      await client.query("ROLLBACK");
      console.error(`Order ${order.id} currency mismatch: expected ${order.currency}, got ${currency}`);
      try {
        await pool.query(
          `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
           VALUES ($1, 'order', $2, $3, $4, $5, $6, 'failed')`,
          [tenantId, order.id, provider, `${providerRef || sessionId}:failed:${Date.now()}`, amountMinor || 0, currency || order.currency]
        );
      } catch {}
      return null;
    }

    const ref = providerRef || sessionId;
    await client.query(
      `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
       VALUES ($1, 'order', $2, $3, $4, $5, $6, 'succeeded')`,
      [tenantId, order.id, provider, ref, amountMinor, currency]
    );

    await client.query("COMMIT");
    return order;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return null;
    throw err;
  } finally {
    client.release();
  }
}

// Public return-page helper: lets the buyer's own confirmation screen
// verify payment against the server instead of trusting the ?paid=1 query
// param (anyone can forge a query string; only the webhook flips
// payment_status). Ids are unguessable UUIDs, tenant-scoped.
async function getOrderPaymentStatus(tenantId, orderId) {
  const { rows } = await pool.query(
    `SELECT id, status, payment_status, total_minor, currency FROM orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );
  return rows[0] || null;
}

// POS cash tender: offline money (cash, mobile money handed over) for an
// order that is still open. Same guards as the webhook path (pending-only,
// terminal states refuse, double-collect hits zero rows) plus tendered
// coverage — the ledger always records the ORDER total, never the tendered
// amount, so change handling can't drift revenue. Returns { order, changeMinor }.
async function markOrderCashPaid(tenantId, orderId, { tenderedMinor }) {
  const existing = await pool.query(
    `SELECT id, status, payment_status, total_minor FROM orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );
  const found = existing.rows[0];
  if (!found) return null;
  if (found.status === "cancelled" || found.status === "fulfilled" || found.payment_status === "paid") {
    throw Object.assign(new Error("This order can no longer be collected."), { status: 400 });
  }
  if (!Number.isInteger(tenderedMinor) || tenderedMinor < found.total_minor) {
    throw Object.assign(new Error("Tendered amount must cover the order total."), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE orders SET payment_status = 'paid', status = 'confirmed', channel = 'pos'
       WHERE tenant_id = $1 AND id = $2 AND payment_status IN ('pending', 'unpaid') AND status NOT IN ('cancelled', 'fulfilled')
       RETURNING *`,
      [tenantId, orderId]
    );
    const order = rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return null; // lost a race (double-collect, concurrent cancel)
    }
    // One cash collection per order by construction: provider_reference
    // `cash:<id>` collides on retry, and the partial UNIQUE on succeeded
    // rows turns that into a safe null via the catch below.
    await client.query(
      `INSERT INTO payments (tenant_id, entity_type, entity_id, provider, provider_reference, amount_minor, currency, status)
       VALUES ($1, 'order', $2, 'cash', $3, $4, $5, 'succeeded')`,
      [tenantId, order.id, `cash:${order.id}`, order.total_minor, order.currency]
    );
    await client.query("COMMIT");
    return { order, changeMinor: tenderedMinor - order.total_minor };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return null;
    throw err;
  } finally {
    client.release();
  }
}

// Marks a POS-originated order's channel at link/collection time. The
// webhook path never touches channel, so storefront sales keep theirs.
async function markOrderChannel(tenantId, orderId, channel) {
  if (!["storefront", "pos"].includes(channel)) {
    throw Object.assign(new Error("Unknown order channel."), { status: 400 });
  }
  const { rows } = await pool.query(
    `UPDATE orders SET channel = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, orderId, channel]
  );
  return rows[0] || null;
}

async function listOrders(tenantId, params = {}) {
  const { search, status, limit, offset, dir } = parseListParams(params);
  const conditions = [`tenant_id = $1`];
  const values = [tenantId];
  if (search) conditions.push(searchCondition(values, ["customer_name", "phone"], search));
  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT * FROM orders WHERE ${conditions.join(" AND ")} ORDER BY created_at ${dir}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

// Merchant fulfil/cancel — the only writer of orders.status outside the
// payment webhook (which moves pending -> confirmed on markOrderPaid).
// Tenant-scoped; null when the order belongs to someone else.
async function updateOrderStatus(tenantId, orderId, status) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT status FROM orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, orderId]
    );
    const current = currentResult.rows[0]?.status;
    if (!current) {
      await client.query("ROLLBACK");
      return null;
    }
    const allowed = ORDER_TRANSITIONS[current] || new Set();
    if (!allowed.has(status)) {
      await client.query("ROLLBACK");
      throw Object.assign(
        new Error(`Cannot move order from '${current}' to '${status}'.`),
        { status: 400 }
      );
    }
    const { rows } = await client.query(
      `UPDATE orders SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, orderId, status]
    );
    if (status === "cancelled") {
      // Merchant cancel restores reserved stock (untracked NULL stock
      // untouched). Aggregated per product first: one UPDATE per target
      // row, so multi-line orders restore fully (a plain join would apply
      // only one arbitrary line's qty per product).
      await client.query(
        `UPDATE products p SET stock_qty = p.stock_qty + agg.qty
         FROM (SELECT product_id, SUM(qty) AS qty FROM order_items
               WHERE order_id = $2 GROUP BY product_id) agg
         WHERE p.tenant_id = $1 AND p.id = agg.product_id AND p.stock_qty IS NOT NULL`,
        [tenantId, orderId]
      );
    }
    await client.query("COMMIT");
    return rows[0] || null;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// Abandoned-checkout sweep: cancel orders where the customer started a
// provider checkout (payment_status flipped unpaid -> pending + session id
// stored) but never completed within `olderThanMinutes`. Cash orders stay
// payment_status='unpaid' forever, so they are never touched here.
// Stock restore adds back each line's qty; untracked (NULL) stock skipped.
// Single statement, atomic: either an order is cancelled AND its stock
// restored, or neither. `db` defaults to the pool but accepts any
// { query } client so unit tests can inject a fake.
async function releaseAbandonedOrders(db = pool, { olderThanMinutes = 1440 } = {}) {
  const mins = Number(olderThanMinutes);
  if (!Number.isFinite(mins) || mins <= 0) {
    throw Object.assign(new Error("olderThanMinutes must be a positive number."), { status: 400 });
  }
  const { rows } = await db.query(
    `WITH cancelled AS (
       UPDATE orders SET status = 'cancelled'
       WHERE status = 'pending' AND payment_status = 'pending'
         AND created_at < now() - make_interval(mins => $1)
       RETURNING id
     ),
     restored AS (
       UPDATE products p SET stock_qty = p.stock_qty + oi.qty
       FROM order_items oi JOIN cancelled c ON c.id = oi.order_id
       WHERE p.id = oi.product_id AND p.stock_qty IS NOT NULL
       RETURNING p.id
     )
     SELECT (SELECT count(*)::int FROM cancelled) AS cancelled,
            (SELECT count(*)::int FROM restored) AS restored`,
    [mins]
  );
  return rows[0];
}

module.exports = { createOrder, listOrders, getOrderPaymentStatus, startOrderCheckout, markOrderPaid, markOrderCashPaid, markOrderChannel, updateOrderStatus, releaseAbandonedOrders, ORDER_STATUSES };
