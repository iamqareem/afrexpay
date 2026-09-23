// app.js — vanilla JS, no framework. Talks to /api/config, /api/products, /api/orders
// on whatever subdomain this theme is being served under.
// Souk: fragrance (attar, oud, musk, sprays) + modest attire (thobe, abaya,
// hijab). Category chips filter the grid by product.category.

const state = {
  config: null,
  products: [],
  cart: [], // { productId, name, size, qty, priceMinor }
  lastOrderId: null, // the just-placed order — used by the pay-now button
  activeCategory: "All",
};

const money = (n) => `${state.config?.currency || "UGX"} ${n.toLocaleString("en-UG")}`;

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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

function visibleProducts() {
  if (state.activeCategory === "All") return state.products;
  return state.products.filter((p) => (p.category || "Uncategorized") === state.activeCategory);
}

function renderCategoryChips() {
  const container = document.getElementById("category-chips");
  const cats = ["All", ...new Set(state.products.map((p) => p.category || "Uncategorized"))];
  if (!cats.includes(state.activeCategory)) state.activeCategory = "All";
  container.innerHTML = cats
    .map((c) => `<button class="souk-chip${c === state.activeCategory ? " active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join("");
  container.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeCategory = btn.getAttribute("data-cat");
      renderCategoryChips();
      renderProducts();
    });
  });
}

async function renderProducts() {
  const grid = document.getElementById("product-grid");
  const items = visibleProducts();
  document.getElementById("product-count").textContent = `${items.length} PIECE${items.length === 1 ? "" : "S"}`;

  // One photo lookup per product, in parallel — same pattern used by the
  // other product themes. There is no image_path column on products;
  // every vertical fetches its photos the same way.
  const photosByProduct = await Promise.all(
    items.map((p) =>
      fetch(`/api/media/for/product/${p.id}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((photos) => photos[0]?.storage_path || null)
        .catch(() => null)
    )
  );

  if (items.length === 0) {
    grid.innerHTML = `<p class="text-muted text-center py-10 col-span-full">Nothing here yet — check back soon.</p>`;
    return;
  }

  grid.innerHTML = items
    .map((p, i) => {
      const photo = photosByProduct[i];
      const img = photo ? `/media/${photo}` : null;
      return `
    <div class="souk-card">
      ${img ? `<img src="${img}" alt="${esc(p.name)}" class="w-full aspect-[4/5] object-cover" />` : `<div class="w-full aspect-[4/5] bg-surface2"></div>`}
      <div class="px-5 pt-4 pb-3">
        ${p.category ? `<p class="font-mono text-[10px] tracking-widest2 text-gold uppercase">${esc(p.category)}</p>` : ""}
        <h3 class="font-display text-xl tracking-tightest text-paper mt-1">${esc(p.name)}</h3>
        ${p.blurb ? `<p class="text-muted text-sm mt-1">${esc(p.blurb)}</p>` : ""}
        ${p.stock_qty !== null && p.stock_qty !== undefined ? `<p class="font-mono text-[11px] text-muted mt-2">${p.stock_qty > 0 ? `IN STOCK · ${p.stock_qty}` : "OUT OF STOCK"}</p>` : ""}
      </div>
      <div class="px-5 pb-5 mt-auto">
        <div class="flex items-center justify-between mb-3">
          <span class="font-mono text-gold font-bold text-lg">${money(p.price_minor)}</span>
        </div>
        <select data-size-for="${p.id}" aria-label="Size for ${esc(p.name)}" class="w-full bg-ink border border-surface2 rounded-full px-3 py-2 text-sm text-paper mb-2 focus:outline-none focus:border-gold">
          ${p.sizes.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}
        </select>
        <button data-add="${p.id}" class="w-full bg-surface2 hover:bg-gold hover:text-ink text-paper font-bold text-sm py-2.5 rounded-full transition-colors">
          ADD TO BASKET
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
    container.innerHTML = `<p class="text-muted text-center py-10">Your basket is empty.</p>`;
    return;
  }

  container.innerHTML = state.cart
    .map(
      (item, index) => `
    <div class="flex items-start justify-between gap-3 pb-3 border-b border-dashed border-surface2">
      <div class="flex-1">
        <p class="text-paper">${esc(item.name)}</p>
        <p class="text-muted text-xs">${esc(item.size)}</p>
        <div class="flex items-center gap-2 mt-2">
          <button data-qty-down="${index}" aria-label="Decrease quantity" class="w-6 h-6 border border-surface2 rounded-full hover:border-gold">-</button>
          <span>${item.qty}</span>
          <button data-qty-up="${index}" aria-label="Increase quantity" class="w-6 h-6 border border-surface2 rounded-full hover:border-gold">+</button>
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
  // server-side by the webhook, never by this client-side redirect.
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
// other product themes: the cash order already exists and stays
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
  renderCategoryChips();
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
