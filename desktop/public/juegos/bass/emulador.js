/*
 * Bassin's Black Bass with Hank Parker (SNES, Hot-B/Starfish 1994) en el navegador — McKenna, 2026-09-21.
 *
 * El cartucho (rom/bassin_es.sfc, con los textos en español; ver traduccion/) corre en Snes9x
 * compilado a WebAssembly (externalLib/snes9x/, paquete @wasm-gaming/snes9x-wasm 0.1.1, MIT; el
 * núcleo Snes9x tiene su propia licencia, ver LICENSE). El SDK dibuja en el canvas y saca el audio
 * por un AudioWorklet; el ritmo lo marca el audio. Esta capa carga la ROM, arranca el motor, pone
 * los botones táctiles y sincroniza la partida guardada con el panel.
 *
 * La CSP de este juego (app/routes.py, `_csp_juego`) permite compilar wasm y hacer fetch al mismo
 * origen; la API exige el token Bearer, que este iframe con sandbox no tiene.
 *
 * Partidas guardadas: el juego guarda en la SRAM del cartucho (8 KB). El iframe no tiene
 * localStorage ni OPFS, así que al arrancar se le pide la SRAM al panel (postMessage
 * "juego:partida:leer"), se escribe en el cartucho antes de encenderlo, y cada 10 s (y al ocultar
 * la pestaña) se manda al panel si cambió ("juego:partida:guardar"); el panel la sube al servidor
 * por usuario. Para llegar a la SRAM se envuelve la fábrica del módulo Emscripten
 * (`createSnes9xModule`) y se captura la instancia, porque el SDK no la expone.
 *
 * Controles (los del SDK): ← → ↑ ↓ · A = S · B = X · X = A · Y = Z · L = Q · R = W · Start = Enter ·
 * Select = Shift derecho. En pantalla táctil aparecen botones que disparan esas mismas teclas.
 */

// Captura del módulo Emscripten: snes9x.js declara `var createSnes9xModule = …`; con un accesor en
// window, esa asignación cae en el setter y el SDK recibe nuestra envoltura desde el getter.
let fabricaOriginal = null, modulo = null;
Object.defineProperty(window, "createSnes9xModule", {
	configurable: true,
	get() {
		return async function (opciones) {
			modulo = await fabricaOriginal(opciones);
			return modulo;
		};
	},
	set(v) { fabricaOriginal = v; }
});

import { load } from "./externalLib/snes9x/snes9x.sdk.js";

const lienzo = document.getElementById("lienzo");
const aviso = document.getElementById("aviso");
let motor = null;

function teclaSintetica(tipo, code) {
	window.dispatchEvent(new KeyboardEvent(tipo, { code: code, key: code, bubbles: true }));
}

// Táctil: cada botón dispara la tecla del SDK que tiene en data-tecla.
const tactil = document.getElementById("tactil");
tactil.querySelectorAll("button").forEach(function (b) {
	const code = b.dataset.tecla;
	const bajar = function (e) { e.preventDefault(); teclaSintetica("keydown", code); b.classList.add("activo"); };
	const subir = function (e) { e.preventDefault(); teclaSintetica("keyup", code); b.classList.remove("activo"); };
	b.addEventListener("pointerdown", bajar);
	b.addEventListener("pointerup", subir);
	b.addEventListener("pointercancel", subir);
	b.addEventListener("pointerleave", subir);
});
window.addEventListener("touchstart", function () { tactil.classList.add("visible"); }, { passive: true });
if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) tactil.classList.add("visible");
lienzo.addEventListener("pointerdown", function () { lienzo.focus(); });

// ─── SRAM ↔ panel ─────────────────────────────────────────────────────────
function leerSram() {
	if (!modulo) return null;
	const n = modulo._s9xwasm_sram_size();
	if (!n) return null;
	const p = modulo._s9xwasm_sram_ptr();
	return modulo.HEAPU8.slice(p, p + n);
}
function escribirSram(bytes) {
	if (!modulo) return false;
	const n = modulo._s9xwasm_sram_size();
	if (!n || bytes.length !== n) return false;
	modulo.HEAPU8.set(bytes, modulo._s9xwasm_sram_ptr());
	return true;
}
function aBase64(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	return btoa(s);
}
function deBase64(b64) {
	const s = atob(b64), out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}
let ultimaGuardada = "";
const enPanel = window.parent && window.parent !== window;

function pedirPartida() {
	// Devuelve la SRAM guardada en el panel (o null si no hay o no responde en 4 s).
	return new Promise(function (resolver) {
		if (!enPanel) return resolver(null);
		let listo = false;
		const t = setTimeout(function () { if (!listo) { listo = true; resolver(null); } }, 4000);
		window.addEventListener("message", function alMensaje(e) {
			const m = e.data;
			if (!m || m.tipo !== "juego:partida") return;
			window.removeEventListener("message", alMensaje);
			if (listo) return;
			listo = true; clearTimeout(t);
			resolver(typeof m.datos === "string" && m.datos ? m.datos : null);
		});
		window.parent.postMessage({ tipo: "juego:partida:leer" }, "*");
	});
}
function guardarSiCambio() {
	if (!enPanel) return;
	const sram = leerSram();
	if (!sram) return;
	const b64 = aBase64(sram);
	if (b64 === ultimaGuardada) return;
	ultimaGuardada = b64;
	window.parent.postMessage({ tipo: "juego:partida:guardar", datos: b64 }, "*");
}
window.addEventListener("message", function (e) {
	const m = e.data;
	if (!m) return;
	if (m.tipo === "juego:partida:ok") { aviso.textContent = "PARTIDA GUARDADA"; setTimeout(function () { aviso.textContent = ""; }, 2500); }
	if (m.tipo === "juego:partida:error") { aviso.textContent = "NO SE PUDO GUARDAR LA PARTIDA"; ultimaGuardada = ""; }
	// El panel va a cerrar el juego: manda la SRAM si cambió, o avisa que no hay nada nuevo.
	if (m.tipo === "juego:partida:pedir") {
		const antes = ultimaGuardada;
		guardarSiCambio();
		if (ultimaGuardada === antes) window.parent.postMessage({ tipo: "juego:partida:sin-cambios" }, "*");
	}
});

// Esc dentro del juego = salir al panel (el "QUIT" del propio juego deja la consola congelada:
// está pensado para apagar la Super Nintendo; aquí la salida es Esc o el botón «Salir»).
window.addEventListener("keydown", function (e) {
	if (e.code !== "Escape" || !enPanel) return;
	e.preventDefault();
	guardarSiCambio();
	window.parent.postMessage({ tipo: "juego:salir" }, "*");
});

async function arrancar() {
	try {
		const r = await fetch("rom/bassin_es.sfc");
		if (!r.ok) throw new Error("HTTP " + r.status);
		const rom = new Uint8Array(await r.arrayBuffer());
		motor = await load({
			canvasEl: lienzo,
			assets: { rom: rom },
			options: { escMenu: false, aspect: "1:1", cropOverscan: true, volume: 0.8, logLevel: "error" },
			persist: null,
			storageNamespace: "bass",
			onEvent: function (e) { if (e && e.type === "error") aviso.textContent = "Error del emulador: " + (e.message || ""); }
		});
		// La SRAM se restaura ANTES de encender: el juego la lee al arrancar.
		const guardada = await pedirPartida();
		if (guardada) {
			try { if (escribirSram(deBase64(guardada))) ultimaGuardada = guardada; } catch (e) {}
		}
		motor.start();
		aviso.textContent = guardada ? "PARTIDA CARGADA · ENTER / START PARA JUGAR" : "ENTER / TOCAR START PARA JUGAR";
		setTimeout(function () { aviso.textContent = ""; }, 6000);
		lienzo.focus();
		setInterval(guardarSiCambio, 10000);
		document.addEventListener("visibilitychange", function () { if (document.hidden) guardarSiCambio(); });
		window.addEventListener("pagehide", guardarSiCambio);
	} catch (e) {
		aviso.textContent = "No se pudo arrancar: " + e.message;
	}
}
arrancar();

// Ganchos para pruebas automáticas.
window.__snes = {
	listo: function () { return motor !== null; },
	pixel: function (x, y) {
		const c = lienzo.getContext("2d");
		return c ? Array.from(c.getImageData(x, y, 1, 1).data) : null;
	},
	motor: function () { return motor; },
	sram: function () { const s = leerSram(); return s ? aBase64(s) : null; },
	escribirSram: function (b64) { return escribirSram(deBase64(b64)); },
	guardarAhora: guardarSiCambio
};
