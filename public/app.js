(() => {
  'use strict';

  const CART_KEY = 'luma-goods-cart-v1';
  const page = document.body.dataset.page || 'home';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function formatMoney(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
      : '$0.00';
  }

  function hydrateImages(root = document) {
    $$('img[data-image-fallback]', root).forEach((image) => {
      const fallback = () => {
        image.onerror = null;
        image.classList.add('is-fallback');
        image.src = '/images/product-fallback.svg';
      };
      image.addEventListener('error', fallback, { once: true });
      if (!image.getAttribute('src')) fallback();
    });
  }

  function readCart() {
    try {
      const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(value) ? value.filter((item) => item && item.id && item.quantity > 0) : [];
    } catch (error) {
      return [];
    }
  }

  function writeCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (error) {
      // The cart still works for the current view if storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent('luma:cart-updated'));
  }

  function cartCount(cart = readCart()) {
    return cart.reduce((total, item) => total + Number(item.quantity || 0), 0);
  }

  function addToCart(product, quantity = 1) {
    const cart = readCart();
    const id = String(product.id);
    const existing = cart.find((item) => String(item.id) === id);
    const stock = Number(product.stock);
    const requested = (existing ? Number(existing.quantity) : 0) + quantity;
    const max = Number.isFinite(stock) && stock > 0 ? stock : 100;
    if (existing) {
      existing.quantity = Math.min(requested, max);
      existing.name = product.name;
      existing.price = Number(product.price);
      existing.image_url = product.image_url || '';
      existing.stock = product.stock;
    } else {
      cart.push({
        id: Number(product.id),
        name: product.name,
        price: Number(product.price),
        image_url: product.image_url || '',
        stock: product.stock,
        quantity: Math.min(quantity, max)
      });
    }
    writeCart(cart);
    return Math.min(requested, max);
  }

  function updateCartItem(id, quantity) {
    const cart = readCart();
    const item = cart.find((entry) => String(entry.id) === String(id));
    if (!item) return;
    const stock = Number(item.stock);
    const max = Number.isFinite(stock) && stock > 0 ? stock : 100;
    item.quantity = Math.max(1, Math.min(max, Number(quantity) || 1));
    writeCart(cart);
  }

  function removeCartItem(id) {
    writeCart(readCart().filter((item) => String(item.id) !== String(id)));
  }

  function renderShell() {
    const header = $('[data-site-header]');
    if (header) {
      const isHome = page === 'home';
      const isShop = page === 'product' || isHome;
      header.innerHTML = `
        <a class="brand" href="/" aria-label="Luma Goods home"><span class="brand-mark">✦</span><span>Luma Goods</span></a>
        <nav class="primary-nav" data-primary-nav aria-label="Primary navigation">
          <a href="/" ${isShop ? 'aria-current="page"' : ''}>Shop</a>
          <a href="/#collection">Our edit</a>
          <a href="/#about">Our approach</a>
        </nav>
        <div class="header-actions">
          <a class="header-cart" href="/cart.html" aria-label="Shopping bag"><span>Bag</span><span class="cart-count" data-header-cart-count>0</span></a>
          <button class="menu-toggle" type="button" data-menu-toggle aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button>
        </div>`;
      $('[data-menu-toggle]', header)?.addEventListener('click', () => {
        const nav = $('[data-primary-nav]', header);
        const open = nav.classList.toggle('is-open');
        document.body.classList.toggle('menu-open', open);
        $('[data-menu-toggle]', header).setAttribute('aria-expanded', String(open));
      });
      $$('.primary-nav a', header).forEach((link) => link.addEventListener('click', () => {
        $('[data-primary-nav]', header).classList.remove('is-open');
        document.body.classList.remove('menu-open');
      }));
    }
    const footer = $('[data-site-footer]');
    if (footer) {
      footer.innerHTML = `
        <div class="footer-inner">
          <div class="footer-copy"><strong>Luma Goods <span aria-hidden="true">✦</span></strong><span>Useful things, thoughtfully chosen.</span></div>
          <div class="footer-links"><a href="/#collection">Shop</a><a href="/cart.html">Bag</a><a href="mailto:hello@lumagoods.example">Contact</a></div>
          <div class="footer-copy">© ${new Date().getFullYear()} Luma Goods</div>
        </div>`;
    }
    updateHeaderCount();
  }

  function updateHeaderCount() {
    const count = cartCount();
    $$('[data-header-cart-count]').forEach((element) => {
      element.textContent = count > 99 ? '99+' : String(count);
    });
  }

  async function fetchJson(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      const networkError = new Error('We couldn’t connect to the shop. Please check that the server is running and try again.');
      networkError.code = 'NETWORK_ERROR';
      throw networkError;
    }
    let payload = null;
    try { payload = await response.json(); } catch (error) { /* response may have no JSON body */ }
    if (!response.ok) {
      const apiError = new Error(payload?.error?.message || `The request could not be completed (${response.status}).`);
      apiError.code = payload?.error?.code || 'REQUEST_ERROR';
      apiError.status = response.status;
      throw apiError;
    }
    return payload;
  }

  function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
  }

  function productCard(product) {
    const stock = Number(product.stock);
    const outOfStock = Number.isFinite(stock) && stock <= 0;
    const limited = !outOfStock && Number.isFinite(stock) && stock < 10;
    return `<article class="product-card">
      ${outOfStock ? '<span class="product-tag">Sold out</span>' : limited ? '<span class="product-tag">Low stock</span>' : ''}
      <a class="product-image-link" href="/product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${escapeHtml(product.name)}">
        <img class="product-image" data-image-fallback="${escapeHtml(product.name)}" src="${escapeHtml(product.image_url || '')}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">
      </a>
      <div class="product-info">
        <div><h3><a href="/product.html?id=${encodeURIComponent(product.id)}">${escapeHtml(product.name)}</a></h3><p>${escapeHtml(product.description || '')}</p></div>
        <span class="product-price">${formatMoney(product.price)}</span>
      </div>
      <button class="quick-add" type="button" data-add-product="${escapeHtml(product.id)}" ${outOfStock ? 'disabled' : ''}>${outOfStock ? 'Unavailable' : 'Add to bag'}</button>
    </article>`;
  }

  async function initHome() {
    const loading = $('[data-products-loading]');
    const error = $('[data-products-error]');
    const grid = $('[data-product-grid]');
    const empty = $('[data-products-empty]');
    try {
      const products = await fetchJson('/api/products');
      loading.hidden = true;
      if (!Array.isArray(products) || products.length === 0) {
        empty.hidden = false;
        return;
      }
      grid.innerHTML = products.map(productCard).join('');
      hydrateImages(grid);
      const byId = new Map(products.map((product) => [String(product.id), product]));
      $$('[data-add-product]', grid).forEach((button) => button.addEventListener('click', () => {
        const product = byId.get(button.dataset.addProduct);
        if (!product) return;
        addToCart(product);
        const original = button.textContent;
        button.textContent = 'Added ✓';
        button.disabled = true;
        window.setTimeout(() => { button.textContent = original; button.disabled = false; }, 1100);
      }));
    } catch (requestError) {
      loading.hidden = true;
      showError(error, requestError.message);
    }
  }

  function detailMarkup(product) {
    const stock = Number(product.stock);
    const outOfStock = Number.isFinite(stock) && stock <= 0;
    const stockMessage = outOfStock ? 'Currently unavailable' : Number.isFinite(stock) && stock < 10 ? `${stock} left · ships soon` : 'In stock · ships soon';
    return `<div class="detail-image-wrap"><img class="detail-image" data-image-fallback="${escapeHtml(product.name)}" src="${escapeHtml(product.image_url || '')}" alt="${escapeHtml(product.name)}" decoding="async"></div>
      <div class="detail-copy">
        <p class="eyebrow">Everyday essential · 0${product.id}</p>
        <h1>${escapeHtml(product.name)}<span class="heading-period">.</span></h1>
        <p class="detail-description">${escapeHtml(product.description || 'Thoughtfully designed for everyday use.')}</p>
        <div class="detail-purchase">
          <div class="detail-price-row"><span class="detail-price">${formatMoney(product.price)}</span><span class="stock-note ${outOfStock ? 'out' : ''}">${escapeHtml(stockMessage)}</span></div>
          <div class="purchase-controls">
            <div class="quantity-control" aria-label="Quantity"><button type="button" data-detail-minus aria-label="Decrease quantity">−</button><output data-detail-quantity>1</output><button type="button" data-detail-plus aria-label="Increase quantity">+</button></div>
            <button type="button" class="button button-dark" data-detail-add ${outOfStock ? 'disabled' : ''}>${outOfStock ? 'Unavailable' : 'Add to bag'} <span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </div>`;
  }

  async function initProduct() {
    const loading = $('[data-product-loading]');
    const error = $('[data-product-error]');
    const detail = $('[data-product-detail]');
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id || !/^\d+$/.test(id)) {
      loading.hidden = true;
      showError(error, 'This product link is missing a valid product number. Browse the collection to find something new.');
      return;
    }
    try {
      const product = await fetchJson(`/api/products/${encodeURIComponent(id)}`);
      loading.hidden = true;
      detail.innerHTML = detailMarkup(product);
      detail.hidden = false;
      hydrateImages(detail);
      const stock = Number(product.stock);
      const max = Number.isFinite(stock) && stock > 0 ? stock : 1;
      const output = $('[data-detail-quantity]', detail);
      $('[data-detail-minus]', detail).addEventListener('click', () => { const next = Math.max(1, Number(output.textContent || 1) - 1); output.textContent = next; });
      $('[data-detail-plus]', detail).addEventListener('click', () => { const next = Math.min(max, Number(output.textContent || 1) + 1); output.textContent = next; });
      $('[data-detail-add]', detail).addEventListener('click', (event) => {
        addToCart(product, Number(output.textContent || 1));
        const button = event.currentTarget;
        button.innerHTML = 'Added to bag ✓';
        button.disabled = true;
        window.setTimeout(() => { button.innerHTML = 'Add to bag <span aria-hidden="true">↗</span>'; button.disabled = false; }, 1200);
      });
    } catch (requestError) {
      loading.hidden = true;
      showError(error, requestError.code === 'PRODUCT_NOT_FOUND' ? 'We couldn’t find that product. It may have moved out of the collection.' : requestError.message);
    }
  }

  function cartLineMarkup(item) {
    return `<article class="cart-line" data-cart-item="${escapeHtml(item.id)}">
      <img class="cart-line-image" data-image-fallback="${escapeHtml(item.name)}" src="${escapeHtml(item.image_url || '')}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">
      <div class="cart-line-info"><h3>${escapeHtml(item.name)}</h3><p>${formatMoney(item.price)} each</p><div class="cart-line-controls"><div class="cart-quantity" aria-label="Quantity for ${escapeHtml(item.name)}"><button type="button" data-cart-minus aria-label="Decrease quantity">−</button><output>${item.quantity}</output><button type="button" data-cart-plus aria-label="Increase quantity">+</button></div><button class="cart-remove" type="button" data-cart-remove aria-label="Remove ${escapeHtml(item.name)}">×</button></div></div>
      <span class="cart-line-total">${formatMoney(Number(item.price) * Number(item.quantity))}</span>
    </article>`;
  }

  function renderCart() {
    const cart = readCart();
    const layout = $('[data-cart-layout]');
    const empty = $('[data-cart-empty]');
    const items = $('[data-cart-items]');
    if (!layout || !empty || !items) return;
    if (cart.length === 0) {
      layout.hidden = true;
      empty.hidden = false;
      $('[data-cart-caption]').textContent = 'There’s nothing here yet, but the collection is ready when you are.';
      return;
    }
    layout.hidden = false;
    empty.hidden = true;
    $('[data-cart-count]').textContent = cartCount(cart);
    items.innerHTML = cart.map(cartLineMarkup).join('');
    hydrateImages(items);
    const subtotal = cart.reduce((total, item) => total + Number(item.price) * Number(item.quantity), 0);
    $('[data-cart-subtotal]').textContent = formatMoney(subtotal);
    $('[data-cart-total]').textContent = formatMoney(subtotal);
    $$('[data-cart-item]', items).forEach((line) => {
      const id = line.dataset.cartItem;
      const item = cart.find((entry) => String(entry.id) === id);
      const output = $('output', line);
      $('[data-cart-minus]', line).addEventListener('click', () => updateCartItem(id, Number(item.quantity) - 1));
      $('[data-cart-plus]', line).addEventListener('click', () => updateCartItem(id, Number(item.quantity) + 1));
      $('[data-cart-remove]', line).addEventListener('click', () => removeCartItem(id));
      output.textContent = item.quantity;
    });
  }

  function initCart() {
    renderCart();
    $('[data-clear-cart]')?.addEventListener('click', () => writeCart([]));
    window.addEventListener('luma:cart-updated', renderCart);
  }

  function renderCheckoutSummary(cart) {
    const summary = $('[data-checkout-items]');
    if (!summary) return;
    summary.innerHTML = cart.map((item) => `<div class="checkout-item"><img class="checkout-item-image" data-image-fallback="${escapeHtml(item.name)}" src="${escapeHtml(item.image_url || '')}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async"><div class="checkout-item-name"><strong>${escapeHtml(item.name)}</strong>${item.quantity} × ${formatMoney(item.price)}</div><span class="checkout-item-price">${formatMoney(Number(item.price) * Number(item.quantity))}</span></div>`).join('');
    hydrateImages(summary);
    const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    $('[data-checkout-subtotal]').textContent = formatMoney(total);
    $('[data-checkout-total]').textContent = formatMoney(total);
  }

  function setFieldError(name, message) {
    const field = $(`[name="${name}"]`);
    const wrapper = field?.closest('.field');
    const error = $(`[data-error-for="${name}"]`);
    wrapper?.classList.toggle('has-error', Boolean(message));
    if (error) error.textContent = message || '';
  }

  function validateCheckout(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    let valid = true;
    const rules = {
      name: !values.name.trim() ? 'Please enter your full name.' : values.name.trim().length < 2 ? 'Please enter at least two characters.' : '',
      email: !values.email.trim() ? 'Please enter your email address.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()) ? 'Please enter a valid email address.' : '',
      address: !values.address.trim() ? 'Please enter your shipping address.' : values.address.trim().length < 8 ? 'Please add a little more detail to your address.' : ''
    };
    Object.entries(rules).forEach(([name, message]) => { setFieldError(name, message); if (message) valid = false; });
    return { valid, values };
  }

  async function initCheckout() {
    const cart = readCart();
    const layout = $('[data-checkout-layout]');
    const empty = $('[data-checkout-empty]');
    const form = $('[data-checkout-form]');
    if (!layout || !empty || !form) return;
    if (cart.length === 0) {
      layout.hidden = true;
      empty.hidden = false;
      return;
    }
    renderCheckoutSummary(cart);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = validateCheckout(form);
      if (!result.valid) {
        showError($('[data-checkout-error]'), 'Please check the highlighted fields and try again.');
        return;
      }
      const button = $('[data-place-order]', form);
      const error = $('[data-checkout-error]');
      error.hidden = true;
      button.disabled = true;
      button.innerHTML = '<span class="loader" aria-hidden="true"></span> Placing order…';
      try {
        const response = await fetchJson('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: { name: result.values.name.trim(), email: result.values.email.trim(), address: result.values.address.trim() },
            items: cart.map((item) => ({ product_id: Number(item.id), quantity: Number(item.quantity) }))
          })
        });
        const order = response?.order || response;
        writeCart([]);
        layout.hidden = true;
        $('[data-order-success]').hidden = false;
        $('[data-order-reference]').textContent = order?.order_reference || order?.id || 'confirmed';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (requestError) {
        showError(error, requestError.code === 'INSUFFICIENT_STOCK' ? 'One of the items in your bag is no longer available in that quantity. Please return to your bag and adjust it.' : requestError.message);
        button.disabled = false;
        button.innerHTML = 'Place order <span aria-hidden="true">↗</span>';
      }
    });
    $$('input, textarea', form).forEach((field) => field.addEventListener('input', () => setFieldError(field.name, '')));
  }

  renderShell();
  window.addEventListener('storage', updateHeaderCount);
  if (page === 'home') initHome();
  if (page === 'product') initProduct();
  if (page === 'cart') initCart();
  if (page === 'checkout') initCheckout();
})();
