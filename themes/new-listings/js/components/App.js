import { applyConfig, setText, getParam } from '../helpers.js';
import ThemeToggle from './ThemeToggle.js';
import ListingGrid from './ListingGrid.js';
import DetailView from './DetailView.js';

export default class App {
  constructor() {
    this.root = document.getElementById('app-root');
    this.config = null;
    this.listings = [];
    this.selectedListing = null;

    new ThemeToggle(document.getElementById('theme-toggle-container'));
    this.init();
  }

  async init() {
    // fetch config
    const configRes = await fetch('/api/config');
    const configData = await configRes.json();
    this.config = configData.config || {};
    applyConfig(this.config);

    // set page title, brand, hero fields
    setText('page-title', this.config.storeName || 'Listings');
    setText('brand-name', this.config.storeName || '');
    setText('brand-accent', this.config.storeNameAccent || '');

    // fetch listings
    const listingsRes = await fetch('/api/listings');
    this.listings = await listingsRes.json();

    // check query param for specific listing (return from Stripe)
    const listingId = getParam('listing');
    if (listingId) {
      const found = this.listings.find(l => l.id === listingId);
      if (found) {
        this.selectedListing = found;
        // we'll handle reservation confirmation in showDetail
      }
    }

    this.render();
  }

  render() {
    if (this.selectedListing) {
      this.showDetail(this.selectedListing);
    } else {
      this.showGrid();
    }
  }

  showGrid() {
    this.root.innerHTML = '';
    new ListingGrid(this.root, this.listings, this.config, (id) => {
      const listing = this.listings.find(l => l.id === id);
      if (listing) {
        this.selectedListing = listing;
        const url = new URL(window.location);
        url.searchParams.set('listing', id);
        history.pushState({ listingId: id }, '', url);
        this.render();
      }
    });
  }

  showDetail(listing) {
    this.root.innerHTML = '';
    const view = new DetailView(this.root, listing, this.config, () => {
      this.selectedListing = null;
      const url = new URL(window.location);
      url.searchParams.delete('listing');
      url.searchParams.delete('reservation');
      history.pushState({}, '', url);
      this.render();
    });

    // if we came back from Stripe with 'reservation' param, show confirmation
    if (getParam('reservation')) {
      const formsContainer = document.getElementById('forms-container');
      if (formsContainer) {
        const confirmedDiv = document.createElement('div');
        confirmedDiv.className = 'max-w-md bg-surface border border-surface2 rounded-lg p-5 mt-4';
        confirmedDiv.innerHTML = `
          <p class="text-accent font-semibold mb-1">Deposit received ✓</p>
          <p class="text-muted text-sm">Your reservation is confirmed. The merchant will be in touch shortly.</p>
        `;
        formsContainer.parentNode.insertBefore(confirmedDiv, formsContainer.nextSibling);
      }
      // clean query param
      const url = new URL(window.location);
      url.searchParams.delete('reservation');
      history.replaceState({}, '', url);
    }
  }
}