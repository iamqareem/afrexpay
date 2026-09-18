// Yeezy Theme - Web Component Architecture
const money = (n, currency = "UGX") => `${currency} ${n.toLocaleString("en-UG")}`;

// --- Central State Store ---
class Store extends EventTarget {
  constructor() {
    super();
    this.state = {
      config: null,
      products: [],
      photos: {}, // productId -> [photo_paths]
      cart: [],
      view: 'grid', // 'grid' | 'detail'
      currentProductId: null,
      isCartOpen: false,
      isCheckoutOpen: false,
      confirmedOrderId: null,
      confirmedOrderPaid: false, // set from our own Stripe return redirect — UX banner only
    };
  }

  get(key) { return this.state[key]; }
  
  set(key, value) {
    this.state[key] = value;
    this.dispatchEvent(new CustomEvent('state-change', { detail: { key, value } }));
  }

  async init() {
    try {
      const [configRes, productsRes] = await Promise.all([
        fetch("/api/config").then(r => r.json()).catch(() => ({ config: {} })),
        fetch("/api/products").then(r => r.json()).catch(() => [])
      ]);
      
      this.set('config', configRes.config || {});
      this.set('products', productsRes);
      
      // Fetch photos for all products
      const photoPromises = productsRes.map(p => 
        fetch(`/api/media/for/product/${p.id}`)
          .then(r => r.ok ? r.json() : [])
          .then(photos => {
            this.state.photos[p.id] = photos.map(ph => ph.storage_path).filter(Boolean);
          })
          .catch(() => {
            this.state.photos[p.id] = [];
          })
      );
      await Promise.all(photoPromises);
      this.dispatchEvent(new CustomEvent('state-change', { detail: { key: 'photos' } }));
    } catch (err) {
      console.error("Store init error:", err);
    }
  }

  addToCart(productId, size) {
    const product = this.state.products.find(p => p.id === productId);
    if (!product) return;
    const cart = [...this.state.cart];
    const existing = cart.find(i => i.productId === productId && i.size === size);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ productId, name: product.name, size, qty: 1, priceMinor: product.price_minor });
    }
    this.set('cart', cart);
    this.set('isCartOpen', true);
  }

  updateCartQty(index, delta) {
    const cart = [...this.state.cart];
    cart[index].qty += delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    this.set('cart', cart);
  }

  removeFromCart(index) {
    const cart = [...this.state.cart];
    cart.splice(index, 1);
    this.set('cart', cart);
  }

  cartTotal() {
    return this.state.cart.reduce((sum, item) => sum + item.priceMinor * item.qty, 0);
  }
}

const store = new Store();

// --- Web Components ---

class YeezyApp extends HTMLElement {
  connectedCallback() {
    store.init();
    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'config') this.renderConfig();
      if (e.detail.key === 'view') this.updateView();
    });
    this.updateView();
  }
  
  renderConfig() {
    const config = store.get('config');
    document.title = `${config.storeName || ""} ${config.storeNameAccent || ""}`.trim() || "Storefront";
    const brandEls = document.querySelectorAll('.brand-name');
    brandEls.forEach(el => el.textContent = config.storeName || "Storefront");
    
    const footerEl = document.querySelector('#footer-text');
    if (footerEl) footerEl.textContent = config.footerText || "";
  }

  updateView() {
    const view = store.get('view');
    const grid = this.querySelector('yeezy-grid');
    const detail = this.querySelector('yeezy-detail');
    if (view === 'grid') {
      if (grid) grid.style.display = 'block';
      if (detail) detail.style.display = 'none';
    } else {
      if (grid) grid.style.display = 'none';
      if (detail) detail.style.display = 'block';
    }
  }
}

class YeezyHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="sticky top-0 z-40 bg-[#fff] border-b border-[#0000001f]">
        <div class="max-w-7xl mx-auto px-5 py-5 flex items-center justify-between">
          <div class="yeezy-font font-bold text-3xl tracking-tightest cursor-pointer" id="brand-logo">
            <span class="brand-name"></span>
          </div>
          <button id="cart-toggle" class="relative text-sm tracking-widest hover:opacity-50 transition-opacity yeezy-font">
            CART (<span id="cart-count">0</span>)
          </button>
        </div>
      </header>
    `;
    
    this.querySelector('#brand-logo').addEventListener('click', () => {
      store.set('view', 'grid');
      window.scrollTo(0,0);
    });
    this.querySelector('#cart-toggle').addEventListener('click', () => {
      store.set('isCartOpen', true);
    });
    
    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'cart') {
        const totalQty = store.get('cart').reduce((sum, i) => sum + i.qty, 0);
        this.querySelector('#cart-count').textContent = totalQty;
      }
    });
  }
}

class YeezyGrid extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section class="max-w-7xl mx-auto px-5 py-8">
        <div class="flex items-baseline justify-between mb-8">
          <h2 class="yeezy-font text-sm tracking-widest text-[#000000b3]">Products</h2>
          <p id="product-count" class="text-xs text-[#000000b3]">0 PIECES</p>
        </div>
        <div id="grid-container" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"></div>
      </section>
    `;
    
    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'products' || e.detail.key === 'photos') {
        this.render();
      }
    });
  }

  render() {
    const products = store.get('products');
    const photos = store.get('photos');
    this.querySelector('#product-count').textContent = `${products.length} PIECES`;
    
    const container = this.querySelector('#grid-container');
    container.innerHTML = '';
    
    products.forEach(p => {
      const card = document.createElement('yeezy-product-card');
      const imgPath = photos[p.id]?.[0];
      card.product = p;
      card.img = imgPath ? `/media/${imgPath}` : null;
      container.appendChild(card);
    });
  }
}

class YeezyProductCard extends HTMLElement {
  set product(val) { this._product = val; this.render(); }
  set img(val) { this._img = val; this.render(); }

  render() {
    if (!this._product) return;
    const currency = store.get('config')?.currency || "UGX";
    
    this.innerHTML = `
      <div class="product-card group cursor-pointer h-full flex flex-col">
        <div class="bg-[#f5f5f5] aspect-square overflow-hidden relative">
          ${this._img ? `<img src="${this._img}" alt="${this._product.name}" class="w-full h-full object-cover transition-transform duration-500" />` : `<div class="w-full h-full flex items-center justify-center text-[#000000b3] text-xs">NO IMAGE</div>`}
        </div>
        <div class="pt-3 pb-1 px-0 flex-1 flex flex-col">
          <p class="yeezy-font text-sm tracking-tightest text-[#000]">${this._product.name}</p>
          <p class="yeezy-font text-sm text-[#000] mt-auto pt-1">${money(this._product.price_minor, currency)}</p>
        </div>
      </div>
    `;
    
    this.firstElementChild.addEventListener('click', () => {
      store.set('currentProductId', this._product.id);
      store.set('view', 'detail');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

class YeezyDetail extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section class="max-w-6xl mx-auto px-5 py-8">
        <button id="back-btn" class="text-sm text-[#000000b3] hover:text-[#000] mb-6 flex items-center gap-2 transition-colors yeezy-font">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
          BACK
        </button>
        <div id="detail-content" class="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 hidden">
          <div class="bg-[#f5f5f5] aspect-square flex items-center justify-center overflow-hidden">
            <img id="d-img" src="" class="w-full h-full object-cover" />
          </div>
          <div class="flex flex-col justify-center">
            <p id="d-cat" class="text-xs text-[#000000b3] tracking-widest mb-2 yeezy-font"></p>
            <h1 id="d-name" class="yeezy-font text-3xl md:text-4xl font-bold tracking-tightest mb-2"></h1>
            <p id="d-blurb" class="text-sm text-[#000000b3] mb-4"></p>
            <p id="d-price" class="yeezy-font text-2xl font-bold mb-6"></p>
            <div id="d-sizes" class="flex flex-wrap gap-2 mb-6"></div>
            <p id="d-error" class="text-red-500 text-sm mb-3 hidden yeezy-font">PLEASE SELECT A SIZE</p>
            <button id="d-add" class="w-full bg-[#000] text-[#fff] py-4 hover:bg-[#000] transition-colors text-sm tracking-widest yeezy-font border border-[#000]">
              ADD TO CART
            </button>
          </div>
        </div>
      </section>
    `;
    
    this.querySelector('#back-btn').addEventListener('click', () => {
      store.set('view', 'grid');
    });

    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'view' && e.detail.value === 'detail') {
        this.render();
      }
    });
  }

  render() {
    const productId = store.get('currentProductId');
    const product = store.get('products').find(p => p.id === productId);
    if (!product) return;

    const photos = store.get('photos')[productId] || [];
    const mainImg = photos.length > 0 ? `/media/${photos[0]}` : '';
    const currency = store.get('config')?.currency || "UGX";

    this.querySelector('#detail-content').classList.remove('hidden');
    
    const imgEl = this.querySelector('#d-img');
    if (mainImg) {
      imgEl.src = mainImg;
      imgEl.style.display = 'block';
    } else {
      imgEl.style.display = 'none';
    }
    
    this.querySelector('#d-cat').textContent = product.category || '';
    this.querySelector('#d-name').textContent = product.name;
    this.querySelector('#d-blurb').textContent = product.blurb || '';
    this.querySelector('#d-price').textContent = money(product.price_minor, currency);
    
    const sizesContainer = this.querySelector('#d-sizes');
    let selectedSize = null;
    this.querySelector('#d-error').classList.add('hidden');
    
    if (product.sizes && product.sizes.length > 0) {
      sizesContainer.innerHTML = product.sizes.map((s, i) => `
        <button class="size-btn yeezy-font border border-[#0000001f] px-4 py-2 hover:border-[#000] transition-colors ${i===0?'border-[#000] font-bold':''}" data-size="${s}">${s}</button>
      `).join('');
      selectedSize = product.sizes[0];
      
      sizesContainer.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          sizesContainer.querySelectorAll('.size-btn').forEach(b => {
            b.classList.remove('border-[#000]', 'font-bold');
            b.classList.add('border-[#0000001f]');
          });
          btn.classList.remove('border-[#0000001f]');
          btn.classList.add('border-[#000]', 'font-bold');
          selectedSize = btn.getAttribute('data-size');
          this.querySelector('#d-error').classList.add('hidden');
        });
      });
    } else {
      sizesContainer.innerHTML = '<p class="text-[#000000b3] text-sm">No sizes available</p>';
    }

    const addBtn = this.querySelector('#d-add');
    const newAddBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newAddBtn, addBtn);
    
    newAddBtn.addEventListener('click', () => {
      if (!selectedSize && product.sizes && product.sizes.length > 0) {
        this.querySelector('#d-error').classList.remove('hidden');
        return;
      }
      store.addToCart(product.id, selectedSize || 'N/A');
    });
  }
}

class YeezyCart extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="c-overlay" class="fixed inset-0 bg-[#000000a6] z-50 hidden transition-opacity opacity-0"></div>
      <aside id="c-drawer" class="fixed top-0 right-0 h-full w-full sm:w-96 bg-[#fff] z-50 translate-x-full transition-transform duration-300 flex flex-col border-l border-[#0000001f]">
        <div class="flex items-center justify-between px-6 py-5 border-b border-[#0000001f]">
          <h3 class="yeezy-font text-xl font-bold tracking-tightest">CART</h3>
          <button id="c-close" class="text-[#000000b3] hover:text-[#000] text-2xl">&times;</button>
        </div>
        <div id="c-items" class="flex-1 overflow-y-auto px-6 py-4 space-y-4"></div>
        <div class="px-6 py-5 border-t border-[#0000001f] bg-[#fff]">
          <div class="flex justify-between mb-4">
            <span class="yeezy-font text-sm tracking-widest">TOTAL</span>
            <span id="c-total" class="yeezy-font font-bold"></span>
          </div>
          <button id="c-checkout" class="w-full bg-[#000] text-[#fff] py-4 hover:bg-[#000] transition-colors text-sm tracking-widest yeezy-font border border-[#000] disabled:opacity-40 disabled:cursor-not-allowed">
            CHECKOUT
          </button>
        </div>
      </aside>
    `;

    const overlay = this.querySelector('#c-overlay');
    const drawer = this.querySelector('#c-drawer');
    const closeBtn = this.querySelector('#c-close');
    const checkoutBtn = this.querySelector('#c-checkout');

    const closeCart = () => store.set('isCartOpen', false);
    overlay.addEventListener('click', closeCart);
    closeBtn.addEventListener('click', closeCart);
    checkoutBtn.addEventListener('click', () => {
      closeCart();
      store.set('isCheckoutOpen', true);
    });

    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'isCartOpen') {
        const isOpen = e.detail.value;
        if (isOpen) {
          overlay.classList.remove('hidden');
          setTimeout(() => {
            overlay.classList.remove('opacity-0');
            drawer.classList.remove('translate-x-full');
          }, 10);
        } else {
          drawer.classList.add('translate-x-full');
          overlay.classList.add('opacity-0');
          setTimeout(() => overlay.classList.add('hidden'), 300);
        }
      }
      if (e.detail.key === 'cart') this.render();
    });
    
    this.render();
  }

  render() {
    const cart = store.get('cart');
    const currency = store.get('config')?.currency || "UGX";
    const itemsContainer = this.querySelector('#c-items');
    this.querySelector('#c-total').textContent = money(store.cartTotal(), currency);
    this.querySelector('#c-checkout').disabled = cart.length === 0;

    if (cart.length === 0) {
      itemsContainer.innerHTML = `<p class="text-[#000000b3] text-center py-10 text-sm yeezy-font">YOUR CART IS EMPTY</p>`;
      return;
    }

    itemsContainer.innerHTML = cart.map((item, index) => `
      <div class="flex items-start justify-between gap-3 pb-4 border-b border-[#0000001f]">
        <div class="flex-1">
          <p class="text-sm font-medium yeezy-font">${item.name}</p>
          <p class="text-xs text-[#000000b3] yeezy-font">SIZE ${item.size}</p>
          <div class="flex items-center gap-3 mt-2">
            <button data-qdown="${index}" class="w-6 h-6 border border-[#0000001f] hover:border-[#000] flex items-center justify-center text-xs">-</button>
            <span class="text-sm">${item.qty}</span>
            <button data-qup="${index}" class="w-6 h-6 border border-[#0000001f] hover:border-[#000] flex items-center justify-center text-xs">+</button>
            <button data-rem="${index}" class="ml-auto text-xs text-[#000000b3] hover:underline">REMOVE</button>
          </div>
        </div>
        <span class="font-bold whitespace-nowrap yeezy-font">${money(item.priceMinor * item.qty, currency)}</span>
      </div>
    `).join('');

    itemsContainer.querySelectorAll('[data-qup]').forEach(b => b.addEventListener('click', () => store.updateCartQty(Number(b.getAttribute('data-qup')), 1)));
    itemsContainer.querySelectorAll('[data-qdown]').forEach(b => b.addEventListener('click', () => store.updateCartQty(Number(b.getAttribute('data-qdown')), -1)));
    itemsContainer.querySelectorAll('[data-rem]').forEach(b => b.addEventListener('click', () => store.removeFromCart(Number(b.getAttribute('data-rem')))));
  }
}

class YeezyCheckout extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="co-overlay" class="fixed inset-0 bg-[#000000a6] z-[60] hidden items-center justify-center px-4 transition-opacity opacity-0">
        <div id="co-modal" class="bg-[#fff] border border-[#0000001f] max-w-md w-full p-6 max-h-[90vh] overflow-y-auto scale-95 transition-transform duration-300">
          <div class="flex items-center justify-between mb-5">
            <h3 class="yeezy-font text-xl font-bold tracking-tightest">DELIVERY</h3>
            <button id="co-close" class="text-[#000000b3] hover:text-[#000] text-2xl leading-none">&times;</button>
          </div>
          <form id="co-form" class="space-y-4">
            <div>
              <label class="block yeezy-font text-xs tracking-widest text-[#000000b3] mb-1">FULL NAME</label>
              <input name="customerName" required class="w-full bg-[#f5f5f5] border border-[#0000001f] px-3 py-3 text-sm focus:outline-none focus:border-[#000]" />
            </div>
            <div>
              <label class="block yeezy-font text-xs tracking-widest text-[#000000b3] mb-1">PHONE</label>
              <input name="phone" required class="w-full bg-[#f5f5f5] border border-[#0000001f] px-3 py-3 text-sm focus:outline-none focus:border-[#000]" placeholder="07XXXXXXXX" />
            </div>
            <div>
              <label class="block yeezy-font text-xs tracking-widest text-[#000000b3] mb-1">ADDRESS</label>
              <textarea name="address" required rows="2" class="w-full bg-[#f5f5f5] border border-[#0000001f] px-3 py-3 text-sm focus:outline-none focus:border-[#000]"></textarea>
            </div>
            <div>
              <label class="block yeezy-font text-xs tracking-widest text-[#000000b3] mb-1">NOTES</label>
              <textarea name="deliveryNotes" rows="2" class="w-full bg-[#f5f5f5] border border-[#0000001f] px-3 py-3 text-sm focus:outline-none focus:border-[#000]"></textarea>
            </div>
            <p id="co-error" class="text-red-500 text-sm hidden"></p>
            <button type="submit" id="co-submit" class="w-full bg-[#000] text-[#fff] py-4 hover:bg-[#000] transition-colors text-sm tracking-widest yeezy-font border border-[#000]">
              PLACE ORDER
            </button>
          </form>
        </div>
      </div>
      
      <div id="cf-overlay" class="fixed inset-0 bg-[#000000a6] z-[60] hidden items-center justify-center px-4">
        <div class="bg-[#fff] border border-[#0000001f] max-w-md w-full p-6 text-center">
          <p class="yeezy-font text-xs tracking-widest text-[#000000b3] mb-2">CONFIRMED</p>
          <h3 class="yeezy-font text-2xl font-bold tracking-tightest mb-4">ORDER #<span id="cf-id"></span></h3>
          <p id="cf-paid" class="yeezy-font text-sm font-bold mb-4 hidden">Payment received ✓ — thanks!</p>
          <p class="text-sm text-[#000000b3] mb-6">We'll reach out to confirm delivery and payment.</p>
          <p id="cf-pay-error" class="text-red-500 text-sm hidden mb-4"></p>
          <button id="cf-pay" class="w-full bg-[#000] text-[#fff] py-4 hover:bg-[#000] transition-colors text-sm tracking-widest yeezy-font border border-[#000] mb-3">PAY NOW WITH CARD</button>
          <button id="cf-close" class="w-full bg-[#fff] text-[#000] py-4 hover:bg-[#000] hover:text-[#fff] transition-colors text-sm tracking-widest yeezy-font border border-[#000]">DONE</button>
        </div>
      </div>
    `;

    const overlay = this.querySelector('#co-overlay');
    const modal = this.querySelector('#co-modal');
    
    this.querySelector('#co-close').addEventListener('click', () => store.set('isCheckoutOpen', false));
    this.querySelector('#cf-close').addEventListener('click', () => store.set('confirmedOrderId', null));

    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'isCheckoutOpen') {
        if (e.detail.value) {
          overlay.classList.remove('hidden');
          overlay.classList.add('flex');
          setTimeout(() => {
            overlay.classList.remove('opacity-0');
            modal.classList.remove('scale-95');
          }, 10);
        } else {
          overlay.classList.add('opacity-0');
          modal.classList.add('scale-95');
          setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
          }, 300);
        }
      }
      if (e.detail.key === 'confirmedOrderId') {
        const id = e.detail.value;
        const cfOverlay = this.querySelector('#cf-overlay');
        if (id) {
          const paid = !!store.get('confirmedOrderPaid');
          this.querySelector('#cf-id').textContent = id.slice(0, 8);
          // Paid banner is UX feedback only — the order's real
          // payment_status is set server-side by the Stripe webhook.
          this.querySelector('#cf-paid').classList.toggle('hidden', !paid);
          this.querySelector('#cf-pay').classList.toggle('hidden', paid);
          this.querySelector('#cf-pay-error').classList.add('hidden');
          cfOverlay.classList.remove('hidden');
          cfOverlay.classList.add('flex');
        } else {
          cfOverlay.classList.add('hidden');
          cfOverlay.classList.remove('flex');
        }
      }
    });

    this.querySelector('#co-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errorEl = this.querySelector('#co-error');
      const submitBtn = this.querySelector('#co-submit');
      errorEl.classList.add('hidden');

      const payload = {
        customerName: form.customerName.value.trim(),
        phone: form.phone.value.trim(),
        address: form.address.value.trim(),
        deliveryNotes: form.deliveryNotes.value.trim(),
        items: store.get('cart').map(i => ({ productId: i.productId, size: i.size, qty: i.qty })),
      };

      submitBtn.disabled = true;
      submitBtn.textContent = "PLACING ORDER...";

      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong.");

        store.set('cart', []);
        form.reset();
        store.set('isCheckoutOpen', false);
        store.set('confirmedOrderPaid', false);
        store.set('confirmedOrderId', data.id);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "PLACE ORDER";
      }
    });

    // Optional card payment on top of the existing cash order — starts a
    // Stripe Checkout session and hands the browser to Stripe's hosted
    // page. The cash order stays valid regardless of what happens next.
    this.querySelector('#cf-pay').addEventListener('click', async () => {
      const orderId = store.get('confirmedOrderId');
      if (!orderId) return;
      const payBtn = this.querySelector('#cf-pay');
      const payError = this.querySelector('#cf-pay-error');
      payError.classList.add('hidden');
      payBtn.disabled = true;
      payBtn.textContent = "REDIRECTING TO STRIPE...";

      try {
        const returnUrl = new URL(window.location.href);
        returnUrl.search = "";
        returnUrl.searchParams.set("order", orderId);
        const successUrl = new URL(returnUrl); successUrl.searchParams.set("paid", "1");
        const cancelUrl = returnUrl.toString();

        const res = await fetch(`/api/orders/${orderId}/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ successUrl: successUrl.toString(), cancelUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start checkout.");

        window.location.href = data.checkoutUrl;
      } catch (err) {
        payError.textContent = err.message;
        payError.classList.remove('hidden');
        payBtn.disabled = false;
        payBtn.textContent = "PAY NOW WITH CARD";
      }
    });

    // If Stripe redirected back here (successUrl/cancelUrl both point at
    // this same page with an `order` param), reopen the confirmation —
    // with the paid banner when `paid=1` is present.
    const params = new URLSearchParams(window.location.search);
    const returnOrderId = params.get("order");
    if (returnOrderId) {
      store.set('confirmedOrderPaid', params.get("paid") === "1");
      store.set('confirmedOrderId', returnOrderId);
    }
  }
}

customElements.define('yeezy-app', YeezyApp);
customElements.define('yeezy-header', YeezyHeader);
customElements.define('yeezy-grid', YeezyGrid);
customElements.define('yeezy-product-card', YeezyProductCard);
customElements.define('yeezy-detail', YeezyDetail);
customElements.define('yeezy-cart', YeezyCart);
customElements.define('yeezy-checkout', YeezyCheckout);
