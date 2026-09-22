/**
 * La «vida extra» al completar un combo: el arpegio ascendente de seis notas de los 8 bits
 * (mi6 sol6 mi7 do7 re7 sol7) en onda cuadrada. Sintetizado con Web Audio: no se carga ni se
 * distribuye ningún audio ajeno. Se puede silenciar (queda recordado en este navegador).
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

function contexto(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: "interactive" });
  return ctx;
}

/**
 * El navegador arranca el audio dormido y despertarlo tarda: si se crea recién al completar el
 * combo, la vida suena tarde. Se despierta con el primer toque o tecla en la página, que es
 * además el gesto que el navegador exige para dejar sonar.
 */
function despertar() {
  try {
    const c = contexto();
    if (c && c.state !== "running") void c.resume();
  } catch {
    /* sin audio */
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", despertar, { capture: true, passive: true });
  window.addEventListener("keydown", despertar, { capture: true });
}

// mi6 sol6 mi7 do7 re7 sol7: cada nota es una corchea corta; la última se deja sonar.
const VIDA = [1318.51, 1567.98, 2637.02, 2093.0, 2349.32, 3135.96];
const PASO = 0.13;

function tocar(c: AudioContext) {
  const t0 = c.currentTime + 0.005;
  const osc = c.createOscillator();
  const gan = c.createGain();
  osc.type = "square";
  gan.gain.setValueAtTime(0.0001, t0);
  VIDA.forEach((f, n) => {
    const t = t0 + n * PASO;
    osc.frequency.setValueAtTime(f, t);
    // Cada nota se ataca de nuevo, como en la consola: un pequeño bache de volumen entre notas.
    gan.gain.setValueAtTime(0.0001, t);
    gan.gain.exponentialRampToValueAtTime(0.12, t + 0.006);
    if (n < VIDA.length - 1) gan.gain.exponentialRampToValueAtTime(0.07, t + PASO - 0.01);
  });
  const fin = t0 + (VIDA.length - 1) * PASO;
  gan.gain.setValueAtTime(0.12, fin + 0.12);
  gan.gain.exponentialRampToValueAtTime(0.0001, fin + 0.55);
  osc.connect(gan).connect(c.destination);
  osc.start(t0);
  osc.stop(fin + 0.6);
}

export function sonarMoneda(forzar = false) {
  if (!forzar && !sonidoActivo()) return;
  try {
    const c = contexto();
    if (!c) return;
    // Dormido, su reloj no avanza: se agenda cuando despierte para no perder el inicio.
    if (c.state === "running") tocar(c);
    else void c.resume().then(() => tocar(c));
  } catch {
    /* sin audio: el premio sigue viéndose */
  }
}
