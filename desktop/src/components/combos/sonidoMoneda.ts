/**
 * El «¡clin!» de moneda al completar un combo. Sintetizado con Web Audio —dos notas de onda
 * cuadrada, si5 → mi6, como la moneda clásica de los 8 bits—: no se carga ni se distribuye
 * ningún audio ajeno. Se puede silenciar (queda recordado en este navegador).
 */
const CLAVE = "mck-mision-sonido";
let ctx: AudioContext | null = null;

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

export function sonarMoneda(forzar = false) {
  if (!forzar && !sonidoActivo()) return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    const c = ctx;
    void c.resume();
    const t0 = c.currentTime + 0.02;
    const osc = c.createOscillator();
    const gan = c.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(987.77, t0); // si5
    osc.frequency.setValueAtTime(1318.51, t0 + 0.08); // mi6
    gan.gain.setValueAtTime(0.0001, t0);
    gan.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
    gan.gain.setValueAtTime(0.16, t0 + 0.08);
    gan.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.62);
    osc.connect(gan).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.65);
  } catch {
    /* sin audio: el premio sigue viéndose */
  }
}
