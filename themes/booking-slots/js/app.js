// app.js — vanilla JS booking flow: pick service -> pick date/slot -> details -> confirm.

const state = { config: null, services: [], selectedService: null, selectedSlot: null, selectedResource: null, lastBookingId: null };

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
  set("hero-line1", config.heroTitleLine1 || "Book your");
  set("hero-line2", config.heroTitleLine2 || "appointment");
  set("hero-subtitle", config.heroSubtitle || "Pick a service, then a time that works for you.");
  if (config.accentColor) document.documentElement.style.setProperty("--accent", config.accentColor);
  if (config.accentColor2) document.documentElement.style.setProperty("--accent2", config.accentColor2);
}

async function renderServices() {
  const list = document.getElementById("service-list");

  // One photo lookup per service, in parallel — service lists are small
  // (a handful to a few dozen), so this doesn't need the batching a large
  // catalog would. Missing/failed photo fetches just fall back to no image,
  // never block the card from rendering. All of a service's photos are
  // kept (not just the first) so the card can badge the extra count —
  // every photo the merchant uploads in the dashboard photo manager
  // shows up here.
  const photosByService = await Promise.all(
    state.services.map((s) =>
      fetch(`/api/media/for/service/${s.id}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((photos) => photos.map((p) => p.storage_path).filter(Boolean))
        .catch(() => [])
    )
  );

  list.innerHTML = state.services
    .map((s, i) => {
      const photos = photosByService[i];
      const cover = photos[0] || null;
      return `
    <div class="service-card" data-service="${s.id}">
      <div class="relative">
        ${cover ? `<img src="/media/${cover}" alt="${esc(s.name)}" loading="lazy" onerror="this.style.display='none'" class="w-full aspect-video object-cover rounded-md mb-3" />` : ""}
        ${photos.length > 1 ? `<span style="position:absolute;bottom:1rem;right:0.75rem;background:rgba(0,0,0,0.65);color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.5rem;border-radius:999px;">+${photos.length - 1}</span>` : ""}
      </div>
      <h3 class="font-semibold">${esc(s.name)}</h3>
      ${s.description ? `<p class="text-muted text-sm mt-1">${esc(s.description)}</p>` : ""}
      <p class="text-sm mt-2">${s.duration_minutes} min &middot; ${money(s.price_minor, s.currency)}</p>
    </div>`;
    })
    .join("");

  list.querySelectorAll("[data-service]").forEach((card) => {
    card.addEventListener("click", () => {
      list.querySelectorAll(".service-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.selectedService = state.services.find((s) => s.id === card.dataset.service);
      state.selectedResource = null;
      state.selectedSlot = null;
      document.getElementById("step-slots").classList.remove("hidden");
      const dateInput = document.getElementById("date-picker");
      if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
      loadSlots();
    });
  });
}

// Staff picker renders only when the service has more than one eligible
// resource (slots response carries the list). Default is "Anyone" — the
// server auto-assigns the first free resource at booking time.
function renderStaffPicker(resources) {
  const row = document.getElementById("staff-row");
  const list = document.getElementById("staff-list");
  if (!resources || resources.length < 2) {
    row.classList.add("hidden");
    list.innerHTML = "";
    state.selectedResource = null;
    return;
  }
  row.classList.remove("hidden");
  list.innerHTML =
    `<button class="slot-btn${!state.selectedResource ? " selected" : ""}" data-staff="">Anyone</button>` +
    resources
      .map((r) => `<button class="slot-btn${state.selectedResource === r.id ? " selected" : ""}" data-staff="${r.id}">${esc(r.name)}</button>`)
      .join("");
  list.querySelectorAll("[data-staff]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedResource = btn.dataset.staff || null;
      state.selectedSlot = null;
      loadSlots();
    });
  });
}

async function loadSlots() {
  const date = document.getElementById("date-picker").value;
  if (!date || !state.selectedService) return;
  let url = `/api/availability/slots?serviceId=${state.selectedService.id}&date=${date}`;
  if (state.selectedResource) url += `&resourceId=${encodeURIComponent(state.selectedResource)}`;
  const res = await fetch(url);
  const data = await res.json();
  const slotList = document.getElementById("slot-list");
  const noSlots = document.getElementById("no-slots");

  renderStaffPicker(data.resources);

  if (!res.ok || !data.slots || data.slots.length === 0) {
    slotList.innerHTML = "";
    noSlots.classList.remove("hidden");
    return;
  }
  noSlots.classList.add("hidden");
  slotList.innerHTML = data.slots
    .map((slot) => `<button class="slot-btn" data-start="${slot.start}">${new Date(slot.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</button>`)
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
        ...(state.selectedResource ? { resourceId: state.selectedResource } : {}),
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

async function init() {
  const configRes = await fetch("/api/config");
  const { config } = await configRes.json();
  applyConfig(config || {});

  const servicesRes = await fetch("/api/services");
  state.services = await servicesRes.json();
  await renderServices();

  document.getElementById("date-picker").addEventListener("change", loadSlots);
  document.getElementById("booking-form").addEventListener("submit", handleBookingSubmit);

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
