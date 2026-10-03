/*
 * Disparo con el dedo — McKenna, 2026-09-21.
 *
 * cake.js decide qué hay bajo la mira UNA vez por cuadro (Canvas#onFrame → handlePick),
 * con la última posición que le dejó un `mousemove`. Con mouse eso siempre está al día; con
 * el dedo no hay cursor: el toque llega como mousemove + mousedown + mouseup + click en un
 * mismo instante, sin un cuadro de por medio, y el clic se evalúa contra la posición
 * ANTERIOR (el disparo "no llega a donde es").
 *
 * Aquí se toma el toque, se cancelan los eventos de mouse que el navegador emularía, se
 * mueve la mira al punto exacto, se recalcula el objetivo en ese momento y recién entonces
 * se dispara. El mouse de escritorio no pasa por aquí.
 */
(function () {
	function evento(tipo, el, t) {
		el.dispatchEvent(new MouseEvent(tipo, {
			bubbles: true,
			cancelable: true,
			view: window,
			button: 0,
			clientX: t.clientX,
			clientY: t.clientY,
			screenX: t.screenX,
			screenY: t.screenY
		}));
	}

	function recalcularObjetivo() {
		var c = window.DH && window.DH.gameCanvas;
		if (!c || !c.handlePick || !c.catchMouse) return;
		c.target = null;
		c.handlePick(c.getContext());
		c.previousTarget = c.target;   // el próximo cuadro no repite mouseover/mouseout
	}

	document.addEventListener("touchstart", function (e) {
		if (e.touches.length !== 1) return;
		var t = e.changedTouches[0];
		var el = document.elementFromPoint(t.clientX, t.clientY);
		if (!el) return;
		e.preventDefault();            // sin mouse emulado ni doble disparo
		evento("mousemove", el, t);
		recalcularObjetivo();
		evento("mouseover", el, t);
		evento("mousedown", el, t);
		evento("mouseup", el, t);
		evento("click", el, t);
	}, { passive: false, capture: true });
})();
