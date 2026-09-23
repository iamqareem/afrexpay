// src/modules/orders/order.service.js
const pool = require("../../db/pool");
const { parseListParams, searchCondition } = require("../../lib/list-query");

// Mirrors the order_status ENUM in migrations/1751500000000_initial-schema.js.
// Validated in the route (400 on anything else) so Postgres never sees a
// value outside the enum — a bad status would otherwise surface as a raw
// 500 from the CHECK/enum cast instead of a readable error.
const ORDER_STATUSES = ["pending", "confirmed", "fulfilled", "cancelled"];

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
        await client.query(`UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2`, [qty, product.id]);
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
  return { checkoutUrl };
}

async function markOrderPaid(tenantId, sessionId, amountMinor, currency, provider = "stripe", providerRef = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sessionIdField = provider === "paypal" ? "paypal_checkout_session_id" : "stripe_checkout_session_id";
    const { rows } = await client.query(
      `UPDATE orders SET payment_status = 'paid', status = 'confirmed'
       WHERE tenant_id = $1 AND ${sessionIdField} = $2
       RETURNING *`,
      [tenantId, sessionId]
    );
    const order = rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return null;
    }

    // Amount guard: a webhook reporting 0 or a currency mismatch must not
    // confirm the order. Stripe amounts are authoritative; PayPal amounts
    // come from the capture resource and could be spoofed if verification
    // were bypassed. Fail closed.
    if (!amountMinor || amountMinor < order.total_minor) {
      await client.query("ROLLBACK");
      console.error(`Order ${order.id} underpaid: expected ${order.total_minor} ${order.currency}, got ${amountMinor} ${currency}`);
      return null;
    }
    if (currency && order.currency && currency.toUpperCase() !== order.currency.toUpperCase()) {
      await client.query("ROLLBACK");
      console.error(`Order ${order.id} currency mismatch: expected ${order.currency}, got ${currency}`);
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
  const { rows } = await pool.query(
    `UPDATE orders SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, orderId, status]
  );
  return rows[0] || null;
}

module.exports = { createOrder, listOrders, startOrderCheckout, markOrderPaid, updateOrderStatus, ORDER_STATUSES };
