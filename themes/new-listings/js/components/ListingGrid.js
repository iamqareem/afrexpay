import { money, esc } from '../helpers.js';

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
                ${l.thumbnail_path ? `<img src="/media/${l.thumbnail_path}" alt="${esc(l.title)}" loading="lazy" onerror="this.style.display='none'" class="w-full h-full object-cover" />` : ''}
              </div>
              <div class="p-4">
                <span class="listing-badge">${l.listing_type === 'rent' ? 'FOR RENT' : 'FOR SALE'}</span>
                <h3 class="font-semibold mt-2">${esc(l.title)}</h3>
                <p class="text-accent font-semibold mt-1">${money(l.price_minor, currency)}</p>
                <p class="text-muted text-sm mt-1">${[l.bedrooms ? l.bedrooms + ' bd' : null, l.bathrooms ? l.bathrooms + ' ba' : null, esc(l.location)].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    const liveCount = this.listings.length;
    this.container.innerHTML = `
      <!-- Hero section -->
      <div class="mb-10 grid gap-6 md:grid-cols-2 md:items-center">
        <div>
          <h1 class="font-display text-4xl md:text-5xl mb-2">
            <span>${esc(heroLine1)}</span>
            <span class="text-accent">${esc(heroLine2)}</span>
          </h1>
          <p class="text-muted mb-4">${esc(heroSubtitle)}</p>
          <p class="text-sm font-semibold" role="status">${liveCount ? `${liveCount} home${liveCount === 1 ? "" : "s"} live now` : "New homes landing soon"}</p>
        </div>
        <div aria-hidden="true">
          <svg viewBox="0 0 400 300" class="w-full h-auto" role="img">
            <circle cx="318" cy="62" r="34" fill="var(--accent, #3A7D5C)" opacity="0.9"/>
            <circle cx="318" cy="62" r="46" fill="none" stroke="var(--accent, #3A7D5C)" stroke-width="2" opacity="0.35"/>
            <rect x="30" y="150" width="110" height="110" rx="4" fill="var(--surface2, #2c2c28)"/>
            <polygon points="25,150 85,105 145,150" fill="var(--accent, #3A7D5C)"/>
            <rect x="72" y="200" width="26" height="60" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.85"/>
            <rect x="44" y="168" width="22" height="22" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.5"/>
            <rect x="104" y="168" width="22" height="22" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.5"/>
            <rect x="160" y="110" width="130" height="150" rx="4" fill="var(--surface2, #2c2c28)"/>
            <polygon points="152,110 225,52 298,110" fill="var(--accent2, #E8A0A0)"/>
            <rect x="212" y="196" width="26" height="64" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.85"/>
            <rect x="176" y="130" width="24" height="24" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.5"/>
            <rect x="212" y="130" width="24" height="24" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.5"/>
            <rect x="248" y="130" width="24" height="24" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.5"/>
            <rect x="176" y="166" width="24" height="24" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.5"/>
            <rect x="248" y="166" width="24" height="24" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.5"/>
            <rect x="310" y="180" width="70" height="80" rx="4" fill="var(--surface2, #2c2c28)"/>
            <polygon points="306,180 345,148 384,180" fill="var(--accent, #3A7D5C)"/>
            <rect x="336" y="216" width="18" height="44" rx="2" fill="var(--paper, #f5f3ee)" opacity="0.85"/>
            <rect x="20" y="260" width="360" height="4" rx="2" fill="var(--muted, #9b9890)" opacity="0.5"/>
          </svg>
        </div>
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