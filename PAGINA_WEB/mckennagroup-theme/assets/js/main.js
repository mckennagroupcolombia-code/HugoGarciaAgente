/**
 * McKenna Group Theme — main.js v2.0
 */
(function() {
  'use strict';

  /* ─────────────────────────────────────────────
     MENÚ MÓVIL
     ───────────────────────────────────────────── */
  const toggle = document.querySelector('.menu-toggle');
  const mobileMenu = document.getElementById('mobile-menu');

  if (toggle && mobileMenu) {
    toggle.addEventListener('click', function() {
      const isOpen = !mobileMenu.hidden;
      mobileMenu.hidden = isOpen;
      toggle.setAttribute('aria-expanded', String(!isOpen));
      toggle.classList.toggle('is-active', !isOpen);
      document.body.style.overflow = isOpen ? '' : 'hidden';
    });

    mobileMenu.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        mobileMenu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.classList.remove('is-active');
        document.body.style.overflow = '';
      });
    });
  }

  /* ─────────────────────────────────────────────
     HEADER SCROLL (efecto glass en scroll)
     ───────────────────────────────────────────── */
  const header = document.getElementById('site-header');
  if (header) {
    window.addEventListener('scroll', function() {
      header.classList.toggle('scrolled', window.scrollY > 60);
    }, { passive: true });
  }

  /* ─────────────────────────────────────────────
     SCROLL REVEAL
     ───────────────────────────────────────────── */
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(function(el) {
      revealObserver.observe(el);
    });
  } else {
    // Fallback: mostrar todo si no hay soporte
    document.querySelectorAll('.reveal').forEach(function(el) {
      el.classList.add('visible');
    });
  }

  /* ─────────────────────────────────────────────
     BACK TO TOP
     ───────────────────────────────────────────── */
  const btt = document.createElement('a');
  btt.href = '#';
  btt.className = 'back-to-top';
  btt.setAttribute('aria-label', 'Volver arriba');
  btt.innerHTML = '<i class="ph ph-arrow-up"></i>';
  document.body.appendChild(btt);

  window.addEventListener('scroll', function() {
    btt.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });

  btt.addEventListener('click', function(e) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ─────────────────────────────────────────────
     TOAST HELPER
     ───────────────────────────────────────────── */
  window.mckgToast = function(msg, icon) {
    icon = icon || 'ph-check-circle';
    const t = document.createElement('div');
    t.className = 'mckg-toast';
    t.innerHTML = '<i class="ph ' + icon + '"></i><span>' + msg + '</span>';
    document.body.appendChild(t);
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { t.classList.add('show'); });
    });
    setTimeout(function() {
      t.classList.remove('show');
      setTimeout(function() { t.remove(); }, 400);
    }, 3500);
  };

  /* ─────────────────────────────────────────────
     ADD-TO-CART FEEDBACK
     ───────────────────────────────────────────── */
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.add_to_cart_button, .single_add_to_cart_button');
    if (!btn) return;
    btn.classList.add('loading');
    setTimeout(function() { btn.classList.remove('loading'); }, 1200);
  });

  document.body.addEventListener('wc_cart_button_updated', function() {
    window.mckgToast('¡Producto agregado al carrito!', 'ph-shopping-cart');
  });

  /* ─────────────────────────────────────────────
     CART COUNT AJAX
     ───────────────────────────────────────────── */
  document.body.addEventListener('wc_fragments_refreshed', function() {
    const countEl = document.querySelector('.cart-count');
    if (countEl) {
      const cartBtn = countEl.closest('.header-cart-btn');
      if (cartBtn) {
        cartBtn.setAttribute('aria-label', 'Carrito (' + countEl.textContent.trim() + ' items)');
      }
    }
  });

  /* ─────────────────────────────────────────────
     STICKY ADD-TO-CART (single product)
     ───────────────────────────────────────────── */
  const singleForm = document.querySelector('.single_add_to_cart_button');
  if (singleForm) {
    const productTitle = document.querySelector('.product_title');
    const productPrice = document.querySelector('.summary .price');

    const stickyEl = document.createElement('div');
    stickyEl.className = 'sticky-atc';
    stickyEl.innerHTML =
      '<span class="product-name">' + (productTitle ? productTitle.textContent.trim() : '') + '</span>' +
      '<span class="product-price">' + (productPrice ? productPrice.innerHTML : '') + '</span>' +
      '<button class="btn btn-primary" id="sticky-atc-btn">Agregar al carrito</button>';
    document.body.appendChild(stickyEl);

    const observer = new IntersectionObserver(function(entries) {
      stickyEl.classList.toggle('visible', !entries[0].isIntersecting);
    }, { threshold: 0.5 });
    observer.observe(singleForm);

    document.getElementById('sticky-atc-btn').addEventListener('click', function() {
      singleForm.click();
    });
  }

  /* ─────────────────────────────────────────────
     LAZY IMAGE
     ───────────────────────────────────────────── */
  if ('IntersectionObserver' in window) {
    const lazyImgs = document.querySelectorAll('img[loading="lazy"]');
    const imgObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) { img.src = img.dataset.src; }
          imgObserver.unobserve(img);
        }
      });
    });
    lazyImgs.forEach(function(img) { imgObserver.observe(img); });
  }

  /* ─────────────────────────────────────────────
     SMOOTH ANCHORS
     ───────────────────────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
    anchor.addEventListener('click', function(e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* ─────────────────────────────────────────────
     WC QTY STEPPER
     ───────────────────────────────────────────── */
  document.querySelectorAll('.quantity').forEach(function(wrapper) {
    const input = wrapper.querySelector('input[type="number"]');
    if (!input) return;

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.className = 'qty-btn qty-minus';

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.className = 'qty-btn qty-plus';

    wrapper.classList.add('qty-stepper');
    wrapper.insertBefore(minus, input);
    wrapper.appendChild(plus);

    minus.addEventListener('click', function() {
      const val = parseInt(input.value, 10);
      const min = parseInt(input.getAttribute('min'), 10) || 1;
      if (val > min) {
        input.value = val - 1;
        input.dispatchEvent(new Event('change'));
      }
    });
    plus.addEventListener('click', function() {
      const val = parseInt(input.value, 10);
      const max = parseInt(input.getAttribute('max'), 10);
      if (!max || val < max) {
        input.value = val + 1;
        input.dispatchEvent(new Event('change'));
      }
    });
  });

})();
