// public/js/signup.js — Interactive multi-step signup wizard with real-time password feedback

const THEMES_BY_VERTICAL = {
  products: [
    { id: "hangtag", label: "Hangtag", subCategory: "Fashion & General", desc: "Clean grid layout for apparel & general retail catalogs." },
    { id: "electronics", label: "Electronics", subCategory: "Tech & Gadgets", desc: "High-tech layout with tech specifications grid." },
    { id: "yeezy", label: "Yeezy", subCategory: "Streetwear & Footwear", desc: "Bold, lifestyle-driven showcase for urban fashion." },
    { id: "backmarket", label: "BackMarket", subCategory: "Refurbished Goods", desc: "Trust-centric layout for pre-owned & certified items." },
    { id: "automobile", label: "Automobile", subCategory: "Auto & Parts", desc: "Structured catalog for vehicle parts & motors." },
    { id: "souk", label: "Souk", subCategory: "Fragrance & Attire", desc: "Elegant storefront for perfumes, attars, and modest wear." },
  ],
  services: [
    { id: "booking-slots", label: "Booking Slots", subCategory: "Appointments", desc: "Interactive appointment scheduling with weekly availability." },
    { id: "resort", label: "Resort", subCategory: "Hotels & Recreation", desc: "Premium search-first booking for hotel experiences — pool, spa, fitness." },
  ],
  listings: [
    { id: "listing-grid", label: "Listing Grid", subCategory: "Real Estate", desc: "Property grid & inquiry forms for sales & rentals." },
    { id: "new-listings", label: "Urban Estates", subCategory: "Real Estate", desc: "Modern component-based listing theme with hero section." },
  ],
};

let selectedThemeSlug = "hangtag";

function getSelectedVertical() {
  const radio = document.querySelector('input[name="vertical"]:checked');
  return radio ? radio.value : "products";
}

// Server-fetched theme lists, keyed by vertical. The hardcoded
// THEMES_BY_VERTICAL below is offline fallback only — the single source
// of truth is GET /api/auth/themes (src/verticals.js).
const serverThemes = {};

async function fetchServerThemes(vertical) {
  if (serverThemes[vertical]) return serverThemes[vertical];
  try {
    const res = await fetch(`/api/auth/themes?vertical=${encodeURIComponent(vertical)}`);
    if (!res.ok) throw new Error("theme fetch failed");
    const data = await res.json();
    if (!Array.isArray(data.themes) || data.themes.length === 0) throw new Error("empty theme list");
    serverThemes[vertical] = data.themes;
    return data.themes;
  } catch {
    return null;
  }
}

function renderThemeWizardGrid() {
  const vertical = getSelectedVertical();
  const themes = serverThemes[vertical] || THEMES_BY_VERTICAL[vertical] || THEMES_BY_VERTICAL.products;
  const grid = document.getElementById("theme-wizard-grid");
  const labelEl = document.getElementById("selected-vertical-label");

  const verticalLabels = {
    products: "Physical Products",
    services: "Bookable Services",
    listings: "Real Estate Listings",
  };
  if (labelEl) labelEl.textContent = verticalLabels[vertical] || "Physical Products";

  if (!themes.some((t) => t.id === selectedThemeSlug)) {
    selectedThemeSlug = themes[0].id;
  }

  grid.innerHTML = themes
    .map(
      (t) => `
    <div class="theme-wizard-card ${t.id === selectedThemeSlug ? "selected" : ""}" onclick="selectThemeInWizard('${t.id}')">
      <div class="theme-wizard-title">${t.label}</div>
      <span class="theme-wizard-badge">${t.subCategory}</span>
      <p class="theme-wizard-desc">${t.desc}</p>
    </div>
  `
    )
    .join("");
}

function selectThemeInWizard(themeSlug) {
  selectedThemeSlug = themeSlug;
  renderThemeWizardGrid();
}

// Render instantly from fallback, then upgrade to server truth when it
// arrives. Called on load (prefetch), vertical change, and step-2 entry
// so the grid never blocks on network.
async function refreshThemesThenRender() {
  renderThemeWizardGrid();
  const vertical = getSelectedVertical();
  const fetched = await fetchServerThemes(vertical);
  if (fetched) renderThemeWizardGrid();
}

// Prefetch all verticals on load so step 2 never waits.
["products", "services", "listings"].forEach((v) => {
  fetchServerThemes(v);
});

function goToStep(step) {
  const heroInput = document.getElementById("hero-subdomain-input");
  const formSubdomain = document.getElementById("subdomain");
  if (heroInput && formSubdomain && heroInput.value.trim() && !formSubdomain.value.trim()) {
    formSubdomain.value = heroInput.value.trim().toLowerCase();
  }

  document.querySelectorAll(".step-nav-item").forEach((item, index) => {
    if (index + 1 === step) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  document.querySelectorAll(".wizard-step-content").forEach((content) => {
    content.classList.remove("active");
  });
  const activeContent = document.getElementById(`wizard-step-${step}`);
  if (activeContent) activeContent.classList.add("active");

  if (step === 2) {
    refreshThemesThenRender();
  }
}

// ---- REAL-TIME PASSWORD VALIDATION & TOGGLE ----
const passInput = document.getElementById("password");
const togglePassBtn = document.getElementById("toggle-password");
const bNameInput = document.getElementById("businessName");
const subInput = document.getElementById("subdomain");
const emailInput = document.getElementById("email");

const chkLength = document.getElementById("chk-length");
const chkCases = document.getElementById("chk-cases");
const chkNumSym = document.getElementById("chk-numsym");
const chkIdentity = document.getElementById("chk-identity");

function updatePasswordChecklist() {
  const p = passInput.value || "";
  const bName = bNameInput ? bNameInput.value.trim() : "";
  const sub = subInput ? subInput.value.trim() : "";
  const em = emailInput ? emailInput.value.trim() : "";

  // 1. Length check
  const hasLength = p.length >= 8;
  updateCheckitem(chkLength, hasLength);

  // 2. Cases check
  const hasCases = /[a-z]/.test(p) && /[A-Z]/.test(p);
  updateCheckitem(chkCases, hasCases);

  // 3. Number & symbol check
  const hasNumSym = /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p);
  updateCheckitem(chkNumSym, hasNumSym);

  // 4. Identity similarity check
  const normalize = (str) => (str ? String(str).toLowerCase().replace(/[^a-z0-9]/g, "") : "");
  const pNorm = normalize(p);
  const cleanB = normalize(bName);
  const cleanSub = normalize(sub);
  const cleanEm = normalize(em.split("@")[0]);

  let passIdentity = true;
  if (pNorm && ((cleanB && cleanB.length >= 3 && pNorm.includes(cleanB)) || (cleanSub && cleanSub.length >= 3 && pNorm.includes(cleanSub)) || (cleanEm && cleanEm.length >= 3 && pNorm.includes(cleanEm)))) {
    passIdentity = false;
  }
  updateCheckitem(chkIdentity, p.length > 0 && passIdentity);
}

function updateCheckitem(el, isPass) {
  if (!el) return;
  if (isPass) {
    el.classList.add("pass");
    el.classList.remove("fail");
  } else {
    el.classList.remove("pass");
  }
}

if (passInput) {
  passInput.addEventListener("input", updatePasswordChecklist);
  if (bNameInput) bNameInput.addEventListener("input", updatePasswordChecklist);
  if (subInput) subInput.addEventListener("input", updatePasswordChecklist);
  if (emailInput) emailInput.addEventListener("input", updatePasswordChecklist);
}

if (togglePassBtn && passInput) {
  togglePassBtn.addEventListener("click", () => {
    const isPass = passInput.type === "password";
    passInput.type = isPass ? "text" : "password";
    togglePassBtn.innerHTML = isPass
      ? `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
      : `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  });
}

// Category radio selection styling
document.querySelectorAll('input[name="vertical"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    document.querySelectorAll(".category-radio-card").forEach((card) => card.classList.remove("active"));
    e.target.closest(".category-radio-card").classList.add("active");
    refreshThemesThenRender();
  });
});

// Form submission handler
document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("signup-error");
  const submitBtn = document.getElementById("signup-submit");
  errorEl.style.display = "none";

  const vertical = getSelectedVertical();
  const payload = {
    businessName: form.businessName.value.trim(),
    subdomain: form.subdomain.value.trim().toLowerCase(),
    email: form.email.value.trim(),
    password: form.password.value,
    vertical,
    themeSlug: selectedThemeSlug,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "CREATING YOUR STORE...";

  try {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not create your store.");

    const dashboardUrl = `${window.location.protocol}//${data.subdomain}.${window.location.host}/admin`;
    const dashLink = document.getElementById("dashboard-link");
    dashLink.href = dashboardUrl;
    dashLink.textContent = `OPEN DASHBOARD (${data.subdomain}.${window.location.host}/admin)`;

    form.style.display = "none";
    document.querySelector(".wizard-header").style.display = "none";
    document.querySelector(".wizard-steps-nav").style.display = "none";
    document.getElementById("signup-success").style.display = "block";
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "CREATE MY STORE NOW \u2192";
  }
});

// Expose functions globally for onclick attributes
window.goToStep = goToStep;
window.selectThemeInWizard = selectThemeInWizard;
