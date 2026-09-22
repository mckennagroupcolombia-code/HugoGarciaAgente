/*
 * Circus Charlie — etapa 1 (Charlie sobre el león, aros de fuego y jarrones).
 *
 * Port a canvas del remake en C++/WinAPI de HyunjungLee-dev (github.com/HyunjungLee-dev/Circus-Charlie,
 * 2020), hecho para el panel McKenna el 2026-09-21. Se conservan los sprites, la disposición
 * (512×448, medidores cada 550 px, jarrones, aros en pares con premio al 30 %), los puntajes
 * (aro 100 · jarrón 200 · premio 1000 · doble +100) y el ciclo título → STAGE-01 → juego → podio.
 * Lo que el original ataba al reloj de la CPU (0,5 px por vuelta del bucle) aquí va en px/s.
 * Sin red, sin almacenamiento, sin dependencias: corre en un iframe con sandbox.
 */
(function () {
	"use strict";

	var W = 512, H = 448;
	var SUELO_Y = 345;              // y del jugador en el piso
	var DIST = 550;                 // separación entre medidores (y entre jarrones)
	var VEL_SCROLL = 200;           // px/s al correr (a 150 el jarrón exigía ±0,09 s de precisión)
	var VEL_ARO = 110;              // px/s propios de los aros hacia la izquierda
	var VEL_CAMINAR = 100;          // px/s en la recta final (el mundo ya no se desplaza)
	var DUR_SALTO = 1.0;            // s (seno de 0 a π, altura 110)
	var ALTO_SALTO = 110;
	var BONUS_INICIAL = 5000;

	var lienzo = document.getElementById("lienzo");
	var ctx = lienzo.getContext("2d");
	ctx.imageSmoothingEnabled = false;

	// ─── Imágenes ───────────────────────────────────────────────────────────
	var NOMBRES = ["back", "back_deco", "back_normal", "back_normal2", "cash", "die", "end",
		"enemy_b", "enemy_1b", "enemy_f", "enemy_1f", "front", "front2", "icon", "miter",
		"player0", "player1", "player2", "star", "star1", "star2", "title", "win0", "win1"];
	var IMG = {};
	var porCargar = NOMBRES.length;
	NOMBRES.forEach(function (n) {
		var im = new Image();
		im.onload = im.onerror = function () { porCargar--; };
		im.src = "res/" + n + ".png";
		IMG[n] = im;
	});

	function dib(n, x, y, sx, sy) {
		var im = IMG[n];
		if (!im || !im.width) return;
		ctx.drawImage(im, Math.round(x), Math.round(y), im.width * (sx || 1), im.height * (sy || sx || 1));
	}

	function texto(s, x, y, color) {
		ctx.font = "bold 15px 'Courier New', monospace";
		ctx.textBaseline = "top";
		ctx.fillStyle = color || "#fff";
		ctx.fillText(s, x, y);
	}
	function pad(n, w) { var s = String(Math.max(0, n | 0)); while (s.length < w) s = "0" + s; return s; }

	// ─── Sonido (sintetizado, sin archivos) ──────────────────────────────────
	var AC = window.AudioContext || window.webkitAudioContext;
	var audio = AC ? new AC() : null;
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
	// Música: suena durante la partida, se calla al caer, al ganar y al volver al título. M la silencia.
	var silencio = false;
	function musicaSegunEstado() {
		if (!window.MusicaCirco) return;
		if (estado === "juego") window.MusicaCirco.iniciar(audio);
		else window.MusicaCirco.parar();
	}
	function tono(f0, f1, dur, tipo, vol) {
		if (!audio || audio.state !== "running" || silencio) return;
		var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
		o.type = tipo || "square";
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(f1, t + dur);
		g.gain.setValueAtTime(vol || 0.08, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + dur);
		o.connect(g); g.connect(audio.destination);
		o.start(t); o.stop(t + dur);
	}
	var son = {
		salto: function () { tono(300, 700, 0.18); },
		punto: function () { tono(900, 1400, 0.1, "square", 0.06); },
		premio: function () { tono(600, 1800, 0.35, "triangle", 0.1); },
		muerte: function () { tono(400, 60, 0.7, "sawtooth", 0.12); },
		podio: function () { tono(500, 1000, 0.5, "triangle", 0.1); }
	};

	// ─── Entrada ─────────────────────────────────────────────────────────────
	var tecla = { izq: false, der: false, salto: false, enter: false };
	// Un toque o una tecla muy breve (menos de un cuadro) no debe perderse: los "pulsos" se
	// consumen en la actualización, no dependen de que la tecla siga abajo.
	var pulso = { salto: false, enter: false };
	var MAPA = {
		ArrowLeft: "izq", KeyA: "izq", ArrowRight: "der", KeyD: "der",
		Space: "salto", ArrowUp: "salto", KeyW: "salto", Enter: "enter", NumpadEnter: "enter", KeyM: "mute", KeyN: "siguiente"
	};
	window.addEventListener("keydown", function (e) {
		var k = MAPA[e.code];
		if (!k) return;
		e.preventDefault();
		desbloquearAudio();
		if (k === "mute") {
			if (!e.repeat) { silencio = !silencio; window.MusicaCirco && window.MusicaCirco.silenciar(silencio); }
			return;
		}
		if (k === "siguiente") {   // N: pasa a la siguiente canción de la lista
			if (!e.repeat && window.MusicaCirco) window.MusicaCirco.saltar();
			return;
		}
		if (!e.repeat && (k === "salto" || k === "enter")) pulso[k] = true;
		tecla[k] = true;
	});
	window.addEventListener("keyup", function (e) {
		var k = MAPA[e.code];
		if (k) { e.preventDefault(); tecla[k] = false; }
	});
	window.addEventListener("blur", function () { tecla.izq = tecla.der = tecla.salto = tecla.enter = false; });

	// Táctil: botones en pantalla; un toque en el lienzo hace de Enter en el título.
	var tactil = document.getElementById("tactil");
	function boton(id, k) {
		var b = document.getElementById(id);
		var bajar = function (e) { e.preventDefault(); desbloquearAudio(); tecla[k] = true; if (k === "salto") pulso.salto = true; b.classList.add("activo"); };
		var subir = function (e) { e.preventDefault(); tecla[k] = false; b.classList.remove("activo"); };
		b.addEventListener("pointerdown", bajar);
		b.addEventListener("pointerup", subir);
		b.addEventListener("pointercancel", subir);
		b.addEventListener("pointerleave", subir);
	}
	boton("izq", "izq"); boton("der", "der"); boton("salto", "salto");
	window.addEventListener("touchstart", function () { tactil.classList.add("visible"); }, { passive: true });
	if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) tactil.classList.add("visible");
	lienzo.addEventListener("pointerdown", function () {
		desbloquearAudio();
		lienzo.focus();
		if (estado === "titulo") pulso.enter = true;
	});
	window.addEventListener("load", function () { lienzo.focus(); });

	// ─── Estado del juego ────────────────────────────────────────────────────
	var estado = "titulo";        // titulo · arrancando · stage · juego · muerto · gameover · fin
	var reloj = 0;                // segundos en el estado actual
	var stat = { score: 0, hi: 20000, bonus: BONUS_INICIAL, stage: 1 };
	var vidas = 3;
	var bonusReloj = 0, parpadeo1P = 0;

	var cam = 0;                  // desplazamiento del mundo (x mundo = x pantalla + cam)
	var rectaFinal = false;       // pasado el último medidor: el mundo se detiene y Charlie camina
	var jugador, aros, jarrones, medidores, podio, ultimoMedidor;
	var estrellas = [];
	var animReloj = 0, cuadroAnim = 0, publicoAnim = 0, publicoReloj = 0;

	function nuevoJugador() {
		return {
			x: 100, y: SUELO_Y, sprite: "player0", saltando: false, tSalto: 0,
			dir: 0, corriendo: false, motion: 0,
			pasoAro: false, pasoJarron: false, pasoPremio: false
		};
	}

	function nuevaPartida() {
		stat.score = 0; stat.bonus = BONUS_INICIAL; stat.stage = 1;
		vidas = 3;
		cam = 0; rectaFinal = false; ultimoMedidor = 0;
		jugador = nuevoJugador();
		aros = []; aroReloj = 0;
		medidores = [];
		for (var i = 0; i <= 10; i++) medidores.push({ x: 20 + DIST * i, etiqueta: i === 10 ? "00" : String(100 - 10 * i) });
		podio = { x: 20 + DIST * 10, y: 360, w: 76, h: 49 };
		jarrones = [];
		for (var j = 0; j < 10; j++) jarrones.push({ x: DIST * 1.95 + DIST * j, y: 360 });
	}

	// Título: estrellas que cambian de color alrededor del logo (misma disposición del original).
	(function () {
		var sx = W * 0.22, sy = H * 0.18, c = 0;
		for (var i = 1; i <= 16; i++) estrellas.push({ x: sx + i * 14 * 1.2, y: sy, c: c++ % 3 });
		for (i = 1; i <= 16; i++) estrellas.push({ x: sx + i * 14 * 1.2, y: sy + 101 * 1.25, c: c++ % 3 });
		for (i = 0; i < 6; i++) estrellas.push({ x: W * 0.21, y: sy + (i + 1) * 13 * 1.45, c: c++ % 3 });
		for (i = 0; i < 6; i++) estrellas.push({ x: W * 0.29 + 249, y: sy + (i + 1) * 13 * 1.45, c: c++ % 3 });
	})();
	var ESTRELLA = ["star", "star2", "star1"];

	function cambiar(nuevo) { estado = nuevo; reloj = 0; pulso.salto = pulso.enter = false; musicaSegunEstado(); }

	// ─── Aros ────────────────────────────────────────────────────────────────
	var aroReloj = 0;
	function generarAros(dt) {
		aroReloj += dt;
		if (aroReloj < 2 || aros.length >= 2) return;
		aroReloj = 0;
		// Un aro = mitad trasera (se dibuja detrás de Charlie) + mitad delantera (delante).
		aros.push({ x: W + cam, y: 180, premio: Math.random() > 0.7 ? "tiene" : "no", cuenta: false });
	}
	function altoAro(a) { return a.premio === "no" ? 1.3 : 1.1; }
	function rectAro(a) {   // caja de choque = parte baja del aro (hay que saltarla)
		return { x: a.x - cam + 15, y: a.premio === "no" ? 180 * 1.85 : 180 * 1.7, w: 11, h: 132 * 0.15 };
	}
	function rectJarron(j) { return { x: j.x - cam + 6, y: 350, w: 38, h: 50 }; }   // un poco más angosto que el dibujo
	function rectJugador() { return { x: jugador.x + 20, y: jugador.y, w: 26, h: 58 }; }
	function rectPodio() { return { x: podio.x - cam, y: podio.y, w: podio.w, h: podio.h }; }
	function choca(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

	// ─── Actualización ───────────────────────────────────────────────────────
	function actualizarJuego(dt) {
		bonusReloj += dt;
		if (bonusReloj > 0.3) { bonusReloj -= 0.3; stat.bonus = Math.max(0, stat.bonus - 10); }
		parpadeo1P = (parpadeo1P + dt) % 0.6;
		animReloj += dt;
		if (animReloj > 0.08) { animReloj = 0; cuadroAnim ^= 1; }

		var p = jugador;
		var dirAhora = tecla.der ? 1 : tecla.izq ? -1 : 0;

		// Arranque del salto: la dirección que se lleva se conserva durante todo el salto.
		if ((tecla.salto || pulso.salto) && !p.saltando) {
			pulso.salto = false;
			p.saltando = true; p.tSalto = 0; p.dir = dirAhora;
			p.pasoAro = p.pasoJarron = p.pasoPremio = false;
			son.salto();
		}
		var dir = p.saltando ? p.dir : dirAhora;

		if (!rectaFinal) {
			if (dir === -1 && cam <= 0) dir = 0;                       // no se retrocede antes del inicio
			cam += dir * VEL_SCROLL * dt;
			if (cam < 0) cam = 0;
			if (podio.x - cam <= 430) { rectaFinal = true; cam = podio.x - 430; }
		} else {
			var v = p.saltando ? VEL_CAMINAR + 20 : VEL_CAMINAR;
			p.x += dir * v * dt;
			if (p.x < 0) p.x = 0;
			if (p.x > W - 66) p.x = W - 66;
		}
		p.corriendo = dir !== 0;

		if (p.saltando) {
			p.tSalto += dt;
			p.y = SUELO_Y - Math.sin(Math.min(p.tSalto, DUR_SALTO) * Math.PI) * ALTO_SALTO;
			// Pasar por encima: el objeto queda bajo Charlie en algún instante del salto.
			var px = p.x;
			jarrones.forEach(function (j) { var sx = j.x - cam; if (px > sx && px < sx + 50) p.pasoJarron = true; });
			aros.forEach(function (a) {
				var sx = a.x - cam;
				if (px > sx && px <= sx + 50) {
					p.pasoAro = true;
					if (a.premio === "tiene") { a.premio = "cuenta"; p.pasoPremio = true; }
				}
			});
			if (p.tSalto >= DUR_SALTO) {
				p.saltando = false; p.y = SUELO_Y; p.dir = 0;
				var pts = 0;
				if (p.pasoAro && p.pasoJarron) pts = 100 + 200 + 100 + (p.pasoPremio ? 1000 : 0);
				else if (p.pasoAro) pts = 100 + (p.pasoPremio ? 1000 : 0);
				else if (p.pasoJarron) pts = 200;
				if (pts) { stat.score += pts; (p.pasoPremio ? son.premio : son.punto)(); }
			}
		}

		// Sprite: en el aire la pose de salto; corriendo, los tres cuadros del galope.
		if (p.saltando && p.y < SUELO_Y) p.sprite = "player2";
		else if (p.corriendo) { p.motion += dt; p.sprite = "player" + (Math.floor(p.motion / 0.08) % 3); }
		else p.sprite = "player0";

		// Aros: avanzan solos hacia la izquierda; se van al salir de pantalla.
		generarAros(dt);
		aros.forEach(function (a) { a.x -= VEL_ARO * dt; });
		aros = aros.filter(function (a) { return a.x - cam + 49 > 0; });

		// Último medidor pasado (para volver ahí tras perder una vida).
		medidores.forEach(function (m, i) { if (p.x + cam > m.x + 86) ultimoMedidor = i; });

		// Choques
		var rj = rectJugador();
		var golpe = jarrones.some(function (j) { return choca(rectJarron(j), rj); }) ||
			aros.some(function (a) { return choca(rectAro(a), rj); });
		if (golpe) {
			p.sprite = "die";
			son.muerte();
			cambiar("muerto");
			return;
		}
		if (rectaFinal && choca(rectPodio(), rj)) {
			p.x = podio.x - cam - 8; p.y = podio.y - 62; p.saltando = false; p.sprite = "win0";
			if (stat.score > stat.hi) stat.hi = stat.score;
			son.podio();
			cambiar("fin");
		}
	}

	function reanudarTrasMuerte() {
		// Como el original: si ya pasó algún medidor, vuelve a él; si no, sigue donde estaba.
		aros = []; aroReloj = 0;
		if (rectaFinal) rectaFinal = false;
		if (ultimoMedidor > 0) cam = medidores[ultimoMedidor].x - 20;
		jugador = nuevoJugador();
		bonusReloj = 0;
	}

	function actualizar(dt) {
		reloj += dt;
		switch (estado) {
			case "titulo":
				if (pulso.enter || tecla.enter) { pulso.enter = false; cambiar("arrancando"); }
				break;
			case "arrancando":
				if (reloj > 2) { nuevaPartida(); cambiar("stage"); }
				break;
			case "stage":
				if (reloj > 3) cambiar("juego");
				break;
			case "juego":
				actualizarJuego(dt);
				break;
			case "muerto":
				if (reloj > 2) {
					if (vidas <= 0) cambiar("gameover");
					else { vidas--; reanudarTrasMuerte(); cambiar("stage"); }
				}
				break;
			case "gameover":
				if (reloj > 3) cambiar("titulo");
				break;
			case "fin":
				publicoReloj += dt;
				if (publicoReloj > 0.08) { publicoReloj = 0; publicoAnim ^= 1; }
				animReloj += dt;
				if (animReloj > 0.09) { animReloj = 0; jugador.sprite = jugador.sprite === "win0" ? "win1" : "win0"; }
				if (stat.bonus > 0) {
					var q = Math.min(stat.bonus, Math.ceil(1000 * dt / 10) * 10);
					stat.bonus -= q; stat.score += q;
					if (stat.score > stat.hi) stat.hi = stat.score;
				} else if (reloj > 8) cambiar("titulo");
				break;
		}
	}

	// ─── Dibujo ──────────────────────────────────────────────────────────────
	function marcador() {
		ctx.lineWidth = 2;
		ctx.strokeStyle = "rgb(255,0,127)"; ctx.strokeRect(60, 30, 400, 50);
		ctx.strokeStyle = "rgb(0,216,255)"; ctx.strokeRect(55, 25, 410, 60);
		if (estado !== "juego" || parpadeo1P < 0.4) texto("1P-", 70, 40);
		texto(pad(stat.score, 6), 105, 40);
		texto("HI-" + pad(stat.hi, 6), 210, 40);
		texto("STAGE-" + pad(stat.stage, 2), 350, 40);
		texto("BONUS", 210, 60, "rgb(255,0,127)");
		texto("-" + stat.bonus, 270, 60);
		for (var i = 0; i < vidas; i++) dib("icon", 430 - i * 15, 60);
	}

	function dibujarEscena() {
		var i, x;
		// Público (fila de arriba); cada 7 tramos, uno decorado.
		var paso = 65 * 1.25;
		var k = Math.floor(cam / paso);
		for (i = -1; i < W / paso + 2; i++) {
			var idx = k + i;
			x = idx * paso - cam;
			var n = ((idx % 7) + 7) % 7;
			if (n === 2) dib("back_deco", x, 100, 1.3);
			else dib(publicoAnim && estado === "fin" ? "back_normal2" : "back_normal", x, 100, 1.3);
		}
		// Piso
		var pasoPiso = 67, k2 = Math.floor(cam / pasoPiso);
		for (i = -1; i < W / pasoPiso + 2; i++) dib("back", (k2 + i) * pasoPiso - cam, 100 + 64 * 1.3, 1.25);
		// Medidores
		medidores.forEach(function (m) {
			x = m.x - cam;
			if (x > -90 && x < W) { dib("miter", x, 410); texto(m.etiqueta, x + 20, 418); }
		});
		dib("end", podio.x - cam, podio.y);
		// Jarrones
		jarrones.forEach(function (j) {
			x = j.x - cam;
			if (x > -50 && x < W) dib(cuadroAnim ? "front2" : "front", x, j.y);
		});
		// Mitad trasera de los aros → Charlie → mitad delantera (así pasa POR el aro).
		aros.forEach(function (a) { dib(cuadroAnim ? "enemy_1b" : "enemy_b", a.x - cam, a.y, 1, altoAro(a)); });
		dib(jugador.sprite, jugador.x, jugador.y);
		aros.forEach(function (a) {
			x = a.x - cam + 26;
			if (a.premio === "tiene") dib("cash", x - 12, a.y + 26);
			dib(cuadroAnim ? "enemy_1f" : "enemy_f", x, a.y, 1, altoAro(a));
		});
	}

	function dibujar() {
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, W, H);
		if (porCargar > 0) { texto("CARGANDO...", 200, 210); return; }

		switch (estado) {
			case "titulo":
			case "arrancando":
				var fase = Math.floor(reloj / 0.3);
				estrellas.forEach(function (e) { dib(ESTRELLA[(e.c + fase) % 3], e.x, e.y); });
				dib("title", W * 0.27, H * 0.23);
				texto("PLAY SELECT", W * 0.4, H * 0.6);
				if (estado === "titulo" || Math.floor(reloj / 0.2) % 2 === 0) texto("► 1 PLAYER A", W * 0.35, H * 0.7);
				if (estado === "titulo") texto("ENTER / TOCAR PARA JUGAR", 150, H * 0.85, "#9ca3af");
				if (estado === "titulo") texto("M: SILENCIO   N: OTRA CANCION", 150, H * 0.92, "#6b7280");
				break;
			case "stage":
				marcador();
				texto("STAGE-" + pad(stat.stage, 2), W * 0.4, H * 0.5);
				break;
			case "gameover":
				marcador();
				texto("GAME OVER", W * 0.4, H * 0.5);
				break;
			default:
				dibujarEscena();
				marcador();
				if (window.MusicaCirco && window.MusicaCirco.suena()) {
					ctx.font = "11px 'Courier New', monospace"; ctx.textBaseline = "top"; ctx.fillStyle = "#9ca3af";
					ctx.textAlign = "right"; ctx.fillText("\u266B " + window.MusicaCirco.cancion(), W - 6, 90); ctx.textAlign = "left";
				}
		}
	}

	// ─── Bucle ───────────────────────────────────────────────────────────────
	var ultimo = performance.now();
	function paso(t) {
		var dt = Math.min(0.05, (t - ultimo) / 1000);
		ultimo = t;
		if (porCargar <= 0) actualizar(dt);
		dibujar();
		requestAnimationFrame(paso);
	}
	nuevaPartida();
	requestAnimationFrame(paso);

	// Ganchos de depuración para pruebas automáticas (sin efecto en el juego).
	window.__circus = {
		estado: function () { return estado; },
		stat: function () { return stat; },
		vidas: function () { return vidas; },
		cam: function () { return cam; },
		jugador: function () { return jugador; },
		jarrones: function () { return jarrones; },
		aros: function () { return aros; },
		irA: function (x) { cam = x; },
		saltarEspera: function () { reloj = 99; }
	};
})();
