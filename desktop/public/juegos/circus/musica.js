/*
 * Música de Circus Charlie — McKenna, 2026-09-21.
 *
 * El remake en C++ no tiene audio. La versión NES de Konami usa arreglos de piezas clásicas de
 * dominio público; aquí van cuatro, transcritas de oído y sintetizadas en chiptune con Web Audio
 * (melodía en onda cuadrada, bajo triangular). Sin archivos ni red. Suenan en lista, una tras
 * otra, y la lista sigue donde iba al perder una vida:
 *   1. Stage 1 · «American Patrol» (F. W. Meacham, 1885) — marcha, 2/4
 *   2. Stage 2 · «Entrada de los gladiadores» (J. Fučík, 1897) — marcha, 2/4
 *   3. Stage 5 · «El Danubio azul» (J. Strauss II, 1866) — vals, 3/4
 *   4. Stage 4 · «Sobre las olas» (J. Rosas, 1888) — vals, 3/4
 * Los arreglos de Konami no se copian (son suyos); las composiciones sí son libres.
 *
 * Uso: MusicaCirco.iniciar(ctx) · parar() · silenciar(bool) · cancion() · saltar()
 */
(function () {
	"use strict";

	var NOTA = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
	function hz(n) {           // "C#5" → 554.37
		var m = /^([A-G]#?)(\d)$/.exec(n);
		return 440 * Math.pow(2, (NOTA[m[1]] + 12 * (+m[2] + 1) - 69) / 12);
	}

	// Cada canción: bpm (negras), `compas` (tiempos por compás), `melodia` en corcheas
	// ([nota, corcheas]; "-" = silencio) y `bajo` por compás: [nota grave en el tiempo 1, notas del
	// acorde para los demás tiempos]. Se recorre cíclicamente si la melodía es más larga.
	var CANCIONES = [
		{
			nombre: "Stage 1 · American Patrol", bpm: 116, compas: 2,
			melodia: [
				["G4", 1], ["G4", 1],
				["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["D5", 1], ["E5", 1],
				["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["D5", 1], ["E5", 1],
				["F5", 1], ["F5", 1], ["F5", 1], ["F5", 1], ["F5", 1], ["F5", 1], ["G5", 1], ["A5", 1],
				["G5", 2], ["F5", 2], ["E5", 2], ["D5", 2],
				["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["D5", 1], ["E5", 1],
				["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["C5", 1], ["D5", 1], ["E5", 1],
				["D5", 1], ["D5", 1], ["D5", 1], ["D5", 1], ["D5", 1], ["E5", 1], ["F5", 1], ["G5", 1],
				["E5", 2], ["C5", 2], ["C5", 3], ["-", 1],
				// toque de corneta
				["G5", 1], ["E5", 1], ["C5", 1], ["E5", 1], ["G5", 1], ["E5", 1], ["C5", 1], ["E5", 1],
				["G5", 1], ["G5", 1], ["A5", 1], ["G5", 1], ["E5", 3], ["-", 1],
				["F5", 1], ["D5", 1], ["B4", 1], ["D5", 1], ["F5", 1], ["D5", 1], ["B4", 1], ["D5", 1],
				["G5", 1], ["F5", 1], ["E5", 1], ["D5", 1], ["C5", 3], ["-", 1],
				["G5", 1], ["E5", 1], ["C5", 1], ["E5", 1], ["G5", 1], ["E5", 1], ["C5", 1], ["E5", 1],
				["A5", 1], ["A5", 1], ["B5", 1], ["A5", 1], ["G5", 3], ["-", 1],
				["F5", 1], ["G5", 1], ["A5", 1], ["B5", 1], ["C6", 1], ["B5", 1], ["A5", 1], ["G5", 1],
				["C6", 2], ["G5", 2], ["C6", 3], ["-", 1]
			],
			bajo: [
				["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["G3"]],
				["F3", ["C4"]], ["F3", ["C4"]], ["G3", ["D4"]], ["G3", ["B3"]],
				["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["G3"]],
				["G3", ["D4"]], ["G3", ["B3"]], ["C3", ["G3"]], ["C3", ["G3"]],
				["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["G3"]],
				["G3", ["D4"]], ["G3", ["D4"]], ["C3", ["G3"]], ["C3", ["G3"]],
				["C3", ["G3"]], ["C3", ["G3"]], ["F3", ["C4"]], ["F3", ["C4"]],
				["F3", ["C4"]], ["G3", ["D4"]], ["C3", ["G3"]], ["C3", ["G3"]]
			]
		},
		{
			nombre: "Stage 2 · Entrada de los gladiadores", bpm: 148, compas: 2,
			melodia: [
				// bajada cromática (semicorcheas escritas como medias corcheas)
				["C6", 0.5], ["B5", 0.5], ["A#5", 0.5], ["A5", 0.5], ["G#5", 0.5], ["G5", 0.5], ["F#5", 0.5], ["F5", 0.5],
				["E5", 0.5], ["D#5", 0.5], ["D5", 0.5], ["C#5", 0.5], ["C5", 1], ["G4", 0.5], ["G4", 0.5],
				["C6", 0.5], ["B5", 0.5], ["A#5", 0.5], ["A5", 0.5], ["G#5", 0.5], ["G5", 0.5], ["F#5", 0.5], ["F5", 0.5],
				["E5", 0.5], ["D#5", 0.5], ["D5", 0.5], ["C#5", 0.5], ["C5", 1], ["-", 1],
				// trompeta
				["C5", 1], ["C5", 0.5], ["C5", 0.5], ["C5", 1], ["D5", 1],
				["E5", 1], ["E5", 0.5], ["E5", 0.5], ["E5", 1], ["F5", 1],
				["G5", 1], ["G5", 0.5], ["G5", 0.5], ["G5", 1], ["A5", 1],
				["G5", 1], ["E5", 1], ["C5", 2],
				["D5", 1], ["D5", 0.5], ["D5", 0.5], ["D5", 1], ["E5", 1],
				["F5", 1], ["F5", 0.5], ["F5", 0.5], ["F5", 1], ["G5", 1],
				["A5", 1], ["A5", 0.5], ["A5", 0.5], ["A5", 1], ["B5", 1],
				["C6", 2], ["G5", 2],
				["C5", 1], ["C5", 0.5], ["C5", 0.5], ["C5", 1], ["D5", 1],
				["E5", 1], ["E5", 0.5], ["E5", 0.5], ["E5", 1], ["F5", 1],
				["G5", 1], ["G5", 0.5], ["G5", 0.5], ["G5", 1], ["A5", 1],
				["G5", 1], ["E5", 1], ["C5", 2],
				["G5", 0.5], ["F5", 0.5], ["E5", 0.5], ["D5", 0.5], ["C5", 0.5], ["B4", 0.5], ["A4", 0.5], ["G4", 0.5],
				["C5", 1], ["C5", 0.5], ["C5", 0.5], ["C5", 1], ["-", 1]
			],
			bajo: [
				["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["G3"]],
				["C3", ["E3"]], ["C3", ["G3"]], ["C3", ["E3"]], ["F3", ["A3"]],
				["G3", ["B3"]], ["G3", ["D4"]], ["C3", ["G3"]], ["C3", ["G3"]],
				["G3", ["B3"]], ["G3", ["D4"]], ["F3", ["A3"]], ["G3", ["D4"]],
				["C3", ["G3"]], ["C3", ["G3"]], ["C3", ["E3"]], ["C3", ["G3"]],
				["C3", ["E3"]], ["F3", ["A3"]], ["G3", ["B3"]], ["G3", ["D4"]],
				["C3", ["G3"]], ["G3", ["D4"]], ["C3", ["G3"]], ["C3", ["G3"]]
			]
		},
		{
			nombre: "Stage 5 · El Danubio azul", bpm: 174, compas: 3,
			melodia: [
				["D4", 2], ["D4", 1], ["F#4", 1], ["A4", 2],   ["A4", 6],
				["-", 2], ["A5", 2], ["A5", 2],                 ["-", 2], ["F#5", 2], ["F#5", 2],
				["D4", 2], ["D4", 1], ["F#4", 1], ["A4", 2],   ["A4", 6],
				["-", 2], ["A5", 2], ["A5", 2],                 ["-", 2], ["G5", 2], ["G5", 2],
				["D4", 2], ["D4", 1], ["G4", 1], ["B4", 2],    ["B4", 6],
				["-", 2], ["B5", 2], ["B5", 2],                 ["-", 2], ["G5", 2], ["G5", 2],
				["D4", 2], ["D4", 1], ["G4", 1], ["B4", 2],    ["B4", 6],
				["-", 2], ["B5", 2], ["B5", 2],                 ["-", 2], ["A5", 2], ["A5", 2],
				["C#4", 2], ["C#4", 1], ["E4", 1], ["A4", 2],  ["A4", 6],
				["-", 2], ["A5", 2], ["A5", 2],                 ["-", 2], ["F#5", 2], ["F#5", 2],
				["C#4", 2], ["C#4", 1], ["E4", 1], ["A4", 2],  ["A4", 6],
				["-", 2], ["A5", 2], ["A5", 2],                 ["-", 2], ["G5", 2], ["G5", 2],
				["D4", 2], ["D4", 1], ["F#4", 1], ["A4", 2],   ["A4", 6],
				["-", 2], ["A5", 2], ["A5", 2],                 ["-", 2], ["F#5", 2], ["F#5", 2],
				["E5", 2], ["D5", 2], ["C#5", 2],               ["D5", 6], ["-", 6]
			],
			bajo: [
				["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]],
				["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]],
				["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]],
				["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]],
				["A3", ["C#4", "E4"]], ["A3", ["C#4", "E4"]], ["A3", ["C#4", "E4"]], ["A3", ["C#4", "E4"]],
				["A3", ["C#4", "E4"]], ["A3", ["C#4", "E4"]], ["A3", ["C#4", "E4"]], ["A3", ["C#4", "E4"]],
				["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]],
				["A3", ["C#4", "E4"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]]
			]
		},
		{
			nombre: "Stage 4 · Sobre las olas", bpm: 168, compas: 3,
			melodia: [
				["D5", 2],
				["B4", 4], ["A4", 1], ["B4", 1],   ["D5", 4], ["B4", 2],   ["G4", 6],   ["G4", 4], ["A4", 2],
				["B4", 4], ["C5", 2],              ["D5", 4], ["E5", 2],   ["D5", 6],   ["D5", 4], ["-", 2],
				["E5", 4], ["D5", 1], ["E5", 1],   ["G5", 4], ["E5", 2],   ["D5", 6],   ["D5", 4], ["C5", 2],
				["B4", 4], ["A4", 2],              ["G4", 4], ["A4", 2],   ["B4", 6],   ["B4", 4], ["D5", 2],
				["B4", 4], ["A4", 1], ["B4", 1],   ["D5", 4], ["B4", 2],   ["G4", 6],   ["G4", 4], ["A4", 2],
				["B4", 4], ["C5", 2],              ["D5", 4], ["E5", 2],   ["D5", 6],   ["D5", 4], ["-", 2],
				["E5", 4], ["F#5", 2],             ["G5", 4], ["F#5", 2],  ["E5", 4], ["D5", 2],   ["C5", 4], ["B4", 2],
				["A4", 4], ["B4", 2],              ["C5", 4], ["A4", 2],   ["G4", 6],   ["G4", 4], ["-", 2]
			],
			bajo: [
				["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]],
				["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]],
				["C3", ["E3", "G3"]], ["C3", ["E3", "G3"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]],
				["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]],
				["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]],
				["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]],
				["C3", ["E3", "G3"]], ["C3", ["E3", "G3"]], ["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]],
				["D3", ["F#3", "A3"]], ["D3", ["F#3", "A3"]], ["G3", ["B3", "D4"]], ["G3", ["B3", "D4"]]
			]
		}
	];

	// Cada canción se convierte una vez en una lista de eventos [tiempo en corcheas, hz, dur, tipo, vol].
	function compilar(c) {
		var ev = [], t = 0, i;
		for (i = 0; i < c.melodia.length; i++) {
			var n = c.melodia[i];
			if (n[0] !== "-") ev.push([t, hz(n[0]), n[1] * 0.9, "square", 0.045]);
			t += n[1];
		}
		var largo = t;                                  // corcheas
		var tiempos = Math.ceil(largo / 2);             // negras
		for (var b = 0; b < tiempos; b++) {
			var compas = Math.floor(b / c.compas), pos = b % c.compas;
			var acorde = c.bajo[compas % c.bajo.length];
			if (pos === 0) ev.push([b * 2, hz(acorde[0]), 1.7, "triangle", 0.10]);
			else ev.push([b * 2, hz(acorde[1][(pos - 1) % acorde[1].length]), 1.2, "triangle", 0.06]);
		}
		ev.sort(function (a, b) { return a[0] - b[0]; });
		return { eventos: ev, largo: largo, corchea: 60 / c.bpm / 2 };
	}
	var COMPILADAS = CANCIONES.map(compilar);

	var ctx = null, maestro = null, sonando = false, timer = null;
	var cancion = 0, indice = 0, inicioCancion = 0;

	function voz(frec, t, dur, tipo, vol) {
		var o = ctx.createOscillator(), g = ctx.createGain();
		o.type = tipo;
		o.frequency.value = frec;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.linearRampToValueAtTime(vol, t + 0.01);
		g.gain.setValueAtTime(vol, t + dur * 0.7);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g); g.connect(maestro);
		o.start(t); o.stop(t + dur + 0.02);
	}

	function programar() {
		// Programa todo lo que caiga en los próximos 250 ms; al acabar una canción sigue la otra.
		var horizonte = ctx.currentTime + 0.25;
		for (;;) {
			var c = COMPILADAS[cancion];
			if (indice >= c.eventos.length) {
				inicioCancion += c.largo * c.corchea;
				cancion = (cancion + 1) % COMPILADAS.length;
				indice = 0;
				continue;
			}
			var e = c.eventos[indice], t = inicioCancion + e[0] * c.corchea;
			if (t >= horizonte) break;
			voz(e[1], t, e[2] * c.corchea, e[3], e[4]);
			indice++;
		}
	}

	window.MusicaCirco = {
		iniciar: function (audio) {
			if (!audio || sonando) return;
			ctx = audio;
			if (!maestro) { maestro = ctx.createGain(); maestro.gain.value = 1; maestro.connect(ctx.destination); }
			sonando = true;
			// Retoma la canción donde iba (misma pista, desde su comienzo de compás más cercano).
			indice = 0;
			inicioCancion = ctx.currentTime + 0.05;
			programar();
			timer = setInterval(function () {
				if (ctx.state === "running") programar();
				else { inicioCancion = ctx.currentTime + 0.05; indice = 0; }   // audio bloqueado: no acumular atraso
			}, 100);
		},
		parar: function () {
			if (!sonando) return;
			sonando = false;
			clearInterval(timer);
			if (maestro) {   // corta lo ya programado bajando el maestro; vuelve a subir para la próxima
				var g = maestro;
				g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
				g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
				setTimeout(function () { if (!sonando) g.gain.setValueAtTime(1, ctx.currentTime); }, 400);
			}
		},
		silenciar: function (si) { if (maestro) maestro.gain.value = si ? 0 : 1; },
		suena: function () { return sonando; },
		cancion: function () { return CANCIONES[cancion].nombre; },
		saltar: function () { cancion = (cancion + 1) % CANCIONES.length; indice = 0; if (ctx) inicioCancion = ctx.currentTime + 0.05; }
	};
})();
