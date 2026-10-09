/**
 * Los sonidos de premio (monedas, revisiones, aprobaciones), con su propio interruptor de silencio
 * (el 🔊 del taller, queda recordado en este navegador).
 *
 * Hasta el 8-oct-2026 eran arpegios de 8 bits en onda cuadrada (la «vida extra», la moneda, la
 * fanfarria de nivel superado). Ahora son los del lenguaje sonoro de la app (lib/lenguajeSonoro.ts),
 * así el mismo hecho suena igual en todas partes:
 *  - 🪙 moneda: ganaste monedas (combo completo, pago del árbitro del servidor);
 *  - ✅ listo: un paso de revisión marcado;
 *  - 🏆 logro: una aprobación final o un flujo cerrado (el mismo del perro, celebracionAprobado).
 */
import { tocarEarcon } from "../../lib/lenguajeSonoro";

const CLAVE = "mck-mision-sonido";
const VOLUMEN = 0.75;

export function sonidoActivo(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== "0";
  } catch {
    return true;
  }
}

export function ponerSonido(activo: boolean) {
  try {
    localStorage.setItem(CLAVE, activo ? "1" : "0");
  } catch {
    /* sin almacenamiento: vale solo para esta visita */
  }
}

/** Ganaste monedas: si → mi metálico. `forzar` suena aunque el taller esté en silencio. */
export function sonarMoneda(forzar = false) {
  if (!forzar && !sonidoActivo()) return;
  tocarEarcon("mk_moneda", { volumen: VOLUMEN });
}

/** Una revisión marcada (un paso): el arpegio de «listo». */
export function sonarRevisado() {
  if (sonidoActivo()) tocarEarcon("mk_resuelto", { volumen: VOLUMEN });
}

/** Una aprobación final (ficha técnica, etiqueta): arpegio y acorde de logro. */
export function sonarAprobado() {
  if (sonidoActivo()) tocarEarcon("logro", { volumen: VOLUMEN });
}

/** El cierre de un flujo o una tarea cumplida (lo acompaña el perro en pantalla). */
export function sonarLogro() {
  if (sonidoActivo()) tocarEarcon("logro", { volumen: VOLUMEN });
}
