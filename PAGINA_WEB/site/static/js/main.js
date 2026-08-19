/**
 * McKenna Group — main.js
 */
(function () {
  'use strict';

  /* ── Header scroll ──────────────────────────────────── */
  const header = document.getElementById('site-header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 60);
    }, { passive: true });
  }

  /* ── Menú móvil ─────────────────────────────────────── */
  const toggle     = document.querySelector('.menu-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  if (toggle && mobileMenu) {
    toggle.addEventListener('click', function () {
      const open = !mobileMenu.hidden;
      mobileMenu.hidden = open;
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.classList.toggle('is-active', !open);
      document.body.style.overflow = open ? '' : 'hidden';
    });
    mobileMenu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        mobileMenu.hidden = true;
        toggle.classList.remove('is-active');
        document.body.style.overflow = '';
      });
    });
  }

  /* ── Scroll reveal ──────────────────────────────────── */
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) { obs.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('visible');
    });
  }

  /* ── Back to top ────────────────────────────────────── */
  const btt = document.getElementById('btt');
  if (btt) {
    window.addEventListener('scroll', function () {
      btt.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
    btt.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Búsqueda rápida en header ──────────────────────── */
  const searchInput = document.getElementById('header-search-input');
  if (searchInput) {
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && this.value.trim()) {
        window.location.href = '/tienda?q=' + encodeURIComponent(this.value.trim());
      }
    });
  }

  /* ── Toast helper ───────────────────────────────────── */
  window.mckgToast = function (msg) {
    const t = document.createElement('div');
    t.className = 'mckg-toast';
    t.innerHTML = '<i class="ph ph-check-circle"></i><span>' + msg + '</span>';
    document.body.appendChild(t);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { t.classList.add('show'); });
    });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 400);
    }, 3500);
  };

  /* ── Presentaciones en tarjetas de catálogo ─────────── */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pres-picker] .presentacion-btn');
    if (!btn) return;
    e.preventDefault();
    var root = btn.closest('[data-pres-picker]');
    if (!root) return;
    root.querySelectorAll('.presentacion-btn').forEach(function (b) {
      b.classList.toggle('is-active', b === btn);
    });
    var slug = btn.getAttribute('data-slug') || '';
    var precio = btn.getAttribute('data-precio') || '';
    var lista = btn.getAttribute('data-precio-meli') || '';
    var ahorro = btn.getAttribute('data-ahorro') || '';
    var href = btn.getAttribute('data-href') || '';
    var photo = btn.getAttribute('data-photo') || '';
    var buyable = btn.getAttribute('data-buyable') === '1';
    var el;
    el = root.querySelector('[data-pres-slug]'); if (el) el.value = slug;
    el = root.querySelector('[data-pres-precio]'); if (el) el.textContent = precio;
    el = root.querySelector('[data-pres-lista]');
    if (el) { el.textContent = lista; el.style.display = buyable ? '' : 'none'; }
    el = root.querySelector('[data-pres-ahorro]');
    if (el) { el.textContent = ahorro; el.style.display = buyable ? '' : 'none'; }
    el = root.querySelector('[data-pres-ref]');
    if (el && btn.getAttribute('data-ref')) el.textContent = 'Ref: ' + btn.getAttribute('data-ref');
    root.querySelectorAll('[data-pres-detail]').forEach(function (a) {
      if (href) a.setAttribute('href', href);
    });
    var img = root.querySelector('[data-pres-photo]');
    if (img && photo) img.setAttribute('src', photo);
    var form = root.querySelector('[data-pres-form]');
    var ago = root.querySelector('[data-pres-agotado]');
    if (form) form.style.display = buyable ? 'flex' : 'none';
    if (ago) ago.style.display = buyable ? 'none' : 'flex';
  });

  /* ── Carrusel destacados (inicio) ───────────────────── */
  document.querySelectorAll('[data-carousel]').forEach(function (root) {
    var track = root.querySelector('[data-carousel-track]');
    var prev = root.querySelector('[data-carousel-prev]');
    var next = root.querySelector('[data-carousel-next]');
    if (!track || !prev || !next) return;

    function paso() {
      var slide = track.querySelector('.dest-slide');
      if (!slide) return track.clientWidth;
      var gap = parseFloat(getComputedStyle(track).gap) || 16;
      return slide.getBoundingClientRect().width + gap;
    }
    function sync() {
      var max = Math.max(0, track.scrollWidth - track.clientWidth - 2);
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
    }
    prev.addEventListener('click', function () {
      track.scrollBy({ left: -paso(), behavior: 'smooth' });
    });
    next.addEventListener('click', function () {
      track.scrollBy({ left: paso(), behavior: 'smooth' });
    });
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  });

  /* ── Smooth anchors ─────────────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* ── Studio web: tokens en vivo desde el iframe del panel ─ */
  if (document.body.getAttribute('data-studio-live') === '1') {
    function origenStudioOk(origin) {
      try {
        var host = new URL(origin).hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
      } catch (err) {
        return false;
      }
    }
    window.addEventListener('message', function (ev) {
      var data = ev.data;
      if (!data || data.type !== 'mck-studio-live') return;
      if (!origenStudioOk(ev.origin)) return;
      var css = data.css || {};
      var root = document.documentElement;
      var body = document.body;
      Object.keys(css).forEach(function (k) {
        if (typeof css[k] !== 'string') return;
        root.style.setProperty(k, css[k]);
        body.style.setProperty(k, css[k]);
      });
      if (typeof data.tagline === 'string') {
        document.querySelectorAll('.brand-text span').forEach(function (el) {
          el.textContent = data.tagline;
        });
      }
    });
  }

})();
