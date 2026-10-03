import type { Panel } from "../stores/app";

/**
 * Ventanas auxiliares: el mismo panel abierto en otra ventana del sistema, para
 * dejarlo en el segundo monitor mientras se trabaja en el principal (el Taller
 * de conciliación al lado del Libro Diario, el Stock al lado de Empaque).
 *
 * Se abre una ventana NUEVA sobre la misma URL con `?aux=1`, no un portal de
 * React hacia otro documento. El portal obliga a clonar a mano cada hoja de
 * estilo y cada variable del tema, y a mantener esa copia sincronizada cuando el
 * usuario cambia de tema; además, todo lo que se monta con `createPortal` en
 * `document.body` —que en esta app es casi cada emergente— aparecería en la
 * ventana equivocada. Una ventana propia es una app propia: mismo origen, misma
 * sesión (la auth vive en localStorage), tema aplicado por el mismo código, y
 * cada una con su copia de React Query, que refresca sola.
 */

const PARAM = "aux";

/** ¿Este documento es una ventana auxiliar? */
export function esVentanaAuxiliar(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(PARAM) === "1";
}

/** URL de la ventana auxiliar para un panel, conservando los demás parámetros. */
export function urlVentanaAuxiliar(panel: Panel, view?: string): string {
  const params = new URLSearchParams(window.location.search);
  params.set(PARAM, "1");
  const hash = view ? `#/${panel}/${view}` : `#/${panel}`;
  return `${window.location.pathname}?${params.toString()}${hash}`;
}

/**
 * Abre (o trae al frente) la ventana auxiliar de un panel.
 *
 * El nombre de ventana lleva el panel, así que pedir dos veces el mismo panel
 * reutiliza la ventana en vez de llenar el escritorio de copias; paneles
 * distintos abren ventanas distintas, que es justamente para lo que sirve.
 */
export function abrirVentanaAuxiliar(panel: Panel, view?: string): boolean {
  if (typeof window === "undefined") return false;
  const alto = Math.max(600, Math.min(1000, Math.round(window.screen.availHeight * 0.85)));
  const ancho = Math.max(760, Math.min(1400, Math.round(window.screen.availWidth * 0.5)));
  const w = window.open(
    urlVentanaAuxiliar(panel, view),
    `mck-aux-${panel}`,
    `popup=yes,width=${ancho},height=${alto},menubar=no,toolbar=no,location=no,status=no`,
  );
  if (!w) return false;
  w.focus();
  return true;
}
