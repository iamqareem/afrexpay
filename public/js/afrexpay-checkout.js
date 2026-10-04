// public/js/afrexpay-checkout.js — shared pay-now component for ALL themes.
// Served on every host via a pre-tenant route in src/app.js.
// All styling is inline so it works inside shadow DOM too.
(function (global) {
  "use strict";

  var ENDPOINTS = {
    order: { path: "/api/orders", param: "order" },
    booking: { path: "/api/bookings", param: "booking" },
    listing_reservation: { path: "/api/listing-reservations", param: "reservation" },
  };

  var LABELS = { stripe: "Pay by card", paypal: "Pay with PayPal" };

  // Function to get available payment methods
  function getAvailableMethods() {
    return fetch("/api/config/payment-methods", { credentials: "same-origin" })
      .then(function (res) { return res.json(); })
      .catch(function () { return {}; });
  }

  // Function to start checkout with the selected provider
  function startCheckout(entityType, entityId, provider, btn, errEl) {
    var ep = endpointFor(entityType);
    var urls = returnUrls(entityType, entityId);
    if (!ep || !urls) return Promise.reject(new Error("Unknown entity type."));
    errEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Redirecting…";
    return fetch(ep.path + "/" + encodeURIComponent(entityId) + "/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ successUrl: urls.successUrl, cancelUrl: urls.cancelUrl, provider: provider }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (out) {
        if (!out.res.ok) throw new Error(out.data.error || "Could not start checkout.");
        window.location.href = out.data.checkoutUrl;
      })
      .catch(function (err) {
        errEl.textContent = err.message;
        errEl.style.display = "";
        btn.disabled = false;
        btn.textContent = LABELS[provider] || "Pay now";
      });
  }

  // Function to render the checkout modal
  function render(el, opts) {
    opts = opts || {};
    var entityType = opts.entityType;
    var entityId = opts.entityId;
    var onError = opts.onError || function () {};
    if (!el || !endpointFor(entityType) || !entityId) {
      onError(new Error("AfrexpayCheckout.render needs el, entityType, entityId."));
      return;
    }
    el.innerHTML = '<p style="opacity:.7;font-size:.9rem">Loading payment options…</p>';
    getAvailableMethods().then(function (m) {
      var available = ["stripe", "paypal"].filter(function (p) { return m && m[p]; });
      if (available.length === 0) {
        el.innerHTML = '<p style="opacity:.7;font-size:.9rem">Online payment is not available for this store right now.</p>';
        return;
      }
      var html = available.map(function (p) {
        var dark = p === "stripe";
        return '<button type="button" data-provider="' + p + '" style="' + BTN +
          (dark ? "background:#000;color:#fff;" : "background:#fff;color:#000;") + '">' +
          esc(LABELS[p]) + "</button>";
      }).join("") + '<p data-apc-err style="display:none;color:#b00020;font-size:.85rem"></p>';
      el.innerHTML = html;
      var errEl = el.querySelector("[data-apc-err]");
      el.querySelectorAll("[data-provider]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          startCheckout(entityType, entityId, btn.getAttribute("data-provider"), btn, errEl).catch(onError);
        });
      });
    }).catch(function (err) {
      el.innerHTML = '<p style="opacity:.7;font-size:.9rem">Online payment is not available for this store right now.</p>';
      onError(err);
    });
  }

  var api = { render: render, methods: getAvailableMethods, endpointFor: endpointFor, returnUrls: returnUrls };
  global.AfrexpayCheckout = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  var BTN =
    "display:block;width:100%;margin:0 0 .6rem;padding:.8rem 1rem;" +
    "font:inherit;font-weight:700;border-radius:999px;cursor:pointer;" +
    "border:1px solid currentColor;";
  function endpointFor(entityType) {
    return ENDPOINTS[entityType] || null;
  }

  function returnUrls(entityType, entityId) {
    var ep = endpointFor(entityType);
    if (!ep || typeof window === "undefined") return null;
    var base = window.location.href.split("?")[0];
    var cancelUrl = base + "?" + ep.param + "=" + encodeURIComponent(entityId);
    return { successUrl: cancelUrl + "&paid=1", cancelUrl: cancelUrl };
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Raw enabled-flags for themes that need their own selector UI
  // (e.g. immediate-deposit flows). Resolves { stripe: bool, paypal: bool }.
  function methods() {
    return fetch("/api/config/payment-methods", { credentials: "same-origin" })
      .then(function (res) { return res.json(); })
      .catch(function () { return {}; });
  }
  function startCheckout(entityType, entityId, provider, btn, errEl) {
    var ep = endpointFor(entityType);
    var urls = returnUrls(entityType, entityId);
    if (!ep || !urls) return Promise.reject(new Error("Unknown entity type."));
    errEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Redirecting…";
    return fetch(ep.path + "/" + encodeURIComponent(entityId) + "/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ successUrl: urls.successUrl, cancelUrl: urls.cancelUrl, provider: provider }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (out) {
        if (!out.res.ok) throw new Error(out.data.error || "Could not start checkout.");
        window.location.href = out.data.checkoutUrl;
      })
      .catch(function (err) {
        errEl.textContent = err.message;
        errEl.style.display = "";
        btn.disabled = false;
        btn.textContent = LABELS[provider] || "Pay now";
      });
  }

  function render(el, opts) {
    opts = opts || {};
    var entityType = opts.entityType;
    var entityId = opts.entityId;
    var onError = opts.onError || function () {};
    if (!el || !endpointFor(entityType) || !entityId) {
      onError(new Error("AfrexpayCheckout.render needs el, entityType, entityId."));
      return;
    }
    el.innerHTML = '<p style="opacity:.7;font-size:.9rem">Loading payment options…</p>';
    methods().then(function (m) {
      var available = ["stripe", "paypal"].filter(function (p) { return m && m[p]; });
      if (available.length === 0) {
        el.innerHTML = '<p style="opacity:.7;font-size:.9rem">Online payment is not available for this store right now.</p>';
        return;
      }
      var html = available.map(function (p) {
        var dark = p === "stripe";
        return '<button type="button" data-provider="' + p + '" style="' + BTN +
          (dark ? "background:#000;color:#fff;" : "background:#fff;color:#000;") + '">' +
          esc(LABELS[p]) + "</button>";
      }).join("") + '<p data-apc-err style="display:none;color:#b00020;font-size:.85rem"></p>';
      el.innerHTML = html;
      var errEl = el.querySelector("[data-apc-err]");
      el.querySelectorAll("[data-provider]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          startCheckout(entityType, entityId, btn.getAttribute("data-provider"), btn, errEl).catch(onError);
        });
      });
    }).catch(function (err) {
      el.innerHTML = '<p style="opacity:.7;font-size:.9rem">Online payment is not available for this store right now.</p>';
      onError(err);
    });
  }

  var api = { render: render, methods: methods, endpointFor: endpointFor, returnUrls: returnUrls };
  global.AfrexpayCheckout = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
