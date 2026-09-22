import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";

/**
 * Agenda → Juegos: un rato de descanso para el equipo.
 *
 * Cada juego es una página estática en `desktop/public/juegos/<id>/` (Flask la sirve en
 * `/app/juegos/…`, ver `serve_spa_juegos` en app/routes.py). Se carga en un iframe con
 * `sandbox="allow-scripts"` SIN `allow-same-origin`: el juego corre con origen opaco y no
 * puede leer el token del panel (localStorage), sus cookies ni llamar a la API. No quitar
 * ese aislamiento: el código de los juegos es de terceros.
 *
 * Se juega inmersivo: capa negra sobre toda la app + Fullscreen API. El juego se monta solo
 * mientras se juega (al salir se desmonta y se callan sus sonidos).
 *
 * Partidas guardadas: el iframe con sandbox no tiene localStorage ni OPFS, así que un juego que
 * guarde (la SRAM del cartucho en los emulados) la manda por postMessage y este panel la sube a
 * `/api/juegos/partidas/<juego>` con el Bearer del usuario; al abrir, el juego la pide y el panel
 * se la devuelve. Protocolo: {tipo:"juego:partida:leer"} → {tipo:"juego:partida", datos};
 * {tipo:"juego:partida:guardar", datos} → PUT. Solo se atiende al iframe montado.
 */

type Juego = {
  id: string;
  nombre: string;
  descripcion: string;
  src: string;
  /** Tamaño natural de la página del juego, para escalarla sin deformar. */
  ancho: number;
  alto: number;
};

const JUEGOS: Juego[] = [
  {
    id: "duckhunt",
    nombre: "Duck Hunt",
    descripcion: "Apunta y dispara con clic o tocando la pantalla: 3 tiros por pato. El sonido arranca con el primer disparo.",
    // `?v=`: subirlo al cambiar el juego, para que ningún navegador siga con la versión vieja.
    src: `${import.meta.env.BASE_URL}juegos/duckhunt/index.html?v=2`,
    ancho: 520,
    alto: 456,
  },
  {
    id: "circus-nes",
    nombre: "Circus Charlie",
    descripcion: "El juego original de NES completo (5 etapas), emulado. ← → ↑ ↓ mueven, Espacio salta (A), Enter = Start. En el celular salen los botones en pantalla.",
    src: `${import.meta.env.BASE_URL}juegos/circus-nes/index.html?v=1`,
    ancho: 512,
    alto: 480,
  },
  {
    id: "bass",
    nombre: "Bassin's Black Bass",
    descripcion: "Pesca de lobina por torneos (SNES, 1994), emulado y con los textos en español. Flechas mueven, S = A, X = B, A = X, Z = Y, Enter = Start. Tarda unos segundos en cargar.",
    src: `${import.meta.env.BASE_URL}juegos/bass/index.html?v=2`,
    ancho: 512,
    alto: 448,
  },
  {
    id: "chess",
    nombre: "Chessmaster",
    descripcion: "Ajedrez (Game Boy Advance, 2002), emulado. Flechas mueven el cursor, X = A (elegir), Z = B (atrás), Enter = Start, Esc sale. Tarda unos segundos en cargar.",
    src: `${import.meta.env.BASE_URL}juegos/chess/index.html?v=1`,
    ancho: 480,
    alto: 320,
  },
];

type Servidor = "revisando" | "ok" | "sin-ruta";

/**
 * Si Flask no tiene la ruta de juegos (no se reinició tras actualizar), el comodín de /app
 * devuelve el panel y el iframe muestra «Cargando panel» para siempre (el sandbox le niega el
 * localStorage). Se detecta por la CSP propia de los juegos. En `npm run dev` no hay CSP.
 */
function useServidorJuegos(src: string): Servidor {
  const [estado, setEstado] = useState<Servidor>(import.meta.env.PROD ? "revisando" : "ok");
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let vivo = true;
    fetch(src, { method: "HEAD", credentials: "same-origin", cache: "no-store" })
      .then((r) => {
        const csp = r.headers.get("Content-Security-Policy") || "";
        if (vivo) setEstado(r.ok && csp.includes("sandbox") ? "ok" : "sin-ruta");
      })
      .catch(() => vivo && setEstado("sin-ruta"));
    return () => {
      vivo = false;
    };
  }, [src]);
  return estado;
}

function useEscala(ref: React.RefObject<HTMLDivElement | null>, ancho: number, alto: number, activo: boolean) {
  const [escala, setEscala] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || !activo) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      setEscala(Math.max(0.3, Math.min(r.width / ancho, r.height / alto)));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, ancho, alto, activo]);
  return escala;
}

export default function JuegosPanel() {
  const [activoId, setActivoId] = useState(JUEGOS[0].id);
  const [jugando, setJugando] = useState(false);
  const [partida, setPartida] = useState(0);
  const [verControles, setVerControles] = useState(true);
  const juego = JUEGOS.find((j) => j.id === activoId) ?? JUEGOS[0];
  const servidor = useServidorJuegos(juego.src);
  const escenario = useRef<HTMLDivElement>(null);
  const marco = useRef<HTMLIFrameElement>(null);
  const escala = useEscala(escenario, juego.ancho, juego.alto, jugando);
  const [guardado, setGuardado] = useState<string | null>(null);


  const guardadoPendiente = useRef<(() => void) | null>(null);

  // Antes de desmontar el juego le pide la partida (hasta 1,5 s): si se cerrara de golpe, el
  // último guardado del cartucho podría perderse.
  const salir = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    const ventana = marco.current?.contentWindow;
    if (!ventana) { setJugando(false); return; }
    let cerrado = false;
    const cerrar = () => { if (!cerrado) { cerrado = true; guardadoPendiente.current = null; setJugando(false); } };
    guardadoPendiente.current = cerrar;
    window.setTimeout(cerrar, 1500);
    ventana.postMessage({ tipo: "juego:partida:pedir" }, "*");
  }, []);

  // Puente de partidas guardadas con el juego (ver el comentario de arriba).
  useEffect(() => {
    if (!jugando) return;
    const id = juego.id;
    const alMensaje = async (e: MessageEvent) => {
      const ventana = marco.current?.contentWindow;
      if (!ventana || e.source !== ventana) return;
      const m = e.data as { tipo?: string; datos?: string } | null;
      if (!m || typeof m.tipo !== "string") return;
      try {
        if (m.tipo === "juego:partida:leer") {
          const r = await api.get<{ datos: string | null }>(`/api/juegos/partidas/${id}`);
          ventana.postMessage({ tipo: "juego:partida", datos: r?.datos ?? null }, "*");
        } else if (m.tipo === "juego:partida:guardar" && typeof m.datos === "string") {
          await api.put(`/api/juegos/partidas/${id}`, { datos: m.datos });
          setGuardado(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }));
          ventana.postMessage({ tipo: "juego:partida:ok" }, "*");
          guardadoPendiente.current?.();
        } else if (m.tipo === "juego:partida:sin-cambios") {
          guardadoPendiente.current?.();
        } else if (m.tipo === "juego:salir") {
          salir();
        }
      } catch {
        ventana.postMessage({ tipo: "juego:partida:error" }, "*");
      }
    };
    window.addEventListener("message", alMensaje);
    return () => window.removeEventListener("message", alMensaje);
  }, [jugando, juego.id, salir]);

  function jugar() {
    setPartida((n) => n + 1);
    setJugando(true);
    setVerControles(true);
    // Pedir la pantalla completa dentro del mismo clic (el navegador lo exige). Si no se
    // puede (iPhone, permisos), la capa negra ya cubre toda la app.
    void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  }

  // Esc del navegador sale de la pantalla completa → también del juego.
  useEffect(() => {
    if (!jugando) return;
    const alCambiar = () => {
      if (!document.fullscreenElement) setJugando(false);
    };
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") salir();
    };
    document.addEventListener("fullscreenchange", alCambiar);
    window.addEventListener("keydown", alTecla);
    return () => {
      document.removeEventListener("fullscreenchange", alCambiar);
      window.removeEventListener("keydown", alTecla);
    };
  }, [jugando, salir]);

  // Los controles se esconden solos: nada encima del juego mientras se juega.
  useEffect(() => {
    if (!jugando || !verControles) return;
    const t = window.setTimeout(() => setVerControles(false), 3000);
    return () => window.clearTimeout(t);
  }, [jugando, verControles]);

  const puedeJugar = servidor === "ok";

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-6">
      <div className="flex flex-wrap justify-center gap-2">
        {JUEGOS.map((j) => (
          <button
            key={j.id}
            type="button"
            onClick={() => setActivoId(j.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              j.id === juego.id ? "border-accent bg-accent text-white" : "border-border text-muted hover:border-accent/60"
            }`}
          >
            {j.nombre}
          </button>
        ))}
      </div>

      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h2 className="text-2xl font-bold">{juego.nombre}</h2>
        <p className="text-sm text-muted">{juego.descripcion}</p>
        <button
          type="button"
          onClick={jugar}
          disabled={!puedeJugar}
          className="mt-2 rounded-xl bg-accent px-8 py-3 text-lg font-bold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {servidor === "revisando" ? "Preparando…" : "▶ Jugar en pantalla completa"}
        </button>
        <p className="text-xs text-muted">Esc o «✕ Salir» (arriba a la derecha) para volver.</p>
        {servidor === "sin-ruta" && (
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            El servidor todavía no sirve los juegos: falta reiniciar el agente
            (<code>sudo systemctl restart agente-pro</code>) después de la última actualización.
          </p>
        )}
      </div>

      {jugando &&
        createPortal(
          <div
            ref={escenario}
            className="fixed inset-0 z-[9999] overflow-hidden bg-black"
            onMouseMove={() => !verControles && setVerControles(true)}
          >
            <iframe
              ref={marco}
              key={`${juego.id}-${partida}`}
              title={juego.nombre}
              src={juego.src}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              onLoad={(e) => e.currentTarget.focus()}
              width={juego.ancho}
              height={juego.alto}
              className="absolute left-1/2 top-1/2 border-0"
              style={{ transform: `translate(-50%, -50%) scale(${escala})` }}
            />
            {/* Controles: a los 3 s quedan tenues pero tocables (en el celular no hay mouse que
                los haga reaparecer, y en iPhone no hay Esc ni pantalla completa real). */}
            {guardado && (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/15 px-2 py-1 text-xs text-white/80 backdrop-blur">
                Partida guardada {guardado}
              </div>
            )}
            <div
              className={`absolute right-3 top-3 flex gap-2 transition-opacity duration-500 ${
                verControles ? "opacity-100" : "opacity-25 hover:opacity-100"
              }`}
            >
              <button
                type="button"
                onClick={() => setPartida((n) => n + 1)}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/25"
              >
                Reiniciar
              </button>
              <button
                type="button"
                onClick={salir}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/25"
              >
                ✕ Salir
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
