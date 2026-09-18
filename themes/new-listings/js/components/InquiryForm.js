export default class InquiryForm {
  constructor(container, listing) {
    this.container = container;
    this.listing = listing;
    this.sent = false;
    this.error = null;
    this.render();
  }

  render() {
    // If already sent, we still render the hidden form and the success message
    const formDisplay = this.sent ? 'display:none' : '';
    const sentDisplay = this.sent ? '' : 'display:none';
    this.container.innerHTML += `
      <div class="max-w-md bg-surface border border-surface2 rounded-lg p-5 mt-4" id="inquiry-form-wrapper">
        <h3 class="font-semibold mb-3">Interested? Send an inquiry</h3>
        <form id="inquiry-form" class="space-y-3" style="${formDisplay}">
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
          <p id="inquiry-error" class="text-sm hidden" style="color:#e5534b;">${this.error || ''}</p>
          <button type="submit" class="w-full bg-accent text-onaccent font-bold py-2.5 rounded-md">SEND INQUIRY</button>
        </form>
        <div id="inquiry-sent" class="text-center py-4" style="${sentDisplay}">
          <p>Thanks — we'll be in touch shortly.</p>
        </div>
      </div>
    `;

    const form = document.getElementById('inquiry-form');
    if (form) {
      form.addEventListener('submit', (e) => this.handleSubmit(e));
    }
  }

  async handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const errorEl = document.getElementById('inquiry-error');
    errorEl.classList.add('hidden');

    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: this.listing.id,
          name: form.name.value.trim(),
          phone: form.phone.value.trim(),
          message: form.message.value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send inquiry.');
      this.sent = true;
      form.style.display = 'none';
      document.getElementById('inquiry-sent').style.display = 'block';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }
}