import { Ico } from "../../icons/Ico";
import { Cara } from "../../lib/fotoPersona";
import { useEffect, useMemo, useState } from "react";
import type { TicketsUser } from "../../stores/ticketsAuth";
import {
  useConversaciones, usePresenciaEnLinea,
  type Conversacion,
} from "../../hooks/useConversaciones";
import HiloConversacion, { Avatar, CLAVE_HILO_ACTUAL } from "./HiloConversacion";
import BandejaUnificada from "./BandejaUnificada";
import { useBandejaAngosta } from "../../lib/bandeja";
import { esSolicitudDePago, irASolicitudPago } from "../../lib/irAPago";
import { tiempoRelativo, ESTADO_LABEL, estaAbierta, uidEq } from "./ticketsFormat";
import "./hiloPixel.css";

type TipoTab = "solicitud" | "accion";
type TipoFiltro = "todas" | TipoTab;
/** Quién: lo que me toca hacer, lo que pedí yo, todo, o agrupado por persona. */
type Quien = "me_toca" | "pedi" | "todo" | "persona";
/** Como las estaciones del Mapa: tres contadores que además filtran. */
type Monton = "por_hacer" | "en_curso" | "hechas";

function puedeVerTipo(
  permisos: Record<string, boolean> | null | undefined,
  nivel: number,
  tab: "acciones" | "solicitudes",
): boolean {
  if (nivel >= 3) return true;
  if (!permisos) return true;
  return Boolean(permisos[`tickets_${tab}`]);
}

function leer(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function guardar(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

/** Entregada por quien la hizo: a quien la pidió le toca finalizarla, así que es suya «por hacer». */
function montonDe(c: Conversacion, uid: number): Monton {
  if (c.estado === "pendiente") return "por_hacer";
  if (c.estado === "esperando_aprobacion" && uidEq(c.creado_por, uid)) return "por_hacer";
  if (c.estado === "en_proceso" || c.estado === "esperando_aprobacion") return "en_curso";
  return "hechas";
}

interface PersonaGrupo {
  id: number;
  nombre: string;
  items: Conversacion[];
  noLeidos: number;
  ultimaActividad: string;
}

function PersonaRow({ p, onClick }: { p: PersonaGrupo; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hp-fila">
      <Avatar nombre={p.nombre} uid={p.id} size={10} />
      <div className="min-w-0 flex-1">
        <p className="hp-fila-titulo">{p.nombre}</p>
        <p className="truncate text-[14px] text-ink-muted">
          {p.items.length} conversaci{p.items.length === 1 ? "ón" : "ones"} · {tiempoRelativo(p.ultimaActividad)}
        </p>
      </div>
      {p.noLeidos > 0 && <span className="hp-noleidos">{p.noLeidos > 99 ? "99+" : p.noLeidos}</span>}
    </button>
  );
}

function ConversacionRow({
  c, activa, propio, miaEnCurso, onClick,
}: { c: Conversacion; activa: boolean; propio: boolean; miaEnCurso: boolean; onClick: () => void }) {
  const previewAutor = c.ultimo_usuario_id != null && !propio ? `${c.ultimo_autor}: ` : "";
  const cls = [
    "hp-fila",
    activa ? "activa" : "",
    miaEnCurso ? "encurso" : c.estado === "pendiente" ? "pendiente" : "",
    estaAbierta(c.estado) ? "" : "opacity-75",
  ].join(" ");
  return (
    <button type="button" onClick={onClick} className={cls}>
      <Avatar nombre={c.contraparte_nombre} uid={c.contraparte_id} size={10} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="hp-fila-titulo">{c.titulo}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`hp-etiqueta ${c.estado}`}>
            {miaEnCurso ? "▶ Estás en esta" : (ESTADO_LABEL[c.estado] ?? c.estado)}
          </span>
          <span className="hp-etiqueta tipo">{c.tipo === "accion" ? "Acción" : "Solicitud"}</span>
          {!(c.ultimo_texto && previewAutor) && (
            <span className="min-w-0 max-w-[10rem] truncate text-[13px] text-ink-muted">{c.contraparte_nombre}</span>
          )}
          {c.adjuntos_total > 0 && <span className="text-[14px] text-ink-muted"><Ico e="📎" />{c.adjuntos_total}</span>}
        </div>
        {c.ultimo_texto && (
          <p className={`truncate text-[14px] ${c.no_leidos > 0 ? "font-bold text-ink" : "text-ink-muted"}`}>
            {previewAutor}{c.ultimo_texto}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[13px] text-ink-muted">{tiempoRelativo(c.ultima_actividad)}</span>
        {c.no_leidos > 0 && (
          <span className="hp-noleidos">{c.no_leidos > 99 ? "99+" : c.no_leidos}</span>
        )}
      </div>
    </button>
  );
}

/**
 * Bandeja de solicitudes y acciones (rediseño 27-sep-2026, pedido de Stella): como el Mapa, lo
 * pendiente se ve de un vistazo en tres contadores (Por hacer · En curso · Hechas) que además
 * filtran; arriba, «Seguir con…» devuelve a la que estaba atendiendo; crear una solicitud o una
 * acción es un solo botón; y el historial de las hechas queda plegado al final, sin estorbar.
 * Solicitudes y acciones van juntas por defecto (una sola lista), con la etiqueta de cuál es.
 */
type PropsInbox = {
  token: string;
  user: TicketsUser;
  bootTicketId?: number | null;
  onBootConsumed?: () => void;
  /** Filtro de tipo a aplicar una vez al entrar (ej. desde una tarjeta del dashboard que distingue Acciones/Solicitudes). */
  bootTipo?: TipoTab | null;
  onBootTipoConsumed?: () => void;
  onCrearSolicitud?: () => void;
  onCrearAccion?: () => void;
};

/** En pantallas angostas (celular, tableta vertical) la bandeja es la unificada: solicitudes y
 *  grupos juntos en Te toca · Enterarte · Haciendo (BandejaUnificada). En escritorio, la de siempre. */
export default function InboxConversaciones(props: PropsInbox) {
  const angosta = useBandejaAngosta();
  // La bandeja unificada no filtra por tipo: el filtro pedido desde otra pantalla se descarta.
  useEffect(() => {
    if (angosta && props.bootTipo) props.onBootTipoConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angosta, props.bootTipo]);
  if (angosta) {
    return (
      <BandejaUnificada token={props.token} user={props.user} bootTicketId={props.bootTicketId} onBootConsumed={props.onBootConsumed}
                        onCrearSolicitud={props.onCrearSolicitud} onCrearAccion={props.onCrearAccion} />
    );
  }
  return <InboxEscritorio {...props} />;
}

function InboxEscritorio({
  token, user, bootTicketId, onBootConsumed, bootTipo, onBootTipoConsumed,
  onCrearSolicitud, onCrearAccion,
}: PropsInbox) {
  const nivel = user.rol?.nivel ?? 1;
  const permisos = user.permisos_secciones;
  const verAcciones = puedeVerTipo(permisos, nivel, "acciones");
  const verSolicitudes = puedeVerTipo(permisos, nivel, "solicitudes");
  const verAmbos = verAcciones && verSolicitudes;

  const [tipo, setTipo] = useState<TipoFiltro>(() => {
    const g = leer("mck_inbox_tipo2");
    if (g === "solicitud" || g === "accion" || g === "todas") return g;
    return verAmbos ? "todas" : verSolicitudes ? "solicitud" : "accion";
  });
  const [quien, setQuien] = useState<Quien>(() => {
    const g = leer("mck_inbox_quien");
    if (g === "me_toca" || g === "pedi" || g === "todo" || g === "persona") return g;
    return nivel >= 3 ? "todo" : "me_toca";
  });
  const [monton, setMonton] = useState<Monton | null>(null);
  const [verHechas, setVerHechas] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  // En el celular el buscador va detrás de la lupa: sin él caben más filas a la vista.
  const [buscando, setBuscando] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [personaFiltro, setPersonaFiltro] = useState<number | null>(null);
  const [actualId, setActualId] = useState<number | null>(() => {
    const v = Number(leer(CLAVE_HILO_ACTUAL));
    return Number.isFinite(v) && v > 0 ? v : null;
  });

  useEffect(() => { guardar("mck_inbox_tipo2", tipo); }, [tipo]);
  useEffect(() => { guardar("mck_inbox_quien", quien); setPersonaFiltro(null); }, [quien]);

  useEffect(() => {
    if (bootTicketId != null) {
      setSelectedId(bootTicketId);
      onBootConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootTicketId]);

  useEffect(() => {
    if (bootTipo) {
      setTipo(bootTipo);
      onBootTipoConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootTipo]);

  // Al volver del hilo, releer cuál quedó «en curso» (el hilo lo guarda al abrirla o cerrarla).
  useEffect(() => {
    if (selectedId != null) return;
    const v = Number(leer(CLAVE_HILO_ACTUAL));
    setActualId(Number.isFinite(v) && v > 0 ? v : null);
  }, [selectedId]);

  // Bandeja personal siempre: mías (creadas por mí, asignadas a mí, o donde participo),
  // activas e histórico juntos — nada se oculta ni desaparece, solo baja en la lista.
  const { data: todas = [], isLoading, isError, error, refetch } = useConversaciones(verAmbos ? "todas" : (verSolicitudes ? "solicitud" : "accion"), "mias");
  const { data: presencia } = usePresenciaEnLinea();
  const enLineaIds = useMemo(() => new Set(presencia?.usuario_ids ?? []), [presencia]);

  const delTipo = useMemo(
    () => todas.filter((c) => (tipo === "todas" ? (c.tipo === "accion" ? verAcciones : verSolicitudes) : c.tipo === tipo)),
    [todas, tipo, verAcciones, verSolicitudes],
  );

  const deQuien = useMemo(() => delTipo.filter((c) => {
    if (quien === "me_toca") return uidEq(c.asignado_a, user.id) || (c.asignado_a == null && !uidEq(c.creado_por, user.id));
    if (quien === "pedi") return uidEq(c.creado_por, user.id);
    return true;
  }), [delTipo, quien, user.id]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = quien === "persona" && personaFiltro != null
      ? deQuien.filter((c) => c.contraparte_id === personaFiltro) : deQuien;
    if (!q) return base;
    return base.filter((c) =>
      c.titulo.toLowerCase().includes(q) ||
      (c.contraparte_nombre ?? "").toLowerCase().includes(q) ||
      c.numero.toLowerCase().includes(q));
  }, [deQuien, busqueda, quien, personaFiltro]);

  const cuenta = useMemo(() => {
    const r = { por_hacer: 0, en_curso: 0, hechas: 0 };
    for (const c of filtradas) r[montonDe(c, user.id)] += 1;
    return r;
  }, [filtradas]);

  // Vista "por persona": agrupa por contraparte para no tener que escanear una lista larga.
  const personas = useMemo(() => {
    const map = new Map<number, PersonaGrupo>();
    for (const c of deQuien) {
      if (c.contraparte_id == null) continue;
      const g = map.get(c.contraparte_id) ?? {
        id: c.contraparte_id, nombre: c.contraparte_nombre ?? "—", items: [], noLeidos: 0, ultimaActividad: c.ultima_actividad,
      };
      g.items.push(c);
      g.noLeidos += c.no_leidos;
      if (c.ultima_actividad > g.ultimaActividad) g.ultimaActividad = c.ultima_actividad;
      map.set(c.contraparte_id, g);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.noLeidos !== b.noLeidos ? b.noLeidos - a.noLeidos : b.ultimaActividad.localeCompare(a.ultimaActividad));
  }, [deQuien]);
  const personaActiva = personaFiltro != null ? personas.find((p) => p.id === personaFiltro) : undefined;
  const mostrandoListaPersonas = quien === "persona" && personaFiltro == null;

  // La que estaba atendiendo: la guardada por el hilo; si ya no está en curso, la última mía en curso.
  const seguirCon = useMemo(() => {
    const enCurso = todas.filter((c) => c.estado === "en_proceso" && uidEq(c.asignado_a, user.id));
    return enCurso.find((c) => c.id === actualId) ?? enCurso[0] ?? null;
  }, [todas, actualId, user.id]);

  const ordenar = (lista: Conversacion[]) => [...lista].sort((a, b) => {
    // Primero lo que tengo en las manos, luego lo sin leer, luego lo más reciente.
    const ma = a.id === seguirCon?.id ? 1 : 0;
    const mb = b.id === seguirCon?.id ? 1 : 0;
    if (ma !== mb) return mb - ma;
    if ((a.no_leidos > 0) !== (b.no_leidos > 0)) return a.no_leidos > 0 ? -1 : 1;
    return b.ultima_actividad.localeCompare(a.ultima_actividad);
  });
  const porHacer = ordenar(filtradas.filter((c) => montonDe(c, user.id) === "por_hacer"));
  const enCurso = ordenar(filtradas.filter((c) => montonDe(c, user.id) === "en_curso"));
  const hechas = filtradas.filter((c) => montonDe(c, user.id) === "hechas");

  const secciones: { clave: Monton; label: string; items: Conversacion[] }[] = [
    { clave: "en_curso", label: "En curso", items: enCurso },
    { clave: "por_hacer", label: "Por hacer", items: porHacer },
  ];
  const visibles = monton ? secciones.filter((s) => s.clave === monton) : secciones;
  const mostrarHechas = monton === "hechas" || (monton == null && verHechas);

  const totalNoLeidos = todas.reduce((acc, c) => acc + c.no_leidos, 0);

  const fila = (c: Conversacion) => (
    <ConversacionRow
      key={c.id}
      c={c}
      activa={c.id === selectedId}
      propio={uidEq(c.ultimo_usuario_id, user.id)}
      miaEnCurso={c.id === seguirCon?.id}
      onClick={() => (esSolicitudDePago(c) ? irASolicitudPago(c.pago_id) : setSelectedId(c.id))}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className={`flex w-full flex-col border-r-2 border-ink lg:w-[400px] lg:shrink-0 ${selectedId != null ? "hidden lg:flex" : "flex"}`}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Cabeza compacta (7-oct-2026): antes crear + «seguir con» + tres contadores grandes +
              filtros + buscador se llevaban ~320 px antes de la primera solicitud. */}
          <div className="hp-bandeja-cabeza space-y-2 border-b-2 border-ink px-3 pb-0 pt-2.5">
            {(onCrearSolicitud && verSolicitudes) || (onCrearAccion && verAcciones) ? (
              <div className="flex gap-2">
                {onCrearSolicitud && verSolicitudes && (
                  <button type="button" onClick={onCrearSolicitud} className="hp-boton flex-1">✚ Pedir algo</button>
                )}
                {onCrearAccion && verAcciones && (
                  <button type="button" onClick={onCrearAccion} className="hp-boton blanco flex-1">✚ Nueva tarea</button>
                )}
              </div>
            ) : null}

            {/* Volver a la que estaba atendiendo: una línea. */}
            {seguirCon && seguirCon.id !== selectedId && (
              <button type="button" onClick={() => setSelectedId(seguirCon.id)} className="hp-seguir" title={seguirCon.titulo}>
                <span aria-hidden>▶</span>
                <span className="shrink-0 font-black uppercase tracking-wider">Seguir con</span>
                <span className="min-w-0 flex-1 truncate">{seguirCon.titulo}</span>
              </button>
            )}

            {/* Como el Mapa: cuánto hay en cada montón; tocar uno filtra. */}
            {!mostrandoListaPersonas && (
              <div className="hp-montones">
                {([
                  ["por_hacer", "Por hacer"],
                  ["en_curso", "En curso"],
                  ["hechas", "Hechas"],
                ] as const).map(([clave, label]) => (
                  <button
                    key={clave}
                    type="button"
                    onClick={() => setMonton(monton === clave ? null : clave)}
                    className={monton === clave ? "activo" : ""}
                    aria-pressed={monton === clave}
                  >
                    <b>{cuenta[clave]}</b>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="hp-pestanas">
              {([
                ["me_toca", "Me toca"],
                ["pedi", "Pedí yo"],
                ["todo", "Todo"],
                ["persona", "Por persona"],
              ] as const).map(([clave, label]) => (
                <button key={clave} type="button" className={quien === clave ? "activo" : ""} onClick={() => setQuien(clave)}>
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={`hp-pestana-lupa ${buscando || busqueda.trim() !== "" ? "activo" : ""}`}
                aria-label="Buscar"
                aria-expanded={buscando}
                onClick={() => setBuscando((v) => !v)}
              >
                ⌕
              </button>
            </div>
          </div>
          {(buscando || busqueda.trim() || (verAmbos && tipo !== "todas")) && (
            <div className="flex items-center gap-1.5 border-b-2 border-ink/15 px-3 py-2">
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar…"
                autoFocus={buscando}
                className="hp-campo min-w-0 flex-1 px-3 py-1.5 !text-[15px]"
              />
              {verAmbos && (
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoFiltro)}
                  className="hp-campo shrink-0 px-2 py-1.5 !text-[14px]"
                  aria-label="Tipo"
                >
                  <option value="todas">Todas</option>
                  <option value="solicitud">Solicitudes</option>
                  <option value="accion">Acciones</option>
                </select>
              )}
            </div>
          )}

          {isLoading && todas.length === 0 && !isError && (
            <p className="p-4 text-center text-[15px] text-ink-muted">Cargando…</p>
          )}
          {isError && todas.length === 0 && (
            <div className="p-4 text-center text-[15px] text-accent-rose">
              <p className="font-bold">No se pudo cargar la bandeja.</p>
              <p className="mt-1 text-ink-muted">{error instanceof Error ? error.message : "Error de conexión."}</p>
              <button type="button" onClick={() => refetch()} className="hp-boton-sm mt-2">Reintentar</button>
            </div>
          )}

          {!isLoading && !isError && mostrandoListaPersonas && (
            personas.length === 0
              ? <p className="p-4 text-center text-[15px] text-ink-muted">Nadie por aquí todavía.</p>
              : personas.map((p) => <PersonaRow key={p.id} p={p} onClick={() => setPersonaFiltro(p.id)} />)
          )}

          {!isLoading && !isError && !mostrandoListaPersonas && (
            <>
              {personaActiva && (
                <button
                  type="button"
                  onClick={() => setPersonaFiltro(null)}
                  className="flex w-full items-center gap-1.5 border-b-2 border-ink/15 px-3 py-2 text-left text-[15px] font-bold text-accent"
                >
                  ← Todas las personas · {personaActiva.nombre}
                </button>
              )}
              {visibles.map((s) => (
                <div key={s.clave}>
                  <p className="border-b-2 border-ink/15 bg-surface px-3 py-1.5 text-[13px] font-black uppercase tracking-wider text-ink-muted">
                    {s.label} · {s.items.length}
                  </p>
                  {s.items.length === 0 ? (
                    <p className="px-3 py-3 text-[15px] text-ink-muted">
                      {s.clave === "por_hacer" ? "Nada por hacer. ¡Al día! ★" : "Nada en curso."}
                    </p>
                  ) : s.items.map(fila)}
                </div>
              ))}

              {/* Historial de las hechas: plegado, al final. */}
              {monton == null && hechas.length > 0 && (
                <button
                  type="button"
                  onClick={() => setVerHechas((v) => !v)}
                  className="flex w-full items-center gap-2 border-y-2 border-ink/15 bg-surface px-3 py-2.5 text-left text-[15px] font-extrabold text-ink"
                >
                  <span className="flex-1">★ Historial de hechas · {hechas.length}</span>
                  <span aria-hidden>{verHechas ? "▲" : "▼"}</span>
                </button>
              )}
              {monton === "hechas" && (
                <p className="border-b-2 border-ink/15 bg-surface px-3 py-1.5 text-[13px] font-black uppercase tracking-wider text-ink-muted">
                  Hechas · {hechas.length}
                </p>
              )}
              {mostrarHechas && (hechas.length === 0
                ? <p className="px-3 py-3 text-[15px] text-ink-muted">Todavía no hay hechas.</p>
                : hechas.map(fila))}
            </>
          )}
        </div>
        {totalNoLeidos > 0 && (
          <div className="border-t-2 border-ink px-3 py-1.5 text-center text-[14px] font-bold text-ink">
            {totalNoLeidos} mensaje{totalNoLeidos === 1 ? "" : "s"} sin leer
          </div>
        )}
      </div>

      <div className={`min-w-0 flex-1 min-h-0 flex-col ${selectedId != null ? "flex" : "hidden lg:flex"}`}>
        {selectedId != null ? (
          <HiloConversacion
            key={selectedId}
            ticketId={selectedId}
            token={token}
            user={user}
            enLineaIds={enLineaIds}
            onCerrar={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[16px] text-ink-muted">
            Toca una solicitud para verla
          </div>
        )}
      </div>
    </div>
  );
}
