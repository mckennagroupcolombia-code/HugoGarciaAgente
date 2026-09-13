/* Eventos de uso del contenido (recetas, guias vivas, "Aprende a usarlo").
   Fire-and-forget con sendBeacon a /api/eventos-contenido; nunca bloquea la
   pagina ni rompe nada si el servidor no responde. Sesion = id aleatorio en
   sessionStorage (muere al cerrar la pestana; no identifica a nadie).
   Lista de eventos valida: app/services/metricas_contenido.py. ASCII puro. */
(function () {
  'use strict';
  var sid = '';
  try {
    sid = sessionStorage.getItem('mck_sid') || '';
    if (!sid) {
      sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      sessionStorage.setItem('mck_sid', sid);
    }
  } catch (e) { sid = ''; }
  var enviados = {};
  function enviar(evento, slug, detalle, unaVez) {
    var clave = evento + '|' + (slug || '') + '|' + (detalle == null ? '' : detalle);
    if (unaVez && enviados[clave]) return;
    enviados[clave] = true;
    var body = JSON.stringify({ evento: evento, slug: slug || '', detalle: detalle == null ? '' : String(detalle), sesion: sid });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/eventos-contenido', new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (e) {}
    try {
      fetch('/api/eventos-contenido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, credentials: 'same-origin' }).catch(function () {});
    } catch (e) {}
  }
  window.mckEvento = enviar;

  /* Ficha de producto: clics en "Aprende a usarlo" */
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('.pa-card') : null;
    if (!a) return;
    var grid = a.closest('.pa-grid');
    var slug = (grid && grid.getAttribute('data-producto-slug')) || location.pathname.split('/').pop() || '';
    enviar('producto_aprende', slug, a.getAttribute('href') || '', false);
  });
})();
