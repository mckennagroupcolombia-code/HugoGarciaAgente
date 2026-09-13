/* Guia viva: modulos interactivos de la guia de uso (Fase 2, sep-2026).
   Todo es estatico y determinista: los rangos vienen en el HTML
   (data-* y atributos de los controles), extraidos sin IA de guias.json.
   Modulos: dosificador (% x lote -> gramos), medidor de pH, cadena de
   incorporacion con recorrido automatico, nav pegajosa con seccion activa.
   ASCII puro: los simbolos van escapados. */
(function () {
  'use strict';

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function fmt(n, dec) {
    return Number(n).toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  var root = $('#gv');
  if (!root) return;
  var SLUG = root.getAttribute('data-slug') || '';
  function evento(nombre, detalle, unaVez) { try { if (window.mckEvento) window.mckEvento(nombre, SLUG, detalle, unaVez); } catch (e) {} }
  evento('guia_abierta', '', true);

  /* -- Dosificador -- */
  var app = $('#gv-app'), pct = $('#gv-pct'), vol = $('#gv-vol');
  if (app && pct && vol) {
    function rango() {
      var o = app.options[app.selectedIndex];
      return { min: parseFloat(o.getAttribute('data-min')), max: parseFloat(o.getAttribute('data-max')) };
    }
    function dose() {
      var p = parseFloat(pct.value), v = parseInt(vol.value, 10), r = rango();
      var g = p / 100 * v;
      $('#gv-pcto').textContent = fmt(p, 1) + ' %';
      $('#gv-volo').textContent = v + ' g';
      $('#gv-res').textContent = fmt(g, g < 10 ? 2 : 1);
      $('#gv-res-vol').textContent = v + ' g';
      $('#gv-res-pct').textContent = fmt(p, 1) + ' %';
      var f = $('#gv-flag');
      if (p > r.max) { f.className = 'gv-flag bad'; f.textContent = 'Supera el m\u00e1ximo de ' + fmt(r.max, 1) + ' %'; }
      else if (p < r.min) { f.className = 'gv-flag warn'; f.textContent = 'Por debajo del m\u00ednimo de ' + fmt(r.min, 1) + ' %'; }
      else if (p >= r.max * 0.9) { f.className = 'gv-flag warn'; f.textContent = 'Cerca del m\u00e1ximo'; }
      else { f.className = 'gv-flag ok'; f.textContent = 'Dentro del rango'; }
    }
    app.addEventListener('change', function () { pct.value = rango().max; dose(); });
    pct.addEventListener('input', function () { evento('guia_dosificador', '', true); dose(); });
    vol.addEventListener('input', function () { evento('guia_dosificador', '', true); dose(); });
    app.addEventListener('change', function () { evento('guia_dosificador', '', true); });
    dose();
  }

  /* -- pH -- */
  var phin = $('#gv-phin'), phbox = $('.gv-ph');
  if (phin && phbox) {
    var lo = parseFloat(phbox.getAttribute('data-ph-min')), hi = parseFloat(phbox.getAttribute('data-ph-max'));
    function ph() {
      var v = parseFloat(phin.value), n = $('#gv-phn'), m = $('#gv-phmsg');
      n.style.left = (v / 14 * 100) + '%';
      n.setAttribute('data-v', 'pH ' + fmt(v, 1));
      var t = 'pH ' + fmt(v, 1) + ' \u00b7 ';
      if (v >= lo && v <= hi) { m.className = 'gv-phmsg'; m.textContent = t + 'Dentro de la zona de trabajo (' + fmt(lo, 1) + ' a ' + fmt(hi, 1) + ').'; }
      else if (v > hi) { m.className = 'gv-phmsg ' + (v - hi > 1 ? 'bad' : 'warn'); m.textContent = t + 'Por encima del rango. La gu\u00eda pide trabajar entre ' + fmt(lo, 1) + ' y ' + fmt(hi, 1) + '; ajustar hacia abajo antes de incorporar.'; }
      else { m.className = 'gv-phmsg ' + (lo - v > 1 ? 'bad' : 'warn'); m.textContent = t + 'Por debajo del rango. La gu\u00eda pide trabajar entre ' + fmt(lo, 1) + ' y ' + fmt(hi, 1) + '; ajustar hacia arriba.'; }
    }
    phin.addEventListener('input', function () { evento('guia_ph', '', true); ph(); });
    ph();
  }

  /* -- Cadena de incorporacion -- */
  var chain = $('#gv-chain');
  if (chain) {
    var nodes = $$('.gv-cn', chain), det = $('#gv-chain-detail'), cur = 0, tour = null, tocado = false;
    function show(i) {
      cur = i;
      nodes.forEach(function (n, k) { n.classList.toggle('on', k === i); });
      det.textContent = nodes[i].getAttribute('data-texto') || '';
    }
    nodes.forEach(function (n, i) {
      $('button', n).addEventListener('click', function () { tocado = true; if (tour) { clearInterval(tour); tour = null; } show(i); });
    });
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (nodes.length > 1 && !reduce && 'IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !tour && !tocado) {
            tour = setInterval(function () { show((cur + 1) % nodes.length); }, 3600);
          } else if (!e.isIntersecting && tour) { clearInterval(tour); tour = null; }
        });
      }, { threshold: 0.5 });
      obs.observe(chain);
    }
  }

  /* -- Clic de la guia a una receta -- */
  $$('.gv-rc').forEach(function (a) { a.addEventListener('click', function () { evento('guia_receta_click', (a.getAttribute('href') || '').split('/').pop(), false); }); });

  /* -- Nav pegajosa: marca la seccion visible -- */
  var links = $$('.gv-nav a');
  if (links.length && 'IntersectionObserver' in window) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var secObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (a) { a.classList.remove('on'); });
          var a = byId[e.target.id]; if (a) a.classList.add('on');
        }
      });
    }, { rootMargin: '-40% 0px -50% 0px' });
    $$('.gv-mod[id], .gv-plain[id]').forEach(function (s) { secObs.observe(s); });
  }
})();
