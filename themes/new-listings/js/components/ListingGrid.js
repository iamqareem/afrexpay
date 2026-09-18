import { money } from '../helpers.js';

export default class ListingGrid {
  constructor(container, listings, config, onSelect) {
    this.container = container;
    this.listings = listings;
    this.config = config;
    this.onSelect = onSelect;
    this.render();
  }

  render() {
    const currency = this.config?.currency || 'USD';
    const heroLine1 = this.config?.heroTitleLine1 || 'Find your';
    const heroLine2 = this.config?.heroTitleLine2 || 'next place';
    const heroSubtitle = this.config?.heroSubtitle || 'Browse current listings below.';

    let gridHtml = '';
    if (!this.listings.length) {
      gridHtml = `<p class="text-muted">No listings found.</p>`;
    } else {
      gridHtml = `
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          ${this.listings.map(l => `
            <div class="listing-card" data-id="${l.id}">
              <div class="w-full aspect-video bg-surface2">
                ${l.thumbnail_path ? `<img src="/media/${l.thumbnail_path}" class="w-full h-full object-cover" loading="lazy" />` : ''}
              </div>
              <div class="p-4">
                <span class="listing-badge">${l.listing_type === 'rent' ? 'FOR RENT' : 'FOR SALE'}</span>
                <h3 class="font-semibold mt-2">${l.title}</h3>
                <p class="text-accent font-semibold mt-1">${money(l.price_minor, currency)}</p>
                <p class="text-muted text-sm mt-1">${[l.bedrooms ? l.bedrooms + ' bd' : null, l.bathrooms ? l.bathrooms + ' ba' : null, l.location].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    this.container.innerHTML = `
      <!-- Hero section -->
      <div class="mb-8">
        <h1 class="font-display text-3xl mb-1">
          <span>${heroLine1}</span>
          <span class="text-accent">${heroLine2}</span>
        </h1>
        <p class="text-muted">${heroSubtitle}</p>
      </div>
      ${gridHtml}
    `;

    // delegate click to cards
    this.container.querySelectorAll('[data-id]').forEach(card => {
      card.addEventListener('click', () => this.onSelect(card.dataset.id));
    });
  }

  update(listings, config) {
    this.listings = listings;
    this.config = config;
    this.render();
  }
}