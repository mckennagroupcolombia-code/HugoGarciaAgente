/**
 * El lenguaje sonoro de la app (8-oct-2026). Los avisos sonaban a recortes de 8 bits (onda
 * cuadrada, Duck Hunt, Circus Charlie) y no se distinguían unos de otros. Ahora cada TIPO de aviso
 * tiene una forma propia que se aprende de oído, y todos comparten tonalidad (do mayor) y timbres
 * suaves (campanita FM, marimba, seno y triangular, con una sala corta): suenan a una misma familia.
 *
 *   Mensaje en un grupo     dos notas de campanita (cada grupo, su par: lib/alertasSonido.ts)
 *   Te nombran con @        la campanita del grupo + un destello agudo
 *   Te piden algo           tres notas de marimba que suben
 *   Urgente                 dos tonos que se alternan (sirena suave, sin chillar)
 *   Paso revisado           arpegio brillante que sube
 *   Tarea o flujo cerrado   arpegio + acorde que se abre (el del perro)
 *   Monedas / venta         si → mi metálico, la moneda de siempre
 *   Tarea en curso          dos toques y una campana
 *   Detenido / no se pudo   dos notas graves que bajan
 *   Zumbido                 vibración grave, tres veces
 *   Moverse por la app      marimba de dos notas por etapa: más adelante en el flujo, más agudo
 *
 * Todo se sintetiza aquí con Web Audio: no hay archivos de audio ni red. Un solo AudioContext para
 * toda la app (antes cada módulo abría el suyo), con un limitador suave a la salida para que dos
 * avisos juntos no saturen. Cada sonido dura ≤ 0,6 s más la cola de la sala. Ya no se transpone al
 * azar (desafinaba la tonalidad): para que no suene a máquina varía un poco la fuerza del toque.
 *
 * La leyenda con ▶ para oír cada uno está en el chat del equipo → campana → «Sonidos de los avisos».
 */

type Voz = { c: AudioContext; bus: AudioNode; t: number };
type Earcon = {
  tocar: (v: Voz) => void;
  /** Cuánto va a la sala (1 = lo normal, 0 = seco). */
  sala?: number;
};

let ctx: AudioContext | null = null;
let salida: AudioNode | null = null;
let sala: AudioNode | null = null;

/** Respuesta de una sala pequeña: ruido que se apaga en ~1 s (no se descarga nada). */
function respuestaSala(c: AudioContext, seg: number): AudioBuffer {
  const n = Math.floor(c.sampleRate * seg);
  const b = c.createBuffer(2, n, c.sampleRate);
  for (let canal = 0; canal < 2; canal++) {
    const d = b.getChannelData(canal);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.5);
  }
  return b;
}

/** El AudioContext de toda la app (lo comparten avisos, Mapa, monedas y zumbidos). */
export function contextoAudio(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    const c = new AC({ latencyHint: "interactive" });
    const limitador = c.createDynamicsCompressor();
    limitador.threshold.value = -10;
    limitador.knee.value = 8;
    limitador.ratio.value = 4;
    limitador.attack.value = 0.003;
    limitador.release.value = 0.2;
    limitador.connect(c.destination);
    const conv = c.createConvolver();
    conv.buffer = respuestaSala(c, 1.1);
    const oscura = c.createBiquadFilter();
    oscura.type = "lowpass";
    oscura.frequency.value = 3800;
    const envio = c.createGain();
    envio.gain.value = 0.3;
    envio.connect(oscura).connect(conv).connect(limitador);
    ctx = c;
    salida = limitador;
    sala = envio;
  } catch {
    return null;
  }
  return ctx;
}

/**
 * El navegador arranca el audio dormido y despertarlo tarda: si se despierta recién al llegar el
 * aviso, suena tarde. Se despierta con el primer toque o tecla, que es además el gesto que el
 * navegador exige para dejar sonar.
 */
function despertar() {
  try {
    const c = contextoAudio();
    if (c && c.state !== "running") void c.resume();
  } catch {
    /* sin audio */
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", despertar, { capture: true, passive: true });
  window.addEventListener("keydown", despertar, { capture: true });
}

// ── Notas: do mayor, en número MIDI (do4 = 60) ──────────────────────────────────────────────────
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const SI3 = 59, RE4 = 62, SOL4 = 67, LA4 = 69, DO5 = 72, RE5 = 74, MI5 = 76, SOL5 = 79, LA5 = 81, SI5 = 83;
const DO6 = 84, RE6 = 86, MI6 = 88, SOL6 = 91, DO7 = 96;
/** Quinta justa: la segunda nota de cada etapa al moverse por la app. */
const QUINTA = 7;

// ── Timbres ─────────────────────────────────────────────────────────────────────────────────────

/** Una nota suave (seno o triangular): sube en `ataque`, se sostiene hasta `sostener` (fracción de
 *  la duración) y se apaga sola. `hasta` desliza la altura; `filtro` le quita brillo. */
function tono(v: Voz, ini: number, nota: number, dur: number, vol: number,
  o: { onda?: OscillatorType; ataque?: number; sostener?: number; hasta?: number; filtro?: number } = {}) {
  const { c, bus } = v;
  const t = v.t + ini;
  const osc = c.createOscillator();
  osc.type = o.onda ?? "sine";
  osc.frequency.setValueAtTime(hz(nota), t);
  if (o.hasta != null) osc.frequency.exponentialRampToValueAtTime(hz(o.hasta), t + dur);
  const g = c.createGain();
  const ataque = o.ataque ?? 0.006;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + ataque);
  if (o.sostener) g.gain.setValueAtTime(vol, t + Math.max(ataque, dur * o.sostener));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let fuente: AudioNode = osc;
  if (o.filtro) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = o.filtro;
    osc.connect(lp);
    fuente = lp;
  }
  fuente.connect(g).connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

/** Campanita FM: el brillo del golpe se apaga antes que la nota, como un metal. `razon` 2 = cálida,
 *  1 = redonda (gota), 3 = moneda, 3,5 = cristal. */
function campana(v: Voz, ini: number, nota: number, dur: number, vol: number, { razon = 2, indice = 1.2 } = {}) {
  const { c, bus } = v;
  const t = v.t + ini;
  const f = hz(nota);
  const portadora = c.createOscillator();
  portadora.frequency.setValueAtTime(f, t);
  const mod = c.createOscillator();
  mod.frequency.setValueAtTime(f * razon, t);
  const prof = c.createGain();
  prof.gain.setValueAtTime(f * indice, t);
  prof.gain.exponentialRampToValueAtTime(Math.max(1, f * indice * 0.06), t + dur * 0.45);
  mod.connect(prof).connect(portadora.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  portadora.connect(g).connect(bus);
  for (const o of [portadora, mod]) {
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}

/** Marimba: la fundamental y el sobretono de la tabla (≈ 4 veces), que solo suena en el golpe. */
function marimba(v: Voz, ini: number, nota: number, dur: number, vol: number) {
  tono(v, ini, nota, dur, vol, { ataque: 0.003 });
  tono(v, ini, nota + 23.69, Math.min(dur, 0.08), vol * 0.2, { ataque: 0.002 });
}

/** Vibración de celular: dos sierras graves desafinadas, filtradas y temblando a 26 Hz. */
function vibracion(v: Voz, ini: number, dur: number, vol: number) {
  const { c, bus } = v;
  const t = v.t + ini;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 650;
  const temblor = c.createGain();
  temblor.gain.value = 0.5;
  const lfo = c.createOscillator();
  lfo.frequency.value = 26;
  const lfoProf = c.createGain();
  lfoProf.gain.value = 0.5;
  lfo.connect(lfoProf).connect(temblor.gain);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.setValueAtTime(vol, t + dur - 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const f of [118, 123.5]) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  lp.connect(temblor).connect(g).connect(bus);
  lfo.start(t);
  lfo.stop(t + dur + 0.03);
}

/** El destello de la mención: tres puntos de cristal muy agudos y muy suaves. */
function destello(v: Voz, ini: number, vol = 0.12) {
  campana(v, ini, MI6, 0.14, vol, { razon: 3.5, indice: 0.8 });
  campana(v, ini + 0.05, SOL6, 0.14, vol, { razon: 3.5, indice: 0.8 });
  campana(v, ini + 0.1, DO7, 0.3, vol * 1.1, { razon: 3.5, indice: 0.8 });
}

/** Una etapa del Mapa: marimba de dos notas que sube una quinta, corta la primera y larga la segunda. */
function etapa(raiz: number) {
  return (v: Voz) => {
    marimba(v, 0, raiz, 0.14, 0.32);
    marimba(v, 0.08, raiz + QUINTA, 0.3, 0.32);
  };
}

const moneda = (v: Voz) => {
  campana(v, 0, SI5, 0.08, 0.26, { razon: 3, indice: 0.7 });
  campana(v, 0.07, MI6, 0.45, 0.3, { razon: 3, indice: 0.7 });
  tono(v, 0.07, MI6 + 12, 0.25, 0.035);
};
const campanita = (v: Voz) => {
  campana(v, 0, SOL5, 0.45, 0.34);
  campana(v, 0.12, DO6, 0.48, 0.34);
};
const urgente = (v: Voz) => {
  [LA5, MI5, LA5, MI5].forEach((n, i) =>
    tono(v, i * 0.14, n, i === 3 ? 0.17 : 0.12, 0.26, { onda: "triangle", ataque: 0.012, sostener: 0.55, filtro: 2600 }));
};
const detenido = (v: Voz) => {
  tono(v, 0, RE4, 0.16, 0.32, { onda: "triangle", sostener: 0.4, filtro: 1400 });
  tono(v, 0.15, SI3, 0.3, 0.34, { onda: "triangle", sostener: 0.3, filtro: 1200, hasta: SI3 - 0.7 });
};
const resuelto = (v: Voz) => {
  [DO5, MI5, SOL5].forEach((n, i) => campana(v, i * 0.06, n, 0.24, 0.26, { indice: 0.9 }));
  campana(v, 0.18, DO6, 0.42, 0.32, { indice: 0.9 });
};

const EARCONS: Record<string, Earcon> = {
  // ── Avisos que cada quien puede elegir (ids `mk_…`, se guardan en preferencias_ui.sonidos) ──
  // Campanitas de mensaje: todas son DOS notas; cambia el intervalo, el registro y el timbre.
  mk_mensaje: { tocar: campanita },
  mk_gota: {
    tocar: (v) => {
      campana(v, 0, MI6, 0.32, 0.3, { razon: 1, indice: 0.8 });
      campana(v, 0.1, SI5, 0.45, 0.32, { razon: 1, indice: 0.8 });
    },
  },
  mk_burbuja: {
    tocar: (v) => {
      tono(v, 0, DO6, 0.18, 0.3, { hasta: DO6 + 2 });
      tono(v, 0.09, MI6, 0.4, 0.3, { hasta: MI6 + 1 });
    },
  },
  mk_marimba: { tocar: (v) => { marimba(v, 0, MI5, 0.3, 0.42); marimba(v, 0.11, LA5, 0.45, 0.42); } },
  mk_cristal: {
    tocar: (v) => {
      campana(v, 0, LA5, 0.4, 0.22, { razon: 3.5, indice: 1 });
      campana(v, 0.13, MI6, 0.47, 0.22, { razon: 3.5, indice: 1 });
    },
  },
  mk_kalimba: {
    tocar: (v) => {
      tono(v, 0, RE5, 0.35, 0.34, { onda: "triangle", ataque: 0.002, filtro: 2400 });
      tono(v, 0.12, LA5, 0.45, 0.34, { onda: "triangle", ataque: 0.002, filtro: 2400 });
    },
  },
  mk_brisa: { tocar: (v) => { tono(v, 0, SOL5, 0.3, 0.28, { ataque: 0.04 }); tono(v, 0.14, RE6, 0.44, 0.26, { ataque: 0.05 }); } },
  // Te piden algo: TRES notas que suben (do-mi-sol), con un brillo de octava en la última.
  mk_solicitud: {
    tocar: (v) => {
      marimba(v, 0, DO5, 0.26, 0.42);
      marimba(v, 0.11, MI5, 0.26, 0.42);
      marimba(v, 0.22, SOL5, 0.36, 0.44);
      campana(v, 0.22, SOL6, 0.3, 0.07, { indice: 0.6 });
    },
  },
  mk_urgente: { tocar: urgente, sala: 0.6 },
  mk_recordatorio: {
    tocar: (v) => {
      marimba(v, 0, LA5, 0.12, 0.34);
      marimba(v, 0.15, LA5, 0.12, 0.34);
      campana(v, 0.31, MI5, 0.29, 0.32);
    },
  },
  mk_moneda: { tocar: moneda },
  mk_resuelto: { tocar: resuelto },

  // ── Avisos de un evento (no se eligen: siempre suenan igual) ──
  mencion: { tocar: (v) => { campanita(v); destello(v, 0.2); } },
  destello: { tocar: (v) => destello(v, 0) },
  logro: {
    tocar: (v) => {
      [DO5, MI5, SOL5].forEach((n, i) => marimba(v, i * 0.06, n, 0.22, 0.34));
      for (const n of [DO6, MI6, SOL6]) campana(v, 0.18, n, 0.42, 0.15, { indice: 0.8 });
    },
  },
  error: { tocar: detenido, sala: 0.4 },
  zumbido: {
    tocar: (v) => { for (let i = 0; i < 3; i++) vibracion(v, i * 0.21, 0.16, 0.5); },
    sala: 0,
  },

  // ── Moverse por la app (lib/sonidosJuego.ts): una escalera, más agudo más adelante en el flujo ──
  etapa_abastecer: { tocar: etapa(SOL4) },
  etapa_preparar: { tocar: etapa(LA4) },
  etapa_publicar: { tocar: etapa(DO5) },
  etapa_facturar: { tocar: etapa(MI5) },
  etapa_contar: { tocar: etapa(SOL5) },
  etapa_dirigir: { tocar: etapa(LA5) },
  etapa_sistema: { tocar: etapa(DO6) },
  // Tres con forma propia porque también suenan en Empresa viva: llegar a casa, vender y despachar.
  etapa_inicio: { tocar: (v) => { campana(v, 0, MI5, 0.24, 0.3); campana(v, 0.15, DO5, 0.4, 0.3); } },
  etapa_vender: { tocar: moneda },
  etapa_entregar: { tocar: (v) => { marimba(v, 0, SOL5, 0.13, 0.32); marimba(v, 0.09, DO5, 0.32, 0.32); } },
  volver: { tocar: (v) => [SOL5, MI5, DO5].forEach((n, i) => marimba(v, i * 0.07, n, i === 2 ? 0.3 : 0.1, 0.3)) },
  vista: { tocar: (v) => { marimba(v, 0, DO6, 0.1, 0.26); marimba(v, 0.06, SOL5, 0.22, 0.26); } },
  blip: { tocar: (v) => marimba(v, 0, MI6, 0.06, 0.2), sala: 0.3 },
};

export function existeEarcon(id: string): boolean {
  return id in EARCONS;
}

/**
 * Suena un sonido del lenguaje. `volumen` 0–1 (el de cada quien en sus ajustes), `retraso` en
 * segundos. No mira interruptores: eso lo decide quien llama. Devuelve false si no hay audio.
 */
export function tocarEarcon(id: string, { volumen = 1, retraso = 0 }: { volumen?: number; retraso?: number } = {}): boolean {
  const e = EARCONS[id];
  const c = e ? contextoAudio() : null;
  if (!e || !c || !salida) return false;
  const pedido = Date.now();
  const ir = () => {
    // Dormido sin un toque previo, el navegador lo despierta tarde: un aviso viejo ya no suena.
    if (Date.now() - pedido > 1500) return;
    const bus = c.createGain();
    // Un poco más o menos fuerte cada vez, sin cambiar la altura (la tonalidad se respeta).
    bus.gain.value = Math.max(0, Math.min(1.2, volumen)) * (0.92 + Math.random() * 0.16);
    bus.connect(salida!);
    const alSala = e.sala ?? 1;
    if (sala && alSala > 0) {
      const envio = c.createGain();
      envio.gain.value = alSala;
      bus.connect(envio).connect(sala);
    }
    e.tocar({ c, bus, t: c.currentTime + 0.01 + Math.max(0, retraso) });
  };
  try {
    if (c.state === "running") ir();
    else void c.resume().then(ir).catch(() => {});
  } catch {
    return false;
  }
  return true;
}
