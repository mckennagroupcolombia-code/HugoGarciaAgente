/* Fondo químico del sitio — McKenna Group (14-sep-2026)
 *
 * Tres efectos, todos opcionales y todos apagables:
 *   · imán del cursor  — las estructuras cercanas se acercan 2-5 px
 *   · parallax de scroll — 10 px como máximo, por capas
 *   · la científica    — se traslada unos píxeles con el puntero
 *
 * El movimiento se interpola (lerp) hacia el objetivo en cada frame, que es lo
 * que evita los tirones; el bucle se apaga solo cuando todo llega a destino,
 * así que en reposo no consume nada.
 *
 * Tres modos, decididos por matchMedia y revisados si el sistema cambia:
 *   puntero fino → todo · táctil → solo deriva CSS · reduced-motion → nada.
 */
(function () {
  'use strict';

  // La capa es fija y vive en base.html: el ancla es ella, no el hero, para
  // que esto funcione igual en todas las páginas del sitio.
  var capa = document.querySelector('.chemistry-background--sitio');
  if (!capa) return;
  var hero = document.querySelector('.hero--foto');   // puede no existir

  var mqFino   = window.matchMedia('(hover: hover) and (pointer: fine)');
  var mqQuieto = window.matchMedia('(prefers-reduced-motion: reduce)');

  var RADIO = 300;    // px: a partir de aquí el imán deja de notarse
  var IMAN_MAX = 5;   // px de desplazamiento máximo por estructura
  var SCROLL_MAX = 10;

  var grupos = [];    // { el, factor, cx, cy, x, y, tx, ty }
  var raton = { x: -9999, y: -9999, activo: false };
  var hx = 0, hy = 0, thx = 0, thy = 0;
  var scroll = 0;
  var corriendo = false;

  function medir() {
    var svg = capa.querySelector('svg');
    if (!svg) return;
    grupos = [].map.call(svg.querySelectorAll('.chemical'), function (el, i) {
      var r = el.getBoundingClientRect();
      return {
        el: el,
        // cada estructura responde al scroll a su propia velocidad
        factor: 0.35 + (i % 3) * 0.32,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        x: 0, y: 0, tx: 0, ty: 0
      };
    });
  }

  function objetivos() {
    for (var i = 0; i < grupos.length; i++) {
      var g = grupos[i];
      g.tx = 0; g.ty = 0;
      if (raton.activo) {
        var dx = raton.x - g.cx, dy = raton.y - g.cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < RADIO && dist > 0.5) {
          // ligeramente magnético: se acerca al cursor, más cuanto más cerca
          var f = (1 - dist / RADIO) * IMAN_MAX;
          g.tx = dx / dist * f;
          g.ty = dy / dist * f;
        }
      }
    }
  }

  function animar() {
    var vivo = false;

    var k = 0.12;   // interpolación: 12 % de lo que falta en cada frame
    hx += (thx - hx) * k;
    hy += (thy - hy) * k;
    if (Math.abs(thx - hx) > 0.001 || Math.abs(thy - hy) > 0.001) vivo = true;
    // en :root, para que lo lea tanto la capa como la ilustración del hero
    document.documentElement.style.setProperty('--hx', hx.toFixed(3));
    document.documentElement.style.setProperty('--hy', hy.toFixed(3));

    for (var i = 0; i < grupos.length; i++) {
      var g = grupos[i];
      var ty = g.ty + scroll * g.factor;
      g.x += (g.tx - g.x) * k;
      g.y += (ty - g.y) * k;
      if (Math.abs(g.tx - g.x) > 0.05 || Math.abs(ty - g.y) > 0.05) vivo = true;
      g.el.style.transform = 'translate3d(' + g.x.toFixed(2) + 'px,' + g.y.toFixed(2) + 'px,0)';
    }

    if (vivo) requestAnimationFrame(animar);
    else corriendo = false;
  }

  function arrancar() {
    if (corriendo) return;
    corriendo = true;
    requestAnimationFrame(animar);
  }

  function alMover(e) {
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    thx = Math.max(-1, Math.min(1, e.clientX / w * 2 - 1));
    thy = Math.max(-1, Math.min(1, e.clientY / h * 2 - 1));
    raton.x = e.clientX; raton.y = e.clientY; raton.activo = true;
    objetivos();
    arrancar();
  }

  function alSalir() {
    thx = 0; thy = 0;
    raton.activo = false;
    objetivos();
    arrancar();
  }

  function alScroll() {
    // La capa es fija, así que el desplazamiento se acota contra la altura de
    // una pantalla: tope de 10 px y nunca se sale del encuadre.
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    scroll = Math.max(0, Math.min(1, y / (window.innerHeight || 1))) * SCROLL_MAX;
    arrancar();
  }

  function limpiar() {
    for (var i = 0; i < grupos.length; i++) grupos[i].el.style.transform = '';
    document.documentElement.style.removeProperty('--hx');
    document.documentElement.style.removeProperty('--hy');
  }

  function configurar() {
    document.removeEventListener('pointermove', alMover);
    document.removeEventListener('pointerleave', alSalir);
    window.removeEventListener('scroll', alScroll);
    window.removeEventListener('resize', medir);
    document.documentElement.classList.remove('modo-ambiental');
    limpiar();

    if (mqQuieto.matches) return;          // sin movimiento de ningún tipo

    medir();
    window.addEventListener('resize', medir, { passive: true });
    window.addEventListener('scroll', alScroll, { passive: true });

    if (!mqFino.matches) {                 // táctil: sin imán, solo deriva CSS
      document.documentElement.classList.add('modo-ambiental');
      return;
    }
    document.addEventListener('pointermove', alMover, { passive: true });
    document.addEventListener('pointerleave', alSalir, { passive: true });
  }

  [mqFino, mqQuieto].forEach(function (mq) {
    if (mq.addEventListener) mq.addEventListener('change', configurar);
    else if (mq.addListener) mq.addListener(configurar);   // Safari < 14
  });

  // Se mide tras el trazado: antes, los grupos aún no tienen su caja final.
  configurar();
  setTimeout(medir, 4600);
})();
