// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 afrexpay
// src/verticals.js
//
// A small, explicit registry of the business shapes and theme mappings this platform supports
// — deliberately NOT a dynamic plugin loader.

const THEMES_REGISTRY = {
  hangtag: {
    id: "hangtag",
    label: "Hangtag",
    vertical: "products",
    subCategory: "Fashion & General Catalog",
    description: "Minimalist grid layout for physical product catalogs & apparel.",
  },
  electronics: {
    id: "electronics",
    label: "Electronics",
    vertical: "products",
    subCategory: "Tech & Gadgets",
    description: "Modern, high-tech layout optimized for consumer electronics.",
  },
  yeezy: {
    id: "yeezy",
    label: "Yeezy",
    vertical: "products",
    subCategory: "Streetwear & Footwear",
    description: "Bold, lifestyle-driven showcase for sneakers & street apparel.",
  },
  backmarket: {
    id: "backmarket",
    label: "BackMarket",
    vertical: "products",
    subCategory: "Refurbished & Pre-owned",
    description: "Trust-centric layout for certified pre-owned and refurbished items.",
  },
  automobile: {
    id: "automobile",
    label: "Automobile",
    vertical: "products",
    subCategory: "Auto & Parts",
    description: "Structured parts and vehicle showcase catalog.",
  },
  souk: {
    id: "souk",
    label: "Souk",
    vertical: "products",
    subCategory: "Fragrance & Modest Attire",
    description: "Elegant storefront for perfumes, attars, and modest wear with category filtering.",
  },
  "booking-slots": {
    id: "booking-slots",
    label: "Booking Slots",
    vertical: "services",
    subCategory: "Appointments & Services",
    description: "Interactive appointment scheduling with weekly availability.",
  },
  resort: {
    id: "resort",
    label: "Resort",
    vertical: "services",
    subCategory: "Hotels & Recreation",
    description: "Premium search-first booking for hotel experiences — pool, spa, fitness.",
  },
  "listing-grid": {
    id: "listing-grid",
    label: "Listing Grid",
    vertical: "listings",
    subCategory: "Real Estate & Rentals",
    description: "Property grid & detailed inquiry forms for real estate.",
  },
  "new-listings": {
    id: "new-listings",
    label: "Urban Estates",
    vertical: "listings",
    subCategory: "Real Estate & Rentals",
    description: "Modern component-based listing theme with hero section.",
  },
};

const VERTICALS = {
  products: {
    label: "Physical products",
    dashboardTabs: ["products", "orders"],
    compatibleThemes: ["hangtag", "electronics", "yeezy", "backmarket", "automobile", "souk"],
  },
  services: {
    label: "Bookable services",
    dashboardTabs: ["services", "availability", "bookings"],
    compatibleThemes: ["booking-slots", "resort"],
  },
  listings: {
    label: "Real estate listings",
    dashboardTabs: ["listings", "inquiries", "reservations"],
    compatibleThemes: ["listing-grid", "new-listings"],
  },
};

const VALID_VERTICALS = new Set(Object.keys(VERTICALS));
const DEFAULT_VERTICAL = "products";

function resolveVertical(rawVertical) {
  return VALID_VERTICALS.has(rawVertical) ? rawVertical : DEFAULT_VERTICAL;
}

function getThemesForVertical(rawVertical) {
  const vertical = resolveVertical(rawVertical);
  const compatibleIds = VERTICALS[vertical].compatibleThemes;
  return compatibleIds.map((id) => THEMES_REGISTRY[id]).filter(Boolean);
}

function isThemeCompatible(rawVertical, themeSlug) {
  if (!themeSlug || !THEMES_REGISTRY[themeSlug]) return false;
  const vertical = resolveVertical(rawVertical);
  return THEMES_REGISTRY[themeSlug].vertical === vertical;
}

function getThemeDetails(themeSlug) {
  return THEMES_REGISTRY[themeSlug] || THEMES_REGISTRY["hangtag"];
}

module.exports = {
  VERTICALS,
  VALID_VERTICALS,
  DEFAULT_VERTICAL,
  resolveVertical,
  THEMES_REGISTRY,
  getThemesForVertical,
  isThemeCompatible,
  getThemeDetails,
};
