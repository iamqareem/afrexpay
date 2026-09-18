export default class ThemeToggle {
  constructor(container) {
    this.container = container;
    this.theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    this.render();
    this.apply();
  }

  render() {
    this.container.innerHTML = `
      <button id="theme-toggle-btn" type="button" class="text-sm border border-surface2 rounded-md px-3 py-1.5 text-muted hover:text-paper transition-colors">
        <span id="theme-toggle-icon">${this.theme === 'light' ? '☀' : '🌙'}</span>
      </button>
    `;
    this.container.querySelector('#theme-toggle-btn').addEventListener('click', () => this.toggle());
  }

  toggle() {
    this.theme = this.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', this.theme);
    this.apply();
    document.getElementById('theme-toggle-icon').textContent = this.theme === 'light' ? '☀' : '🌙';
  }

  apply() {
    document.documentElement.setAttribute('data-theme', this.theme);
  }
}