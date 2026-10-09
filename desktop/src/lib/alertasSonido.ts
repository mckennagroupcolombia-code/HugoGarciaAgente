/**
 * Alertas sonoras (6-oct-2026): cada quien elige con qué sonido le avisa el panel cuando
 * una persona en particular le hace una solicitud o cuando alguien escribe en un grupo
 * del chat del equipo. Así se reconoce de oído quién llama sin mirar la pantalla.
 *
 * Desde el 8-oct-2026 los sonidos por defecto son del lenguaje sonoro de la app
 * (lib/lenguajeSonoro.ts, ids `mk_…`, sintetizados): un mensaje son DOS notas de campanita
 * (cada grupo, su par), una solicitud TRES notas de marimba que suben, una mención agrega un
 * destello. Los recortes de juego siguen disponibles como «clásicos» para quien los eligió:
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
import { tocarEarcon } from "./lenguajeSonoro";
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

export type Familia = "Campanitas" | "Avisos" | "Duck Hunt" | "Circus Charlie";
/** Sin `url`: sintetizado con el lenguaje sonoro (el id es el del sonido en lenguajeSonoro). */
export type SonidoAlerta = { id: string; nombre: string; familia: Familia; icono: string; url?: string };

/** Cómo se agrupan en la lista para elegir: primero los del lenguaje, luego los clásicos. */
export const FAMILIAS: { id: Familia; titulo: string }[] = [
  { id: "Campanitas", titulo: "Campanitas de mensaje (dos notas)" },
  { id: "Avisos", titulo: "Avisos" },
  { id: "Duck Hunt", titulo: "Clásicos · Duck Hunt" },
  { id: "Circus Charlie", titulo: "Clásicos · Circus Charlie" },
];

export const CATALOGO_SONIDOS: SonidoAlerta[] = [
  { id: "mk_mensaje", nombre: "Campanita", familia: "Campanitas", icono: "🔔" },
  { id: "mk_gota", nombre: "Gota", familia: "Campanitas", icono: "💧" },
  { id: "mk_burbuja", nombre: "Burbuja", familia: "Campanitas", icono: "🫧" },
  { id: "mk_marimba", nombre: "Marimba", familia: "Campanitas", icono: "🪵" },
  { id: "mk_cristal", nombre: "Cristal", familia: "Campanitas", icono: "💎" },
  { id: "mk_kalimba", nombre: "Kalimba", familia: "Campanitas", icono: "🎶" },
  { id: "mk_brisa", nombre: "Brisa", familia: "Campanitas", icono: "🍃" },
  { id: "mk_solicitud", nombre: "Te piden algo (tres notas)", familia: "Avisos", icono: "🙋" },
  { id: "mk_urgente", nombre: "Urgente", familia: "Avisos", icono: "🚨" },
  { id: "mk_recordatorio", nombre: "Recordatorio", familia: "Avisos", icono: "⏱️" },
  { id: "mk_moneda", nombre: "Moneda", familia: "Avisos", icono: "🪙" },
  { id: "mk_resuelto", nombre: "Listo", familia: "Avisos", icono: "✅" },
  { id: "dh_ladrido", nombre: "Ladrido del perro", familia: "Duck Hunt", icono: "🐶", url: dhLadrido },
  { id: "dh_ladridos", nombre: "Perro contento", familia: "Duck Hunt", icono: "🐕", url: dhLadridos },
  { id: "dh_pato", nombre: "Sale el pato", familia: "Duck Hunt", icono: "🦆", url: dhPato },
  { id: "dh_disparo", nombre: "Disparo", familia: "Duck Hunt", icono: "🎯", url: dhDisparo },
  { id: "dh_caida", nombre: "Pato al suelo", familia: "Duck Hunt", icono: "💥", url: dhCaida },
  { id: "dh_moneda", nombre: "Moneda", familia: "Duck Hunt", icono: "🪙", url: dhMoneda },
  { id: "dh_risa", nombre: "El perro se ríe", familia: "Duck Hunt", icono: "😂", url: dhRisa },
  { id: "dh_ronda", nombre: "Empieza la ronda", familia: "Duck Hunt", icono: "🎺", url: dhRonda },
  { id: "dh_tema", nombre: "Tema principal", familia: "Duck Hunt", icono: "🎵", url: dhTema },
  { id: "cc_salida", nombre: "Charlie sale a escena", familia: "Circus Charlie", icono: "🤡", url: ccSalida },
  { id: "cc_circo", nombre: "Música del circo", familia: "Circus Charlie", icono: "🎪", url: ccCirco },
  { id: "cc_tropiezo", nombre: "Tropiezo con el fuego", familia: "Circus Charlie", icono: "🔥", url: ccTropiezo },
];

/** «silencio»: esa persona o ese grupo no suenan. */
export const SILENCIO = "silencio";

export type AjustesSonido = {
  activo: boolean;
  /** 0–100 */
  volumen: number;
  /** Cada grupo suena con su propio tono (`tonoPropioDeGrupo`) si no se le eligió uno. */
  tono_por_grupo: boolean;
  /** Mensaje en un grupo sin regla propia (con `tono_por_grupo` apagado). */
  general: string;
  /** Solicitud nueva de alguien sin regla propia. */
  solicitud: string;
  /** usuario_id → sonido (quien te escribe o te pide algo). */
  personas: Record<string, string>;
  /** canal_id → sonido (todo lo que se escriba en ese grupo). */
  canales: Record<string, string>;
  /** Versión del lenguaje sonoro con que se guardó (sin el campo = 1, los recortes de juego). */
  lenguaje?: number;
};

const LENGUAJE = 2;

export const AJUSTES_INICIALES: AjustesSonido = {
  activo: true,
  volumen: 70,
  tono_por_grupo: true,
  general: "mk_mensaje",
  solicitud: "mk_solicitud",
  personas: {},
  canales: {},
  lenguaje: LENGUAJE,
};

/**
 * Ajustes guardados antes del lenguaje sonoro (8-oct-2026): los sonidos que eran los de fábrica
 * (sale el pato / ladrido para mensajes, empieza la ronda para solicitudes) pasan a los nuevos
 * una sola vez. Lo que cada quien eligió a mano por persona o por grupo se respeta tal cual.
 */
function conLenguaje(s: Partial<AjustesSonido>): AjustesSonido {
  const a: AjustesSonido = { ...AJUSTES_INICIALES, ...s, lenguaje: s.lenguaje ?? 1 };
  if ((a.lenguaje ?? 1) >= LENGUAJE) return a;
  return {
    ...a,
    lenguaje: LENGUAJE,
    general: a.general === "dh_pato" || a.general === "dh_ladrido" ? AJUSTES_INICIALES.general : a.general,
    solicitud: a.solicitud === "dh_ronda" ? AJUSTES_INICIALES.solicitud : a.solicitud,
  };
}

const CLAVE = "mck-alertas-sonido";

function leerCopia(): AjustesSonido {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (raw) return conLenguaje(JSON.parse(raw) as Partial<AjustesSonido>);
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
      const a = conLenguaje(s);
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

/** Las siete campanitas (todas de dos notas, como cualquier mensaje): cada grupo tiene la suya,
 *  así «dos notas» dice «mensaje» y CUÁLES dos notas dicen de qué grupo. */
const TONOS_DE_GRUPO = ["mk_mensaje", "mk_gota", "mk_burbuja", "mk_marimba", "mk_cristal", "mk_kalimba", "mk_brisa"];

/** El tono característico de un grupo (7-oct-2026): fijo por su id, así cada grupo se
 *  reconoce de oído sin abrir la app. */
export function tonoPropioDeGrupo(canalId: number): string {
  // 7 campanitas: del grupo 8 en adelante se repiten (cada quien puede elegir otra en los ajustes).
  const n = TONOS_DE_GRUPO.length;
  return TONOS_DE_GRUPO[(((canalId - 1) % n) + n) % n];
}

/** Qué suena en un grupo: el que se le eligió; si no, su tono propio (o el general, si se apagó). */
export function sonidoDeCanal(a: AjustesSonido, canalId: number): string {
  const elegido = a.canales[String(canalId)];
  if (elegido) return elegido;
  if (a.tono_por_grupo === false || a.general === SILENCIO) return a.general;
  return tonoPropioDeGrupo(canalId);
}

/** Qué suena con un mensaje de grupo: el del grupo (sonidoDeCanal). Los sonidos por persona
 *  quedan para las solicitudes («quién te pide algo»), si no cada grupo sonaría distinto
 *  según quién escriba y no se reconocería. */
export function sonidoDeMensaje(a: AjustesSonido, canalId: number, _autorId?: number | null): string {
  return sonidoDeCanal(a, canalId);
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
 * 1,5 s no se pisan (llegan 5 mensajes juntos → un solo sonido). `mencion`: el mensaje te
 * nombra con @ → encima del tono del grupo suena un destello agudo.
 */
export function reproducirSonido(id: string, { forzar = false, mencion = false }: { forzar?: boolean; mencion?: boolean } = {}) {
  const a = useAlertasSonido.getState().ajustes;
  if (!forzar && (!a.activo || id === SILENCIO)) return;
  const s = sonidoPorId(id);
  if (!s) return;
  const ahora = Date.now();
  if (!forzar && ahora - ultimoSonido < 1500) return;
  ultimoSonido = ahora;
  document.documentElement.dataset.ultimaAlerta = id;
  const volumen = Math.max(0, Math.min(1, a.volumen / 100));
  if (mencion) tocarEarcon("destello", { volumen, retraso: s.url ? 0.15 : 0.2 });
  if (!s.url) {
    tocarEarcon(s.id, { volumen });
    return;
  }
  try {
    let audio = cache.get(id);
    if (!audio) {
      audio = new Audio(s.url);
      audio.preload = "auto";
      cache.set(id, audio);
    }
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volumen;
    void audio.play().catch(() => {
      /* el navegador aún no deja sonar (sin un toque previo): se calla */
    });
  } catch {
    /* sin audio */
  }
}
