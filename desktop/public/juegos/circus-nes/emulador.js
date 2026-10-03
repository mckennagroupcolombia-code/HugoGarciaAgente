/*
 * Circus Charlie (NES) en el navegador — McKenna, 2026-09-21.
 *
 * El juego completo, original: la imagen del cartucho (rom_datos.js, base64) corre en jsnes
 * (externalLib/jsnes.min.js, Apache-2.0), un emulador de NES en JavaScript. Video: cada cuadro
 * de 256×240 se vuelca a un canvas escalado ×2. Audio: las muestras del emulador van a un
 * anillo que lee un ScriptProcessorNode (se desbloquea con el primer toque o tecla). Sin red ni
 * almacenamiento: corre en un iframe con sandbox y CSP connect-src 'none'.
 *
 * Controles: ← → ↑ ↓ · A = Espacio / Z / K · B = X / J · Start = Enter · Select = Shift.
 * En pantalla táctil aparecen botones.
 */
(function () {
	"use strict";

	var lienzo = document.getElementById("lienzo");
	var ctx = lienzo.getContext("2d");
	var aviso = document.getElementById("aviso");
	var imagen = ctx.createImageData(256, 240);
	var buf32 = new Uint32Array(imagen.data.buffer);
	var hayCuadro = false, cuadros = 0;

	// ─── Audio: anillo de muestras alimentado por el emulador ─────────────────
	var AC = window.AudioContext || window.webkitAudioContext;
	var audio = AC ? new AC() : null;
	var TAM = 16384, izqBuf = new Float32Array(TAM), derBuf = new Float32Array(TAM);
	var escr = 0, lect = 0, silencio = false;
	if (audio) {
		var proc = audio.createScriptProcessor(2048, 0, 2);
		proc.onaudioprocess = function (e) {
			var L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
			for (var i = 0; i < L.length; i++) {
				if (lect === escr) { L[i] = R[i] = 0; continue; }   // sin muestras: silencio, no se traba
				L[i] = silencio ? 0 : izqBuf[lect];
				R[i] = silencio ? 0 : derBuf[lect];
				lect = (lect + 1) % TAM;
			}
		};
		proc.connect(audio.destination);
	}
	function desbloquearAudio() {
		if (!audio || audio.state === "running") return;
		try {   // iOS exige reproducir algo dentro del mismo gesto
			var f = audio.createBufferSource();
			f.buffer = audio.createBuffer(1, 1, 22050);
			f.connect(audio.destination);
			f.start(0);
		} catch (e) {}
		if (audio.resume) audio.resume();
	}

	// ─── Emulador ────────────────────────────────────────────────────────────
	var nes = new jsnes.NES({
		sampleRate: audio ? audio.sampleRate : 44100,
		onFrame: function (cuadro) {
			for (var i = 0; i < 256 * 240; i++) buf32[i] = 0xff000000 | cuadro[i];
			hayCuadro = true; cuadros++;
		},
		onAudioSample: function (l, r) {
			var sig = (escr + 1) % TAM;
			if (sig === lect) return;   // anillo lleno (pestaña en segundo plano): se descarta
			izqBuf[escr] = l; derBuf[escr] = r;
			escr = sig;
		}
	});

	var romOk = false;
	try {
		nes.loadROM(atob(window.ROM_CIRCUS));
		romOk = true;
		aviso.textContent = "ENTER / TOCAR START PARA JUGAR";
		setTimeout(function () { aviso.textContent = ""; }, 6000);
	} catch (e) {
		aviso.textContent = "No se pudo cargar el cartucho: " + e.message;
	}

	// ─── Entrada ─────────────────────────────────────────────────────────────
	var C = jsnes.Controller;
	var MAPA = {
		ArrowLeft: C.BUTTON_LEFT, ArrowRight: C.BUTTON_RIGHT, ArrowUp: C.BUTTON_UP, ArrowDown: C.BUTTON_DOWN,
		KeyA: C.BUTTON_LEFT, KeyD: C.BUTTON_RIGHT, KeyW: C.BUTTON_UP, KeyS: C.BUTTON_DOWN,
		Space: C.BUTTON_A, KeyZ: C.BUTTON_A, KeyK: C.BUTTON_A,
		KeyX: C.BUTTON_B, KeyJ: C.BUTTON_B,
		Enter: C.BUTTON_START, NumpadEnter: C.BUTTON_START,
		ShiftLeft: C.BUTTON_SELECT, ShiftRight: C.BUTTON_SELECT, Backspace: C.BUTTON_SELECT
	};
	window.addEventListener("keydown", function (e) {
		if (e.code === "KeyM") { if (!e.repeat) silencio = !silencio; e.preventDefault(); return; }
		var b = MAPA[e.code];
		if (b === undefined) return;
		e.preventDefault();
		desbloquearAudio();
		nes.buttonDown(1, b);
	});
	window.addEventListener("keyup", function (e) {
		var b = MAPA[e.code];
		if (b === undefined) return;
		e.preventDefault();
		nes.buttonUp(1, b);
	});
	window.addEventListener("blur", function () {
		[C.BUTTON_LEFT, C.BUTTON_RIGHT, C.BUTTON_UP, C.BUTTON_DOWN, C.BUTTON_A, C.BUTTON_B, C.BUTTON_START, C.BUTTON_SELECT]
			.forEach(function (b) { nes.buttonUp(1, b); });
	});

	// Táctil: botones en pantalla.
	var tactil = document.getElementById("tactil");
	function boton(id, b) {
		var el = document.getElementById(id);
		var bajar = function (e) { e.preventDefault(); desbloquearAudio(); nes.buttonDown(1, b); el.classList.add("activo"); };
		var subir = function (e) { e.preventDefault(); nes.buttonUp(1, b); el.classList.remove("activo"); };
		el.addEventListener("pointerdown", bajar);
		el.addEventListener("pointerup", subir);
		el.addEventListener("pointercancel", subir);
		el.addEventListener("pointerleave", subir);
	}
	boton("izq", C.BUTTON_LEFT); boton("der", C.BUTTON_RIGHT);
	boton("a", C.BUTTON_A); boton("b", C.BUTTON_B);
	boton("start", C.BUTTON_START); boton("select", C.BUTTON_SELECT);
	window.addEventListener("touchstart", function () { tactil.classList.add("visible"); }, { passive: true });
	if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) tactil.classList.add("visible");
	lienzo.addEventListener("pointerdown", function () { desbloquearAudio(); lienzo.focus(); });
	window.addEventListener("load", function () { lienzo.focus(); });

	// ─── Bucle: 60,1 cuadros por segundo, pase lo que pase con la pantalla ────
	var PASO = 1000 / 60.0988, acumulado = 0, ultimo = performance.now();
	function paso(t) {
		acumulado += Math.min(t - ultimo, 100);   // pestaña dormida: no se intenta recuperar más de 100 ms
		ultimo = t;
		if (romOk) {
			var n = 0;
			while (acumulado >= PASO && n < 3) { nes.frame(); acumulado -= PASO; n++; }
			if (acumulado >= PASO) acumulado = 0;
		}
		if (hayCuadro) { ctx.putImageData(imagen, 0, 0); hayCuadro = false; }
		requestAnimationFrame(paso);
	}
	requestAnimationFrame(paso);

	// Ganchos de depuración para pruebas automáticas.
	window.__nes = {
		ok: function () { return romOk; },
		cuadros: function () { return cuadros; },
		muestrasPendientes: function () { return (escr - lect + TAM) % TAM; },
		pulsar: function (b, ms) { nes.buttonDown(1, b); setTimeout(function () { nes.buttonUp(1, b); }, ms || 120); },
		pixel: function (x, y) { return buf32[y * 256 + x] & 0xffffff; }
	};
})();
