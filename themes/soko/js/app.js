// soko — vanilla marketplace: Shop / Search / Bag / Track.
// Talks to /api/config, /api/products, /api/orders on this host.
// Conventions (post-bounty rules): esc() on every merchant string,
// per-row currency via money(), paid state ONLY from GET /:id/status.

const state = {
  config: null,
  products: [],
  photos: {}, // productId -> [storage_path]
  view: "shop",
  category: "",
  cart: [], // { productId, name, size, qty, priceMinor, currency }
  detailId: null,
  detailSize: "",
  detailQty: 1,
  lastOrderId: null,
  wishlist: new Set(),
};

// Zero-decimal mirror of src/lib/currency.js — keep in sync.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
function money(minor, currency) {
  const code = String(currency || "UGX").toUpperCase();
  if (ZERO_DECIMAL.has(code)) return `${code} ${Number(minor).toLocaleString("en-UG")}`;
  return `${code} ${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function $(id) { return document.getElementById(id); }

// ---------- shell ----------

function applyConfig(config) {
  state.config = config || {};
  document.title = `${config.storeName || ""} ${config.storeNameAccent || ""}`.trim() || "Soko";
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text ?? ""; };
  set("page-title", document.title);
  set("brand-name", config.storeName);
  set("brand-accent", config.storeNameAccent);
  set("footer-text", config.footerText);
  if (config.accentColor) document.documentElement.style.setProperty("--money", config.accentColor);
}

function showView(name) {
  state.view = name;
  for (const v of ["shop", "search", "cart", "track"]) {
    $("view-" + v).classList.toggle("hidden", v !== name);
  }
  document.querySelectorAll(".tabbtn").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === name));
  window.scrollTo({ top: 0 });
}

// ---------- catalog ----------

function coverOf(p) {
  const photos = state.photos[p.id] || [];
  return photos[0] || null;
}

function categories() {
  const cats = new Set();
  for (const p of state.products) if (p.category) cats.add(p.category);
  return [...cats].sort();
}

function matches(p, q, cat) {
  if (cat && p.category !== cat) return false;
  if (!q) return true;
  const hay = `${p.name || ""} ${p.category || ""} ${p.sku || ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function stockBadge(p) {
  if (p.stock_qty === null || p.stock_qty === undefined) return "";
  if (p.stock_qty <= 0) return `<span class="stock">Out of stock</span>`;
  if (p.stock_qty <= 5) return `<span class="stock">Only ${p.stock_qty} left</span>`;
  return "";
}

function cardHtml(p) {
  const cover = coverOf(p);
  const loved = state.wishlist.has(p.id) ? " loved" : "";
  return `
  <article class="pcard" data-id="${p.id}">
    <div class="ph">${cover
      ? `<img src="/media/${cover}" alt="${esc(p.name)}" loading="lazy" onerror="this.style.display='none'" />`
      : `<span class="ph-fallback">${esc((p.name || "?").slice(0, 1).toUpperCase())}</span>`}</div>
    <div class="pad">
      <div class="wishrow">
        <h3>${esc(p.name)}</h3>
        <button class="heart${loved}" data-wish="${p.id}" aria-label="Save to wishlist">♥</button>
      </div>
      <span class="price">${esc(money(p.price_minor, p.currency))}</span>
      ${stockBadge(p)}
      <button class="mini-add" data-add="${p.id}" ${p.stock_qty === 0 ? "disabled" : ""}>Add to bag</button>
    </div>
  </article>`;
}

function bindCards(root) {
  root.querySelectorAll("[data-add]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      quickAdd(btn.getAttribute("data-add"));
    }));
  root.querySelectorAll("[data-wish]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleWish(btn.getAttribute("data-wish"));
    }));
  root.querySelectorAll(".pcard").forEach((card) =>
    card.addEventListener("click", () => openDetail(card.dataset.id)));
}

function renderFeed() {
  const q = $("shop-search").value.trim();
  const list = state.products.filter((p) => matches(p, q, state.category));
  const feed = $("feed");
  feed.innerHTML = list.map(cardHtml).join("");
  $("feed-empty").classList.toggle("hidden", list.length > 0);
  bindCards(feed);
}

function renderChips() {
  const row = $("chip-row");
  const cats = categories();
  row.innerHTML =
    `<button data-cat="" class="${!state.category ? "on" : ""}">All</button>` +
    cats.map((c) => `<button data-cat="${esc(c)}" class="${state.category === c ? "on" : ""}">${esc(c)}</button>`).join("");
  row.querySelectorAll("[data-cat]").forEach((b) =>
    b.addEventListener("click", () => {
      state.category = b.getAttribute("data-cat");
      renderChips();
      renderFeed();
    }));
}

function renderSearchResults(q) {
  const box = $("search-results");
  if (!q.trim()) {
    box.innerHTML = "";
    return;
  }
  rememberSearch(q.trim());
  const list = state.products.filter((p) => matches(p, q, ""));
  box.innerHTML = list.map(cardHtml).join("");
  bindCards(box);
}

// ---------- wishlist (device-local, no accounts) ----------

function loadWishlist() {
  try {
    state.wishlist = new Set(JSON.parse(localStorage.getItem("soko-wish") || "[]"));
  } catch { state.wishlist = new Set(); }
}

function toggleWish(id) {
  if (state.wishlist.has(id)) state.wishlist.delete(id);
  else state.wishlist.add(id);
  try { localStorage.setItem("soko-wish", JSON.stringify([...state.wishlist])); } catch {}
  renderFeed();
  renderSearchResults($("big-search").value);
}

// ---------- detail sheet ----------

function openDetail(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  state.detailId = id;
  state.detailSize = (p.sizes || [])[0] || "";
  state.detailQty = 1;
  const photos = state.photos[id] || [];
  $("sheet-body").innerHTML = `
    <img class="cover" src="${photos[0] ? `/media/${photos[0]}` : ""}" alt="${esc(p.name)}" onerror="this.style.display='none'" />
    <h2>${esc(p.name)}</h2>
    <p class="price">${esc(money(p.price_minor, p.currency))}</p>
    ${stockBadge(p)}
    ${p.blurb ? `<p class="muted">${esc(p.blurb)}</p>` : ""}
    <div class="stack">
      <label>Size
        <select id="detail-size">${(p.sizes || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select>
      </label>
      <label>Qty
        <select id="detail-qty">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select>
      </label>
      <p id="detail-error" class="error hidden"></p>
      <button id="detail-add" class="cta" ${p.stock_qty === 0 ? "disabled" : ""}>Add to bag</button>
    </div>`;
  $("sheet-overlay").classList.remove("hidden");
  $("sheet").classList.remove("hidden");
  $("sheet-close").onclick = closeDetail;
  $("sheet-overlay").onclick = closeDetail;
  $("detail-add").onclick = () => {
    const err = $("detail-error");
    const size = $("detail-size") ? $("detail-size").value : "";
    const qty = Number($("detail-qty") ? $("detail-qty").value : 1) || 1;
    if (p.stock_qty !== null && p.stock_qty !== undefined && qty > p.stock_qty) {
      err.textContent = `Only ${p.stock_qty} in stock.`;
      err.classList.remove("hidden");
      return;
    }
    addToBag(p, size, qty);
    closeDetail();
    showView("cart");
  };
}

function closeDetail() {
  $("sheet").classList.add("hidden");
  $("sheet-overlay").classList.add("hidden");
}

// ---------- bag ----------

function loadBag() {
  try {
    state.cart = JSON.parse(localStorage.getItem("soko-bag") || "[]");
    if (!Array.isArray(state.cart)) state.cart = [];
  } catch { state.cart = []; }
}

function saveBag() {
  try { localStorage.setItem("soko-bag", JSON.stringify(state.cart)); } catch {}
  paintBadge();
}

function paintBadge() {
  const n = state.cart.reduce((a, i) => a + i.qty, 0);
  const badge = $("cart-badge");
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
}

function quickAdd(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p || p.stock_qty === 0) return;
  addToBag(p, (p.sizes || [])[0] || "", 1);
}

function addToBag(p, size, qty) {
  const line = state.cart.find((i) => i.productId === p.id && i.size === size);
  const max = p.stock_qty === null || p.stock_qty === undefined ? Infinity : p.stock_qty;
  if (line) {
    if (line.qty + qty > max) return false;
    line.qty += qty;
  } else {
    if (qty > max) return false;
    state.cart.push({ productId: p.id, name: p.name, size, qty, priceMinor: p.price_minor, currency: p.currency });
  }
  saveBag();
  renderCart();
  return true;
}

function cartTotal() {
  return state.cart.reduce((a, i) => a + i.priceMinor * i.qty, 0);
}

function cartCurrency() {
  return (state.cart[0] && state.cart[0].currency) || (state.config && state.config.currency) || "UGX";
}

function renderCart() {
  const box = $("cart-lines");
  $("cart-empty").classList.toggle("hidden", state.cart.length > 0);
  $("cart-footer").classList.toggle("hidden", state.cart.length === 0);
  box.innerHTML = state.cart.map((item, idx) => `
    <div class="cart-line">
      <div class="grow">
        <strong>${esc(item.name)}</strong>
        <div class="muted">${esc(item.size)} · ${esc(money(item.priceMinor, item.currency))}</div>
      </div>
      <div class="qty">
        <button data-dec="${idx}" aria-label="Less">−</button>
        <span>${item.qty}</span>
        <button data-inc="${idx}" aria-label="More">+</button>
      </div>
      <button class="linklike" data-del="${idx}">remove</button>
    </div>`).join("");
  $("cart-total").textContent = money(cartTotal(), cartCurrency());
  box.querySelectorAll("[data-inc]").forEach((b) =>
    b.addEventListener("click", () => changeQty(Number(b.dataset.inc), 1)));
  box.querySelectorAll("[data-dec]").forEach((b) =>
    b.addEventListener("click", () => changeQty(Number(b.dataset.dec), -1)));
  box.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      state.cart.splice(Number(b.dataset.del), 1);
      saveBag();
      renderCart();
    }));
}

function changeQty(idx, delta) {
  const item = state.cart[idx];
  if (!item) return;
  const p = state.products.find((x) => x.id === item.productId);
  const max = !p || p.stock_qty === null || p.stock_qty === undefined ? Infinity : p.stock_qty;
  const next = item.qty + delta;
  if (next <= 0) state.cart.splice(idx, 1);
  else if (next <= max) item.qty = next;
  saveBag();
  renderCart();
}

// ---------- checkout (shared component) + verified confirm ----------

function openCheckout() {
  if (!state.cart.length) return;
  $("co-error").classList.add("hidden");
  $("co-pay").classList.add("hidden");
  $("co-done").classList.add("hidden");
  $("co-form").classList.remove("hidden");
  $("co-overlay").classList.remove("hidden");
  $("co-sheet").classList.remove("hidden");
}

function closeCheckout() {
  $("co-sheet").classList.add("hidden");
  $("co-overlay").classList.add("hidden");
}

async function handleCheckoutSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = $("co-error");
  const submitBtn = $("co-submit");
  errorEl.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "PLACING ORDER…";
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: form.customerName.value.trim(),
        phone: form.phone.value.trim(),
        address: form.address.value.trim(),
        deliveryNotes: form.deliveryNotes.value.trim(),
        items: state.cart.map((i) => ({ productId: i.productId, size: i.size, qty: i.qty })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not place order.");
    state.cart = [];
    saveBag();
    renderCart();
    state.lastOrderId = data.id;
    $("co-form").classList.add("hidden");
    $("co-pay").classList.remove("hidden");
    if (window.AfrexpayCheckout) {
      window.AfrexpayCheckout.render($("pay-now-slot") || $("co-pay"), { entityType: "order", entityId: data.id });
    }
    // Re-verify button for the just-placed order (shared component covers
    // provider buttons; this is the no-JS-fallback path).
    ensureVerifyButton(data.id);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Place order";
  }
}

function ensureVerifyButton(orderId) {
  let btn = $("co-verify");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "co-verify";
    btn.className = "btn-ghost";
    btn.textContent = "I've paid — check status";
    $("co-pay").appendChild(btn);
  }
  btn.onclick = () => verifyOrder(orderId);
}

// Server is the only source of paid truth — never the ?paid=1 param.
async function verifyOrder(orderId) {
  let data = null;
  try {
    const res = await fetch(`/api/orders/${orderId}/status`);
    if (res.ok) data = await res.json();
    else if (res.status === 404) return false;
  } catch { data = null; }
  const paid = !!data && data.payment_status === "paid";
  if (paid) {
    $("co-pay").classList.add("hidden");
    $("co-done").classList.remove("hidden");
    $("co-order-id").textContent = orderId.slice(0, 8);
  }
  return paid;
}

// ---------- track ----------

async function trackOrder() {
  const id = $("track-id").value.trim();
  const err = $("track-error");
  const list = $("track-timeline");
  err.classList.add("hidden");
  list.innerHTML = "";
  if (!id) return;
  let data = null;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}/status`);
    if (res.ok) data = await res.json();
  } catch { data = null; }
  if (!data) {
    err.textContent = "No order found for that code.";
    err.classList.remove("hidden");
    return;
  }
  const steps = [
    ["Placed", true],
    ["Confirmed", data.status === "confirmed" || data.status === "fulfilled"],
    ["Paid", data.payment_status === "paid"],
    ["Fulfilled", data.status === "fulfilled"],
  ];
  list.innerHTML = steps.map(([label, done]) =>
    `<li class="${done ? "done" : ""}">${esc(label)}</li>`).join("");
}

// ---------- boot ----------

function rememberSearch(q) {
  try {
    const key = "soko-recent";
    const recent = JSON.parse(localStorage.getItem(key) || "[]").filter((x) => x !== q);
    localStorage.setItem(key, JSON.stringify([q, ...recent].slice(0, 6)));
  } catch {}
  paintRecent();
}

function paintRecent() {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem("soko-recent") || "[]"); } catch {}
  $("recent-row").innerHTML = recent.map((q) =>
    `<button data-q="${esc(q)}">${esc(q)}</button>`).join("");
  $("recent-row").querySelectorAll("[data-q]").forEach((b) =>
    b.addEventListener("click", () => {
      $("big-search").value = b.dataset.q;
      renderSearchResults(b.dataset.q);
    }));
}

async function init() {
  loadWishlist();
  loadBag();
  paintBadge();

  document.querySelectorAll(".tabbtn").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.view)));
  $("shop-search").addEventListener("input", renderFeed);
  $("big-search").addEventListener("input", (e) => renderSearchResults(e.target.value));
  $("checkout-open").addEventListener("click", openCheckout);
  $("co-close").addEventListener("click", closeCheckout);
  $("co-overlay").addEventListener("click", closeCheckout);
  $("co-form").addEventListener("submit", handleCheckoutSubmit);
  $("track-go").addEventListener("click", trackOrder);

  try {
    const configRes = await fetch("/api/config");
    const { config } = await configRes.json();
    applyConfig(config || {});
  } catch { applyConfig({}); }

  try {
    const res = await fetch("/api/products");
    state.products = res.ok ? await res.json() : [];
  } catch { state.products = []; }

  // Cover photos, one lookup per product in parallel (same pattern as the
  // other catalog themes). Failures fall back to initial tiles.
  await Promise.all(state.products.map(async (p) => {
    try {
      const r = await fetch(`/api/media/for/product/${p.id}`);
      const photos = r.ok ? await r.json() : [];
      state.photos[p.id] = photos.map((x) => x.storage_path).filter(Boolean);
    } catch { state.photos[p.id] = []; }
  }));

  renderChips();
  renderFeed();
  renderCart();
  paintRecent();

  // Provider return (?order=): verify server-side, never trust ?paid=1.
  const params = new URLSearchParams(window.location.search);
  const returnOrderId = params.get("order");
  if (returnOrderId) {
    showView("cart");
    openCheckout();
    $("co-form").classList.add("hidden");
    $("co-pay").classList.remove("hidden");
    if (window.AfrexpayCheckout) {
      window.AfrexpayCheckout.render($("pay-now-slot") || $("co-pay"), { entityType: "order", entityId: returnOrderId });
    }
    ensureVerifyButton(returnOrderId);
    verifyOrder(returnOrderId);
  }
}

init();
