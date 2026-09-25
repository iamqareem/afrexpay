// Hangtag (Tech/Electronics) Theme - Web Component Architecture
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

// --- Central State Store ---
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

      // Extract unique categories
      const cats = new Set(productsRes.map(p => p.category).filter(Boolean));
      this.set('categories', ['All', ...Array.from(cats)]);
      
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

class TechApp extends HTMLElement {
  connectedCallback() {
    store.init();
    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'config') this.renderConfig();
    });
  }
  
  renderConfig() {
    const config = store.get('config');
    document.title = `${config.storeName || ""} ${config.storeNameAccent || ""}`.trim() || "Tech Storefront";
    
    if (config.accentColor) document.documentElement.style.setProperty("--accent", config.accentColor);
    if (config.accentColor2) document.documentElement.style.setProperty("--accent2", config.accentColor2);
    
    const footerEl = document.querySelector('#footer-text');
    if (footerEl) footerEl.textContent = config.footerText || "";
  }
}

class TechHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="sticky top-0 z-40 bg-ink/95 backdrop-blur border-b border-surface2">
        <div class="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <div class="font-display font-black text-2xl tracking-tightest text-paper cursor-pointer" id="brand-logo">
            <span id="h-brand"></span><span id="h-accent" class="text-gold"></span>
          </div>
          <button id="cart-toggle" class="relative flex items-center gap-2 border border-surface2 rounded-md px-4 py-2 text-sm font-mono text-paper hover:border-gold transition-colors">
            CART
            <span id="cart-count" class="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-full bg-gold text-ink text-xs font-bold px-1">0</span>
          </button>
        </div>
      </header>
    `;
    
    this.querySelector('#brand-logo').addEventListener('click', () => {
      store.set('selectedCategory', 'All');
    });
    this.querySelector('#cart-toggle').addEventListener('click', () => {
      store.set('isCartOpen', true);
    });
    
    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'cart') {
        const totalQty = store.get('cart').reduce((sum, i) => sum + i.qty, 0);
        this.querySelector('#cart-count').textContent = totalQty;
      }
      if (e.detail.key === 'config') {
        const config = store.get('config');
        this.querySelector('#h-brand').textContent = config.storeName || "TECH";
        this.querySelector('#h-accent').textContent = config.storeNameAccent || "";
      }
    });
  }
}

class TechHero extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section class="max-w-6xl mx-auto px-5 pt-16 pb-14 border-b border-surface2">
        <p id="h-tagline" class="font-mono text-xs tracking-widest2 text-gold uppercase mb-4"></p>
        <h1 class="font-display font-black text-5xl md:text-7xl leading-[0.95] tracking-tightest text-paper max-w-3xl">
          <span id="h-line1"></span><br/><span id="h-line2"></span>
        </h1>
        <p id="h-subtitle" class="mt-6 max-w-xl text-muted text-base md:text-lg"></p>
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

class TechSidebar extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div>
        <h3 class="font-display font-bold text-lg text-paper mb-4">Categories</h3>
        <ul id="cat-list" class="space-y-2"></ul>
      </div>
    `;

    store.addEventListener('state-change', (e) => {
      if (e.detail.key === 'categories' || e.detail.key === 'selectedCategory') {
        this.render();
      }
    });
  }

  render() {
    const categories = store.get('categories');
    const selected = store.get('selectedCategory');
    const list = this.querySelector('#cat-list');
    
    list.innerHTML = categories.map(cat => `
      <li>
        <button data-cat="${cat}" class="w-full text-left px-3 py-2 rounded-md font-medium text-sm transition-colors ${cat === selected ? 'bg-surface2 text-gold' : 'text-muted hover:text-paper hover:bg-surface'}">
          ${cat}
        </button>
      </li>
    `).join('');

    list.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        store.set('selectedCategory', btn.getAttribute('data-cat'));
      });
    });
  }
}

class TechGrid extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div>
        <div class="flex items-baseline justify-between mb-6">
          <h2 id="grid-title" class="font-display font-bold text-2xl tracking-tightest text-paper">ALL PRODUCTS</h2>
          <p id="product-count" class="font-mono text-xs text-muted">0 ITEMS</p>
        </div>
        <div id="grid-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"></div>
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
    const photos = store.get('photos');
    const category = store.get('selectedCategory');
    
    const products = category === 'All' 
      ? allProducts 
      : allProducts.filter(p => p.category === category);
      
    this.querySelector('#product-count').textContent = `${products.length} ITEMS`;
    this.querySelector('#grid-title').textContent = category === 'All' ? 'ALL PRODUCTS' : category.toUpperCase();
    
    const container = this.querySelector('#grid-container');
    container.innerHTML = '';
    
    products.forEach(p => {
      const card = document.createElement('tech-product-card');
      const imgPath = photos[p.id]?.[0];
      card.product = p;
      card.img = imgPath ? `/media/${imgPath}` : null;
      container.appendChild(card);
    });
  }
}

class TechProductCard extends HTMLElement {
  set product(val) { this._product = val; this.render(); }
  set img(val) { this._img = val; this.render(); }

  render() {
    if (!this._product) return;
    const currency = store.get('config')?.currency || "UGX";
    
    this.innerHTML = `
      <div class="bg-surface rounded-lg overflow-hidden border border-surface2 hover:border-gold transition-colors flex flex-col h-full cursor-pointer group relative">
        <div class="aspect-square bg-ink p-4 flex items-center justify-center relative overflow-hidden">
          ${this._img ? `<img src="${this._img}" class="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" />` : `<div class="text-muted text-xs">NO IMAGE</div>`}
          <div class="absolute inset-0 bg-ink/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
             <span class="bg-gold text-ink font-bold px-4 py-2 rounded-md text-sm">QUICK VIEW</span>
          </div>
        </div>
        <div class="p-5 flex flex-col flex-1">
          ${this._product.category ? `<span class="text-[10px] font-mono text-gold uppercase tracking-widest mb-2">${this._product.category}</span>` : ''}
          <h3 class="font-bold text-paper text-lg leading-tight mb-2">${this._product.name}</h3>
          <p class="font-mono text-gold font-bold mt-auto pt-4">${money(this._product.price_minor, currency)}</p>
        </div>
      </div>
    `;
    
    this.firstElementChild.addEventListener('click', () => {
      store.set('currentProductId', this._product.id);
      store.set('isQuickViewOpen', true);
    });
  }
}

class TechQuickView extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="qv-overlay" class="fixed inset-0 bg-black/80 z-[60] hidden items-center justify-center px-4 transition-opacity opacity-0 backdrop-blur-sm">
        <div id="qv-modal" class="bg-surface border border-surface2 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto scale-95 transition-transform duration-300 flex flex-col md:flex-row shadow-2xl">
          <div class="w-full md:w-1/2 bg-ink p-8 flex items-center justify-center min-h-[300px]">
             <img id="qv-img" src="" class="w-full h-auto object-contain max-h-[60vh]" />
          </div>
          <div class="w-full md:w-1/2 p-8 relative flex flex-col">
            <button id="qv-close" class="absolute top-4 right-4 text-muted hover:text-paper text-3xl leading-none">&times;</button>
            <p id="qv-cat" class="font-mono text-xs text-gold uppercase tracking-widest mb-2"></p>
            <h2 id="qv-name" class="font-display font-bold text-3xl text-paper mb-4 leading-tight"></h2>
            <p id="qv-blurb" class="text-muted text-sm mb-6 flex-1"></p>
            <p id="qv-price" class="font-mono text-2xl text-paper font-bold mb-6"></p>
            
            <div class="mb-6">
              <label class="block font-mono text-xs text-muted mb-2">SELECT OPTION / SIZE</label>
              <select id="qv-size" class="w-full bg-ink border border-surface2 rounded-md px-4 py-3 text-sm text-paper focus:outline-none focus:border-gold">
              </select>
            </div>
            
            <p id="qv-error" class="text-brick text-sm mb-3 hidden">PLEASE SELECT AN OPTION</p>
            <button id="qv-add" class="w-full bg-gold text-ink font-bold py-4 rounded-md hover:bg-paper transition-colors">
              ADD TO CART
            </button>
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
      selectEl.innerHTML = `<option value="">N/A</option>`;
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
      store.addToCart(product.id, selectedSize || 'N/A');
      store.set('isQuickViewOpen', false);
    });
  }
}

class TechCart extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="c-overlay" class="fixed inset-0 bg-black/60 z-50 hidden transition-opacity opacity-0 backdrop-blur-sm"></div>
      <aside id="c-drawer" class="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-surface z-50 translate-x-full transition-transform duration-300 flex flex-col border-l border-surface2">
        <div class="flex items-center justify-between px-6 py-5 border-b border-surface2 bg-ink">
          <h3 class="font-display font-bold tracking-widest2 uppercase text-paper text-sm">YOUR CART</h3>
          <button id="c-close" class="text-muted hover:text-paper text-2xl leading-none">&times;</button>
        </div>
        <div id="c-items" class="flex-1 overflow-y-auto px-6 py-4 space-y-4"></div>
        <div class="px-6 py-6 border-t border-surface2 bg-ink">
          <div class="flex justify-between text-paper mb-6 font-bold text-lg">
            <span>TOTAL</span>
            <span id="c-total" class="text-gold"></span>
          </div>
          <button id="c-checkout" class="w-full bg-gold text-ink font-bold py-4 rounded-md hover:bg-paper transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            PROCEED TO CHECKOUT
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
      itemsContainer.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-muted"><p>Your cart is empty.</p></div>`;
      return;
    }

    itemsContainer.innerHTML = cart.map((item, index) => `
      <div class="flex items-start justify-between gap-4 pb-4 border-b border-surface2">
        <div class="flex-1">
          <p class="text-paper font-bold">${item.name}</p>
          <p class="text-xs text-muted font-mono mt-1">OPT: ${item.size}</p>
          <div class="flex items-center gap-3 mt-3">
            <button data-qdown="${index}" class="w-8 h-8 bg-ink border border-surface2 rounded-md hover:border-gold text-paper flex items-center justify-center">-</button>
            <span class="text-sm font-bold text-paper">${item.qty}</span>
            <button data-qup="${index}" class="w-8 h-8 bg-ink border border-surface2 rounded-md hover:border-gold text-paper flex items-center justify-center">+</button>
            <button data-rem="${index}" class="ml-auto text-xs text-brick hover:underline font-mono">REMOVE</button>
          </div>
        </div>
        <span class="text-gold font-bold font-mono">${money(item.priceMinor * item.qty, currency)}</span>
      </div>
    `).join('');

    itemsContainer.querySelectorAll('[data-qup]').forEach(b => b.addEventListener('click', () => store.updateCartQty(Number(b.getAttribute('data-qup')), 1)));
    itemsContainer.querySelectorAll('[data-qdown]').forEach(b => b.addEventListener('click', () => store.updateCartQty(Number(b.getAttribute('data-qdown')), -1)));
    itemsContainer.querySelectorAll('[data-rem]').forEach(b => b.addEventListener('click', () => store.removeFromCart(Number(b.getAttribute('data-rem')))));
  }
}

class TechCheckout extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="co-overlay" class="fixed inset-0 bg-black/80 z-[60] hidden items-center justify-center px-4 transition-opacity opacity-0 backdrop-blur-sm">
        <div id="co-modal" class="bg-surface border border-surface2 rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto scale-95 transition-transform duration-300 shadow-2xl">
          <div class="flex items-center justify-between mb-6">
            <h3 class="font-display font-bold text-xl text-paper tracking-tightest">DELIVERY DETAILS</h3>
            <button id="co-close" class="text-muted hover:text-paper text-2xl leading-none">&times;</button>
          </div>
          <form id="co-form" class="space-y-4">
            <div>
              <label class="block font-mono text-xs text-muted mb-1">FULL NAME</label>
              <input name="customerName" required class="w-full bg-ink border border-surface2 rounded-md px-4 py-3 text-paper focus:outline-none focus:border-gold" />
            </div>
            <div>
              <label class="block font-mono text-xs text-muted mb-1">PHONE</label>
              <input name="phone" required class="w-full bg-ink border border-surface2 rounded-md px-4 py-3 text-paper focus:outline-none focus:border-gold" placeholder="07XXXXXXXX" />
            </div>
            <div>
              <label class="block font-mono text-xs text-muted mb-1">ADDRESS</label>
              <textarea name="address" required rows="2" class="w-full bg-ink border border-surface2 rounded-md px-4 py-3 text-paper focus:outline-none focus:border-gold"></textarea>
            </div>
            <div>
              <label class="block font-mono text-xs text-muted mb-1">NOTES</label>
              <textarea name="deliveryNotes" rows="2" class="w-full bg-ink border border-surface2 rounded-md px-4 py-3 text-paper focus:outline-none focus:border-gold"></textarea>
            </div>
            <p id="co-error" class="text-brick text-sm hidden"></p>
            <button type="submit" id="co-submit" class="w-full bg-gold text-ink font-bold py-4 rounded-md hover:bg-paper transition-colors mt-4">
              COMPLETE ORDER
            </button>
          </form>
        </div>
      </div>
      
      <div id="cf-overlay" class="fixed inset-0 bg-black/80 z-[60] hidden items-center justify-center px-4 backdrop-blur-sm">
        <div class="bg-surface border border-surface2 rounded-xl max-w-md w-full p-8 text-center shadow-2xl">
          <div class="w-16 h-16 bg-gold/10 rounded-full flex items-center justify-center mx-auto mb-4 text-gold">
             <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <p class="font-mono text-xs tracking-widest2 text-gold uppercase mb-2">Order Confirmed</p>
          <h3 class="font-display font-bold text-2xl text-paper mb-4">ORDER #<span id="cf-id"></span></h3>
          <p id="cf-paid" class="text-gold font-bold mb-4 hidden">Payment received ✓ — thanks!</p>
          <p class="text-muted mb-8">We will contact you shortly to arrange delivery.</p>
          <p id="cf-pay-error" class="text-brick text-sm hidden mb-4"></p>
          <button id="cf-pay" class="w-full bg-gold text-ink font-bold py-3 rounded-md hover:bg-paper transition-colors mb-3">PAY NOW WITH CARD</button>
          <button id="cf-close" class="w-full bg-surface2 text-paper font-bold py-3 rounded-md hover:bg-gold hover:text-ink transition-colors">DONE</button>
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
      submitBtn.textContent = "PROCESSING...";

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
        submitBtn.textContent = "COMPLETE ORDER";
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

customElements.define('tech-app', TechApp);
customElements.define('tech-header', TechHeader);
customElements.define('tech-hero', TechHero);
customElements.define('tech-sidebar', TechSidebar);
customElements.define('tech-grid', TechGrid);
customElements.define('tech-product-card', TechProductCard);
customElements.define('tech-quick-view', TechQuickView);
customElements.define('tech-cart', TechCart);
customElements.define('tech-checkout', TechCheckout);
