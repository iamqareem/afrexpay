// app.js — vanilla JS, no framework. Talks to /api/config, /api/products, /api/orders
// on whatever subdomain this theme is being served under.

const state = {
  config: null,
  products: [],
  cart: [], // { productId, name, size, qty, priceMinor }
  lastOrderId: null, // the just-placed order — used by the pay-now button
};

const money = (n) => `${state.config?.currency || "UGX"} ${n.toLocaleString("en-UG")}`;

function applyConfig(config) {
  state.config = config;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text ?? ""; };

  set("page-title", `${config.storeName || ""} ${config.storeNameAccent || ""}`.trim() || "Storefront");
  set("brand-name", config.storeName);
  set("brand-accent", config.storeNameAccent);
  set("tagline", config.tagline);
  set("hero-line1", config.heroTitleLine1);
  set("hero-line2", config.heroTitleLine2);
  set("hero-subtitle", config.heroSubtitle);
  set("footer-text", config.footerText);

  if (config.accentColor) document.documentElement.style.setProperty("--accent", config.accentColor);
  if (config.accentColor2) document.documentElement.style.setProperty("--accent2", config.accentColor2);
}

async function renderProducts() {
  const grid = document.getElementById("product-grid");
  document.getElementById("product-count").textContent = `${state.products.length} PIECES`;

  // One photo lookup per product, in parallel — same pattern used by the
  // booking-slots and listing-grid themes. There is no image_path column on
  // products anymore; every vertical fetches its photos the same way.
  const photosByProduct = await Promise.all(
    state.products.map((p) =>
      fetch(`/api/media/for/product/${p.id}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((photos) => photos[0]?.storage_path || null)
        .catch(() => null)
    )
  );

  grid.innerHTML = state.products
    .map((p, i) => {
      const photo = photosByProduct[i];
      const img = photo ? `/media/${photo}` : null;
      return `
    <div class="tag-card">
      <div class="tag-hole"></div>
      ${img ? `<img src="${img}" alt="${p.name}" class="w-full aspect-square object-cover" />` : `<div class="w-full aspect-square bg-surface2"></div>`}
      <div class="tag-perf px-4 pt-4 pb-3">
        ${p.category ? `<p class="font-mono text-[10px] tracking-widest2 text-muted uppercase">${p.category}</p>` : ""}
        <h3 class="font-display text-base tracking-tightest text-paper mt-1">${p.name}</h3>
        ${p.blurb ? `<p class="text-muted text-xs mt-1">${p.blurb}</p>` : ""}
      </div>
      <div class="px-4 pb-4 mt-auto">
        <div class="flex items-center justify-between mb-3">
          <span class="font-mono text-gold font-bold">${money(p.price_minor)}</span>
        </div>
        <select data-size-for="${p.id}" class="w-full bg-ink border border-surface2 rounded-sm px-2 py-2 text-sm text-paper mb-2 focus:outline-none focus:border-gold">
          ${p.sizes.map((s) => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <button data-add="${p.id}" class="w-full bg-surface2 hover:bg-gold hover:text-ink text-paper font-bold text-sm py-2 rounded-sm transition-colors">
          ADD TO CART
        </button>
      </div>
    </div>`;
    })
    .join("");

  grid.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add");
      const sizeSelect = grid.querySelector(`[data-size-for="${id}"]`);
      addToCart(id, sizeSelect.value);
    });
  });
}

function addToCart(productId, size) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  const existing = state.cart.find((i) => i.productId === productId && i.size === size);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({ productId: product.id, name: product.name, size, qty: 1, priceMinor: product.price_minor });
  }
  renderCart();
  openCart();
}

function removeFromCart(index) {
  state.cart.splice(index, 1);
  renderCart();
}

function changeQty(index, delta) {
  const item = state.cart[index];
  item.qty += delta;
  if (item.qty <= 0) state.cart.splice(index, 1);
  renderCart();
}

function cartTotal() {
  return state.cart.reduce((sum, i) => sum + i.priceMinor * i.qty, 0);
}

function renderCart() {
  const container = document.getElementById("cart-items");
  const countEl = document.getElementById("cart-count");
  const totalEl = document.getElementById("cart-total");
  const checkoutBtn = document.getElementById("checkout-open");

  const totalQty = state.cart.reduce((sum, i) => sum + i.qty, 0);
  countEl.textContent = totalQty;
  totalEl.textContent = money(cartTotal());
  checkoutBtn.disabled = state.cart.length === 0;

  if (state.cart.length === 0) {
    container.innerHTML = `<p class="text-muted text-center py-10">Your cart is empty.</p>`;
    return;
  }

  container.innerHTML = state.cart
    .map(
      (item, index) => `
    <div class="flex items-start justify-between gap-3 pb-3 border-b border-dashed border-surface2">
      <div class="flex-1">
        <p class="text-paper">${item.name}</p>
        <p class="text-muted text-xs">SIZE ${item.size}</p>
        <div class="flex items-center gap-2 mt-2">
          <button data-qty-down="${index}" class="w-6 h-6 border border-surface2 rounded-sm hover:border-gold">-</button>
          <span>${item.qty}</span>
          <button data-qty-up="${index}" class="w-6 h-6 border border-surface2 rounded-sm hover:border-gold">+</button>
          <button data-remove="${index}" class="ml-auto text-brick hover:underline text-xs">remove</button>
        </div>
      </div>
      <span class="text-gold whitespace-nowrap">${money(item.priceMinor * item.qty)}</span>
    </div>`
    )
    .join("");

  container.querySelectorAll("[data-qty-up]").forEach((btn) =>
    btn.addEventListener("click", () => changeQty(Number(btn.getAttribute("data-qty-up")), 1))
  );
  container.querySelectorAll("[data-qty-down]").forEach((btn) =>
    btn.addEventListener("click", () => changeQty(Number(btn.getAttribute("data-qty-down")), -1))
  );
  container.querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", () => removeFromCart(Number(btn.getAttribute("data-remove"))))
  );
}

function openCart() {
  document.getElementById("cart-overlay").classList.remove("hidden");
  document.getElementById("cart-drawer").classList.remove("translate-x-full");
}
function closeCart() {
  document.getElementById("cart-overlay").classList.add("hidden");
  document.getElementById("cart-drawer").classList.add("translate-x-full");
}
function openCheckout() {
  document.getElementById("checkout-overlay").classList.remove("hidden");
  document.getElementById("checkout-overlay").classList.add("flex");
}
function closeCheckout() {
  document.getElementById("checkout-overlay").classList.add("hidden");
  document.getElementById("checkout-overlay").classList.remove("flex");
}
function openConfirm(orderId, paid) {
  state.lastOrderId = orderId;
  document.getElementById("confirm-id").textContent = orderId.slice(0, 8);
  // Purely a UX confirmation — the order's real payment_status is set
  // server-side by the Stripe webhook, never by this client-side redirect.
  document.getElementById("confirm-paid").classList.toggle("hidden", !paid);
  document.getElementById("pay-now").classList.toggle("hidden", !!paid);
  document.getElementById("pay-error").classList.add("hidden");
  document.getElementById("confirm-overlay").classList.remove("hidden");
  document.getElementById("confirm-overlay").classList.add("flex");
}
function closeConfirm() {
  document.getElementById("confirm-overlay").classList.add("hidden");
  document.getElementById("confirm-overlay").classList.remove("flex");
}

async function handleCheckoutSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("checkout-error");
  const submitBtn = document.getElementById("checkout-submit");
  errorEl.classList.add("hidden");

  const payload = {
    customerName: form.customerName.value.trim(),
    phone: form.phone.value.trim(),
    address: form.address.value.trim(),
    deliveryNotes: form.deliveryNotes.value.trim(),
    items: state.cart.map((i) => ({ productId: i.productId, size: i.size, qty: i.qty })),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "PLACING ORDER...";

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    state.cart = [];
    renderCart();
    form.reset();
    closeCheckout();
    closeCart();
    openConfirm(data.id, false);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "PLACE ORDER";
  }
}

// Starts a Stripe Checkout session for the just-placed order and hands
// the browser to Stripe's hosted page. Same additive pattern as the
// listing-grid deposit flow: the cash order already exists and stays
// valid — this only adds an optional card payment on top of it.
async function handlePayNow() {
  const orderId = state.lastOrderId;
  if (!orderId) return;
  const payBtn = document.getElementById("pay-now");
  const errorEl = document.getElementById("pay-error");
  errorEl.classList.add("hidden");
  payBtn.disabled = true;
  payBtn.textContent = "REDIRECTING TO STRIPE...";

  try {
    // Round-trip back to this same storefront after Stripe's hosted
    // checkout — the order id in the query string reopens the confirm
    // overlay with a banner. The order's actual payment_status is only
    // ever set by the webhook, server-side — this redirect is just UX
    // feedback, never the source of truth for whether payment succeeded.
    const returnUrl = new URL(window.location.href);
    returnUrl.search = "";
    returnUrl.searchParams.set("order", orderId);
    const successUrl = new URL(returnUrl); successUrl.searchParams.set("paid", "1");
    const cancelUrl = returnUrl.toString();

    const res = await fetch(`/api/orders/${orderId}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ successUrl: successUrl.toString(), cancelUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not start checkout.");

    window.location.href = data.checkoutUrl;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    payBtn.disabled = false;
    payBtn.textContent = "PAY NOW WITH CARD";
  }
}

async function init() {
  const configRes = await fetch("/api/config");
  const { config } = await configRes.json();
  applyConfig(config || {});

  const res = await fetch("/api/products");
  state.products = await res.json();
  await renderProducts();
  renderCart();

  document.getElementById("cart-open").addEventListener("click", openCart);
  document.getElementById("cart-close").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", closeCart);
  document.getElementById("checkout-open").addEventListener("click", openCheckout);
  document.getElementById("checkout-close").addEventListener("click", closeCheckout);
  document.getElementById("checkout-form").addEventListener("submit", handleCheckoutSubmit);
  document.getElementById("pay-now").addEventListener("click", handlePayNow);
  document.getElementById("confirm-close").addEventListener("click", closeConfirm);

  // If Stripe redirected back here (successUrl/cancelUrl both point at
  // this same page with an `order` param), reopen the confirm overlay —
  // with the paid banner when `paid=1` is present.
  const params = new URLSearchParams(window.location.search);
  const returnOrderId = params.get("order");
  if (returnOrderId) {
    openConfirm(returnOrderId, params.get("paid") === "1");
  }
}

init();
