/* Zoom de las fotos de producto (oct-2026).
   Lupa interactiva sobre la foto (ver abajo) y, con clic / toque, ventana
   emergente centrada sobre la página oscurecida.
   Zoom: pellizco, doble toque, doble clic o rueda; arrastrar para mover.
   Con zoom en 1: deslizar o ‹ › cambia de foto. Esc o ✕ cierra. */
(function () {
  var css = ''
    + '.prod-slide.active img{cursor:zoom-in}'
    + '.pz-hint{position:absolute;right:10px;top:10px;z-index:3;width:34px;height:34px;border-radius:50%;'
    + 'background:rgba(255,255,255,.95);border:1.5px solid var(--green-pale,#cde8ec);display:flex;align-items:center;'
    + 'justify-content:center;font-size:18px;color:var(--green-dark,#143D36);cursor:zoom-in;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.08)}'
    + '.pz{position:fixed;inset:0;z-index:10000;background:rgba(10,30,28,.55);display:none;align-items:center;'
    + 'justify-content:center;padding:16px;overscroll-behavior:contain;opacity:0;transition:opacity .2s}'
    + '.pz.open{display:flex}.pz.show{opacity:1}'
    + '.pz-card{position:relative;width:min(760px,100%);height:min(620px,78vh);background:#fff;border-radius:14px;'
    + 'overflow:hidden;touch-action:none;box-shadow:0 24px 60px rgba(0,0,0,.35);transform:scale(.92);transition:transform .2s}'
    + '.pz.show .pz-card{transform:scale(1)}'
    + '.pz-img{position:absolute;left:0;top:0;max-width:calc(100% - 32px);max-height:calc(100% - 32px);transform-origin:0 0;'
    + 'user-select:none;-webkit-user-drag:none;will-change:transform;cursor:grab}'
    + '.pz-tip{position:absolute;top:16px;left:16px;font-size:12px;color:#4a6b70;background:rgba(255,255,255,.9);'
    + 'padding:4px 10px;border-radius:12px;pointer-events:none;transition:opacity .2s}'
    + '.pz-btn{position:absolute;z-index:2;width:44px;height:44px;border-radius:50%;border:1.5px solid #cde8ec;background:rgba(255,255,255,.95);'
    + 'font-size:26px;line-height:1;color:#143D36;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;'
    + 'box-shadow:0 2px 8px rgba(0,0,0,.12)}'
    + '.pz-close{top:10px;right:10px;font-size:20px;width:38px;height:38px}'
    + '.pz-prev{left:12px;top:calc(50% - 22px)}.pz-next{right:12px;top:calc(50% - 22px)}'
    + '.pz-count{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);font-size:13px;color:#4a6b70;'
    + 'background:rgba(255,255,255,.9);padding:4px 10px;border-radius:12px}'
    + 'body.pz-lock{overflow:hidden}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var box, card, tip, img, btnPrev, btnNext, count;
  var urls = [], idx = 0;
  var scale = 1, tx = 0, ty = 0, baseW = 0, baseH = 0;
  var MAX = 5;

  function build() {
    box = document.createElement('div');
    box.className = 'pz';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Foto ampliada');
    box.innerHTML = '<div class="pz-card"><img class="pz-img" alt="">'
      + '<div class="pz-tip">Rueda, pellizco o doble clic para acercar</div>'
      + '<button type="button" class="pz-btn pz-close" aria-label="Cerrar">&#10005;</button>'
      + '<button type="button" class="pz-btn pz-prev" aria-label="Anterior">&#8249;</button>'
      + '<button type="button" class="pz-btn pz-next" aria-label="Siguiente">&#8250;</button>'
      + '<div class="pz-count"></div></div>';
    document.body.appendChild(box);
    card = box.querySelector('.pz-card');
    img = box.querySelector('.pz-img');
    tip = box.querySelector('.pz-tip');
    if (!window.matchMedia('(pointer:fine)').matches) tip.textContent = 'Pellizca o toca dos veces para acercar';
    // Clic en el fondo oscuro (fuera de la ventana) → cerrar.
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
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
    scale = 1; tip.style.opacity = '';
    tx = (card.clientWidth - baseW) / 2;
    ty = (card.clientHeight - baseH) / 2;
    apply();
  }

  // No deja que la foto se salga del todo de la pantalla.
  function clamp() {
    var w = baseW * scale, h = baseH * scale, W = card.clientWidth, H = card.clientHeight;
    tx = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, tx));
    ty = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, ty));
  }

  function zoomAt(newScale, cx, cy) {
    newScale = Math.max(1, Math.min(MAX, newScale));
    var cr = card.getBoundingClientRect();   // cx, cy llegan en coordenadas de pantalla
    cx -= cr.left; cy -= cr.top;
    tx = cx - (cx - tx) * newScale / scale;
    ty = cy - (cy - ty) * newScale / scale;
    scale = newScale;
    clamp();
    apply();
    tip.style.opacity = scale > 1 ? '0' : '';
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
    requestAnimationFrame(function () { box.classList.add('show'); });
    document.body.classList.add('pz-lock');
    show(i);
  }

  function close() {
    box.classList.remove('open', 'show');
    document.body.classList.remove('pz-lock');
  }

  function bindGestures() {
    var pts = {}, startDist = 0, startScale = 1, mid = null;
    var dragFrom = null, swipeX = null, moved = false, lastTap = 0;

    card.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    }, { passive: false });

    card.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.pz-btn')) return;
      card.setPointerCapture(e.pointerId);
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

    card.addEventListener('pointermove', function (e) {
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
        }
      }
      dragFrom = null; swipeX = null; startDist = 0;
    }
    card.addEventListener('pointerup', up);
    card.addEventListener('pointercancel', up);

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

  /* ── Lupa interactiva sobre la foto ──
     Computador: al pasar el ratón aparece una lupa redonda que sigue al cursor;
     la rueda cambia el aumento (1.5× a 6×). Celular: mantener el dedo sobre la
     foto saca la lupa encima del dedo y se arrastra; al soltar desaparece. */
  var lensCss = ''
    + '.pz-lens{position:fixed;z-index:9999;width:190px;height:190px;border-radius:50%;pointer-events:none;'
    + 'border:3px solid #fff;box-shadow:0 0 0 2px var(--green,#2a8a80),0 10px 30px rgba(0,0,0,.25);'
    + 'background:#fff no-repeat;opacity:0;transform:scale(.6);transition:opacity .15s,transform .15s}'
    + '.pz-lens.on{opacity:1;transform:scale(1)}'
    + '.pz-lens-z{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);font:600 11px/1 system-ui,sans-serif;'
    + 'color:#fff;background:rgba(20,61,54,.75);padding:3px 7px;border-radius:9px}'
    + '@media (pointer:fine){.prod-slide.active img{cursor:crosshair}}'
    + '.prod-slide img{-webkit-touch-callout:none;-webkit-user-select:none}';
  st.textContent += lensCss;

  var lens = document.createElement('div');
  lens.className = 'pz-lens';
  lens.innerHTML = '<span class="pz-lens-z"></span>';
  document.body.appendChild(lens);
  var lensZ = lens.querySelector('.pz-lens-z');
  var Z = 2.5, lensImg = null, lastPt = null, R = 95;

  // (x, y) = punto de la foto que se aumenta; (lx, ly) = dónde se dibuja la lupa.
  function lensAt(im, x, y, lx, ly) {
    var r = im.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) { lensOff(); return; }
    if (lensImg !== im) {
      lensImg = im;
      lens.style.backgroundImage = 'url("' + (im.currentSrc || im.src).replace(/"/g, '\\"') + '")';
    }
    lastPt = { x: x, y: y, lx: lx, ly: ly };
    lens.style.backgroundSize = (r.width * Z) + 'px ' + (r.height * Z) + 'px';
    lens.style.backgroundPosition = (R - (x - r.left) * Z) + 'px ' + (R - (y - r.top) * Z) + 'px';
    lens.style.left = (lx - R) + 'px';
    lens.style.top = (ly - R) + 'px';
    lensZ.textContent = Z.toFixed(1).replace('.0', '') + '×';
    lens.classList.add('on');
  }
  function lensOff() { lens.classList.remove('on'); lensImg = null; lastPt = null; }

  function slideImg(t) { return t && t.closest ? t.closest('.prod-slide.active img') : null; }

  if (window.matchMedia('(pointer:fine)').matches) {
    document.addEventListener('mousemove', function (e) {
      var im = slideImg(e.target);
      if (im && !(box && box.classList.contains('open'))) lensAt(im, e.clientX, e.clientY, e.clientX, e.clientY);
      else if (lensImg) lensOff();
    });
    document.addEventListener('wheel', function (e) {
      if (!lensImg || !slideImg(e.target)) return;
      e.preventDefault();
      Z = Math.max(1.5, Math.min(6, Z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      var p = lastPt, im = lensImg;
      lensImg = null; lensAt(im, p.x, p.y, p.lx, p.ly);
    }, { passive: false });
    window.addEventListener('scroll', lensOff, { passive: true });
  }

  // Táctil: mantener presionado 250 ms → lupa 110 px encima del dedo.
  var holdT = null, holding = false, start = null, swallowClick = false;
  document.addEventListener('touchstart', function (e) {
    var im = slideImg(e.target);
    if (!im || e.touches.length !== 1) return;
    var t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    holdT = setTimeout(function () {
      holding = true;
      if (navigator.vibrate) navigator.vibrate(10);
      lensAt(im, start.x, start.y, start.x, start.y - 110);
    }, 250);
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    if (holding) {
      e.preventDefault();
      var im = slideImg(document.elementFromPoint(t.clientX, t.clientY)) || lensImg;
      if (im) { lensImg = im; lensAt(im, t.clientX, t.clientY, t.clientX, t.clientY - 110); }
      return;
    }
    if (holdT && start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) {
      clearTimeout(holdT); holdT = null;   // era un desplazamiento normal de la página
    }
  }, { passive: false });
  function touchEnd() {
    clearTimeout(holdT); holdT = null;
    if (holding) { holding = false; swallowClick = true; lensOff(); setTimeout(function () { swallowClick = false; }, 400); }
  }
  document.addEventListener('touchend', touchEnd);
  document.addEventListener('touchcancel', touchEnd);
  document.addEventListener('contextmenu', function (e) { if (holding || slideImg(e.target)) e.preventDefault(); });

  document.addEventListener('click', function (e) {
    if (swallowClick) { e.preventDefault(); return; }
    lensOff();
    var hit = e.target.closest('.prod-slide.active img, .pz-hint');
    if (!hit) return;
    var g = hit.closest('.prod-gallery');
    if (g) { e.preventDefault(); openFrom(g); }
  });
})();
