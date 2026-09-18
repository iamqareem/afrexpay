export function money(minor, currency = 'USD') {
  return `${currency} ${(Number(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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