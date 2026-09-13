/* Recetario en "modo laboratorio": un paso por pantalla.
   Lee la receta (data/recetas.json v2) desde #receta-data y no llama a
   ninguna IA: todo es estatico y determinista. Sin dependencias.
   - Escala cantidades y arma la lista de compra ("me falta" -> /carrito/agregar-lote).
   - Un pictograma SVG animado por accion (verter, disolver, mezclar, calentar,
     enfriar, reposar, envasar, pesar).
   - Temporizador cuando el paso trae `min`.
   - Wake Lock (pantalla encendida) y lectura en voz alta (SpeechSynthesis). */
(function () {
  'use strict';

  var dataEl = document.getElementById('receta-data');
  var root = document.getElementById('rw');
  if (!dataEl || !root) return;
  var R;
  try { R = JSON.parse(dataEl.textContent); } catch (e) { return; }

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) {
    var v = n >= 10 ? Math.round(n) : Math.round(n * 100) / 100;
    return v.toLocaleString('es-CO');
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  var pasos = R.pasos || [];
  var ings = R.ings || [];
  var TOTAL = pasos.length + 1; // 0 = preparar, 1..n = pasos, n+1 = listo
  var state = { p: 0, scale: 1, have: ings.map(function () { return true; }), timers: {}, wake: null };
  function evento(nombre, detalle, unaVez) { try { if (window.mckEvento) window.mckEvento(nombre, R.slug, detalle, unaVez); } catch (e) {} }
  evento('receta_abierta', '', true);

  /* Pictogramas: un vaso de precipitados con variantes por accion. */
  var GLASS = '<path class="rw-glass" d="M28 24 H92 M32 30 V96 Q32 104 40 104 H80 Q88 104 88 96 V30"/>';
  var CLIP = function (id) { return '<defs><clipPath id="' + id + '"><path d="M32 30 H88 V96 Q88 104 80 104 H40 Q32 104 32 96 Z"/></clipPath></defs>'; };
  var SVG = {
    verter: '<svg viewBox="0 0 120 120" aria-hidden="true">' + CLIP('rwc1') + '<g clip-path="url(#rwc1)"><rect class="rw-liquid" x="32" y="66" width="56" height="40"/></g>' + GLASS + '<path class="rw-stream" d="M70 8 Q72 30 62 66" fill="none" stroke="currentColor" style="color:var(--green-light)" stroke-width="3" stroke-linecap="round" opacity="0"/><path d="M62 4 H86 L82 12 H66 Z" fill="none" stroke="currentColor" style="color:var(--green-deep)" stroke-width="2"/></svg>',
    disolver: '<svg viewBox="0 0 120 120" aria-hidden="true">' + CLIP('rwc2') + '<g clip-path="url(#rwc2)"><rect class="rw-liquid" x="32" y="52" width="56" height="54" style="transform:none"/><circle class="rw-particle" cx="50" cy="56" r="2.5"/><circle class="rw-particle" cx="60" cy="52" r="2"/><circle class="rw-particle" cx="70" cy="58" r="2.5" style="animation-delay:.3s"/><circle class="rw-particle" cx="55" cy="50" r="1.8" style="animation-delay:.6s"/><circle class="rw-particle" cx="66" cy="54" r="2" style="animation-delay:.9s"/></g><line class="rw-rod" x1="60" y1="14" x2="72" y2="92"/>' + GLASS + '</svg>',
    mezclar: '<svg viewBox="0 0 120 120" aria-hidden="true">' + CLIP('rwc3') + '<g clip-path="url(#rwc3)"><rect class="rw-liquid" x="32" y="52" width="56" height="54" style="transform:none"/><path class="rw-wave" d="M28 58 Q40 52 52 58 T76 58 T100 58"/><circle class="rw-drop" cx="60" cy="40" r="3"/></g><line class="rw-rod" x1="60" y1="14" x2="70" y2="92"/>' + GLASS + '</svg>',
    calentar: '<svg viewBox="0 0 120 120" aria-hidden="true">' + CLIP('rwc4') + '<g clip-path="url(#rwc4)"><rect class="rw-liquid" x="32" y="52" width="56" height="54" style="transform:none"/><circle class="rw-bubble" cx="48" cy="98" r="2.5"/><circle class="rw-bubble" cx="62" cy="100" r="3" style="animation-delay:.6s"/><circle class="rw-bubble" cx="74" cy="97" r="2" style="animation-delay:1.2s"/></g>' + GLASS + '<path class="rw-flame" d="M60 118 C50 110 52 104 56 100 C57 105 60 106 60 106 C60 100 64 98 64 94 C70 100 72 112 60 118 Z"/><line x1="36" y1="108" x2="84" y2="108" stroke="currentColor" style="color:var(--green-deep)" stroke-width="2.5" stroke-linecap="round"/></svg>',
    enfriar: '<svg viewBox="0 0 120 120" aria-hidden="true">' + CLIP('rwc5') + '<g clip-path="url(#rwc5)"><rect class="rw-liquid" x="32" y="52" width="56" height="54" style="transform:none"/></g>' + GLASS + '<g><path class="rw-snow" d="M22 20 l0 14 M15 27 l14 0 M17 22 l10 10 M27 22 l-10 10" stroke="currentColor" style="color:var(--green)" stroke-width="1.5" fill="none"/><path class="rw-snow" d="M98 12 l0 12 M92 18 l12 0 M94 14 l8 8 M102 14 l-8 8" stroke="currentColor" style="color:var(--green)" stroke-width="1.5" fill="none" style="animation-delay:.8s"/></g></svg>',
    reposar: '<svg viewBox="0 0 120 120" aria-hidden="true">' + CLIP('rwc6') + '<g clip-path="url(#rwc6)"><rect class="rw-liquid" x="32" y="52" width="56" height="54" style="transform:none"/></g>' + GLASS + '<circle class="rw-clock" cx="96" cy="26" r="14"/><line class="rw-clock rw-clock-hand" x1="96" y1="26" x2="96" y2="16" style="transform-origin:96px 26px"/><line class="rw-clock" x1="96" y1="26" x2="103" y2="26"/></svg>',
    envasar: '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><clipPath id="rwc7"><path d="M42 44 H78 V100 Q78 106 72 106 H48 Q42 106 42 100 Z"/></clipPath></defs><g clip-path="url(#rwc7)"><rect class="rw-liquid" x="42" y="44" width="36" height="62" style="fill:var(--green-dark);opacity:.9"/></g><path class="rw-glass" d="M52 30 H68 V40 Q78 44 78 52 V100 Q78 106 72 106 H48 Q42 106 42 100 V52 Q42 44 52 40 Z"/><rect x="50" y="18" width="20" height="12" rx="2" fill="currentColor" style="color:var(--green-deep)"/><line x1="60" y1="30" x2="60" y2="72" stroke="#fff" stroke-width="2" opacity=".6"/></svg>',
    pesar: '<svg viewBox="0 0 120 120" aria-hidden="true"><rect x="24" y="86" width="72" height="18" rx="4" fill="none" stroke="currentColor" style="color:var(--green)" stroke-width="2.5"/><rect x="30" y="92" width="26" height="7" rx="2" fill="currentColor" style="color:var(--green-light)"/><rect x="36" y="76" width="48" height="6" rx="2" fill="currentColor" style="color:var(--green)"/><g class="rw-weight"><path d="M46 76 L52 52 H68 L74 76 Z"/><path d="M52 52 Q60 40 68 52" fill="none" stroke="currentColor" style="color:var(--green-deep)" stroke-width="3"/></g></svg>'
  };
  var CAPS = { verter: 'Vertiendo', disolver: 'Disolviendo', mezclar: 'Mezclando', calentar: 'Calentando', enfriar: 'Enfriando', reposar: 'Reposando', envasar: 'Envasando', pesar: 'Pesando' };
  var VERBO = { verter: 'Verter', disolver: 'Disolver', mezclar: 'Mezclar', calentar: 'Calentar', enfriar: 'Enfriar', reposar: 'Reposar', envasar: 'Envasar', pesar: 'Pesar' };

  /* \u2500\u2500 Riel \u2500\u2500 */
  function renderRail() {
    var labels = ['Preparar'].concat(pasos.map(function (p, i) { return 'Paso ' + (i + 1); })).concat(['Listo']);
    $('#rw-rail').innerHTML = labels.map(function (l, i) {
      var cls = i < state.p ? 'done' : (i === state.p ? 'current' : '');
      var mark = i === 0 ? '\u00b7' : (i === TOTAL ? '\u2605' : String(i));
      return '<li><button type="button" class="rw-step ' + cls + '" data-go="' + i + '" aria-current="' + (i === state.p ? 'step' : 'false') + '"><span class="n"><span>' + mark + '</span></span><span class="lb">' + esc(l) + '</span></button></li>';
    }).join('');
    $$('#rw-rail [data-go]').forEach(function (b) { b.addEventListener('click', function () { go(+b.getAttribute('data-go')); }); });
  }

  /* \u2500\u2500 Preparar: escala + ingredientes \u2500\u2500 */
  function presets() {
    var base = Number(R.base) || 100;
    var list = [base / 2, base, base * 2.5, base * 5].map(function (v) { return Math.round(v); }).filter(function (v, i, a) { return v > 0 && a.indexOf(v) === i; });
    $('#rw-presets').innerHTML = list.map(function (v) {
      return '<button type="button" class="rw-chip' + (v === base ? ' on' : '') + '" data-q="' + v + '">' + fmt(v) + '</button>';
    }).join('');
    $$('#rw-presets .rw-chip').forEach(function (c) {
      c.addEventListener('click', function () { $('#rw-qty').value = c.getAttribute('data-q'); onQty(); });
    });
  }
  function onQty() {
    var v = parseFloat($('#rw-qty').value);
    if (!(v > 0)) v = Number(R.base) || 100;
    state.scale = v / (Number(R.base) || 100);
    $$('#rw-presets .rw-chip').forEach(function (c) { c.classList.toggle('on', +c.getAttribute('data-q') === v); });
    var rend = $('#rw-rendimiento'); if (rend) rend.textContent = fmt(v) + ' ' + R.unidad;
    renderIngs();
  }
  function renderIngs() {
    $('#rw-ings').innerHTML = ings.map(function (i, k) {
      var cls = i.propio ? ' propio' : (i.slug ? '' : ' sin-producto');
      if (!state.have[k]) cls += ' missing';
      var sub;
      if (i.propio) sub = 'uso propio \u00b7 no se vende';
      else if (i.slug) sub = '<a href="/producto/' + esc(i.slug) + '">' + esc(i.producto || 'ver producto') + '</a>';
      else sub = 'consultar disponibilidad';
      var buy;
      if (i.familia) buy = '<a class="buy" href="/producto/' + esc(i.slug) + '">Elegir presentaci\u00f3n</a>';
      else buy = '<button class="buy" type="button" data-buy="' + k + '">Me falta \u00b7 al carrito</button>';
      return '<div class="rw-ing' + cls + '">' +
        '<input type="checkbox" id="rw-have-' + k + '" ' + (state.have[k] ? 'checked' : '') + ' aria-label="Tengo ' + esc(i.n) + '">' +
        '<div class="nm"><label for="rw-have-' + k + '">' + esc(i.n) + '</label><small>' + sub + '</small></div>' +
        '<div class="q">' + fmt(i.q * state.scale) + '<small>' + esc(i.u) + '</small></div>' + buy + '</div>';
    }).join('');
    $$('#rw-ings input[type="checkbox"]').forEach(function (c, k) {
      c.addEventListener('change', function () { state.have[k] = c.checked; renderIngs(); });
    });
    $$('#rw-ings [data-buy]').forEach(function (b) {
      b.addEventListener('click', function () { addToCart([+b.getAttribute('data-buy')], b); });
    });
    var missing = ings.map(function (i, k) { return k; }).filter(function (k) { return !state.have[k] && ings[k].slug && !ings[k].familia; });
    var hint = $('#rw-carthint');
    if (missing.length) {
      hint.innerHTML = '<span>Te faltan <b>' + missing.length + '</b>: ' + esc(missing.map(function (k) { return ings[k].n; }).join(', ')) + '.</span>' +
        '<button type="button" class="rw-btn" id="rw-addall">A\u00f1adir ' + missing.length + ' al carrito</button>';
      $('#rw-addall').addEventListener('click', function () { addToCart(missing, this); });
    } else {
      hint.innerHTML = '<span style="color:var(--text-muted)">Desmarca lo que te falte y lo armamos en el carrito con la cantidad ya escalada.</span>';
    }
  }
  function addToCart(keys, btn) {
    var items = keys.map(function (k) { return { slug: ings[k].slug, qty: 1 }; }).filter(function (x) { return x.slug; });
    if (!items.length) return;
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'A\u00f1adiendo\u2026';
    fetch('/carrito/agregar-lote', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ items: items, origen: 'receta:' + R.slug })
    }).then(function (r) { return r.json(); }).then(function (res) {
      var n = (res && res.agregados) || 0;
      if (n) evento('receta_carrito', n, false);
      btn.textContent = n ? ('A\u00f1adidos ' + n + ' \u2713') : 'No se pudo a\u00f1adir';
      if (res && res.avisos && res.avisos.length) {
        var hint = $('#rw-carthint');
        var p = document.createElement('span'); p.style.color = 'var(--text-muted)'; p.textContent = res.avisos.join(' '); hint.appendChild(p);
      }
      if (n) {
        var a = document.createElement('a'); a.className = 'rw-btn ghost'; a.href = '/carrito'; a.textContent = 'Ver carrito'; $('#rw-carthint').appendChild(a);
        var badge = document.querySelector('[data-cart-count]'); if (badge) badge.textContent = String((parseInt(badge.textContent, 10) || 0) + n);
      }
    }).catch(function () { btn.disabled = false; btn.textContent = label; });
  }

  /* \u2500\u2500 Pasos \u2500\u2500 */
  function stepQtys(idx) {
    // Ingredientes mencionados en el texto del paso, con la cantidad ya escalada.
    var t = pasos[idx - 1].texto.toLowerCase();
    var hits = ings.filter(function (i) {
      var w = i.n.toLowerCase().replace(/\(.*?\)/g, '').split(/\s+/).filter(function (x) { return x.length > 3; });
      return w.length && w.some(function (x) { return t.indexOf(x) >= 0; });
    });
    if (!hits.length) return '';
    return hits.map(function (i) { return fmt(i.q * state.scale) + ' ' + i.u + ' de ' + i.n.replace(/\s*\(.*?\)/g, '').toLowerCase(); }).join(' \u00b7 ');
  }
  function renderStep(idx) {
    var p = pasos[idx - 1];
    var el = $('.rw-panel[data-p="' + idx + '"]');
    var accion = SVG[p.accion] ? p.accion : 'mezclar';
    var params = [];
    if (p.fase) params.push('<span class="rw-param">Fase <b>' + esc(p.fase) + '</b></span>');
    if (p.temp_c != null) params.push('<span class="rw-param">Temperatura <b>' + esc(p.temp_c) + ' \u00b0C</b></span>');
    if (p.min) params.push('<span class="rw-param">Tiempo <b>' + p.min + ' min</b></span>');
    var qtys = stepQtys(idx);
    el.innerHTML = '<div><div class="rw-kicker">' + VERBO[accion] + (p.fase ? ' \u00b7 fase ' + esc(p.fase) : '') + '</div><h2 class="rw-step-text">' + esc(p.texto) + '</h2></div>' +
      '<div class="rw-step-layout"><div style="display:grid;gap:14px">' +
      (params.length ? '<div class="rw-params">' + params.join('') + '</div>' : '') +
      (p.min ? '<div class="rw-timer"><span class="t" id="rw-t' + idx + '">' + pad(p.min) + ':00</span><button class="rw-btn ghost" type="button" data-timer="' + idx + '">Iniciar temporizador</button></div>' : '') +
      (p.aviso ? '<div class="rw-caution"><b>Ojo.</b> ' + esc(p.aviso) + '</div>' : '') +
      (qtys ? '<p class="rw-qtys">Cantidades de este paso: ' + esc(qtys) + '</p>' : '') +
      '</div><div class="rw-lab act-' + accion + '">' + SVG[accion] + '<span class="cap">' + CAPS[accion] + '</span></div></div>';
    var tb = el.querySelector('[data-timer]');
    if (tb) tb.addEventListener('click', function () { toggleTimer(idx, p.min, tb); });
  }
  function toggleTimer(idx, min, btn) {
    if (state.timers[idx]) { clearInterval(state.timers[idx]); state.timers[idx] = null; btn.textContent = 'Reanudar'; return; }
    var out = $('#rw-t' + idx);
    var s = state['rest' + idx] != null ? state['rest' + idx] : min * 60;
    btn.textContent = 'Pausar';
    state.timers[idx] = setInterval(function () {
      s -= 1; state['rest' + idx] = s;
      out.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
      if (s <= 0) {
        clearInterval(state.timers[idx]); state.timers[idx] = null; state['rest' + idx] = null;
        out.textContent = 'Listo \u2713'; btn.textContent = 'Reiniciar';
        try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
      }
    }, 1000);
  }

  /* \u2500\u2500 Navegaci\u00f3n \u2500\u2500 */
  function speak(idx) {
    if ($('#rw-voice').getAttribute('aria-checked') !== 'true' || !('speechSynthesis' in window)) return;
    if (idx < 1 || idx > pasos.length) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance('Paso ' + idx + '. ' + pasos[idx - 1].texto);
      u.lang = 'es-CO'; window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  function go(n) {
    if (n < 0 || n > TOTAL) return;
    state.p = n;
    $$('.rw-panel').forEach(function (el) { el.classList.toggle('active', +el.getAttribute('data-p') === n); });
    if (n >= 1 && n <= pasos.length) renderStep(n);
    $('#rw-prog').style.width = (n / TOTAL * 100) + '%';
    $('#rw-stepof').textContent = n === 0 ? 'Preparaci\u00f3n' : (n === TOTAL ? 'Terminado' : 'Paso ' + n + ' de ' + pasos.length);
    $('#rw-prev').disabled = n === 0;
    var next = $('#rw-next');
    next.innerHTML = n === 0 ? 'Empezar <i class="ph ph-arrow-right"></i>' : (n === TOTAL ? 'Volver al inicio' : (n === pasos.length ? 'Terminar <i class="ph ph-check"></i>' : 'Siguiente <i class="ph ph-arrow-right"></i>'));
    renderRail();
    speak(n);
    if (n >= 1 && n <= pasos.length) evento('receta_paso', n, true);
    if (n === TOTAL) evento('receta_terminada', '', true);
    try { history.replaceState(null, '', n === 0 ? location.pathname : '#paso-' + n); } catch (e) {}
    if (window.innerWidth < 900) { root.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  $('#rw-next').addEventListener('click', function () { go(state.p === TOTAL ? 0 : state.p + 1); });
  $('#rw-prev').addEventListener('click', function () { go(state.p - 1); });
  $('#rw-qty').addEventListener('input', onQty);
  document.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    var r = root.getBoundingClientRect();
    if (r.top > window.innerHeight || r.bottom < 0) return;
    if (e.key === 'ArrowRight') go(Math.min(TOTAL, state.p + 1));
    if (e.key === 'ArrowLeft') go(state.p - 1);
  });
  var tx = null;
  root.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', function (e) {
    if (tx == null) return;
    var d = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(d) > 70) go(d < 0 ? Math.min(TOTAL, state.p + 1) : state.p - 1);
  }, { passive: true });

  /* \u2500\u2500 Pantalla encendida / voz \u2500\u2500 */
  var wakeBtn = $('#rw-wake');
  if (!('wakeLock' in navigator)) { wakeBtn.disabled = true; wakeBtn.title = 'Este navegador no lo soporta'; }
  wakeBtn.addEventListener('click', function () {
    var on = wakeBtn.getAttribute('aria-checked') === 'true';
    if (on) {
      if (state.wake) { try { state.wake.release(); } catch (e) {} state.wake = null; }
      wakeBtn.setAttribute('aria-checked', 'false');
    } else {
      navigator.wakeLock.request('screen').then(function (lock) {
        state.wake = lock; wakeBtn.setAttribute('aria-checked', 'true');
        lock.addEventListener('release', function () { state.wake = null; wakeBtn.setAttribute('aria-checked', 'false'); });
      }).catch(function () { wakeBtn.setAttribute('aria-checked', 'false'); });
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && wakeBtn.getAttribute('aria-checked') === 'true' && !state.wake && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(function (lock) { state.wake = lock; }).catch(function () {});
    }
  });
  var voiceBtn = $('#rw-voice');
  if (!('speechSynthesis' in window)) { voiceBtn.disabled = true; voiceBtn.title = 'Este navegador no lo soporta'; }
  voiceBtn.addEventListener('click', function () {
    var on = voiceBtn.getAttribute('aria-checked') === 'true';
    voiceBtn.setAttribute('aria-checked', on ? 'false' : 'true');
    if (on && 'speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    else speak(state.p);
  });

  /* \u2500\u2500 Arranque \u2500\u2500 */
  presets(); renderRail(); renderIngs();
  var m = /#paso-(\d+)/.exec(location.hash);
  if (m) { var n = parseInt(m[1], 10); if (n >= 1 && n <= pasos.length) go(n); }
})();
