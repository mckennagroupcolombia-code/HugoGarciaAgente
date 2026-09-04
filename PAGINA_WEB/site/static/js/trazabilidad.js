/* Trazabilidad ilustrada: mapamundi de origen + mapa de Colombia.
   Sin dependencias. Datos embebidos en <script type="application/json"> por
   _ruta_origen.html y _cobertura.html. */
(function () {
  'use strict';

  var FLAGS = {
    'China': '🇨🇳', 'India': '🇮🇳', 'Pakistán': '🇵🇰', 'Bolivia': '🇧🇴', 'Argentina': '🇦🇷', 'Brasil': '🇧🇷',
    'Perú': '🇵🇪', 'Chile': '🇨🇱', 'México': '🇲🇽', 'Estados Unidos': '🇺🇸', 'Alemania': '🇩🇪', 'España': '🇪🇸',
    'Francia': '🇫🇷', 'Italia': '🇮🇹', 'Países Bajos': '🇳🇱', 'Reino Unido': '🇬🇧', 'Turquía': '🇹🇷', 'Egipto': '🇪🇬',
    'Marruecos': '🇲🇦', 'Sudáfrica': '🇿🇦', 'Malasia': '🇲🇾', 'Indonesia': '🇮🇩', 'Tailandia': '🇹🇭', 'Vietnam': '🇻🇳',
    'Japón': '🇯🇵', 'Corea del Sur': '🇰🇷', 'Australia': '🇦🇺', 'Nueva Zelanda': '🇳🇿', 'Colombia': '🇨🇴', 'Ghana': '🇬🇭'
  };
  var MODO = { maritimo: 'Marítimo', aereo: 'Aéreo', nacional: 'Nacional' };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function readJSON(sel) { var el = $(sel); if (!el) return null; try { return JSON.parse(el.textContent); } catch (e) { return null; } }

  /* ── Contadores animados al entrar en pantalla ── */
  function animateCount(el) {
    var target = parseInt(el.getAttribute('data-count'), 10) || 0;
    var start = null, dur = 1100;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString('es-CO');
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var cobs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { animateCount(e.target); cobs.unobserve(e.target); } });
    }, { threshold: 0.4 });
    $$('[data-count]').forEach(function (el) { cobs.observe(el); });
  } else {
    $$('[data-count]').forEach(function (el) { el.textContent = el.getAttribute('data-count'); });
  }

  $$('[data-tz-flag]').forEach(function (el) { el.textContent = FLAGS[el.getAttribute('data-tz-flag')] || '🌐'; });

  /* ════════════════ Mapamundi: origen ════════════════ */
  var root = $('[data-tz-root]');
  var data = readJSON('[data-tz-data]');
  if (root && data && data.rutas) {
    var rutas = {};
    data.rutas.forEach(function (r) { rutas[r.pais] = r; });
    var lineas = {};
    (data.lineas || []).forEach(function (L) { lineas[L.id] = L; });
    var panel = $('[data-tz-panel]', root);
    var panelDefault = $('.tz-panel-default', panel);
    var panelCountry = $('.tz-panel-country', panel);
    var lineaActiva = '';
    var paisActivo = null;
    var userTouched = false;

    function pinsDe(pais) { return $$('[data-tz-pin="' + pais + '"]', root); }

    function aplicarFiltro() {
      var visibles = 0, refs = 0;
      $$('[data-tz-lineas]', root).forEach(function (el) {
        var ls = (el.getAttribute('data-tz-lineas') || '').split(' ');
        var ok = !lineaActiva || ls.indexOf(lineaActiva) !== -1;
        el.classList.toggle('is-dim', !ok);
        if (ok && el.hasAttribute('data-tz-pin')) {
          visibles++;
          var r = rutas[el.getAttribute('data-tz-pin')];
          if (r) refs += lineaActiva ? (r.por_linea[lineaActiva] || 0) : r.n_productos;
          var b = $('b', el);
          if (b && r) b.textContent = lineaActiva ? (r.por_linea[lineaActiva] || 0) : (r.n_productos || r.n_red);
        }
      });
      var live = $('[data-tz-live]', root);
      if (live) {
        live.textContent = lineaActiva
          ? (lineas[lineaActiva] ? lineas[lineaActiva].name : '') + ': ' + refs + ' referencias desde ' + visibles + ' países'
          : visibles + ' rutas activas · ' + refs + ' referencias con origen declarado';
      }
      if (paisActivo) renderPais(paisActivo);
    }

    $$('[data-tz-linea]', root).forEach(function (chip) {
      chip.addEventListener('click', function () {
        userTouched = true;
        lineaActiva = chip.getAttribute('data-tz-linea') || '';
        $$('[data-tz-linea]', root).forEach(function (c) { c.classList.toggle('is-active', c === chip); });
        aplicarFiltro();
      });
    });

    function badge(cls, txt, title) { return '<span class="tz-badge ' + cls + '" title="' + esc(title) + '">' + txt + '</span>'; }

    function renderPais(pais) {
      var r = rutas[pais];
      if (!r) return;
      paisActivo = pais;
      $$('[data-tz-pin]', root).forEach(function (p) { p.setAttribute('aria-pressed', String(p.getAttribute('data-tz-pin') === pais)); });
      $$('[data-tz-pais]', root).forEach(function (g) { g.classList.toggle('is-active', g.getAttribute('data-tz-pais') === pais); });
      var prods = (r.productos || []).filter(function (p) { return !lineaActiva || p.linea === lineaActiva; });
      var porLinea = Object.keys(r.por_linea || {}).map(function (lid) {
        var L = lineas[lid] || { name: lid, color: '#5C6570' };
        return '<span class="tz-mini-chip" style="--chip:' + L.color + '">' + esc(L.name) + ' <b>' + r.por_linea[lid] + '</b></span>';
      }).join('');
      var html = '' +
        '<div class="tz-pc-head">' +
          '<span class="tz-pc-flag">' + (FLAGS[pais] || '🌐') + '</span>' +
          '<div><span class="tz-panel-eyebrow">Origen declarado</span><h3>' + esc(pais) + '</h3></div>' +
          '<button type="button" class="tz-pc-close" data-tz-close aria-label="Cerrar"><i class="ph ph-x"></i></button>' +
        '</div>' +
        '<ul class="tz-pc-route">' +
          '<li><i class="ph ph-factory"></i><span>Fábrica en ' + esc(pais) + '</span></li>' +
          '<li><i class="ph ph-' + (r.modo === 'aereo' ? 'airplane-tilt' : 'boat') + '"></i><span>' + esc(MODO[r.modo] || 'Marítimo') + ' · ingreso por ' + esc(r.puerto_entrada || 'Colombia') + '</span></li>' +
          '<li><i class="ph ph-flask"></i><span>Control de calidad y reenvase en Bogotá</span></li>' +
        '</ul>' +
        '<div class="tz-pc-stats">' +
          '<div><b>' + (r.n_productos || 0) + '</b><span>referencias en stock</span></div>' +
          '<div><b>' + (r.n_tds || 0) + '</b><span>con ficha técnica</span></div>' +
          '<div><b>' + (r.n_coa || 0) + '</b><span>con COA</span></div>' +
          (r.n_red ? '<div><b>' + r.n_red + '</b><span>bajo pedido</span></div>' : '') +
        '</div>' +
        (porLinea ? '<div class="tz-pc-lineas">' + porLinea + '</div>' : '') +
        '<ul class="tz-pc-list">' +
          prods.slice(0, 10).map(function (p) {
            var url = (data.producto_url || '').replace('__SLUG__', p.slug);
            return '<li style="--chip:' + esc(p.color) + '">' +
              '<a href="' + esc(url) + '"><i class="tz-pc-dot"></i><span class="tz-pc-name">' + esc(p.nombre) + '</span></a>' +
              '<span class="tz-pc-badges">' +
                (p.coa ? badge('is-coa', 'COA', 'Certificado de análisis publicado') : '') +
                (p.tds ? badge('is-tds', 'TDS', 'Ficha técnica publicada') : '') +
                (p.stock > 0 ? badge('is-stock', 'Stock', 'Disponible en Bogotá') : '') +
              '</span></li>';
          }).join('') +
          (r.muestra_red && r.muestra_red.length ? r.muestra_red.map(function (n) {
            return '<li class="is-red"><span><i class="tz-pc-dot"></i><span class="tz-pc-name">' + esc(n) + '</span></span>' + badge('is-red', 'Bajo pedido', 'Disponible por cotización') + '</li>';
          }).join('') : '') +
        '</ul>' +
        (prods.length > 10 ? '<p class="tz-pc-more">y ' + (prods.length - 10) + ' referencias más desde ' + esc(pais) + '.</p>' : '') +
        '<a class="tz-pc-cta" href="' + esc(data.cotizar_url) + '?q=' + encodeURIComponent(pais) + '">Ver toda la oferta desde ' + esc(pais) + ' <i class="ph ph-arrow-right"></i></a>';
      panelCountry.innerHTML = html;
      panelCountry.hidden = false;
      panelDefault.hidden = true;
      $('[data-tz-close]', panelCountry).addEventListener('click', cerrarPais);
    }

    function cerrarPais() {
      paisActivo = null;
      panelCountry.hidden = true;
      panelDefault.hidden = false;
      $$('[data-tz-pin]', root).forEach(function (p) { p.setAttribute('aria-pressed', 'false'); });
      $$('[data-tz-pais]', root).forEach(function (g) { g.classList.remove('is-active'); });
    }

    $$('[data-tz-pin]', root).forEach(function (pin) {
      pin.addEventListener('click', function () {
        userTouched = true;
        var pais = pin.getAttribute('data-tz-pin');
        if (paisActivo === pais) cerrarPais(); else renderPais(pais);
      });
      pin.addEventListener('mouseenter', function () {
        $$('[data-tz-pais]', root).forEach(function (g) { g.classList.toggle('is-hover', g.getAttribute('data-tz-pais') === pin.getAttribute('data-tz-pin')); });
      });
      pin.addEventListener('mouseleave', function () { $$('[data-tz-pais].is-hover', root).forEach(function (g) { g.classList.remove('is-hover'); }); });
    });
    $$('[data-tz-goto]', root).forEach(function (b) {
      b.addEventListener('click', function () { userTouched = true; renderPais(b.getAttribute('data-tz-goto')); });
    });
    $$('[data-tz-scroll]', root).forEach(function (n) {
      n.addEventListener('click', function () {
        var t = $(n.getAttribute('data-tz-scroll'));
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    /* Tour automático: resalta países mientras el usuario no interactúa. */
    var orden = data.rutas.map(function (r) { return r.pais; });
    var idx = 0, tourTimer = null;
    function tourTick() {
      if (userTouched || !orden.length) return;
      $$('[data-tz-pais]', root).forEach(function (g) { g.classList.remove('is-hover'); });
      var pais = orden[idx % orden.length];
      $$('[data-tz-pais="' + pais + '"]', root).forEach(function (g) { g.classList.add('is-hover'); });
      pinsDe(pais).forEach(function (p) { p.classList.add('is-tour'); setTimeout(function () { p.classList.remove('is-tour'); }, 2300); });
      idx++;
    }
    if ('IntersectionObserver' in window) {
      var tobs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !tourTimer) { tourTick(); tourTimer = setInterval(tourTick, 2600); }
          else if (!e.isIntersecting && tourTimer) { clearInterval(tourTimer); tourTimer = null; }
        });
      }, { threshold: 0.3 });
      tobs.observe($('.tz-map', root) || root);
    }
    aplicarFiltro();
  }

  /* ════════════════ Colombia: destino ════════════════ */
  var coRoot = $('[data-co-root]');
  var coData = readJSON('[data-co-data]');
  if (coRoot && coData && coData.departamentos) {
    var deps = {};
    coData.departamentos.forEach(function (d) { deps[d.id] = d; });
    var svg = $('.co-map', coRoot);
    var wrap = $('.co-map-wrap', coRoot);
    var tip = $('[data-co-tooltip]', coRoot);
    var pulses = $('[data-co-pulses]', coRoot);
    var SVGNS = 'http://www.w3.org/2000/svg';

    /* Colorear departamentos según cobertura real. */
    $$('.co-dep', svg).forEach(function (path) {
      var id = (path.id || '').replace('dep-', '');
      var d = deps[id];
      if (!d) return;
      if (d.alcanzado) {
        path.classList.add('is-reached');
        path.style.setProperty('--k', d.intensidad);
      } else {
        path.classList.add('is-pending');
      }
      path.addEventListener('mousemove', function (ev) { showTip(d, ev); });
      path.addEventListener('mouseenter', function (ev) { showTip(d, ev); path.classList.add('is-hover'); });
      path.addEventListener('mouseleave', function () { tip.hidden = true; path.classList.remove('is-hover'); });
      path.addEventListener('click', function (ev) { showTip(d, ev, true); });
    });

    function showTip(d, ev, sticky) {
      var html = '<strong>' + esc(d.nombre) + '</strong>';
      if (d.alcanzado) {
        html += '<span class="co-tip-line"><i class="ph ph-package"></i> ' + d.n_pedidos + ' pedido' + (d.n_pedidos !== 1 ? 's' : '') + ' entregado' + (d.n_pedidos !== 1 ? 's' : '') + '</span>';
        html += '<span class="co-tip-line"><i class="ph ph-map-pin"></i> ' + d.n_municipios + ' de ' + d.total_municipios + ' municipios</span>';
        if (d.municipios && d.municipios.length) html += '<span class="co-tip-muni">' + d.municipios.map(esc).join(' · ') + (d.n_municipios > d.municipios.length ? ' …' : '') + '</span>';
      } else {
        html += '<span class="co-tip-line co-tip-pending"><i class="ph ph-compass"></i> Aún no hemos llegado aquí</span>';
        html += '<span class="co-tip-muni">' + d.total_municipios + ' municipios por impactar. ¿Eres el primero?</span>';
      }
      tip.innerHTML = html;
      tip.hidden = false;
      var rect = wrap.getBoundingClientRect();
      var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      tip.style.left = Math.min(x + 14, rect.width - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.max(8, y - tip.offsetHeight - 12) + 'px';
      if (sticky) { clearTimeout(tip._t); tip._t = setTimeout(function () { tip.hidden = true; }, 3500); }
    }

    /* Pulsos en departamentos con despachos esta semana (posición = centro del path). */
    (coData.deps_semana || []).forEach(function (nombre, i) {
      var d = coData.departamentos.filter(function (x) { return x.nombre === nombre; })[0];
      if (!d) return;
      var g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'co-pulse');
      g.setAttribute('transform', 'translate(' + d.cx + ' ' + d.cy + ')');
      g.style.animationDelay = (i * 0.45) + 's';
      var ring = document.createElementNS(SVGNS, 'circle'); ring.setAttribute('r', '4'); ring.setAttribute('class', 'co-pulse-ring');
      ring.style.animationDelay = (i * 0.45) + 's';
      var dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', '3.2'); dot.setAttribute('class', 'co-pulse-dot');
      g.appendChild(ring); g.appendChild(dot);
      pulses.appendChild(g);
      var path = $('#dep-' + d.id, svg);
      if (path) path.classList.add('is-week');
    });

    /* "Ir a" desde el panel: resalta el departamento y muestra su ficha. */
    $$('[data-co-goto]', coRoot).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-co-goto');
        var path = $('#dep-' + id, svg);
        var d = deps[id];
        if (!path || !d) return;
        $$('.co-dep.is-focus', svg).forEach(function (p) { p.classList.remove('is-focus'); });
        path.classList.add('is-focus');
        var box = path.getBBox();
        var rect = wrap.getBoundingClientRect();
        var vb = svg.viewBox.baseVal;
        var fake = { clientX: rect.left + (box.x + box.width / 2) / vb.width * rect.width, clientY: rect.top + (box.y + box.height / 2) / vb.height * rect.height };
        showTip(d, fake, true);
        if (window.innerWidth < 900) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }
})();
