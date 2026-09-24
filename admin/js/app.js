// admin/js/app.js — one Alpine component holds all dashboard state.
// No build step: this file is loaded as-is, same as alpine.min.js.

function adminApp() {
  return {
    // ---- top-level state ----
    checkedSession: false,
    loggedIn: false,
    tab: "home",
    toast: null,

    // per-table loading flags — true until that table's first load
    // resolves, so tables render skeletons instead of a false "empty"
    loading: {
      products: true, orders: true, services: true, hours: true,
      exceptions: true, bookings: true, listings: true,
      inquiries: true, reservations: true,
    },

    // client-side find / filter / sort per table (Phase 3). The raw
    // arrays stay server-shaped so these getters can later be swapped
    // for server queries without touching any markup.
    filters: {
      products: { q: "", sort: "new" },
      orders: { q: "", status: "", pay: "", sort: "new" },
      services: { q: "", sort: "new" },
      bookings: { q: "", status: "", sort: "new" },
      listings: { q: "", sort: "new" },
      inquiries: { q: "", sort: "new" },
      reservations: { q: "", sort: "new" },
    },

    // login form
    loginEmail: "",
    loginPassword: "",
    showLoginPassword: false,
    loginError: "",
    showForgotPassword: false,
    forgotEmail: "",
    forgotSending: false,
    forgotMessage: "",

    // config
    config: {},
    configSaving: false,
    matrixUserId: "",
    matrixConnecting: false,
    matrixError: "",

    // products
    products: [],
    productForm: { sku: "", name: "", category: "", priceMinor: "", sizes: "", stockQty: "", blurb: "" },
    editingProductId: null,
    productError: "",
    productPhotos: [],

    // orders
    orders: [],

    // colors + theme
    colorPairs: [
      { name: "Black / White", accent: "#000000", accent2: "#ffffff" },
      { name: "Ink / Mist", accent: "#0a0a0a", accent2: "#d4d4d4" },
      { name: "Charcoal / Silver", accent: "#404040", accent2: "#a3a3a3" },
      { name: "Graphite / Fog", accent: "#262626", accent2: "#e5e5e5" },
      { name: "Slate / Ash", accent: "#525252", accent2: "#8a8a8a" },
      { name: "Smoke / Snow", accent: "#737373", accent2: "#f5f5f5" },
    ],
    availableThemes: [],
    currentTheme: "hangtag",
    themeSaving: false,

    // services
    services: [],
    serviceForm: { name: "", description: "", durationMinutes: "", priceMinor: "" },
    editingServiceId: null,
    serviceError: "",
    servicePhotos: [],

    // availability
    weekDays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    weeklyHours: Array.from({ length: 7 }, () => ({ startTime: "", endTime: "" })),
    hoursSaving: false,
    exceptions: [],
    exceptionForm: { date: "", isAvailable: false, startTime: "", endTime: "" },

    // bookings
    bookings: [],

    // listings
    listings: [],
    listingForm: { title: "", listingType: "sale", priceMinor: "", location: "", bedrooms: "", bathrooms: "", areaSqm: "", description: "", depositAmountMinor: "" },
    listingPhotos: [],
    editingListingId: null,
    listingError: "",

    // inquiries
    inquiries: [],

    // reservations
    reservations: [],

    // payments (Stripe)
    stripeForm: { publishableKey: "", secretKey: "", webhookSecret: "", mode: "test" },
    stripeStatus: { enabled: false, has_secret_key: false, has_webhook_secret: false, webhookUrl: "" },
    stripeSaving: false,

    // custom domain
    domainStatus: { custom_domain: null, custom_domain_verified_at: null },
    domainInput: "",
    domainSaving: false,
    domainVerifying: false,
    domainError: "",

    // vertical registry (fetched from server, not hardcoded — see src/verticals.js)
    verticals: {},

    tabVisible(tabName) {
      const v = this.verticals[this.config.vertical || "products"];
      return v ? v.dashboardTabs.includes(tabName) : false;
    },

    // Tabs are hash-routed (#tab=orders) so refreshes and shared links
    // land on the right view. Always-visible tabs need no registry.
    tabOrder() {
      return ["home", "config", "payments", "domain", "products", "services", "availability", "orders", "bookings", "listings", "inquiries", "reservations"]
        .filter((t) => t === "home" || t === "config" || t === "payments" || t === "domain" || this.tabVisible(t));
    },

    setTab(name) {
      this.tab = name;
      try { location.hash = "tab=" + name; } catch { /* non-browser env */ }
    },

    readTabFromHash() {
      const m = (location.hash || "").match(/tab=([a-z-]+)/);
      const known = ["home", "config", "payments", "domain", "products", "services", "availability", "orders", "bookings", "listings", "inquiries", "reservations"];
      if (m && known.includes(m[1])) this.tab = m[1];
    },

    tabKey(e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const order = this.tabOrder();
      const i = order.indexOf(this.tab);
      const next = order[(i + (e.key === "ArrowRight" ? 1 : -1) + order.length) % order.length];
      this.setTab(next);
      this.$nextTick(() => {
        const el = document.querySelector('.tab[data-tab="' + next + '"]');
        if (el) el.focus();
      });
    },

    // ---- init ----
    async init() {
      this.readTabFromHash();
      window.addEventListener("hashchange", () => this.readTabFromHash());
      await this.checkSession();
    },

    async checkSession() {
      const res = await fetch("/api/orders", { credentials: "same-origin" });
      this.loggedIn = res.ok;
      this.checkedSession = true;
      if (!this.loggedIn) return;
      await this.loadAll();
      // A bookmarked hash may point at a tab this vertical doesn't have.
      if (!["home", "config", "payments", "domain"].includes(this.tab) && !this.tabVisible(this.tab)) {
        this.tab = "home";
      }
    },

    async loadAll() {
      await Promise.all([
        this.loadConfig(), this.loadVerticals(), this.loadProducts(),
        this.loadOrders(), this.loadThemes(), this.loadStripeStatus(),
        this.loadDomainStatus(),
      ]);
      if (this.tabVisible("services")) {
        await Promise.all([this.loadServices(), this.loadWeeklyHours(), this.loadExceptions(), this.loadBookings()]);
      }
      if (this.tabVisible("listings")) {
        await Promise.all([this.loadListings(), this.loadInquiries(), this.loadReservations()]);
      }
    },

    async loadVerticals() {
      try {
        const res = await fetch("/api/config/verticals", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load business categories.");
        this.verticals = await res.json();
      } catch (err) {
        this.showToast(err.message || "Could not load business categories.", "error");
      }
    },

    showToast(message, kind = "ok") {
      this.toast = { message, kind };
      setTimeout(() => { this.toast = null; }, 3000);
    },

    // ---- auth ----
    toggleLoginPassword() {
      this.showLoginPassword = !this.showLoginPassword;
    },

    async login() {
      this.loginError = "";
      // Gentle pre-check only: no account can hold a password under 8
      // chars (signup and reset both enforce it server-side), so this
      // just saves a doomed round-trip — it never judges strength and
      // never blocks a potentially-valid login.
      if (!this.loginPassword || this.loginPassword.length < 8) {
        this.loginError = "Password must be at least 8 characters.";
        return;
      }
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: this.loginEmail, password: this.loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.loginError = data.error || "Login failed.";
        return;
      }
      this.loggedIn = true;
      this.loginPassword = "";
      this.showLoginPassword = false;
      await this.loadAll();
    },

    async logout() {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      // Clear everything session-shaped — previously services, bookings,
      // listings and friends survived logout and flashed stale on the
      // next login until their loaders resolved.
      this.loggedIn = false;
      this.tab = "home";
      this.config = {};
      this.products = [];
      this.orders = [];
      this.services = [];
      this.bookings = [];
      this.listings = [];
      this.inquiries = [];
      this.reservations = [];
      this.exceptions = [];
      this.availableThemes = [];
      this.loginEmail = "";
      this.loading = {
        products: true, orders: true, services: true, hours: true,
        exceptions: true, bookings: true, listings: true,
        inquiries: true, reservations: true,
      };
      try { location.hash = ""; } catch { /* non-browser env */ }
    },

    async requestPasswordReset() {
      this.forgotSending = true;
      this.forgotMessage = "";
      try {
        const res = await fetch("/api/auth/request-password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: this.forgotEmail }),
        });
        const data = await res.json();
        this.forgotMessage = data.message || "If that email is registered, a reset link has been sent.";
      } catch {
        this.forgotMessage = "Could not send reset link. Try again.";
      } finally {
        this.forgotSending = false;
      }
    },

    // ---- config ----
    async loadConfig() {
      try {
        const res = await fetch("/api/config", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load store settings.");
        const data = await res.json();
        this.config = data.config || {};
      } catch (err) {
        this.showToast(err.message || "Could not load store settings.", "error");
      }
    },

    async saveConfig() {
      this.configSaving = true;
      try {
        const { _reconnecting, ...payload } = this.config; // strip UI-only fields before persisting
        const res = await fetch("/api/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Save failed.");
        // Switching vertical mid-session (e.g. products -> services) means
        // tabs that were previously hidden become visible immediately —
        // load their data now rather than leaving them empty until a
        // full page refresh happens to trigger loadAll() again.
        if (this.tabVisible("services") && this.services.length === 0) {
          await Promise.all([this.loadServices(), this.loadWeeklyHours(), this.loadExceptions(), this.loadBookings()]);
        }
        if (this.tabVisible("listings") && this.listings.length === 0) {
          await Promise.all([this.loadListings(), this.loadInquiries(), this.loadReservations()]);
        }
        this.showToast("Store settings saved.");
      } catch (err) {
        this.showToast(err.message, "error");
      } finally {
        this.configSaving = false;
      }
    },

    cancelMatrixReconnect() {
      this.config._reconnecting = false;
      this.matrixUserId = "";
      this.matrixError = "";
    },

    async connectMatrix() {
      this.matrixError = "";
      this.matrixConnecting = true;
      try {
        const res = await fetch("/api/matrix/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ matrixUserId: this.matrixUserId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not connect.");

        await this.loadConfig(); // picks up the new matrixRoomId
        this.config._reconnecting = false;
        this.matrixUserId = "";
        this.showToast(`Invite sent to ${data.invited}. Accept it in Element to start receiving orders.`);
      } catch (err) {
        this.matrixError = err.message;
      } finally {
        this.matrixConnecting = false;
      }
    },

    // ---- products ----
    async loadProducts() {
      this.loading.products = true;
      try {
        const res = await fetch("/api/products", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load products.");
        this.products = await res.json();
      } catch (err) {
        this.showToast(err.message || "Could not load products.", "error");
      } finally {
        this.loading.products = false;
      }
    },

    resetProductForm() {
      this.productForm = { sku: "", name: "", category: "", priceMinor: "", sizes: "", stockQty: "", blurb: "" };
      this.editingProductId = null;
      this.productPhotos = [];
      this.productError = "";
    },

    editProduct(p) {
      this.editingProductId = p.id;
      this.productForm = {
        sku: p.sku, name: p.name, category: p.category || "",
        priceMinor: p.price_minor, sizes: p.sizes.join(", "),
        stockQty: p.stock_qty ?? "", blurb: p.blurb || "",
      };
      this.loadProductPhotos(p.id);
    },

    async loadProductPhotos(productId) {
      const res = await fetch(`/api/media/for/product/${productId}`, { credentials: "same-origin" });
      this.productPhotos = res.ok ? await res.json() : [];
    },

    async uploadProductPhoto(event, productId) {
      const file = event.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", "product");
      formData.append("entityId", productId);
      const res = await fetch("/api/media", { method: "POST", credentials: "same-origin", body: formData });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || "Upload failed.", "error");
        return;
      }
      this.showToast("Photo uploaded.");
      event.target.value = "";
      await this.loadProductPhotos(productId);
    },

    async deleteProductPhoto(mediaId) {
      const res = await fetch(`/api/media/${mediaId}`, { method: "DELETE", credentials: "same-origin" });
      if (res.status === 204 || res.ok) {
        this.productPhotos = this.productPhotos.filter((p) => p.id !== mediaId);
        this.showToast("Photo removed.");
      } else {
        this.showToast("Could not remove photo.", "error");
      }
    },

    async moveProductPhoto(index, direction) {
      const target = index + direction;
      if (target < 0 || target >= this.productPhotos.length) return;
      const photos = [...this.productPhotos];
      [photos[index], photos[target]] = [photos[target], photos[index]];
      this.productPhotos = photos;

      const res = await fetch("/api/media/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ mediaIds: photos.map((p) => p.id) }),
      });
      if (!res.ok) this.showToast("Could not save photo order.", "error");
    },

    async submitProduct() {
      this.productError = "";
      const sizes = this.productForm.sizes.split(",").map((s) => s.trim()).filter(Boolean);
      const priceMinor = Number(this.productForm.priceMinor);

      if (!this.productForm.sku || !this.productForm.name || !Number.isInteger(priceMinor) || sizes.length === 0) {
        this.productError = "SKU, name, a whole-number price, and at least one size are required.";
        return;
      }

      const body = {
        sku: this.productForm.sku,
        name: this.productForm.name,
        category: this.productForm.category || null,
        priceMinor,
        sizes,
        stockQty: this.productForm.stockQty === "" ? null : Number(this.productForm.stockQty),
        blurb: this.productForm.blurb || null,
      };

      const url = this.editingProductId ? `/api/products/${this.editingProductId}` : "/api/products";
      const method = this.editingProductId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        this.productError = data.error || "Could not save product.";
        return;
      }
      this.resetProductForm();
      await this.loadProducts();
      this.showToast("Product saved.");
    },

    async deleteProduct(id) {
      if (!confirm("Remove this product from the storefront?")) return;
      const res = await fetch(`/api/products/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (res.status === 204 || res.ok) {
        await this.loadProducts();
        this.showToast("Product removed.");
      } else {
        this.showToast("Could not remove product.", "error");
      }
    },

    // ---- orders ----
    async loadOrders() {
      this.loading.orders = true;
      try {
        const res = await fetch("/api/orders", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load orders.");
        this.orders = await res.json();
      } catch (err) {
        this.showToast(err.message || "Could not load orders.", "error");
      } finally {
        this.loading.orders = false;
      }
    },

    async updateOrderStatus(id, status) {
      // Optimistic like bookings: the select is bound to o.status, so it
      // flips instantly and only rolls back if the server refuses.
      const o = this.orders.find((x) => x.id === id);
      const prev = o ? o.status : null;
      if (o) o.status = status;
      try {
        const res = await fetch(`/api/orders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Could not update order.");
        this.showToast("Order updated.");
      } catch (err) {
        if (o) o.status = prev;
        this.showToast(err.message || "Could not update order — reverted.", "error");
      }
    },

    // Zero-decimal mirror of src/lib/currency.js (browser bundle can't
    // require node modules — keep in sync, both point at the Stripe list).
    // Whole minor units printed raw (e.g. "UGX 5,000") are only correct
    // for zero-decimal currencies; decimal ones need cents ("$50.00").
    money(minor, currency) {
      const code = (currency || "UGX").toUpperCase();
      const n = Number(minor) || 0;
      const zeroDecimal = new Set([
        "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
        "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
      ]);
      if (zeroDecimal.has(code)) return `${code} ${Math.round(n).toLocaleString("en-UG")}`;
      const symbols = { USD: "$", EUR: "€", GBP: "£", KES: "KSh ", TZS: "TSh ", NGN: "₦", GHS: "GH₵ ", ZAR: "R" };
      const symbol = symbols[code] || `${code} `;
      return `${symbol}${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },

    // ---- client-side filtering (Phase 3) ----
    // Every word in the query must appear somewhere across the fields.
    matchQ(row, q, fields) {
      if (!q || !q.trim()) return true;
      const hay = fields.map((f) => String(row[f] ?? "")).join(" ").toLowerCase();
      return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
    },

    // True when the merchant typed/selected anything (ignores sort).
    filterActive(key) {
      const f = this.filters[key] || {};
      return Object.entries(f).some(([k, v]) => k !== "sort" && v);
    },

    byNewOld(rows, dir, getDate) {
      if (dir !== "old") return rows;
      return [...rows].sort((a, b) => new Date(getDate(a)) - new Date(getDate(b)));
    },

    filteredProducts() {
      const f = this.filters.products;
      const rows = this.products.filter((p) => this.matchQ(p, f.q, ["sku", "name", "category"]));
      if (f.sort === "name") return [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      if (f.sort === "price-asc") return [...rows].sort((a, b) => a.price_minor - b.price_minor);
      if (f.sort === "price-desc") return [...rows].sort((a, b) => b.price_minor - a.price_minor);
      return rows;
    },

    filteredOrders() {
      const f = this.filters.orders;
      const rows = this.orders.filter((o) =>
        this.matchQ(o, f.q, ["customer_name", "phone"]) &&
        (!f.status || o.status === f.status) &&
        (!f.pay || (o.payment_status || "unpaid") === f.pay)
      );
      return this.byNewOld(rows, f.sort, (o) => o.created_at);
    },

    filteredServices() {
      const f = this.filters.services;
      const rows = this.services.filter((s) => this.matchQ(s, f.q, ["name", "description"]));
      if (f.sort === "name") return [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      if (f.sort === "price-asc") return [...rows].sort((a, b) => a.price_minor - b.price_minor);
      if (f.sort === "price-desc") return [...rows].sort((a, b) => b.price_minor - a.price_minor);
      return rows;
    },

    filteredBookings() {
      const f = this.filters.bookings;
      const rows = this.bookings.filter((b) =>
        this.matchQ(b, f.q, ["customer_name", "phone", "service_name"]) &&
        (!f.status || b.status === f.status)
      );
      return this.byNewOld(rows, f.sort, (b) => b.created_at);
    },

    filteredListings() {
      const f = this.filters.listings;
      const rows = this.listings.filter((l) => this.matchQ(l, f.q, ["title", "location"]));
      if (f.sort === "name") return [...rows].sort((a, b) => String(a.title).localeCompare(String(b.title)));
      if (f.sort === "price-asc") return [...rows].sort((a, b) => a.price_minor - b.price_minor);
      if (f.sort === "price-desc") return [...rows].sort((a, b) => b.price_minor - a.price_minor);
      return rows;
    },

    filteredInquiries() {
      const f = this.filters.inquiries;
      const rows = this.inquiries.filter((i) => this.matchQ(i, f.q, ["name", "phone", "listing_title", "message"]));
      return this.byNewOld(rows, f.sort, (i) => i.created_at);
    },

    filteredReservations() {
      const f = this.filters.reservations;
      const rows = this.reservations.filter((r) => this.matchQ(r, f.q, ["name", "phone", "listing_title"]));
      return this.byNewOld(rows, f.sort, (r) => r.created_at);
    },

    // ---- home overview (read-only aggregates over loaded lists) ----
    // All pure functions of state — no fetches — so tests/home-stats.test.js
    // exercises them directly via require("./admin/js/app.js").adminApp().
    LOW_STOCK_AT: 5,
    HOME_QUEUE_CAP: 5,

    sameDay(a, b) {
      const da = a instanceof Date ? a : new Date(a);
      const db = b instanceof Date ? b : new Date(b);
      if (isNaN(da) || isNaN(db)) return false;
      return da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate();
    },

    // Start instant of a booking time_range ("[..,..)" Postgres range text).
    bookingStart(rangeStr) {
      const match = String(rangeStr).match(/[\[(]"?([^,"]+)"?,/);
      if (!match) return null;
      const d = new Date(match[1]);
      return isNaN(d) ? null : d;
    },

    homeLoading() {
      const l = this.loading;
      return l.products || l.orders || l.services || l.bookings ||
        l.listings || l.inquiries || l.reservations;
    },

    // Paid orders created today, grouped by currency (merchants can sell
    // in more than one currency; each group renders its own line).
    homeRevenueToday() {
      const now = new Date();
      const sums = {};
      for (const o of this.orders) {
        if ((o.payment_status || "unpaid") !== "paid") continue;
        if (!this.sameDay(o.created_at, now)) continue;
        const cur = o.currency || "UGX";
        sums[cur] = (sums[cur] || 0) + (Number(o.total_minor) || 0);
      }
      return Object.entries(sums).map(([currency, total]) => ({ currency, total }));
    },

    homeOrdersToday() {
      const now = new Date();
      return this.orders.filter((o) => this.sameDay(o.created_at, now));
    },

    // Paid (confirmed) but not yet fulfilled or cancelled — the pack-and-ship queue.
    homeFulfillment() {
      return this.orders
        .filter((o) => o.status === "confirmed")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, this.HOME_QUEUE_CAP);
    },

    homeBookingsToday() {
      const now = new Date();
      return this.bookings.filter((b) => {
        if (b.status === "cancelled") return false;
        const start = this.bookingStart(b.time_range);
        return start && this.sameDay(start, now);
      });
    },

    homePendingBookings() {
      return this.bookings
        .filter((b) => b.status === "pending")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, this.HOME_QUEUE_CAP);
    },

    // Tracked stock at or below threshold; null means untracked (infinite).
    homeLowStock() {
      return this.products
        .filter((p) => p.stock_qty !== null && p.stock_qty !== undefined && p.stock_qty <= this.LOW_STOCK_AT)
        .sort((a, b) => (a.stock_qty ?? 0) - (b.stock_qty ?? 0))
        .slice(0, this.HOME_QUEUE_CAP);
    },

    homeNewInquiries() {
      const now = new Date();
      return this.inquiries
        .filter((i) => this.sameDay(i.created_at, now))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, this.HOME_QUEUE_CAP);
    },

    homePendingReservations() {
      return this.reservations
        .filter((r) => (r.payment_status || "unpaid") !== "paid")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, this.HOME_QUEUE_CAP);
    },

    // Newest-first merged activity across verticals, capped.
    homeActivity() {
      const rows = [];
      for (const o of this.orders) {
        rows.push({
          kind: "order", at: o.created_at, tab: "orders",
          title: o.customer_name || "Order",
          sub: this.money(o.total_minor, o.currency),
        });
      }
      for (const b of this.bookings) {
        rows.push({
          kind: "booking", at: b.created_at, tab: "bookings",
          title: b.customer_name || "Booking",
          sub: b.service_name || "",
        });
      }
      for (const i of this.inquiries) {
        rows.push({
          kind: "inquiry", at: i.created_at, tab: "inquiries",
          title: i.name || "Inquiry",
          sub: i.listing_title || "",
        });
      }
      return rows
        .filter((r) => r.at && !isNaN(new Date(r.at)))
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, 6);
    },

    // ---- theme ----
    filteredThemes() {
      const v = this.config.vertical || "products";
      if (window.ThemePickerModule) {
        return window.ThemePickerModule.getFilteredThemes(this.availableThemes, v);
      }
      return (this.availableThemes || []).filter((t) => t.vertical === v);
    },

    async loadThemes() {
      try {
        const v = this.config.vertical || "products";
        const res = await fetch(`/api/config/themes?vertical=${v}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        this.availableThemes = data.themes || [];
        this.currentTheme = data.current || "hangtag";
      } catch { /* theme picker stays empty; user can retry via vertical switch */ }
    },

    async setVertical(verticalKey) {
      this.config.vertical = verticalKey;
      await this.loadThemes();
      const compatible = this.filteredThemes();
      if (!compatible.some((t) => t.id === this.currentTheme) && compatible.length > 0) {
        await this.setTheme(compatible[0].id);
      }
    },

    async setTheme(themeSlug) {
      this.themeSaving = true;
      try {
        const res = await fetch("/api/config/theme", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ themeSlug }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not change theme.");
        this.currentTheme = data.theme_slug;
        this.showToast("Theme updated.");
      } catch (err) {
        this.showToast(err.message, "error");
      } finally {
        this.themeSaving = false;
      }
    },

    // ---- services ----
    async loadServices() {
      this.loading.services = true;
      try {
        const res = await fetch("/api/services", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load services.");
        this.services = await res.json();
      } catch (err) {
        this.showToast(err.message || "Could not load services.", "error");
      } finally {
        this.loading.services = false;
      }
    },

    resetServiceForm() {
      this.serviceForm = { name: "", description: "", durationMinutes: "", priceMinor: "" };
      this.editingServiceId = null;
      this.servicePhotos = [];
      this.serviceError = "";
    },

    editService(s) {
      this.editingServiceId = s.id;
      this.serviceForm = { name: s.name, description: s.description || "", durationMinutes: s.duration_minutes, priceMinor: s.price_minor };
      this.loadServicePhotos(s.id);
    },

    async loadServicePhotos(serviceId) {
      const res = await fetch(`/api/media/for/service/${serviceId}`, { credentials: "same-origin" });
      this.servicePhotos = res.ok ? await res.json() : [];
    },

    async uploadServicePhoto(event, serviceId) {
      const file = event.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", "service");
      formData.append("entityId", serviceId);
      const res = await fetch("/api/media", { method: "POST", credentials: "same-origin", body: formData });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || "Upload failed.", "error");
        return;
      }
      this.showToast("Photo uploaded.");
      event.target.value = "";
      await this.loadServicePhotos(serviceId);
    },

    async deleteServicePhoto(mediaId) {
      const res = await fetch(`/api/media/${mediaId}`, { method: "DELETE", credentials: "same-origin" });
      if (res.status === 204 || res.ok) {
        this.servicePhotos = this.servicePhotos.filter((p) => p.id !== mediaId);
        this.showToast("Photo removed.");
      } else {
        this.showToast("Could not remove photo.", "error");
      }
    },

    async moveServicePhoto(index, direction) {
      const target = index + direction;
      if (target < 0 || target >= this.servicePhotos.length) return;
      const photos = [...this.servicePhotos];
      [photos[index], photos[target]] = [photos[target], photos[index]];
      this.servicePhotos = photos;

      const res = await fetch("/api/media/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ mediaIds: photos.map((p) => p.id) }),
      });
      if (!res.ok) this.showToast("Could not save photo order.", "error");
    },

    async submitService() {
      this.serviceError = "";
      const durationMinutes = Number(this.serviceForm.durationMinutes);
      const priceMinor = Number(this.serviceForm.priceMinor);
      if (!this.serviceForm.name || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(priceMinor)) {
        this.serviceError = "Name, a positive whole-number duration, and a whole-number price are required.";
        return;
      }
      const body = { name: this.serviceForm.name, description: this.serviceForm.description || null, durationMinutes, priceMinor };
      const url = this.editingServiceId ? `/api/services/${this.editingServiceId}` : "/api/services";
      const method = this.editingServiceId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        this.serviceError = data.error || "Could not save service.";
        return;
      }
      this.resetServiceForm();
      await this.loadServices();
      this.showToast("Service saved.");
    },

    async deleteService(id) {
      if (!confirm("Remove this service from the storefront?")) return;
      const res = await fetch(`/api/services/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (res.status === 204 || res.ok) {
        await this.loadServices();
        this.showToast("Service removed.");
      } else {
        this.showToast("Could not remove service.", "error");
      }
    },

    // ---- availability ----
    async loadWeeklyHours() {
      this.loading.hours = true;
      try {
        const res = await fetch("/api/availability/windows", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load weekly hours.");
        const windows = await res.json();
        const hours = Array.from({ length: 7 }, () => ({ startTime: "", endTime: "" }));
        for (const w of windows) {
          hours[w.day_of_week] = { startTime: w.start_time.slice(0, 5), endTime: w.end_time.slice(0, 5) };
        }
        this.weeklyHours = hours;
      } catch (err) {
        this.showToast(err.message || "Could not load weekly hours.", "error");
      } finally {
        this.loading.hours = false;
      }
    },

    async saveWeeklyHours() {
      this.hoursSaving = true;
      const windows = this.weeklyHours
        .map((h, dayOfWeek) => ({ dayOfWeek, startTime: h.startTime, endTime: h.endTime }))
        .filter((w) => w.startTime && w.endTime);
      try {
        const res = await fetch("/api/availability/windows", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ windows }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Could not save hours.");
        this.showToast("Weekly hours saved.");
      } catch (err) {
        this.showToast(err.message, "error");
      } finally {
        this.hoursSaving = false;
      }
    },

    async loadExceptions() {
      this.loading.exceptions = true;
      try {
        const res = await fetch("/api/availability/exceptions", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load special days.");
        this.exceptions = await res.json();
      } catch (err) {
        this.showToast(err.message || "Could not load special days.", "error");
      } finally {
        this.loading.exceptions = false;
      }
    },

    async addException() {
      if (!this.exceptionForm.date) {
        this.showToast("Pick a date first.", "error");
        return;
      }
      const res = await fetch("/api/availability/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(this.exceptionForm),
      });
      if (!res.ok) {
        this.showToast((await res.json()).error || "Could not add exception.", "error");
        return;
      }
      this.exceptionForm = { date: "", isAvailable: false, startTime: "", endTime: "" };
      await this.loadExceptions();
      this.showToast("Exception added.");
    },

    async deleteException(id) {
      if (!confirm("Remove this special day? Your weekly hours will apply on that date instead.")) return;
      const res = await fetch(`/api/availability/exceptions/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (res.status === 204 || res.ok) {
        await this.loadExceptions();
        this.showToast("Special day removed.");
      } else {
        this.showToast("Could not remove special day.", "error");
      }
    },

    // ---- bookings ----
    async loadBookings() {
      this.loading.bookings = true;
      try {
        const res = await fetch("/api/bookings", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load bookings.");
        this.bookings = await res.json();
      } catch (err) {
        this.showToast(err.message || "Could not load bookings.", "error");
      } finally {
        this.loading.bookings = false;
      }
    },

    async updateBookingStatus(id, status) {
      // Optimistic: the select reflects the new status instantly (it is
      // bound to b.status), and we only roll back if the server refuses.
      const b = this.bookings.find((x) => x.id === id);
      const prev = b ? b.status : null;
      if (b) b.status = status;
      try {
        const res = await fetch(`/api/bookings/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error("Could not update booking.");
        this.showToast("Booking updated.");
      } catch (err) {
        if (b) b.status = prev;
        this.showToast(err.message || "Could not update booking — reverted.", "error");
      }
    },

    formatBookingTime(rangeStr) {
      const match = String(rangeStr).match(/[\[(]"?([^,"]+)"?,/);
      if (!match) return rangeStr;
      return new Date(match[1]).toLocaleString();
    },

    // ---- listings ----
    async loadListings() {
      this.loading.listings = true;
      try {
        const res = await fetch("/api/listings", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load listings.");
        this.listings = await res.json();
      } catch (err) {
        this.showToast(err.message || "Could not load listings.", "error");
      } finally {
        this.loading.listings = false;
      }
    },

    resetListingForm() {
      this.listingForm = { title: "", listingType: "sale", priceMinor: "", location: "", bedrooms: "", bathrooms: "", areaSqm: "", description: "", depositAmountMinor: "" };
      this.editingListingId = null;
      this.listingPhotos = [];
      this.listingError = "";
    },

    editListing(l) {
      this.editingListingId = l.id;
      this.listingForm = {
        title: l.title, listingType: l.listing_type, priceMinor: l.price_minor, location: l.location || "",
        bedrooms: l.bedrooms ?? "", bathrooms: l.bathrooms ?? "", areaSqm: l.area_sqm ?? "", description: l.description || "",
        depositAmountMinor: l.deposit_amount_minor ?? "",
      };
      this.loadListingPhotos(l.id);
    },

    async loadListingPhotos(listingId) {
      const res = await fetch(`/api/media/for/listing/${listingId}`, { credentials: "same-origin" });
      this.listingPhotos = res.ok ? await res.json() : [];
    },

    async deleteListingPhoto(mediaId) {
      const res = await fetch(`/api/media/${mediaId}`, { method: "DELETE", credentials: "same-origin" });
      if (res.status === 204 || res.ok) {
        this.listingPhotos = this.listingPhotos.filter((p) => p.id !== mediaId);
        this.showToast("Photo removed.");
      } else {
        this.showToast("Could not remove photo.", "error");
      }
    },

    async moveListingPhoto(index, direction) {
      const target = index + direction;
      if (target < 0 || target >= this.listingPhotos.length) return;
      // Swap locally first so the UI responds immediately, then persist the
      // full new order — reordering is one action from the user's
      // perspective (drag/click), not N separate edits.
      const photos = [...this.listingPhotos];
      [photos[index], photos[target]] = [photos[target], photos[index]];
      this.listingPhotos = photos;

      const res = await fetch("/api/media/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ mediaIds: photos.map((p) => p.id) }),
      });
      if (!res.ok) this.showToast("Could not save photo order.", "error");
    },

    async submitListing() {
      this.listingError = "";
      const priceMinor = Number(this.listingForm.priceMinor);
      if (!this.listingForm.title || !Number.isInteger(priceMinor)) {
        this.listingError = "Title and a whole-number price are required.";
        return;
      }
      const body = {
        title: this.listingForm.title,
        listingType: this.listingForm.listingType,
        priceMinor,
        location: this.listingForm.location || null,
        bedrooms: this.listingForm.bedrooms === "" ? null : Number(this.listingForm.bedrooms),
        bathrooms: this.listingForm.bathrooms === "" ? null : Number(this.listingForm.bathrooms),
        areaSqm: this.listingForm.areaSqm === "" ? null : Number(this.listingForm.areaSqm),
        description: this.listingForm.description || null,
        depositAmountMinor: this.listingForm.depositAmountMinor === "" ? null : Number(this.listingForm.depositAmountMinor),
      };
      const url = this.editingListingId ? `/api/listings/${this.editingListingId}` : "/api/listings";
      const method = this.editingListingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        this.listingError = data.error || "Could not save listing.";
        return;
      }
      this.resetListingForm();
      await this.loadListings();
      this.showToast("Listing saved.");
    },

    async deleteListing(id) {
      if (!confirm("Remove this listing from the storefront?")) return;
      const res = await fetch(`/api/listings/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (res.status === 204 || res.ok) {
        await this.loadListings();
        this.showToast("Listing removed.");
      } else {
        this.showToast("Could not remove listing.", "error");
      }
    },

    async uploadListingPhoto(event, listingId) {
      const file = event.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", "listing");
      formData.append("entityId", listingId);
      const res = await fetch("/api/media", { method: "POST", credentials: "same-origin", body: formData });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || "Upload failed.", "error");
        return;
      }
      this.showToast("Photo uploaded.");
      event.target.value = "";
      await this.loadListingPhotos(listingId);
    },

    // ---- inquiries ----
    async loadInquiries() {
      this.loading.inquiries = true;
      try {
        const res = await fetch("/api/inquiries", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load enquiries.");
        this.inquiries = await res.json();
      } catch (err) {
        this.showToast(err.message || "Could not load enquiries.", "error");
      } finally {
        this.loading.inquiries = false;
      }
    },

    // ---- reservations ----
    async loadReservations() {
      this.loading.reservations = true;
      try {
        const res = await fetch("/api/listing-reservations", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load reservations.");
        this.reservations = await res.json();
      } catch (err) {
        this.reservations = [];
        this.showToast(err.message || "Could not load reservations.", "error");
      } finally {
        this.loading.reservations = false;
      }
    },

    // ---- payments (Stripe) ----
    async loadStripeStatus() {
      try {
        const res = await fetch("/api/payments/credentials/stripe", { credentials: "same-origin" });
        if (res.ok) this.stripeStatus = await res.json();
      } catch { /* status badge keeps its default; user can retry by revisiting */ }
    },

    async saveStripeCredentials(enable) {
      this.stripeSaving = true;
      try {
        const body = {
          mode: this.stripeForm.mode,
          enabled: enable,
        };
        // Only send fields the merchant actually typed — blank means "keep
        // what's already saved," never "overwrite with empty." Matches
        // credentials.service.js's merge behavior on the backend.
        if (this.stripeForm.publishableKey) body.publishableKey = this.stripeForm.publishableKey;
        if (this.stripeForm.secretKey) body.secretKey = this.stripeForm.secretKey;
        if (this.stripeForm.webhookSecret) body.webhookSecret = this.stripeForm.webhookSecret;

        const res = await fetch("/api/payments/credentials/stripe", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Could not save Stripe settings.");

        this.stripeForm.secretKey = "";
        this.stripeForm.webhookSecret = "";
        await this.loadStripeStatus();
        this.showToast(enable ? "Stripe connected and enabled." : "Stripe settings saved.");
      } catch (err) {
        this.showToast(err.message, "error");
      } finally {
        this.stripeSaving = false;
      }
    },

    // ---- custom domain ----
    async loadDomainStatus() {
      try {
        const res = await fetch("/api/domains", { credentials: "same-origin" });
        if (!res.ok) return;
        this.domainStatus = await res.json();
        this.domainInput = this.domainStatus.custom_domain || "";
      } catch { /* domain panel keeps its defaults; user can retry by revisiting */ }
    },

    async saveDomain() {
      this.domainError = "";
      this.domainSaving = true;
      try {
        const res = await fetch("/api/domains", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ domain: this.domainInput }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save domain.");
        this.domainStatus = data;
        this.showToast("Domain saved. Now point your DNS and click Verify.");
      } catch (err) {
        this.domainError = err.message;
      } finally {
        this.domainSaving = false;
      }
    },

    async verifyDomain() {
      this.domainError = "";
      this.domainVerifying = true;
      try {
        const res = await fetch("/api/domains/verify", {
          method: "POST",
          credentials: "same-origin",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Verification request failed.");
        if (data.verified) {
          await this.loadDomainStatus();
          this.showToast("Domain verified! TLS will be issued on first visit.");
        } else {
          this.domainError = "DNS not pointing here yet. Update your A record and try again in a few minutes.";
        }
      } catch (err) {
        this.domainError = err.message;
      } finally {
        this.domainVerifying = false;
      }
    },
  };
}

// Exported for node unit tests (tests/home-stats.test.js) — `module` is
// undefined in browsers, so this is a no-op on the dashboard itself.
if (typeof module !== "undefined" && module.exports) module.exports = { adminApp };
