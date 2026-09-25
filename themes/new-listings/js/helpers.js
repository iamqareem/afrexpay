// Zero-decimal mirror of src/lib/currency.js (static bundles can't require
// node modules — keep in sync, both point at the Stripe list).
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
export function money(minor, currency = 'USD') {
  const code = String(currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL.has(code)) return `${code} ${Number(minor).toLocaleString('en-UG')}`;
  return `${code} ${(Number(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function applyConfig(config) {
  if (config.accentColor) document.documentElement.style.setProperty('--accent', config.accentColor);
  if (config.accentColor2) document.documentElement.style.setProperty('--accent2', config.accentColor2);
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? '';
}

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}