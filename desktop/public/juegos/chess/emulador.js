/*
 * Chessmaster (Game Boy Advance, Ubisoft 2002) en el navegador — McKenna, 2026-09-22.
 *
 * El cartucho (rom/chessmaster_es.gba si existe la traducción; ver traduccion/) corre en mGBA
 * compilado a WebAssembly (externalLib/mgba/, paquete @wasm-gaming/mgba-wasm 0.1.1, MPL-2.0, LICENSE
 * al lado). Mismo esquema que ../bass/emulador.js (Snes9x): el SDK dibuja en el canvas (240×160,
 * mostrado a ×2) y saca el audio por un AudioWorklet; esta capa carga la ROM, arranca el motor,
 * pone los botones táctiles y sincroniza la partida guardada con el panel.
 *
 * Partidas guardadas: mGBA no expone un puntero vivo a la SRAM; `_mgbawasm_sram_save()` la copia a
 * un búfer (`_mgbawasm_sram_ptr()`) y `_mgbawasm_sram_load(ptr, n)` la carga. Se captura el módulo
 * Emscripten envolviendo `createMgbaModule` (el SDK no lo expone). Protocolo con el panel: igual
 * que Bassin's ("juego:partida:leer" / "juego:partida" / "juego:partida:guardar" / "…:pedir").
 *
 * Controles (los del SDK): ← → ↑ ↓ · A = X · B = Z · L = A · R = S · Start = Enter · Select = Shift
 * derecho · Esc = salir al panel. En pantalla táctil aparecen botones con esas mismas teclas.
 */

let fabricaOriginal = null, modulo = null;
Object.defineProperty(window, "createMgbaModule", {
	configurable: true,
	get() {
		return async function (opciones) {
			modulo = await fabricaOriginal(opciones);
			return modulo;
		};
	},
	set(v) { fabricaOriginal = v; }
});

import { load } from "./externalLib/mgba/mgba.sdk.js";

const lienzo = document.getElementById("lienzo");
const aviso = document.getElementById("aviso");
let motor = null;

function teclaSintetica(tipo, code) {
	window.dispatchEvent(new KeyboardEvent(tipo, { code: code, key: code, bubbles: true }));
}
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
	const n = modulo._mgbawasm_sram_save();
	if (!n) return null;
	const p = modulo._mgbawasm_sram_ptr();
	if (!p) return null;
	const out = new Uint8Array(n);
	out.set(modulo.HEAPU8.subarray(p, p + n));
	return out;
}
function escribirSram(bytes) {
	if (!modulo || !bytes.length) return false;
	const p = modulo._malloc(bytes.length);
	modulo.HEAPU8.set(bytes, p);
	const ok = modulo._mgbawasm_sram_load(p, bytes.length);
	modulo._free(p);
	return ok !== 0 && ok !== false;
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
	if (m.tipo === "juego:partida:pedir") {
		const antes = ultimaGuardada;
		guardarSiCambio();
		if (ultimaGuardada === antes) window.parent.postMessage({ tipo: "juego:partida:sin-cambios" }, "*");
	}
});
window.addEventListener("keydown", function (e) {
	if (e.code !== "Escape" || !enPanel) return;
	e.preventDefault();
	guardarSiCambio();
	window.parent.postMessage({ tipo: "juego:salir" }, "*");
});

async function arrancar() {
	try {
		// Primero la ROM traducida; si no existe, la original (el 404 sale sin cabecera CORS y el
		// fetch lanza en vez de responder, por eso el try).
		let r = null;
		try { r = await fetch("rom/chessmaster_es.gba"); } catch (e) { r = null; }
		if (!r || !r.ok) r = await fetch("rom/chessmaster.gba");
		if (!r.ok) throw new Error("HTTP " + r.status);
		const rom = new Uint8Array(await r.arrayBuffer());
		motor = await load({
			canvasEl: lienzo,
			assets: { rom: rom },
			options: { escMenu: false, aspect: "1:1", volume: 0.8, logLevel: "error", skipBios: true },
			persist: null,
			storageNamespace: "chess",
			onEvent: function (e) { if (e && e.type === "error") aviso.textContent = "Error del emulador: " + (e.message || ""); }
		});
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

window.__gba = {
	listo: function () { return motor !== null; },
	motor: function () { return motor; },
	sram: function () { const s = leerSram(); return s ? aBase64(s) : null; },
	escribirSram: function (b64) { return escribirSram(deBase64(b64)); },
	guardarAhora: guardarSiCambio
};
