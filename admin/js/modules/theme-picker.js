// admin/js/modules/theme-picker.js
// Modular component helpers for theme selection & vertical-aware theme filtering in the admin dashboard.

window.ThemePickerModule = {
  getFilteredThemes(availableThemes, currentVertical) {
    if (!Array.isArray(availableThemes)) return [];
    return availableThemes.filter((theme) => theme.vertical === currentVertical);
  },
};
