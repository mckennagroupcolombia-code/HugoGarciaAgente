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
