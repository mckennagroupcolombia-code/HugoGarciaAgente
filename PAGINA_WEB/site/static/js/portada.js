/* Portada (Fase C, sep-2026): buscador del hero con sugerencias del catalogo
   (/api/buscar, sin IA), pestanas "Mas vendidos / En oferta" y nada mas.
   Sin dependencias. ASCII puro: los simbolos van escapados. */
(function () {
  'use strict';
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }

  /* -- Buscador con sugerencias -- */
  var form = $('[data-buscador]');
  if (form) {
    var input = $('[data-buscador-input]', form), lista = $('[data-buscador-sug]', form);
    var timer = null, ultimo = '', activo = -1, cache = {};
    function cerrar() { lista.hidden = true; lista.innerHTML = ''; activo = -1; }
    function pintar(q, productos) {
      if (!productos.length) { cerrar(); return; }
      lista.innerHTML = productos.map(function (p) {
        var img = p.photo ? '<img src="' + esc(p.photo) + '" alt="" loading="lazy">' : '<span class="sug-ph"><i class="ph ph-flask"></i></span>';
        return '<li><a href="/producto/' + esc(p.slug) + '">' + img + '<span><span class="sug-name">' + esc(p.name) + '</span><span class="sug-cat">' + esc(p.cat) + (p.buyable ? '' : ' \u00b7 agotado') + '</span></span><span class="sug-price">' + esc(p.precio || '') + '</span></a></li>';
      }).join('') + '<li><a class="sug-all" href="/tienda?q=' + encodeURIComponent(q) + '">Ver todos los resultados para \u201c' + esc(q) + '\u201d \u2192</a></li>';
      lista.hidden = false; activo = -1;
    }
    function buscar() {
      var q = input.value.trim();
      if (q.length < 2) { cerrar(); return; }
      if (q === ultimo) return;
      ultimo = q;
      if (cache[q]) { pintar(q, cache[q]); return; }
      fetch('/api/buscar?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { productos: [] }; })
        .then(function (d) { cache[q] = d.productos || []; if (input.value.trim() === q) pintar(q, cache[q]); })
        .catch(function () { cerrar(); });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(buscar, 160); });
    input.addEventListener('focus', function () { if (input.value.trim().length >= 2 && lista.innerHTML) lista.hidden = false; });
    input.addEventListener('keydown', function (e) {
      var items = $$('li a', lista);
      if (lista.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach(function (a, i) { a.classList.toggle('is-active', i === activo); });
        items[activo].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && activo >= 0) {
        e.preventDefault(); window.location.href = items[activo].getAttribute('href');
      } else if (e.key === 'Escape') { cerrar(); }
    });
    document.addEventListener('click', function (e) { if (!form.contains(e.target)) cerrar(); });
    form.addEventListener('submit', function (e) { if (input.value.trim().length < 2) e.preventDefault(); });
  }

  /* -- Trazabilidad condensada: pestanas Mundo / Colombia + plegado en celular -- */
  var tzc = $('[data-tzc-tabs]');
  if (tzc) {
    var tzPaneles = $$('[data-tzc-panel]');
    $$('[data-tzc-tab]', tzc).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-tzc-tab');
        $$('[data-tzc-tab]', tzc).forEach(function (x) { var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', String(on)); });
        tzPaneles.forEach(function (p) { p.hidden = p.getAttribute('data-tzc-panel') !== id; });
        var st = $('[data-tzc-stage]'); if (st) st.removeAttribute('data-collapsed');
        var tg = $('[data-tzc-toggle]'); if (tg) { tg.setAttribute('aria-expanded', 'true'); $('span', tg).textContent = 'Ocultar el mapa'; }
      });
    });
    var stage = $('[data-tzc-stage]'), toggle = $('[data-tzc-toggle]');
    if (stage && toggle) {
      var movil = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
      if (movil) { stage.setAttribute('data-collapsed', ''); toggle.setAttribute('aria-expanded', 'false'); }
      else { $('span', toggle).textContent = 'Ocultar el mapa'; }
      toggle.addEventListener('click', function () {
        var abierto = !stage.hasAttribute('data-collapsed');
        if (abierto) { stage.setAttribute('data-collapsed', ''); toggle.setAttribute('aria-expanded', 'false'); $('span', toggle).textContent = 'Ver el mapa'; }
        else { stage.removeAttribute('data-collapsed'); toggle.setAttribute('aria-expanded', 'true'); $('span', toggle).textContent = 'Ocultar el mapa'; stage.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
    }
  }

  /* -- Pestanas de productos -- */
  var tabs = $('[data-dest-tabs]');
  if (tabs) {
    var paneles = $$('[data-dest-panel]');
    $$('[data-dest-tab]', tabs).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-dest-tab');
        $$('[data-dest-tab]', tabs).forEach(function (x) { var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', String(on)); });
        paneles.forEach(function (p) { p.hidden = p.getAttribute('data-dest-panel') !== id; });
        var sec = tabs.closest('.dest-section'); if (sec) sec.classList.toggle('is-vendidos', id === 'vendidos');
      });
    });
  }
})();
