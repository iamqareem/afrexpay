import { money } from '../helpers.js';
import InquiryForm from './InquiryForm.js';
import ReservationForm from './ReservationForm.js';

export default class DetailView {
  constructor(container, listing, config, onBack) {
    this.container = container;
    this.listing = listing;
    this.config = config;
    this.onBack = onBack;
    this.inquiryForm = null;
    this.reservationForm = null;
    this.render();
  }

  async render() {
    const l = this.listing;
    const currency = this.config?.currency || 'USD';

    // fetch photos
    let photosHtml = '';
    try {
      const res = await fetch(`/api/media/for/listing/${l.id}`);
      const photos = res.ok ? await res.json() : [];
      photosHtml = photos.length
        ? photos.map(p => `<img src="/media/${p.storage_path}" class="w-full aspect-video object-cover rounded-md" />`).join('')
        : `<div class="col-span-2 aspect-video bg-surface2 rounded-md"></div>`;
    } catch (e) {
      photosHtml = `<div class="col-span-2 aspect-video bg-surface2 rounded-md"></div>`;
    }

    this.container.innerHTML = `
      <div>
        <button id="back-btn" class="text-accent text-sm mb-4">&larr; Back to listings</button>
        <div class="grid grid-cols-2 gap-2 mb-6">${photosHtml}</div>
        <h2 class="font-display text-2xl mb-1">${l.title}</h2>
        <p class="text-accent text-lg font-semibold mb-2">${money(l.price_minor, currency)}</p>
        <p class="text-muted text-sm mb-4">${[l.bedrooms ? l.bedrooms + ' bedrooms' : null, l.bathrooms ? l.bathrooms + ' bathrooms' : null, l.area_sqm ? l.area_sqm + ' sqm' : null, l.location].filter(Boolean).join(' · ')}</p>
        <p class="mb-8">${l.description || ''}</p>

        <div id="forms-container"></div>
      </div>
    `;

    document.getElementById('back-btn').addEventListener('click', this.onBack);

    // Mount forms inside #forms-container
    const formsContainer = document.getElementById('forms-container');
    // Reservation form (only if deposit)
    if (l.deposit_amount_minor) {
      this.reservationForm = new ReservationForm(formsContainer, l, this.config);
    }
    // Inquiry form (always)
    this.inquiryForm = new InquiryForm(formsContainer, l);
  }
}