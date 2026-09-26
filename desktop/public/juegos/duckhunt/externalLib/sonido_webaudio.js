/*
 * Reemplazo de SoundManager2 (2013) con Web Audio — McKenna, 2026-09-21.
 *
 * Por qué: en el celular SoundManager2 usa UN solo <audio> para todo y el juego intenta
 * sonar antes del primer toque, así que no suena nada. Web Audio se desbloquea con el
 * primer toque y deja sonar varios sonidos a la vez (disparo + aleteo + perro).
 *
 * Expone solo lo que usa el juego (src/SoundManager.js y llamadas sueltas):
 *   setup({onready}), createSound({id, url, volume}), play(id, {onfinish}), stop(id),
 *   mute(), unmute(). Los MP3 vienen incrustados en statics/sounds/sonidos_datos.js
 *   (window.DH_SONIDOS), porque la CSP del juego no deja hacer peticiones de red.
 */
(function () {
	var Ctx = window.AudioContext || window.webkitAudioContext;
	var ctx = Ctx ? new Ctx() : null;
	var maestro = null;
	if (ctx) {
		maestro = ctx.createGain();
		maestro.connect(ctx.destination);
	}

	var buffers = {};   // archivo.mp3 -> AudioBuffer
	var sonidos = {};   // id -> {archivo, volumen, fuente, alTerminar}

	function base64ABuffer(b64) {
		var bin = atob(b64), n = bin.length, u8 = new Uint8Array(n);
		for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
		return u8.buffer;
	}

	function decodificar(archivo) {
		if (!ctx || buffers[archivo] || !window.DH_SONIDOS || !window.DH_SONIDOS[archivo]) return;
		buffers[archivo] = "cargando";
		var datos = base64ABuffer(window.DH_SONIDOS[archivo]);
		var ok = function (b) { buffers[archivo] = b; };
		var mal = function () { delete buffers[archivo]; };
		var p = ctx.decodeAudioData(datos, ok, mal);
		if (p && p.catch) p.catch(mal);
	}

	// Primer toque/clic dentro del juego: desbloquea el audio (iOS exige además sonar algo
	// dentro del mismo gesto, por eso el búfer vacío).
	function desbloquear() {
		if (!ctx || ctx.state === "running") return;
		try {
			var vacio = ctx.createBuffer(1, 1, 22050), f = ctx.createBufferSource();
			f.buffer = vacio;
			f.connect(maestro);
			f.start(0);
		} catch (e) {}
		if (ctx.resume) ctx.resume();
	}
	["touchstart", "touchend", "pointerdown", "mousedown", "keydown"].forEach(function (t) {
		window.addEventListener(t, desbloquear, true);
	});

	function detener(s) {
		if (!s || !s.fuente) return;
		var f = s.fuente;
		s.fuente = null;
		f.onended = null;           // detener a mano no es "terminar" (igual que SoundManager2)
		try { f.stop(0); } catch (e) {}
	}

	window.soundManager = {
		initialized: false,
		defaultOptions: {},

		setup: function (opciones) {
			var listo = opciones && opciones.onready;
			// Asíncrono: src/SoundManager.js define createSoundHelper DESPUÉS de llamar setup().
			if (listo) setTimeout(listo, 0);
		},

		createSound: function (op) {
			var archivo = String(op.url || "").split("/").pop();
			sonidos[op.id] = {
				archivo: archivo,
				volumen: (op.volume != null ? op.volume : 50) / 100,
				fuente: null,
				alTerminar: null
			};
			decodificar(archivo);
			return sonidos[op.id];
		},

		play: function (id, op) {
			var s = sonidos[id];
			if (!s || !ctx) return;
			var b = buffers[s.archivo];
			// Antes del primer toque no hay audio: se omite (no se acumula para después).
			if (!b || b === "cargando" || ctx.state !== "running") return;
			detener(s);             // mismo id = reinicia (el juego usa shot1/2/3 para solapar)
			var f = ctx.createBufferSource(), g = ctx.createGain();
			g.gain.value = s.volumen;
			f.buffer = b;
			f.connect(g);
			g.connect(maestro);
			s.alTerminar = op && op.onfinish;
			f.onended = function () {
				if (s.fuente !== f) return;
				s.fuente = null;
				if (typeof s.alTerminar === "function") s.alTerminar.call(s);
			};
			s.fuente = f;
			f.start(0);
		},

		stop: function (id) { detener(sonidos[id]); },
		mute: function () { if (maestro) maestro.gain.value = 0; },
		unmute: function () { if (maestro) maestro.gain.value = 1; }
	};
})();
