/* Visor con zoom de las fotos de producto (oct-2026).
   Clic / toque en la foto de .prod-gallery → pantalla completa.
   Zoom: pellizco, doble toque, doble clic o rueda; arrastrar para mover.
   Con zoom en 1: deslizar o ‹ › cambia de foto. Esc o ✕ cierra. */
(function () {
  var css = ''
    + '.prod-slide.active img{cursor:zoom-in}'
    + '.pz-hint{position:absolute;right:10px;top:10px;z-index:3;width:34px;height:34px;border-radius:50%;'
    + 'background:rgba(255,255,255,.95);border:1.5px solid var(--green-pale,#cde8ec);display:flex;align-items:center;'
    + 'justify-content:center;font-size:18px;color:var(--green-dark,#143D36);cursor:zoom-in;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.08)}'
    + '.pz{position:fixed;inset:0;z-index:10000;background:#fff;display:none;touch-action:none;overscroll-behavior:contain}'
    + '.pz.open{display:block}'
    + '.pz-img{position:absolute;left:50%;top:50%;max-width:94vw;max-height:88vh;transform-origin:0 0;user-select:none;'
    + '-webkit-user-drag:none;will-change:transform}'
    + '.pz-btn{position:absolute;z-index:2;width:44px;height:44px;border-radius:50%;border:1.5px solid #cde8ec;background:rgba(255,255,255,.95);'
    + 'font-size:26px;line-height:1;color:#143D36;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;'
    + 'box-shadow:0 2px 8px rgba(0,0,0,.12)}'
    + '.pz-close{top:12px;right:12px;font-size:22px}'
    + '.pz-prev{left:12px;top:calc(50% - 22px)}.pz-next{right:12px;top:calc(50% - 22px)}'
    + '.pz-count{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);font-size:13px;color:#4a6b70;'
    + 'background:rgba(255,255,255,.9);padding:4px 10px;border-radius:12px}'
    + 'body.pz-lock{overflow:hidden}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var box, img, btnPrev, btnNext, count;
  var urls = [], idx = 0;
  var scale = 1, tx = 0, ty = 0, baseW = 0, baseH = 0;
  var MAX = 5;

  function build() {
    box = document.createElement('div');
    box.className = 'pz';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Foto ampliada');
    box.innerHTML = '<img class="pz-img" alt="">'
      + '<button type="button" class="pz-btn pz-close" aria-label="Cerrar">&#10005;</button>'
      + '<button type="button" class="pz-btn pz-prev" aria-label="Anterior">&#8249;</button>'
      + '<button type="button" class="pz-btn pz-next" aria-label="Siguiente">&#8250;</button>'
      + '<div class="pz-count"></div>';
    document.body.appendChild(box);
    img = box.querySelector('.pz-img');
    btnPrev = box.querySelector('.pz-prev');
    btnNext = box.querySelector('.pz-next');
    count = box.querySelector('.pz-count');
    box.querySelector('.pz-close').addEventListener('click', close);
    btnPrev.addEventListener('click', function () { go(-1); });
    btnNext.addEventListener('click', function () { go(1); });
    img.addEventListener('load', fit);
    bindGestures();
  }

  function apply() {
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }

  // Coloca la foto centrada a escala 1 (tx/ty = esquina superior izquierda).
  function fit() {
    img.style.transform = 'none';
    img.style.left = '0'; img.style.top = '0';
    var r = img.getBoundingClientRect();
    baseW = r.width; baseH = r.height;
    scale = 1;
    tx = (window.innerWidth - baseW) / 2;
    ty = (window.innerHeight - baseH) / 2;
    apply();
  }

  // No deja que la foto se salga del todo de la pantalla.
  function clamp() {
    var w = baseW * scale, h = baseH * scale, W = window.innerWidth, H = window.innerHeight;
    tx = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, tx));
    ty = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, ty));
  }

  function zoomAt(newScale, cx, cy) {
    newScale = Math.max(1, Math.min(MAX, newScale));
    tx = cx - (cx - tx) * newScale / scale;
    ty = cy - (cy - ty) * newScale / scale;
    scale = newScale;
    clamp();
    apply();
  }

  function show(i) {
    idx = (i + urls.length) % urls.length;
    img.src = urls[idx];
    if (img.complete) fit();
    var multi = urls.length > 1;
    btnPrev.style.display = btnNext.style.display = count.style.display = multi ? '' : 'none';
    count.textContent = (idx + 1) + ' / ' + urls.length;
  }

  function go(d) { if (urls.length > 1) show(idx + d); }

  function open(list, i) {
    if (!box) build();
    urls = list; box.classList.add('open');
    document.body.classList.add('pz-lock');
    show(i);
  }

  function close() {
    box.classList.remove('open');
    document.body.classList.remove('pz-lock');
  }

  function bindGestures() {
    var pts = {}, startDist = 0, startScale = 1, mid = null;
    var dragFrom = null, swipeX = null, moved = false, lastTap = 0;

    box.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    }, { passive: false });

    box.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.pz-btn')) return;
      box.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      moved = false;
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        startDist = Math.hypot(a.x - b.x, a.y - b.y);
        startScale = scale;
        dragFrom = null; swipeX = null;
      } else if (ids.length === 1) {
        dragFrom = { x: e.clientX - tx, y: e.clientY - ty };
        swipeX = e.clientX;
      }
    });

    box.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (ids.length === 2 && startDist) {
        var a = pts[ids[0]], b = pts[ids[1]];
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        zoomAt(startScale * Math.hypot(a.x - b.x, a.y - b.y) / startDist, mid.x, mid.y);
        moved = true;
      } else if (ids.length === 1 && dragFrom) {
        if (Math.abs(e.clientX - swipeX) > 6) moved = true;
        if (scale > 1) {
          tx = e.clientX - dragFrom.x; ty = e.clientY - dragFrom.y;
          clamp(); apply();
        }
      }
    });

    function up(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      var left = Object.keys(pts).length;
      if (left === 1) {
        // Termina el pellizco: sigue arrastrando con el dedo que queda.
        var p = pts[Object.keys(pts)[0]];
        dragFrom = { x: p.x - tx, y: p.y - ty }; swipeX = null; startDist = 0;
        return;
      }
      if (left) return;
      if (scale === 1 && swipeX !== null && Math.abs(e.clientX - swipeX) > 50) {
        go(e.clientX < swipeX ? 1 : -1);
      } else if (!moved) {
        var now = Date.now();
        if (now - lastTap < 300) {
          zoomAt(scale > 1 ? 1 : 2.5, e.clientX, e.clientY);
          lastTap = 0;
        } else {
          lastTap = now;
          // Toque en el fondo blanco (fuera de la foto) con zoom 1 → cerrar.
          var t = e.target;
          setTimeout(function () {
            if (lastTap === now && scale === 1 && t === box) close();
          }, 300);
        }
      }
      dragFrom = null; swipeX = null; startDist = 0;
    }
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);

    document.addEventListener('keydown', function (e) {
      if (!box.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });
    window.addEventListener('resize', function () { if (box.classList.contains('open')) fit(); });
  }

  function galleryUrls(g) {
    return Array.prototype.map.call(g.querySelectorAll('.prod-slide img'), function (im) {
      return im.currentSrc || im.src;
    });
  }

  function openFrom(g) {
    var slides = g.querySelectorAll('.prod-slide'), cur = 0;
    slides.forEach(function (s, i) { if (s.classList.contains('active')) cur = i; });
    var list = galleryUrls(g);
    if (list.length) open(list, cur);
  }

  // Lupa en cada galería (también las que se rearman con setProdGallery).
  function addHints() {
    document.querySelectorAll('.prod-gallery-stage').forEach(function (s) {
      if (s.querySelector('.pz-hint')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pz-hint'; b.setAttribute('aria-label', 'Ampliar foto');
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">'
        + '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/></svg>';
      s.appendChild(b);
    });
  }
  addHints();
  var mo = new MutationObserver(addHints);
  document.querySelectorAll('.prod-gallery').forEach(function (g) { mo.observe(g, { childList: true }); });

  document.addEventListener('click', function (e) {
    var hit = e.target.closest('.prod-slide.active img, .pz-hint');
    if (!hit) return;
    var g = hit.closest('.prod-gallery');
    if (g) { e.preventDefault(); openFrom(g); }
  });
})();
