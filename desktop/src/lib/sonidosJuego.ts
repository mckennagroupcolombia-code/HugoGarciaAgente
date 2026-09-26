/**
 * Sonidos de juego al tocar los apartados (26-sep-2026). Cada departamento suena a lo que hace:
 * el muelle de Abastecer pita como un camión, Vender suelta una moneda, Facturar imprime, Dirigir
 * toca una fanfarria… al estilo de los juegos de 8 bits de la sección Juegos (Circus Charlie, la
 * pesca), pero SINTETIZADOS aquí con Web Audio (onda cuadrada, triangular y ruido, como el chip de
 * la NES): no se carga ni se copia ningún audio de esos juegos.
 *
 * Un solo escuchador en todo el documento (instalarSonidos, desde main.tsx) decide qué suena por
 * lo que se tocó: una estación del Mapa o del Edificio (su etapa sale del `data-etapa` más
 * cercano), algo urgente (alarma), «◇ Mapa» (volver), el selector Mapa · Edificio (pausa) y, con
 * la piel pixel, las pestañas dentro de los módulos (un blip). Se silencia con el botón del Mapa
 * y queda recordado en este navegador.
 */
const CLAVE = "mck-sonidos";
const VOLUMEN = 0.07;
let ctx: AudioContext | null = null;
let ruido: AudioBuffer | null = null;

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

function contexto(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: "interactive" });
  return ctx;
}

type Onda = "square" | "triangle" | "sawtooth";

/** Una nota: frecuencia (o deslizamiento hasta `hasta`), duración y volumen relativo. */
function nota(c: AudioContext, t: number, f: number, dur: number, tipo: Onda = "square", vol = 1, hasta?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(f, t);
  if (hasta) o.frequency.exponentialRampToValueAtTime(hasta, t + dur);
  const v = VOLUMEN * vol;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.006);
  g.gain.setValueAtTime(v, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Un golpe de ruido (el canal de percusión de la NES): clics, obturador, impresora. */
function golpe(c: AudioContext, t: number, dur: number, vol = 1, filtro = 3000) {
  if (!ruido) {
    ruido = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = ruido.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = ruido;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = filtro;
  const g = c.createGain();
  g.gain.setValueAtTime(VOLUMEN * 1.6 * vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(c.destination);
  s.start(t);
  s.stop(t + dur + 0.02);
}

/** Los sonidos. Cada uno dura menos de medio segundo: acompañan el toque, no lo retrasan. */
const SONIDOS: Record<string, (c: AudioContext, t: number) => void> = {
  // Planta baja: el timbre de la recepción (ding-dong).
  inicio: (c, t) => { nota(c, t, 659.25, 0.18, "triangle", 1.4); nota(c, t + 0.17, 523.25, 0.3, "triangle", 1.4); },
  // Muelle de carga: dos pitazos graves de camión.
  abastecer: (c, t) => { nota(c, t, 220, 0.1, "square", 0.9); nota(c, t + 0.14, 220, 0.16, "square", 0.9); },
  // Taller: golpe de martillo y un «clonc» metálico.
  preparar: (c, t) => { golpe(c, t, 0.05, 1, 1800); nota(c, t, 330, 0.09, "square", 0.8, 180); nota(c, t + 0.1, 880, 0.08, "triangle", 1); },
  // Estudio: obturador de la cámara y el pitido del flash cargando.
  publicar: (c, t) => { golpe(c, t, 0.03, 1.2, 5000); golpe(c, t + 0.05, 0.03, 1, 3500); nota(c, t + 0.08, 1400, 0.16, "square", 0.5, 2800); },
  // Tienda: la moneda.
  vender: (c, t) => { nota(c, t, 987.77, 0.07, "square", 0.9); nota(c, t + 0.07, 1318.51, 0.25, "square", 0.9); },
  // Despacho: el camión arranca y se va (deslizamiento hacia abajo, como un salto que cae).
  entregar: (c, t) => { nota(c, t, 196, 0.08, "square", 0.8); nota(c, t + 0.08, 392, 0.26, "square", 0.8, 110); },
  // Facturas: la impresora (ráfaga de clics) y una campanita al salir la hoja.
  facturar: (c, t) => { for (let i = 0; i < 5; i++) golpe(c, t + i * 0.035, 0.02, 0.8, 4200); nota(c, t + 0.2, 1567.98, 0.15, "triangle", 1.2); },
  // Contabilidad: la calculadora, tres teclas que suben.
  contar: (c, t) => { [1046.5, 1174.66, 1318.51].forEach((f, i) => nota(c, t + i * 0.06, f, 0.05, "square", 0.7)); },
  // Último piso: fanfarria corta.
  dirigir: (c, t) => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => nota(c, t + i * 0.07, f, i === 3 ? 0.28 : 0.08, "square", 0.7)); },
  // Sótano: la computadora (pitidos que no suben ni bajan, como leyendo datos).
  sistema: (c, t) => { [1760, 1318.51, 1975.53, 1567.98, 1760].forEach((f, i) => nota(c, t + i * 0.045, f, 0.035, "square", 0.55)); },
  // Algo urgente: la alarma de dos tonos.
  urgente: (c, t) => { for (let i = 0; i < 3; i++) { nota(c, t + i * 0.12, 880, 0.06, "square", 0.8); nota(c, t + i * 0.12 + 0.06, 660, 0.06, "square", 0.8); } },
  // «◇ Mapa»: volver al tablero (tres notas que bajan).
  volver: (c, t) => { [783.99, 659.25, 523.25].forEach((f, i) => nota(c, t + i * 0.06, f, 0.07, "triangle", 1.3)); },
  // Mapa · Edificio: el sonido de pausa.
  vista: (c, t) => { [1318.51, 987.77, 1318.51, 987.77].forEach((f, i) => nota(c, t + i * 0.05, f, 0.04, "square", 0.6)); },
  // Una pestaña dentro de un módulo: un blip.
  blip: (c, t) => nota(c, t, 1200, 0.035, "square", 0.45),
};

export function tocarSonido(nombre: string) {
  if (!sonidosActivos()) return;
  const hacer = SONIDOS[nombre];
  const c = contexto();
  if (!hacer) return;
  // Rastro legible (pruebas con el navegador y para depurar «¿por qué no sonó?»).
  document.documentElement.dataset.ultimoSonido = nombre;
  if (!c) return;
  try {
    if (c.state !== "running") void c.resume();
    hacer(c, c.currentTime + 0.01);
  } catch {
    /* sin audio: el toque sigue funcionando */
  }
}

/** Qué suena según lo que se tocó (null: nada). Exportada para las pruebas. */
export function sonidoPara(el: Element | null): string | null {
  if (!el) return null;
  const boton = el.closest("button, a, [role='tab']");
  if (!boton || boton.hasAttribute("data-sin-sonido")) return null;
  if (boton.classList.contains("mck-volver-mapa")) return "volver";
  if (boton.closest(".mapa-vivo, .ed-cielo")) {
    if (boton.matches(".mv-urgente, .ed-urgente, .mv-ir-urgente")) return "urgente";
    if (boton.matches(".mv-nivel")) return "vista";
    const etapa = boton.closest("[data-etapa]")?.getAttribute("data-etapa");
    if (etapa && SONIDOS[etapa]) return etapa;
    return null;
  }
  // Dentro de los módulos, solo con la piel pixel (la del juego): las pestañas hacen blip.
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
