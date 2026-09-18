// app.js — vanilla JS: browse listings -> view detail -> send inquiry.

const state = { config: null, listings: [], selected: null };

function money(minor) {
  return `${state.config.currency || "USD"} ${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function applyConfig(config) {
  state.config = config;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text ?? ""; };
  set("page-title", config.storeName || "Listings");
  set("brand-name", config.storeName);
  set("brand-accent", config.storeNameAccent);
  set("hero-line1", config.heroTitleLine1 || "Find your");
  set("hero-line2", config.heroTitleLine2 || "next place");
  set("hero-subtitle", config.heroSubtitle || "Browse current listings below.");
  if (config.accentColor) document.documentElement.style.setProperty("--accent", config.accentColor);
  if (config.accentColor2) document.documentElement.style.setProperty("--accent2", config.accentColor2);
}

function renderGrid() {
  const grid = document.getElementById("listing-grid");
  grid.innerHTML = state.listings
    .map(
      (l) => `
    <div class="listing-card" data-id="${l.id}">
      <div class="w-full aspect-video bg-surface2">
        ${l.thumbnail_path ? `<img src="/media/${l.thumbnail_path}" class="w-full h-full object-cover" loading="lazy" />` : ""}
      </div>
      <div class="p-4">
        <span class="listing-badge">${l.listing_type === "rent" ? "FOR RENT" : "FOR SALE"}</span>
        <h3 class="font-semibold mt-2">${l.title}</h3>
        <p class="text-accent font-semibold mt-1">${money(l.price_minor)}</p>
        <p class="text-muted text-sm mt-1">${[l.bedrooms ? l.bedrooms + " bd" : null, l.bathrooms ? l.bathrooms + " ba" : null, l.location].filter(Boolean).join(" · ")}</p>
      </div>
    </div>`
    )
    .join("");

  grid.querySelectorAll("[data-id]").forEach((card) => {
    card.addEventListener("click", () => showDetail(card.dataset.id));
  });
}

async function showDetail(listingId) {
  const listing = state.listings.find((l) => l.id === listingId);
  if (!listing) return;
  state.selected = listing;

  document.getElementById("view-list").classList.add("hidden");
  document.getElementById("view-detail").classList.remove("hidden");
  document.getElementById("detail-title").textContent = listing.title;
  document.getElementById("detail-price").textContent = money(listing.price_minor, listing.currency);
  document.getElementById("detail-meta").textContent =
    [listing.bedrooms ? listing.bedrooms + " bedrooms" : null, listing.bathrooms ? listing.bathrooms + " bathrooms" : null, listing.area_sqm ? listing.area_sqm + " sqm" : null, listing.location]
      .filter(Boolean).join(" · ");
  document.getElementById("detail-description").textContent = listing.description || "";

  const photosRes = await fetch(`/api/media/for/listing/${listingId}`);
  const photos = photosRes.ok ? await photosRes.json() : [];
  const photosEl = document.getElementById("detail-photos");
  photosEl.innerHTML = photos.length
    ? photos.map((p) => `<img src="/media/${p.storage_path}" class="w-full aspect-video object-cover rounded-md" />`).join("")
    : `<div class="col-span-2 aspect-video bg-surface2 rounded-md"></div>`;

  document.getElementById("inquiry-form").classList.remove("hidden");
  document.getElementById("inquiry-sent").classList.add("hidden");
  document.getElementById("inquiry-form").reset();
  document.getElementById("reservation-confirmed").classList.add("hidden");

  // A listing with a deposit gets the "pay to reserve" panel instead of
  // (in addition to, visually stacked below) the plain inquiry form —
  // deposit_amount_minor is nullable and additive, so a listing with none
  // set behaves exactly as it always has.
  const reservationPanel = document.getElementById("reservation-panel");
  if (listing.deposit_amount_minor) {
    reservationPanel.classList.remove("hidden");
    document.getElementById("deposit-amount").textContent = money(listing.deposit_amount_minor, listing.currency);
    document.getElementById("reservation-form").reset();
  } else {
    reservationPanel.classList.add("hidden");
  }
}

async function handleReservationSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("reservation-error");
  const submitBtn = document.getElementById("reservation-submit");
  errorEl.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "PROCESSING...";

  try {
    const createRes = await fetch("/api/listing-reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: state.selected.id,
        name: form.name.value.trim(),
        phone: form.phone.value.trim(),
        message: form.message.value.trim(),
      }),
    });
    const reservation = await createRes.json();
    if (!createRes.ok) throw new Error(reservation.error || "Could not create reservation.");

    // Round-trip back to this exact listing after Stripe's hosted checkout
    // — reservationId in the query string lets the page show a
    // confirmation without needing to poll anything. The reservation's
    // actual payment_status is only ever set by the webhook, server-side
    // (see reservation.service.js) — this redirect is just UX feedback,
    // never the source of truth for whether payment really succeeded.
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set("listing", state.selected.id);
    const successUrl = new URL(returnUrl); successUrl.searchParams.set("reservation", reservation.id);
    const cancelUrl = returnUrl.toString();

    const checkoutRes = await fetch(`/api/listing-reservations/${reservation.id}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ successUrl: successUrl.toString(), cancelUrl }),
    });
    const checkout = await checkoutRes.json();
    if (!checkoutRes.ok) throw new Error(checkout.error || "Could not start checkout.");

    window.location.href = checkout.checkoutUrl;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    submitBtn.disabled = false;
    submitBtn.textContent = "PAY DEPOSIT TO RESERVE";
  }
}

async function handleInquirySubmit(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("inquiry-error");
  errorEl.classList.add("hidden");

  try {
    const res = await fetch("/api/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: state.selected.id,
        name: form.name.value.trim(),
        phone: form.phone.value.trim(),
        message: form.message.value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not send inquiry.");

    form.classList.add("hidden");
    document.getElementById("inquiry-sent").classList.remove("hidden");
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.getElementById("theme-toggle-icon");
  if (icon) icon.textContent = theme === "light" ? "☀" : "🌙";
}

function initTheme() {
  const saved = localStorage.getItem("theme");
  const theme = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTheme(theme);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });
}

async function init() {
  initTheme();
  const configRes = await fetch("/api/config");
  const { config } = await configRes.json();
  applyConfig(config || {});

  const listingsRes = await fetch("/api/listings");
  state.listings = await listingsRes.json();
  renderGrid();

  document.getElementById("back-btn").addEventListener("click", () => {
    document.getElementById("view-detail").classList.add("hidden");
    document.getElementById("view-list").classList.remove("hidden");
  });
  document.getElementById("inquiry-form").addEventListener("submit", handleInquirySubmit);
  document.getElementById("reservation-form").addEventListener("submit", handleReservationSubmit);

  // If Stripe redirected back here (successUrl/cancelUrl both point at
  // this same page with a `listing` param), reopen that listing's detail
  // view automatically rather than dropping the customer back at the grid.
  const params = new URLSearchParams(window.location.search);
  const returnListingId = params.get("listing");
  if (returnListingId) {
    await showDetail(returnListingId);
    if (params.get("reservation")) {
      // Purely a UX confirmation banner — the reservation's real
      // payment_status is set server-side by the webhook (see
      // reservation.service.js), never by this client-side redirect.
      document.getElementById("reservation-panel").classList.add("hidden");
      document.getElementById("reservation-confirmed").classList.remove("hidden");
    }
  }
}

init();
