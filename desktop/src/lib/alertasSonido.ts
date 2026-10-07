/**
 * Alertas sonoras (6-oct-2026): cada quien elige con qué sonido le avisa el panel cuando
 * una persona en particular le hace una solicitud o cuando alguien escribe en un grupo
 * del chat del equipo. Así se reconoce de oído quién llama sin mirar la pantalla.
 *
 * Los sonidos son recortes de los juegos de la sección Juegos:
 *  - Duck Hunt: los mp3 originales de `public/juegos/duckhunt/statics/sounds/`.
 *  - Circus Charlie: grabados de la ROM corriendo en jsnes (el mismo emulador del panel),
 *    sin pantalla, y recortados con ffmpeg (salida al escenario, la música del circo y el
 *    tropiezo con el fuego).
 * Uso interno, detrás de la sesión del panel, igual que los juegos.
 *
 * Prioridad: grupo con sonido propio > persona con sonido propio > sonido general.
 * Las preferencias viajan con el usuario (`preferencias_ui.sonidos`, ver
 * `tickets_db._limpiar_alertas_sonido`) y quedan en este navegador como copia.
 */
import { create } from "zustand";
import { useTicketsAuth } from "../stores/ticketsAuth";
import ccCirco from "../assets/sonidos/cc_circo.mp3";
import ccSalida from "../assets/sonidos/cc_salida.mp3";
import ccTropiezo from "../assets/sonidos/cc_tropiezo.mp3";
import dhCaida from "../assets/sonidos/dh_caida.mp3";
import dhDisparo from "../assets/sonidos/dh_disparo.mp3";
import dhLadrido from "../assets/sonidos/dh_ladrido.mp3";
import dhLadridos from "../assets/sonidos/dh_ladridos.mp3";
import dhMoneda from "../assets/sonidos/dh_moneda.mp3";
import dhPato from "../assets/sonidos/dh_pato.mp3";
import dhRisa from "../assets/sonidos/dh_risa.mp3";
import dhRonda from "../assets/sonidos/dh_ronda.mp3";
import dhTema from "../assets/sonidos/dh_tema.mp3";

export type Juego = "Duck Hunt" | "Circus Charlie";
export type SonidoAlerta = { id: string; nombre: string; juego: Juego; icono: string; url: string };

export const CATALOGO_SONIDOS: SonidoAlerta[] = [
  { id: "dh_ladrido", nombre: "Ladrido del perro", juego: "Duck Hunt", icono: "🐶", url: dhLadrido },
  { id: "dh_ladridos", nombre: "Perro contento", juego: "Duck Hunt", icono: "🐕", url: dhLadridos },
  { id: "dh_pato", nombre: "Sale el pato", juego: "Duck Hunt", icono: "🦆", url: dhPato },
  { id: "dh_disparo", nombre: "Disparo", juego: "Duck Hunt", icono: "🎯", url: dhDisparo },
  { id: "dh_caida", nombre: "Pato al suelo", juego: "Duck Hunt", icono: "💥", url: dhCaida },
  { id: "dh_moneda", nombre: "Moneda", juego: "Duck Hunt", icono: "🪙", url: dhMoneda },
  { id: "dh_risa", nombre: "El perro se ríe", juego: "Duck Hunt", icono: "😂", url: dhRisa },
  { id: "dh_ronda", nombre: "Empieza la ronda", juego: "Duck Hunt", icono: "🎺", url: dhRonda },
  { id: "dh_tema", nombre: "Tema principal", juego: "Duck Hunt", icono: "🎵", url: dhTema },
  { id: "cc_salida", nombre: "Charlie sale a escena", juego: "Circus Charlie", icono: "🤡", url: ccSalida },
  { id: "cc_circo", nombre: "Música del circo", juego: "Circus Charlie", icono: "🎪", url: ccCirco },
  { id: "cc_tropiezo", nombre: "Tropiezo con el fuego", juego: "Circus Charlie", icono: "🔥", url: ccTropiezo },
];

/** «silencio»: esa persona o ese grupo no suenan. */
export const SILENCIO = "silencio";

export type AjustesSonido = {
  activo: boolean;
  /** 0–100 */
  volumen: number;
  /** Mensaje en un grupo sin regla propia. */
  general: string;
  /** Solicitud nueva de alguien sin regla propia. */
  solicitud: string;
  /** usuario_id → sonido (quien te escribe o te pide algo). */
  personas: Record<string, string>;
  /** canal_id → sonido (todo lo que se escriba en ese grupo). */
  canales: Record<string, string>;
};

export const AJUSTES_INICIALES: AjustesSonido = {
  activo: true,
  volumen: 70,
  general: "dh_ladrido",
  solicitud: "dh_ronda",
  personas: {},
  canales: {},
};

const CLAVE = "mck-alertas-sonido";

function leerCopia(): AjustesSonido {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (raw) return { ...AJUSTES_INICIALES, ...(JSON.parse(raw) as Partial<AjustesSonido>) };
  } catch {
    /* sin almacenamiento */
  }
  return AJUSTES_INICIALES;
}

type Estado = {
  ajustes: AjustesSonido;
  /** Desde el servidor (al iniciar sesión); no vuelve a guardar. */
  hidratar: (s: Partial<AjustesSonido> | null | undefined) => void;
  cambiar: (parcial: Partial<AjustesSonido>) => void;
  ponerPersona: (uid: number, sonido: string | null) => void;
  ponerCanal: (cid: number, sonido: string | null) => void;
};

let guardarTimer: ReturnType<typeof setTimeout> | null = null;

function guardar(a: AjustesSonido) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(a));
  } catch {
    /* sin almacenamiento */
  }
  const token = useTicketsAuth.getState().token;
  if (!token) return;
  if (guardarTimer) clearTimeout(guardarTimer);
  guardarTimer = setTimeout(() => {
    void fetch("/api/tickets/auth/me/preferencias", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sonidos: a }),
    }).catch(() => {});
  }, 600);
}

function conRegla(m: Record<string, string>, k: number, sonido: string | null): Record<string, string> {
  const out = { ...m };
  if (sonido) out[String(k)] = sonido;
  else delete out[String(k)];
  return out;
}

export const useAlertasSonido = create<Estado>((set, get) => {
  const actualizar = (a: AjustesSonido) => {
    set({ ajustes: a });
    guardar(a);
  };
  return {
    ajustes: leerCopia(),
    hidratar: (s) => {
      if (!s) return;
      const a = { ...AJUSTES_INICIALES, ...s };
      set({ ajustes: a });
      try {
        localStorage.setItem(CLAVE, JSON.stringify(a));
      } catch {
        /* sin almacenamiento */
      }
    },
    cambiar: (p) => actualizar({ ...get().ajustes, ...p }),
    ponerPersona: (uid, s) => actualizar({ ...get().ajustes, personas: conRegla(get().ajustes.personas, uid, s) }),
    ponerCanal: (cid, s) => actualizar({ ...get().ajustes, canales: conRegla(get().ajustes.canales, cid, s) }),
  };
});

export function sonidoPorId(id: string | null | undefined): SonidoAlerta | null {
  return CATALOGO_SONIDOS.find((s) => s.id === id) ?? null;
}

/** Qué suena con un mensaje de grupo: el grupo manda, luego quien escribió, luego el general. */
export function sonidoDeMensaje(a: AjustesSonido, canalId: number, autorId: number | null | undefined): string {
  return a.canales[String(canalId)] ?? (autorId != null ? a.personas[String(autorId)] : undefined) ?? a.general;
}

/** Qué suena con una solicitud nueva: la persona que la pidió, si no el general de solicitudes. */
export function sonidoDeSolicitud(a: AjustesSonido, creadorId: number | null | undefined): string {
  return (creadorId != null ? a.personas[String(creadorId)] : undefined) ?? a.solicitud;
}

const cache = new Map<string, HTMLAudioElement>();
let ultimoSonido = 0;

/**
 * Suena un sonido del catálogo. `forzar` (vista previa en los ajustes) suena aunque las
 * alertas estén apagadas y sin la pausa entre avisos; si no, dos avisos seguidos en menos de
 * 1,5 s no se pisan (llegan 5 mensajes juntos → un solo sonido).
 */
export function reproducirSonido(id: string, { forzar = false }: { forzar?: boolean } = {}) {
  const a = useAlertasSonido.getState().ajustes;
  if (!forzar && (!a.activo || id === SILENCIO)) return;
  const s = sonidoPorId(id);
  if (!s) return;
  const ahora = Date.now();
  if (!forzar && ahora - ultimoSonido < 1500) return;
  ultimoSonido = ahora;
  document.documentElement.dataset.ultimaAlerta = id;
  try {
    let audio = cache.get(id);
    if (!audio) {
      audio = new Audio(s.url);
      audio.preload = "auto";
      cache.set(id, audio);
    }
    audio.pause();
    audio.currentTime = 0;
    audio.volume = Math.max(0, Math.min(1, a.volumen / 100));
    void audio.play().catch(() => {
      /* el navegador aún no deja sonar (sin un toque previo): se calla */
    });
  } catch {
    /* sin audio */
  }
}
