import { money } from '../helpers.js';

export default class ReservationForm {
  constructor(container, listing, config) {
    this.container = container;
    this.listing = listing;
    this.config = config;
    this.processing = false;
    this.error = null;
    this.render();
  }

  render() {
    this.container.innerHTML += `
      <div class="max-w-md bg-surface border border-surface2 rounded-lg p-5 mb-4" id="reservation-panel">
        <h3 class="font-semibold mb-1">Reserve this listing</h3>
        <p class="text-muted text-sm mb-3">A deposit of <span class="text-accent font-semibold" id="deposit-amount">${money(this.listing.deposit_amount_minor, this.config?.currency)}</span> secures your reservation.</p>
        <form id="reservation-form" class="space-y-3">
          <div>
            <label class="block text-xs text-muted mb-1">Name</label>
            <input name="name" required class="w-full bg-ink border border-surface2 rounded-md px-3 py-2" />
          </div>
          <div>
            <label class="block text-xs text-muted mb-1">Phone</label>
            <input name="phone" required class="w-full bg-ink border border-surface2 rounded-md px-3 py-2" />
          </div>
          <div>
            <label class="block text-xs text-muted mb-1">Message (optional)</label>
            <textarea name="message" rows="2" class="w-full bg-ink border border-surface2 rounded-md px-3 py-2"></textarea>
          </div>
          <p id="reservation-error" class="text-sm hidden" style="color:#e5534b;">${this.error || ''}</p>
          <button type="submit" id="reservation-submit" class="w-full bg-accent text-onaccent font-bold py-2.5 rounded-md" ${this.processing ? 'disabled' : ''}>
            ${this.processing ? 'PROCESSING...' : 'PAY DEPOSIT TO RESERVE'}
          </button>
        </form>
      </div>
    `;

    document.getElementById('reservation-form').addEventListener('submit', (e) => this.handleSubmit(e));
  }

  async handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const errorEl = document.getElementById('reservation-error');
    const submitBtn = document.getElementById('reservation-submit');
    errorEl.classList.add('hidden');
    this.processing = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'PROCESSING...';

    try {
      // 1. create reservation
      const createRes = await fetch('/api/listing-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: this.listing.id,
          name: form.name.value.trim(),
          phone: form.phone.value.trim(),
          message: form.message.value.trim(),
        }),
      });
      const reservation = await createRes.json();
      if (!createRes.ok) throw new Error(reservation.error || 'Could not create reservation.');

      // 2. get checkout URL
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set('listing', this.listing.id);
      const successUrl = new URL(returnUrl);
      successUrl.searchParams.set('reservation', reservation.id);
      const cancelUrl = returnUrl.toString();

      const checkoutRes = await fetch(`/api/listing-reservations/${reservation.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ successUrl: successUrl.toString(), cancelUrl }),
      });
      const checkout = await checkoutRes.json();
      if (!checkoutRes.ok) throw new Error(checkout.error || 'Could not start checkout.');

      // 3. redirect to Stripe
      window.location.href = checkout.checkoutUrl;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      this.processing = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'PAY DEPOSIT TO RESERVE';
    }
  }
}