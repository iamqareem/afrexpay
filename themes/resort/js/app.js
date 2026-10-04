// themes/resort/js/app.js — premium hotel-recreation booking flow.
//
// Same proven flow as booking-slots (service → date/slot → details →
// confirm + optional Stripe pay-now), with two differences: a
// search-first hero that filters the experiences grid live, and
// photo-led service cards fed by the dashboard photo manager
// (GET /api/media/for/service/:id — every photo a merchant uploads to a
// service shows here; the first is the cover, the rest count as a badge).

const state = {
  config: null,
  services: [],
  photosByService: {}, // serviceId -> [storage_path, ...]
  search: "",
  selectedService: null,
  selectedSlot: null,
  lastBookingId: null,
};

// Zero-decimal mirror of src/lib/currency.js (static bundles can't require
// node modules — keep in sync, both point at the Stripe list).
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
function money(minor, currency) {
  const code = (currency || "USD").toUpperCase();
  if (ZERO_DECIMAL.has(code)) return `${code} ${Number(minor).toLocaleString("en-UG")}`;
  return `${code} ${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Merchant-controlled strings must never hit innerHTML raw.
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function applyConfig(config) {
  state.config = config;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text ?? ""; };
  set("page-title", `Book — ${config.storeName || ""}`);
  set("brand-name", config.storeName);
  set("brand-accent", config.storeNameAccent);
  set("tagline", config.tagline);
  set("hero-line1", config.heroTitleLine1 || "Find your");
  set("hero-line2", config.heroTitleLine2 || "moment");
  set("hero-subtitle", config.heroSubtitle || "Search experiences, pick a time, and reserve in under a minute.");
  set("footer-text", config.footerText);
  if (config.accentColor) document.documentElement.style.setProperty("--accent", config.accentColor);
  if (config.accentColor2) document.documentElement.style.setProperty("--accent2", config.accentColor2);
}

// The search query filters the already-fetched services client-side —
// no extra request per keystroke, and it works offline of the slot API.
function filteredServices() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.services;
  return state.services.filter((s) =>
    `${s.name || ""} ${s.description || ""}`.toLowerCase().includes(q)
  );
}

function renderServices() {
  const list = document.getElementById("service-list");
  const services = filteredServices();
  const countEl = document.getElementById("search-count");
  const noResults = document.getElementById("no-results");

  countEl.textContent = state.search.trim()
    ? `${services.length} of ${state.services.length} experiences`
    : `${state.services.length} experiences`;

  list.classList.toggle("hidden", services.length === 0);
  noResults.classList.toggle("hidden", services.length > 0);

  list.innerHTML = services
    .map((s) => {
      const photos = state.photosByService[s.id] || [];
      const cover = photos[0] || null;
      return `
    <div class="service-card" data-service="${s.id}">
      <div class="relative">
        ${cover
          ? `<img src="/media/${cover}" alt="${esc(s.name)}" class="w-full aspect-[16/10] object-cover" loading="lazy" onerror="this.style.display='none'" />`
          : `<div class="w-full aspect-[16/10] bg-surface2 flex items-center justify-center"><span class="font-display text-4xl text-muted">≈</span></div>`}
        ${photos.length > 1 ? `<span class="photo-badge">+${photos.length - 1} photos</span>` : ""}
      </div>
      <div class="p-5">
        <h3 class="font-display text-xl">${esc(s.name)}</h3>
        ${s.description ? `<p class="text-muted text-sm mt-1">${esc(s.description)}</p>` : ""}
        <p class="text-sm mt-3 text-accent font-bold">${s.duration_minutes} min &middot; ${money(s.price_minor, s.currency)}</p>
      </div>
    </div>`;
    })
    .join("");

  list.querySelectorAll("[data-service]").forEach((card) => {
    card.addEventListener("click", () => {
      list.querySelectorAll(".service-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.selectedService = state.services.find((s) => s.id === card.dataset.service);
      document.getElementById("slots-for").textContent = state.selectedService
        ? `Showing times for ${state.selectedService.name}` : "";
      document.getElementById("step-slots").classList.remove("hidden");
      const dateInput = document.getElementById("date-picker");
      if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
      loadSlots();
      document.getElementById("step-slots").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function loadServicePhotos() {
  // One photo lookup per service, in parallel — recreation catalogs are
  // small (a handful of experiences), so this needs no batching.
  // Missing/failed fetches fall back to the placeholder, never block
  // the card from rendering.
  const entries = await Promise.all(
    state.services.map((s) =>
      fetch(`/api/media/for/service/${s.id}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((photos) => [s.id, photos.map((p) => p.storage_path).filter(Boolean)])
        .catch(() => [s.id, []])
    )
  );
  state.photosByService = Object.fromEntries(entries);
}

async function loadSlots() {
  const date = document.getElementById("date-picker").value;
  if (!date || !state.selectedService) return;
  const res = await fetch(`/api/availability/slots?serviceId=${state.selectedService.id}&date=${date}`);
  const data = await res.json();
  const slotList = document.getElementById("slot-list");
  const noSlots = document.getElementById("no-slots");

  if (!res.ok || !data.slots || data.slots.length === 0) {
    slotList.innerHTML = "";
    noSlots.classList.remove("hidden");
    return;
  }
  noSlots.classList.add("hidden");
  slotList.innerHTML = data.slots
    .map((slot) => `<button type="button" class="slot-btn" data-start="${slot.start}">${new Date(slot.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</button>`)
    .join("");

  slotList.querySelectorAll("[data-start]").forEach((btn) => {
    btn.addEventListener("click", () => {
      slotList.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.selectedSlot = btn.dataset.start;
      document.getElementById("step-details").classList.remove("hidden");
    });
  });
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("booking-error");
  errorEl.classList.add("hidden");

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: state.selectedService.id,
        customerName: form.customerName.value.trim(),
        phone: form.phone.value.trim(),
        notes: form.notes.value.trim(),
        startTime: state.selectedSlot,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not book that slot.");

    showConfirm(data.id);
  } catch (err) {
    // A 409 here means someone else booked this exact slot between the
    // picker loading and this submit — refresh the slot list so the
    // now-stale option disappears, rather than leaving a dead button up.
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    loadSlots();
  }
}

// Shows the booking confirmation. Paid or not is decided by asking the
// server for the booking's real payment_status — the ?paid=1 query param
// is never trusted (anyone can forge a query string; only the webhook
// flips payment_status).
async function showConfirm(bookingId) {
  state.lastBookingId = bookingId;
  document.getElementById("step-service").classList.add("hidden");
  document.getElementById("step-slots").classList.add("hidden");
  document.getElementById("step-details").classList.add("hidden");
  document.getElementById("step-confirm").classList.remove("hidden");
  let paid = false;
  try {
    const res = await fetch(`/api/bookings/${bookingId}/status`);
    if (res.ok) paid = (await res.json()).payment_status === "paid";
  } catch {
    paid = false;
  }
  document.getElementById("confirm-paid").classList.toggle("hidden", !paid);
  const slot = document.getElementById("pay-now-slot");
  slot.classList.toggle("hidden", !!paid);
  // Shared component renders card/PayPal buttons per enabled methods.
  if (!paid && window.AfrexpayCheckout) {
    window.AfrexpayCheckout.render(slot, { entityType: "booking", entityId: bookingId });
  }
  const detailEl = document.getElementById("confirm-detail");
  if (paid) {
    detailEl.textContent = "Your booking is confirmed and paid. We'll be in touch.";
  } else if (state.selectedService && state.selectedSlot) {
    detailEl.textContent =
      `${state.selectedService.name} on ${new Date(state.selectedSlot).toLocaleString()}. We'll be in touch to confirm.`;
  } else {
    detailEl.textContent = "Your booking is held. You can complete payment with the button below.";
  }
}

function resetToSearch() {
  state.selectedService = null;
  state.selectedSlot = null;
  state.lastBookingId = null;
  document.getElementById("step-confirm").classList.add("hidden");
  document.getElementById("step-slots").classList.add("hidden");
  document.getElementById("step-details").classList.add("hidden");
  document.getElementById("step-service").classList.remove("hidden");
  document.getElementById("booking-form").reset();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function init() {
  const configRes = await fetch("/api/config");
  const { config } = await configRes.json();
  applyConfig(config || {});

  const servicesRes = await fetch("/api/services");
  state.services = await servicesRes.json();
  await loadServicePhotos();
  renderServices();

  const searchInput = document.getElementById("service-search");
  const searchClear = document.getElementById("search-clear");
  searchInput.addEventListener("input", () => {
    state.search = searchInput.value;
    searchClear.classList.toggle("hidden", !searchInput.value);
    renderServices();
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    state.search = "";
    searchClear.classList.add("hidden");
    renderServices();
    searchInput.focus();
  });
  document.getElementById("reset-search").addEventListener("click", () => {
    searchInput.value = "";
    state.search = "";
    searchClear.classList.add("hidden");
    renderServices();
  });

  document.getElementById("date-picker").addEventListener("change", loadSlots);
  document.getElementById("booking-form").addEventListener("submit", handleBookingSubmit);
  document.getElementById("book-another").addEventListener("click", resetToSearch);

  // If Stripe redirected back here (successUrl/cancelUrl both point at
  // this same page with a `booking` param), jump straight to the
  // confirmation — paid or not is decided server-side inside showConfirm.
  const params = new URLSearchParams(window.location.search);
  const returnBookingId = params.get("booking");
  if (returnBookingId) {
    showConfirm(returnBookingId);
  }
}

init();
