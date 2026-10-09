/**
 * Aviso de voz «Pilas, veci: tiene una tarea en proceso».
 *
 * Vivía dentro de la vista Acciones de la Agenda; desde que la app abre en el Mapa (26-sep-2026)
 * esa vista casi nunca está montada y el aviso dejó de sonar. Ahora lo usan la vista Acciones y el
 * reloj global del cabezote (TareaEnCurso). `marcarAvisoTarea`/`msDesdeUltimoAviso` es la
 * marca compartida: si los dos están montados, no suena dos veces.
 */
import { tocarEarcon } from "./lenguajeSonoro";

let _ultimoAviso = Date.now();

export function marcarAvisoTarea(ts = Date.now()) {
  _ultimoAviso = ts;
}

export function msDesdeUltimoAviso(): number {
  return Date.now() - _ultimoAviso;
}

/**
 * AudioContext desbloqueado por gesto del usuario.
 * En Android Chrome, el AudioContext debe crearse/resumirse durante un toque
 * para que pueda reproducir audio posterior sin gesto (como las alarmas a los 5 min).
 */
let _unlockedCtx: AudioContext | null = null;

export function unlockAudioContext() {
  if (_unlockedCtx && _unlockedCtx.state !== "closed") return;
  try {
    _unlockedCtx = new AudioContext();
    // Reproducir buffer vacío de 1 muestra para desbloquear el contexto
    const buf = _unlockedCtx.createBuffer(1, 1, 22050);
    const src = _unlockedCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_unlockedCtx.destination);
    src.start(0);
  } catch { _unlockedCtx = null; }
}


// ── Caché de audio de alarma ──────────────────────────────────────────────────
// El audio TTS se genera una sola vez y se reutiliza en todas las alarmas del día.
// Evita latencia de ~5 s de Voicebox en cada disparo.
let _alarmCache: { buffer: ArrayBuffer; type: string } | null = null;
let _alarmCacheExpiry = 0;

export async function playBlobBuffer(buffer: ArrayBuffer, type: string): Promise<void> {
  const blob = new Blob([buffer], { type });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = 1;
  return new Promise((resolve, reject) => {
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("playback error")); };
    audio.play().catch(reject);
  });
}


/** Genera y cachea el audio de alarma. Llámalo al activar la alarma para pre-calentar. */
export async function warmAlarmCache(apiToken: string): Promise<boolean> {
  if (_alarmCache && Date.now() < _alarmCacheExpiry) return true;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch("/api/voz/sintetizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({
        texto: "Pilas, veci: tiene una tarea en proceso.",
        motor: "voicebox",
        voicebox_engine: "qwen3-0.6b",
        voicebox_profile: "3762e0ae-ae88-4f5e-8d77-af4f8eb7cc23",
        language: "Spanish",
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return false;
    const buffer = await res.arrayBuffer();
    const type = res.headers.get("content-type") || "audio/wav";
    _alarmCache = { buffer, type };
    _alarmCacheExpiry = Date.now() + 12 * 60 * 60 * 1000; // caché 12 horas
    return true;
  } catch { return false; }
}

/** Devuelve true si la hora local cae en horario de descanso (22:00–07:00). */
export function esHorarioSilencio(): boolean {
  const hora = new Date().getHours();
  return hora >= 22 || hora < 7;
}

export async function playAlarmAudio(apiToken?: string) {
  // Intento 1: audio cacheado (generado previamente, sin latencia)
  if (_alarmCache && Date.now() < _alarmCacheExpiry) {
    try { await playBlobBuffer(_alarmCache.buffer, _alarmCache.type); return; } catch {}
  }

  // Intento 2: generar TTS y cachear (primera vez o caché expirada)
  if (apiToken) {
    try {
      if (await warmAlarmCache(apiToken) && _alarmCache) {
        await playBlobBuffer(_alarmCache.buffer, _alarmCache.type);
        return;
      }
    } catch {}
  }

  // Intento 3: SpeechSynthesis del navegador (sin servidor, Android Chrome lo soporta)
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance("Pilas, veci: tiene una tarea en proceso.");
    utt.lang = "es-CO"; utt.rate = 0.92; utt.volume = 1;
    window.speechSynthesis.speak(utt);
    return;
  }

  // Fallback: el «tarea en curso» del lenguaje sonoro (lib/lenguajeSonoro.ts).
  tocarEarcon("mk_recordatorio", { volumen: 0.9 });
}
