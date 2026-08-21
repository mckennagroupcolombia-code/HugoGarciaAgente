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
      var slide = track.firstElementChild;
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

  /* ── Popovers de pin en mapas (ruta de origen / cobertura) ─ */
  var initMapPins = function (pinSelector, targetAttr) {
    document.querySelectorAll(pinSelector + '[' + targetAttr + ']').forEach(function (pin) {
      pin.addEventListener('click', function () {
        var id = pin.getAttribute(targetAttr);
        var card = document.getElementById(id);
        if (!card) return;
        var isOpen = pin.getAttribute('aria-expanded') === 'true';
        document.querySelectorAll(pinSelector + '[aria-expanded="true"]').forEach(function (other) {
          if (other !== pin) {
            other.setAttribute('aria-expanded', 'false');
            var otherCard = document.getElementById(other.getAttribute(targetAttr));
            if (otherCard) otherCard.hidden = true;
          }
        });
        pin.setAttribute('aria-expanded', String(!isOpen));
        card.hidden = isOpen;
      });
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest(pinSelector) || e.target.closest(pinSelector + '-card')) return;
      document.querySelectorAll(pinSelector + '[aria-expanded="true"]').forEach(function (pin) {
        pin.setAttribute('aria-expanded', 'false');
        var card = document.getElementById(pin.getAttribute(targetAttr));
        if (card) card.hidden = true;
      });
    });
  };
  initMapPins('.route-pin', 'data-route-target');

  /* ── Cobertura: acordeón por departamento (sin mapa) ─── */
  document.querySelectorAll('.coverage-depto-btn[aria-controls]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var list = document.getElementById(btn.getAttribute('aria-controls'));
      if (!list) return;
      var isOpen = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!isOpen));
      list.hidden = isOpen;
    });
  });

  /* ── Actividad en vivo: refresco periódico sin recargar ─ */
  if (document.querySelector('[data-live]')) {
    var refrescarActividad = function () {
      fetch('/api/actividad').then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (data) {
        if (!data) return;
        document.querySelectorAll('[data-live]').forEach(function (el) {
          var key = el.getAttribute('data-live');
          if (key in data) el.textContent = data[key];
        });
        var ciudadesEl = document.querySelector('[data-live-ciudades]');
        if (ciudadesEl && Array.isArray(data.ciudades_semana) && data.ciudades_semana.length) {
          ciudadesEl.textContent = 'Esta semana despachamos hacia: ' + data.ciudades_semana.join(', ');
        }
      }).catch(function () { /* silencioso: se conserva el último valor renderizado */ });
    };
    setInterval(refrescarActividad, 60000);
  }

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

})();
