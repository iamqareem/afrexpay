// Automobile Theme - Web Component Architecture (Material You / Tesla aesthetic)
// Zero-decimal mirror of src/lib/currency.js (static bundles can't require
// node modules — keep in sync, both point at the Stripe list).
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const money = (n, currency = "UGX") => {
  const code = String(currency || "UGX").toUpperCase();
  if (ZERO_DECIMAL.has(code)) return `${code} ${Number(n).toLocaleString("en-UG")}`;
  return `${code} ${(Number(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

class Store extends EventTarget {
  constructor() {
    super();
    this.state = {
      config: null,
      products: [],
      photos: {},
      cart: [],
      categories: [],
      selectedCategory: 'All',
      currentProductId: null,
      isQuickViewOpen: false,
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

      const cats = new Set(productsRes.map(p => p.category).filter(Boolean));
      this.set('categories', ['All', ...Array.from(cats)]);
      
      const photoPromises = productsRes.map(p => 
        fetch(`/api/media/for/product/${p.id}`)
          .then(r => r.ok ? r.json() : [])
          .then(photos => {
            this.state.photos[p.id] = photos.map(ph => ph.storage_path).filter(Boolean);
          })
          .catch(() => { this.state.photos[p.id] = []; })
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

class AutoApp extends HTMLElement {
  connectedCallback() {
    store.init();
    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'config') this.renderConfig();
    });
  }
  
  renderConfig() {
    const config = store.get('config');
    document.title = `${config.storeName || ""} ${config.storeNameAccent || ""}`.trim() || "Storefront";
    if (config.accentColor) document.documentElement.style.setProperty("--accent", config.accentColor);
    
    const footerEl = document.querySelector('#footer-text');
    if (footerEl) footerEl.textContent = config.footerText || "";
  }
}

class AutoHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="fixed top-0 left-0 right-0 z-40 bg-surface/90 backdrop-blur-md">
        <div class="max-w-7xl mx-auto px-5 py-4 flex items-center justify-between">
          <div class="text-2xl font-bold tracking-tight text-onSurface cursor-pointer" id="brand-logo">
            <span id="h-brand"></span><span id="h-accent" class="text-primary ml-1"></span>
          </div>
          <button id="cart-toggle" class="flex items-center gap-2 btn-outline border-none !px-4 !py-2 hover:bg-surfaceVariant text-sm">
            CART
            <span id="cart-count" class="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-full bg-primary text-onPrimary text-xs font-bold px-1">0</span>
          </button>
        </div>
      </header>
    `;
    
    this.querySelector('#cart-toggle').addEventListener('click', () => store.set('isCartOpen', true));
    
    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'cart') {
        const totalQty = store.get('cart').reduce((sum, i) => sum + i.qty, 0);
        this.querySelector('#cart-count').textContent = totalQty;
      }
      if (e.detail.key === 'config') {
        const config = store.get('config');
        this.querySelector('#h-brand').textContent = config.storeName || "AUTO";
        this.querySelector('#h-accent').textContent = config.storeNameAccent || "";
      }
    });
  }
}

class AutoHero extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section class="w-full h-[70vh] md:h-[85vh] bg-surfaceVariant flex flex-col items-center justify-center text-center px-5 relative mt-16 overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-b from-transparent to-surface/20 z-0"></div>
        <div class="z-10 max-w-4xl">
          <p id="h-tagline" class="text-primary font-bold tracking-widest uppercase text-sm mb-4"></p>
          <h1 class="text-5xl md:text-7xl font-extrabold tracking-tight text-onSurface mb-6 leading-tight">
            <span id="h-line1"></span><br/><span id="h-line2" class="text-onSurfaceVariant"></span>
          </h1>
          <p id="h-subtitle" class="text-lg md:text-xl text-onSurfaceVariant max-w-2xl mx-auto"></p>
        </div>
      </section>
    `;
    
    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'config') {
        const config = store.get('config');
        this.querySelector('#h-tagline').textContent = config.tagline || "";
        this.querySelector('#h-line1').textContent = config.heroTitleLine1 || "";
        this.querySelector('#h-line2').textContent = config.heroTitleLine2 || "";
        this.querySelector('#h-subtitle').textContent = config.heroSubtitle || "";
      }
    });
  }
}



class AutoGrid extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-8 mt-6">
          <h2 class="text-2xl font-bold tracking-tight text-onSurface">Featured Models</h2>
          <p id="product-count" class="text-sm font-medium text-onSurfaceVariant px-4 py-2 bg-surfaceVariant rounded-full">0 items</p>
        </div>
        <div id="grid-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"></div>
      </div>
    `;
    
    store.addEventListener('state-change', (e) => {
      if (['products', 'photos', 'selectedCategory'].includes(e.detail.key)) {
        this.render();
      }
    });
  }

  render() {
    const allProducts = store.get('products');
    const category = store.get('selectedCategory') || 'All';
    const products = category === 'All' ? allProducts : allProducts.filter(p => p.category === category);
    const photos = store.get('photos');
    this.querySelector('#product-count').textContent = `${products.length} items`;
    
    const container = this.querySelector('#grid-container');
    container.innerHTML = '';
    
    products.forEach(p => {
      const card = document.createElement('auto-product-card');
      const imgPath = photos[p.id]?.[0];
      card.product = p;
      card.img = imgPath ? `/media/${imgPath}` : null;
      container.appendChild(card);
    });
  }
}

class AutoProductCard extends HTMLElement {
  set product(val) { this._product = val; this.render(); }
  set img(val) { this._img = val; this.render(); }

  render() {
    if (!this._product) return;
    const currency = store.get('config')?.currency || "UGX";
    
    this.innerHTML = `
      <div class="card cursor-pointer group h-full flex flex-col">
        <div class="aspect-[4/3] bg-surfaceVariant p-8 flex items-center justify-center relative overflow-hidden rounded-t-4xl">
          ${this._img ? `<img src="${this._img}" class="w-full h-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform duration-500" />` : `<div class="text-onSurfaceVariant text-sm font-medium">NO IMAGE</div>`}
        </div>
        <div class="p-6 md:p-8 flex flex-col flex-1 bg-surface">
          ${this._product.category ? `<span class="text-xs font-bold text-primary uppercase tracking-wider mb-2">${this._product.category}</span>` : ''}
          <h3 class="text-2xl font-bold text-onSurface mb-2 tracking-tight">${this._product.name}</h3>
          <p class="text-onSurfaceVariant text-sm line-clamp-2 mb-6">${this._product.blurb || ''}</p>
          <div class="mt-auto flex items-center justify-between">
             <span class="text-lg font-bold text-onSurface">${money(this._product.price_minor, currency)}</span>
             <button class="btn-outline !py-2 !px-4 text-sm opacity-0 group-hover:opacity-100 transition-opacity">Details</button>
          </div>
        </div>
      </div>
    `;
    
    this.firstElementChild.addEventListener('click', () => {
      store.set('currentProductId', this._product.id);
      store.set('isQuickViewOpen', true);
    });
  }
}

class AutoQuickView extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="qv-overlay" class="fixed inset-0 bg-onSurface/40 z-[60] hidden items-center justify-center px-4 transition-opacity opacity-0 backdrop-blur-sm">
        <div id="qv-modal" class="bg-surface rounded-4xl max-w-5xl w-full max-h-[90vh] overflow-y-auto scale-95 transition-transform duration-300 flex flex-col lg:flex-row shadow-float border border-surfaceVariant">
          <div class="w-full lg:w-3/5 bg-surfaceVariant p-10 flex items-center justify-center min-h-[40vh] rounded-t-4xl lg:rounded-l-4xl lg:rounded-tr-none">
             <img id="qv-img" src="" class="w-full h-full object-contain mix-blend-multiply drop-shadow-2xl" />
          </div>
          <div class="w-full lg:w-2/5 p-10 relative flex flex-col">
            <button id="qv-close" class="absolute top-6 right-6 w-10 h-10 bg-surfaceVariant hover:bg-onSurfaceVariant hover:text-surface rounded-full flex items-center justify-center transition-colors text-xl leading-none">&times;</button>
            <p id="qv-cat" class="text-xs font-bold text-primary uppercase tracking-wider mb-3"></p>
            <h2 id="qv-name" class="text-4xl font-extrabold text-onSurface mb-4 tracking-tight leading-none"></h2>
            <p id="qv-price" class="text-2xl font-medium text-onSurfaceVariant mb-8"></p>
            <p id="qv-blurb" class="text-onSurface leading-relaxed mb-8 flex-1"></p>
            
            <div class="mb-8 bg-surfaceVariant p-6 rounded-3xl">
              <label class="block text-sm font-bold text-onSurface mb-3">Configuration</label>
              <select id="qv-size" class="w-full bg-surface border-none rounded-xl px-4 py-4 text-onSurface focus:ring-2 focus:ring-primary font-medium shadow-sm">
              </select>
            </div>
            
            <p id="qv-error" class="text-red-500 text-sm font-medium mb-3 hidden">Please select a configuration.</p>
            <button id="qv-add" class="btn-primary w-full py-4 text-lg">Order Now</button>
          </div>
        </div>
      </div>
    `;

    const overlay = this.querySelector('#qv-overlay');
    const modal = this.querySelector('#qv-modal');
    
    const closeQV = () => store.set('isQuickViewOpen', false);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeQV();
    });
    this.querySelector('#qv-close').addEventListener('click', closeQV);

    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'isQuickViewOpen') {
        if (e.detail.value) {
          this.render();
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
    });
  }

  render() {
    const productId = store.get('currentProductId');
    const product = store.get('products').find(p => p.id === productId);
    if (!product) return;

    const photos = store.get('photos')[productId] || [];
    const mainImg = photos.length > 0 ? `/media/${photos[0]}` : '';
    const currency = store.get('config')?.currency || "UGX";

    const imgEl = this.querySelector('#qv-img');
    if (mainImg) {
      imgEl.src = mainImg;
      imgEl.style.display = 'block';
    } else {
      imgEl.style.display = 'none';
    }
    
    this.querySelector('#qv-cat').textContent = product.category || '';
    this.querySelector('#qv-name').textContent = product.name;
    this.querySelector('#qv-blurb').textContent = product.blurb || '';
    this.querySelector('#qv-price').textContent = money(product.price_minor, currency);
    
    const selectEl = this.querySelector('#qv-size');
    selectEl.innerHTML = '';
    
    if (product.sizes && product.sizes.length > 0) {
      selectEl.innerHTML = product.sizes.map(s => `<option value="${s}">${s}</option>`).join('');
      selectEl.disabled = false;
    } else {
      selectEl.innerHTML = `<option value="">Standard Configuration</option>`;
      selectEl.disabled = true;
    }

    const addBtn = this.querySelector('#qv-add');
    const newAddBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newAddBtn, addBtn);
    
    newAddBtn.addEventListener('click', () => {
      const selectedSize = selectEl.value;
      if (!selectedSize && product.sizes && product.sizes.length > 0) {
        this.querySelector('#qv-error').classList.remove('hidden');
        return;
      }
      this.querySelector('#qv-error').classList.add('hidden');
      store.addToCart(product.id, selectedSize || 'Standard');
      store.set('isQuickViewOpen', false);
    });
  }
}

class AutoCart extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="c-overlay" class="fixed inset-0 bg-onSurface/40 z-50 hidden transition-opacity opacity-0 backdrop-blur-sm"></div>
      <aside id="c-drawer" class="fixed top-0 right-0 h-full w-full sm:w-[450px] bg-surface z-50 translate-x-full transition-transform duration-300 flex flex-col shadow-float rounded-l-4xl border-l border-surfaceVariant">
        <div class="flex items-center justify-between px-8 py-8 border-b border-surfaceVariant">
          <h3 class="text-2xl font-bold tracking-tight text-onSurface">Your Cart</h3>
          <button id="c-close" class="w-10 h-10 bg-surfaceVariant hover:bg-onSurfaceVariant hover:text-surface rounded-full flex items-center justify-center transition-colors text-xl leading-none">&times;</button>
        </div>
        <div id="c-items" class="flex-1 overflow-y-auto px-8 py-6 space-y-6"></div>
        <div class="px-8 py-8 border-t border-surfaceVariant bg-surfaceVariant/50">
          <div class="flex justify-between items-center mb-8">
            <span class="text-lg font-medium text-onSurfaceVariant">Subtotal</span>
            <span id="c-total" class="text-2xl font-bold text-onSurface"></span>
          </div>
          <button id="c-checkout" class="btn-primary w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed">
            Continue to Checkout
          </button>
        </div>
      </aside>
    `;

    const overlay = this.querySelector('#c-overlay');
    const drawer = this.querySelector('#c-drawer');
    
    const closeCart = () => store.set('isCartOpen', false);
    overlay.addEventListener('click', closeCart);
    this.querySelector('#c-close').addEventListener('click', closeCart);
    
    this.querySelector('#c-checkout').addEventListener('click', () => {
      closeCart();
      store.set('isCheckoutOpen', true);
    });

    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'isCartOpen') {
        if (e.detail.value) {
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
      itemsContainer.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-onSurfaceVariant text-center"><p class="text-lg font-medium">Your cart is empty.</p><p class="text-sm mt-2">Add some items to get started.</p></div>`;
      return;
    }

    itemsContainer.innerHTML = cart.map((item, index) => `
      <div class="flex flex-col gap-3 pb-6 border-b border-surfaceVariant last:border-0 last:pb-0">
        <div class="flex justify-between items-start">
          <div>
            <p class="font-bold text-lg text-onSurface mb-1">${item.name}</p>
            <p class="text-sm text-onSurfaceVariant font-medium">Config: ${item.size}</p>
          </div>
          <span class="font-bold text-onSurface">${money(item.priceMinor * item.qty, currency)}</span>
        </div>
        <div class="flex items-center justify-between mt-2">
          <div class="flex items-center gap-4 bg-surfaceVariant rounded-full px-2 py-1">
            <button data-qdown="${index}" class="w-8 h-8 rounded-full flex items-center justify-center text-onSurfaceVariant hover:bg-surface hover:text-onSurface transition-colors font-bold">-</button>
            <span class="text-sm font-bold w-4 text-center">${item.qty}</span>
            <button data-qup="${index}" class="w-8 h-8 rounded-full flex items-center justify-center text-onSurfaceVariant hover:bg-surface hover:text-onSurface transition-colors font-bold">+</button>
          </div>
          <button data-rem="${index}" class="text-sm font-medium text-red-500 hover:text-red-700 transition-colors px-4 py-2">Remove</button>
        </div>
      </div>
    `).join('');

    itemsContainer.querySelectorAll('[data-qup]').forEach(b => b.addEventListener('click', () => store.updateCartQty(Number(b.getAttribute('data-qup')), 1)));
    itemsContainer.querySelectorAll('[data-qdown]').forEach(b => b.addEventListener('click', () => store.updateCartQty(Number(b.getAttribute('data-qdown')), -1)));
    itemsContainer.querySelectorAll('[data-rem]').forEach(b => b.addEventListener('click', () => store.removeFromCart(Number(b.getAttribute('data-rem')))));
  }
}

class AutoCheckout extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="co-overlay" class="fixed inset-0 bg-onSurface/40 z-[60] hidden items-center justify-center px-4 transition-opacity opacity-0 backdrop-blur-sm">
        <div id="co-modal" class="bg-surface rounded-4xl max-w-xl w-full p-8 md:p-12 max-h-[90vh] overflow-y-auto scale-95 transition-transform duration-300 shadow-float border border-surfaceVariant">
          <div class="flex items-center justify-between mb-8">
            <h3 class="text-3xl font-extrabold text-onSurface tracking-tight">Checkout</h3>
            <button id="co-close" class="w-10 h-10 bg-surfaceVariant hover:bg-onSurfaceVariant hover:text-surface rounded-full flex items-center justify-center transition-colors text-xl leading-none">&times;</button>
          </div>
          <form id="co-form" class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="md:col-span-2">
                <label class="block text-sm font-bold text-onSurface mb-2">Full Name</label>
                <input name="customerName" required class="w-full bg-surfaceVariant border-none rounded-xl px-4 py-4 text-onSurface focus:ring-2 focus:ring-primary font-medium" />
              </div>
              <div class="md:col-span-2">
                <label class="block text-sm font-bold text-onSurface mb-2">Phone Number</label>
                <input name="phone" required class="w-full bg-surfaceVariant border-none rounded-xl px-4 py-4 text-onSurface focus:ring-2 focus:ring-primary font-medium" placeholder="+256 7XX XXX XXX" />
              </div>
              <div class="md:col-span-2">
                <label class="block text-sm font-bold text-onSurface mb-2">Delivery Address</label>
                <textarea name="address" required rows="3" class="w-full bg-surfaceVariant border-none rounded-xl px-4 py-4 text-onSurface focus:ring-2 focus:ring-primary font-medium resize-none"></textarea>
              </div>
              <div class="md:col-span-2">
                <label class="block text-sm font-bold text-onSurface mb-2">Special Instructions (Optional)</label>
                <textarea name="deliveryNotes" rows="2" class="w-full bg-surfaceVariant border-none rounded-xl px-4 py-4 text-onSurface focus:ring-2 focus:ring-primary font-medium resize-none"></textarea>
              </div>
            </div>
            <p id="co-error" class="text-red-500 text-sm font-medium hidden bg-red-50 p-4 rounded-xl"></p>
            <button type="submit" id="co-submit" class="btn-primary w-full py-4 text-lg mt-4">
              Place Order
            </button>
          </form>
        </div>
      </div>
      
      <div id="cf-overlay" class="fixed inset-0 bg-onSurface/40 z-[60] hidden items-center justify-center px-4 backdrop-blur-sm">
        <div class="bg-surface rounded-4xl max-w-md w-full p-10 text-center shadow-float border border-surfaceVariant">
          <div class="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 text-primary">
             <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <h3 class="text-3xl font-extrabold text-onSurface mb-2">Order Confirmed</h3>
          <p class="font-medium text-primary mb-6 text-lg">#<span id="cf-id"></span></p>
          <p id="cf-paid" class="font-bold mb-4 hidden">Payment received ✓ — thanks!</p>
          <p class="text-onSurfaceVariant mb-8 leading-relaxed">Thank you for your order. We will review your details and contact you shortly.</p>
          <p id="cf-pay-error" class="text-red-500 text-sm font-medium hidden bg-red-50 p-4 rounded-xl mb-4"></p>
          <button id="cf-pay" class="btn-primary w-full py-4 text-lg mb-3">Pay Now With Card</button>
          <button id="cf-close" class="btn-outline w-full py-3">Done</button>
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
      submitBtn.textContent = "Processing...";

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
        submitBtn.textContent = "Place Order";
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
      payBtn.textContent = "Redirecting to Stripe...";

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
        payBtn.textContent = "Pay Now With Card";
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

class AutoCategories extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="w-full overflow-x-auto no-scrollbar py-4 mb-4 border-b border-surfaceVariant/50">
        <div id="cat-list" class="flex items-center gap-3 whitespace-nowrap min-w-max px-1">
        </div>
      </div>
    `;

    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'categories' || e.detail.key === 'selectedCategory') {
        this.render();
      }
    });
  }

  render() {
    const categories = store.get('categories') || [];
    const selected = store.get('selectedCategory') || 'All';
    const list = this.querySelector('#cat-list');
    
    if (categories.length <= 1) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = categories.map(cat => `
      <button data-cat="${cat}" class="px-6 py-2.5 rounded-full text-sm font-bold tracking-wide transition-all ${cat === selected ? 'bg-onSurface text-surface shadow-soft' : 'bg-surfaceVariant text-onSurfaceVariant hover:bg-onSurfaceVariant/20 hover:text-onSurface'}">
        ${cat}
      </button>
    `).join('');

    list.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        store.set('selectedCategory', btn.getAttribute('data-cat'));
      });
    });
  }
}

customElements.define('auto-categories', AutoCategories);
customElements.define('auto-app', AutoApp);
customElements.define('auto-header', AutoHeader);
customElements.define('auto-hero', AutoHero);
customElements.define('auto-grid', AutoGrid);
customElements.define('auto-product-card', AutoProductCard);
customElements.define('auto-quick-view', AutoQuickView);
customElements.define('auto-cart', AutoCart);
customElements.define('auto-checkout', AutoCheckout);
