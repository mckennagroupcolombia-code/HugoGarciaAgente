/**
 * Sonidos al tocar los apartados (26-sep-2026; lenguaje nuevo el 8-oct-2026). Antes cada
 * departamento sonaba a un efecto de 8 bits distinto (camión, martillo, impresora…) en onda
 * cuadrada: chillaban y no se aprendían. Ahora todos son de la MISMA familia (marimba suave de
 * lib/lenguajeSonoro.ts, en do mayor): cada etapa del Mapa son dos notas que suben una quinta y la
 * nota de partida sube con el flujo (Abastecer grave … Sistema agudo), así se sabe de oído en qué
 * parte de la empresa se está. Tres tienen forma propia porque también suenan en Empresa viva:
 * Inicio (din-don de la casa), Vender (la moneda) y Entregar (baja: el paquete se va).
 *
 * Un solo escuchador en todo el documento (instalarSonidos, desde main.tsx) decide qué suena por
 * lo que se tocó: una estación del Mapa o del Edificio (su etapa sale del `data-etapa` más
 * cercano), algo urgente (sirena suave), algo detenido (dos notas graves que bajan), «◇ Mapa»
 * (volver), el selector Mapa · Edificio y, con la piel pixel, las pestañas dentro de los módulos
 * (un toque corto). El menú rápido (Ctrl+K y la pestaña «Rápido» del celular) marca cada botón
 * con `data-sonido`: suena como el apartado al que lleva.
 * Se silencia con el botón del Mapa y queda recordado en este navegador.
 */
import type { Panel } from "../stores/app";
import { ubicacionDe } from "./flujoApp";
import { tocarEarcon } from "./lenguajeSonoro";

const CLAVE = "mck-sonidos";
/** Más bajo que los avisos: acompañan cada toque, no deben cansar. */
const NIVEL = 0.5;

export function sonidosActivos(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== "0";
  } catch {
    return true;
  }
}
export function ponerSonidos(activo: boolean) {
  try {
    localStorage.setItem(CLAVE, activo ? "1" : "0");
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

/** Nombre que usa la app → sonido del lenguaje (lib/lenguajeSonoro.ts). */
const SONIDOS: Record<string, string> = {
  inicio: "etapa_inicio",
  abastecer: "etapa_abastecer",
  preparar: "etapa_preparar",
  publicar: "etapa_publicar",
  vender: "etapa_vender",
  entregar: "etapa_entregar",
  facturar: "etapa_facturar",
  contar: "etapa_contar",
  dirigir: "etapa_dirigir",
  sistema: "etapa_sistema",
  urgente: "mk_urgente",
  error: "error",
  volver: "volver",
  vista: "vista",
  blip: "blip",
  // Ajedrez de Empresa viva: el reto, el jaque y quien gana.
  reto: "mk_solicitud",
  jaque: "destello",
  logro: "logro",
};

/** El sonido del apartado donde vive un panel (el mismo que su estación en el Mapa); blip si no es de ninguno. */
export function sonidoDePanel(panel: Panel): string {
  const etapa = ubicacionDe(panel)?.etapa.id;
  return etapa && SONIDOS[etapa] ? etapa : "blip";
}

export function tocarSonido(nombre: string) {
  if (!sonidosActivos()) return;
  const id = SONIDOS[nombre];
  if (!id) return;
  // Rastro legible (pruebas con el navegador y para depurar «¿por qué no sonó?»).
  document.documentElement.dataset.ultimoSonido = nombre;
  tocarEarcon(id, { volumen: NIVEL });
}

/** Vista previa (leyenda de «Sonidos de los avisos»): suena aunque los de la app estén apagados. */
export function oirSonido(nombre: string) {
  const id = SONIDOS[nombre];
  if (id) tocarEarcon(id, { volumen: NIVEL });
}

/** Qué suena según lo que se tocó (null: nada). Exportada para las pruebas. */
export function sonidoPara(el: Element | null): string | null {
  if (!el) return null;
  const boton = el.closest("button, a, [role='tab']");
  if (!boton || boton.hasAttribute("data-sin-sonido")) return null;
  if (boton.classList.contains("mck-volver-mapa")) return "volver";
  const marcado = boton.getAttribute("data-sonido");
  if (marcado && SONIDOS[marcado]) return marcado;
  if (boton.closest(".mapa-vivo, .ed-cielo")) {
    if (boton.matches(".mv-urgente, .ed-urgente, .mv-ir-urgente")) return "urgente";
    if (boton.matches(".mv-bloqueo")) return "error";
    if (boton.matches(".mv-nivel")) return "vista";
    const etapa = boton.closest("[data-etapa]")?.getAttribute("data-etapa");
    if (etapa && SONIDOS[etapa]) return etapa;
    return null;
  }
  // Dentro de los módulos, solo con la piel pixel (la del juego): las pestañas hacen un toque corto.
  if (document.documentElement.dataset.mckSkin === "pixel" && boton.matches(".mck-hub-tab, [role='tab']")) return "blip";
  return null;
}

let instalado = false;
export function instalarSonidos() {
  if (instalado || typeof window === "undefined") return;
  instalado = true;
  // pointerdown y no click: suena en el instante del toque, antes de que el panel cambie.
  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const s = sonidoPara(e.target as Element);
    if (s) tocarSonido(s);
  }, { capture: true, passive: true });
}
