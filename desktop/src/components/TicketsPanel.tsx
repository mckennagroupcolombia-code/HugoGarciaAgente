import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";
import { useQuestTheme } from "../stores/questTheme";
import QuestThemeToggle from "./QuestThemeToggle";
import { QuestBoardTitle, QuestBoardNavLabel, QuestBoardBackLabel } from "./QuestBoardTitle";
import { useQuestBoardTitle } from "../stores/questBoard";
import {
  QuestBoardStickyCanvas,
  QuestBoardStickyFrame,
  useBoardCanvasWidth,
} from "./QuestBoardStickyFrame";
import { useQuestBoardLayout, BOARD_ROOT_SECTION } from "../stores/questBoardLayout";
import { Icon, TopicIcon, TopicIconLabel, TOPIC_ICON_PRESETS } from "../icons";
import RecetasPanel from "./RecetasPanel";
import { CorridaCronometroBlock, fmtTiempo } from "./Cronometro";
import {
  InventarioCarritoBadge,
  InventarioCarritoModal,
  InventarioCarritoNavBtn,
} from "./InventarioCarrito";
import MaterialCalculadora from "./MaterialCalculadora";
import { useInventarioCarrito } from "../stores/inventarioCarrito";
import {
  ESTADO_STYLES,
  PRIORIDAD_STYLES,
  CATEGORIA_FALLBACK,
  TIPO_MATERIAL_BADGE,
  ALERT_ERROR,
  ALERT_ERROR_SM,
  QUEST_STAT_ITEMS,
  ESTADO_DOT_COLOR,
  PRIORIDAD_DOT,
  QUEST_MISION_CHROME,
  questTone,
  stickyRotation,
  stickyPaperBackground,
  questNavBtn,
} from "../lib/questStyles";

// ── API helper ────────────────────────────────────────────────────────────────

function tapi(path: string, token: string, options: RequestInit = {}) {
  const isForm = options.body instanceof FormData;
  const hasJsonBody = options.body != null && options.body !== "" && !isForm;
  return fetch(`/api/tickets${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  }).then(async (r) => {
    let data: any;
    try {
      data = await r.json();
    } catch {
      if (!r.ok) {
        throw new Error(
          r.status === 405
            ? "Acción no disponible: reinicia agente-pro o actualiza el panel."
            : `Error ${r.status}`,
        );
      }
      return {};
    }
    if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
    return data;
  });
}

function ticketsUploadUrl(filename: string, token: string) {
  return `/api/tickets/uploads/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
}

function UserAvatar({
  user,
  token,
  size = "md",
}: {
  user: TicketsUser;
  token: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "sm" ? "h-9 w-9 text-sm" : size === "lg" ? "h-20 w-20 text-2xl" : "h-14 w-14 text-xl";
  if (user.foto) {
    return (
      <img
        src={ticketsUploadUrl(user.foto, token)}
        alt={user.nombre}
        className={`${dims} rounded-full border-2 border-white object-cover shadow`}
      />
    );
  }
  return (
    <div
      className={`flex ${dims} items-center justify-center rounded-full border-2 border-white font-black text-white shadow`}
      style={{ background: user.departamento?.color || "#0c6069" }}
    >
      {user.nombre.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ticket {
  id: number;
  numero: string;
  titulo: string;
  categoria: "rrhh" | "logistica" | "mantenimiento";
  descripcion: string;
  estado: "pendiente" | "en_proceso" | "esperando_aprobacion" | "resuelto" | "rechazado";
  prioridad: "baja" | "media" | "alta" | "urgente";
  creado_por: number;
  creado_por_nombre?: string;
  creado_por_info?: { id: number; nombre: string } | null;
  asignado_a: number | null;
  asignado_a_nombre?: string | null;
  asignado_a_info?: { id: number; nombre: string } | null;
  soporte_archivo: string | null;
  creado_en: string;
  actualizado_en: string;
  resuelto_en: string | null;
  mision_id?: number | null;
  etapa_id?: number | null;
  bloqueado_por?: number | null;
  bloqueado_por_numero?: string | null;
  mision_titulo?: string | null;
  mision_color?: string | null;
  mision_tipo?: string | null;
  mision_reino?: string | null;
  mision_zona_id?: number | null;
  mision_info?: { id: number; titulo: string; tipo: string; color: string; total_etapas: number; etapas_completadas: number } | null;
  etapa_info?: { id: number; orden: number } | null;
  participantes?: Participante[];
  comentarios?: Comentario[];
  tiempo_registrado?: TiempoEntry[];
  total_horas?: number;
  segundos_trabajo?: number;
  corrida?: TicketCorrida | null;
  historial?: LogEntry[];
  frecuencia?: Frecuencia | null;
  proxima_renovacion?: string | null;
  pasos_total?: number;
  pasos_completados?: number;
  tipo?: "ticket" | "accion";
}

interface TicketCorrida {
  id: number;
  ticket_id: number;
  estado: "activa" | "pausada" | "finalizada";
  segundos_transcurridos: number;
  segundos_acumulados: number;
  iniciada_en: string;
  finalizada_en?: string | null;
}

interface Participante {
  ticket_id: number;
  usuario_id: number;
  usuario_nombre: string;
  rol: "colaborador" | "revisor" | "observador";
  agregado_en: string;
}

interface EtapaMision {
  id: number;
  mision_id: number;
  orden: number;
  titulo: string;
  descripcion: string;
  ticket_id: number | null;
  ticket_numero?: string | null;
  ticket_estado?: string | null;
  asignado_a?: number | null;
  asignado_nombre?: string | null;
  ticket_bloqueado_por?: number | null;
  bloqueado_por_numero?: string | null;
  ticket_segundos?: number;
  ticket_horas?: number;
  ticket_frecuencia?: Frecuencia | null;
  ticket_proxima_renovacion?: string | null;
  ticket_pasos_total?: number;
  ticket_pasos_completados?: number;
  estado: "pendiente" | "activa" | "completada";
}

function etapaEjecucionPct(et: EtapaMision): number {
  const total = et.ticket_pasos_total ?? 0;
  const ok = et.ticket_pasos_completados ?? 0;
  if (total > 0) return Math.round((ok / total) * 100);
  if (et.ticket_estado === "resuelto") return 100;
  return 0;
}

type Frecuencia =
  | "diaria"
  | "cada_2_dias"
  | "cada_3_dias"
  | "semanal"
  | "quincenal"
  | "mensual"
  | "bimestral"
  | "trimestral"
  | "semestral";

/** finita = un ciclo y puede completarse; infinita = se repite (renovar / nuevos ciclos). */
type ModoCicloMision = "finita" | "infinita";

const MODO_CICLO_OPTS: { value: ModoCicloMision; label: string; hint: string }[] = [
  {
    value: "finita",
    label: "📌 Finita",
    hint: "Un solo ciclo: al resolver todos los tickets la misión se completa.",
  },
  {
    value: "infinita",
    label: "♾️ Infinita",
    hint: "Se repite: puedes renovar tickets y agregar más; no se cierra sola.",
  },
];

type PrerequisitoTipo = "mision" | "receta";

interface Dependencia {
  id: number;
  titulo: string;
  estado: string;
  reino: string | null;
  tipo?: PrerequisitoTipo;
  categoria?: string | null;
}

interface PrerequisitoRef {
  tipo: PrerequisitoTipo;
  id: number;
}

interface RecetaPrereq {
  id: number;
  titulo: string;
  categoria?: string;
  reino_nombre?: string | null;
}

function prereqKey(p: PrerequisitoRef) {
  return `${p.tipo}:${p.id}`;
}

function prereqAccordionStorageKey(misionId?: number) {
  return `mckenna-prereq-accordion:${misionId ?? "nueva"}`;
}

function loadPrereqOpenGrupos(misionId?: number): Set<string> {
  try {
    const raw = sessionStorage.getItem(prereqAccordionStorageKey(misionId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function savePrereqOpenGrupos(misionId: number | undefined, open: Set<string>) {
  try {
    sessionStorage.setItem(
      prereqAccordionStorageKey(misionId),
      JSON.stringify([...open]),
    );
  } catch {
    /* quota / modo privado */
  }
}

function coincideBusquedaPrereq(q: string, ...partes: (string | null | undefined)[]) {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return partes.some((p) => (p || "").toLowerCase().includes(n));
}

function estadoPrereqBadge(estado: string, tipo?: PrerequisitoTipo) {
  if (estado === "completada") return "bg-green-100 text-green-700";
  if (estado === "cancelada") return "bg-red-100 text-red-600";
  if (tipo === "receta" && estado === "pendiente") return "bg-amber-100 text-amber-800";
  return "bg-blue-100 text-blue-700";
}

function estadoPrereqLabel(estado: string, tipo?: PrerequisitoTipo) {
  if (tipo === "receta") {
    return estado === "completada" ? "elaborada" : "sin elaborar";
  }
  return estado;
}

function PrerequisitosBlock({
  titulo = "Prerequisitos (opcional)",
  descripcion = "Misiones completadas o recetas ya elaboradas antes de iniciar esta misión.",
  readonly = false,
  items,
  onItemsChange,
  dependenciasDisplay,
  misionId,
  token,
  todasMisiones,
  todasRecetas,
  onMisionUpdated,
}: {
  titulo?: string;
  descripcion?: string;
  readonly?: boolean;
  items: PrerequisitoRef[];
  onItemsChange?: (items: PrerequisitoRef[]) => void;
  dependenciasDisplay?: Dependencia[];
  misionId?: number;
  token?: string;
  todasMisiones: Mision[];
  todasRecetas: RecetaPrereq[];
  onMisionUpdated?: (m: Mision) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [adding, setAdding] = useState(false);
  const [openGrupos, setOpenGrupos] = useState(() => loadPrereqOpenGrupos(misionId));

  const setOpenGruposPersist = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setOpenGrupos((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        savePrereqOpenGrupos(misionId, next);
        return next;
      });
    },
    [misionId],
  );

  useEffect(() => {
    setOpenGrupos(loadPrereqOpenGrupos(misionId));
  }, [misionId]);

  const itemKeys = new Set(items.map(prereqKey));
  const depsFromItems: Dependencia[] = items.map((p) => {
    if (p.tipo === "receta") {
      const r = todasRecetas.find((x) => x.id === p.id);
      return {
        id: p.id,
        tipo: "receta",
        titulo: r?.titulo ?? `Receta #${p.id}`,
        estado: "pendiente",
        reino: r?.reino_nombre ?? null,
        categoria: r?.categoria,
      };
    }
    const m = todasMisiones.find((x) => x.id === p.id);
    return {
      id: p.id,
      tipo: "mision",
      titulo: m?.titulo ?? `Misión #${p.id}`,
      estado: m?.estado ?? "activa",
      reino: m?.reino ?? null,
    };
  });
  const listDisplay = dependenciasDisplay ?? depsFromItems;

  const opcionesMision = useMemo(
    () => todasMisiones.filter(
      (m) => misionId !== m.id && !itemKeys.has(prereqKey({ tipo: "mision", id: m.id })),
    ),
    [todasMisiones, misionId, items],
  );
  const opcionesReceta = useMemo(
    () => todasRecetas.filter(
      (r) => !itemKeys.has(prereqKey({ tipo: "receta", id: r.id })),
    ),
    [todasRecetas, items],
  );
  const hayOpciones = opcionesMision.length > 0 || opcionesReceta.length > 0;

  const opcionesFlat = useMemo(() => {
    const out: {
      key: string;
      ref: PrerequisitoRef;
      icono: string;
      label: string;
      sub: string;
      estado: string;
    }[] = [];
    for (const m of opcionesMision) {
      out.push({
        key: prereqKey({ tipo: "mision", id: m.id }),
        ref: { tipo: "mision", id: m.id },
        icono: "🎯",
        label: m.titulo,
        sub: [m.reino, m.estado].filter(Boolean).join(" · "),
        estado: m.estado,
      });
    }
    for (const r of opcionesReceta) {
      out.push({
        key: prereqKey({ tipo: "receta", id: r.id }),
        ref: { tipo: "receta", id: r.id },
        icono: "📖",
        label: r.titulo,
        sub: [r.reino_nombre, r.categoria].filter(Boolean).join(" · "),
        estado: "receta",
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [opcionesMision, opcionesReceta]);

  const opcionesFiltradas = useMemo(() => {
    return opcionesFlat.filter((o) =>
      coincideBusquedaPrereq(busqueda, o.label, o.sub),
    );
  }, [opcionesFlat, busqueda]);

  const opcionesMisionFiltradas = useMemo(
    () => opcionesFiltradas.filter((o) => o.ref.tipo === "mision"),
    [opcionesFiltradas],
  );
  const opcionesRecetaFiltradas = useMemo(
    () => opcionesFiltradas.filter((o) => o.ref.tipo === "receta"),
    [opcionesFiltradas],
  );

  function toggleGrupoPrereq(key: string) {
    setOpenGruposPersist((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderOpcionPrereq(o: (typeof opcionesFlat)[number]) {
    return (
      <button
        key={o.key}
        type="button"
        disabled={adding}
        onClick={() => agregarRef(o.ref)}
        className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-accent/10 disabled:opacity-50"
      >
        <TopicIcon value={o.icono} size={18} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink truncate">{o.label}</p>
          {o.sub && <p className="text-xs text-muted truncate">{o.sub}</p>}
        </div>
        <span className="shrink-0 text-[10px] font-bold uppercase text-accent">+ Agregar</span>
      </button>
    );
  }

  function renderGrupoAgregarPrereq(
    grupoKey: string,
    tituloGrupo: ReactNode,
    subtitulo: string,
    opciones: typeof opcionesFlat,
    totalDisponibles: number,
  ) {
    if (totalDisponibles === 0) return null;
    const abierto = openGrupos.has(grupoKey);
    return (
      <div
        className={`quest-inventario-grupo quest-inventario-grupo--zona ${abierto ? "quest-inventario-grupo--open" : ""}`}
        style={{ "--inv-accent": grupoKey === "prereq-recetas" ? "#d97706" : "#0c6069" } as CSSProperties}
      >
        <button
          type="button"
          onClick={() => toggleGrupoPrereq(grupoKey)}
          className="quest-inventario-grupo-header w-full text-left"
          aria-expanded={abierto}
        >
          <span className={`quest-inventario-grupo-chevron ${abierto ? "quest-inventario-grupo-chevron--open" : ""}`} aria-hidden>
            ▼
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-xs font-extrabold text-ink">{tituloGrupo}</h4>
            <p className="truncate text-[10px] text-muted">{subtitulo}</p>
          </div>
          <span className="quest-inventario-grupo-count shrink-0 tabular-nums">
            {busqueda.trim() ? `${opciones.length}/${totalDisponibles}` : totalDisponibles}
          </span>
        </button>
        {abierto && (
          <div className="quest-inventario-grupo-items p-0">
            {opciones.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-muted">
                {busqueda.trim() ? "Sin resultados con ese filtro" : "No hay más opciones"}
              </p>
            ) : (
              opciones.map(renderOpcionPrereq)
            )}
          </div>
        )}
      </div>
    );
  }

  async function agregarRef(ref: PrerequisitoRef) {
    if (itemKeys.has(prereqKey(ref))) return;

    if (misionId && token && onMisionUpdated) {
      setAdding(true);
      try {
        const updated = await tapi(`/misiones/${misionId}/dependencias`, token, {
          method: "POST",
          body: JSON.stringify({ tipo: ref.tipo, referencia_id: ref.id }),
        });
        onMisionUpdated(updated);
        setBusqueda("");
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : "Error al agregar");
      } finally {
        setAdding(false);
      }
      return;
    }
    onItemsChange?.([...items, ref]);
    setBusqueda("");
  }

  async function quitar(dep: PrerequisitoRef) {
    if (misionId && token && onMisionUpdated) {
      try {
        const updated = await tapi(
          `/misiones/${misionId}/dependencias/${dep.tipo}/${dep.id}`,
          token,
          { method: "DELETE" },
        );
        onMisionUpdated(updated);
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : "Error al quitar");
      }
      return;
    }
    onItemsChange?.(items.filter((p) => prereqKey(p) !== prereqKey(dep)));
  }

  return (
    <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-3">
      <div>
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">{titulo}</h3>
        <p className="mt-1 text-xs text-muted">{descripcion}</p>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted">Sin prerequisitos — esta misión puede iniciarse en cualquier momento.</p>
      ) : (
        <div
          className={`quest-inventario-grupo ${openGrupos.has("vinculados") ? "quest-inventario-grupo--open" : ""}`}
          style={{ "--inv-accent": "#6366f1" } as CSSProperties}
        >
          <button
            type="button"
            onClick={() => toggleGrupoPrereq("vinculados")}
            className="quest-inventario-grupo-header w-full text-left"
            aria-expanded={openGrupos.has("vinculados")}
          >
            <span
              className={`quest-inventario-grupo-chevron ${openGrupos.has("vinculados") ? "quest-inventario-grupo-chevron--open" : ""}`}
              aria-hidden
            >
              ▼
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-xs font-extrabold text-ink">Vinculados</h4>
              <p className="truncate text-[10px] text-muted">Deben cumplirse antes de iniciar</p>
            </div>
            <span className="quest-inventario-grupo-count shrink-0 tabular-nums">{listDisplay.length}</span>
          </button>
          {openGrupos.has("vinculados") && (
            <div className="quest-inventario-grupo-items space-y-1.5">
              {listDisplay.map((dep) => (
                <div
                  key={`${dep.tipo ?? "mision"}-${dep.id}`}
                  className="flex items-center gap-2 rounded-paper border border-border bg-surface px-3 py-2"
                >
                  <TopicIcon value={dep.tipo === "receta" ? "📖" : "🎯"} size={16} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{dep.titulo}</p>
                    <p className="text-xs text-muted truncate">
                      {dep.tipo === "receta"
                        ? `Receta${dep.categoria ? ` · ${dep.categoria}` : ""}`
                        : dep.reino || "Misión"}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${estadoPrereqBadge(dep.estado, dep.tipo)}`}
                  >
                    {estadoPrereqLabel(dep.estado, dep.tipo)}
                  </span>
                  {!readonly && (
                    <button
                      type="button"
                      onClick={() => quitar({ tipo: dep.tipo ?? "mision", id: dep.id })}
                      className="text-muted hover:text-danger transition text-xs px-1 shrink-0"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!readonly && hayOpciones && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Agregar prerequisito</p>
            {(opcionesMision.length > 0 || opcionesReceta.length > 0) && (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const open = new Set<string>();
                    if (items.length > 0) open.add("vinculados");
                    if (opcionesMision.length > 0) open.add("prereq-misiones");
                    if (opcionesReceta.length > 0) open.add("prereq-recetas");
                    setOpenGruposPersist(open);
                  }}
                  className="rounded-paper border border-border px-2 py-0.5 text-[10px] font-bold text-muted hover:border-accent hover:text-accent"
                >
                  Expandir
                </button>
                <button
                  type="button"
                  onClick={() => setOpenGruposPersist(new Set())}
                  className="rounded-paper border border-border px-2 py-0.5 text-[10px] font-bold text-muted hover:border-accent hover:text-accent"
                >
                  Colapsar
                </button>
              </div>
            )}
          </div>
          <div className="relative">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar misión o receta por nombre, reino…"
              disabled={adding}
              className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 pr-9 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
              autoComplete="off"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-xs px-1"
                aria-label="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>
          <div className="space-y-2">
            {renderGrupoAgregarPrereq(
              "prereq-misiones",
            <TopicIconLabel value="🎯" size={14} weight="bold">
              Misiones
            </TopicIconLabel>,
              "Completar misión antes de iniciar",
              opcionesMisionFiltradas,
              opcionesMision.length,
            )}
            {renderGrupoAgregarPrereq(
              "prereq-recetas",
              <TopicIconLabel value="📖" size={14} weight="bold">
                Recetas
              </TopicIconLabel>,
              "Receta elaborada previamente",
              opcionesRecetaFiltradas,
              opcionesReceta.length,
            )}
          </div>
          {busqueda.trim() && opcionesFiltradas.length === 0 && (
            <p className="text-center text-xs text-muted">Sin resultados — prueba otro nombre</p>
          )}
          <p className="text-[10px] text-muted">
            {opcionesFiltradas.length} de {opcionesFlat.length} disponible{opcionesFlat.length !== 1 ? "s" : ""}
            {busqueda.trim() ? ` · «${busqueda.trim()}»` : ""}
          </p>
        </div>
      )}
      {items.length > 0 && (
        <p className="text-xs font-semibold text-accent">
          {items.length} prerequisito{items.length > 1 ? "s" : ""} vinculado{items.length > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

interface Mision {
  id: number;
  titulo: string;
  descripcion: string;
  reino: string;
  zona_id?: number | null;
  reino_id?: number | null;
  reino_nombre?: string | null;
  zona_nombre?: string | null;
  subzona_nombre?: string | null;
  departamento_nombre?: string | null;
  departamento_id?: number | null;
  ubicacion_label?: string | null;
  ubicacion_color?: string | null;
  zona_color?: string | null;
  color: string;
  tipo: "secuencial" | "paralelo";
  categoria: string;
  estado: "borrador" | "activa" | "completada" | "cancelada";
  total_etapas: number;
  etapas_completadas: number;
  creado_por: number;
  creado_por_nombre?: string;
  creado_por_info?: { id: number; nombre: string } | null;
  creado_en: string;
  completada_en: string | null;
  frecuencia?: Frecuencia | null;
  proxima_renovacion?: string | null;
  modo_ciclo?: ModoCicloMision | null;
  etapas?: EtapaMision[];
  dependencias?: Dependencia[];
  producto_resultante_id?: number | null;
  producto_resultante?: { id: number; nombre: string; unidad: string; stock_actual: number } | null;
  corrida?: MisionCorrida | null;
  total_segundos_mision?: number;
  total_horas_mision?: number;
  /** Tickets de etapas con pasos_total (GET /misiones/?tablero=1). */
  tickets_tablero?: TicketTableroResumen[];
}

/** Ticket embebido en listado de misiones para el tablero. */
interface TicketTableroResumen {
  id: number;
  numero: string;
  titulo: string;
  estado: Ticket["estado"];
  prioridad?: Ticket["prioridad"];
  categoria?: string;
  asignado_a?: number | null;
  asignado_a_nombre?: string | null;
  bloqueado_por?: number | null;
  bloqueado_por_numero?: string | null;
  mision_id: number;
  etapa_id?: number | null;
  mision_titulo?: string;
  mision_color?: string;
  mision_tipo?: string;
  mision_reino?: string | null;
  mision_zona_id?: number | null;
  etapa_orden?: number;
  pasos_total?: number;
  pasos_completados?: number;
}

interface MisionCorrida {
  id: number;
  mision_id: number;
  estado: "activa" | "pausada" | "finalizada";
  segundos_transcurridos: number;
  segundos_acumulados: number;
  iniciada_en: string;
  finalizada_en?: string | null;
}

interface Comentario {
  id: number;
  texto: string;
  es_interno: number;
  autor_nombre: string;
  creado_en: string;
}

interface TiempoEntry {
  id: number;
  horas: number;
  notas: string;
  autor_nombre: string;
  creado_en: string;
}

interface LogEntry {
  id: number;
  accion: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  detalles: string | null;
  usuario_nombre: string | null;
  creado_en: string;
}

interface Categoria {
  id: number;
  slug: string;
  nombre: string;
  color: string;
  icono: string;
  activo: number;
}

interface UserInfo {
  id: number;
  nombre: string;
  username: string;
  email?: string | null;
  activo: number;
  rol: { id: number; nombre: string; nivel: number } | null;
  departamento: { id: number; nombre: string; color: string } | null;
  departamentos: { id: number; nombre: string; color: string }[];
}

const CategoriasCtx = createContext<{ cats: Categoria[]; reload: () => void }>({
  cats: [],
  reload: () => {},
});

interface Rol {
  id: number;
  nombre: string;
  nivel: number;
  descripcion: string;
}

interface Dept {
  id: number;
  nombre: string;
  descripcion: string;
  color: string;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

const ESTADO_LABEL: Record<string, string> = {
  pendiente:             "Pendiente",
  en_proceso:            "En Proceso",
  esperando_aprobacion:  "Esperando Aprobación",
  resuelto:              "Resuelto",
  rechazado:             "Rechazado",
};

const FRECUENCIA_LABEL: Record<string, string> = {
  diaria:      "♻️ Diaria",
  cada_2_dias: "♻️ Cada 2 días",
  cada_3_dias: "♻️ Cada 3 días",
  semanal:     "♻️ Semanal",
  quincenal:   "♻️ Quincenal",
  mensual:     "♻️ Mensual",
  bimestral:   "♻️ Bimestral",
  trimestral:  "♻️ Trimestral",
  semestral:   "♻️ Semestral",
};

function SelectFrecuencia({
  value,
  onChange,
  className = "w-full rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sin repetición</option>
      <option value="diaria">♻️ Diaria</option>
      <option value="cada_2_dias">♻️ Cada 2 días</option>
      <option value="cada_3_dias">♻️ Cada 3 días</option>
      <option value="semanal">♻️ Semanal</option>
      <option value="quincenal">♻️ Quincenal</option>
      <option value="mensual">♻️ Mensual</option>
      <option value="bimestral">♻️ Bimestral</option>
      <option value="trimestral">♻️ Trimestral</option>
      <option value="semestral">♻️ Semestral</option>
    </select>
  );
}

function TicketRecurrenciaById({
  ticketId,
  token,
  canEdit,
  onRefresh,
}: {
  ticketId: number;
  token: string;
  canEdit: boolean;
  onRefresh?: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  useEffect(() => {
    tapi(`/${ticketId}`, token).then(setTicket).catch(() => setTicket(null));
  }, [ticketId, token]);
  if (!ticket) return null;
  return (
    <TicketRecurrenciaSection
      ticket={ticket}
      token={token}
      canEdit={canEdit}
      onTicket={(t) => {
        setTicket(t);
        onRefresh?.();
      }}
    />
  );
}

function TicketRecurrenciaSection({
  ticket,
  token,
  onTicket,
  canEdit,
}: {
  ticket: Ticket;
  token: string;
  onTicket: (t: Ticket) => void;
  canEdit: boolean;
}) {
  const [freq, setFreq] = useState(ticket.frecuencia || "");
  const [saving, setSaving] = useState(false);
  const [renewing, setRenewing] = useState(false);

  useEffect(() => {
    setFreq(ticket.frecuencia || "");
  }, [ticket.id, ticket.frecuencia]);

  async function saveFreq() {
    setSaving(true);
    try {
      const updated = await tapi(`/${ticket.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ frecuencia: freq || null }),
      });
      onTicket(updated);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function renovar() {
    if (!confirm(`¿Renovar el ticket ${ticket.numero}?\n\nSe desmarcarán los pasos y quedará listo para un nuevo ciclo.`)) return;
    setRenewing(true);
    try {
      const updated = await tapi(`/${ticket.id}/renovar`, token, { method: "POST" });
      onTicket(updated);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al renovar");
    } finally {
      setRenewing(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/50 p-4 space-y-3 dark:border-emerald-800 dark:bg-emerald-950/30">
      <p className="text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
        ♻️ Recurrencia del ticket
      </p>
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <SelectFrecuencia value={freq} onChange={setFreq} />
          </div>
          <button
            type="button"
            disabled={saving || freq === (ticket.frecuencia || "")}
            onClick={saveFreq}
            className="rounded-paper border-2 border-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-500 hover:text-white transition disabled:opacity-50"
          >
            {saving ? "..." : "Guardar"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink">
          {ticket.frecuencia ? (FRECUENCIA_LABEL[ticket.frecuencia] ?? ticket.frecuencia) : "Sin repetición"}
        </p>
      )}
      {ticket.frecuencia && ticket.proxima_renovacion && ticket.estado === "resuelto" && (
        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          ⏰ Próxima renovación automática: {fmtFecha(ticket.proxima_renovacion)}
        </p>
      )}
      {canEdit && ticket.estado === "resuelto" && (
        <button
          type="button"
          disabled={renewing}
          onClick={renovar}
          className="rounded-paper border-2 border-emerald-400 px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-500 hover:border-emerald-500 hover:text-white transition disabled:opacity-50"
        >
          {renewing ? "Renovando..." : "♻️ Renovar ticket"}
        </button>
      )}
    </div>
  );
}

function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

const LOG_LABELS: Record<string, string> = {
  ticket_creado:       "Ticket creado",
  estado_cambiado:     "Estado cambiado",
  asignado:            "Asignado",
  comentario_agregado: "Comentario añadido",
  tiempo_registrado:   "Tiempo registrado",
  archivo_subido:      "Archivo subido",
  aprobado:            "Aprobado",
  rechazado:           "Rechazado",
};

function EstadoBadge({ estado }: { estado: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ESTADO_STYLES[estado] || "bg-gray-100 text-gray-600 border-gray-300 dark:bg-ink/30 dark:text-muted dark:border-border"}`}>
      {ESTADO_LABEL[estado] || estado}
    </span>
  );
}

function CategoriaBadge({ cat }: { cat: string }) {
  const { cats } = useContext(CategoriasCtx);
  const info = cats.find((c) => c.slug === cat);
  if (info) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
        style={{ background: info.color + "22", color: info.color }}>
        <TopicIcon value={info.icono} size={14} className="shrink-0" />
        {info.nombre}
      </span>
    );
  }
  const fb = CATEGORIA_FALLBACK[cat];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${fb?.cls ?? "bg-gray-100 text-gray-600 dark:bg-ink/30 dark:text-muted"}`}>
      {fb?.label ?? cat}
    </span>
  );
}

function PrioridadBadge({ p }: { p: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${PRIORIDAD_STYLES[p] || "bg-gray-100 text-gray-600 dark:bg-ink/30 dark:text-muted"}`}>
      {p}
    </span>
  );
}

// ── Daily Quest helpers ───────────────────────────────────────────────────────

function StatusOrb({ estado }: { estado: string }) {
  const dark = useQuestTheme((s) => s.dark);
  const pair = ESTADO_DOT_COLOR[estado as keyof typeof ESTADO_DOT_COLOR] ?? ESTADO_DOT_COLOR.pendiente;
  const col = questTone(pair.light, pair.dark, dark);
  return (
    <span className="quest-status-orb inline-flex h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-offset-1 ring-gray-200 dark:ring-border dark:ring-offset-surface-panel"
      style={{ background: col }} />
  );
}

function PrioridadDot({ p }: { p: string }) {
  const d = PRIORIDAD_DOT[p] ?? PRIORIDAD_DOT.media;
  return <span className={`text-[10px] font-extrabold leading-none ${d.cls} shrink-0`}>{d.sym}</span>;
}

/** Convert fractional hours to "Xh Ym Zs" with the right precision */
function fmtHoras(h: number): string {
  const totalSecs = Math.round(h * 3600);
  if (totalSecs < 1) return "0s";
  const hh = Math.floor(totalSecs / 3600);
  const mm = Math.floor((totalSecs % 3600) / 60);
  const ss = totalSecs % 60;
  if (hh > 0) return `${hh}h ${mm}m`;
  if (mm > 0) return `${mm}m ${ss}s`;
  return `${ss}s`;
}

function fmtDate(s: string) {
  if (!s) return "—";
  try {
    return new Date(s + (s.includes("T") ? "Z" : "")).toLocaleString("es-CO", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return s; }
}

// ── Sub-views ─────────────────────────────────────────────────────────────────

/** Tabs que un usuario puede ver dentro del Centro de Mando.
 *  Admin (nivel >= 3) ve siempre todo.
 *  Sin permisos configurados (null) → solo acciones.
 *  Con permisos → respeta la clave tickets_<tab>. */
function puedeVerTab(
  permisos: Record<string, boolean> | null | undefined,
  nivel: number,
  tab: string,
): boolean {
  if (nivel >= 3) return true;
  if (!permisos) return tab === "acciones";
  return Boolean(permisos[`tickets_${tab}`]);
}

type View =
  | "list"
  | "acciones"
  | "create"
  | "detail"
  | "admin"
  | "workload"
  | "crear_mision"
  | "mision_detail"
  | "inventario"
  | "reinos"
  | "perfil"
  | "recetas";

interface ZonaTrabajo {
  id: number;
  nombre: string;
  parent_id?: number | null;
  parent_nombre?: string | null;
  tipo?: CrearZonaTipo | string | null;
  color?: string;
  icono?: string;
  orden?: number;
  activo?: number;
}

/** Paleta para distinguir zonas cuando aún no tienen color propio. */
const ZONA_COLOR_PALETTE = [
  "#0c6069", "#2563eb", "#7c3aed", "#db2777", "#ea580c",
  "#16a34a", "#0d9488", "#ca8a04", "#dc2626", "#4f46e5",
  "#0891b2", "#65a30d", "#c026d3", "#f59e0b",
];

function zonaColor(z: ZonaTrabajo | undefined | null, fallbackId = 0): string {
  if (!z) return ZONA_COLOR_PALETTE[Math.abs(fallbackId) % ZONA_COLOR_PALETTE.length];
  const c = (z.color || "").trim();
  return c || ZONA_COLOR_PALETTE[z.id % ZONA_COLOR_PALETTE.length];
}

function zonaById(zonas: ZonaTrabajo[], id: number | null | undefined): ZonaTrabajo | undefined {
  if (id == null) return undefined;
  return zonas.find((x) => x.id === id);
}

function colorPorDefectoNuevaZona(
  zonas: ZonaTrabajo[],
  parentId: number | "",
  tipo: CrearZonaTipo,
): string {
  const hermanos = zonas.filter((z) =>
    tipo === "reino" ? !z.parent_id : z.parent_id === parentId,
  );
  return ZONA_COLOR_PALETTE[hermanos.length % ZONA_COLOR_PALETTE.length];
}

function ZonaColorDot({
  color,
  size = "md",
  title,
}: {
  color: string;
  size?: "sm" | "md";
  title?: string;
}) {
  const dim = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  return (
    <span
      title={title}
      className={`${dim} shrink-0 rounded-full border-2 border-white shadow-sm ring-1 ring-black/10`}
      style={{ background: color }}
    />
  );
}

interface TableroReinoSection {
  key: string;
  reinoId: number | null;
  nombre: string;
  color: string;
  icono: string | null;
  groups: MisionGroup[];
  standalone: Ticket[];
}

function reinoNombreKey(nombre: string): string {
  return nombre.trim().toLowerCase() || "__sin_reino__";
}

/** Empareja texto libre de misión con nombre de reino del catálogo. */
function reinoCoincideCatalogo(misionReino: string, catalogNombre: string): boolean {
  const a = reinoNombreKey(misionReino);
  const b = reinoNombreKey(catalogNombre);
  if (a === "__sin_reino__" || b === "__sin_reino__") return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function buildTableroReinoSections(
  misionGroups: Map<number, MisionGroup>,
  standalone: Ticket[],
  reinosCatalog: ZonaTrabajo[],
  navScope: NavScope,
): TableroReinoSection[] {
  const buckets = new Map<string, { label: string; groups: MisionGroup[]; standalone: Ticket[] }>();

  const bucketFor = (raw: string | null | undefined) => {
    const label = (raw || "").trim() || "Sin reino asignado";
    const key = reinoNombreKey(label);
    if (!buckets.has(key)) buckets.set(key, { label, groups: [], standalone: [] });
    return buckets.get(key)!;
  };

  for (const g of misionGroups.values()) {
    const eg = enrichMisionGroupUbicacion(g, reinosCatalog);
    if (eg.reino_id) {
      const key = `id:${eg.reino_id}`;
      const label = (eg.reino || eg.ubicacion_label || "").trim() || "Sin reino asignado";
      if (!buckets.has(key)) buckets.set(key, { label, groups: [], standalone: [] });
      buckets.get(key)!.groups.push(eg);
    } else {
      bucketFor(eg.reino).groups.push(eg);
    }
  }
  for (const t of standalone) bucketFor(t.mision_reino).standalone.push(t);

  const catalogReinos = reinosCatalog
    .filter((z) => !z.parent_id)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre, "es"));

  const sections: TableroReinoSection[] = [];
  const consumed = new Set<string>();

  for (const z of catalogReinos) {
    if (navScope.kind === "reino" && navScope.id !== z.id) continue;
    if (navScope.kind === "zona" || navScope.kind === "subzona") {
      if (!reinoCoincideCatalogo(navScope.reinoNombre, z.nombre)) continue;
    }

    let matched: { label: string; groups: MisionGroup[]; standalone: Ticket[] } | undefined;
    let matchedKey: string | null = null;
    const idKey = `id:${z.id}`;
    if (buckets.has(idKey)) {
      matched = buckets.get(idKey);
      matchedKey = idKey;
    } else {
      const exactKey = reinoNombreKey(z.nombre);
      if (buckets.has(exactKey)) {
        matched = buckets.get(exactKey);
        matchedKey = exactKey;
      } else {
        for (const [key, b] of buckets) {
          if (reinoCoincideCatalogo(b.label, z.nombre)) {
            matched = b;
            matchedKey = key;
            break;
          }
        }
      }
    }
    if (matchedKey) consumed.add(matchedKey);

    const groups = matched?.groups ?? [];
    const st = matched?.standalone ?? [];
    const has = groups.length > 0 || st.length > 0;
    if (!has && navScope.kind !== "reino") continue;

    sections.push({
      key: `reino-${z.id}`,
      reinoId: z.id,
      nombre: z.nombre,
      color: zonaColor(z, z.id),
      icono: z.icono || null,
      groups,
      standalone: st,
    });
  }

  for (const [key, b] of buckets) {
    if (consumed.has(key)) continue;
    if (navScope.kind === "reino") continue;
    if (b.groups.length === 0 && b.standalone.length === 0) continue;
    sections.push({
      key: `extra-${key}`,
      reinoId: null,
      nombre: b.label,
      color: "#6b7280",
      icono: null,
      groups: b.groups,
      standalone: b.standalone,
    });
  }

  return sections;
}

function groupTicketsFlatByReino(
  tickets: Ticket[],
  reinosCatalog: ZonaTrabajo[],
  navScope: NavScope,
): TableroReinoSection[] {
  const misionGroups = new Map<number, MisionGroup>();
  const standalone: Ticket[] = [];
  for (const t of tickets) {
    if (t.mision_id) {
      if (!misionGroups.has(t.mision_id)) {
        misionGroups.set(t.mision_id, {
          mision_id: t.mision_id,
          mision_titulo: t.mision_titulo || `Misión #${t.mision_id}`,
          mision_color: t.mision_color || "#0c6069",
          mision_tipo: t.mision_tipo || "secuencial",
          reino: t.mision_reino || null,
          zona_id: t.mision_zona_id ?? null,
          reino_id: t.mision_zona_id
            ? zonaRaizId(reinosCatalog, t.mision_zona_id)
            : null,
          tickets: [],
        });
      }
      misionGroups.get(t.mision_id)!.tickets.push(t);
    } else {
      standalone.push(t);
    }
  }
  return buildTableroReinoSections(misionGroups, standalone, reinosCatalog, navScope);
}

const QUEST_NAV_VIEWS: View[] = ["list", "detail", "create", "mision_detail", "crear_mision"];

type NavScope =
  | { kind: "all" }
  | { kind: "reino"; id: number; nombre: string; color: string }
  | { kind: "zona"; id: number; nombre: string; reinoNombre: string; color: string }
  | { kind: "subzona"; id: number; nombre: string; reinoNombre: string; zonaNombre: string; color: string }
  | {
    kind: "departamento";
    id: number;
    nombre: string;
    reinoNombre: string;
    zonaNombre: string;
    subzonaNombre: string;
    color: string;
  };

type ReinoNavNode = {
  reino: ZonaTrabajo;
  zonas: {
    zona: ZonaTrabajo;
    subzonas: { subzona: ZonaTrabajo; departamentos: ZonaTrabajo[] }[];
    /** Labores bajo la zona sin subzona (ej. Hogar Dulce Hogar: Cocina → Lavar platos). */
    departamentosDirectos: ZonaTrabajo[];
  }[];
};

function zonaProfundidad(z: ZonaTrabajo, zonas: ZonaTrabajo[]): number {
  const byId = new Map(zonas.map((x) => [x.id, x]));
  let d = 0;
  let cur: ZonaTrabajo | undefined = z;
  while (cur?.parent_id) {
    d += 1;
    cur = byId.get(cur.parent_id);
  }
  return d;
}

function buildReinoNavTree(zonas: ZonaTrabajo[]): ReinoNavNode[] {
  const reinos = zonas.filter((z) => !z.parent_id);
  return reinos.map((reino) => ({
    reino,
    zonas: zonas
      .filter((z) => z.parent_id === reino.id && nivelZona(z, zonas) === "zona")
      .map((zona) => {
        const hijos = zonas.filter((z) => z.parent_id === zona.id);
        return {
          zona,
          subzonas: hijos
            .filter((z) => nivelZona(z, zonas) === "subzona")
            .map((subzona) => ({
              subzona,
              departamentos: zonas.filter(
                (z) => z.parent_id === subzona.id && nivelZona(z, zonas) === "departamento",
              ),
            })),
          departamentosDirectos: hijos.filter((z) => nivelZona(z, zonas) === "departamento"),
        };
      }),
  }));
}

function reinoTreeNodeKey(nivel: "reino" | "zona" | "subzona", id: number): string {
  return `${nivel}-${id}`;
}

/** Nodos abiertos al cambiar filtro de navegación (reinos / tablero / inventario). */
function openNodesForNavScope(
  navScope: NavScope,
  arbol: ReinoNavNode[],
  zonas: ZonaTrabajo[],
): Set<string> {
  const open = new Set<string>();
  if (!arbol.length) return open;

  const findReinoForZona = (zonaId: number) =>
    arbol.find((n) => n.zonas.some((z) => z.zona.id === zonaId));

  if (navScope.kind === "reino") {
    open.add(reinoTreeNodeKey("reino", navScope.id));
  } else if (navScope.kind === "zona") {
    const nodo = findReinoForZona(navScope.id);
    if (nodo) {
      open.add(reinoTreeNodeKey("reino", nodo.reino.id));
      open.add(reinoTreeNodeKey("zona", navScope.id));
    }
  } else if (navScope.kind === "subzona" || navScope.kind === "departamento") {
    const zid = zonaIdDesdeNavScope(navScope, zonas);
    if (zid != null) {
      const nodo = findReinoForZona(zid);
      if (nodo) {
        open.add(reinoTreeNodeKey("reino", nodo.reino.id));
        open.add(reinoTreeNodeKey("zona", zid));
      }
    }
    if (navScope.kind === "subzona") open.add(reinoTreeNodeKey("subzona", navScope.id));
  } else if (arbol.length === 1) {
    open.add(reinoTreeNodeKey("reino", arbol[0].reino.id));
    if (arbol[0].zonas.length === 1) {
      open.add(reinoTreeNodeKey("zona", arbol[0].zonas[0].zona.id));
    }
  }
  return open;
}

function zonaIdsEnScope(zonas: ZonaTrabajo[], scope: NavScope): number[] | null {
  if (scope.kind === "all") return null;
  if (scope.kind === "reino") {
    const nodo = buildReinoNavTree(zonas).find((t) => t.reino.id === scope.id);
    if (!nodo) return [scope.id];
    const ids = [scope.id];
    for (const { zona, subzonas, departamentosDirectos } of nodo.zonas) {
      ids.push(zona.id, ...departamentosDirectos.map((d) => d.id));
      for (const { subzona, departamentos } of subzonas) {
        ids.push(subzona.id, ...departamentos.map((d) => d.id));
      }
    }
    return ids;
  }
  if (scope.kind === "zona") {
    const ids = [scope.id];
    for (const z of zonas.filter((z) => z.parent_id === scope.id)) {
      const niv = nivelZona(z, zonas);
      if (niv === "subzona") {
        ids.push(z.id, ...zonas.filter((d) => d.parent_id === z.id).map((d) => d.id));
      } else if (niv === "departamento") {
        ids.push(z.id);
      }
    }
    return ids;
  }
  if (scope.kind === "subzona") {
    return [scope.id, ...zonas.filter((z) => z.parent_id === scope.id).map((z) => z.id)];
  }
  return [scope.id];
}

function misionCoincideScope(reinoMision: string | null | undefined, scope: NavScope): boolean {
  if (scope.kind === "all") return true;
  const rn = (reinoMision || "").trim().toLowerCase();
  if (!rn) return false;
  if (scope.kind === "reino") return rn === scope.nombre.trim().toLowerCase();
  if (scope.kind === "zona") {
    const z = scope.nombre.trim().toLowerCase();
    const r = scope.reinoNombre.trim().toLowerCase();
    return rn === z || rn === r || rn.includes(z) || z.includes(rn);
  }
  const sub = scope.nombre.trim().toLowerCase();
  const zona = scope.zonaNombre.trim().toLowerCase();
  const reino = scope.reinoNombre.trim().toLowerCase();
  return rn === sub || rn.includes(sub) || rn === zona || rn === reino;
}

function QuestNavBar({
  view,
  nivel,
  permisos,
  bajoStockCount,
  userNombre,
  onTablero,
  onAcciones,
  onInventario,
  onReinos,
  onRecetas,
  onCarrito,
  carritoOpen,
  onWorkload,
  onPerfil,
  onCreateMision,
  onLogout,
}: {
  view: View;
  nivel: number;
  permisos: Record<string, boolean> | null | undefined;
  bajoStockCount: number;
  userNombre: string;
  onTablero: () => void;
  onAcciones: () => void;
  onInventario: () => void;
  onReinos: () => void;
  onRecetas: () => void;
  onCarrito: () => void;
  carritoOpen: boolean;
  onWorkload: () => void;
  onPerfil: () => void;
  onCreateMision: () => void;
  onLogout: () => void;
}) {
  const pVer = (tab: string) => puedeVerTab(permisos, nivel, tab);
  return (
    <nav
      className="quest-nav-bar sticky top-0 z-20 -mx-4 mb-5 flex flex-wrap items-center gap-x-2 gap-y-2 border-b-2 border-border px-4 py-2.5 backdrop-blur-md lg:-mx-10"
      aria-label="Navegación Centro de Mando"
    >
      <div className="quest-nav-bar-main flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {pVer("tablero") && (
          <button type="button" onClick={onTablero} className={questNavBtn(view === "list")}>
            <QuestBoardNavLabel />
          </button>
        )}
        {pVer("acciones") && (
          <button type="button" onClick={onAcciones} className={questNavBtn(view === "acciones")}>
            <TopicIcon value="⚡" size={14} weight="duotone" />
            Acciones
          </button>
        )}
        {pVer("crear_mision") && (
          <button
            type="button"
            onClick={onCreateMision}
            className={questNavBtn(view === "crear_mision")}
          >
            + Nueva misión
          </button>
        )}
        {pVer("inventario") && (
          <button type="button" onClick={onInventario} className={`relative ${questNavBtn(view === "inventario")}`}>
            <TopicIcon value="🧪" size={14} weight="duotone" />
            Inventario
            {bajoStockCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white leading-none shadow-sm">
                {bajoStockCount}
              </span>
            )}
          </button>
        )}
        {pVer("reinos") && (
          <button type="button" onClick={onReinos} className={questNavBtn(view === "reinos")}>
            <TopicIcon value="🏰" size={14} weight="duotone" />
            Reinos
          </button>
        )}
        {pVer("recetas") && (
          <button type="button" onClick={onRecetas} className={questNavBtn(view === "recetas")}>
            <TopicIcon value="📖" size={14} weight="duotone" />
            Recetas
          </button>
        )}
        {pVer("inventario") && <InventarioCarritoNavBtn active={carritoOpen} onOpen={onCarrito} />}
        {nivel >= 2 && pVer("workload") && (
          <button type="button" onClick={onWorkload} className={questNavBtn(view === "workload")}>
            <TopicIcon value="🤝" size={14} weight="duotone" />
            Aliados
          </button>
        )}
        {pVer("perfil") && (
          <button type="button" onClick={onPerfil} className={questNavBtn(view === "perfil")}>
            <TopicIcon value="👤" size={14} weight="duotone" />
            Perfil
          </button>
        )}
      </div>
      <div className="quest-nav-bar-actions ml-auto flex shrink-0 items-center gap-2">
        <QuestThemeToggle />
        <button
          type="button"
          onClick={onLogout}
          title={`Cerrar sesión (${userNombre})`}
          className={`${questNavBtn(false)} max-w-[12rem] truncate`}
        >
          <Icon name="signOut" size={14} weight="bold" className="shrink-0" />
          <span className="truncate">Salir ({userNombre})</span>
        </button>
      </div>
    </nav>
  );
}

function navScopeActivo(navScope: NavScope, s: NavScope): boolean {
  if (navScope.kind !== s.kind) return false;
  if (s.kind === "all") return navScope.kind === "all";
  if (s.kind === "reino" && navScope.kind === "reino") return navScope.id === s.id;
  if (s.kind === "zona" && navScope.kind === "zona") return navScope.id === s.id;
  if (s.kind === "subzona" && navScope.kind === "subzona") return navScope.id === s.id;
  if (s.kind === "departamento" && navScope.kind === "departamento") return navScope.id === s.id;
  return false;
}

type CrearZonaTipo = "reino" | "zona" | "subzona" | "departamento";

function nivelZona(z: ZonaTrabajo, zonas: ZonaTrabajo[]): CrearZonaTipo {
  const t = (z.tipo || "").toLowerCase();
  if (t === "reino" || t === "zona" || t === "subzona" || t === "departamento") return t;
  const d = zonaProfundidad(z, zonas);
  if (d === 0) return "reino";
  if (d === 1) return "zona";
  if (d === 2) {
    const hijos = zonas.filter((x) => x.parent_id === z.id);
    if (hijos.some((h) => nivelZona(h, zonas) === "departamento" || zonaProfundidad(h, zonas) >= 3)) {
      return "subzona";
    }
    if (hijos.length > 0) return "subzona";
    return "departamento";
  }
  return "departamento";
}

function listarSubzonas(zonas: ZonaTrabajo[]): ZonaTrabajo[] {
  return zonas.filter((z) => nivelZona(z, zonas) === "subzona");
}

function subzonasDeZona(zonas: ZonaTrabajo[], zonaId: number): ZonaTrabajo[] {
  return zonas.filter((z) => z.parent_id === zonaId && nivelZona(z, zonas) === "subzona");
}

function departamentosDePadre(zonas: ZonaTrabajo[], parentId: number): ZonaTrabajo[] {
  return zonas.filter((z) => z.parent_id === parentId && nivelZona(z, zonas) === "departamento");
}

function zonasSinSubzona(zonas: ZonaTrabajo[]): ZonaTrabajo[] {
  return zonas.filter(
    (z) => zonaProfundidad(z, zonas) === 1 && subzonasDeZona(zonas, z.id).length === 0,
  );
}

function departamentoPadreValido(zonas: ZonaTrabajo[], parentId: number | ""): boolean {
  if (parentId === "" || parentId == null) return false;
  const z = zonas.find((x) => x.id === parentId);
  if (!z) return false;
  const niv = nivelZona(z, zonas);
  if (niv === "subzona") return true;
  if (niv === "zona") return subzonasDeZona(zonas, z.id).length === 0;
  return false;
}

/** Padre para labores: subzona si hay; si no, la zona (Hogar Dulce Hogar). */
function padreIdParaDepartamentos(
  zonas: ZonaTrabajo[],
  zonaId: number | "",
  subzonaId: number | "",
): number | "" {
  if (subzonaId !== "") return subzonaId;
  if (zonaId !== "" && subzonasDeZona(zonas, zonaId).length === 0) return zonaId;
  return "";
}

function zonaRutaLabel(z: ZonaTrabajo, zonas: ZonaTrabajo[]): string {
  const byId = new Map(zonas.map((x) => [x.id, x]));
  const parts: string[] = [z.nombre];
  const r = z.parent_id ? byId.get(z.parent_id) : undefined;
  if (r) parts.unshift(r.nombre);
  return parts.join(" › ");
}

function subzonaRutaLabel(s: ZonaTrabajo, zonas: ZonaTrabajo[]): string {
  const byId = new Map(zonas.map((x) => [x.id, x]));
  const parts: string[] = [s.nombre];
  let p = s.parent_id ? byId.get(s.parent_id) : undefined;
  if (p) {
    parts.unshift(p.nombre);
    const r = p.parent_id ? byId.get(p.parent_id) : undefined;
    if (r) parts.unshift(r.nombre);
  }
  return parts.join(" › ");
}

function ReinosView({
  token,
  user,
  navScope,
  onNavScope,
  onIrTablero,
  onIrInventario,
}: {
  token: string;
  user: TicketsUser;
  navScope: NavScope;
  onNavScope: (scope: NavScope) => void;
  onIrTablero: () => void;
  onIrInventario: () => void;
}) {
  const nivel = user.rol?.nivel ?? 1;
  const canManage = nivel >= 2;
  const boardTitle = useQuestBoardTitle((s) => s.title);
  const [zonas, setZonas] = useState<ZonaTrabajo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editColor, setEditColor] = useState("#0c6069");
  const [crear, setCrear] = useState<{
    tipo: CrearZonaTipo;
    parentId: number | "";
    nombre: string;
    color: string;
  } | null>(null);
  const [openNodes, setOpenNodes] = useState<Set<string>>(() => new Set());

  const reload = useCallback(() => {
    setLoading(true);
    return tapi("/zonas-trabajo", token)
      .then((d) => setZonas(Array.isArray(d) ? d : []))
      .catch(() => setZonas([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const arbol = useMemo(() => buildReinoNavTree(zonas), [zonas]);

  const navScopeKey = useMemo(
    () => (navScope.kind === "all" ? "all" : `${navScope.kind}:${navScope.id}`),
    [navScope],
  );

  function todasClavesReinosTree(): string[] {
    const keys: string[] = [];
    for (const { reino, zonas: zonasHijas } of arbol) {
      keys.push(reinoTreeNodeKey("reino", reino.id));
      for (const { zona, subzonas } of zonasHijas) {
        keys.push(reinoTreeNodeKey("zona", zona.id));
        for (const { subzona } of subzonas) keys.push(reinoTreeNodeKey("subzona", subzona.id));
      }
    }
    return keys;
  }

  function abrirAncestrosZona(z: ZonaTrabajo) {
    const byId = new Map(zonas.map((x) => [x.id, x]));
    const keys: string[] = [];
    let cur: ZonaTrabajo | undefined = z;
    while (cur) {
      const niv = nivelZona(cur, zonas);
      if (niv === "reino") keys.push(reinoTreeNodeKey("reino", cur.id));
      else if (niv === "zona") keys.push(reinoTreeNodeKey("zona", cur.id));
      else if (niv === "subzona") keys.push(reinoTreeNodeKey("subzona", cur.id));
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
    if (keys.length) {
      setOpenNodes((prev) => new Set([...prev, ...keys]));
    }
  }

  function toggleReinoNode(key: string) {
    setOpenNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    setOpenNodes(openNodesForNavScope(navScope, arbol, zonas));
  }, [navScopeKey, arbol.length, zonas.length]);

  const todosIds = zonas.map((z) => z.id);
  const zonasParaSub = zonas.filter((z) => zonaProfundidad(z, zonas) === 1);
  const subzonasParaDept = listarSubzonas(zonas);
  const zonasDirectasParaDept = zonasSinSubzona(zonas);
  const hayPadresDepartamento = zonasDirectasParaDept.length > 0 || subzonasParaDept.length > 0;

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === todosIds.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(todosIds));
  }

  function iniciarCrear(tipo: CrearZonaTipo, parentId: number | "" = "") {
    setEditId(null);
    let pid = parentId;
    if ((pid === "" || pid == null) && tipo === "departamento" && navScope.kind === "subzona") {
      pid = navScope.id;
    }
    if ((pid === "" || pid == null) && tipo === "subzona" && navScope.kind === "zona") {
      pid = navScope.id;
    }
    if ((pid === "" || pid == null) && tipo === "zona" && navScope.kind === "reino") {
      pid = navScope.id;
    }
    if ((pid === "" || pid == null) && tipo === "departamento" && navScope.kind === "zona") {
      pid = navScope.id;
    }
    setCrear({
      tipo,
      parentId: pid,
      nombre: "",
      color: colorPorDefectoNuevaZona(zonas, pid, tipo),
    });
    setActionMsg(null);
    if (pid !== "" && pid != null) {
      const padre = zonas.find((z) => z.id === Number(pid));
      if (padre) abrirAncestrosZona(padre);
    }
  }

  async function guardarCrear() {
    if (!crear?.nombre.trim()) return;
    if (crear.tipo === "zona" && (crear.parentId === "" || crear.parentId == null)) {
      setActionMsg({ type: "err", text: "Elige el reino padre." });
      return;
    }
    if (crear.tipo === "subzona" && (crear.parentId === "" || crear.parentId == null)) {
      setActionMsg({
        type: "err",
        text: zonasParaSub.length === 0
          ? "No hay zonas: crea primero una zona bajo un reino (botón + Zona o + Zona en el reino)."
          : "Elige la zona padre en el listado.",
      });
      return;
    }
    if (crear.tipo === "departamento" && !departamentoPadreValido(zonas, crear.parentId)) {
      setActionMsg({
        type: "err",
        text: !hayPadresDepartamento
          ? "Crea primero una zona bajo un reino (ej. Cocina en Hogar Dulce Hogar)."
          : "Elige la zona (sin subzona) o la subzona padre.",
      });
      return;
    }
    setSaving(true);
    setActionMsg(null);
    try {
      const body: { nombre: string; nivel: CrearZonaTipo; parent_id?: number; color: string } = {
        nombre: crear.nombre.trim(),
        nivel: crear.tipo,
        color: crear.color,
      };
      if (crear.tipo !== "reino") body.parent_id = Number(crear.parentId);
      await tapi("/zonas-trabajo", token, { method: "POST", body: JSON.stringify(body) });
      setCrear(null);
      setActionMsg({ type: "ok", text: "Creado correctamente." });
      await reload();
    } catch (e: any) {
      setActionMsg({ type: "err", text: e?.message || "Error al crear" });
    } finally {
      setSaving(false);
    }
  }

  function iniciarEdicion(z: ZonaTrabajo) {
    setCrear(null);
    setEditId(z.id);
    setEditNombre(z.nombre);
    setEditColor(zonaColor(z, z.id));
    abrirAncestrosZona(z);
  }

  async function guardarEdicion() {
    if (editId == null || !editNombre.trim()) return;
    setSaving(true);
    setActionMsg(null);
    try {
      await tapi(`/zonas-trabajo/${editId}`, token, {
        method: "PUT",
        body: JSON.stringify({ nombre: editNombre.trim(), color: editColor }),
      });
      setEditId(null);
      setEditNombre("");
      setEditColor("#0c6069");
      setActionMsg({ type: "ok", text: "Nombre actualizado." });
      await reload();
    } catch (e: any) {
      setActionMsg({ type: "err", text: e?.message || "Error al guardar" });
    } finally {
      setSaving(false);
    }
  }

  async function ejecutarEliminacion() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setConfirmDelete(false);
    setSaving(true);
    setActionMsg(null);
    const okIds = new Set<number>();
    const errores: string[] = [];
    for (const id of ids) {
      try {
        await tapi(`/zonas-trabajo/${id}`, token, { method: "DELETE" });
        okIds.add(id);
      } catch {
        try {
          await tapi(`/zonas-trabajo/${id}`, token, { method: "PUT", body: JSON.stringify({ activo: 0 }) });
          okIds.add(id);
        } catch (e: any) {
          errores.push(e?.message || String(id));
        }
      }
    }
    if (okIds.size > 0) {
      setSelectedIds(new Set());
      if (editId != null && okIds.has(editId)) setEditId(null);
      if (navScope.kind !== "all" && okIds.has(navScope.id)) onNavScope({ kind: "all" });
      setActionMsg({
        type: "ok",
        text: `${okIds.size} elemento${okIds.size > 1 ? "s" : ""} eliminado${okIds.size > 1 ? "s" : ""}.`,
      });
      await reload();
    }
    if (errores.length > 0) {
      setActionMsg({ type: "err", text: errores.join(" · ") });
    }
    setSaving(false);
  }

  function aplicarFiltro(
    z: ZonaTrabajo,
    reinoNombre: string,
    zonaNombre?: string,
    subzonaNombre?: string,
  ) {
    const niv = nivelZona(z, zonas);
    const c = zonaColor(z, z.id);
    if (niv === "reino") onNavScope({ kind: "reino", id: z.id, nombre: z.nombre, color: c });
    else if (niv === "zona") {
      onNavScope({ kind: "zona", id: z.id, nombre: z.nombre, reinoNombre, color: c });
    } else if (niv === "subzona") {
      onNavScope({
        kind: "subzona",
        id: z.id,
        nombre: z.nombre,
        reinoNombre,
        zonaNombre: zonaNombre || z.parent_nombre || "",
        color: c,
      });
    } else {
      onNavScope({
        kind: "departamento",
        id: z.id,
        nombre: z.nombre,
        reinoNombre,
        zonaNombre: zonaNombre || "",
        subzonaNombre: subzonaNombre || z.parent_nombre || "",
        color: c,
      });
    }
  }

  const filaZona = (
    z: ZonaTrabajo,
    opts: {
      reinoNombre: string;
      zonaNombre?: string;
      subzonaNombre?: string;
      indent?: "zona" | "subzona" | "departamento";
    },
  ) => {
    const niv = nivelZona(z, zonas);
    const zColor = zonaColor(z, z.id);
    const icono = niv === "reino" ? "🏰" : niv === "zona" ? "📍" : niv === "subzona" ? "↳" : "🏢";
    const editando = editId === z.id;
    const seleccionado = selectedIds.has(z.id);
    const filtroActivo =
      (navScope.kind === "reino" && navScope.id === z.id)
      || (navScope.kind === "zona" && navScope.id === z.id)
      || (navScope.kind === "subzona" && navScope.id === z.id)
      || (navScope.kind === "departamento" && navScope.id === z.id);

    const indentCls =
      opts.indent === "departamento" ? "ml-12"
      : opts.indent === "subzona" ? "ml-8"
      : opts.indent === "zona" ? "ml-4"
      : "";

    if (editando && canManage) {
      return (
        <div
          key={z.id}
          className={`rounded-lg border-2 border-accent bg-surface p-2 ${indentCls}`}
          style={{ borderLeftWidth: 4, borderLeftColor: editColor }}
        >
          <input
            className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm font-bold outline-none focus:border-accent"
            value={editNombre}
            onChange={(e) => setEditNombre(e.target.value)}
            autoFocus
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-bold uppercase text-muted">Color</label>
            <input
              type="color"
              value={editColor}
              onChange={(e) => setEditColor(e.target.value)}
              className="h-8 w-12 cursor-pointer rounded border border-border p-0.5"
            />
            <span className="font-mono text-[10px] text-muted">{editColor}</span>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => { setEditId(null); setEditNombre(""); setEditColor("#0c6069"); }}
              className="text-xs font-bold text-muted hover:text-ink">Cancelar</button>
            <button type="button" onClick={guardarEdicion} disabled={saving || !editNombre.trim()}
              className="text-xs font-bold text-accent hover:underline disabled:opacity-50">Guardar</button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={z.id}
        className={`flex flex-wrap items-center gap-2 rounded-lg border-2 px-2 py-1.5 ${
          seleccionado ? "border-accent/50 bg-accent/5" : filtroActivo ? "border-accent/30 bg-accent/5" : "border-transparent hover:bg-surface-hover"
        } ${indentCls}`}
        style={{ borderLeftWidth: 4, borderLeftColor: zColor }}
      >
        {canManage && (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-accent"
            checked={seleccionado}
            onChange={() => toggleSelect(z.id)}
          />
        )}
        <ZonaColorDot color={zColor} title={`Color de ${z.nombre}`} />
        <button
          type="button"
          onClick={() => aplicarFiltro(z, opts.reinoNombre, opts.zonaNombre, opts.subzonaNombre)}
          className="min-w-0 flex-1 text-left text-sm font-semibold text-ink hover:text-accent"
          title="Usar como filtro en tablero/inventario"
        >
          <TopicIconLabel value={icono} size={14} className="font-semibold text-ink hover:text-accent">
            {z.nombre}
          </TopicIconLabel>
          <span className="ml-2 text-[10px] font-bold uppercase text-muted">
            {niv === "reino" ? "Reino" : niv === "zona" ? "Zona" : niv === "subzona" ? "Subzona" : "Depto"}
          </span>
        </button>
        {canManage && (
          <div className="flex shrink-0 gap-1">
            {niv === "reino" && (
              <button type="button" onClick={() => iniciarCrear("zona", z.id)}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-bold text-accent hover:bg-accent/10"
                title="Agregar zona">
                + Zona
              </button>
            )}
            {niv === "zona" && (
              <>
                <button type="button" onClick={() => iniciarCrear("subzona", z.id)}
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] font-bold text-muted hover:bg-surface-hover"
                  title="Subdivisión opcional (oficinas con pisos, etc.)">
                  + Sub
                </button>
                {subzonasDeZona(zonas, z.id).length === 0 && (
                  <button
                    type="button"
                    onClick={() => iniciarCrear("departamento", z.id)}
                    className="rounded border-2 border-accent bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent hover:bg-accent hover:text-white"
                    title="Labor directa bajo la zona (sin subzona)"
                  >
                    + Departamento
                  </button>
                )}
              </>
            )}
            {niv === "subzona" && (
              <button
                type="button"
                onClick={() => iniciarCrear("departamento", z.id)}
                className="rounded border-2 border-accent bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent hover:bg-accent hover:text-white"
                title="Agregar departamento (labor)">
                + Departamento
              </button>
            )}
            <button type="button" onClick={() => iniciarEdicion(z)} title="Editar"
              className="rounded border border-border px-1.5 py-0.5 text-xs text-muted hover:border-accent hover:text-accent">✏️</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-ink">
            <TopicIconLabel value="🏰" size={20} weight="duotone">Reinos</TopicIconLabel>
          </h2>
          <p className="mt-1 text-xs text-muted">
            Reino → zona → subzona → departamento (labor). Usa ▼ para desplegar cada nivel; clic en el nombre para filtrar tablero e inventario.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => iniciarCrear("reino")}
              className="rounded-xl border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white hover:bg-accent-hover">
              + Reino
            </button>
            <button type="button" onClick={() => iniciarCrear("zona")}
              className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent">
              + Zona
            </button>
            <button
              type="button"
              onClick={() => iniciarCrear("subzona")}
              disabled={zonasParaSub.length === 0}
              title={zonasParaSub.length === 0 ? "Crea primero una zona bajo un reino" : "Nueva subzona bajo una zona"}
              className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Subzona
            </button>
            <button
              type="button"
              onClick={() => iniciarCrear("departamento")}
              disabled={!hayPadresDepartamento}
              title={
                !hayPadresDepartamento
                  ? "Crea primero una zona bajo un reino"
                  : "Labor bajo una zona sin subzona (Hogar…) o bajo una subzona (oficinas)"
              }
              className="rounded-xl border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Departamento
            </button>
          </div>
        )}
      </div>

      {navScope.kind !== "all" && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-paper border-2 px-4 py-3"
          style={{
            borderColor: `${navScope.color}88`,
            background: `${navScope.color}18`,
          }}
        >
          <ZonaColorDot color={navScope.color} />
          <span className="text-sm font-semibold" style={{ color: navScope.color }}>
            Filtro: {navScopeLabel(navScope)}
          </span>
          <button type="button" onClick={onIrTablero}
            className="rounded-paper border-2 border-accent bg-accent px-3 py-1 text-xs font-bold text-white hover:bg-accent-hover">
            Ver en {boardTitle}
          </button>
          <button type="button" onClick={onIrInventario}
            className="rounded-paper border-2 border-border px-3 py-1 text-xs font-bold text-muted hover:border-accent hover:text-accent">
            Ver en inventario
          </button>
          <button type="button" onClick={() => onNavScope({ kind: "all" })}
            className="text-xs font-bold text-muted hover:text-danger">
            Quitar filtro
          </button>
        </div>
      )}

      {crear && canManage && (
        <div className="rounded-paper border-2 border-accent/50 bg-surface-panel p-4 space-y-3">
          <h3 className="text-sm font-extrabold text-accent">
            Nuevo {
              crear.tipo === "reino" ? "reino"
              : crear.tipo === "zona" ? "zona"
              : crear.tipo === "subzona" ? "subzona"
              : "departamento"
            }
          </h3>
          {crear.tipo === "zona" && (
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Reino padre *</label>
              <select
                className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                value={crear.parentId === "" ? "" : String(crear.parentId)}
                onChange={(e) => setCrear((c) => c && { ...c, parentId: e.target.value ? parseInt(e.target.value, 10) : "" })}
              >
                <option value="">— Elegir reino —</option>
                {arbol.map(({ reino }) => (
                  <option key={reino.id} value={reino.id}>{reino.nombre}</option>
                ))}
              </select>
            </div>
          )}
          {crear.tipo === "departamento" && (
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Ubicación padre *</label>
              {!hayPadresDepartamento ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  No hay zonas en el catálogo. Crea primero una <strong>zona</strong> bajo el reino (ej. Cocina).
                </p>
              ) : (
                <select
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                  value={crear.parentId === "" ? "" : String(crear.parentId)}
                  onChange={(e) => setCrear((c) => c && { ...c, parentId: e.target.value ? parseInt(e.target.value, 10) : "" })}
                >
                  <option value="">— Elegir ubicación —</option>
                  {zonasDirectasParaDept.length > 0 && (
                    <optgroup label="Zona directa (sin subzona)">
                      {zonasDirectasParaDept.map((z) => (
                        <option key={z.id} value={z.id}>{zonaRutaLabel(z, zonas)}</option>
                      ))}
                    </optgroup>
                  )}
                  {subzonasParaDept.length > 0 && (
                    <optgroup label="Subzona">
                      {subzonasParaDept.map((s) => (
                        <option key={s.id} value={s.id}>{subzonaRutaLabel(s, zonas)}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              )}
              <p className="mt-1 text-[10px] text-muted">
                Hogar Dulce Hogar: reino → zona (Cocina) → departamento. Oficinas: reino → zona → subzona → departamento.
              </p>
            </div>
          )}
          {crear.tipo === "subzona" && (
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Zona padre * (debe ser zona, no el reino)</label>
              {zonasParaSub.length === 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  No hay zonas todavía. Usa <strong>+ Zona</strong> bajo un reino, o el botón <strong>+ Zona</strong> en la fila del reino.
                </p>
              ) : (
                <select
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                  value={crear.parentId === "" ? "" : String(crear.parentId)}
                  onChange={(e) => setCrear((c) => c && { ...c, parentId: e.target.value ? parseInt(e.target.value, 10) : "" })}
                >
                  <option value="">— Elegir zona —</option>
                  {zonasParaSub.map((z) => (
                    <option key={z.id} value={z.id}>{zonaLabel(z)}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Nombre *</label>
            <input
              className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="Nombre"
              value={crear.nombre}
              onChange={(e) => setCrear((c) => c && { ...c, nombre: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && guardarCrear()}
              autoFocus
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-bold text-muted">Color identificador</label>
            <input
              type="color"
              value={crear.color}
              onChange={(e) => setCrear((c) => c && { ...c, color: e.target.value })}
              className="h-9 w-14 cursor-pointer rounded border-2 border-border p-0.5"
            />
            <ZonaColorDot color={crear.color} size="md" />
            <span className="font-mono text-[10px] text-muted">{crear.color}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCrear(null)}
              className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface-hover">
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardarCrear}
              disabled={
                saving
                || !crear.nombre.trim()
                || (crear.tipo === "zona" && (crear.parentId === "" || crear.parentId == null))
                || (crear.tipo === "subzona" && (crear.parentId === "" || crear.parentId == null))
                || (crear.tipo === "departamento" && !departamentoPadreValido(zonas, crear.parentId))
              }
              className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Crear"}
            </button>
          </div>
        </div>
      )}

      {canManage && todosIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-paper border-2 border-border bg-surface-panel px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={selectedIds.size === todosIds.length && todosIds.length > 0}
              onChange={toggleSelectAll}
            />
            Seleccionar todos
          </label>
          <span className="text-xs text-muted">
            {selectedIds.size > 0 ? `${selectedIds.size} seleccionado${selectedIds.size > 1 ? "s" : ""}` : ""}
          </span>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || selectedIds.size === 0}
            className="ml-auto rounded-paper border-2 border-red-400/80 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-500 hover:text-white disabled:opacity-40 dark:bg-red-950/40 dark:text-red-400"
          >
            {saving ? "..." : `🗑 Eliminar${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
          </button>
        </div>
      )}

      {confirmDelete && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-paper border-2 border-red-400/70 bg-red-50 px-4 py-3 dark:bg-red-950/50">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            ¿Eliminar {selectedIds.size} elemento{selectedIds.size > 1 ? "s" : ""}?
            <span className="mt-0.5 block text-xs font-normal opacity-80">
              Si es un reino, también se archivan sus zonas y subzonas.
            </span>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)}
              className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted">Cancelar</button>
            <button type="button" onClick={ejecutarEliminacion} disabled={saving}
              className="rounded-paper border-2 border-red-600 bg-red-600 px-4 py-1.5 text-xs font-bold text-white">Sí, eliminar</button>
          </div>
        </div>
      )}

      {actionMsg && (
        <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${actionMsg.type === "ok" ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"}`}>
          {actionMsg.text}
        </p>
      )}

      {nivel < 2 && (
        <p className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs text-muted">
          Vista de solo lectura. Supervisor o administrador puede crear, editar y eliminar.
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Cargando reinos...</p>
      ) : arbol.length === 0 && !crear ? (
        <div className="py-12 text-center space-y-3">
          <p className="text-sm text-muted">No hay reinos aún.</p>
          {canManage && (
            <button type="button" onClick={() => iniciarCrear("reino")}
              className="rounded-xl border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white">
              + Crear primer reino
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {arbol.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Árbol</span>
              <button
                type="button"
                onClick={() => setOpenNodes(new Set(todasClavesReinosTree()))}
                className="rounded-paper border border-border px-2.5 py-1 text-[10px] font-bold text-muted transition hover:border-accent hover:text-accent"
              >
                Expandir todo
              </button>
              <button
                type="button"
                onClick={() => setOpenNodes(new Set())}
                className="rounded-paper border border-border px-2.5 py-1 text-[10px] font-bold text-muted transition hover:border-accent hover:text-accent"
              >
                Colapsar todo
              </button>
            </div>
          )}
          {arbol.map(({ reino, zonas: zonasHijas }) => {
            const rKey = reinoTreeNodeKey("reino", reino.id);
            const reinoAbierto = openNodes.has(rKey);
            const reinoColor = zonaColor(reino, reino.id);
            const hijosReino =
              zonasHijas.reduce((n, z) => n + z.subzonas.length + z.departamentosDirectos.length, 0)
              + zonasHijas.length;
            return (
              <div
                key={reino.id}
                className={`quest-reinos-grupo ${reinoAbierto ? "quest-reinos-grupo--open" : ""}`}
                style={{ "--reino-accent": reinoColor } as CSSProperties}
              >
                <div className="quest-reinos-grupo-row p-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleReinoNode(rKey);
                    }}
                    className={`quest-reinos-grupo-chevron ${reinoAbierto ? "quest-reinos-grupo-chevron--open" : ""}`}
                    aria-expanded={reinoAbierto}
                    title={reinoAbierto ? "Colapsar reino" : "Expandir reino"}
                  >
                    ▼
                  </button>
                  <div className="min-w-0 flex-1">
                    {filaZona(reino, { reinoNombre: reino.nombre })}
                  </div>
                  <span className="shrink-0 pr-1 text-[10px] font-bold tabular-nums text-muted" title="Zonas en este reino">
                    {hijosReino}
                  </span>
                </div>
                {reinoAbierto && (
                  <div className="quest-reinos-grupo-body">
                    {zonasHijas.length === 0 && canManage && (
                      <button
                        type="button"
                        onClick={() => iniciarCrear("zona", reino.id)}
                        className="w-full rounded-lg border-2 border-dashed border-accent/50 px-3 py-2 text-xs font-bold text-accent hover:bg-accent/10"
                      >
                        + Crear primera zona en «{reino.nombre}»
                      </button>
                    )}
                    {zonasHijas.map(({ zona, subzonas, departamentosDirectos }) => {
                      const zKey = reinoTreeNodeKey("zona", zona.id);
                      const zonaAbierta = openNodes.has(zKey);
                      const accentZ = zonaColor(zona, zona.id);
                      return (
                        <div
                          key={zona.id}
                          className={`quest-reinos-grupo quest-reinos-grupo--zona ${zonaAbierta ? "quest-reinos-grupo--open" : ""}`}
                          style={{ "--reino-accent": accentZ } as CSSProperties}
                        >
                          <div className="quest-reinos-grupo-row p-0.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleReinoNode(zKey);
                              }}
                              className={`quest-reinos-grupo-chevron ${zonaAbierta ? "quest-reinos-grupo-chevron--open" : ""}`}
                              aria-expanded={zonaAbierta}
                            >
                              ▼
                            </button>
                            <div className="min-w-0 flex-1">
                              {filaZona(zona, { reinoNombre: reino.nombre, indent: "zona" })}
                            </div>
                          </div>
                          {zonaAbierta && (
                            <div className="quest-reinos-grupo-body">
                              {departamentosDirectos.map((dep) => (
                                <div key={dep.id}>
                                  {filaZona(dep, {
                                    reinoNombre: reino.nombre,
                                    zonaNombre: zona.nombre,
                                    indent: "departamento",
                                  })}
                                </div>
                              ))}
                              {departamentosDirectos.length === 0
                                && subzonas.length === 0
                                && canManage && (
                                <div className="py-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenNodes((prev) => new Set([...prev, zKey]));
                                      iniciarCrear("departamento", zona.id);
                                    }}
                                    className="rounded-lg border-2 border-dashed border-accent/60 bg-accent/5 px-3 py-2 text-xs font-bold text-accent hover:bg-accent/15"
                                  >
                                    + Crear labor en «{zona.nombre}» (sin subzona)
                                  </button>
                                </div>
                              )}
                              {subzonas.map(({ subzona, departamentos }) => {
                                const sKey = reinoTreeNodeKey("subzona", subzona.id);
                                const subAbierta = openNodes.has(sKey);
                                const accentSub = zonaColor(subzona, subzona.id);
                                return (
                                  <div
                                    key={subzona.id}
                                    className={`quest-reinos-grupo quest-reinos-grupo--subzona ${subAbierta ? "quest-reinos-grupo--open" : ""}`}
                                    style={{ "--reino-accent": accentSub } as CSSProperties}
                                  >
                                    <div className="quest-reinos-grupo-row p-0.5">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleReinoNode(sKey);
                                        }}
                                        className={`quest-reinos-grupo-chevron ${subAbierta ? "quest-reinos-grupo-chevron--open" : ""}`}
                                        aria-expanded={subAbierta}
                                      >
                                        ▼
                                      </button>
                                      <div className="min-w-0 flex-1">
                                        {filaZona(subzona, {
                                          reinoNombre: reino.nombre,
                                          zonaNombre: zona.nombre,
                                          indent: "subzona",
                                        })}
                                      </div>
                                    </div>
                                    {subAbierta && (
                                      <div className="quest-reinos-grupo-body">
                                        {departamentos.map((dep) => (
                                          <div key={dep.id}>
                                            {filaZona(dep, {
                                              reinoNombre: reino.nombre,
                                              zonaNombre: zona.nombre,
                                              subzonaNombre: subzona.nombre,
                                              indent: "departamento",
                                            })}
                                          </div>
                                        ))}
                                        {departamentos.length === 0 && canManage && (
                                          <div className="py-1">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setOpenNodes((prev) => new Set([...prev, rKey, zKey, sKey]));
                                                iniciarCrear("departamento", subzona.id);
                                              }}
                                              className="rounded-lg border-2 border-dashed border-accent/60 bg-accent/5 px-3 py-2 text-xs font-bold text-accent hover:bg-accent/15"
                                            >
                                              + Crear departamento en «{subzona.nombre}»
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Login
function LoginView({ onLogin }: { onLogin: (token: string, user: TicketsUser) => void }) {
  const [authError, setAuthError] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return decodeURIComponent(p.get("auth_error") || "");
  });

  // Consume ?_token=xxx from URL after Google OAuth redirect
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const token = p.get("_token");
    const err = p.get("auth_error");
    if (token || err) {
      // Clean URL without reloading
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
    if (err) {
      setAuthError(decodeURIComponent(err));
      return;
    }
    if (!token) return;

    // Validate token and load user
    fetch("/api/tickets/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((user) => {
        if (user?.id) onLogin(token, user as TicketsUser);
        else setAuthError("Token inválido. Intenta de nuevo.");
      })
      .catch(() => setAuthError("Error al verificar sesión. Intenta de nuevo."));
  }, [onLogin]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-paper border-2 border-border bg-surface-panel p-8 shadow-paper">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white text-2xl font-black shadow-[0_4px_0_#045159]">
            🎫
          </div>
          <h2 className="text-xl font-extrabold text-ink">Centro de Mando</h2>
          <p className="mt-1 text-sm text-muted">McKenna Group</p>
        </div>

        {authError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {authError}
          </div>
        )}

        <a
          href="/app/auth/google/start"
          className="flex w-full items-center justify-center gap-3 rounded-paper border-2 border-border bg-surface py-3 text-sm font-semibold text-ink shadow-sm transition hover:border-accent hover:bg-surface-hover active:translate-y-0.5"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
            <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.5-.4-3.5z" fill="#FFC107"/>
            <path d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00"/>
            <path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.1C9.5 35.6 16.2 44 24 44z" fill="#4CAF50"/>
            <path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.4 44 33 44 24c0-1.2-.1-2.5-.4-3.5z" fill="#1976D2"/>
          </svg>
          Ingresar con Google
        </a>

        <p className="mt-5 text-center text-xs text-muted">
          Solo cuentas autorizadas por el administrador
        </p>
      </div>
    </div>
  );
}

// Ticket list
interface MisionGroup {
  mision_id: number;
  mision_titulo: string;
  mision_color: string;
  mision_tipo: string;
  reino: string | null;
  reino_id?: number | null;
  zona_id?: number | null;
  ubicacion_label?: string | null;
  ubicacion_color?: string | null;
  tickets: Ticket[];
}

function enrichMisionGroupUbicacion(
  g: MisionGroup,
  zonas: ZonaTrabajo[],
): MisionGroup {
  if (!g.zona_id) return g;
  const leaf = zonaById(zonas, g.zona_id);
  return { ...g, ubicacion_color: zonaColor(leaf, g.zona_id) };
}

function ubicacionFromZonaId(
  zonas: ZonaTrabajo[],
  zonaId: number | null | undefined,
): {
  reinoId: number | "";
  zonaId: number | "";
  subzonaId: number | "";
  departamentoId: number | "";
} {
  const vacio: {
    reinoId: number | "";
    zonaId: number | "";
    subzonaId: number | "";
    departamentoId: number | "";
  } = { reinoId: "", zonaId: "", subzonaId: "", departamentoId: "" };
  if (zonaId == null) return vacio;
  const leaf = zonaById(zonas, zonaId);
  if (!leaf) return vacio;
  const byId = new Map(zonas.map((z) => [z.id, z]));
  const chain: ZonaTrabajo[] = [];
  let cur: ZonaTrabajo | undefined = leaf;
  for (let i = 0; i < 8 && cur; i++) {
    chain.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  const out = { ...vacio };
  for (const z of chain) {
    const niv = nivelZona(z, zonas);
    if (niv === "reino") out.reinoId = z.id;
    else if (niv === "zona") out.zonaId = z.id;
    else if (niv === "subzona") out.subzonaId = z.id;
    else if (niv === "departamento") out.departamentoId = z.id;
  }
  if (out.reinoId === "" && chain[0]) out.reinoId = chain[0].id;
  return out;
}

function zonaRaizId(zonas: ZonaTrabajo[], zonaId: number): number | null {
  const byId = new Map(zonas.map((z) => [z.id, z]));
  let cur = byId.get(zonaId);
  if (!cur) return null;
  for (let i = 0; i < 8 && cur?.parent_id; i++) {
    const p = byId.get(cur.parent_id);
    if (!p) break;
    cur = p;
  }
  return cur?.id ?? null;
}

function zonaEsDescendienteDe(zonas: ZonaTrabajo[], zonaId: number, ancestroId: number): boolean {
  const byId = new Map(zonas.map((z) => [z.id, z]));
  let cur = byId.get(zonaId);
  for (let i = 0; i < 8 && cur; i++) {
    if (cur.id === ancestroId) return true;
    if (!cur.parent_id) return false;
    cur = byId.get(cur.parent_id);
  }
  return false;
}

function misionZonaEnScope(
  zonaId: number | null | undefined,
  zonas: ZonaTrabajo[],
  scope: NavScope,
): boolean {
  if (scope.kind === "all") return true;
  if (zonaId == null) return false;
  if (scope.kind === "reino") return zonaRaizId(zonas, zonaId) === scope.id;
  if (scope.kind === "zona") return zonaId === scope.id || zonaEsDescendienteDe(zonas, zonaId, scope.id);
  if (scope.kind === "subzona") {
    return zonaId === scope.id || zonaEsDescendienteDe(zonas, zonaId, scope.id);
  }
  if (scope.kind === "departamento") return zonaId === scope.id;
  return false;
}

/** Quest/ticket visible según filtro del menú lateral (reino, zona, subzona, departamento). */
function ticketEnNavScope(t: Ticket, zonas: ZonaTrabajo[], scope: NavScope): boolean {
  if (scope.kind === "all") return true;
  if (t.mision_zona_id != null) return misionZonaEnScope(t.mision_zona_id, zonas, scope);
  if (t.mision_reino) return misionCoincideScope(t.mision_reino, scope);
  return false;
}

function QuickCrearDepartamento({
  token,
  subzonaId,
  subzonaNombre,
  onCreated,
}: {
  token: string;
  subzonaId: number;
  subzonaNombre?: string;
  onCreated: (nueva: ZonaTrabajo) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function guardar() {
    if (!nombre.trim()) return;
    setSaving(true);
    setErr("");
    try {
      const nueva = await tapi("/zonas-trabajo", token, {
        method: "POST",
        body: JSON.stringify({
          nombre: nombre.trim(),
          nivel: "departamento",
          parent_id: subzonaId,
        }),
      });
      onCreated(nueva);
      setNombre("");
    } catch (e: any) {
      setErr(e?.message || "No se pudo crear el departamento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-accent/50 bg-accent/5 p-3 space-y-2">
      <p className="text-[11px] font-bold text-accent">
        Sin labores en {subzonaNombre ? `«${subzonaNombre}»` : "esta ubicación"}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[10rem] flex-1 rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Ej: Contabilidad"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar()}
        />
        <button
          type="button"
          onClick={guardar}
          disabled={saving || !nombre.trim()}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {saving ? "..." : "+ Crear departamento"}
        </button>
      </div>
      {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
    </div>
  );
}

function ubicacionColorEfectiva(
  zonas: ZonaTrabajo[],
  reinoId: number | "",
  zonaId: number | "",
  subzonaId: number | "",
  departamentoId: number | "",
): string {
  const eff =
    departamentoId !== "" ? departamentoId
    : subzonaId !== "" ? subzonaId
    : zonaId !== "" ? zonaId
    : reinoId !== "" ? reinoId
    : null;
  if (eff == null) return ZONA_COLOR_PALETTE[0];
  const id = typeof eff === "number" ? eff : Number(eff);
  return zonaColor(zonaById(zonas, id), id);
}

/** Paleta rápida + input nativo para el color del papel del sticky (misión). */
function StickyColorPicker({
  color,
  onSelect,
  disabled,
}: {
  color: string;
  onSelect: (hex: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function pick(hex: string) {
    if (disabled || pending || hex === color) {
      setOpen(false);
      return;
    }
    setPending(true);
    try {
      await onSelect(hex);
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={panelRef} className="quest-sticky-color relative shrink-0">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="quest-sticky-color-trigger"
        style={{ background: color }}
        title="Color del sticky"
        aria-label="Elegir color del sticky"
        aria-expanded={open}
      />
      {open && (
        <div
          className="quest-sticky-color-panel"
          role="dialog"
          aria-label="Paleta de color"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-muted">Color</p>
          <div className="quest-sticky-color-swatches">
            {ZONA_COLOR_PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                disabled={pending}
                onClick={() => void pick(hex)}
                className={`quest-sticky-color-swatch ${hex.toLowerCase() === color.toLowerCase() ? "quest-sticky-color-swatch--active" : ""}`}
                style={{ background: hex }}
                title={hex}
                aria-label={`Color ${hex}`}
              />
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[9px] font-bold text-muted">
            <span>Otro</span>
            <input
              type="color"
              value={color}
              disabled={pending}
              onChange={(e) => void pick(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-border p-0.5"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function MisionUbicacionPicker({
  zonas,
  reinoId,
  zonaId,
  subzonaId,
  departamentoId,
  onChange,
  token,
  canManageZonas = false,
  onZonaCreada,
}: {
  zonas: ZonaTrabajo[];
  reinoId: number | "";
  zonaId: number | "";
  subzonaId: number | "";
  departamentoId: number | "";
  onChange: (v: {
    reinoId: number | "";
    zonaId: number | "";
    subzonaId: number | "";
    departamentoId: number | "";
    color?: string;
  }) => void;
  token?: string;
  canManageZonas?: boolean;
  onZonaCreada?: (z: ZonaTrabajo) => void;
}) {
  const reinos = zonas.filter((z) => !z.parent_id);
  const zonasDelReino =
    reinoId !== ""
      ? zonas.filter((z) => z.parent_id === reinoId && nivelZona(z, zonas) === "zona")
      : [];
  const subzonas = zonaId !== "" ? subzonasDeZona(zonas, zonaId) : [];
  const omitirSubzona = zonaId !== "" && subzonas.length === 0;
  const padreDept = padreIdParaDepartamentos(zonas, zonaId, subzonaId);
  const departamentos = padreDept !== "" ? departamentosDePadre(zonas, padreDept) : [];
  const subzonaSel = typeof subzonaId === "number" ? zonas.find((z) => z.id === subzonaId) : undefined;
  const zonaSel = typeof zonaId === "number" ? zonas.find((z) => z.id === zonaId) : undefined;
  const efectivo =
    departamentoId !== "" ? departamentoId
    : subzonaId !== "" ? subzonaId
    : zonaId !== "" ? zonaId
    : reinoId;

  const labelEfectivo = (() => {
    if (efectivo === "") return "";
    const z = zonas.find((x) => x.id === efectivo);
    if (!z) return "";
    if (!z.parent_id) return z.nombre;
    const parts: string[] = [];
    let cur: ZonaTrabajo | undefined = z;
    const byId = new Map(zonas.map((x) => [x.id, x]));
    for (let i = 0; i < 4 && cur; i++) {
      parts.unshift(cur.nombre);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join(" › ");
  })();

  const selCls =
    "w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent";

  return (
    <div className="col-span-2 space-y-3 rounded-paper border-2 border-border/70 bg-surface-hover/25 p-3">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted">
        Ubicación: reino → zona → subzona → departamento (labor) *
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-muted">Reino</label>
          <select
            className={selCls}
            value={reinoId === "" ? "" : String(reinoId)}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              const r = typeof id === "number" ? reinos.find((x) => x.id === id) : undefined;
              onChange({
                reinoId: id,
                zonaId: "",
                subzonaId: "",
                departamentoId: "",
                color: r?.color,
              });
            }}
          >
            <option value="">— Elegir —</option>
            {reinos.map((r) => (
              <option key={r.id} value={r.id}>
                <TopicIconLabel value={r.icono} fallback="castle" size={14}>
                  {r.nombre}
                </TopicIconLabel>
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-muted">Zona</label>
          <select
            className={selCls}
            value={zonaId === "" ? "" : String(zonaId)}
            disabled={reinoId === "" || zonasDelReino.length === 0}
              onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              const z = typeof id === "number" ? zonasDelReino.find((x) => x.id === id) : undefined;
              onChange({
                reinoId,
                zonaId: id,
                subzonaId: "",
                departamentoId: "",
                color: z ? zonaColor(z, z.id) : undefined,
              });
            }}
          >
            <option value="">
              {reinoId === "" ? "Primero el reino" : zonasDelReino.length === 0 ? "Sin zonas" : "— Elegir —"}
            </option>
            {zonasDelReino.map((z) => (
              <option key={z.id} value={z.id}>📍 {z.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
            Subzona {omitirSubzona ? "(opcional)" : ""}
          </label>
          <select
            className={selCls}
            value={subzonaId === "" ? "" : String(subzonaId)}
            disabled={zonaId === "" || omitirSubzona}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              const s = typeof id === "number" ? subzonas.find((x) => x.id === id) : undefined;
              onChange({
                reinoId,
                zonaId,
                subzonaId: id,
                departamentoId: "",
                color: s ? zonaColor(s, s.id) : zonaSel ? zonaColor(zonaSel, zonaSel.id) : undefined,
              });
            }}
          >
            <option value="">
              {zonaId === ""
                ? "Primero la zona"
                : omitirSubzona
                  ? "No aplica — labores bajo la zona"
                  : subzonas.length === 0
                    ? "Sin subzonas"
                    : "— Elegir —"}
            </option>
            {subzonas.map((s) => (
              <option key={s.id} value={s.id}>↳ {s.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-muted">Departamento (labor) *</label>
          <select
            className={selCls}
            value={departamentoId === "" ? "" : String(departamentoId)}
            disabled={padreDept === ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              const d = typeof id === "number" ? departamentos.find((x) => x.id === id) : undefined;
              onChange({
                reinoId,
                zonaId,
                subzonaId,
                departamentoId: id,
                color: d ? zonaColor(d, d.id) : subzonaSel
                  ? zonaColor(subzonaSel, subzonaSel.id)
                  : zonaSel
                    ? zonaColor(zonaSel, zonaSel.id)
                    : undefined,
              });
            }}
          >
            <option value="">
              {padreDept === ""
                ? omitirSubzona
                  ? "Primero la zona"
                  : "Primero la subzona"
                : departamentos.length === 0
                  ? "Sin departamentos — créalo abajo"
                  : "— Elegir labor —"}
            </option>
            {departamentos.map((d) => (
              <option key={d.id} value={d.id}>🏢 {d.nombre}</option>
            ))}
          </select>
        </div>
      </div>
      {canManageZonas && token && typeof padreDept === "number" && departamentos.length === 0 && (
        <QuickCrearDepartamento
          token={token}
          subzonaId={padreDept}
          subzonaNombre={subzonaSel?.nombre || zonaSel?.nombre}
          onCreated={(nueva) => {
            onZonaCreada?.(nueva);
            onChange({ reinoId, zonaId, subzonaId, departamentoId: nueva.id });
          }}
        />
      )}
      {labelEfectivo && (
        <p className="flex items-center gap-2 text-[11px] font-semibold text-accent">
          <ZonaColorDot
            color={ubicacionColorEfectiva(zonas, reinoId, zonaId, subzonaId, departamentoId)}
            size="sm"
          />
          <span>
            Se asignará a: {labelEfectivo}
          </span>
        </p>
      )}
    </div>
  );
}

function TicketStickyProgress({ t, accent }: { t: Ticket; accent: string }) {
  const dark = useQuestTheme((s) => s.dark);
  const prog = ticketEjecucionPct(t);
  if (prog.total <= 0 && prog.pct === 0) return null;
  const barColor = prog.pct === 100 ? "#16a34a" : accent;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold">
        <span className="text-muted">Checklist</span>
        <span className="tabular-nums" style={{ color: barColor }}>
          {prog.pct}%
          {prog.total > 0 && (
            <span className="ml-1 font-semibold text-muted">
              {prog.completados}/{prog.total}
            </span>
          )}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full border border-black/5 dark:border-white/10"
        style={{ background: dark ? `${accent}18` : `${accent}12` }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${prog.pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

function TicketCard({ t, onClick }: { t: Ticket; onClick: () => void }) {
  const dark = useQuestTheme((s) => s.dark);
  const rot = stickyRotation(t.id);
  const dotPair = ESTADO_DOT_COLOR[t.estado as keyof typeof ESTADO_DOT_COLOR] ?? ESTADO_DOT_COLOR.pendiente;
  const accent = questTone(dotPair.light, dotPair.dark, dark);
  const estadoLabel =
    t.estado === "pendiente" ? "Por iniciar"
    : t.estado === "en_proceso" ? "En campaña"
    : t.estado === "esperando_aprobacion" ? "En revisión"
    : t.estado === "resuelto" ? "Lista"
    : "Rechazada";

  return (
    <button
      type="button"
      onClick={onClick}
      className="quest-sticky quest-sticky-solo h-full w-full"
      style={{
        transform: `rotate(${rot}deg)`,
        background: dark
          ? `linear-gradient(168deg, ${accent}28 0%, rgb(32 40 42) 50%, rgb(28 36 38) 100%)`
          : `linear-gradient(168deg, ${accent}22 0%, rgb(var(--mck-surface-panel)) 45%, rgb(var(--mck-surface-input)) 100%)`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "rotate(0deg) scale(1.02)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = `rotate(${rot}deg)`; }}
    >
      <span className="quest-sticky-tape" aria-hidden />
      <div className="flex items-start gap-2">
        <StatusOrb estado={estadoOrbEnTablero(t)} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-extrabold leading-snug text-ink">{t.titulo}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] font-bold text-muted">{t.numero}</span>
            <CategoriaBadge cat={t.categoria} />
          </div>
        </div>
        <PrioridadDot p={t.prioridad} />
      </div>
      <TicketStickyProgress t={t} accent={accent} />
      <div className="flex items-center justify-between gap-2 border-t border-black/5 pt-2 dark:border-white/10">
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: accent }}>
          {estadoLabel}
        </span>
        {t.asignado_a_nombre && (
          <span className="truncate text-[10px] text-muted">👤 {t.asignado_a_nombre}</span>
        )}
      </div>
    </button>
  );
}

function ticketPasosCounts(t: Ticket | { pasos_total?: unknown; pasos_completados?: unknown }): {
  total: number;
  completados: number;
} {
  const totalRaw = Number(t.pasos_total);
  const okRaw = Number(t.pasos_completados);
  const total = Number.isFinite(totalRaw) ? Math.max(0, Math.floor(totalRaw)) : 0;
  let completados = Number.isFinite(okRaw) ? Math.max(0, Math.floor(okRaw)) : 0;
  if (total > 0) completados = Math.min(completados, total);
  return { total, completados };
}

function normalizeTicketForList(raw: unknown): Ticket {
  const t = raw as Ticket;
  const { total, completados } = ticketPasosCounts(t);
  return {
    ...t,
    pasos_total: total,
    pasos_completados: completados,
  };
}

function ticketFromTableroResumen(row: TicketTableroResumen, m: Mision): Ticket {
  return normalizeTicketForList({
    id: row.id,
    numero: row.numero,
    titulo: row.titulo,
    categoria: (row.categoria || m.categoria || "logistica") as Ticket["categoria"],
    descripcion: row.titulo,
    estado: row.estado,
    prioridad: row.prioridad || "media",
    creado_por: m.creado_por,
    asignado_a: row.asignado_a ?? null,
    asignado_a_nombre: row.asignado_a_nombre ?? null,
    soporte_archivo: null,
    creado_en: m.creado_en,
    actualizado_en: m.creado_en,
    resuelto_en: null,
    mision_id: m.id,
    etapa_id: row.etapa_id ?? null,
    bloqueado_por: row.bloqueado_por ?? null,
    bloqueado_por_numero: row.bloqueado_por_numero ?? null,
    mision_titulo: row.mision_titulo || m.titulo,
    mision_color: row.mision_color || m.color,
    mision_tipo: row.mision_tipo || m.tipo,
    mision_reino: row.mision_reino ?? m.reino ?? null,
    mision_zona_id: row.mision_zona_id ?? m.zona_id ?? null,
    pasos_total: row.pasos_total,
    pasos_completados: row.pasos_completados,
  });
}

/** Mezcla tickets del listado con resumen por etapa (si el GET / no trajo alguno). */
function mergeMisionGroupsWithTablero(
  misionGroups: Map<number, MisionGroup>,
  misionesActivas: Mision[],
  zonasReinos: ZonaTrabajo[],
) {
  for (const m of misionesActivas) {
    const tablero = m.tickets_tablero;
    if (!tablero?.length) continue;

    let g = misionGroups.get(m.id);
    if (!g) {
      g = {
        mision_id: m.id,
        mision_titulo: m.titulo,
        mision_color: m.color || "#0c6069",
        mision_tipo: m.tipo || "secuencial",
        reino: m.reino || m.reino_nombre || null,
        reino_id: m.zona_id ? zonaRaizId(zonasReinos, m.zona_id) : null,
        zona_id: m.zona_id ?? null,
        ubicacion_label: m.ubicacion_label ?? null,
        tickets: [],
      };
      misionGroups.set(m.id, g);
    }

    const byId = new Map(g.tickets.map((t) => [t.id, t]));
    for (const row of tablero) {
      const normalized = ticketFromTableroResumen(row, m);
      const prev = byId.get(normalized.id);
      if (prev) {
        prev.pasos_total = normalized.pasos_total;
        prev.pasos_completados = normalized.pasos_completados;
        prev.estado = normalized.estado;
      } else {
        g.tickets.push(normalized);
        byId.set(normalized.id, normalized);
      }
    }
    g.tickets.sort(
      (a, b) =>
        (tablero.find((x) => x.id === a.id)?.etapa_orden ?? 0)
        - (tablero.find((x) => x.id === b.id)?.etapa_orden ?? 0),
    );
  }
}

function misionGrupoEjecucionPct(group: MisionGroup): {
  pct: number;
  completados: number;
  total: number;
} {
  let totalPasos = 0;
  let okPasos = 0;
  for (const t of group.tickets) {
    const { total, completados } = ticketPasosCounts(t);
    totalPasos += total;
    okPasos += completados;
  }
  if (totalPasos > 0) {
    return {
      pct: Math.round((okPasos / totalPasos) * 100),
      completados: okPasos,
      total: totalPasos,
    };
  }
  return { pct: 0, completados: 0, total: 0 };
}

/** Avisar al tablero que cambió el checklist de un ticket (misma pestaña). */
function emitTicketPasosProgress(ticketId: number, completados: number, total: number) {
  window.dispatchEvent(
    new CustomEvent("mckenna-ticket-pasos-updated", {
      detail: { ticketId, pasos_completados: completados, pasos_total: total },
    }),
  );
}

/** Progreso de ejecución por ticket (checklist), no por etapas resueltas de la misión. */
function ticketEjecucionPct(t: Ticket): { pct: number; completados: number; total: number } {
  const { total, completados } = ticketPasosCounts(t);
  if (total > 0) {
    return {
      pct: Math.round((completados / total) * 100),
      completados,
      total,
    };
  }
  if (t.estado === "resuelto") return { pct: 100, completados: 0, total: 0 };
  return { pct: 0, completados: 0, total: 0 };
}

function ticketEjecucionCompleto(t: Ticket): boolean {
  const { pct, total } = ticketEjecucionPct(t);
  if (total > 0) return pct === 100;
  return t.estado === "resuelto";
}

/** Estado visual en tablero: checklist manda sobre el dot cuando hay pasos. */
function estadoOrbEnTablero(t: Ticket): Ticket["estado"] {
  const { total, pct } = ticketEjecucionPct(t);
  if (total > 0) {
    if (pct === 100) return "resuelto";
    if (pct > 0) return "en_proceso";
    return "pendiente";
  }
  return t.estado;
}

function etiquetaChecklistTablero(t: Ticket): string | null {
  const { total, completados, pct } = ticketEjecucionPct(t);
  if (total <= 0) return null;
  return `${pct}% · ${completados}/${total} pasos`;
}

function MisionUbicacionResumen({
  mision,
  zonas,
}: {
  mision: Mision;
  zonas?: ZonaTrabajo[];
}) {
  const accent =
    mision.ubicacion_color
    ?? (mision.zona_id && zonas ? zonaColor(zonaById(zonas, mision.zona_id), mision.zona_id) : null);

  const filas: { label: string; valor: string; color?: string }[] = [];
  if (mision.reino_nombre || mision.reino) {
    filas.push({ label: "Reino", valor: mision.reino_nombre || mision.reino || "" });
  }
  if (mision.zona_nombre) {
    filas.push({
      label: "Zona",
      valor: mision.zona_nombre,
      color: mision.zona_color ?? undefined,
    });
  }
  if (mision.subzona_nombre) filas.push({ label: "Subzona", valor: mision.subzona_nombre });
  if (mision.departamento_nombre) filas.push({ label: "Depto", valor: mision.departamento_nombre });
  if (filas.length === 0) {
    const fallback = mision.ubicacion_label || mision.reino;
    if (!fallback) return null;
    return (
      <p className="mt-1 flex items-center gap-2 text-xs font-semibold text-muted">
        {accent && <ZonaColorDot color={accent} size="sm" />}
        <span>📍 {fallback}</span>
      </p>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {accent && <ZonaColorDot color={accent} title="Ubicación" />}
      {filas.map((f) => (
        <span key={f.label} className="inline-flex items-center gap-1 text-xs text-muted">
          {f.color && <ZonaColorDot color={f.color} size="sm" title={f.label} />}
          <span className="font-bold uppercase tracking-wide text-[10px] text-muted/80">{f.label}</span>{" "}
          <span className="font-semibold text-ink">{f.valor}</span>
        </span>
      ))}
    </div>
  );
}

function MissionTaskStickyItems({
  group,
  tickets,
  isSeq,
  accent,
  onSelect,
}: {
  group: MisionGroup;
  tickets: Ticket[];
  isSeq: boolean;
  accent: string;
  onSelect: (id: number) => void;
}) {
  const canvasWidth = useBoardCanvasWidth();
  const sectionKey = `m-${group.mision_id}-tasks`;
  const done = ["resuelto", "rechazado"];

  return (
    <>
      {tickets.map((t, i) => {
        const prog = ticketEjecucionPct(t);
        const barColor = prog.pct === 100 ? "#16a34a" : accent;
        const checklistLbl = etiquetaChecklistTablero(t);
        const cerrado = done.includes(t.estado);
        return (
          <QuestBoardStickyFrame
            key={t.id}
            sectionKey={sectionKey}
            cardKey={`t:${t.id}`}
            index={i}
            containerWidth={canvasWidth}
            variant="task"
            minAutoH={52}
          >
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className={`quest-sticky-task quest-sticky-task--framed h-full w-full ${cerrado ? "opacity-70" : ""}`}
            >
              <div className="flex w-full items-center gap-1.5">
                <StatusOrb estado={estadoOrbEnTablero(t)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold leading-tight text-ink sm:text-xs">
                    {t.titulo}
                  </p>
                  <div className="flex flex-wrap items-center gap-1 text-[9px] text-muted">
                    <span className="font-mono">{t.numero}</span>
                    {isSeq && tickets.length > 1 && (
                      <span>#{tickets.findIndex((x) => x.id === t.id) + 1}</span>
                    )}
                  </div>
                </div>
                {checklistLbl ? (
                  <span
                    className="shrink-0 text-[10px] font-black tabular-nums"
                    style={{ color: barColor }}
                  >
                    {prog.pct}%
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] font-bold text-muted">—</span>
                )}
                <PrioridadDot p={t.prioridad} />
              </div>
            </button>
          </QuestBoardStickyFrame>
        );
      })}
    </>
  );
}

function MisionGroupCard({
  group, onSelect, onEditMision, onDeleteMision, onColorChange, canDelete, canEditColor, deleting, token,
}: {
  group: MisionGroup;
  onSelect: (id: number) => void;
  onEditMision: (id: number) => void;
  onDeleteMision?: (group: MisionGroup) => void;
  onColorChange?: (misionId: number, color: string) => void | Promise<void>;
  canDelete?: boolean;
  canEditColor?: boolean;
  deleting?: boolean;
  token?: string;
}) {
  const dark = useQuestTheme((s) => s.dark);
  const isSeq = group.mision_tipo === "secuencial";
  const done = ["resuelto", "rechazado"];
  const total = group.tickets.length;
  const isComplete = total > 0 && group.tickets.every(ticketEjecucionCompleto);
  const progMision = misionGrupoEjecucionPct(group);
  const [stickyColor, setStickyColor] = useState(group.mision_color || "#0c6069");
  useEffect(() => {
    setStickyColor(group.mision_color || "#0c6069");
  }, [group.mision_color, group.mision_id]);
  const c = stickyColor;
  const rot = stickyRotation(group.mision_id);

  const ticketsEnSticky = [...group.tickets].sort((a, b) => a.id - b.id);
  const compact = ticketsEnSticky.length <= 2;
  const progColor = progMision.pct === 100 ? "#16a34a" : c;

  const stickyStyle: CSSProperties = {
    transform: `rotate(${rot}deg)`,
    background: stickyPaperBackground(c, dark),
  };

  function onStickyEnter(e: { currentTarget: HTMLElement }) {
    e.currentTarget.style.transform = "rotate(0deg) scale(1.02)";
  }
  function onStickyLeave(e: { currentTarget: HTMLElement }) {
    e.currentTarget.style.transform = `rotate(${rot}deg)`;
  }

  return (
    <article
      className={`quest-sticky quest-sticky-mission h-full w-full min-h-0 ${compact ? "quest-sticky-mission--compact" : ""}`}
      style={stickyStyle}
      onMouseEnter={onStickyEnter}
      onMouseLeave={onStickyLeave}
    >
      <span className="quest-sticky-tape" aria-hidden />

      {/* Botón eliminar misión removido del tablero para evitar eliminaciones accidentales */}

      <div className={`quest-sticky-mission-head ${QUEST_MISION_CHROME}`}>
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-black text-white shadow-sm sm:h-8 sm:w-8"
          style={{ background: c }}
        >
          <TopicIcon value={isSeq ? "🔗" : "⚡"} size={14} weight="fill" className="text-white" />
        </div>
        <button
          type="button"
          onClick={() => onEditMision(group.mision_id)}
          className="quest-sticky-mission-meta text-left transition hover:opacity-90"
          title="Editar misión"
        >
          <h4 className="line-clamp-2 text-sm font-extrabold leading-tight sm:text-[15px]" style={{ color: c }}>
            {group.mision_titulo}
          </h4>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] font-semibold text-muted">
            <span>{isSeq ? "Sec." : "Par."}</span>
            <span>·</span>
            <span>{total} etapa{total !== 1 ? "s" : ""}</span>
            {(group.ubicacion_label || group.reino) && (
              <>
                <span>·</span>
                <span className="inline-flex max-w-full items-center gap-0.5 truncate">
                  {group.ubicacion_color && <ZonaColorDot color={group.ubicacion_color} size="sm" />}
                  <span className="truncate" style={{ color: group.ubicacion_color || undefined }}>
                    {group.ubicacion_label || group.reino}
                  </span>
                </span>
              </>
            )}
            {isComplete && <span className="font-bold text-green-700 dark:text-green-500/70">✓</span>}
          </p>
        </button>
        {progMision.total > 0 && (
          <div className="quest-sticky-mission-pct">
            <span className="text-lg font-black tabular-nums sm:text-xl" style={{ color: progColor }}>
              {progMision.pct}%
            </span>
            <span className="block text-[9px] font-bold text-muted">
              {progMision.completados}/{progMision.total}
            </span>
          </div>
        )}
        {canEditColor && token && onColorChange && (
          <StickyColorPicker
            color={c}
            onSelect={async (hex) => {
              setStickyColor(hex);
              await tapi(`/misiones/${group.mision_id}`, token, {
                method: "PUT",
                body: JSON.stringify({ color: hex }),
              });
              await onColorChange(group.mision_id, hex);
            }}
          />
        )}
      </div>

      {progMision.total > 0 && (
        <div
          className="h-1 w-full overflow-hidden rounded-full border border-black/5 dark:border-white/10"
          style={{ background: dark ? `${c}18` : `${c}12` }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progMision.pct}%`, background: progColor }}
          />
        </div>
      )}

      {ticketsEnSticky.length > 0 ? (
        <QuestBoardStickyCanvas
          sectionKey={`m-${group.mision_id}-tasks`}
          itemCount={ticketsEnSticky.length}
          variant="task"
        >
          <MissionTaskStickyItems
            group={group}
            tickets={ticketsEnSticky}
            isSeq={isSeq}
            accent={c}
            onSelect={onSelect}
          />
        </QuestBoardStickyCanvas>
      ) : (
        <p className="py-0.5 text-center text-[10px] font-medium text-muted">Sin tickets</p>
      )}
    </article>
  );
}

function ReinoBoardStickyItems({
  section,
  onSelect,
  onEditMision,
  onDeleteMision,
  onMisionColorChange,
  canDelete,
  canEditColor,
  deletingMisionId,
  token,
}: {
  section: TableroReinoSection;
  onSelect: (id: number) => void;
  onEditMision: (id: number) => void;
  onDeleteMision?: (group: MisionGroup) => void;
  onMisionColorChange?: (misionId: number, color: string) => void | Promise<void>;
  canDelete?: boolean;
  canEditColor?: boolean;
  deletingMisionId?: number | null;
  token?: string;
}) {
  const canvasWidth = useBoardCanvasWidth();
  let index = 0;

  return (
    <>
      {section.groups.map((group) => {
        const i = index;
        index += 1;
        return (
          <QuestBoardStickyFrame
            key={`m-${group.mision_id}`}
            sectionKey={section.key}
            cardKey={`m:${group.mision_id}`}
            index={i}
            containerWidth={canvasWidth}
            minAutoH={140}
          >
            <MisionGroupCard
              group={group}
              onSelect={onSelect}
              onEditMision={onEditMision}
              onDeleteMision={onDeleteMision}
              onColorChange={onMisionColorChange}
              canDelete={canDelete}
              canEditColor={canEditColor}
              token={token}
              deleting={deletingMisionId === group.mision_id}
            />
          </QuestBoardStickyFrame>
        );
      })}
      {section.standalone.map((t) => {
        const i = index;
        index += 1;
        return (
          <QuestBoardStickyFrame
            key={`t-${t.id}`}
            sectionKey={section.key}
            cardKey={`t:${t.id}`}
            index={i}
            containerWidth={canvasWidth}
            minAutoH={120}
          >
            <TicketCard t={t} onClick={() => onSelect(t.id)} />
          </QuestBoardStickyFrame>
        );
      })}
    </>
  );
}

function ReinoBoardRootItems({
  sections,
  openTableroSections,
  onToggleSection,
  onSelect,
  onEditMision,
  onDeleteMision,
  onMisionColorChange,
  canDelete,
  canEditColor,
  deletingMisionId,
  token,
}: {
  sections: TableroReinoSection[];
  openTableroSections: Set<string>;
  onToggleSection: (key: string) => void;
  onSelect: (id: number) => void;
  onEditMision: (id: number) => void;
  onDeleteMision?: (group: MisionGroup) => void;
  onMisionColorChange?: (misionId: number, color: string) => void | Promise<void>;
  canDelete?: boolean;
  canEditColor?: boolean;
  deletingMisionId?: number | null;
  token?: string;
}) {
  const canvasWidth = useBoardCanvasWidth();

  return (
    <>
      {sections.map((section, i) => (
        <QuestBoardStickyFrame
          key={section.key}
          sectionKey={BOARD_ROOT_SECTION}
          cardKey={`reino:${section.key}`}
          index={i}
          containerWidth={canvasWidth}
          variant="section"
          minAutoH={200}
        >
          <ReinoBoardSectionBlock
            section={section}
            isOpen={openTableroSections.has(section.key)}
            onToggle={() => onToggleSection(section.key)}
            onSelect={onSelect}
            onEditMision={onEditMision}
            onDeleteMision={onDeleteMision}
            onMisionColorChange={onMisionColorChange}
            canDelete={canDelete}
            canEditColor={canEditColor}
            deletingMisionId={deletingMisionId}
            token={token}
            framed
          />
        </QuestBoardStickyFrame>
      ))}
    </>
  );
}

function ReinoBoardSectionBlock({
  section,
  isOpen,
  onToggle,
  onSelect,
  onEditMision,
  onDeleteMision,
  onMisionColorChange,
  canDelete,
  canEditColor,
  deletingMisionId,
  token,
  framed = false,
}: {
  section: TableroReinoSection;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (id: number) => void;
  onEditMision: (id: number) => void;
  onDeleteMision?: (group: MisionGroup) => void;
  onMisionColorChange?: (misionId: number, color: string) => void | Promise<void>;
  canDelete?: boolean;
  canEditColor?: boolean;
  deletingMisionId?: number | null;
  token?: string;
  framed?: boolean;
}) {
  const totalQuests =
    section.groups.reduce((n, g) => n + g.tickets.length, 0) + section.standalone.length;
  const totalMisiones = section.groups.length;

  return (
    <section
      className={`quest-board-reino ${isOpen ? "quest-board-reino--open" : ""} ${framed ? "quest-board-reino--framed h-full w-full" : ""}`}
      style={{ borderColor: `${section.color}55`, ["--reino-accent" as string]: section.color }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="quest-board-reino-header flex w-full items-center gap-2 text-left transition-colors hover:bg-surface-hover/40"
        style={{
          borderLeftColor: section.color,
          background: `linear-gradient(90deg, ${section.color}22 0%, transparent 72%)`,
        }}
        aria-expanded={isOpen}
      >
        <span
          className={`quest-inventario-grupo-chevron ${isOpen ? "quest-inventario-grupo-chevron--open" : ""}`}
          aria-hidden
        >
          ▼
        </span>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm shadow-sm"
          style={{ background: section.color, color: "#fff" }}
        >
          <TopicIcon value={section.icono} fallback="castle" size={16} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-extrabold uppercase tracking-wide text-ink sm:text-sm">
            {section.nombre}
          </h3>
          <p className="text-[9px] font-semibold text-muted">
            {totalMisiones} mis.{totalMisiones !== 1 ? "es" : ""}
            {totalQuests > 0 && (
              <span> · {totalQuests} quest{totalQuests !== 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
      </button>
      {isOpen && (
      <div className="quest-board-cork quest-board-cork--nested p-2.5 sm:p-3">
        {totalMisiones === 0 && section.standalone.length === 0 ? (
          <p className="py-6 text-center text-xs font-medium text-muted">
            Sin misiones activas en este reino
          </p>
        ) : (
          <QuestBoardStickyCanvas
            sectionKey={section.key}
            itemCount={section.groups.length + section.standalone.length}
          >
            <ReinoBoardStickyItems
              section={section}
              onSelect={onSelect}
              onEditMision={onEditMision}
              onDeleteMision={onDeleteMision}
              onMisionColorChange={onMisionColorChange}
              canDelete={canDelete}
              canEditColor={canEditColor}
              deletingMisionId={deletingMisionId}
              token={token}
            />
          </QuestBoardStickyCanvas>
        )}
      </div>
      )}
    </section>
  );
}

function navScopeLabel(scope: NavScope): string {
  if (scope.kind === "all") return "";
  if (scope.kind === "reino") return `Reino: ${scope.nombre}`;
  if (scope.kind === "zona") return `${scope.reinoNombre} › ${scope.nombre}`;
  if (scope.kind === "subzona") return `${scope.reinoNombre} › ${scope.zonaNombre} › ${scope.nombre}`;
  return `${scope.reinoNombre} › ${scope.zonaNombre} › ${scope.subzonaNombre} › ${scope.nombre}`;
}

function TicketListView({
  token, user, onSelect, onEditMision, navScope, refreshKey = 0,
}: {
  token: string; user: TicketsUser;
  onSelect: (id: number) => void;
  onEditMision: (id: number) => void;
  navScope: NavScope;
  refreshKey?: number;
}) {
  const questDark = useQuestTheme((s) => s.dark);
  const resetBoardLayout = useQuestBoardLayout((s) => s.resetAll);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [zonasReinos, setZonasReinos] = useState<ZonaTrabajo[]>([]);
  const [misionesActivas, setMisionesActivas] = useState<Mision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [deletingMisionId, setDeletingMisionId] = useState<number | null>(null);
  const [openTableroSections, setOpenTableroSections] = useState<Set<string>>(() => new Set());
  const [boardLocked, setBoardLocked] = useState(true);

  const nivel = user.rol?.nivel ?? 1;
  const canDeleteMision = nivel >= 3;
  const canEditMisionColor = nivel >= 2;

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(""); }
    try {
      const params = new URLSearchParams();
      if (filtroEstado) params.set("estado", filtroEstado);
      const [data, zonas] = await Promise.all([
        tapi(`/?${params}`, token),
        tapi("/zonas-trabajo", token),
      ]);
      let misiones: Mision[] = [];
      try {
        const raw = await tapi("/misiones/?tablero=1", token);
        misiones = Array.isArray(raw) ? raw : [];
      } catch {
        try {
          const raw = await tapi("/misiones/", token);
          misiones = Array.isArray(raw) ? raw : [];
        } catch { misiones = []; }
      }
      const list = Array.isArray(data) ? data.map((row) => normalizeTicketForList(row)) : [];
      setTickets((prev) => {
        const nextStr = JSON.stringify(list.map((t) => ({ id: t.id, estado: t.estado, titulo: t.titulo })));
        const prevStr = JSON.stringify(prev.map((t) => ({ id: t.id, estado: t.estado, titulo: t.titulo })));
        return nextStr === prevStr ? prev : list;
      });
      const nextZonas = Array.isArray(zonas) ? zonas : [];
      setZonasReinos((prev) => {
        const nextStr = JSON.stringify(nextZonas);
        return JSON.stringify(prev) === nextStr ? prev : nextZonas;
      });
      const activas = misiones.filter(
        (m) => m.estado === "activa" || m.estado === "borrador",
      );
      setMisionesActivas((prev) => {
        const nextStr = JSON.stringify(activas.map((m) => m.id));
        const prevStr = JSON.stringify(prev.map((m) => m.id));
        return nextStr === prevStr ? prev : activas;
      });
      if (!silent) setError("");
    } catch (e: any) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token, filtroEstado]);

  useEffect(() => { load(false); }, [load, refreshKey]);

  useEffect(() => {
    const id = window.setInterval(() => { void load(true); }, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const onPasosUpdated = (ev: Event) => {
      const d = (ev as CustomEvent<{
        ticketId: number;
        pasos_total: number;
        pasos_completados: number;
      }>).detail;
      if (!d?.ticketId) return;
      const patch = {
        pasos_total: d.pasos_total,
        pasos_completados: d.pasos_completados,
      };
      setTickets((prev) =>
        prev.map((t) => (t.id === d.ticketId ? { ...t, ...patch } : t)),
      );
      setMisionesActivas((prev) =>
        prev.map((m) => ({
          ...m,
          tickets_tablero: m.tickets_tablero?.map((row) =>
            row.id === d.ticketId ? { ...row, ...patch } : row,
          ),
        })),
      );
    };
    window.addEventListener("mckenna-ticket-pasos-updated", onPasosUpdated);
    return () => window.removeEventListener("mckenna-ticket-pasos-updated", onPasosUpdated);
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const scopeActivo = navScope.kind !== "all";
  const ticketsVisibles = tickets.filter((t) => ticketEnNavScope(t, zonasReinos, navScope));
  const ticketsFiltered = ticketsVisibles.filter((t) => {
    if (filtroEstado && t.estado !== filtroEstado) return false;
    return true;
  });
  const hasFilters = !!(filtroEstado || scopeActivo);
  const vistaAgrupada = !filtroEstado;

  // Group tickets by mission when no estado filter
  const misionGroups = new Map<number, MisionGroup>();
  const standalone: Ticket[] = [];

  if (vistaAgrupada) {
    for (const t of ticketsFiltered) {
      if (t.mision_id) {
        if (!misionGroups.has(t.mision_id)) {
          misionGroups.set(t.mision_id, {
            mision_id: t.mision_id,
            mision_titulo: t.mision_titulo || `Misión #${t.mision_id}`,
            mision_color: t.mision_color || "#0c6069",
            mision_tipo: t.mision_tipo || "secuencial",
            reino: t.mision_reino || null,
            zona_id: t.mision_zona_id ?? null,
            reino_id: t.mision_zona_id
              ? zonaRaizId(zonasReinos, t.mision_zona_id)
              : null,
            tickets: [],
          });
        }
        misionGroups.get(t.mision_id)!.tickets.push(t);
      } else {
        standalone.push(t);
      }
    }
    for (const m of misionesActivas) {
      const enScope = navScope.kind === "all" || (
        m.zona_id != null
          ? misionZonaEnScope(m.zona_id, zonasReinos, navScope)
          : misionCoincideScope(m.reino, navScope)
      );
      if (!enScope) continue;
      if (!misionGroups.has(m.id)) {
        misionGroups.set(m.id, {
          mision_id: m.id,
          mision_titulo: m.titulo,
          mision_color: m.color || "#0c6069",
          mision_tipo: m.tipo || "secuencial",
          reino: m.reino || m.reino_nombre || null,
          reino_id: m.reino_id ?? (m.zona_id ? zonaRaizId(zonasReinos, m.zona_id) : null),
          zona_id: m.zona_id ?? null,
          ubicacion_label: m.ubicacion_label ?? null,
          tickets: [],
        });
      }
    }
    if (vistaAgrupada) {
      mergeMisionGroupsWithTablero(misionGroups, misionesActivas, zonasReinos);
    }
  }

  const reinoSections = vistaAgrupada
    ? buildTableroReinoSections(misionGroups, standalone, zonasReinos, navScope)
    : groupTicketsFlatByReino(ticketsFiltered, zonasReinos, navScope);

  const tableroNavKey = useMemo(
    () => (navScope.kind === "all" ? "all" : `${navScope.kind}:${navScope.id}`),
    [navScope],
  );
  useEffect(() => {
    if (!reinoSections.length) {
      setOpenTableroSections(new Set());
      return;
    }
    // Abrir TODOS los reinos por defecto para que las misiones sean visibles
    const open = new Set<string>(reinoSections.map((s) => s.key));
    setOpenTableroSections(open);
  }, [tableroNavKey, reinoSections.length]);

  function toggleTableroSection(key: string) {
    setOpenTableroSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleMisionColorChange(misionId: number, color: string) {
    setMisionesActivas((prev) =>
      prev.map((m) => (m.id === misionId ? { ...m, color } : m)),
    );
    setTickets((prev) =>
      prev.map((t) => (t.mision_id === misionId ? { ...t, mision_color: color } : t)),
    );
  }

  async function handleDeleteMision(group: MisionGroup) {
    const n = group.tickets.length;
    const msg = n > 0
      ? `¿Eliminar la misión "${group.mision_titulo}" y sus ${n} quest(s) asociados?\n\nEsta acción no se puede deshacer.`
      : `¿Eliminar la misión "${group.mision_titulo}"?\n\nEsta acción no se puede deshacer.`;
    if (!window.confirm(msg)) return;
    setDeletingMisionId(group.mision_id);
    setError("");
    try {
      await tapi(`/misiones/${group.mision_id}`, token, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar la misión");
    } finally {
      setDeletingMisionId(null);
    }
  }

  const stats = {
    pendientes: ticketsVisibles.filter((t) => t.estado === "pendiente").length,
    en_proceso: ticketsVisibles.filter((t) => t.estado === "en_proceso").length,
    esperando:  ticketsVisibles.filter((t) => t.estado === "esperando_aprobacion").length,
    resueltos:  ticketsVisibles.filter((t) => t.estado === "resuelto").length,
  };

  return (
    <div className="space-y-3">
      <div className="quest-board-toolbar">
        <div className="quest-board-toolbar-brand">
          <QuestBoardTitle editable />
          <p className="quest-board-kimdom-sub">
            {user.nombre}
            <span className="mx-1 text-muted/50">·</span>
            <span className="font-bold text-accent quest-board-accent-count">{ticketsVisibles.length}</span>
            {" "}quest{ticketsVisibles.length !== 1 ? "s" : ""}
            {scopeActivo && (
              <span className="ml-1 inline-block rounded-full border border-accent/40 bg-accent/10 px-1 py-px text-[8px] font-bold text-accent">
                {navScopeLabel(navScope)}
              </span>
            )}
          </p>
        </div>
        <div className="quest-board-toolbar-row">
        <div className="quest-board-toolbar-stats">
          {QUEST_STAT_ITEMS.map((s) => {
            const val = stats[s.key];
            const valueColor = questTone(s.color, s.colorDark, questDark);
            const borderColor = questDark ? s.borderDark : `${s.color}44`;
            return (
              <span
                key={s.label}
                className="quest-board-stat-pill bg-surface-panel"
                style={{ borderColor, color: valueColor }}
                title={s.label}
              >
                <span className="opacity-70 inline-flex items-center gap-0.5">
                  <Icon name={s.icon} size={11} weight="duotone" />
                  {s.label.split(" ")[0]}
                </span>
                <span>{val}</span>
              </span>
            );
          })}
        </div>
        <div className="quest-board-toolbar-actions">
          {reinoSections.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpenTableroSections(new Set(reinoSections.map((s) => s.key)))}
                className="quest-board-toolbar-btn inline-flex items-center gap-1"
                title="Expandir todos los reinos"
              >
                <Icon name="expand" size={14} weight="bold" />
                Expandir
              </button>
              <button
                type="button"
                onClick={() => setOpenTableroSections(new Set())}
                className="quest-board-toolbar-btn inline-flex items-center gap-1"
                title="Colapsar todos los reinos"
              >
                <Icon name="collapse" size={14} weight="bold" />
                Colapsar
              </button>
            </>
          )}
          <label className="quest-board-toolbar-select-wrap inline-flex items-center gap-1">
            <Icon name="funnel" size={14} weight="bold" className="shrink-0 text-muted" aria-hidden />
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              className="quest-board-toolbar-select border-0 bg-transparent p-0 focus:ring-0"
              aria-label="Filtrar por estado"
            >
            <option value="">Estado</option>
            <option value="pendiente">⏳ Pendiente</option>
            <option value="en_proceso">⚔️ En proceso</option>
            <option value="esperando_aprobacion">🔔 Revisión</option>
            <option value="resuelto">✅ Resuelto</option>
            <option value="rechazado">❌ Rechazado</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => load(false)}
            className="quest-board-toolbar-btn"
            title="Actualizar"
            aria-label="Actualizar"
          >
            <Icon name="refresh" size={14} weight="bold" />
          </button>
          {hasFilters && (
            <button
              type="button"
              onClick={() => setFiltroEstado("")}
              className="quest-board-toolbar-btn quest-board-toolbar-btn--danger"
              title="Quitar filtro de estado"
              aria-label="Quitar filtro"
            >
              <Icon name="close" size={14} weight="bold" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setBoardLocked((v) => !v)}
            className={`quest-board-toolbar-btn ${boardLocked ? "" : "quest-board-toolbar-btn--active"}`}
            title={boardLocked ? "Tablero bloqueado — clic para editar posición y tamaño" : "Modo edición activo — clic para bloquear"}
            aria-label={boardLocked ? "Desbloquear tablero" : "Bloquear tablero"}
          >
            <Icon name={boardLocked ? "lock" : "unlock"} size={14} weight="bold" />
          </button>
          {!boardLocked && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("¿Restablecer posición y tamaño de todos los tableros?")) {
                  resetBoardLayout();
                }
              }}
              className="quest-board-toolbar-btn"
              title="Volver a la disposición automática"
              aria-label="Restablecer disposición"
            >
              <Icon name="gridReset" size={14} weight="bold" />
            </button>
          )}
        </div>
        </div>
        <p className="quest-board-toolbar-hint">
          {boardLocked
            ? "Tablero bloqueado. Usa 🔒 para editar posición y tamaño."
            : "Modo edición: arrastra con ⠿ y redimensiona desde la esquina. Se guarda en este navegador."}
        </p>
      </div>

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Cargando...</div>
      ) : error ? (
        <div className={ALERT_ERROR}>{error}</div>
      ) : reinoSections.length === 0 && ticketsFiltered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">
          {scopeActivo
            ? `No hay misiones en ${navScopeLabel(navScope)}.`
            : "No hay misiones en el tablero. Crea reinos en 🏰 Reinos y vincula la ubicación al crear la misión."}
        </div>
      ) : reinoSections.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">
          No hay misiones agrupadas. Revisa el filtro de estado o crea una misión en + Nueva misión.
        </div>
      ) : (
        <div className={`quest-board-by-reinos${boardLocked ? " quest-board--locked" : ""}`}>
          <QuestBoardStickyCanvas
            sectionKey={BOARD_ROOT_SECTION}
            itemCount={reinoSections.length}
            variant="section"
          >
            <ReinoBoardRootItems
              sections={reinoSections}
              openTableroSections={openTableroSections}
              onToggleSection={toggleTableroSection}
              onSelect={onSelect}
              onEditMision={onEditMision}
              onDeleteMision={canDeleteMision ? handleDeleteMision : undefined}
              onMisionColorChange={canEditMisionColor ? handleMisionColorChange : undefined}
              canDelete={canDeleteMision}
              canEditColor={canEditMisionColor}
              deletingMisionId={deletingMisionId}
              token={token}
            />
          </QuestBoardStickyCanvas>
        </div>
      )}
    </div>
  );
}

// Create ticket form
function CreateTicketView({
  token, user, onBack, onCreated,
}: {
  token: string; user: TicketsUser;
  onBack: () => void;
  onCreated: (id: number) => void;
}) {
  const { cats: categorias } = useContext(CategoriasCtx);
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    titulo: "", categoria: "", descripcion: "",
    prioridad: "media", asignado_a: "",
  });
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    tapi("/usuarios", token).then(setUsuarios).catch(() => {});
  }, [token]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.titulo || !form.categoria || !form.descripcion) {
      setError("Título, categoría y descripción son requeridos");
      return;
    }
    if (form.categoria === "rrhh" && !file) {
      setError("Los tickets de RR.HH. requieren un soporte documental (PDF o imagen)");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("titulo", form.titulo);
      fd.append("categoria", form.categoria);
      fd.append("descripcion", form.descripcion);
      fd.append("prioridad", form.prioridad);
      if (form.asignado_a) fd.append("asignado_a", form.asignado_a);
      if (file) fd.append("soporte_archivo", file);
      const ticket = await tapi("/", token, { method: "POST", body: fd });
      onCreated(ticket.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ←
        </button>
        <h2 className="text-xl font-extrabold text-ink">Nuevo Ticket</h2>
      </div>

      <form onSubmit={handleSubmit} className="rounded-paper border-2 border-border bg-surface-panel p-6 shadow-paper space-y-5">
        {/* Título */}
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Título *</label>
          <input
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent"
            placeholder="Describe el problema brevemente"
            value={form.titulo} onChange={set("titulo")} maxLength={150}
          />
        </div>

        {/* Categoría + Prioridad */}
        <div className={TICKET_FORM_GRID_2}>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Categoría *</label>
            <select
              className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent"
              value={form.categoria} onChange={set("categoria")} required
            >
              <option value="">Seleccionar...</option>
              {categorias.map((c) => (
                <option key={c.slug} value={c.slug}>{c.icono} {c.nombre}</option>
              ))}
            </select>
            {form.categoria === "rrhh" && (
              <p className="mt-1 text-xs font-medium text-amber-700">
                ⚠️ Requiere soporte documental (EPS, certificado, etc.)
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Prioridad</label>
            <select
              className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent"
              value={form.prioridad} onChange={set("prioridad")}
            >
              <option value="baja">⬇️ Baja</option>
              <option value="media">➡️ Media</option>
              <option value="alta">⬆️ Alta</option>
              <option value="urgente">🔴 Urgente</option>
            </select>
          </div>
        </div>

        {/* Descripción */}
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Descripción detallada *</label>
          <textarea
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent resize-none"
            rows={4} placeholder="Describe el problema con todos los detalles necesarios..."
            value={form.descripcion} onChange={set("descripcion")} required
          />
        </div>

        {/* Asignar a */}
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Asignar a (opcional)</label>
          <select
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent"
            value={form.asignado_a} onChange={set("asignado_a")}
          >
            <option value="">Sin asignar</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre} — {u.departamento?.nombre}</option>
            ))}
          </select>
        </div>

        {/* Archivo */}
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">
            Soporte documental {form.categoria === "rrhh" ? "* (obligatorio para RR.HH.)" : "(opcional)"}
          </label>
          <div
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer rounded-paper border-2 border-dashed p-4 text-center transition
              ${file ? "border-accent bg-surface-hover" : "border-border hover:border-accent"}`}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-accent">
                <span>📎</span> {file.name}
                <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="ml-2 text-muted hover:text-danger font-bold">✕</button>
              </div>
            ) : (
              <p className="text-sm text-muted">
                📎 Haz clic o arrastra un archivo (PDF, JPG, PNG · máx. 10MB)
              </p>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>

        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onBack}
            className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted transition hover:bg-surface-hover">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="rounded-paper border-2 border-accent bg-accent px-6 py-2 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50">
            {loading ? "Creando..." : "Crear Ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Cronómetro persistido por ticket (pausa / guardar en bitácora). */
function TicketCronometroSection({
  ticket,
  token,
  onTicket,
}: {
  ticket: Ticket;
  token: string;
  onTicket: (t: Ticket) => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const corrida = ticket.corrida;
  const corridaId = corrida?.id;
  const corridaActiva = corrida?.estado === "activa";
  const cerrado = !ticketPermiteMarcarPasos(ticket);

  const refresh = useCallback(async () => {
    onTicket(await tapi(`/${ticket.id}`, token));
  }, [ticket.id, token, onTicket]);

  useEffect(() => {
    if (!corridaId || !corridaActiva) return;
    const iv = setInterval(() => { refresh().catch(() => {}); }, 2000);
    return () => clearInterval(iv);
  }, [corridaId, corridaActiva, refresh]);

  const segDisplay =
    corrida?.segundos_transcurridos ??
    corrida?.segundos_acumulados ??
    ticket.segundos_trabajo ??
    Math.round((ticket.total_horas ?? 0) * 3600);

  async function iniciar() {
    try {
      onTicket(await tapi(`/${ticket.id}/corridas/iniciar`, token, {
        method: "POST",
        body: JSON.stringify({ segundos_previos: 0 }),
      }));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al iniciar cronómetro");
    }
  }

  async function pausar() {
    if (!corridaId) return;
    try {
      onTicket(await tapi(`/corridas/${corridaId}/pausar`, token, { method: "POST" }));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al pausar");
    }
  }

  async function reanudar() {
    if (!corridaId) return;
    try {
      onTicket(await tapi(`/corridas/${corridaId}/reanudar`, token, { method: "POST" }));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al reanudar");
    }
  }

  async function guardar() {
    if (!corridaId) return;
    setGuardando(true);
    try {
      const t = await tapi(`/corridas/${corridaId}/guardar`, token, { method: "POST" });
      onTicket(t);
      alert(`Tramo guardado en bitácora — acumulado ticket: ${fmtTiempo(t.segundos_trabajo ?? 0)}`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al guardar tiempo");
    } finally {
      setGuardando(false);
    }
  }

  async function finalizar() {
    if (!corridaId) return;
    try {
      onTicket(await tapi(`/corridas/${corridaId}/finalizar`, token, { method: "POST" }));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al finalizar");
    }
  }

  const estadoUi: "activa" | "pausada" | "finalizada" | null =
    cerrado
      ? corrida?.estado === "activa" || corrida?.estado === "pausada"
        ? (corrida.estado as "activa" | "pausada")
        : null
      : corrida?.estado === "activa" || corrida?.estado === "pausada"
        ? (corrida.estado as "activa" | "pausada")
        : null;

  return (
    <div className="rounded-xl border-2 border-accent/40 bg-accent/5 p-4 shadow-paper">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
        ⏱ Cronómetro del ticket
      </p>
      {cerrado && (
        <p className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
          Ticket cerrado — solo lectura del tiempo acumulado.
        </p>
      )}
      <p className="mb-2 text-xs text-muted">
        Acumulado:{" "}
        <strong className="font-mono text-ink">{fmtTiempo(ticket.segundos_trabajo ?? segDisplay)}</strong>
      </p>
      {cerrado && !estadoUi ? (
        <p className="text-sm font-mono font-bold text-ink">{fmtTiempo(segDisplay)}</p>
      ) : (
        <CorridaCronometroBlock
          compact
          etiqueta={ticket.numero}
          segundos={segDisplay}
          estado={estadoUi}
          guardando={guardando}
          onIniciar={iniciar}
          onPausar={pausar}
          onReanudar={reanudar}
          onGuardar={guardar}
          onFinalizar={finalizar}
        />
      )}
    </div>
  );
}

/** Barra inferior: guardar cronómetro en bitácora y refrescar ticket. */
function TicketBarraGuardado({
  ticket,
  token,
  onRefresh,
  compact = false,
}: {
  ticket: Ticket;
  token: string;
  onRefresh: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const corrida = ticket.corrida;
  const puedeGuardarTiempo =
    corrida && (corrida.estado === "activa" || corrida.estado === "pausada");

  async function guardar() {
    setSaving(true);
    setMsg(null);
    try {
      if (puedeGuardarTiempo && corrida?.id) {
        await tapi(`/corridas/${corrida.id}/guardar`, token, { method: "POST" });
      }
      await onRefresh();
      setMsg(
        puedeGuardarTiempo
          ? "Tiempo y progreso guardados"
          : "Progreso actualizado",
      );
      window.setTimeout(() => setMsg(null), 3500);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border-2 border-border bg-surface-panel shadow-paper
        ${compact ? "p-2" : "sticky bottom-2 z-20 p-3"}`}
    >
      <button
        type="button"
        onClick={() => void guardar()}
        disabled={saving}
        className="rounded-paper border-2 border-sky-600 bg-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_2px_0_#0369a1] transition hover:bg-sky-700 disabled:opacity-50"
      >
        {saving ? "Guardando…" : "💾 Guardar"}
      </button>
      {puedeGuardarTiempo && (
        <span className="text-[10px] text-muted">Incluye el tramo del cronómetro en la bitácora</span>
      )}
      {msg && (
        <span
          className={`text-xs font-semibold ${msg.includes("Error") ? "text-danger" : "text-green-700"}`}
        >
          {msg}
        </span>
      )}
    </div>
  );
}

function TicketBarraGuardadoById({
  ticketId,
  token,
  onRefresh,
  compact = false,
}: {
  ticketId: number;
  token: string;
  onRefresh?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    const t = await tapi(`/${ticketId}`, token);
    setTicket(t);
    return t;
  }, [ticketId, token]);

  useEffect(() => { void load(); }, [load]);

  if (!ticket) return null;

  return (
    <TicketBarraGuardado
      compact={compact}
      ticket={ticket}
      token={token}
      onRefresh={async () => {
        await load();
        await onRefresh?.();
      }}
    />
  );
}

/** Carga el ticket y muestra el cronómetro (misión inline o vistas sin estado previo). */
function TicketCronometroById({ ticketId, token }: { ticketId: number; token: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    tapi(`/${ticketId}`, token)
      .then((t) => { setTicket(t); setErr(""); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Error al cargar"));
  }, [ticketId, token]);

  useEffect(() => { load(); }, [load]);

  if (err) {
    return (
      <p className="text-xs text-danger rounded-lg border border-danger/30 bg-danger/10 px-2 py-1.5">
        Cronómetro: {err}
      </p>
    );
  }
  if (!ticket) {
    return <p className="text-xs text-muted py-1">Cargando cronómetro…</p>;
  }
  return <TicketCronometroSection ticket={ticket} token={token} onTicket={setTicket} />;
}

// Ticket detail — ejecución: cronómetro del ticket + checklist de pasos
function TicketDetailView({
  token, user, ticketId, onBack,
}: {
  token: string; user: TicketsUser; ticketId: number; onBack: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showComentarios, setShowComentarios] = useState(false);
  const [completandoTicket, setCompletandoTicket] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isAdmin = (user.rol?.nivel ?? 1) >= 3;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTicket(await tapi(`/${ticketId}`, token));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, ticketId]);

  useEffect(() => { reload(); }, [reload]);

  async function handleAllPasosComplete() {
    setCompletandoTicket(true);
    try {
      await reload();
    } finally {
      setCompletandoTicket(false);
    }
  }

  async function handleEliminarTicket() {
    setDeleting(true);
    try {
      await tapi(`/${ticketId}`, token, { method: "DELETE" });
      onBack();
    } catch (e: any) {
      setError(e.message || "No se pudo eliminar el ticket");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div className="py-16 text-center text-sm text-muted">Cargando quest...</div>;
  if (error || !ticket) return (
    <div className="space-y-3">
      <button onClick={onBack} className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition"><QuestBoardBackLabel /></button>
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || "No encontrado"}</div>
    </div>
  );

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack}
          className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          <QuestBoardBackLabel />
        </button>
        <span className="font-mono text-sm font-bold text-muted">{ticket.numero}</span>
        <CategoriaBadge cat={ticket.categoria} />
        <PrioridadBadge p={ticket.prioridad} />
        <EstadoBadge estado={ticket.estado} />
        {ticket.total_horas != null && ticket.total_horas > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 border border-accent/30 px-2.5 py-0.5 text-xs font-bold text-accent">
            ⏱ {fmtHoras(ticket.total_horas!)}
          </span>
        )}
        <span className="ml-auto rounded-full bg-accent/10 border border-accent/30 px-2.5 py-0.5 text-[10px] font-bold text-accent">
          ▶ Ejecución
        </span>
      </div>

      <TicketCronometroSection ticket={ticket} token={token} onTicket={setTicket} />

      <TicketRecurrenciaSection
        ticket={ticket}
        token={token}
        onTicket={setTicket}
        canEdit={(user?.rol?.nivel ?? 1) >= 2}
      />

      {/* Quest info card — read only */}
      <div className="rounded-xl border-2 border-border bg-surface-panel p-5 shadow-paper space-y-3">
        {ticket.mision_info && ticket.etapa_info && (
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
            style={{ borderColor: ticket.mision_info.color + "66", background: ticket.mision_info.color + "18", color: ticket.mision_info.color }}>
            🎯 {ticket.mision_info.titulo} · Etapa {ticket.etapa_info.orden}/{ticket.mision_info.total_etapas}
          </div>
        )}
        {ticket.bloqueado_por && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600">
            🔒 Bloqueado por {ticket.bloqueado_por_numero}
          </div>
        )}
        <h2 className="text-lg font-extrabold text-ink">{ticket.titulo}</h2>
        {ticket.descripcion && (
          <p className="whitespace-pre-wrap text-sm text-ink border-t border-border pt-3">{ticket.descripcion}</p>
        )}
        {ticket.soporte_archivo && (
          <a href={`/api/tickets/uploads/${ticket.soporte_archivo}?token=${token}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border-2 border-border px-3 py-1 text-xs font-semibold text-accent hover:border-accent transition">
            📎 Ver adjunto
          </a>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted border-t border-border pt-3">
          <span>Creado por: <strong className="text-ink">{ticket.creado_por_info?.nombre || "—"}</strong></span>
          <span>{fmtDate(ticket.creado_en)}</span>
          {ticket.asignado_a_info && (
            <span>Asignado a: <strong className="text-ink">{ticket.asignado_a_info.nombre}</strong></span>
          )}
        </div>
      </div>

      {/* Pasos — checklist */}
      {completandoTicket && (
        <div className="rounded-xl border-2 border-green-400 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
          ✅ Todos los pasos completados — ticket marcado como resuelto
        </div>
      )}
      {ticket.estado === "resuelto" && (
        <div className="rounded-xl border-2 border-green-400 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
          ✅ Ticket completado — todos los pasos del procedimiento están marcados
        </div>
      )}
      <PasosSection
        ticketId={ticket.id}
        token={token}
        editMode={false}
        allowCheck={ticketPermiteMarcarPasos(ticket)}
        checkHint={
          !ticketPermiteMarcarPasos(ticket)
            ? "Este ticket ya está cerrado — no se pueden marcar pasos."
            : undefined
        }
        onAllComplete={ticketPermiteMarcarPasos(ticket) ? handleAllPasosComplete : undefined}
        onGuardarExtra={reload}
      />

      {/* Materiales — solo referencia */}
      <MaterialesSection ticketId={ticket.id} token={token} readonly={true} />

      {/* Participantes — solo visualización */}
      {ticket.participantes && ticket.participantes.length > 0 && (
        <div className="rounded-xl border-2 border-border bg-surface-panel p-5 shadow-paper">
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Participantes</h3>
          <div className="flex flex-wrap gap-2">
            {ticket.participantes.map((p) => (
              <div key={p.usuario_id}
                className="flex items-center gap-1.5 rounded-full border-2 border-border bg-surface px-3 py-1 text-xs font-semibold">
                <span className="text-ink">{p.usuario_nombre}</span>
                <span className="text-muted capitalize">· {p.rol}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <TicketBarraGuardado ticket={ticket} token={token} onRefresh={reload} />

      {/* Comentarios — solo lectura */}
      {ticket.comentarios && ticket.comentarios.length > 0 && (
        <div className="rounded-xl border-2 border-border bg-surface-panel shadow-paper overflow-hidden">
          <button
            className="flex w-full items-center justify-between px-5 py-3 text-left"
            onClick={() => setShowComentarios((v) => !v)}>
            <span className="text-sm font-extrabold uppercase tracking-wide text-muted">
              💬 Comentarios
              <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-bold">{ticket.comentarios.length}</span>
            </span>
            <span className="text-xs text-muted">{showComentarios ? "▲" : "▼"}</span>
          </button>
          {showComentarios && (
            <div className="border-t border-border px-5 pb-5 mt-3 space-y-2">
              {ticket.comentarios.map((c) => (
                <div key={c.id}
                  className={`rounded-xl border-2 p-3 ${c.es_interno ? "border-amber-200 bg-amber-50" : "border-border bg-surface"}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-bold text-ink">{c.autor_nombre}</span>
                    <div className="flex items-center gap-2">
                      {Boolean(c.es_interno) && <span className="text-xs font-semibold text-amber-700">🔒 Interno</span>}
                      <span className="text-xs text-muted">{fmtDate(c.creado_en)}</span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ink">{c.texto}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Admin: eliminar ticket */}
      {isAdmin && (
        <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-red-700">Zona de peligro</p>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 rounded-lg border-2 border-red-500 px-4 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 transition"
            >
              <Icon name="trash" size={13} weight="bold" />
              Eliminar ticket
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-red-700">¿Eliminar permanentemente este ticket?</span>
              <button
                type="button"
                disabled={deleting}
                onClick={handleEliminarTicket}
                className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Eliminando…" : "Sí, eliminar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border-2 border-border px-4 py-1.5 text-xs font-bold text-muted hover:text-ink"
              >
                Cancelar
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

// Admin: Users, Roles, Departments
function AdminView({ token, onBack }: { token: string; onBack: () => void }) {
  const { user: currentUser } = useTicketsAuth();
  const nivel = currentUser?.rol?.nivel ?? 1;
  const { cats: categorias, reload: reloadCats } = useContext(CategoriasCtx);
  const [tab, setTab] = useState<"usuarios" | "roles" | "departamentos" | "categorias">("usuarios");
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<"user" | "rol" | "dept" | null>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Category form state
  const [catForm, setCatForm] = useState({ slug: "", nombre: "", color: "#0c6069", icono: "📋" });
  const [catError, setCatError] = useState("");
  const [catSaving, setCatSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [us, rs, ds] = await Promise.all([
        tapi("/usuarios", token),
        tapi("/roles", token),
        tapi("/departamentos", token),
      ]);
      setUsuarios(Array.isArray(us) ? us : []);
      setRoles(Array.isArray(rs) ? rs : []);
      setDepts(Array.isArray(ds) ? ds : []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  function openModal(type: typeof modal, item: any = null) {
    setModal(type);
    setEditItem(item);
    setError("");
    if (type === "user") {
      const deptIds = item ? (item.departamentos || []).map((d: any) => d.id) : [];
      setForm(item
        ? { ...item, departamentos_ids: deptIds }
        : { activo: 1, departamentos_ids: [] });
    } else {
      setForm(item ? { ...item } : { activo: 1, color: "#0c6069", nivel: 1 });
    }
  }

  async function saveUser() {
    if (!form.nombre || !form.username || !form.rol_id) {
      setError("Nombre completo, alias y rol son requeridos"); return;
    }
    setSaving(true);
    const payload = {
      nombre: form.nombre,
      username: form.username,
      email: form.email || null,
      rol_id: form.rol_id,
      activo: form.activo ?? 1,
      departamentos_ids: form.departamentos_ids || [],
      permisos_secciones: form.permisos_secciones || null,
    };
    try {
      if (editItem) {
        await tapi(`/usuarios/${editItem.id}`, token, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await tapi("/usuarios", token, { method: "POST", body: JSON.stringify(payload) });
      }
      setModal(null);
      await reload();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function saveRol() {
    if (!form.nombre || !form.nivel) { setError("Nombre y nivel requeridos"); return; }
    setSaving(true);
    try {
      if (editItem) {
        await tapi(`/roles/${editItem.id}`, token, { method: "PUT", body: JSON.stringify(form) });
      } else {
        await tapi("/roles", token, { method: "POST", body: JSON.stringify(form) });
      }
      setModal(null);
      await reload();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function saveDept() {
    if (!form.nombre) { setError("Nombre requerido"); return; }
    setSaving(true);
    try {
      if (editItem) {
        await tapi(`/departamentos/${editItem.id}`, token, { method: "PUT", body: JSON.stringify(form) });
      } else {
        await tapi("/departamentos", token, { method: "POST", body: JSON.stringify(form) });
      }
      setModal(null);
      await reload();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function crearCategoria() {
    if (!catForm.slug || !catForm.nombre) { setCatError("Slug y nombre son requeridos"); return; }
    setCatSaving(true);
    setCatError("");
    try {
      await tapi("/categorias/", token, { method: "POST", body: JSON.stringify(catForm) });
      setCatForm({ slug: "", nombre: "", color: "#0c6069", icono: "📋" });
      reloadCats();
    } catch (e: any) { setCatError(e.message); }
    finally { setCatSaving(false); }
  }

  async function eliminarCategoria(slug: string, nombre: string) {
    if (!confirm(`¿Eliminar la categoría "${nombre}"?\nSolo se puede eliminar si no tiene tickets asociados.`)) return;
    try {
      await tapi(`/categorias/${slug}`, token, { method: "DELETE" });
      reloadCats();
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">←</button>
        <h2 className="text-xl font-extrabold text-ink">Administración</h2>
      </div>

      <div className="sticky top-[3.25rem] z-10 flex flex-wrap gap-2 border-b border-border bg-surface-panel/95 py-2 backdrop-blur-md">
        {(["usuarios", "roles", "departamentos", "categorias"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-paper border-2 px-4 py-1.5 text-sm font-bold capitalize transition
              ${tab === t ? "border-accent bg-surface-hover text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t === "usuarios" ? "👤 Usuarios"
              : t === "roles" ? "🎭 Roles"
              : t === "departamentos" ? "🏢 Departamentos"
              : "🏷️ Categorías"}
          </button>
        ))}
      </div>

      {tab === "categorias" ? (
        <div className="space-y-4">
          {/* Create form */}
          <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Nueva categoría</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-muted">Slug (identificador único)</label>
                <input
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="ej: produccion"
                  value={catForm.slug}
                  onChange={(e) => setCatForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, "_") }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-muted">Nombre visible</label>
                <input
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="ej: Producción"
                  value={catForm.nombre}
                  onChange={(e) => setCatForm((f) => ({ ...f, nombre: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-muted">Ícono</label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {TOPIC_ICON_PRESETS.map((p) => (
                    <button
                      key={p.emoji}
                      type="button"
                      title={p.label}
                      onClick={() => setCatForm((f) => ({ ...f, icono: p.emoji }))}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border-2 transition ${
                        catForm.icono === p.emoji
                          ? "border-accent bg-accent/15"
                          : "border-border bg-surface-input hover:border-accent/50"
                      }`}
                    >
                      <TopicIcon value={p.emoji} size={16} weight="duotone" />
                    </button>
                  ))}
                </div>
                <input
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="Emoji o ícono personalizado"
                  value={catForm.icono}
                  onChange={(e) => setCatForm((f) => ({ ...f, icono: e.target.value }))}
                  maxLength={4}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-muted">Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={catForm.color}
                    onChange={(e) => setCatForm((f) => ({ ...f, color: e.target.value }))}
                    className="h-9 w-14 cursor-pointer rounded-paper border-2 border-border p-0.5" />
                  <span className="text-xs font-mono text-muted">{catForm.color}</span>
                  {catForm.slug && catForm.nombre && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={{ background: catForm.color + "22", color: catForm.color }}>
                      <TopicIcon value={catForm.icono} size={14} className="shrink-0" />
                      {catForm.nombre}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {catError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{catError}</p>}
            <button onClick={crearCategoria} disabled={catSaving}
              className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50">
              {catSaving ? "Creando..." : "+ Crear categoría"}
            </button>
          </div>

          {/* List */}
          <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-2">
            <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Categorías actuales</h3>
            {categorias.map((c) => (
              <div key={c.slug} className="flex items-center justify-between rounded-paper border-2 border-border bg-surface p-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ background: c.color + "22", color: c.color }}
                  >
                    <TopicIcon value={c.icono} size={20} weight="duotone" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-ink">{c.nombre}</p>
                    <p className="text-xs font-mono text-muted">{c.slug}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: c.color + "22", color: c.color }}>
                    <TopicIcon value={c.icono} size={14} className="shrink-0" />
                    {c.nombre}
                  </span>
                </div>
                {!["rrhh", "logistica", "mantenimiento"].includes(c.slug) && (
                  <button onClick={() => eliminarCategoria(c.slug, c.nombre)}
                    className="text-xs font-semibold text-red-400 transition hover:text-red-600">
                    🗑️ Eliminar
                  </button>
                )}
                {["rrhh", "logistica", "mantenimiento"].includes(c.slug) && (
                  <span className="text-xs text-muted">Sistema</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : loading ? (
        <div className="py-10 text-center text-sm text-muted">Cargando...</div>
      ) : tab === "usuarios" ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => openModal("user")}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none">
              + Nuevo usuario
            </button>
          </div>
          {usuarios.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-ink">{u.nombre}</span>
                  <span className="font-mono text-xs text-muted">@{u.username}</span>
                  {!u.activo && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">Inactivo</span>}
                </div>
                <div className="mt-0.5 flex gap-2 text-xs text-muted">
                  <span>{u.rol?.nombre}</span>·<span style={{ color: u.departamento?.color }}>{u.departamento?.nombre}</span>
                </div>
              </div>
              <button onClick={() => openModal("user", u)}
                className="rounded-paper border-2 border-border px-3 py-1 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
                Editar
              </button>
            </div>
          ))}
        </div>
      ) : tab === "roles" ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => openModal("rol")}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none">
              + Nuevo rol
            </button>
          </div>
          {roles.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm">
              <div>
                <span className="font-bold text-ink">{r.nombre}</span>
                <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-bold text-muted">Nivel {r.nivel}</span>
                {r.descripcion && <p className="mt-0.5 text-xs text-muted">{r.descripcion}</p>}
              </div>
              <button onClick={() => openModal("rol", r)}
                className="rounded-paper border-2 border-border px-3 py-1 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
                Editar
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => openModal("dept")}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none">
              + Nuevo departamento
            </button>
          </div>
          {depts.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full border-2 border-white shadow" style={{ background: d.color }} />
                <div>
                  <span className="font-bold text-ink">{d.nombre}</span>
                  {d.descripcion && <p className="text-xs text-muted">{d.descripcion}</p>}
                </div>
              </div>
              <button onClick={() => openModal("dept", d)}
                className="rounded-paper border-2 border-border px-3 py-1 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
                Editar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-paper border-2 border-border bg-surface-panel p-6 shadow-paper-lg">
            <h3 className="mb-4 text-lg font-extrabold text-ink">
              {editItem ? "Editar" : "Nuevo"}{" "}
              {modal === "user" ? "Usuario" : modal === "rol" ? "Rol" : "Departamento"}
            </h3>

            {modal === "user" && (
              <div className="space-y-3">
                <Field label="Nombre completo *" value={form.nombre || ""} onChange={(v) => setForm({ ...form, nombre: v })} />
                <div>
                  <Field label="Alias del bot *" value={form.username || ""} onChange={(v) => setForm({ ...form, username: v })} />
                  <p className="mt-0.5 text-[10px] text-muted">Nombre corto con el que el bot identifica a este usuario en @menciones</p>
                </div>
                <Field label="Correo Google (para login)" type="email" value={form.email || ""} onChange={(v) => setForm({ ...form, email: v })} />
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted">Rol *</label>
                  <select value={form.rol_id || ""} onChange={(e) => setForm({ ...form, rol_id: parseInt(e.target.value) })}
                    className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent">
                    <option value="">Seleccionar...</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted">Departamentos</label>
                  <div className="rounded-paper border border-border p-2 max-h-36 overflow-y-auto space-y-1">
                    {depts.length === 0 && <p className="text-xs text-muted px-1">Sin departamentos registrados</p>}
                    {depts.map((d) => {
                      const selected = (form.departamentos_ids || []).includes(d.id);
                      return (
                        <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover">
                          <input type="checkbox" checked={selected}
                            onChange={() => {
                              const ids: number[] = form.departamentos_ids || [];
                              setForm({ ...form, departamentos_ids: selected ? ids.filter((x: number) => x !== d.id) : [...ids, d.id] });
                            }}
                            className="h-3.5 w-3.5 accent-accent"
                          />
                          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                          {d.nombre}
                        </label>
                      );
                    })}
                  </div>
                </div>
                {editItem && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.activo === 1} onChange={(e) => setForm({ ...form, activo: e.target.checked ? 1 : 0 })} />
                    <span className="font-semibold text-ink">Usuario activo</span>
                  </label>
                )}
                {/* Accesos al panel — solo admin editando otro usuario */}
                {editItem && nivel >= 3 && (() => {
                  const SECCIONES: { id: string; label: string }[] = [
                    { id: "dashboard", label: "Dashboard" },
                    { id: "chat",      label: "Chat IA" },
                    { id: "voz",       label: "Voz IA" },
                    { id: "webchat",   label: "Chat web" },
                    { id: "preventa",  label: "Preventa MeLi" },
                    { id: "sync",      label: "Sincronización" },
                    { id: "stock",     label: "Stock" },
                    { id: "pedidos",   label: "Pedidos Web" },
                    { id: "facturas",  label: "Facturas Compra" },
                    { id: "tickets",   label: "Centro de Mando" },
                  ];
                  const permisos: Record<string, boolean> = form.permisos_secciones || {};
                  const editRolNivel = roles.find((r) => r.id === form.rol_id)?.nivel ?? 1;
                  if (editRolNivel >= 3) return null; // admin siempre tiene todo
                  function toggleSeccion(id: string) {
                    setForm({ ...form, permisos_secciones: { ...permisos, [id]: !permisos[id] } });
                  }
                  return (
                    <div className="rounded-paper border border-border p-3">
                      <p className="mb-2 text-xs font-bold text-muted uppercase tracking-wide">Accesos al panel</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {SECCIONES.map((s) => (
                          <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs font-medium text-ink hover:bg-surface-hover">
                            <input
                              type="checkbox"
                              checked={Boolean(permisos[s.id])}
                              onChange={() => toggleSeccion(s.id)}
                              className="h-3.5 w-3.5 accent-accent"
                            />
                            {s.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {modal === "rol" && (
              <div className="space-y-3">
                <Field label="Nombre del rol" value={form.nombre || ""} onChange={(v) => setForm({ ...form, nombre: v })} />
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted">Nivel de acceso</label>
                  <select value={form.nivel || 1} onChange={(e) => setForm({ ...form, nivel: parseInt(e.target.value) })}
                    className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent">
                    <option value={1}>1 — Operario</option>
                    <option value={2}>2 — Supervisor</option>
                    <option value={3}>3 — Administrador</option>
                  </select>
                </div>
                <Field label="Descripción" value={form.descripcion || ""} onChange={(v) => setForm({ ...form, descripcion: v })} />
              </div>
            )}

            {modal === "dept" && (
              <div className="space-y-3">
                <Field label="Nombre del departamento" value={form.nombre || ""} onChange={(v) => setForm({ ...form, nombre: v })} />
                <Field label="Descripción (opcional)" value={form.descripcion || ""} onChange={(v) => setForm({ ...form, descripcion: v })} />
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted">Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={form.color || "#0c6069"} onChange={(e) => setForm({ ...form, color: e.target.value })}
                      className="h-10 w-16 cursor-pointer rounded-paper border-2 border-border p-0.5" />
                    <span className="text-sm font-mono text-muted">{form.color}</span>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => { setModal(null); setError(""); }}
                className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted hover:bg-surface-hover transition">
                Cancelar
              </button>
              <button disabled={saving}
                onClick={modal === "user" ? saveUser : modal === "rol" ? saveRol : saveDept}
                className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50">
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-muted">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none transition focus:border-accent" />
    </div>
  );
}

// Participants section (used inside TicketDetailView)
function ParticipantesSection({
  ticket, token, user, usuarios, submitting, onAct,
}: {
  ticket: Ticket; token: string; user: TicketsUser;
  usuarios: UserInfo[]; submitting: boolean;
  onAct: (fn: () => Promise<any>) => void;
}) {
  const [addUserId, setAddUserId] = useState("");
  const [addRol, setAddRol] = useState("colaborador");
  const participantes = ticket.participantes || [];

  return (
    <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper">
      <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Participantes</h3>
      {participantes.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {participantes.map((p) => (
            <div key={p.usuario_id}
              className="flex items-center gap-1.5 rounded-full border-2 border-border bg-surface px-3 py-1 text-xs font-semibold">
              <span className="text-ink">{p.usuario_nombre}</span>
              <span className="text-muted capitalize">· {p.rol}</span>
              <button
                onClick={() => onAct(() => tapi(`/${ticket.id}/participantes/${p.usuario_id}`, token, { method: "DELETE" }))}
                disabled={submitting}
                className="ml-1 text-muted hover:text-danger transition"
                title="Quitar participante"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-4 text-xs text-muted">Sin participantes adicionales.</p>
      )}
      {ticket.estado !== "resuelto" && ticket.estado !== "rechazado" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-36">
            <label className="mb-1 block text-xs font-bold text-muted">Agregar participante</label>
            <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}
              className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent">
              <option value="">Seleccionar usuario...</option>
              {usuarios
                .filter((u) => u.id !== ticket.creado_por && u.id !== ticket.asignado_a
                  && !participantes.find((p) => p.usuario_id === u.id))
                .map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Rol</label>
            <select value={addRol} onChange={(e) => setAddRol(e.target.value)}
              className="rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent">
              <option value="colaborador">Colaborador</option>
              <option value="revisor">Revisor</option>
              <option value="observador">Observador</option>
            </select>
          </div>
          <button
            disabled={submitting || !addUserId}
            onClick={() => onAct(() => tapi(`/${ticket.id}/participantes`, token, {
              method: "POST",
              body: JSON.stringify({ usuario_id: parseInt(addUserId), rol: addRol }),
            }).then(() => setAddUserId("")))}
            className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      )}
    </div>
  );
}

// ── PASOS ─────────────────────────────────────────────────────────────────────

type PasoDraft = { descripcion: string; notas?: string };

type MaterialDraft = {
  material_id: number;
  nombre: string;
  unidad: string;
  cantidad: string;
  notas?: string;
};

function normalizePasoDraftList(raw: unknown): PasoDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): PasoDraft => {
      if (typeof p === "string") return { descripcion: p.trim() };
      if (p && typeof p === "object") {
        const o = p as { descripcion?: string; texto?: string; notas?: string };
        const desc = (o.descripcion || o.texto || "").trim();
        const n = (o.notas || "").trim();
        return { descripcion: desc, notas: n || undefined };
      }
      return { descripcion: "" };
    })
    .filter((p) => p.descripcion);
}

function pasoDraftsToApi(pasos: PasoDraft[]): (string | { descripcion: string; notas: string })[] {
  return pasos.map((p) => {
    const d = p.descripcion.trim();
    const n = p.notas?.trim();
    return n ? { descripcion: d, notas: n } : d;
  });
}

function materialesDraftToApi(materiales: MaterialDraft[]) {
  return materiales
    .filter((m) => m.material_id > 0 && parseFloat(m.cantidad) > 0)
    .map((m) => ({
      material_id: m.material_id,
      cantidad: parseFloat(m.cantidad),
      ...(m.notas?.trim() ? { notas: m.notas.trim() } : {}),
    }));
}

interface EtapaDraft {
  titulo: string;
  descripcion: string;
  pasos: PasoDraft[];
  frecuencia?: string;
  materiales?: MaterialDraft[];
}

/** Botón post-it 📝 para notas opcionales en un paso. */
function PasoNotaPostit({
  titulo,
  notas,
  noteDraft,
  onNoteDraftChange,
  open,
  onToggle,
  onSave,
  readonly = false,
  saving = false,
  popoverRef,
}: {
  titulo: string;
  notas?: string;
  noteDraft: string;
  onNoteDraftChange: (v: string) => void;
  open: boolean;
  onToggle: () => void;
  onSave?: () => void;
  readonly?: boolean;
  saving?: boolean;
  popoverRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const tieneNota = Boolean(notas?.trim());
  return (
    <div className="relative shrink-0" ref={open ? popoverRef : undefined}>
      <button
        type="button"
        onClick={onToggle}
        title={tieneNota ? "Ver nota post-it" : "Agregar nota post-it"}
        className={`relative flex h-8 w-8 items-center justify-center rounded-sm border-2 border-amber-400/60 bg-amber-100 text-sm shadow-[2px_2px_0_rgba(0,0,0,0.1)] transition hover:-translate-y-0.5 dark:border-amber-600/50 dark:bg-amber-950/90 dark:shadow-[2px_2px_0_rgba(0,0,0,0.35)] ${open ? "rotate-2 ring-2 ring-amber-500/40" : "-rotate-2"}`}
      >
        📝
        {tieneNota && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 w-[min(16rem,calc(100vw-3rem))] rotate-1 rounded-sm border-2 border-amber-400/70 bg-amber-50 p-2.5 shadow-[5px_5px_0_rgba(0,0,0,0.12)] dark:border-amber-600/60 dark:bg-amber-950 dark:shadow-[5px_5px_0_rgba(0,0,0,0.4)]"
          role="dialog"
          aria-label={`Nota: ${titulo}`}
        >
          <p className="mb-1.5 truncate text-[10px] font-extrabold uppercase tracking-wider text-amber-900/80 dark:text-amber-200/90">
            {titulo}
          </p>
          <textarea
            readOnly={readonly}
            rows={4}
            autoFocus={!readonly}
            className="w-full resize-y rounded border border-amber-300/80 bg-white/80 px-2 py-1.5 text-xs text-amber-950 placeholder:text-amber-800/40 outline-none focus:border-amber-500 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-50 dark:placeholder:text-amber-200/30"
            placeholder="Detalle, tips o contexto del paso…"
            value={noteDraft}
            onChange={(e) => onNoteDraftChange(e.target.value)}
          />
          {!readonly && onSave ? (
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onToggle}
                className="text-[10px] font-bold uppercase text-amber-900/60 hover:text-amber-950 dark:text-amber-300/70"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="rounded border-2 border-amber-600/80 bg-amber-200/80 px-2.5 py-0.5 text-[10px] font-bold uppercase text-amber-950 hover:bg-amber-300/80 disabled:opacity-50 dark:border-amber-500 dark:bg-amber-800 dark:text-amber-50"
              >
                {saving ? "..." : "Guardar"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              className="mt-2 w-full text-center text-[10px] font-bold uppercase text-amber-900/60 dark:text-amber-300/70"
            >
              Cerrar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Casilla de paso: sin atributo HTML disabled (evita cursor ⊘); solo readOnly + clic explícito. */
function PasoChecklistInput({
  pasoId,
  checked,
  canCheck,
  busy,
  title,
  onBlocked,
  onCheckedChange,
}: {
  pasoId: number;
  checked: boolean;
  canCheck: boolean;
  busy?: boolean;
  title?: string;
  onBlocked?: () => void;
  onCheckedChange: (checked: boolean) => void;
}) {
  const inputId = `paso-check-${pasoId}`;
  const cursor =
    busy ? "wait" : canCheck ? "pointer" : "not-allowed";

  return (
    <input
      id={inputId}
      type="checkbox"
      checked={checked}
      readOnly
      title={title}
      aria-checked={checked}
      aria-busy={busy || undefined}
      aria-disabled={!canCheck || undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (busy) return;
        if (!canCheck) {
          onBlocked?.();
          return;
        }
        onCheckedChange(!checked);
      }}
      onChange={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      className="paso-checklist-input shrink-0"
      style={{ cursor }}
    />
  );
}

function normalizePasosResponse(res: unknown, fallback: Paso[]): Paso[] {
  if (Array.isArray(res)) return res as Paso[];
  if (res && typeof res === "object" && Array.isArray((res as { pasos?: unknown }).pasos)) {
    return (res as { pasos: Paso[] }).pasos;
  }
  return fallback;
}

function metaPasosResponse(res: unknown): {
  autoResuelto?: boolean;
  estado?: string;
  pasosTotal?: number;
  pasosCompletados?: number;
} {
  if (!res || typeof res !== "object" || Array.isArray(res)) return {};
  const o = res as {
    auto_resuelto?: boolean;
    estado?: string;
    pasos_total?: unknown;
    pasos_completados?: unknown;
  };
  const { total, completados } = ticketPasosCounts({
    pasos_total: o.pasos_total,
    pasos_completados: o.pasos_completados,
  } as Ticket);
  return {
    autoResuelto: o.auto_resuelto,
    estado: o.estado,
    pasosTotal: total,
    pasosCompletados: completados,
  };
}

function syncPasosProgressFromResponse(ticketId: number, res: unknown, lista?: Paso[]) {
  const meta = metaPasosResponse(res);
  let total = meta.pasosTotal ?? 0;
  let completados = meta.pasosCompletados ?? 0;
  if (total <= 0 && lista && lista.length > 0) {
    total = lista.length;
    completados = lista.filter((p) => pasoEstaCompletado(p)).length;
  }
  if (total > 0 || completados > 0) {
    emitTicketPasosProgress(ticketId, completados, total);
  }
}

function PasosDraftEditor({
  pasos,
  onChange,
}: {
  pasos: PasoDraft[];
  onChange: (pasos: PasoDraft[]) => void;
}) {
  const [nuevo, setNuevo] = useState("");
  const [openNoteIdx, setOpenNoteIdx] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  function agregarPaso() {
    const t = nuevo.trim();
    if (!t) return;
    onChange([...pasos, { descripcion: t }]);
    setNuevo("");
  }

  function toggleDraftNote(i: number) {
    if (openNoteIdx === i) {
      setOpenNoteIdx(null);
      setNoteDraft("");
    } else {
      setOpenNoteIdx(i);
      setNoteDraft(pasos[i]?.notas || "");
    }
  }

  function saveDraftNote(i: number) {
    onChange(
      pasos.map((p, idx) =>
        idx === i ? { ...p, notas: noteDraft.trim() || undefined } : p,
      ),
    );
    setOpenNoteIdx(null);
    setNoteDraft("");
  }

  return (
    <div className="space-y-2 border-t border-border/50 pt-3 lg:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
          Pasos del ticket
        </p>
        {pasos.length > 0 && (
          <span className="text-[10px] font-bold text-accent">{pasos.length} paso{pasos.length > 1 ? "s" : ""}</span>
        )}
      </div>
      <p className="text-[10px] text-muted">
        Vista previa — las casillas se activan al abrir el ticket. Usa 📝 para notas post-it.
      </p>
      {pasos.length === 0 ? (
        <p className="text-xs text-muted">Sin pasos — agrega el procedimiento abajo.</p>
      ) : (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto lg:max-h-56">
          {pasos.map((p, i) => (
            <li key={i} className="rounded-paper border border-border bg-surface-input px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-xs font-bold text-muted">{i + 1}.</span>
                <input
                  type="text"
                  value={p.descripcion}
                  onChange={(e) =>
                    onChange(
                      pasos.map((x, idx) =>
                        idx === i ? { ...x, descripcion: e.target.value } : x,
                      ),
                    )
                  }
                  className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-sm text-ink outline-none focus:ring-0"
                />
                <PasoNotaPostit
                  titulo={p.descripcion || `Paso ${i + 1}`}
                  notas={p.notas}
                  noteDraft={openNoteIdx === i ? noteDraft : p.notas || ""}
                  onNoteDraftChange={setNoteDraft}
                  open={openNoteIdx === i}
                  onToggle={() => toggleDraftNote(i)}
                  onSave={() => saveDraftNote(i)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (openNoteIdx === i) setOpenNoteIdx(null);
                    onChange(pasos.filter((_, idx) => idx !== i));
                  }}
                  className="shrink-0 text-xs text-muted hover:text-danger px-0.5"
                  aria-label="Quitar paso">
                  ✕
                </button>
              </div>
              {p.notas?.trim() && openNoteIdx !== i && (
                <p className="mt-1.5 border-l-4 border-amber-400/80 bg-amber-100/60 px-2 py-1 text-[10px] italic text-amber-950/90 dark:border-amber-600/60 dark:bg-amber-950/50 dark:text-amber-100/90 line-clamp-2">
                  {p.notas}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          className="min-w-0 flex-1 rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
          placeholder="Nuevo paso…"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              agregarPaso();
            }
          }}
        />
        <button
          type="button"
          onClick={agregarPaso}
          disabled={!nuevo.trim()}
          className="shrink-0 rounded-paper border-2 border-accent px-2.5 py-1.5 text-xs font-bold text-accent hover:bg-accent hover:text-white disabled:opacity-40">
          + Paso
        </button>
      </div>
    </div>
  );
}

const MISION_DRAFT_ETAPAS_SECTION = "mision-draft-etapas";

function CreateMisionEtapaFrames({
  etapas,
  isSecuencial,
  formColor,
  modoCicloInfinita,
  asignaciones,
  usuarios,
  onRemove,
  onEtapaTitulo,
  onEtapaDesc,
  onAsignacion,
  onEtapaPasos,
  onEtapaFrecuencia,
  onEtapaMateriales,
  catalogoMateriales = [],
  zonaSugerida = null,
}: {
  etapas: EtapaDraft[];
  isSecuencial: boolean;
  formColor: string;
  modoCicloInfinita: boolean;
  asignaciones: Record<number, string>;
  usuarios: UserInfo[];
  onRemove: (i: number) => void;
  onEtapaTitulo: (i: number, v: string) => void;
  onEtapaDesc: (i: number, v: string) => void;
  onAsignacion: (orden: number, userId: string) => void;
  onEtapaPasos: (i: number, pasos: PasoDraft[]) => void;
  onEtapaFrecuencia: (i: number, v: string) => void;
  onEtapaMateriales: (i: number, materiales: MaterialDraft[]) => void;
  catalogoMateriales?: Material[];
  zonaSugerida?: string | null;
}) {
  const canvasWidth = useBoardCanvasWidth();

  return (
    <>
      {etapas.map((et, i) => (
        <QuestBoardStickyFrame
          key={i}
          sectionKey={MISION_DRAFT_ETAPAS_SECTION}
          cardKey={`etapa:${i}`}
          index={i}
          containerWidth={canvasWidth}
          minAutoH={260}
        >
          <div
            className="rounded-paper border-2 border-border bg-surface p-3 h-full"
            style={!isSecuencial ? { borderTopColor: formColor, borderTopWidth: 3 } : undefined}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                  style={{ background: formColor }}
                >
                  {i + 1}
                </span>
                {isSecuencial && i > 0 && (
                  <span className="text-[10px] font-semibold text-muted">🔒 tras #{i}</span>
                )}
                {!isSecuencial && (
                  <span className="text-[10px] font-semibold text-muted">⚡ activo</span>
                )}
              </div>
              {etapas.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="text-[10px] font-bold text-muted hover:text-danger shrink-0"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
              <input
                className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm text-ink outline-none focus:border-accent lg:col-span-2"
                placeholder={`Título ticket ${i + 1} *`}
                value={et.titulo}
                onChange={(e) => onEtapaTitulo(i, e.target.value)}
              />
              <input
                className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                placeholder="Descripción (opc.)"
                value={et.descripcion}
                onChange={(e) => onEtapaDesc(i, e.target.value)}
              />
              <select
                value={asignaciones[i + 1] || ""}
                onChange={(e) => onAsignacion(i + 1, e.target.value)}
                className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
              >
                <option value="">👤 Sin asignar</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
              <PasosDraftEditor
                pasos={et.pasos}
                onChange={(pasos) => onEtapaPasos(i, pasos)}
              />
              <MaterialesDraftEditor
                materiales={et.materiales || []}
                onChange={(materiales) => onEtapaMateriales(i, materiales)}
                catalogo={catalogoMateriales}
                zonaSugerida={zonaSugerida}
              />
              {modoCicloInfinita && (
                <div className="lg:col-span-2">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
                    Cada cuánto se repite este ticket (opcional)
                  </label>
                  <SelectFrecuencia
                    value={et.frecuencia || ""}
                    onChange={(v) => onEtapaFrecuencia(i, v)}
                  />
                </div>
              )}
            </div>
          </div>
        </QuestBoardStickyFrame>
      ))}
    </>
  );
}

interface Paso {
  id: number; ticket_id: number; orden: number; descripcion: string;
  notas?: string | null;
  completado: number | boolean; completado_en: string | null; completado_por_nombre: string | null;
}

function pasoEstaCompletado(p: Paso): boolean {
  const v = p.completado;
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  return Number(v) === 1;
}

/** El checklist de pasos se puede marcar salvo tickets cerrados. */
function ticketPermiteMarcarPasos(ticket: Ticket): boolean {
  const e = String(ticket.estado || "").trim().toLowerCase();
  return e !== "resuelto" && e !== "rechazado";
}

function PasosSection({
  ticketId,
  token,
  editMode = true,
  allowCheck = true,
  checkHint,
  onAllComplete,
  onGuardarExtra,
}: {
  ticketId: number; token: string; editMode?: boolean;
  allowCheck?: boolean;
  checkHint?: string;
  onAllComplete?: () => Promise<void>;
  /** Tras guardar pasos (p. ej. refrescar ticket padre). */
  onGuardarExtra?: () => void | Promise<void>;
}) {
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [saving, setSaving] = useState(false);
  const [guardarMsg, setGuardarMsg] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);
  const toggleLock = useRef<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const notePopoverRef = useRef<HTMLDivElement>(null);

  const reloadPasos = useCallback(() => {
    return tapi(`/${ticketId}/pasos`, token)
      .then((data) => setPasos(normalizePasosResponse(data, [])))
      .catch(() => {});
  }, [ticketId, token]);

  useEffect(() => {
    void reloadPasos();
  }, [reloadPasos]);

  useEffect(() => {
    if (openNoteId == null) return;
    function onPointerDown(e: MouseEvent) {
      if (notePopoverRef.current && !notePopoverRef.current.contains(e.target as Node)) {
        const paso = pasos.find((p) => p.id === openNoteId);
        setOpenNoteId(null);
        setNoteDraft(paso?.notas || "");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openNoteId, pasos]);

  function togglePasoNote(p: Paso) {
    if (openNoteId === p.id) {
      setOpenNoteId(null);
      setNoteDraft(p.notas || "");
    } else {
      setOpenNoteId(p.id);
      setNoteDraft(p.notas || "");
    }
  }

  async function savePasoNote(pasoId: number) {
    setSaving(true);
    try {
      const res = await tapi(`/${ticketId}/pasos/${pasoId}`, token, {
        method: "PUT",
        body: JSON.stringify({ notas: noteDraft.trim() }),
      });
      setPasos(normalizePasosResponse(res, pasos));
      setOpenNoteId(null);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "No se pudo guardar la nota");
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    if (!nuevo.trim()) return;
    setSaving(true);
    try {
      const res = await tapi(`/${ticketId}/pasos`, token, {
        method: "POST", body: JSON.stringify({ descripcion: nuevo }),
      });
      setPasos(normalizePasosResponse(res, pasos)); setNuevo("");
    } finally { setSaving(false); }
  }

  async function guardarPasos() {
    setSaving(true);
    setGuardarMsg(null);
    try {
      if (editMode && nuevo.trim()) {
        const res = await tapi(`/${ticketId}/pasos`, token, {
          method: "POST",
          body: JSON.stringify({ descripcion: nuevo }),
        });
        setPasos(normalizePasosResponse(res, pasos));
        setNuevo("");
      } else {
        await reloadPasos();
      }
      const lista = await tapi(`/${ticketId}/pasos`, token).catch(() => []);
      const pasosLista = normalizePasosResponse(lista, []);
      setPasos(pasosLista);
      syncPasosProgressFromResponse(ticketId, lista, pasosLista);
      await onGuardarExtra?.();
      setGuardarMsg("Pasos guardados");
      window.setTimeout(() => setGuardarMsg(null), 3000);
    } catch (e: unknown) {
      setGuardarMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function setPasoCompletado(id: number, marcar: boolean) {
    if (!allowCheck) {
      if (checkHint) alert(checkHint);
      return;
    }
    if (toggleLock.current.has(id)) return;
    toggleLock.current.add(id);
    setTogglingId(id);

    try {
      const paso = pasos.find((p) => p.id === id);
      if (!paso) return;
      if (pasoEstaCompletado(paso) === marcar) return;

      setPasos((list) =>
        list.map((p) => (p.id === id ? { ...p, completado: marcar ? 1 : 0 } : p)),
      );

      let res: unknown;
      try {
        res = await tapi(`/${ticketId}/pasos/${id}`, token, {
          method: "PUT",
          body: JSON.stringify({ completado: marcar ? 1 : 0 }),
        });
      } catch (putErr: unknown) {
        const msg = putErr instanceof Error ? putErr.message : "";
        if (!msg.includes("405") && !msg.includes("404")) throw putErr;
        res = await tapi(`/${ticketId}/pasos/${id}/completar`, token, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }

      const meta = metaPasosResponse(res);
      let lista: Paso[] = [];
      setPasos((cur) => {
        lista = normalizePasosResponse(res, cur);
        return lista;
      });
      syncPasosProgressFromResponse(ticketId, res, lista);
      if (meta.autoResuelto) {
        emitTicketPasosProgress(ticketId, meta.pasosCompletados ?? 0, meta.pasosTotal ?? 0);
      }
      const todosHechos =
        lista.length > 0 && lista.every((p) => pasoEstaCompletado(p));
      if (onAllComplete && (meta.autoResuelto || todosHechos)) {
        await onAllComplete();
      }
    } catch (e: unknown) {
      await reloadPasos();
      alert(e instanceof Error ? e.message : "No se pudo actualizar el paso");
    } finally {
      toggleLock.current.delete(id);
      setTogglingId(null);
    }
  }

  async function del(id: number) {
    const res = await tapi(`/pasos/${id}`, token, { method: "DELETE" });
    setPasos(normalizePasosResponse(res, pasos));
  }

  async function drop(toIdx: number) {
    const fromIdx = dragIdx.current;
    dragIdx.current = null; setDragOver(null);
    if (fromIdx === null || fromIdx === toIdx) return;
    const reordered = [...pasos];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setPasos(reordered);
    const res = await tapi(`/${ticketId}/pasos/orden`, token, {
      method: "PUT", body: JSON.stringify({ paso_ids: reordered.map((p) => p.id) }),
    });
    setPasos(normalizePasosResponse(res, reordered));
  }

  const completados = pasos.filter((p) => pasoEstaCompletado(p)).length;
  const pct = pasos.length > 0 ? Math.round((completados / pasos.length) * 100) : 0;

  return (
    <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">📋 Pasos del procedimiento</h3>
        {pasos.length > 0 && (
          <span className={`text-xs font-bold ${pct === 100 ? "text-green-600" : "text-muted"}`}>
            {completados}/{pasos.length} — {pct}%
          </span>
        )}
      </div>
      {!allowCheck && checkHint && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {checkHint}
        </p>
      )}
      {pasos.length > 0 && (
        <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: pct === 100 ? "#16a34a" : "#0c6069" }} />
        </div>
      )}
      <div className="space-y-2">
        {pasos.map((p, i) => {
          const tieneNota = Boolean(p.notas?.trim());
          const noteOpen = openNoteId === p.id;
          return (
            <div key={p.id}
              onDragOver={editMode ? (e) => { e.preventDefault(); setDragOver(i); } : undefined}
              onDragLeave={editMode ? () => setDragOver(null) : undefined}
              onDrop={editMode ? () => drop(i) : undefined}
              className={`rounded-paper border px-3 py-2.5 transition
                ${pasoEstaCompletado(p) ? "border-green-200 bg-green-50"
                  : "border-border bg-surface"}
                ${editMode && dragOver === i ? "opacity-50 border-dashed border-accent" : ""}`}
            >
              <div className="flex items-center gap-2">
                {editMode && (
                  <span
                    draggable
                    onDragStart={() => { dragIdx.current = i; }}
                    onDragEnd={() => { dragIdx.current = null; setDragOver(null); }}
                    className="cursor-grab text-muted opacity-40 hover:opacity-70 select-none shrink-0 touch-none"
                    title="Arrastrar para reordenar">
                    ⠿
                  </span>
                )}
                <div className="relative z-10 flex flex-1 min-w-0 items-center gap-2.5">
                  <PasoChecklistInput
                    pasoId={p.id}
                    checked={pasoEstaCompletado(p)}
                    canCheck={allowCheck}
                    busy={togglingId === p.id}
                    title={
                      allowCheck
                        ? pasoEstaCompletado(p)
                          ? "Desmarcar paso"
                          : "Marcar paso completado"
                        : checkHint || "No se puede marcar este paso"
                    }
                    onBlocked={() => {
                      if (checkHint) alert(checkHint);
                    }}
                    onCheckedChange={(marcar) => void setPasoCompletado(p.id, marcar)}
                  />
                  <label
                    htmlFor={`paso-check-${p.id}`}
                    className={`min-w-0 flex-1 text-sm select-none
                      ${pasoEstaCompletado(p) ? "line-through text-muted" : "text-ink"}
                      ${allowCheck && togglingId !== p.id ? "cursor-pointer" : "cursor-default"}
                      ${!allowCheck ? "opacity-80" : ""}`}
                  >
                    {p.descripcion}
                  </label>
                </div>
                <PasoNotaPostit
                  titulo={p.descripcion}
                  notas={p.notas ?? undefined}
                  noteDraft={noteDraft}
                  onNoteDraftChange={setNoteDraft}
                  open={noteOpen}
                  onToggle={() => togglePasoNote(p)}
                  onSave={() => void savePasoNote(p.id)}
                  readonly={!editMode}
                  saving={saving}
                  popoverRef={notePopoverRef}
                />
                {p.completado_por_nombre && (
                  <span className="text-xs text-muted shrink-0">👤 {p.completado_por_nombre}</span>
                )}
                {editMode && (
                  <button onClick={() => del(p.id)} className="text-xs text-muted hover:text-danger transition shrink-0 px-0.5">✕</button>
                )}
              </div>
              {tieneNota && !noteOpen && (
                <button
                  type="button"
                  onClick={() => togglePasoNote(p)}
                  className="mt-2 w-full text-left rounded-sm border-l-4 border-amber-400/80 bg-amber-100/60 px-2.5 py-1.5 text-[11px] italic leading-snug text-amber-950/90 transition hover:bg-amber-100 dark:border-amber-600/60 dark:bg-amber-950/50 dark:text-amber-100/90 dark:hover:bg-amber-950/70"
                >
                  {p.notas!.length > 180 ? `${p.notas!.slice(0, 180)}…` : p.notas}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {pasos.length === 0 && (
        <p className="py-2 text-center text-xs text-muted">
          {editMode ? "Sin pasos aún. Agrega los pasos del procedimiento." : "Sin pasos definidos."}
        </p>
      )}
      {editMode && (
        <div className="flex gap-2 pt-1">
          <input className="flex-1 rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            placeholder="Agregar paso..." value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <button type="button" onClick={() => void add()} disabled={saving || !nuevo.trim()}
            className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
            + Añadir
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => void guardarPasos()}
          disabled={saving}
          className="rounded-paper border-2 border-sky-600 bg-sky-600 px-4 py-2 text-sm font-bold text-white shadow-[0_2px_0_#0369a1] transition hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "💾 Guardar pasos"}
        </button>
        {guardarMsg && (
          <span className={`text-xs font-semibold ${guardarMsg.includes("Error") ? "text-danger" : "text-green-700"}`}>
            {guardarMsg}
          </span>
        )}
      </div>
    </div>
  );
}

// ── MATERIALES ────────────────────────────────────────────────────────────────

type MaterialTipo = "materia_prima" | "elaborado" | "consumibles" | "repuestos" | "herramientas";

const UNIDADES_MATERIAL = ["kg", "g", "mg", "L", "mL", "unidad", "m", "cm", "m²", "m³", "caja", "bolsa", "rollo", "galón"];

const MATERIAL_FORM_LABEL = "mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-muted";
const MATERIAL_FORM_INPUT = "w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent";
const MATERIAL_FORM_GRID = "grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4";
const MATERIAL_FORM_GRID_FULL = "col-span-2 sm:col-span-3 lg:col-span-4";
const TICKET_FORM_GRID_2 = "grid grid-cols-1 gap-3 sm:grid-cols-2";
const INVENTARIO_MATERIALES_GRID = "grid gap-2 sm:grid-cols-2 xl:grid-cols-3";

function emptyNuevoMaterialForm() {
  return { nombre: "", tipo: "consumibles" as MaterialTipo, unidad: "unidad", cantidad: "", stock_actual: "0", notas: "" };
}

function materialTipoEmoji(tipo?: string): string | null {
  if (tipo === "elaborado") return "✨";
  if (tipo === "consumibles") return "📦";
  if (tipo === "repuestos") return "🔩";
  if (tipo === "herramientas") return "🔧";
  return null;
}

function MaterialTipoIcon({ tipo, size = 12 }: { tipo?: string; size?: number }) {
  const emoji = materialTipoEmoji(tipo);
  if (!emoji) return null;
  return <TopicIcon value={emoji} size={size} weight="duotone" className="shrink-0" />;
}

function BadgeTipoMaterial({ tipo }: { tipo?: string }) {
  if (!tipo || tipo === "materia_prima") return null;
  const cfg = TIPO_MATERIAL_BADGE[tipo];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${cfg.className}`}>
      <TopicIcon value={cfg.emoji} size={10} weight="duotone" />
      {cfg.label}
    </span>
  );
}

function zonaLabel(z: ZonaTrabajo) {
  return z.parent_nombre ? `${z.parent_nombre} › ${z.nombre}` : z.nombre;
}

function BadgesZonas({ zonas, compact }: { zonas?: ZonaTrabajo[]; compact?: boolean }) {
  if (!zonas?.length) {
    return compact ? null : (
      <span className="text-[10px] italic text-muted">Sin zona asignada</span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {zonas.map((z) => (
        <span
          key={z.id}
          className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent"
        >
          {zonaLabel(z)}
        </span>
      ))}
    </div>
  );
}

function ZonasPicker({
  zonas,
  selected,
  onChange,
  readonly = false,
  compact = false,
}: {
  zonas: ZonaTrabajo[];
  selected: number[];
  onChange: (ids: number[]) => void;
  readonly?: boolean;
  compact?: boolean;
}) {
  if (!zonas.length) {
    return <p className="text-xs text-muted">No hay zonas definidas en el catálogo de reinos.</p>;
  }
  const raices = zonas.filter((z) => !z.parent_id);
  const hijos = (pid: number) => zonas.filter((z) => z.parent_id === pid);
  const toggle = (id: number) => {
    if (readonly) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  const chip = (z: ZonaTrabajo) => {
    const on = selected.includes(z.id);
    return (
      <label
        key={z.id}
        className={`inline-flex max-w-full cursor-pointer items-center gap-1 rounded-paper border px-2 py-1 font-semibold transition ${
          compact ? "text-[10px]" : "text-xs"
        } ${
          on ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"
        } ${readonly ? "cursor-default opacity-80" : ""}`}
      >
        <input
          type="checkbox"
          className={`shrink-0 accent-accent ${compact ? "h-3 w-3" : "h-3.5 w-3.5"}`}
          checked={on}
          disabled={readonly}
          onChange={() => toggle(z.id)}
        />
        <span className={`truncate ${on ? "text-accent" : "text-ink"}`}>{zonaLabel(z)}</span>
      </label>
    );
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {raices.flatMap((z) => [chip(z), ...hijos(z.id).map((h) => chip(h))])}
    </div>
  );
}

function materialEnZona(m: { zonas?: ZonaTrabajo[] }, zonaNombre?: string | null) {
  if (!zonaNombre?.trim()) return true;
  const q = zonaNombre.trim().toLowerCase();
  return (m.zonas || []).some((z) => {
    const full = zonaLabel(z).toLowerCase();
    return (
      full === q
      || z.nombre.toLowerCase() === q
      || (z.parent_nombre || "").toLowerCase() === q
      || full.includes(q)
      || q.includes(z.nombre.toLowerCase())
    );
  });
}

interface Material {
  id: number; nombre: string; descripcion?: string; unidad: string;
  stock_actual: number; stock_minimo: number; precio_unitario: number;
  proveedor?: string; tipo?: MaterialTipo; mision_origen_id?: number | null;
  zonas?: ZonaTrabajo[];
}

function MaterialesDraftEditor({
  materiales,
  onChange,
  catalogo,
  zonaSugerida = null,
}: {
  materiales: MaterialDraft[];
  onChange: (materiales: MaterialDraft[]) => void;
  catalogo: Material[];
  zonaSugerida?: string | null;
}) {
  const [selMat, setSelMat] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [notas, setNotas] = useState("");
  const [soloZona, setSoloZona] = useState(Boolean(zonaSugerida?.trim()));

  const usados = new Set(materiales.map((m) => m.material_id));
  const disponiblesBase = catalogo.filter((m) => !usados.has(m.id));
  const disponibles = soloZona && zonaSugerida?.trim()
    ? disponiblesBase.filter((m) => materialEnZona(m, zonaSugerida))
    : disponiblesBase;

  function agregar() {
    const mat = catalogo.find((m) => m.id === parseInt(selMat));
    if (!mat || !cantidad || parseFloat(cantidad) <= 0) return;
    onChange([
      ...materiales,
      {
        material_id: mat.id,
        nombre: mat.nombre,
        unidad: mat.unidad,
        cantidad,
        notas: notas.trim() || undefined,
      },
    ]);
    setSelMat("");
    setCantidad("");
    setNotas("");
  }

  return (
    <div className="space-y-2 border-t border-border/50 pt-3 lg:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
          Materiales e insumos
        </p>
        {materiales.length > 0 && (
          <span className="text-[10px] font-bold text-accent">
            {materiales.length} material{materiales.length > 1 ? "es" : ""}
          </span>
        )}
      </div>
      {materiales.length === 0 ? (
        <p className="text-xs text-muted">Sin materiales — agrega del inventario abajo.</p>
      ) : (
        <ul className="max-h-36 space-y-1.5 overflow-y-auto">
          {materiales.map((m) => (
            <li key={m.material_id} className="flex items-center gap-2 rounded-paper border border-border bg-surface-input px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{m.nombre}</span>
              <span className="shrink-0 text-xs font-bold text-muted">
                {m.cantidad} {m.unidad}
              </span>
              <button
                type="button"
                onClick={() => onChange(materiales.filter((x) => x.material_id !== m.material_id))}
                className="shrink-0 text-xs text-muted hover:text-danger"
                aria-label="Quitar material">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {disponibles.length > 0 ? (
        <div className="space-y-2">
          {zonaSugerida?.trim() && (
            <label className="flex cursor-pointer items-center gap-2 text-[10px] text-muted">
              <input
                type="checkbox"
                className="h-3 w-3 accent-accent"
                checked={soloZona}
                onChange={(e) => setSoloZona(e.target.checked)}
              />
              Solo zona <strong className="text-ink">{zonaSugerida}</strong>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <select
              className="min-w-0 flex-1 rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
              value={selMat}
              onChange={(e) => setSelMat(e.target.value)}>
              <option value="">Material del inventario...</option>
              {disponibles.map((m) => (
                <option key={m.id} value={m.id}>{m.nombre} ({m.unidad})</option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="any"
              className="w-20 rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
              placeholder="Cant."
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
            <button
              type="button"
              onClick={agregar}
              disabled={!selMat || !cantidad}
              className="shrink-0 rounded-paper border-2 border-accent px-2.5 py-1.5 text-xs font-bold text-accent hover:bg-accent hover:text-white disabled:opacity-40">
              + Material
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-muted">No hay más materiales disponibles en inventario.</p>
      )}
    </div>
  );
}

interface TicketMaterial {
  id: number; ticket_id: number; material_id: number; nombre: string; unidad: string;
  cantidad_requerida: number; stock_actual: number; tipo?: MaterialTipo; notas?: string;
  zonas?: ZonaTrabajo[];
}

function MaterialesSection({
  ticketId, token, user, readonly = false, zonaSugerida = null,
}: {
  ticketId: number;
  token: string;
  user?: TicketsUser;
  readonly?: boolean;
  /** Reino o nombre de zona de la misión — filtra sugerencias del catálogo */
  zonaSugerida?: string | null;
}) {
  const [items, setItems] = useState<TicketMaterial[]>([]);
  const [catalogo, setCatalogo] = useState<Material[]>([]);
  const [selMat, setSelMat] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [showNuevo, setShowNuevo] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [nuevoForm, setNuevoForm] = useState(() => ({ ...emptyNuevoMaterialForm(), notas: "" }));
  const [nuevoZonaIds, setNuevoZonaIds] = useState<number[]>([]);
  const [zonasCatalogo, setZonasCatalogo] = useState<ZonaTrabajo[]>([]);
  const [soloZonaMision, setSoloZonaMision] = useState(Boolean(zonaSugerida?.trim()));
  const notePopoverRef = useRef<HTMLDivElement>(null);

  const nivel = user?.rol?.nivel ?? 1;
  const canCreateCatalog = nivel >= 2;

  const reloadCatalogo = useCallback(() => {
    tapi("/materiales", token).then(setCatalogo).catch(() => {});
  }, [token]);

  useEffect(() => {
    tapi(`/${ticketId}/materiales`, token).then(setItems).catch(() => {});
    reloadCatalogo();
    tapi("/zonas-trabajo", token).then(setZonasCatalogo).catch(() => {});
  }, [ticketId, token, reloadCatalogo]);

  useEffect(() => {
    if (openNoteId == null) return;
    function onPointerDown(e: MouseEvent) {
      if (notePopoverRef.current && !notePopoverRef.current.contains(e.target as Node)) {
        const item = items.find((i) => i.id === openNoteId);
        setOpenNoteId(null);
        setNoteDraft(item?.notas || "");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openNoteId, items]);

  function toggleMaterialNote(it: TicketMaterial) {
    if (openNoteId === it.id) {
      setOpenNoteId(null);
      setNoteDraft(it.notas || "");
    } else {
      setOpenNoteId(it.id);
      setNoteDraft(it.notas || "");
    }
  }

  async function addExisting() {
    if (!selMat || !cantidad) return;
    setSaving(true);
    try {
      const res = await tapi(`/${ticketId}/materiales`, token, {
        method: "POST", body: JSON.stringify({ 
          material_id: parseInt(selMat), 
          cantidad: parseFloat(cantidad),
          notas: notas.trim() || undefined
        }),
      });
      setItems(res);
      setSelMat("");
      setCantidad("");
      setNotas("");
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function crearYVincular() {
    if (!nuevoForm.nombre.trim() || !nuevoForm.cantidad) return;
    setSaving(true);
    try {
      const mat = await tapi("/materiales", token, {
        method: "POST",
        body: JSON.stringify({
          nombre: nuevoForm.nombre.trim(),
          descripcion: "",
          unidad: nuevoForm.unidad,
          tipo: nuevoForm.tipo,
          stock_actual: parseFloat(nuevoForm.stock_actual || "0"),
          stock_minimo: 0,
          precio_unitario: 0,
          proveedor: "",
          zona_ids: nuevoZonaIds,
        }),
      });
      setCatalogo((prev) => [...prev, mat]);
      const res = await tapi(`/${ticketId}/materiales`, token, {
        method: "POST",
        body: JSON.stringify({ 
          material_id: mat.id, 
          cantidad: parseFloat(nuevoForm.cantidad),
          notas: nuevoForm.notas.trim() || undefined
        }),
      });
      setItems(res);
      setShowNuevo(false);
      setNuevoForm({ ...emptyNuevoMaterialForm(), notas: "" });
      setNuevoZonaIds([]);
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function saveMaterialNote(tmId: number) {
    setSaving(true);
    try {
      const res = await tapi(`/ticket_materiales/${tmId}`, token, {
        method: "PUT",
        body: JSON.stringify({ notas: noteDraft.trim() }),
      });
      setItems(res);
      setOpenNoteId(null);
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function del(tmId: number) {
    const res = await tapi(`/ticket_materiales/${tmId}`, token, { method: "DELETE" });
    setItems(res);
  }

  const disponiblesBase = catalogo.filter((m) => !items.find((i) => i.material_id === m.id));
  const disponibles = soloZonaMision && zonaSugerida?.trim()
    ? disponiblesBase.filter((m) => materialEnZona(m, zonaSugerida))
    : disponiblesBase;

  return (
    <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-4">
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">📦 Materiales e insumos</h3>
      <p className="text-[11px] text-muted -mt-2">
        Los materiales nuevos se guardan en el inventario general y quedan vinculados a esta etapa.
      </p>

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((it) => {
            const stockOk = it.stock_actual >= it.cantidad_requerida;
            const noteOpen = openNoteId === it.id;
            const tieneNota = Boolean(it.notas?.trim());
            return (
              <div key={it.id} className="relative rounded-paper border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-sm text-ink">{it.nombre}</p>
                      <BadgeTipoMaterial tipo={it.tipo} />
                    </div>
                    <div className="mt-1">
                      <BadgesZonas zonas={it.zonas} compact />
                    </div>
                    <p className="text-xs text-muted">
                      Requerido: <span className="font-bold">{it.cantidad_requerida} {it.unidad}</span>
                      {" · "}
                      <span className={stockOk ? "text-green-600 dark:text-green-500/70" : "text-red-500"}>
                        Stock: {it.stock_actual} {it.unidad} {stockOk ? "✓" : "⚠️ insuficiente"}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1.5">
                    <div
                      className="relative"
                      ref={noteOpen ? notePopoverRef : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => toggleMaterialNote(it)}
                        title={tieneNota ? "Ver observación" : "Agregar observación"}
                        className={`relative flex h-9 w-9 items-center justify-center rounded-sm border-2 border-amber-400/60 bg-amber-100 text-base shadow-[2px_2px_0_rgba(0,0,0,0.1)] transition hover:-translate-y-0.5 dark:border-amber-600/50 dark:bg-amber-950/90 dark:shadow-[2px_2px_0_rgba(0,0,0,0.35)] ${noteOpen ? "rotate-2 ring-2 ring-amber-500/40" : "-rotate-2"}`}
                      >
                        📝
                        {tieneNota && (
                          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />
                        )}
                      </button>
                      {noteOpen && (
                        <div
                          className="absolute right-0 top-full z-50 mt-1.5 w-[min(16rem,calc(100vw-3rem))] rotate-1 rounded-sm border-2 border-amber-400/70 bg-amber-50 p-2.5 shadow-[5px_5px_0_rgba(0,0,0,0.12)] dark:border-amber-600/60 dark:bg-amber-950 dark:shadow-[5px_5px_0_rgba(0,0,0,0.4)]"
                          role="dialog"
                          aria-label={`Observación: ${it.nombre}`}
                        >
                          <p className="mb-1.5 truncate text-[10px] font-extrabold uppercase tracking-wider text-amber-900/80 dark:text-amber-200/90">
                            {it.nombre}
                          </p>
                          <textarea
                            readOnly={readonly}
                            rows={4}
                            autoFocus={!readonly}
                            className="w-full resize-y rounded border border-amber-300/80 bg-white/80 px-2 py-1.5 text-xs text-amber-950 placeholder:text-amber-800/40 outline-none focus:border-amber-500 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-50 dark:placeholder:text-amber-200/30"
                            placeholder="Observación sobre este material en la etapa..."
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                          />
                          {!readonly ? (
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => toggleMaterialNote(it)}
                                className="text-[10px] font-bold uppercase text-amber-900/60 hover:text-amber-950 dark:text-amber-300/70"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => saveMaterialNote(it.id)}
                                disabled={saving}
                                className="rounded border-2 border-amber-600/80 bg-amber-200/80 px-2.5 py-0.5 text-[10px] font-bold uppercase text-amber-950 hover:bg-amber-300/80 disabled:opacity-50 dark:border-amber-500 dark:bg-amber-800 dark:text-amber-50"
                              >
                                {saving ? "..." : "Guardar"}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setOpenNoteId(null)}
                              className="mt-2 w-full text-center text-[10px] font-bold uppercase text-amber-900/60 dark:text-amber-300/70"
                            >
                              Cerrar
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {!readonly && (
                      <button type="button" onClick={() => del(it.id)} title="Quitar material"
                        className="text-xs text-muted hover:text-danger transition px-1">✕</button>
                    )}
                  </div>
                </div>
                {tieneNota && !noteOpen && (
                  <button
                    type="button"
                    onClick={() => toggleMaterialNote(it)}
                    className="mt-2 w-full text-left rounded-sm border-l-4 border-amber-400/80 bg-amber-100/60 px-2.5 py-1.5 text-[11px] italic leading-snug text-amber-950/90 transition hover:bg-amber-100 dark:border-amber-600/60 dark:bg-amber-950/50 dark:text-amber-100/90 dark:hover:bg-amber-950/70"
                  >
                    {it.notas!.length > 180 ? `${it.notas!.slice(0, 180)}…` : it.notas}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted">Sin materiales asignados aún.</p>
      )}

      {!readonly && (
        <div className="space-y-3 border-t border-border pt-3">
          {zonaSugerida?.trim() && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-accent"
                checked={soloZonaMision}
                onChange={(e) => setSoloZonaMision(e.target.checked)}
              />
              Solo materiales de zona <strong className="text-ink">{zonaSugerida}</strong>
            </label>
          )}
          {disponibles.length > 0 && (
            <div className="space-y-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">Del inventario</p>
              <div className="flex flex-wrap gap-2">
                <select className="flex-1 min-w-32 rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent"
                  value={selMat} onChange={(e) => setSelMat(e.target.value)}>
                  <option value="">Seleccionar material...</option>
                  {disponibles.map((m) => (
                    <option key={m.id} value={m.id}>
                      <span className="inline-flex items-center gap-1">
                        <MaterialTipoIcon tipo={m.tipo} />
                        {m.nombre} ({m.unidad})
                      </span>
                      {m.zonas?.length ? ` — ${m.zonas.map((z) => zonaLabel(z)).join(", ")}` : ""}
                    </option>
                  ))}
                </select>
                <input type="number" min="0" step="any"
                  className="w-24 rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm outline-none focus:border-accent"
                  placeholder="Cant." value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                <input type="text"
                  className="flex-1 min-w-32 rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm outline-none focus:border-accent"
                  placeholder="Nota opcional..." value={notas} onChange={(e) => setNotas(e.target.value)} />
                <button type="button" onClick={addExisting} disabled={saving || !selMat || !cantidad}
                  className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent disabled:opacity-50">
                  Vincular
                </button>
              </div>
            </div>
          )}

          {canCreateCatalog ? (
            <div>
              <button
                type="button"
                onClick={() => setShowNuevo((v) => !v)}
                className="text-xs font-bold text-accent hover:underline">
                {showNuevo ? "▲ Ocultar formulario" : "+ Crear material nuevo en inventario y vincular"}
              </button>
              {showNuevo && (
                <div className="mt-2 rounded-paper border-2 border-accent/40 bg-surface p-3 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Nuevo en catálogo + esta etapa</p>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start">
                    <div className="min-w-0 flex-1 space-y-3">
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 sm:grid-cols-3">
                    <div className="col-span-2 sm:col-span-3">
                      <label className={MATERIAL_FORM_LABEL}>Nombre *</label>
                      <input
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
                        value={nuevoForm.nombre}
                        onChange={(e) => setNuevoForm((f) => ({ ...f, nombre: e.target.value }))}
                        placeholder="Ej: Alcohol isopropílico"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold text-muted">Tipo</label>
                      <select
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
                        value={nuevoForm.tipo}
                        onChange={(e) => setNuevoForm((f) => ({ ...f, tipo: e.target.value as MaterialTipo }))}>
                        <option value="materia_prima">🧱 Materia prima</option>
                        <option value="consumibles">📦 Consumibles</option>
                        <option value="repuestos">🔩 Repuestos</option>
                        <option value="herramientas">🔧 Herramientas</option>
                        <option value="elaborado">✨ Elaborado</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold text-muted">Unidad</label>
                      <select
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
                        value={nuevoForm.unidad}
                        onChange={(e) => setNuevoForm((f) => ({ ...f, unidad: e.target.value }))}>
                        {UNIDADES_MATERIAL.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold text-muted">Cant. en esta etapa *</label>
                      <input type="number" min="0" step="any"
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
                        value={nuevoForm.cantidad}
                        onChange={(e) => setNuevoForm((f) => ({ ...f, cantidad: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold text-muted">Stock inicial inventario</label>
                      <input type="number" min="0" step="any"
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
                        value={nuevoForm.stock_actual}
                        onChange={(e) => setNuevoForm((f) => ({ ...f, stock_actual: e.target.value }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-1 block text-[10px] font-bold text-muted">Zonas de trabajo</label>
                      <ZonasPicker
                        zonas={zonasCatalogo}
                        selected={nuevoZonaIds}
                        onChange={setNuevoZonaIds}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-1 block text-[10px] font-bold text-muted">Nota sobre uso en esta etapa</label>
                      <input type="text" placeholder="Ej: Uso específico para esta misión..."
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
                        value={nuevoForm.notas}
                        onChange={(e) => setNuevoForm((f) => ({ ...f, notas: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => { setShowNuevo(false); setNuevoForm({ ...emptyNuevoMaterialForm(), notas: "" }); setNuevoZonaIds([]); }}
                      className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface-hover">
                      Cancelar
                    </button>
                    <button type="button" onClick={crearYVincular}
                      disabled={saving || !nuevoForm.nombre.trim() || !nuevoForm.cantidad}
                      className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover disabled:opacity-50">
                      {saving ? "Guardando..." : "✓ Crear y vincular"}
                    </button>
                  </div>
                    </div>
                    <MaterialCalculadora
                      compact
                      unidad={nuevoForm.unidad}
                      fields={["cantidad", "stock_actual"]}
                      onApply={(field, value) => setNuevoForm((f) => ({ ...f, [field]: value }))}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : disponibles.length === 0 ? (
            <p className="text-xs text-muted">
              No hay materiales libres en inventario. Un supervisor puede crearlos en Inventario o elevar tu rol.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── INVENTARIO ────────────────────────────────────────────────────────────────

type InventarioZonaGrupo = {
  id: number;
  nombre: string;
  color: string;
  materiales: Material[];
};

type InventarioReinoGrupo = {
  id: number;
  nombre: string;
  color: string;
  /** Materiales vinculados solo al reino (sin zona concreta). */
  materiales: Material[];
  zonas: InventarioZonaGrupo[];
};

type InventarioArbol = {
  reinos: InventarioReinoGrupo[];
  sinUbicacion: Material[];
};

function zidsMaterial(m: Material): number[] {
  return (m.zonas || []).map((z) => z.id);
}

function sortMaterialesInventario(mats: Material[]): Material[] {
  return [...mats].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Sube subzona/departamento hasta reino o zona para clasificar el material. */
function anclaInventarioMaterial(m: Material, zonas: ZonaTrabajo[]): ZonaTrabajo | null {
  const byId = new Map(zonas.map((x) => [x.id, x]));
  let mejor: ZonaTrabajo | null = null;
  let mejorDepth = -1;

  for (const zid of zidsMaterial(m)) {
    let cur = byId.get(zid);
    while (cur) {
      const niv = nivelZona(cur, zonas);
      if (niv === "zona" || niv === "reino") {
        const d = zonaProfundidad(cur, zonas);
        if (d > mejorDepth) {
          mejorDepth = d;
          mejor = cur;
        }
        break;
      }
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
  }
  return mejor;
}

function agruparInventarioPorReinoYZona(materiales: Material[], zonas: ZonaTrabajo[]): InventarioArbol {
  const porZona = new Map<number, Material[]>();
  const porReino = new Map<number, Material[]>();
  const sinUbicacion: Material[] = [];

  for (const m of materiales) {
    const ancla = anclaInventarioMaterial(m, zonas);
    if (!ancla) {
      sinUbicacion.push(m);
      continue;
    }
    const niv = nivelZona(ancla, zonas);
    if (niv === "zona") {
      const arr = porZona.get(ancla.id) || [];
      arr.push(m);
      porZona.set(ancla.id, arr);
    } else {
      const arr = porReino.get(ancla.id) || [];
      arr.push(m);
      porReino.set(ancla.id, arr);
    }
  }

  const reinos: InventarioReinoGrupo[] = [];
  for (const { reino, zonas: zonasReino } of buildReinoNavTree(zonas)) {
    const zonaGrupos: InventarioZonaGrupo[] = [];
    for (const { zona } of zonasReino) {
      const mats = porZona.get(zona.id);
      if (mats?.length) {
        zonaGrupos.push({
          id: zona.id,
          nombre: zona.nombre,
          color: zona.color || reino.color || "#0c6069",
          materiales: sortMaterialesInventario(mats),
        });
      }
    }
    const matsReino = porReino.get(reino.id);
    const tieneAlgo = zonaGrupos.length > 0 || (matsReino?.length ?? 0) > 0;
    if (!tieneAlgo) continue;
    reinos.push({
      id: reino.id,
      nombre: reino.nombre,
      color: reino.color || "#0c6069",
      materiales: matsReino ? sortMaterialesInventario(matsReino) : [],
      zonas: zonaGrupos,
    });
  }

  return { reinos, sinUbicacion: sortMaterialesInventario(sinUbicacion) };
}

function inventarioReinoKey(id: number): string {
  return `reino-${id}`;
}

function inventarioZonaKey(id: number): string {
  return `zona-${id}`;
}

function zonaIdDesdeNavScope(scope: NavScope, zonas: ZonaTrabajo[]): number | null {
  if (scope.kind === "zona") return scope.id;
  if (scope.kind === "subzona" || scope.kind === "departamento") {
    const byId = new Map(zonas.map((x) => [x.id, x]));
    let cur = byId.get(scope.id);
    while (cur) {
      if (nivelZona(cur, zonas) === "zona") return cur.id;
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
  }
  return null;
}

function todasClavesInventario(arbol: InventarioArbol): string[] {
  const keys: string[] = [];
  for (const r of arbol.reinos) {
    keys.push(inventarioReinoKey(r.id));
    for (const z of r.zonas) keys.push(inventarioZonaKey(z.id));
  }
  if (arbol.sinUbicacion.length) keys.push("general-0");
  return keys;
}

function InventarioView({ token, user, navScope, onBack }: { token: string; user: TicketsUser; navScope: NavScope; onBack?: () => void }) {
  const [materiales, setMateriales] = useState<Material[]>([]);
  const [zonas, setZonas] = useState<ZonaTrabajo[]>([]);
  const [showNuevo, setShowNuevo] = useState(false);
  const [cartFlash, setCartFlash] = useState<string | null>(null);
  const setCarritoModalOpen = useInventarioCarrito((s) => s.setModalOpen);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const addAlCarrito = useInventarioCarrito((s) => s.addMaterial);
  const carritoItems = useInventarioCarrito((s) => s.items);
  const enCarrito = useCallback(
    (id: number) => carritoItems.some((i) => i.materialId === id),
    [carritoItems],
  );
  const [form, setForm] = useState({ nombre: "", descripcion: "", unidad: "kg", stock_actual: "", stock_minimo: "", precio_unitario: "", proveedor: "", tipo: "materia_prima" });
  const [formZonaIds, setFormZonaIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    nombre: "", descripcion: "", unidad: "kg", stock_actual: "", stock_minimo: "",
    precio_unitario: "", proveedor: "", tipo: "materia_prima" as MaterialTipo,
  });
  const [editZonaIds, setEditZonaIds] = useState<number[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [openGrupos, setOpenGrupos] = useState<Set<string>>(() => new Set());
  const nivel = user.rol?.nivel ?? 1;
  const canManageStock = nivel >= 2;

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [mats, zs] = await Promise.all([
        tapi("/materiales", token),
        tapi("/zonas-trabajo", token),
      ]);
      setMateriales(Array.isArray(mats) ? mats : []);
      setZonas(Array.isArray(zs) ? zs : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error al cargar inventario";
      setLoadError(msg);
      setMateriales([]);
      setZonas([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!cartFlash) return;
    const t = window.setTimeout(() => setCartFlash(null), 2200);
    return () => window.clearTimeout(t);
  }, [cartFlash]);

  function agregarMaterialAlCarrito(m: Material) {
    addAlCarrito(m);
    setCartFlash(m.nombre);
  }

  function abrirCarrito() {
    setCarritoModalOpen(true);
  }

  async function crearMaterial() {
    setSaving(true);
    try {
      await tapi("/materiales", token, { method: "POST", body: JSON.stringify({
        ...form,
        stock_actual: parseFloat(form.stock_actual || "0"),
        stock_minimo: parseFloat(form.stock_minimo || "0"),
        precio_unitario: parseFloat(form.precio_unitario || "0"),
        zona_ids: formZonaIds,
      }) });
      setForm({ nombre: "", descripcion: "", unidad: "kg", stock_actual: "", stock_minimo: "", precio_unitario: "", proveedor: "", tipo: "materia_prima" });
      setFormZonaIds([]);
      setShowNuevo(false);
      reload();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  function iniciarEdicion(m: Material) {
    setShowNuevo(false);
    setEditId(m.id);
    setEditForm({
      nombre: m.nombre,
      descripcion: m.descripcion || "",
      unidad: m.unidad,
      stock_actual: String(m.stock_actual),
      stock_minimo: String(m.stock_minimo),
      precio_unitario: String(m.precio_unitario),
      proveedor: m.proveedor || "",
      tipo: m.tipo || "materia_prima",
    });
    setEditZonaIds((m.zonas || []).map((z) => z.id));
  }

  async function guardarEdicion() {
    if (editId == null || !editForm.nombre.trim()) return;
    setSaving(true);
    try {
      await tapi(`/materiales/${editId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          nombre: editForm.nombre.trim(),
          descripcion: editForm.descripcion,
          unidad: editForm.unidad,
          tipo: editForm.tipo,
          stock_actual: parseFloat(editForm.stock_actual || "0"),
          stock_minimo: parseFloat(editForm.stock_minimo || "0"),
          precio_unitario: parseFloat(editForm.precio_unitario || "0"),
          proveedor: editForm.proveedor,
          zona_ids: editZonaIds,
        }),
      });
      setEditId(null);
      reload();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function ejecutarEliminacion() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setConfirmDelete(false);
    setSaving(true);
    setActionMsg(null);
    const okIds = new Set<number>();
    const errores: string[] = [];

    for (const id of ids) {
      try {
        await tapi(`/materiales/${id}`, token, { method: "DELETE" });
        okIds.add(id);
        continue;
      } catch {
        /* DELETE no disponible en servidor antiguo */
      }
      try {
        await tapi(`/materiales/${id}`, token, {
          method: "PUT",
          body: JSON.stringify({ activo: 0 }),
        });
        okIds.add(id);
      } catch (e: any) {
        errores.push(`${id}: ${e?.message || "Error"}`);
      }
    }

    if (okIds.size > 0) {
      setMateriales((prev) => prev.filter((m) => !okIds.has(m.id)));
      setSelectedIds(new Set());
      if (editId != null && okIds.has(editId)) setEditId(null);
      setActionMsg({
        type: "ok",
        text: `${okIds.size} material${okIds.size > 1 ? "es" : ""} eliminado${okIds.size > 1 ? "s" : ""} del catálogo.`,
      });
      await reload();
    }
    if (errores.length > 0) {
      setActionMsg({
        type: "err",
        text: errores.length === ids.length
          ? errores.join(" · ")
          : `${okIds.size} eliminados. Fallos: ${errores.join(" · ")}`,
      });
    } else if (okIds.size === 0) {
      setActionMsg({ type: "err", text: "No se pudo eliminar. Verifica permisos (supervisor+) o reinicia agente-pro." });
    }
    setSaving(false);
  }

  const bajoStockCount = materiales.filter((m) => m.stock_minimo > 0 && m.stock_actual < m.stock_minimo).length;
  const zonaIdsFiltro = zonaIdsEnScope(zonas, navScope);
  const materialesVisibles = useMemo(() => {
    if (!zonaIdsFiltro) return materiales;
    return materiales.filter((m) => (m.zonas || []).some((z) => zonaIdsFiltro.includes(z.id)));
  }, [materiales, zonaIdsFiltro]);

  const arbolInventario = useMemo((): InventarioArbol => {
    if (!zonas.length) {
      return {
        reinos: materialesVisibles.length
          ? [{
            id: 0,
            nombre: navScope.kind !== "all" ? navScopeLabel(navScope) : "Catálogo",
            color: "#94a3b8",
            materiales: sortMaterialesInventario(materialesVisibles),
            zonas: [],
          }]
          : [],
        sinUbicacion: [],
      };
    }
    return agruparInventarioPorReinoYZona(materialesVisibles, zonas);
  }, [materialesVisibles, zonas, navScope]);

  const totalZonasInventario = useMemo(
    () => arbolInventario.reinos.reduce((n, r) => n + r.zonas.length, 0),
    [arbolInventario],
  );

  const inventarioNavKey = useMemo(
    () => (navScope.kind === "all" ? "all" : `${navScope.kind}:${navScope.id}`),
    [navScope],
  );

  useEffect(() => {
    const { reinos, sinUbicacion } = arbolInventario;
    if (!reinos.length && !sinUbicacion.length) {
      setOpenGrupos(new Set());
      return;
    }
    const open = new Set<string>();
    if (navScope.kind === "reino") {
      open.add(inventarioReinoKey(navScope.id));
    } else if (navScope.kind === "zona") {
      const nodo = reinos.find((r) => r.zonas.some((z) => z.id === navScope.id));
      if (nodo) {
        open.add(inventarioReinoKey(nodo.id));
        open.add(inventarioZonaKey(navScope.id));
      }
    } else if (navScope.kind === "subzona" || navScope.kind === "departamento") {
      const zid = zonaIdDesdeNavScope(navScope, zonas);
      if (zid != null) {
        const nodo = reinos.find((r) => r.zonas.some((z) => z.id === zid));
        if (nodo) {
          open.add(inventarioReinoKey(nodo.id));
          open.add(inventarioZonaKey(zid));
        }
      }
    } else if (navScope.kind === "all") {
      if (reinos.length === 1) {
        open.add(inventarioReinoKey(reinos[0].id));
        if (reinos[0].zonas.length === 1) open.add(inventarioZonaKey(reinos[0].zonas[0].id));
      } else if (reinos.length > 0) {
        open.add(inventarioReinoKey(reinos[0].id));
      }
      if (sinUbicacion.length > 0) open.add("general-0");
    }
    setOpenGrupos(open);
    // Solo al cambiar filtro o estructura de reinos; no en cada recarga de materiales.
  }, [inventarioNavKey, zonas.length, arbolInventario.reinos.length, arbolInventario.sinUbicacion.length]);

  function toggleGrupoInventario(key: string) {
    setOpenGrupos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderInventarioMaterial(m: Material, openKey: string) {
    const pct = m.stock_minimo > 0 ? Math.min(100, Math.round((m.stock_actual / m.stock_minimo) * 100)) : 100;
    const bajo = m.stock_minimo > 0 && m.stock_actual < m.stock_minimo;
    const editando = editId === m.id;

    if (editando && nivel >= 2) {
      return (
        <div key={m.id} className="rounded-paper border-2 border-accent bg-surface-panel p-3 shadow-paper-sm space-y-3 sm:col-span-2 xl:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold text-accent">✏️ Editar material</h3>
            <button type="button" onClick={() => setEditId(null)}
              className="text-xs font-bold text-muted hover:text-ink">Cancelar</button>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-3">
          <div className={MATERIAL_FORM_GRID}>
            <div className={MATERIAL_FORM_GRID_FULL}>
              <label className={MATERIAL_FORM_LABEL}>Nombre *</label>
              <input className={MATERIAL_FORM_INPUT}
                value={editForm.nombre} onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div>
              <label className={MATERIAL_FORM_LABEL}>Tipo</label>
              <select className={MATERIAL_FORM_INPUT}
                value={editForm.tipo} onChange={(e) => setEditForm((f) => ({ ...f, tipo: e.target.value as MaterialTipo }))}>
                <option value="materia_prima">🧱 Materia prima</option>
                <option value="elaborado">✨ Producto elaborado</option>
                <option value="consumibles">📦 Consumibles</option>
                <option value="repuestos">🔩 Repuestos</option>
                <option value="herramientas">🔧 Herramientas</option>
              </select>
            </div>
            <div>
              <label className={MATERIAL_FORM_LABEL}>Unidad</label>
              <select className={MATERIAL_FORM_INPUT}
                value={editForm.unidad} onChange={(e) => setEditForm((f) => ({ ...f, unidad: e.target.value }))}>
                {UNIDADES_MATERIAL.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={MATERIAL_FORM_LABEL}>Stock actual</label>
              <input type="number" min="0" step="any" className={MATERIAL_FORM_INPUT}
                value={editForm.stock_actual} onChange={(e) => setEditForm((f) => ({ ...f, stock_actual: e.target.value }))} />
            </div>
            <div>
              <label className={MATERIAL_FORM_LABEL}>Stock mínimo</label>
              <input type="number" min="0" step="any" className={MATERIAL_FORM_INPUT}
                value={editForm.stock_minimo} onChange={(e) => setEditForm((f) => ({ ...f, stock_minimo: e.target.value }))} />
            </div>
            <div>
              <label className={MATERIAL_FORM_LABEL}>Precio unit. ($)</label>
              <input type="number" min="0" step="any" className={MATERIAL_FORM_INPUT}
                value={editForm.precio_unitario} onChange={(e) => setEditForm((f) => ({ ...f, precio_unitario: e.target.value }))} />
            </div>
            <div>
              <label className={MATERIAL_FORM_LABEL}>Proveedor</label>
              <input className={MATERIAL_FORM_INPUT}
                value={editForm.proveedor} onChange={(e) => setEditForm((f) => ({ ...f, proveedor: e.target.value }))} />
            </div>
            <div className={MATERIAL_FORM_GRID_FULL}>
              <label className={MATERIAL_FORM_LABEL}>Descripción</label>
              <textarea rows={1} className={`${MATERIAL_FORM_INPUT} resize-none`}
                value={editForm.descripcion} onChange={(e) => setEditForm((f) => ({ ...f, descripcion: e.target.value }))} />
            </div>
            <div className={MATERIAL_FORM_GRID_FULL}>
              <label className={MATERIAL_FORM_LABEL}>Zonas de trabajo</label>
              <ZonasPicker compact zonas={zonas} selected={editZonaIds} onChange={setEditZonaIds} />
            </div>
          </div>
          {editForm.tipo === "elaborado" && (
            <p className="text-[10px] text-purple-600">El stock también puede actualizarse al completar la misión vinculada.</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditId(null)}
              className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface-hover">
              Cancelar
            </button>
            <button type="button" onClick={guardarEdicion} disabled={saving || !editForm.nombre.trim()}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover disabled:opacity-50">
              {saving ? "Guardando..." : "✓ Guardar cambios"}
            </button>
          </div>
            </div>
            <MaterialCalculadora
              compact
              unidad={editForm.unidad}
              onApply={(field, value) => setEditForm((f) => ({ ...f, [field]: value }))}
            />
          </div>
        </div>
      );
    }

    const seleccionado = selectedIds.has(m.id);

    return (
      <div key={m.id} className={`rounded-paper border-2 bg-surface-panel p-2.5 sm:p-3 shadow-paper-sm ${bajo ? "border-red-300" : seleccionado ? "border-accent/60 ring-1 ring-accent/30" : "border-border"}`}>
        <div className="flex items-start gap-2">
          {canManageStock && (
            <label className="flex shrink-0 cursor-pointer items-center pt-0.5" title="Seleccionar para eliminar">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-border accent-accent"
                checked={seleccionado}
                onChange={() => toggleSelect(m.id)}
              />
            </label>
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {bajo && <span className="text-xs">{m.stock_actual <= 0 ? "🔴" : "🟡"}</span>}
              <p className="truncate text-sm font-bold text-ink">{m.nombre}</p>
              <BadgeTipoMaterial tipo={m.tipo} />
              <span className={`ml-auto text-sm font-black tabular-nums ${bajo ? "text-red-600" : "text-ink"}`}>
                {m.stock_actual} <span className="text-[10px] font-normal text-muted">{m.unidad}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
              <BadgesZonas zonas={m.zonas} compact />
              {m.stock_minimo > 0 && <span>Mín: {m.stock_minimo}</span>}
              {m.proveedor && <span className="max-w-[8rem] truncate">· {m.proveedor}</span>}
              {m.precio_unitario > 0 && <span>${m.precio_unitario.toLocaleString("es-CO")}/{m.unidad}</span>}
              {m.tipo === "elaborado" && <span className="text-purple-600">Elaborado</span>}
            </div>
            {m.descripcion && <p className="text-[10px] text-muted line-clamp-1">{m.descripcion}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => agregarMaterialAlCarrito(m)}
              className={`rounded-paper border-2 px-2.5 py-1.5 text-xs font-bold transition ${
                enCarrito(m.id)
                  ? "border-amber-500/70 bg-amber-500/20 text-amber-900 dark:text-amber-200"
                  : "border-border text-muted hover:border-amber-500/60 hover:text-amber-800 dark:hover:text-amber-200"
              }`}
              title={enCarrito(m.id) ? "Ya en el carrito — clic suma cantidad" : "Agregar al carrito de compras"}
            >
              🛒
            </button>
            {nivel >= 2 && (
              <button
                type="button"
                onClick={() => {
                  setOpenGrupos((prev) => new Set([...prev, openKey]));
                  iniciarEdicion(m);
                }}
                className="rounded-paper border-2 border-border px-2.5 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent"
                title="Editar material">
                ✏️
              </button>
            )}
          </div>
        </div>
        {m.stock_minimo > 0 && (
          <>
            <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
              <div className={`h-full rounded-full transition-all ${m.stock_actual <= 0 ? "bg-red-600" : bajo ? "bg-orange-400" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>{pct}% del mínimo</span>
              {m.precio_unitario > 0 && <span>${m.precio_unitario.toLocaleString("es-CO")} / {m.unidad}</span>}
            </div>
          </>
        )}
      </div>
    );
  }

  const formNuevoMaterial = (
    <div className="rounded-paper border-2 border-accent/50 bg-surface-panel p-3 sm:p-4">
      <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-muted">Nuevo material o insumo</h3>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-3">
      <div className={MATERIAL_FORM_GRID}>
        <div className={MATERIAL_FORM_GRID_FULL}>
          <label className={MATERIAL_FORM_LABEL}>Nombre *</label>
          <input className={MATERIAL_FORM_INPUT}
            value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} autoFocus />
        </div>
        <div>
          <label className={MATERIAL_FORM_LABEL}>Tipo</label>
          <select className={MATERIAL_FORM_INPUT}
            value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
            <option value="materia_prima">🧱 Materia prima</option>
            <option value="elaborado">✨ Producto elaborado</option>
            <option value="consumibles">📦 Consumibles / insumo</option>
            <option value="repuestos">🔩 Repuestos</option>
            <option value="herramientas">🔧 Herramientas</option>
          </select>
        </div>
        <div>
          <label className={MATERIAL_FORM_LABEL}>Unidad</label>
          <select className={MATERIAL_FORM_INPUT}
            value={form.unidad} onChange={(e) => setForm((f) => ({ ...f, unidad: e.target.value }))}>
            {UNIDADES_MATERIAL.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={MATERIAL_FORM_LABEL}>Stock inicial</label>
          <input type="number" min="0" step="any"
            className={MATERIAL_FORM_INPUT}
            value={form.stock_actual} onChange={(e) => setForm((f) => ({ ...f, stock_actual: e.target.value }))} />
        </div>
        <div>
          <label className={MATERIAL_FORM_LABEL}>Stock mínimo</label>
          <input type="number" min="0" step="any"
            className={MATERIAL_FORM_INPUT}
            value={form.stock_minimo} onChange={(e) => setForm((f) => ({ ...f, stock_minimo: e.target.value }))} />
        </div>
        <div>
          <label className={MATERIAL_FORM_LABEL}>Precio unit. ($)</label>
          <input type="number" min="0" step="any"
            className={MATERIAL_FORM_INPUT}
            value={form.precio_unitario} onChange={(e) => setForm((f) => ({ ...f, precio_unitario: e.target.value }))} />
        </div>
        <div>
          <label className={MATERIAL_FORM_LABEL}>Proveedor</label>
          <input className={MATERIAL_FORM_INPUT}
            value={form.proveedor} onChange={(e) => setForm((f) => ({ ...f, proveedor: e.target.value }))} />
        </div>
        <div className={MATERIAL_FORM_GRID_FULL}>
          <label className={MATERIAL_FORM_LABEL}>Descripción</label>
          <textarea rows={1} className={`${MATERIAL_FORM_INPUT} resize-none`}
            value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
        </div>
        <div className={MATERIAL_FORM_GRID_FULL}>
          <label className={MATERIAL_FORM_LABEL}>Zonas de trabajo</label>
          <ZonasPicker compact zonas={zonas} selected={formZonaIds} onChange={setFormZonaIds} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setShowNuevo(false)}
          className="rounded-paper border-2 border-border px-4 py-2 text-xs font-bold text-muted hover:bg-surface-hover">
          Cancelar
        </button>
        <button type="button" onClick={crearMaterial} disabled={saving || !form.nombre.trim()}
          className="rounded-paper border-2 border-accent bg-accent px-6 py-2 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
          {saving ? "Guardando..." : "Crear material"}
        </button>
      </div>
        </div>
        <MaterialCalculadora
          unidad={form.unidad}
          onApply={(field, value) => setForm((f) => ({ ...f, [field]: value }))}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent"
            >
              <QuestBoardBackLabel />
            </button>
          )}
          <div>
          <h2 className="text-xl font-extrabold text-ink">Inventario</h2>
          <p className="text-xs text-muted">
            {materialesVisibles.length} material{materialesVisibles.length !== 1 ? "es" : ""} e insumo{materialesVisibles.length !== 1 ? "s" : ""}
            {arbolInventario.reinos.length > 0 && (
              <span className="ml-1">
                · {arbolInventario.reinos.length} reino{arbolInventario.reinos.length !== 1 ? "s" : ""}
                {totalZonasInventario > 0 && (
                  <>, {totalZonasInventario} zona{totalZonasInventario !== 1 ? "s" : ""}</>
                )}
              </span>
            )}
            {navScope.kind !== "all" && (
              <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                {navScopeLabel(navScope)}
              </span>
            )}
            {bajoStockCount > 0 && (
              <span className="ml-2 font-semibold text-red-600">· {bajoStockCount} bajo mínimo</span>
            )}
          </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InventarioCarritoBadge onOpen={abrirCarrito} />
          {canManageStock && (
            <button
              type="button"
              onClick={() => { setShowNuevo((v) => !v); if (!showNuevo) setEditId(null); }}
              className={`rounded-xl border-2 px-4 py-2 text-sm font-bold transition shadow-[0_2px_0_#045159] active:translate-y-0.5 active:shadow-none ${
                showNuevo
                  ? "border-border bg-surface-hover text-ink"
                  : "border-accent bg-accent text-white hover:bg-accent-hover"
              }`}
            >
              {showNuevo ? "Cerrar" : "+ Nuevo material"}
            </button>
          )}
        </div>
      </div>

      {cartFlash && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
          🛒 <span className="font-bold">{cartFlash}</span> agregado al carrito.
          <button
            type="button"
            onClick={abrirCarrito}
            className="ml-2 font-bold underline hover:no-underline"
          >
            Ver carrito
          </button>
        </p>
      )}

      {showNuevo && canManageStock && formNuevoMaterial}

      {loading && (
        <p className="py-8 text-center text-sm text-muted">Cargando inventario…</p>
      )}

      {loadError && !loading && (
        <div className="rounded-paper border-2 border-red-400/70 bg-red-50 px-4 py-3 dark:bg-red-950/40 space-y-2">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">{loadError}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent"
          >
            Reintentar
          </button>
        </div>
      )}

      <div className={`space-y-3 ${loading ? "pointer-events-none opacity-40" : ""}`}>
          {nivel < 2 && (
            <p className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs text-muted">
              Vista de solo lectura. Supervisor o administrador puede editar stock y datos del catálogo.
            </p>
          )}
          {canManageStock && materialesVisibles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-paper border-2 border-border bg-surface-panel px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-accent"
                  checked={selectedIds.size === materialesVisibles.length && materialesVisibles.length > 0}
                  onChange={() => {
                    if (selectedIds.size === materialesVisibles.length) setSelectedIds(new Set());
                    else setSelectedIds(new Set(materialesVisibles.map((m) => m.id)));
                  }}
                />
                Seleccionar todos
              </label>
              <span className="text-xs text-muted">
                {selectedIds.size > 0 ? `${selectedIds.size} seleccionado${selectedIds.size > 1 ? "s" : ""}` : "Ninguno"}
              </span>
              <div className="ml-auto flex gap-2">
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface-hover"
                  >
                    Limpiar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving || selectedIds.size === 0}
                  className="rounded-paper border-2 border-red-400/80 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-500 hover:text-white disabled:opacity-40 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-600"
                >
                  {saving ? "Eliminando..." : `🗑 Eliminar${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
                </button>
              </div>
            </div>
          )}
          {confirmDelete && selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-paper border-2 border-red-400/70 bg-red-50 px-4 py-3 dark:bg-red-950/50">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                ¿Eliminar {selectedIds.size} material{selectedIds.size > 1 ? "es" : ""} del inventario?
                <span className="mt-0.5 block text-xs font-normal opacity-80">Se archivan del catálogo; los vínculos en misiones existentes no se borran.</span>
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmDelete(false)}
                  className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface-hover">
                  Cancelar
                </button>
                <button type="button" onClick={ejecutarEliminacion} disabled={saving}
                  className="rounded-paper border-2 border-red-600 bg-red-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">
                  Sí, eliminar
                </button>
              </div>
            </div>
          )}
          {actionMsg && (
            <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${actionMsg.type === "ok" ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"}`}>
              {actionMsg.text}
            </p>
          )}
          {(arbolInventario.reinos.length > 1 || totalZonasInventario > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Reinos y zonas</span>
              <button
                type="button"
                onClick={() => setOpenGrupos(new Set(todasClavesInventario(arbolInventario)))}
                className="rounded-paper border border-border px-2.5 py-1 text-[10px] font-bold text-muted transition hover:border-accent hover:text-accent"
              >
                Expandir todo
              </button>
              <button
                type="button"
                onClick={() => setOpenGrupos(new Set())}
                className="rounded-paper border border-border px-2.5 py-1 text-[10px] font-bold text-muted transition hover:border-accent hover:text-accent"
              >
                Colapsar todo
              </button>
            </div>
          )}
          {materialesVisibles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {navScope.kind !== "all" ? `No hay materiales en ${navScopeLabel(navScope)}.` : "No hay materiales en el catálogo aún."}
            </p>
          ) : (
            <>
              {arbolInventario.reinos.map((reino) => {
                const rKey = inventarioReinoKey(reino.id);
                const reinoAbierto = openGrupos.has(rKey);
                const totalReino =
                  reino.materiales.length + reino.zonas.reduce((n, z) => n + z.materiales.length, 0);
                const bajoReino = [...reino.materiales, ...reino.zonas.flatMap((z) => z.materiales)].some(
                  (m) => m.stock_minimo > 0 && m.stock_actual < m.stock_minimo,
                );
                return (
                  <div
                    key={rKey}
                    className={`quest-inventario-grupo quest-inventario-grupo--reino ${reinoAbierto ? "quest-inventario-grupo--open" : ""}`}
                    style={{ "--inv-accent": reino.color } as CSSProperties}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGrupoInventario(rKey)}
                      className="quest-inventario-grupo-header w-full text-left"
                      aria-expanded={reinoAbierto}
                    >
                      <span className={`quest-inventario-grupo-chevron ${reinoAbierto ? "quest-inventario-grupo-chevron--open" : ""}`} aria-hidden>▼</span>
                      <ZonaColorDot color={reino.color} size="md" />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-extrabold text-ink">{reino.nombre}</h3>
                        <p className="truncate text-[10px] text-muted">
                          Reino
                          {reino.zonas.length > 0 && (
                            <span> · {reino.zonas.length} zona{reino.zonas.length !== 1 ? "s" : ""}</span>
                          )}
                        </p>
                      </div>
                      {bajoReino && (
                        <span className="shrink-0 text-[10px] font-bold text-red-600" title="Stock bajo mínimo">⚠</span>
                      )}
                      <span className="quest-inventario-grupo-count shrink-0 tabular-nums">{totalReino}</span>
                    </button>
                    {reinoAbierto && (
                      <div className="quest-inventario-grupo-body space-y-2">
                        {reino.materiales.length > 0 && (
                          <div className="quest-inventario-grupo-items grid gap-2 sm:grid-cols-2 xl:grid-cols-3 border-b border-border/50 pb-2">
                            <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-muted">General del reino</p>
                            {reino.materiales.map((m) => renderInventarioMaterial(m, rKey))}
                          </div>
                        )}
                        {reino.zonas.map((zona) => {
                          const zKey = inventarioZonaKey(zona.id);
                          const zonaAbierta = openGrupos.has(zKey);
                          const bajoZona = zona.materiales.some(
                            (m) => m.stock_minimo > 0 && m.stock_actual < m.stock_minimo,
                          );
                          return (
                            <div
                              key={zKey}
                              className={`quest-inventario-grupo quest-inventario-grupo--zona ${zonaAbierta ? "quest-inventario-grupo--open" : ""}`}
                              style={{ "--inv-accent": zona.color } as CSSProperties}
                            >
                              <button
                                type="button"
                                onClick={() => toggleGrupoInventario(zKey)}
                                className="quest-inventario-grupo-header quest-inventario-grupo-header--zona w-full text-left"
                                aria-expanded={zonaAbierta}
                              >
                                <span className={`quest-inventario-grupo-chevron ${zonaAbierta ? "quest-inventario-grupo-chevron--open" : ""}`} aria-hidden>▼</span>
                                <ZonaColorDot color={zona.color} size="sm" />
                                <div className="min-w-0 flex-1">
                                  <h4 className="truncate text-xs font-extrabold text-ink">{zona.nombre}</h4>
                                  <p className="truncate text-[10px] text-muted">Zona · {reino.nombre}</p>
                                </div>
                                {bajoZona && (
                                  <span className="shrink-0 text-[10px] font-bold text-red-600" title="Stock bajo mínimo">⚠</span>
                                )}
                                <span className="quest-inventario-grupo-count shrink-0 tabular-nums">{zona.materiales.length}</span>
                              </button>
                              {zonaAbierta && (
                                <div className="quest-inventario-grupo-items grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                  {zona.materiales.map((m) => renderInventarioMaterial(m, zKey))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {arbolInventario.sinUbicacion.length > 0 && (() => {
                const gKey = "general-0";
                const abierto = openGrupos.has(gKey);
                const bajo = arbolInventario.sinUbicacion.some(
                  (m) => m.stock_minimo > 0 && m.stock_actual < m.stock_minimo,
                );
                return (
                  <div
                    className={`quest-inventario-grupo ${abierto ? "quest-inventario-grupo--open" : ""}`}
                    style={{ "--inv-accent": "#94a3b8" } as CSSProperties}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGrupoInventario(gKey)}
                      className="quest-inventario-grupo-header w-full text-left"
                      aria-expanded={abierto}
                    >
                      <span className={`quest-inventario-grupo-chevron ${abierto ? "quest-inventario-grupo-chevron--open" : ""}`} aria-hidden>▼</span>
                      <ZonaColorDot color="#94a3b8" size="md" />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-extrabold text-ink">Sin ubicación asignada</h3>
                        <p className="truncate text-[10px] text-muted">Catálogo general</p>
                      </div>
                      {bajo && <span className="shrink-0 text-[10px] font-bold text-red-600" title="Stock bajo mínimo">⚠</span>}
                      <span className="quest-inventario-grupo-count shrink-0 tabular-nums">{arbolInventario.sinUbicacion.length}</span>
                    </button>
                    {abierto && (
                      <div className="quest-inventario-grupo-items grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {arbolInventario.sinUbicacion.map((m) => renderInventarioMaterial(m, gKey))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
      </div>
    </div>
  );
}

// Create mission form
function CreateMisionView({
  token, user, onBack, onCreated,
}: {
  token: string;
  user: TicketsUser;
  onBack: () => void;
  onCreated: (id: number) => void;
}) {
  const { cats: categorias } = useContext(CategoriasCtx);
  const [form, setForm] = useState({
    titulo: "", descripcion: "",
    tipo: "secuencial", color: "#0c6069",
    modo_ciclo: "finita" as ModoCicloMision,
  });
  const [ubicacion, setUbicacion] = useState<{
    reinoId: number | "";
    zonaId: number | "";
    subzonaId: number | "";
    departamentoId: number | "";
  }>({ reinoId: "", zonaId: "", subzonaId: "", departamentoId: "" });
  const [etapas, setEtapas] = useState<EtapaDraft[]>([{ titulo: "", descripcion: "", pasos: [], frecuencia: "", materiales: [] }]);
  const [asignaciones, setAsignaciones] = useState<Record<number, string>>({});
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [catalogoMateriales, setCatalogoMateriales] = useState<Material[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [todasMisiones, setTodasMisiones] = useState<Mision[]>([]);
  const [zonasCat, setZonasCat] = useState<ZonaTrabajo[]>([]);
  const [depPrereqs, setDepPrereqs] = useState<PrerequisitoRef[]>([]);
  const [todasRecetas, setTodasRecetas] = useState<RecetaPrereq[]>([]);
  const canManageZonas = (user.rol?.nivel ?? 1) >= 2;
  const [infoMsg, setInfoMsg] = useState("");

  const MISION_DRAFT_KEY = "mckenna-mision-draft";

  useEffect(() => {
    tapi("/usuarios", token).then((d) => setUsuarios(Array.isArray(d) ? d : [])).catch(() => {});
    tapi("/misiones/", token).then((d) => setTodasMisiones(Array.isArray(d) ? d : [])).catch(() => {});
    tapi("/recetas", token).then((d) => setTodasRecetas(Array.isArray(d) ? d : [])).catch(() => {});
    tapi("/zonas-trabajo", token).then((d) => setZonasCat(Array.isArray(d) ? d : [])).catch(() => {});
    tapi("/materiales", token).then((d) => setCatalogoMateriales(Array.isArray(d) ? d : [])).catch(() => {});
    try {
      const raw = sessionStorage.getItem(MISION_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        form?: typeof form;
        ubicacion?: typeof ubicacion;
        etapas?: EtapaDraft[];
        asignaciones?: Record<number, string>;
        depPrereqs?: PrerequisitoRef[];
      };
      if (d.form) setForm(d.form);
      if (d.ubicacion) setUbicacion(d.ubicacion);
      if (d.etapas?.length) {
        setEtapas(
          d.etapas.map((e) => ({
            ...e,
            pasos: normalizePasoDraftList(e.pasos),
          })),
        );
      }
      if (d.asignaciones) setAsignaciones(d.asignaciones);
      if (d.depPrereqs) setDepPrereqs(d.depPrereqs);
    } catch {
      /* borrador corrupto */
    }
  }, [token]);

  const zonaIdEfectivo =
    ubicacion.departamentoId !== "" ? ubicacion.departamentoId
    : ubicacion.subzonaId !== "" ? ubicacion.subzonaId
    : ubicacion.zonaId !== "" ? ubicacion.zonaId
    : ubicacion.reinoId;

  const padreDeptMision = padreIdParaDepartamentos(
    zonasCat,
    ubicacion.zonaId,
    ubicacion.subzonaId,
  );
  const deptHijos =
    padreDeptMision !== "" ? departamentosDePadre(zonasCat, padreDeptMision) : [];

  function setF(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  function addEtapa() {
    setEtapas((e) => [...e, { titulo: "", descripcion: "", pasos: [], frecuencia: "", materiales: [] }]);
  }
  function setEtapaFrecuencia(i: number, v: string) {
    setEtapas((e) => e.map((et, idx) => idx === i ? { ...et, frecuencia: v } : et));
  }
  function removeEtapa(i: number) {
    setEtapas((e) => e.filter((_, idx) => idx !== i));
    setAsignaciones((a) => {
      const next: Record<number, string> = {};
      Object.entries(a).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < i + 1) next[ki] = v;
        else if (ki > i + 1) next[ki - 1] = v;
      });
      return next;
    });
  }
  function setEtapa(i: number, k: "titulo" | "descripcion", v: string) {
    setEtapas((e) => e.map((et, idx) => idx === i ? { ...et, [k]: v } : et));
  }
  function setEtapaPasos(i: number, pasos: PasoDraft[]) {
    setEtapas((e) => e.map((et, idx) => idx === i ? { ...et, pasos } : et));
  }
  function setEtapaMateriales(i: number, materiales: MaterialDraft[]) {
    setEtapas((e) => e.map((et, idx) => idx === i ? { ...et, materiales } : et));
  }

  function guardarBorrador() {
    setError("");
    try {
      sessionStorage.setItem(
        MISION_DRAFT_KEY,
        JSON.stringify({
          form,
          ubicacion,
          etapas,
          asignaciones,
          depPrereqs,
        }),
      );
      setInfoMsg("Borrador guardado en este navegador");
      window.setTimeout(() => setInfoMsg(""), 4000);
    } catch {
      setError("No se pudo guardar el borrador en este navegador");
    }
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!form.titulo) { setError("Título de misión requerido"); return; }
    if (zonaIdEfectivo === "" || ubicacion.zonaId === "") {
      setError("Selecciona reino y zona (ej. Cocina en Hogar Dulce Hogar).");
      return;
    }
    if (
      typeof ubicacion.zonaId === "number"
      && subzonasDeZona(zonasCat, ubicacion.zonaId).length > 0
      && ubicacion.subzonaId === ""
    ) {
      setError("Esta zona tiene subzonas: selecciona una antes del departamento.");
      return;
    }
    if (deptHijos.length > 0 && ubicacion.departamentoId === "") {
      setError("Selecciona el departamento (labor) donde se ejecuta la misión.");
      return;
    }
    if (etapas.some((e) => !e.titulo)) { setError("Todas las etapas deben tener título"); return; }
    setLoading(true);
    const asignacionesPorOrden: Record<string, string> = {};
    Object.entries(asignaciones).forEach(([k, v]) => { if (v) asignacionesPorOrden[k] = v; });
    try {
      const m = await tapi("/misiones/", token, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          zona_id: zonaIdEfectivo,
          etapas: etapas.map((e) => ({
            titulo: e.titulo,
            descripcion: e.descripcion,
            pasos: pasoDraftsToApi(e.pasos),
            frecuencia: e.frecuencia || null,
            materiales: materialesDraftToApi(e.materiales || []),
          })),
          asignaciones: asignacionesPorOrden,
        }),
      });
      // Add prerequisites sequentially
      for (const dep of depPrereqs) {
        await tapi(`/misiones/${m.id}/dependencias`, token, {
          method: "POST",
          body: JSON.stringify({ tipo: dep.tipo, referencia_id: dep.id }),
        }).catch(() => {});
      }
      sessionStorage.removeItem(MISION_DRAFT_KEY);
      onCreated(m.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isSecuencial = form.tipo === "secuencial";

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver"
            title="Volver"
            className="shrink-0 rounded-paper border-2 border-border px-2.5 py-1.5 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
          >
            ←
          </button>
          <h2 className="shrink-0 text-xl font-extrabold text-ink">Nueva Misión</h2>
          <p className="text-xs text-muted">
            El cronómetro se usa en cada ticket al ejecutar la misión
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="rounded-full border border-border bg-surface-panel px-2.5 py-1 text-xs font-semibold text-muted">
            {etapas.length} ticket{etapas.length !== 1 ? "s" : ""}
          </span>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
            form.modo_ciclo === "infinita"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-border bg-surface-panel text-muted"
          }`}>
            {form.modo_ciclo === "infinita" ? "♾️ Infinita" : "📌 Finita"}
          </span>
          <span className="rounded-full border border-border bg-surface-panel px-2.5 py-1 text-xs font-semibold text-muted">
            {isSecuencial ? "🔗 Secuencial" : "⚡ Paralelo"}
          </span>
          {infoMsg && (
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              {infoMsg}
            </span>
          )}
          {error && (
            <span className="max-w-md rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={guardarBorrador}
            className="rounded-paper border-2 border-border bg-surface-panel px-4 py-2 text-sm font-bold text-ink transition hover:border-accent hover:text-accent"
            title="Guarda el formulario en este navegador (no crea la misión en el servidor)"
          >
            Borrador local
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
            className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50"
          >
            {loading ? "Guardando..." : "Guardar misión"}
          </button>
        </div>
      </div>

      <form
        id="form-nueva-mision"
        noValidate
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <div className="grid gap-4 xl:grid-cols-12 xl:items-start">
          {/* Columna izquierda: datos de la misión */}
          <div className="space-y-4 xl:col-span-4 xl:sticky xl:top-4">
            <div className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper space-y-3">
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Información general</h3>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Título *</label>
                <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="Nombre de la misión" value={form.titulo} onChange={setF("titulo")} maxLength={150} />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Tipo de misión *</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MODO_CICLO_OPTS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer gap-2 rounded-paper border-2 px-3 py-2.5 transition ${
                        form.modo_ciclo === opt.value
                          ? "border-accent bg-accent/10"
                          : "border-border bg-surface-input hover:border-accent/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="modo_ciclo_nueva"
                        className="mt-0.5 shrink-0 accent-accent"
                        checked={form.modo_ciclo === opt.value}
                        onChange={() => setForm((f) => ({ ...f, modo_ciclo: opt.value }))}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-ink">{opt.label}</span>
                        <span className="block text-[10px] leading-snug text-muted">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Flujo</label>
                  <select className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent"
                    value={form.tipo} onChange={setF("tipo")}>
                    <option value="secuencial">🔗 Secuencial</option>
                    <option value="paralelo">⚡ Paralelo</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.color} onChange={setF("color")}
                      className="h-9 w-12 cursor-pointer rounded-paper border-2 border-border p-0.5" />
                    <span className="truncate text-[10px] font-mono text-muted">{form.color}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Descripción</label>
                <textarea className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent resize-none"
                  rows={2} placeholder="Objetivo general..."
                  value={form.descripcion} onChange={setF("descripcion")} />
              </div>

              {zonasCat.length > 0 ? (
                <MisionUbicacionPicker
                  zonas={zonasCat}
                  reinoId={ubicacion.reinoId}
                  zonaId={ubicacion.zonaId}
                  subzonaId={ubicacion.subzonaId}
                  departamentoId={ubicacion.departamentoId}
                  token={token}
                  canManageZonas={canManageZonas}
                  onZonaCreada={(nueva) => setZonasCat((prev) => [...prev, nueva])}
                  onChange={(v) => {
                    setUbicacion({
                      reinoId: v.reinoId,
                      zonaId: v.zonaId,
                      subzonaId: v.subzonaId,
                      departamentoId: v.departamentoId,
                    });
                    if (v.color) setForm((f) => ({ ...f, color: v.color! }));
                  }}
                />
              ) : (
                <div className="rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  Crea reinos en <strong>🏰 Reinos</strong> primero.
                </div>
              )}

            </div>

            {(todasMisiones.length > 0 || todasRecetas.length > 0) && (
              <PrerequisitosBlock
                items={depPrereqs}
                onItemsChange={setDepPrereqs}
                todasMisiones={todasMisiones}
                todasRecetas={todasRecetas}
              />
            )}
          </div>

          {/* Columna derecha: tickets */}
          <div className="space-y-3 xl:col-span-8">
            <div className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">
                    Tickets a generar
                  </h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {isSecuencial
                      ? "Secuencial: cada ticket desbloquea el siguiente"
                      : "Paralelo: todos activos al mismo tiempo"}
                    {" · "}
                    Arrastra con ⠿ y redimensiona desde la esquina.
                  </p>
                </div>
                <button type="button" onClick={addEtapa}
                  className="rounded-paper border-2 border-accent px-3 py-1.5 text-xs font-bold text-accent transition hover:bg-accent hover:text-white">
                  + Ticket
                </button>
              </div>

              <QuestBoardStickyCanvas
                sectionKey={MISION_DRAFT_ETAPAS_SECTION}
                itemCount={etapas.length}
              >
                <CreateMisionEtapaFrames
                  etapas={etapas}
                  isSecuencial={isSecuencial}
                  formColor={form.color}
                  modoCicloInfinita={form.modo_ciclo === "infinita"}
                  asignaciones={asignaciones}
                  usuarios={usuarios}
                  onRemove={removeEtapa}
                  onEtapaTitulo={(i, v) => setEtapa(i, "titulo", v)}
                  onEtapaDesc={(i, v) => setEtapa(i, "descripcion", v)}
                  onAsignacion={(orden, userId) =>
                    setAsignaciones((a) => ({ ...a, [orden]: userId }))
                  }
                  onEtapaPasos={(i, pasos) => setEtapaPasos(i, pasos)}
                  onEtapaFrecuencia={(i, v) => setEtapaFrecuencia(i, v)}
                  onEtapaMateriales={(i, materiales) => setEtapaMateriales(i, materiales)}
                  catalogoMateriales={catalogoMateriales}
                  zonaSugerida={
                    ubicacion.reinoId !== ""
                      ? zonasCat.find((z) => z.id === ubicacion.reinoId)?.nombre ?? null
                      : null
                  }
                />
              </QuestBoardStickyCanvas>
            </div>
          </div>
        </div>

      </form>
    </div>
  );
}

// Mission detail with etapa pipeline and launch modal
function MisionDetailView({
  token, user, misionId, onBack, onTicket,
}: {
  token: string; user: TicketsUser; misionId: number;
  onBack: () => void; onTicket: (id: number) => void;
}) {
  const readonly = false;
  const { cats: categorias } = useContext(CategoriasCtx);
  const [mision, setMision] = useState<Mision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [renewing, setRenewing] = useState(false);

  // Edit metadata panel
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({
    titulo: "", descripcion: "", color: "", estado: "", modo_ciclo: "finita" as ModoCicloMision,
  });
  const [metaUbicacion, setMetaUbicacion] = useState<{
    reinoId: number | "";
    zonaId: number | "";
    subzonaId: number | "";
    departamentoId: number | "";
  }>({ reinoId: "", zonaId: "", subzonaId: "", departamentoId: "" });
  const [zonasCat, setZonasCat] = useState<ZonaTrabajo[]>([]);
  const [metaSaving, setMetaSaving] = useState(false);

  // Dependencies
  const [todasMisiones, setTodasMisiones] = useState<Mision[]>([]);
  const [todasRecetas, setTodasRecetas] = useState<RecetaPrereq[]>([]);

  // Producto resultante
  const [catalogoMateriales, setCatalogoMateriales] = useState<Material[]>([]);
  const [prodSelId, setProdSelId] = useState("");
  const [prodSaving, setProdSaving] = useState(false);
  const [showNuevoProd, setShowNuevoProd] = useState(false);
  const [nuevoProdForm, setNuevoProdForm] = useState({ nombre: "", unidad: "kg" });
  const [nuevoProdSaving, setNuevoProdSaving] = useState(false);

  // Add-ticket inline form
  const [showAddEtapa, setShowAddEtapa] = useState(false);
  const [addForm, setAddForm] = useState({
    titulo: "", descripcion: "", asignado_a: "", pasos: [] as PasoDraft[], frecuencia: "",
    materiales: [] as MaterialDraft[],
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);

  // Drag-and-drop reorder
  const dragIdx = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Configurar pasos/materiales de un ticket inline desde la misión
  const [configurandoTicketId, setConfigurandoTicketId] = useState<number | null>(null);

  const nivel = user.rol?.nivel ?? 1;

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const m = await tapi(`/misiones/${misionId}`, token);
      if (silent) {
        setMision((prev) => {
          if (!prev) return m;
          const prevStr = JSON.stringify({ id: prev.id, etapas: prev.etapas?.map((e) => ({ id: e.id, estado: e.estado })) });
          const nextStr = JSON.stringify({ id: m.id, etapas: m.etapas?.map((e: EtapaMision) => ({ id: e.id, estado: e.estado })) });
          return prevStr === nextStr ? prev : m;
        });
      } else {
        setMision(m);
      }
      if (!silent) setError("");
    } catch (e: any) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token, misionId]);

  useEffect(() => { void reload(false); }, [reload]);
  useEffect(() => {
    tapi("/usuarios", token).then(setUsuarios).catch(() => {});
    tapi("/misiones/", token).then(setTodasMisiones).catch(() => {});
    tapi("/recetas", token).then(setTodasRecetas).catch(() => {});
    tapi("/materiales?todos=1", token).then(setCatalogoMateriales).catch(() => {});
    tapi("/zonas-trabajo", token).then(setZonasCat).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (mision) {
      setMetaForm({
        titulo: mision.titulo,
        descripcion: mision.descripcion || "",
        color: mision.color || "#0c6069",
        estado: mision.estado,
        modo_ciclo: (mision.modo_ciclo === "infinita" ? "infinita" : "finita") as ModoCicloMision,
      });
      setMetaUbicacion(ubicacionFromZonaId(zonasCat, mision.zona_id));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mision?.id, zonasCat.length]);

  const isLocked = false; // editing allowed for all states

  const metaZonaIdEfectivo =
    metaUbicacion.departamentoId !== "" ? metaUbicacion.departamentoId
    : metaUbicacion.subzonaId !== "" ? metaUbicacion.subzonaId
    : metaUbicacion.zonaId !== "" ? metaUbicacion.zonaId
    : metaUbicacion.reinoId;

  const padreDeptMeta = padreIdParaDepartamentos(
    zonasCat,
    metaUbicacion.zonaId,
    metaUbicacion.subzonaId,
  );
  const deptHijosMeta =
    padreDeptMeta !== "" ? departamentosDePadre(zonasCat, padreDeptMeta) : [];

  async function saveMeta() {
    if (!metaForm.titulo.trim()) {
      alert("Título de misión requerido");
      return;
    }
    if (metaZonaIdEfectivo === "" || metaUbicacion.zonaId === "") {
      alert("Selecciona reino y zona.");
      return;
    }
    if (
      typeof metaUbicacion.zonaId === "number"
      && subzonasDeZona(zonasCat, metaUbicacion.zonaId).length > 0
      && metaUbicacion.subzonaId === ""
    ) {
      alert("Esta zona tiene subzonas: selecciona una antes del departamento.");
      return;
    }
    if (deptHijosMeta.length > 0 && metaUbicacion.departamentoId === "") {
      alert("Selecciona el departamento (labor) de la misión.");
      return;
    }
    setMetaSaving(true);
    try {
      const updated = await tapi(`/misiones/${misionId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          ...metaForm,
          zona_id: metaZonaIdEfectivo,
        }),
      });
      setMision(updated);
      setEditingMeta(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setMetaSaving(false);
    }
  }

  async function submitAddEtapa() {
    setAddError("");
    if (!addForm.titulo.trim()) { setAddError("Título requerido"); return; }
    setAddSaving(true);
    try {
      const pasos = pasoDraftsToApi(addForm.pasos);
      const updated = await tapi(`/misiones/${misionId}/etapas`, token, {
        method: "POST",
        body: JSON.stringify({
          titulo: addForm.titulo,
          descripcion: addForm.descripcion,
          asignado_a: addForm.asignado_a || null,
          pasos,
          frecuencia: addForm.frecuencia || null,
          materiales: materialesDraftToApi(addForm.materiales),
        }),
      });
      setMision(updated);
      setAddForm({ titulo: "", descripcion: "", asignado_a: "", pasos: [], frecuencia: "", materiales: [] });
      setShowAddEtapa(false);
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setAddSaving(false);
    }
  }

  async function deleteEtapa(etapaId: number, titulo: string) {
    if (!confirm(`¿Eliminar el ticket "${titulo}" de esta misión?`)) return;
    try {
      const updated = await tapi(`/misiones/${misionId}/etapas/${etapaId}`, token, { method: "DELETE" });
      setMision(updated);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleDrop(toIdx: number) {
    const fromIdx = dragIdx.current;
    dragIdx.current = null;
    setDragOver(null);
    if (fromIdx === null || fromIdx === toIdx || !mision) return;
    const etapas = mision.etapas ?? [];
    const reordered = [...etapas];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // Optimistic update
    setMision((m) => m ? { ...m, etapas: reordered } : m);
    try {
      const updated = await tapi(`/misiones/${misionId}/etapas/orden`, token, {
        method: "PUT",
        body: JSON.stringify({ etapa_ids: reordered.map((e) => e.id) }),
      });
      setMision(updated);
    } catch (e: any) {
      reload(); // revert on error
      alert(e.message);
    }
  }

  const ETAPA_COLOR: Record<string, string> = {
    pendiente: "border-gray-300 bg-gray-50 text-gray-500",
    activa: "border-blue-400 bg-blue-50 text-blue-700",
    completada: "border-green-400 bg-green-50 text-green-700",
  };

  const TICKET_DOT: Record<string, string> = {
    pendiente: "bg-yellow-400",
    en_proceso: "bg-blue-500",
    esperando_aprobacion: "bg-orange-400",
    resuelto: "bg-green-500",
    rechazado: "bg-red-500",
  };

  useEffect(() => {
    const iv = setInterval(() => { reload(true).catch(() => {}); }, 30000);
    return () => clearInterval(iv);
  }, [reload]);

  if (loading && !mision) return <div className="py-16 text-center text-sm text-muted">Cargando misión...</div>;
  if (error || !mision) return (
    <div className="space-y-3">
      <button onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition">←</button>
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Misión no encontrada"}</div>
    </div>
  );

  const etapas = mision.etapas || [];
  const isSecuencial = mision.tipo === "secuencial";
  const misionInfinita = mision.modo_ciclo === "infinita";

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ←
        </button>
        {(mision.departamento_nombre || mision.ubicacion_label) && (
          <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
            🏢 {mision.departamento_nombre || mision.ubicacion_label}
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-semibold text-muted">
          {isSecuencial ? "🔗 Secuencial" : "⚡ Paralelo"}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
          misionInfinita
            ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300"
            : "bg-surface-hover text-muted border-border"
        }`}>
          {misionInfinita ? "♾️ Infinita" : "📌 Finita"}
        </span>
        {mision.estado === "completada" && !misionInfinita && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-800 border border-green-300 px-2.5 py-0.5 text-xs font-bold">
            ✅ Completada
          </span>
        )}
        {mision.estado === "cancelada" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 border border-red-300 px-2.5 py-0.5 text-xs font-bold">
            ❌ Cancelada
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {readonly ? (
            <span className="rounded-full bg-surface-hover border border-border px-2.5 py-0.5 text-[10px] font-bold text-muted">
              👁 Solo visualización
            </span>
          ) : (
            <>
              <button
                onClick={() => setEditingMeta((v) => !v)}
                className={`rounded-paper border-2 px-3 py-1.5 text-sm font-bold transition
                  ${editingMeta
                    ? "border-accent bg-accent text-white"
                    : "border-border text-muted hover:border-accent hover:text-accent"}`}>
                ✏️ Editar
              </button>
              {nivel >= 2 && (
                <button
                  disabled={renewing}
                  onClick={async () => {
                    if (!confirm(`¿Renovar todos los tickets resueltos de "${mision.titulo}"?\n\nCada ticket reiniciará su checklist (sin borrar números ni historial).`)) return;
                    setRenewing(true);
                    try {
                      const res = await tapi(`/misiones/${misionId}/renovar`, token, { method: "POST" });
                      setMision(res.mision);
                    } catch (e: any) {
                      alert(e.message);
                    } finally {
                      setRenewing(false);
                    }
                  }}
                  className="rounded-paper border-2 border-emerald-400 px-3 py-1.5 text-sm font-bold text-emerald-600 transition hover:bg-emerald-500 hover:border-emerald-500 hover:text-white disabled:opacity-50">
                  {renewing ? "Renovando..." : "♻️ Renovar tickets"}
                </button>
              )}
              {nivel >= 3 && (
                <button
                  onClick={async () => {
                    const ticketCount = (mision.etapas || []).filter((e) => e.ticket_id).length;
                    const msg = ticketCount > 0
                      ? `¿Eliminar la misión "${mision.titulo}" y sus ${ticketCount} ticket(s) asociados?\n\nEsta acción no se puede deshacer.`
                      : `¿Eliminar la misión "${mision.titulo}"?\n\nEsta acción no se puede deshacer.`;
                    if (!confirm(msg)) return;
                    try {
                      await tapi(`/misiones/${misionId}`, token, { method: "DELETE" });
                      onBack();
                    } catch (e: any) {
                      alert(e.message);
                    }
                  }}
                  className="rounded-paper border-2 border-red-300 px-3 py-1.5 text-sm font-bold text-red-500 transition hover:bg-red-500 hover:border-red-500 hover:text-white">
                  🗑️ Eliminar
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Edit metadata panel */}
      {!readonly && editingMeta && (
        <div className="rounded-paper border-2 border-accent bg-surface-panel p-5 shadow-paper space-y-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Editar misión</h3>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Título *</label>
            <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={metaForm.titulo} onChange={(e) => setMetaForm((f) => ({ ...f, titulo: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Tipo de misión *</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODO_CICLO_OPTS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer gap-2 rounded-paper border-2 px-3 py-2 transition ${
                    metaForm.modo_ciclo === opt.value
                      ? "border-accent bg-accent/10"
                      : "border-border bg-surface-input"
                  }`}
                >
                  <input
                    type="radio"
                    name="modo_ciclo_edit"
                    className="mt-0.5 shrink-0 accent-accent"
                    checked={metaForm.modo_ciclo === opt.value}
                    onChange={() => setMetaForm((f) => ({ ...f, modo_ciclo: opt.value }))}
                  />
                  <span className="min-w-0 text-xs">
                    <span className="block font-bold text-ink">{opt.label}</span>
                    <span className="text-muted">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Estado</label>
            <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={metaForm.estado} onChange={(e) => setMetaForm((f) => ({ ...f, estado: e.target.value }))}>
              <option value="activa">🟢 Activa</option>
              <option value="completada">✅ Completada</option>
              <option value="cancelada">❌ Cancelada</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Descripción</label>
            <textarea className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent resize-none"
              rows={2} value={metaForm.descripcion}
              onChange={(e) => setMetaForm((f) => ({ ...f, descripcion: e.target.value }))} />
          </div>
          {zonasCat.length > 0 ? (
            <MisionUbicacionPicker
              zonas={zonasCat}
              reinoId={metaUbicacion.reinoId}
              zonaId={metaUbicacion.zonaId}
              subzonaId={metaUbicacion.subzonaId}
              departamentoId={metaUbicacion.departamentoId}
              token={token}
              canManageZonas={(user.rol?.nivel ?? 1) >= 2}
              onZonaCreada={(nueva) => setZonasCat((prev) => [...prev, nueva])}
              onChange={(v) => {
                setMetaUbicacion({
                  reinoId: v.reinoId,
                  zonaId: v.zonaId,
                  subzonaId: v.subzonaId,
                  departamentoId: v.departamentoId,
                });
                if (v.color) setMetaForm((f) => ({ ...f, color: v.color! }));
              }}
            />
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Color</label>
            <div className="flex items-center gap-3">
              <input type="color" value={metaForm.color}
                onChange={(e) => setMetaForm((f) => ({ ...f, color: e.target.value }))}
                className="h-9 w-14 cursor-pointer rounded border-2 border-border p-0.5" />
              <span className="text-xs font-mono text-muted">{metaForm.color}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingMeta(false)}
              className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted hover:bg-surface-hover transition">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void saveMeta()}
              disabled={metaSaving || !metaForm.titulo.trim()}
              className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50"
            >
              {metaSaving ? "Guardando..." : "Guardar misión"}
            </button>
          </div>
        </div>
      )}

      {/* Cabecera: datos de la misión (sin barra de progreso — el % va por ticket) */}
      <div className="rounded-paper border-2 p-5 shadow-paper" style={{ borderColor: mision.color + "66", background: mision.color + "11" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold text-ink mb-1">{mision.titulo}</h2>
            <MisionUbicacionResumen mision={mision} zonas={zonasCat} />
            {mision.descripcion && <p className="mt-2 text-sm text-ink">{mision.descripcion}</p>}
            <p className="mt-2 text-xs font-semibold text-muted">
              {mision.total_etapas} ticket{mision.total_etapas !== 1 ? "s" : ""} · progreso en cada ticket abajo
            </p>
          </div>
          <div className="w-full shrink-0 lg:w-80">
            <div className="rounded-paper border-2 border-accent/40 bg-accent/5 px-4 py-3 shadow-paper-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                Tiempo total de la misión
              </p>
              <p className="font-mono text-3xl font-black tabular-nums text-accent">
                {fmtTiempo(mision.total_segundos_mision ?? 0)}
              </p>
              <p className="mt-1 text-[10px] text-muted">
                Suma de los cronómetros de cada ticket
              </p>
              {(mision.etapas?.length ?? 0) > 0 && (
                <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto border-t border-border/60 pt-2">
                  {(mision.etapas ?? []).map((et) =>
                    et.ticket_id ? (
                      <li key={et.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-ink">
                          {et.titulo}
                          {et.ticket_numero && (
                            <span className="ml-1 font-mono text-muted">{et.ticket_numero}</span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono font-bold text-accent">
                          {fmtTiempo(et.ticket_segundos ?? 0)}
                        </span>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {(todasMisiones.length > 0 || todasRecetas.length > 0) && (
        <PrerequisitosBlock
          titulo="🔗 Prerequisitos"
          readonly={readonly}
          items={(mision.dependencias ?? []).map((d) => ({
            tipo: (d.tipo ?? "mision") as PrerequisitoTipo,
            id: d.id,
          }))}
          dependenciasDisplay={mision.dependencias}
          misionId={misionId}
          token={token}
          todasMisiones={todasMisiones}
          todasRecetas={todasRecetas}
          onMisionUpdated={setMision}
        />
      )}

      {/* Producto resultante */}
      {(() => {
        const prod = mision.producto_resultante;
        const disponiblesProd = catalogoMateriales.filter((m) => m.id !== prod?.id);
        async function setProd(matId: number | null) {
          setProdSaving(true);
          try {
            const updated = await tapi(`/misiones/${misionId}/producto-resultante`, token, {
              method: "PUT",
              body: JSON.stringify({ material_id: matId }),
            });
            setMision(updated);
            setProdSelId("");
          } catch (e: any) { alert(e.message); }
          finally { setProdSaving(false); }
        }
        async function crearYVincular() {
          if (!nuevoProdForm.nombre.trim()) return;
          setNuevoProdSaving(true);
          try {
            const mat = await tapi("/materiales", token, {
              method: "POST",
              body: JSON.stringify({ ...nuevoProdForm, tipo: "elaborado", stock_actual: 0 }),
            });
            setCatalogoMateriales((prev) => [...prev, mat]);
            const updated = await tapi(`/misiones/${misionId}/producto-resultante`, token, {
              method: "PUT",
              body: JSON.stringify({ material_id: mat.id }),
            });
            setMision(updated);
            setShowNuevoProd(false);
            setNuevoProdForm({ nombre: "", unidad: "kg" });
          } catch (e: any) { alert(e.message); }
          finally { setNuevoProdSaving(false); }
        }
        return (
          <div className="rounded-paper border-2 border-purple-200 bg-purple-50/40 p-5 shadow-paper space-y-3 dark:border-purple-500/30 dark:bg-purple-950/30">
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-purple-700 dark:text-purple-300">✨ Producto resultante</h3>
              <p className="mt-0.5 text-xs text-purple-600 dark:text-purple-300/80">
                Al completar esta misión, el stock del producto vinculado aumenta automáticamente con la suma de todos los insumos usados.
              </p>
            </div>

            {prod ? (
              <div className="flex items-center gap-3 rounded-paper border border-purple-300 bg-white px-4 py-3 dark:border-purple-500/40 dark:bg-surface-input">
                <div className="flex-1">
                  <p className="font-bold text-sm text-ink">{prod.nombre}</p>
                  <p className="text-xs text-muted">Stock actual: <span className="font-bold text-purple-700">{prod.stock_actual} {prod.unidad}</span></p>
                </div>
                {!readonly && (
                  <button
                    disabled={prodSaving}
                    onClick={() => setProd(null)}
                    className="text-xs text-muted hover:text-danger transition px-2">
                    {prodSaving ? "..." : "✕ Desvincular"}
                  </button>
                )}
              </div>
            ) : readonly ? (
              <p className="text-xs text-muted italic">Sin producto resultante vinculado.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select
                    value={prodSelId}
                    onChange={(e) => setProdSelId(e.target.value)}
                    className="flex-1 rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm text-ink outline-none focus:border-purple-400 dark:focus:border-purple-400">
                    <option value="">Seleccionar producto del catálogo...</option>
                    {disponiblesProd.map((m) => (
                      <option key={m.id} value={m.id}>{m.nombre} ({m.unidad})</option>
                    ))}
                  </select>
                  <button
                    disabled={!prodSelId || prodSaving}
                    onClick={() => setProd(parseInt(prodSelId))}
                    className="rounded-paper border-2 border-purple-400 px-3 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-500 hover:border-purple-500 hover:text-white transition disabled:opacity-50">
                    {prodSaving ? "..." : "Vincular"}
                  </button>
                </div>
                <button
                  onClick={() => setShowNuevoProd((v) => !v)}
                  className="text-xs font-bold text-purple-600 hover:underline">
                  {showNuevoProd ? "▲ Cancelar" : "+ Crear nuevo producto elaborado"}
                </button>
                {showNuevoProd && (
                  <div className="rounded-paper border border-purple-200 bg-surface-input p-3 space-y-2 dark:border-purple-500/30">
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded border-2 border-border px-2 py-1.5 text-sm outline-none focus:border-purple-400"
                        placeholder="Nombre del producto (ej: Masa Madre)"
                        value={nuevoProdForm.nombre}
                        onChange={(e) => setNuevoProdForm((f) => ({ ...f, nombre: e.target.value }))} />
                      <select
                        className="rounded border-2 border-border px-2 py-1.5 text-sm outline-none focus:border-purple-400"
                        value={nuevoProdForm.unidad}
                        onChange={(e) => setNuevoProdForm((f) => ({ ...f, unidad: e.target.value }))}>
                        {["kg","g","mg","L","mL","unidad","m","cm","porción"].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      disabled={nuevoProdSaving || !nuevoProdForm.nombre.trim()}
                      onClick={crearYVincular}
                      className="rounded border-2 border-purple-400 bg-purple-500 px-4 py-1.5 text-xs font-bold text-white hover:bg-purple-600 transition disabled:opacity-50">
                      {nuevoProdSaving ? "Creando..." : "✨ Crear y vincular"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Pipeline de tickets */}
      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">
            {isSecuencial ? "🔗 Pipeline Secuencial" : "⚡ Tickets Asíncronos"}
          </h3>
          <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-semibold text-muted">
            {isSecuencial ? "Se desbloquean en orden" : "Todos activos en paralelo"}
          </span>
        </div>

        {isSecuencial ? (
          <div className="space-y-1">
            {etapas.map((et, i) => {
              const etapaLocked = et.estado === "pendiente" && !!et.ticket_bloqueado_por;
              const isDone      = et.estado === "completada";
              const isOver      = dragOver === i;
              return (
                <div key={et.id}
                  draggable={!isLocked && !readonly}
                  onDragStart={!readonly ? () => { dragIdx.current = i; } : undefined}
                  onDragOver={!readonly ? (e) => { e.preventDefault(); setDragOver(i); } : undefined}
                  onDragLeave={!readonly ? () => setDragOver(null) : undefined}
                  onDrop={!readonly ? () => handleDrop(i) : undefined}
                  onDragEnd={!readonly ? () => { dragIdx.current = null; setDragOver(null); } : undefined}
                  className={isOver ? "opacity-50" : ""}
                >
                  <div className={`flex items-center gap-3 rounded-paper border-2 p-3 transition ${ETAPA_COLOR[et.estado]} ${isOver ? "border-accent border-dashed" : ""}`}>
                    {!isLocked && !readonly && (
                      <span className="shrink-0 cursor-grab text-muted opacity-40 hover:opacity-80 select-none text-lg leading-none" title="Arrastrar para reordenar">⠿</span>
                    )}
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black shadow-sm ${isDone ? "text-white" : "bg-white"}`}
                      style={isDone
                        ? { background: mision.color }
                        : { color: mision.color, border: `2px solid ${mision.color}33` }}>
                      {isDone ? "✓" : etapaLocked ? "🔒" : et.orden}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold text-sm ${etapaLocked ? "opacity-50" : ""}`}>{et.titulo}</p>
                      {et.asignado_nombre && (
                        <p className="text-xs opacity-75 flex items-center gap-1"><span>👤</span>{et.asignado_nombre}</p>
                      )}
                      {et.ticket_frecuencia && (
                        <p className="text-[10px] font-semibold text-emerald-700">
                          {FRECUENCIA_LABEL[et.ticket_frecuencia] ?? et.ticket_frecuencia}
                          {et.ticket_proxima_renovacion && et.ticket_estado === "resuelto" && (
                            <span className="text-muted"> · {fmtFecha(et.ticket_proxima_renovacion)}</span>
                          )}
                        </p>
                      )}
                      {etapaLocked && <p className="text-xs opacity-60">Esperando ticket anterior</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {et.ticket_id && (
                        <span
                          className="text-xs font-black tabular-nums"
                          style={{ color: etapaEjecucionPct(et) === 100 ? "#16a34a" : mision.color }}
                          title="Ejecución del ticket (pasos del checklist)"
                        >
                          {etapaEjecucionPct(et)}%
                        </span>
                      )}
                      {et.ticket_id && et.ticket_numero && (
                        <div className="flex items-center gap-1.5">
                          {et.ticket_estado && (
                            <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-white ${TICKET_DOT[et.ticket_estado] || "bg-gray-400"}`} />
                          )}
                          <button onClick={() => et.ticket_id && onTicket(et.ticket_id)}
                            className="text-xs font-mono font-bold underline underline-offset-2 hover:opacity-70 transition"
                            title="Abrir ejecución (cronómetro + pasos)">
                            {et.ticket_numero}
                          </button>
                        </div>
                      )}
                      {et.ticket_id && !readonly && (
                        <button
                          onClick={() => setConfigurandoTicketId(configurandoTicketId === et.ticket_id ? null : et.ticket_id!)}
                          title="Configurar pasos y materiales de este ticket"
                          className={`rounded border px-1.5 py-0.5 text-xs font-bold transition
                            ${configurandoTicketId === et.ticket_id
                              ? "border-accent bg-accent text-white"
                              : "border-border text-muted hover:border-accent hover:text-accent"}`}>
                          ⚙️
                        </button>
                      )}
                      {!isLocked && !isDone && !readonly && (
                        <button onClick={() => deleteEtapa(et.id, et.titulo)}
                          className="text-xs text-red-400 hover:text-red-600 transition px-1">✕</button>
                      )}
                    </div>
                  </div>
                  {/* Panel de configuración inline — solo en modo edición */}
                  {!readonly && configurandoTicketId === et.ticket_id && et.ticket_id && (
                    <div className="mt-2 rounded-paper border border-accent/30 bg-surface p-4 space-y-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-accent">
                        ⚙️ Configurar: {et.titulo}
                      </p>
                      <TicketCronometroById ticketId={et.ticket_id} token={token} />
                      <TicketRecurrenciaById
                        ticketId={et.ticket_id}
                        token={token}
                        canEdit={nivel >= 2}
                        onRefresh={reload}
                      />
                      <PasosSection
                        ticketId={et.ticket_id}
                        token={token}
                        editMode={true}
                        onGuardarExtra={reload}
                      />
                      <TicketBarraGuardadoById
                        ticketId={et.ticket_id}
                        token={token}
                        compact
                        onRefresh={reload}
                      />
                      <MaterialesSection ticketId={et.ticket_id} token={token} user={user} readonly={false} zonaSugerida={mision.reino} />
                    </div>
                  )}
                  {i < etapas.length - 1 && (
                    <div className="flex justify-center">
                      <div className="my-0.5 h-5 w-0.5 rounded-full" style={{ background: mision.color + "55" }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {etapas.map((et, i) => {
              const isDone = et.estado === "completada";
              const isOver = dragOver === i;
              return (
                <div key={et.id}
                  draggable={!isLocked && !readonly}
                  onDragStart={!readonly ? () => { dragIdx.current = i; } : undefined}
                  onDragOver={!readonly ? (e) => { e.preventDefault(); setDragOver(i); } : undefined}
                  onDragLeave={!readonly ? () => setDragOver(null) : undefined}
                  onDrop={!readonly ? () => handleDrop(i) : undefined}
                  onDragEnd={!readonly ? () => { dragIdx.current = null; setDragOver(null); } : undefined}
                  className={`rounded-paper border-2 p-3 transition ${ETAPA_COLOR[et.estado]} ${isOver ? "opacity-50 border-accent border-dashed" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      {!isLocked && !readonly && (
                        <span className="cursor-grab text-muted opacity-40 hover:opacity-80 select-none text-lg leading-none" title="Arrastrar para reordenar">⠿</span>
                      )}
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black shadow-sm ${isDone ? "text-white" : "bg-white"}`}
                        style={isDone
                          ? { background: mision.color }
                          : { color: mision.color, border: `2px solid ${mision.color}33` }}>
                        {isDone ? "✓" : et.orden}
                      </span>
                      <span className="text-xs font-semibold text-muted">⚡ Activo</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {et.ticket_id && (
                        <span
                          className="text-xs font-black tabular-nums"
                          style={{ color: etapaEjecucionPct(et) === 100 ? "#16a34a" : mision.color }}
                        >
                          {etapaEjecucionPct(et)}%
                        </span>
                      )}
                      {et.ticket_id && et.ticket_numero && (
                        <div className="flex items-center gap-1.5">
                          {et.ticket_estado && (
                            <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-white ${TICKET_DOT[et.ticket_estado] || "bg-gray-400"}`} />
                          )}
                          <button onClick={() => et.ticket_id && onTicket(et.ticket_id)}
                            className="text-xs font-mono font-bold underline underline-offset-2 hover:opacity-70 transition"
                            title="Abrir ejecución (cronómetro + pasos)">
                            {et.ticket_numero}
                          </button>
                        </div>
                      )}
                      {et.ticket_id && !readonly && (
                        <button
                          onClick={() => setConfigurandoTicketId(configurandoTicketId === et.ticket_id ? null : et.ticket_id!)}
                          title="Configurar pasos y materiales"
                          className={`rounded border px-1.5 py-0.5 text-xs font-bold transition
                            ${configurandoTicketId === et.ticket_id
                              ? "border-accent bg-accent text-white"
                              : "border-border text-muted hover:border-accent hover:text-accent"}`}>
                          ⚙️
                        </button>
                      )}
                      {!isLocked && !isDone && !readonly && (
                        <button onClick={() => deleteEtapa(et.id, et.titulo)}
                          className="text-xs text-red-400 hover:text-red-600 transition px-1">✕</button>
                      )}
                    </div>
                  </div>
                  <p className="font-semibold text-sm">{et.titulo}</p>
                  {et.descripcion && <p className="text-xs opacity-75 mt-0.5">{et.descripcion}</p>}
                  {et.ticket_frecuencia && (
                    <p className="text-[10px] font-semibold text-emerald-700 mt-0.5">
                      {FRECUENCIA_LABEL[et.ticket_frecuencia] ?? et.ticket_frecuencia}
                    </p>
                  )}
                  {et.asignado_nombre && <p className="text-xs opacity-75 mt-1 flex items-center gap-1"><span>👤</span>{et.asignado_nombre}</p>}
                  {/* Panel de configuración inline — solo en modo edición */}
                  {!readonly && configurandoTicketId === et.ticket_id && et.ticket_id && (
                    <div className="mt-3 pt-3 border-t border-border space-y-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-accent">⚙️ Configurar</p>
                      <TicketCronometroById ticketId={et.ticket_id} token={token} />
                      <TicketRecurrenciaById
                        ticketId={et.ticket_id}
                        token={token}
                        canEdit={nivel >= 2}
                        onRefresh={reload}
                      />
                      <PasosSection
                        ticketId={et.ticket_id}
                        token={token}
                        editMode={true}
                        onGuardarExtra={reload}
                      />
                      <TicketBarraGuardadoById
                        ticketId={et.ticket_id}
                        token={token}
                        compact
                        onRefresh={reload}
                      />
                      <MaterialesSection ticketId={et.ticket_id} token={token} user={user} readonly={false} zonaSugerida={mision.reino} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add ticket inline form — solo en modo edición */}
        {!isLocked && !readonly && (
          <div className="mt-4">
            {misionInfinita && (
              <p className="mb-2 text-xs text-emerald-700 dark:text-emerald-400">
                Misión infinita: agrega tickets o usa ♻️ Renovar tickets al cerrar cada ciclo.
              </p>
            )}
            {showAddEtapa ? (
              <div className="rounded-paper border-2 border-accent bg-surface p-4 space-y-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Nuevo ticket</p>
                <input
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="Título del ticket *"
                  value={addForm.titulo}
                  onChange={(e) => setAddForm((f) => ({ ...f, titulo: e.target.value }))}
                  autoFocus
                />
                <input
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="Descripción (opcional)"
                  value={addForm.descripcion}
                  onChange={(e) => setAddForm((f) => ({ ...f, descripcion: e.target.value }))}
                />
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  <select
                    className="flex-1 rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                    value={addForm.asignado_a}
                    onChange={(e) => setAddForm((f) => ({ ...f, asignado_a: e.target.value }))}>
                    <option value="">Sin asignar</option>
                    {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <PasosDraftEditor
                  pasos={addForm.pasos}
                  onChange={(pasos) => setAddForm((f) => ({ ...f, pasos }))}
                />
                <MaterialesDraftEditor
                  materiales={addForm.materiales}
                  onChange={(materiales) => setAddForm((f) => ({ ...f, materiales }))}
                  catalogo={catalogoMateriales}
                  zonaSugerida={mision.reino_nombre || mision.reino || null}
                />
                {misionInfinita && (
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
                      Cada cuánto se repite este ticket (opcional)
                    </label>
                    <SelectFrecuencia
                      value={addForm.frecuencia}
                      onChange={(v) => setAddForm((f) => ({ ...f, frecuencia: v }))}
                    />
                  </div>
                )}
                {addError && <p className="text-xs text-red-600">{addError}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setShowAddEtapa(false); setAddError(""); }}
                    className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface-hover transition">
                    Cancelar
                  </button>
                  <button onClick={submitAddEtapa} disabled={addSaving}
                    className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
                    {addSaving ? "Agregando..." : "Agregar ticket"}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddEtapa(true)}
                className="flex w-full items-center justify-center gap-2 rounded-paper border-2 border-dashed border-border py-2.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
                + Agregar ticket a esta misión
              </button>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// Workload dashboard
function WorkloadView({ token, user, onBack }: { token: string; user: TicketsUser; onBack: () => void }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNuevo, setShowNuevo] = useState(false);
  const [roles, setRoles] = useState<{ id: number; nombre: string; nivel: number }[]>([]);
  const [depts, setDepts] = useState<{ id: number; nombre: string; color?: string }[]>([]);
  const [form, setForm] = useState({
    nombre: "",
    username: "",
    email: "",
    rol_id: "" as string | number,
    departamentos_ids: [] as number[],
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const nivel = user.rol?.nivel ?? 1;
  const canManageAliados = nivel >= 2;

  const reload = useCallback(() => {
    setLoading(true);
    return tapi("/dashboard/carga", token)
      .then((d) => setData(Array.isArray(d) ? d : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!showNuevo || !canManageAliados) return;
    Promise.all([tapi("/roles", token), tapi("/departamentos", token)])
      .then(([rs, ds]) => {
        setRoles(Array.isArray(rs) ? rs : []);
        setDepts(Array.isArray(ds) ? ds : []);
      })
      .catch(() => {});
  }, [showNuevo, canManageAliados, token]);

  async function eliminarAliado(u: { id: number; nombre: string; tickets_abiertos?: number }) {
    if (u.id === user.id) {
      alert("No puedes eliminar tu propia cuenta.");
      return;
    }
    const aviso =
      u.tickets_abiertos && u.tickets_abiertos > 0
        ? `\n\nTiene ${u.tickets_abiertos} ticket(s) abiertos asignados; quedarán en el historial.`
        : "";
    if (!window.confirm(`¿Eliminar aliado "${u.nombre}" del equipo?${aviso}\n\nSe desactiva el acceso (no borra historial).`)) {
      return;
    }
    setDeletingId(u.id);
    try {
      await tapi(`/usuarios/${u.id}`, token, { method: "DELETE" });
      await reload();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "No se pudo eliminar el aliado.");
    } finally {
      setDeletingId(null);
    }
  }

  function abrirNuevo() {
    setForm({ nombre: "", username: "", email: "", rol_id: "", departamentos_ids: [] });
    setFormError("");
    setShowNuevo(true);
  }

  async function guardarAliado() {
    if (!form.nombre.trim() || !form.username.trim() || !form.rol_id) {
      setFormError("Completa nombre completo, alias y rol.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await tapi("/usuarios", token, {
        method: "POST",
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          username: form.username.trim(),
          email: form.email.trim() || null,
          rol_id: Number(form.rol_id),
          departamentos_ids: form.departamentos_ids,
        }),
      });
      setShowNuevo(false);
      await reload();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "No se pudo crear el aliado.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">←</button>
          <div>
            <h2 className="text-xl font-extrabold text-ink">Aliados</h2>
            <p className="text-xs text-muted">Carga de trabajo por persona del equipo</p>
          </div>
        </div>
        {canManageAliados && (
          <button
            type="button"
            onClick={abrirNuevo}
            className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none"
          >
            + Agregar aliado
          </button>
        )}
      </div>

      {showNuevo && canManageAliados && (
        <div className="rounded-paper border-2 border-accent/50 bg-surface-panel p-5 shadow-paper-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Nuevo aliado</h3>
            <button
              type="button"
              onClick={() => setShowNuevo(false)}
              className="text-xs font-bold text-muted hover:text-ink"
            >
              Cerrar
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre completo *" value={form.nombre} onChange={(v) => setForm((f) => ({ ...f, nombre: v }))} />
            <div>
              <Field label="Alias del bot *" value={form.username} onChange={(v) => setForm((f) => ({ ...f, username: v }))} />
              <p className="mt-0.5 text-[10px] text-muted">Nombre corto para @menciones</p>
            </div>
            <Field label="Correo Google" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Rol *</label>
              <select
                value={form.rol_id}
                onChange={(e) => setForm((f) => ({ ...f, rol_id: e.target.value }))}
                className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">Seleccionar…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.nombre}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-bold text-muted">Departamentos</label>
              <div className="rounded-paper border border-border p-2 max-h-32 overflow-y-auto grid grid-cols-2 gap-1">
                {depts.length === 0 && <p className="col-span-2 text-xs text-muted px-1">Sin departamentos</p>}
                {depts.map((d) => {
                  const selected = form.departamentos_ids.includes(d.id);
                  return (
                    <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover">
                      <input type="checkbox" checked={selected}
                        onChange={() => setForm((f) => ({
                          ...f,
                          departamentos_ids: selected
                            ? f.departamentos_ids.filter((x: number) => x !== d.id)
                            : [...f.departamentos_ids, d.id],
                        }))}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                      {d.nombre}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          {formError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNuevo(false)}
              className="rounded-paper border-2 border-border px-4 py-2 text-xs font-bold text-muted hover:bg-surface-hover"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void guardarAliado()}
              disabled={saving}
              className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Crear aliado"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Cargando...</div>
      ) : data.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted space-y-3">
          <p>No hay aliados registrados aún.</p>
          {canManageAliados && (
            <button
              type="button"
              onClick={abrirNuevo}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white"
            >
              + Agregar el primero
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((u: any) => (
            <div key={u.id} className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink">{u.nombre}</span>
                    {u.rol && <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-bold text-muted">{u.rol.nombre}</span>}
                    {u.departamento && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ background: u.departamento.color + "22", color: u.departamento.color }}>
                        {u.departamento.nombre}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-4 text-center">
                    <div>
                      <div className="text-xl font-black text-ink">{u.tickets_abiertos}</div>
                      <div className="text-xs font-semibold text-muted">Abiertos</div>
                    </div>
                    <div>
                      <div className="text-xl font-black text-green-700">{u.resueltos_semana}</div>
                      <div className="text-xs font-semibold text-muted">Resueltos / sem.</div>
                    </div>
                    <div>
                      <div className="text-xl font-black text-accent">{fmtHoras(u.total_horas)}</div>
                      <div className="text-xs font-semibold text-muted">Tiempo total</div>
                    </div>
                  </div>
                  {canManageAliados && u.id !== user.id && (
                    <button
                      type="button"
                      onClick={() => void eliminarAliado(u)}
                      disabled={deletingId === u.id}
                      title="Eliminar aliado (desactivar acceso)"
                      className="rounded-paper border-2 border-red-400/80 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-600 hover:text-white disabled:opacity-40 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-600"
                    >
                      {deletingId === u.id ? "Eliminando…" : "🗑 Eliminar"}
                    </button>
                  )}
                </div>
              </div>
              {/* Load bar */}
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-muted">
                  <span>Carga actual</span>
                  <span>{u.tickets_abiertos} tickets abiertos</span>
                </div>
                <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (u.tickets_abiertos / 10) * 100)}%`,
                      background: u.tickets_abiertos >= 8 ? "#c86a6a"
                        : u.tickets_abiertos >= 5 ? "#e8a838" : "#0c6069",
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Perfil ────────────────────────────────────────────────────────────────────

function PerfilView({
  token,
  user,
  onBack,
  onUserUpdated,
}: {
  token: string;
  user: TicketsUser;
  onBack: () => void;
  onUserUpdated: (u: TicketsUser) => void;
}) {
  const [nombre, setNombre] = useState(user.nombre);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setMsg(null);
    if (!nombre.trim()) {
      setMsg({ type: "err", text: "El nombre no puede estar vacío." });
      return;
    }
    if (password && password !== password2) {
      setMsg({ type: "err", text: "Las contraseñas no coinciden." });
      return;
    }
    if (password && password.length < 6) {
      setMsg({ type: "err", text: "La contraseña debe tener al menos 6 caracteres." });
      return;
    }
    setSaving(true);
    try {
      const body: { nombre: string; password?: string } = { nombre: nombre.trim() };
      if (password) body.password = password;
      const res = await tapi("/auth/me", token, { method: "PUT", body: JSON.stringify(body) });
      if (res.usuario) onUserUpdated(res.usuario as TicketsUser);
      setPassword("");
      setPassword2("");
      setMsg({ type: "ok", text: "Perfil actualizado." });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Error al guardar" });
    } finally {
      setSaving(false);
    }
  }

  async function subirFoto(file: File) {
    setMsg(null);
    if (!file.type.startsWith("image/")) {
      setMsg({ type: "err", text: "Selecciona una imagen (JPG, PNG, GIF o WEBP)." });
      return;
    }
    setUploadingFoto(true);
    try {
      const fd = new FormData();
      fd.append("foto", file);
      const res = await tapi("/auth/me/foto", token, { method: "POST", body: fd });
      if (res.usuario) onUserUpdated(res.usuario as TicketsUser);
      setMsg({ type: "ok", text: "Foto de perfil actualizada." });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Error al subir la foto" });
    } finally {
      setUploadingFoto(false);
      if (fotoInputRef.current) fotoInputRef.current.value = "";
    }
  }

  async function quitarFoto() {
    setMsg(null);
    setUploadingFoto(true);
    try {
      const res = await tapi("/auth/me/foto", token, { method: "DELETE" });
      if (res.usuario) onUserUpdated(res.usuario as TicketsUser);
      setMsg({ type: "ok", text: "Foto de perfil eliminada." });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Error al quitar la foto" });
    } finally {
      setUploadingFoto(false);
    }
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ←
        </button>
        <h2 className="text-xl font-extrabold text-ink">👤 Mi perfil</h2>
      </div>

      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper-sm space-y-3">
        <div className="flex items-center gap-4">
          <UserAvatar user={user} token={token} size="lg" />
          <div>
            <p className="font-extrabold text-ink">{user.nombre}</p>
            <p className="text-sm text-muted">@{user.username}</p>
            {user.email && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                <svg width="12" height="12" viewBox="0 0 48 48" fill="none" className="shrink-0">
                  <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.5-.4-3.5z" fill="#FFC107"/>
                  <path d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00"/>
                  <path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.1C9.5 35.6 16.2 44 24 44z" fill="#4CAF50"/>
                  <path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.4 44 33 44 24c0-1.2-.1-2.5-.4-3.5z" fill="#1976D2"/>
                </svg>
                {user.email}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-2">
              {user.rol && (
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold text-muted">
                  {user.rol.nombre} · Nivel {user.rol.nivel}
                </span>
              )}
              {user.departamento && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    background: `${user.departamento.color}22`,
                    color: user.departamento.color,
                  }}
                >
                  {user.departamento.nombre}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Foto de perfil</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fotoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subirFoto(f);
              }}
            />
            <button
              type="button"
              disabled={uploadingFoto}
              onClick={() => fotoInputRef.current?.click()}
              className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-ink transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {uploadingFoto ? "Subiendo..." : user.foto ? "Cambiar foto" : "Adjuntar foto"}
            </button>
            {user.foto && (
              <button
                type="button"
                disabled={uploadingFoto}
                onClick={() => void quitarFoto()}
                className="rounded-paper border-2 border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                Quitar foto
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted">JPG, PNG, GIF o WEBP. Se muestra en tu perfil.</p>
        </div>
      </div>

      <form onSubmit={guardar} className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper-sm space-y-4">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Editar datos</h3>
        <div>
          <label className="mb-1 block text-xs font-bold text-muted">Nombre para mostrar</label>
          <input
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-muted">Usuario (no editable)</label>
          <input
            disabled
            className="w-full rounded-paper border-2 border-border bg-surface-hover px-3 py-2 text-sm text-muted"
            value={user.username}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-muted">Nueva contraseña (opcional)</label>
          <input
            type="password"
            autoComplete="new-password"
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Dejar vacío para no cambiar"
          />
        </div>
        {password && (
          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Confirmar contraseña</label>
            <input
              type="password"
              autoComplete="new-password"
              className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </div>
        )}
        {msg && (
          <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${msg.type === "ok" ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"}`}>
            {msg.text}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </form>
    </div>
  );
}

// ── Acciones View ─────────────────────────────────────────────────────────────

const PRIORIDAD_COLOR: Record<string, string> = {
  urgente: "bg-red-500 text-white",
  alta: "bg-orange-400 text-white",
  media: "bg-yellow-400 text-gray-900",
  baja: "bg-gray-300 text-gray-700",
};

/**
 * AudioContext desbloqueado por gesto del usuario.
 * En Android Chrome, el AudioContext debe crearse/resumirse durante un toque
 * para que pueda reproducir audio posterior sin gesto (como las alarmas a los 5 min).
 */
let _unlockedCtx: AudioContext | null = null;

function unlockAudioContext() {
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

/** Reproduce un recordatorio de voz corto. Primero intenta el TTS del servidor;
 *  si no responde en 1.5 s, usa SpeechSynthesis del navegador (funciona offline/Android).
 *  El AudioContext debe estar desbloqueado previamente por gesto del usuario. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

// Parsea timestamps UTC de SQLite: formato "YYYY-MM-DD HH:MM:SS" (espacio, sin Z).
// Pasos: reemplazar espacio→T para ISO 8601, agregar Z si no hay zona horaria, NaN→now.
function parseUtcTs(s: string): number {
  if (!s) return Date.now();
  const iso = s.replace(" ", "T");                              // "2026-05-25T21:45:00"
  const withTz = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z"; // agregar Z si falta
  const ts = new Date(withTz).getTime();
  if (isNaN(ts)) return Date.now();
  return ts > Date.now() ? Date.now() : ts;                    // nunca futuro
}

// ── Caché de audio de alarma ──────────────────────────────────────────────────
// El audio TTS se genera una sola vez y se reutiliza en todas las alarmas del día.
// Evita latencia de ~5 s de Voicebox en cada disparo.
let _alarmCache: { buffer: ArrayBuffer; type: string } | null = null;
let _alarmCacheExpiry = 0;

async function _playBlobBuffer(buffer: ArrayBuffer, type: string): Promise<void> {
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
async function warmAlarmCache(apiToken: string): Promise<boolean> {
  if (_alarmCache && Date.now() < _alarmCacheExpiry) return true;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch("/api/voz/sintetizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ texto: "Recuerda: tienes una tarea en proceso.", motor: "voicebox", voicebox_engine: "qwen3" }),
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

async function playAlarmAudio(apiToken?: string) {
  // Intento 1: audio cacheado (generado previamente, sin latencia)
  if (_alarmCache && Date.now() < _alarmCacheExpiry) {
    try { await _playBlobBuffer(_alarmCache.buffer, _alarmCache.type); return; } catch {}
  }

  // Intento 2: generar TTS y cachear (primera vez o caché expirada)
  if (apiToken) {
    try {
      if (await warmAlarmCache(apiToken) && _alarmCache) {
        await _playBlobBuffer(_alarmCache.buffer, _alarmCache.type);
        return;
      }
    } catch {}
  }

  // Intento 3: SpeechSynthesis del navegador (sin servidor, Android Chrome lo soporta)
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance("Recuerda: tienes una tarea en proceso.");
    utt.lang = "es-CO"; utt.rate = 0.92; utt.volume = 1;
    window.speechSynthesis.speak(utt);
    return;
  }

  // Fallback: chime Web Audio API
  try {
    const ctx = _unlockedCtx ?? new AudioContext();
    const now = ctx.currentTime;
    [[0, 880], [0.32, 1100], [0.64, 660]].forEach(([delay, freq]) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.3, now + delay + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.4);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + delay); osc.stop(now + delay + 0.42);
    });
    setTimeout(() => ctx.close().catch(() => {}), 2500);
  } catch { /* AudioContext no disponible */ }
}

// Persists timer start time across React remounts (ticket moves between column groups).
const _timerStore = new Map<number, number>();

function AccionCard({
  ticket, token, onSelect, onChanged, isAdmin,
}: {
  ticket: Ticket; token: string;
  onSelect: (id: number) => void;
  onChanged: () => void;
  isAdmin?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [corridaId, setCorridaId] = useState<number | null>(ticket.corrida?.id ?? null);
  const [corridaActiva, setCorridaActiva] = useState(ticket.corrida?.estado === "activa");

  // segBase = solo segundos acumulados de segmentos anteriores (sin incluir la corrida activa)
  const [segBase, setSegBase] = useState<number>(
    ticket.corrida?.segundos_acumulados ?? ticket.segundos_trabajo ?? 0
  );
  const [segLive, setSegLive] = useState(0);

  // inicioRef: marca de tiempo (ms) desde cuando corre el tramo actual.
  // null = detenido. No-null = corriendo. El intervalo solo mira este ref.
  // Inicializado desde el servidor si la corrida ya estaba activa al montar.
  const inicioRef = useRef<number | null>(
    _timerStore.get(ticket.id) ??
    (ticket.corrida?.estado === "activa" && ticket.corrida?.iniciada_en
      ? parseUtcTs(ticket.corrida.iniciada_en)
      : null)
  );
  const [resolucionInfo, setResolucionInfo] = useState<{ duracion: number; horario: string } | null>(null);

  // Limpiar segLive cuando corridaActiva cambia a false (para display)
  useEffect(() => {
    if (!corridaActiva) setSegLive(0);
  }, [corridaActiva]);

  // Intervalo PERMANENTE montado UNA SOLA VEZ.
  // Solo comprueba inicioRef.current — asignado SINCRÓNICAMENTE en iniciarPausar
  // antes de cualquier await, así nunca hay race condition con React batching.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const iv = setInterval(() => {
      if (inicioRef.current == null) return;
      const s = Math.floor((Date.now() - inicioRef.current) / 1000);
      setSegLive((p) => (p === s ? p : s));
    }, 250);
    return () => clearInterval(iv);
  }, []);

  const segDisplay = segBase + segLive;

  async function iniciarPausar() {
    if (busy) return;
    setBusy(true);
    try {
      const nuevoEstado = ticket.estado === "en_proceso" ? "pendiente" : "en_proceso";
      if (nuevoEstado === "en_proceso") {
        // ── ARRANCAR TIMER INMEDIATAMENTE (antes del round-trip al servidor) ──
        // El intervalo permanente ya está corriendo; solo necesita inicioRef != null.
        const t0 = Date.now();
        inicioRef.current = t0;
        _timerStore.set(ticket.id, t0);
        setCorridaActiva(true);
        setSegLive(0);

        // Registrar la corrida en servidor (sin bloquear la UI)
        try {
          const data: Ticket = await tapi(`/${ticket.id}/corridas/iniciar`, token, {
            method: "POST", body: JSON.stringify({ segundos_previos: segBase }),
          });
          if (data.corrida) {
            setCorridaId(data.corrida.id);
            setSegBase(data.corrida.segundos_acumulados ?? 0);
            // Si el servidor reporta un inicio anterior al click local, sincronizar
            if (data.corrida.iniciada_en) {
              const srvTs = parseUtcTs(data.corrida.iniciada_en);
              if (srvTs < t0 && t0 - srvTs < 30_000) { inicioRef.current = srvTs; _timerStore.set(ticket.id, srvTs); }
            }
          }
        } catch { /* timer ya corriendo desde t0 */ }

        try {
          await tapi(`/${ticket.id}/estado`, token, {
            method: "PUT", body: JSON.stringify({ estado: "en_proceso" }),
          });
        } catch {}
      } else {
        // ── PAUSAR: capturar segLive ANTES de resetear ──
        const segTotal = segBase + segLive;
        setCorridaActiva(false);   // corridaActivaRef se sincroniza en useEffect
        inicioRef.current = null;  // detiene el intervalo permanente
        _timerStore.delete(ticket.id);

        if (corridaId) {
          try {
            const data: Ticket = await tapi(`/corridas/${corridaId}/pausar`, token, { method: "POST" });
            setSegBase(data.corrida?.segundos_acumulados ?? segTotal);
          } catch { setSegBase(segTotal); }
        } else {
          setSegBase(segTotal);
        }

        try {
          await tapi(`/${ticket.id}/estado`, token, {
            method: "PUT", body: JSON.stringify({ estado: "pendiente" }),
          });
        } catch {}
      }
      onChanged();
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  async function resolver() {
    if (busy) return;
    setBusy(true);
    try {
      if (corridaId) {
        try { await tapi(`/corridas/${corridaId}/finalizar`, token, { method: "POST" }); } catch {}
      }
      await tapi(`/${ticket.id}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: "resuelto" }) });
      const duracion = segDisplay;
      const horario = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
      setResolucionInfo({ duracion, horario });
      setCorridaActiva(false);
      inicioRef.current = null;
      _timerStore.delete(ticket.id);
      setSegLive(0);
      setTimeout(() => onChanged(), 2200);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  async function eliminar() {
    if (busy) return;
    setBusy(true);
    try {
      await tapi(`/${ticket.id}`, token, { method: "DELETE" });
      onChanged();
    } catch { /* ignore */ }
    finally { setBusy(false); setConfirmDelete(false); }
  }

  const resuelta = ticket.estado === "resuelto" || ticket.estado === "rechazado";
  const enProceso = ticket.estado === "en_proceso";

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm transition-opacity ${resuelta ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-ink">
          {ticket.titulo}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORIDAD_COLOR[ticket.prioridad ?? "media"] ?? "bg-gray-200 text-gray-700"}`}>
          {ticket.prioridad ?? "media"}
        </span>
        {isAdmin && !confirmDelete && (
          <button
            type="button"
            title="Eliminar acción"
            onClick={() => setConfirmDelete(true)}
            className="shrink-0 rounded p-0.5 text-muted hover:text-red-600 transition-colors"
          >
            <Icon name="trash" size={13} />
          </button>
        )}
        {isAdmin && confirmDelete && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={eliminar}
              className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-red-700"
            >
              Sí
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-bold text-muted hover:text-ink"
            >
              No
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted">
        <Icon name="user" size={12} />
        <span>{ticket.asignado_a_nombre ?? "Sin asignar"}</span>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px]">
          {ESTADO_LABEL[ticket.estado] ?? ticket.estado}
        </span>
      </div>

      {/* Cronómetro live */}
      {!resuelta && (enProceso || segBase > 0 || corridaActiva) && (
        <div className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-mono ${
          corridaActiva ? "bg-accent/10 text-accent" : "bg-surface-hover text-muted"
        }`}>
          <span>{fmtTiempo(segDisplay)}</span>
          {corridaActiva && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}
          {!corridaActiva && segBase > 0 && <span className="text-[10px]">en pausa</span>}
        </div>
      )}

      {/* Resumen al completar */}
      {resolucionInfo && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
          ✓ Completada a las <strong>{resolucionInfo.horario}</strong> · {fmtTiempo(resolucionInfo.duracion)} de trabajo
        </div>
      )}

      {!resuelta && !resolucionInfo && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={iniciarPausar}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-bold min-h-[44px] transition-colors ${
              enProceso
                ? "border-yellow-400 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400"
                : "border-accent bg-accent/10 text-accent hover:bg-accent/20"
            }`}
          >
            <Icon name={enProceso ? "clock" : "lightning"} size={15} weight="bold" />
            {enProceso ? "Pausar" : segBase > 0 ? "Reanudar" : "Iniciar"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={resolver}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-green-500 bg-green-50 px-3 py-2.5 text-sm font-bold text-green-700 min-h-[44px] transition-colors hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400"
          >
            <Icon name="check" size={15} weight="bold" />
            Listo
          </button>
        </div>
      )}
    </div>
  );
}

function AccionesView({
  token, user, onSelect,
}: {
  token: string; user: TicketsUser;
  onSelect: (id: number) => void;
}) {
  const isAdmin = (user.rol?.nivel ?? 1) >= 3;
  // apiToken = CHAT_API_TOKEN que usa /api/voz/transcribir (distinto del JWT de tickets)
  const { apiToken: chatApiToken } = useTicketsAuth();
  const [acciones, setAcciones] = useState<Ticket[]>([]);
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState<"" | "pendiente" | "en_proceso" | "resuelto">(""); // "" = activas
  const [form, setForm] = useState({ titulo: "", asignado_a: "", prioridad: "media", categoria: "logistica" });
  const [creando, setCreando] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState("");

  // ── STT (voz → título de acción) ─────────────────────────────────────────
  const [sttGrabando, setSttGrabando] = useState(false);
  const [sttTranscribiendo, setSttTranscribiendo] = useState(false);
  const [sttError, setSttError] = useState("");
  const [sttSegundos, setSttSegundos] = useState(0);
  const sttMrRef = useRef<MediaRecorder | null>(null);
  const sttChunksRef = useRef<Blob[]>([]);
  const sttTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sttStartRef = useRef<number>(0);

  async function iniciarGrabacion() {
    setSttError("");
    setSttSegundos(0);
    unlockAudioContext(); // desbloquear AudioContext con este gesto
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sttChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) sttChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        if (sttTimerRef.current) clearInterval(sttTimerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        const durSeg = Math.round((Date.now() - sttStartRef.current) / 1000);
        const blob = new Blob(sttChunksRef.current, { type: mr.mimeType });
        if (blob.size === 0 || durSeg < 1) {
          setSttError("Grabación muy corta. Habla al menos 1 segundo.");
          setSttGrabando(false);
          return;
        }
        setSttTranscribiendo(true);
        try {
          const ext = blob.type.split("/")[1]?.split(";")[0] || "webm";
          const fd = new FormData();
          fd.append("audio", blob, `audio.${ext}`);
          const res = await fetch("/api/voz/transcribir", {
            method: "POST",
            headers: { Authorization: `Bearer ${chatApiToken ?? token}` },
            body: fd,
          });
          if (!res.ok) {
            setSttError(`Error del servidor (${res.status}). ¿Está activo Whisper?`);
          } else {
            const data = await res.json();
            const texto = (data.texto ?? "").trim();
            if (texto) {
              setForm((f) => ({ ...f, titulo: texto }));
              setShowForm(true);
              setSttError("");
            } else {
              setSttError("Whisper no detectó palabras. Habla más cerca del micrófono e intenta de nuevo.");
            }
          }
        } catch {
          setSttError("Sin conexión con el servidor. Verifica que agente-pro esté activo.");
        }
        setSttTranscribiendo(false);
        setSttGrabando(false);
        setSttSegundos(0);
      };
      sttMrRef.current = mr;
      sttStartRef.current = Date.now();
      mr.start(250);
      setSttGrabando(true);
      sttTimerRef.current = setInterval(() => setSttSegundos((s) => s + 1), 1000);
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        setSttError("Permiso de micrófono denegado. En Android: Ajustes → Aplicaciones → McKenna → Permisos → Micrófono.");
      } else if (e.name === "NotFoundError") {
        setSttError("No se encontró micrófono en este dispositivo.");
      } else {
        setSttError(`Error al acceder al micrófono: ${e.message}`);
      }
    }
  }

  function detenerGrabacion() {
    if (sttTimerRef.current) { clearInterval(sttTimerRef.current); sttTimerRef.current = null; }
    const mr = sttMrRef.current;
    if (mr && (mr.state === "recording" || mr.state === "paused")) {
      mr.stop();
    } else {
      // MediaRecorder ya estaba detenido (e.g. timeout) — forzar estado limpio
      setSttGrabando(false);
      setSttTranscribiendo(false);
    }
  }

  // Desbloquear AudioContext en el primer toque (requisito Android Chrome)
  useEffect(() => {
    const handler = () => unlockAudioContext();
    document.addEventListener("touchstart", handler, { once: true });
    document.addEventListener("click", handler, { once: true });
    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("click", handler);
    };
  }, []);

  // ── Alarma: voz periódica configurable ────────────────────────────────────
  const [alarmaActiva, setAlarmaActiva] = useState(true);
  const [alarmaMinutos, setAlarmaMinutos] = useState(5); // 1-60 min
  const [countdown, setCountdown]  = useState(0);        // segundos para próxima alarma
  const alarmaRef    = useRef(alarmaActiva);
  const minRef       = useRef(alarmaMinutos);
  const androidAlarmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accionesRef  = useRef(acciones);
  const tokenRef     = useRef(chatApiToken ?? token);
  const ultimaAlarmaRef = useRef(Date.now());
  useEffect(() => { alarmaRef.current = alarmaActiva; }, [alarmaActiva]);
  useEffect(() => { minRef.current = alarmaMinutos; }, [alarmaMinutos]);
  useEffect(() => { accionesRef.current = acciones; }, [acciones]);
  useEffect(() => { tokenRef.current = chatApiToken ?? token; }, [chatApiToken, token]);

  // Notificar a la alarma nativa Android via deep link (Intent URL).
  // Funciona en TWA/APK; en browser web se ignora silenciosamente.
  // Intent URL format: intent://host?params#Intent;scheme=mckennaapp;package=co.mckennagroup.panel;end
  const sincronizarAlarmaAndroid = useCallback((activa: boolean, minutos: number) => {
    try {
      const url = `intent://alarma?activa=${activa}&intervalo=${minutos}#Intent;scheme=mckennaapp;package=co.mckennagroup.panel;S.browser_fallback_url=about%3Ablank;end`;
      const a = document.createElement("a");
      a.href = url; a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 500);
    } catch { /* ignorar si no es TWA/Android */ }
  }, []);

  // ── Service Worker + Web Push (pantalla bloqueada) ───────────────────────
  const pushSubRef = useRef<PushSubscription | null>(null);

  const registrarPush = useCallback(async (reg: ServiceWorkerRegistration, minutos: number, activa: boolean) => {
    if (!("PushManager" in window)) return;
    try {
      // Obtener clave VAPID pública del servidor
      const kr = await fetch("/api/voz/push/vapid-key");
      const { publicKey, disponible } = await kr.json() as { publicKey: string; disponible: boolean };
      if (!disponible || !publicKey) return;

      // Suscribir (reutiliza suscripción existente si ya existe)
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      pushSubRef.current = sub;

      // Registrar programación en el servidor
      await fetch("/api/voz/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ subscription: sub.toJSON(), minutes: minutos, active: activa }),
      });
    } catch { /* push opcional — fallback al canal de SW message */ }
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const init = async () => {
      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
      }
      if (perm !== "granted") return;

      const reg = await navigator.serviceWorker.register("/app/sw-alarm.js", { scope: "/app/" });
      // Esperar a que el SW esté activo
      await navigator.serviceWorker.ready;
      await registrarPush(reg, alarmaMinutos, alarmaActiva);
    };
    init().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-registrar push cuando cambia intervalo o estado de alarma
  useEffect(() => {
    if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return;
    navigator.serviceWorker.ready.then((reg) => registrarPush(reg, alarmaMinutos, alarmaActiva)).catch(() => {});
  }, [alarmaMinutos, alarmaActiva, registrarPush]);

  // Pre-calentar caché de audio cuando la alarma está activa (primera vez)
  useEffect(() => {
    if (!alarmaActiva || !chatApiToken) return;
    const tok = chatApiToken;
    // Retrasar 3 s para no competir con la carga inicial
    const tid = setTimeout(() => { void warmAlarmCache(tok); }, 3000);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmaActiva]);

  // Dispara la alarma: audio si foreground, notificación + push si background
  const dispararAlarma = useCallback(async (forzar = false) => {
    const hayTarea = accionesRef.current.some((t) => t.estado === "en_proceso");
    if (!forzar && (!alarmaRef.current || !hayTarea)) return;
    ultimaAlarmaRef.current = Date.now();
    if (!document.hidden) {
      await playAlarmAudio(tokenRef.current);
    } else {
      // Background / pantalla bloqueada:
      // Canal A — SW message (app en background, pantalla encendida)
      const ctrl = navigator.serviceWorker?.controller;
      if (ctrl && Notification.permission === "granted") {
        ctrl.postMessage({ type: "alarm-notification" });
      }
      // Canal B — push server-side (pantalla bloqueada) ya programado vía registrarPush.
      // El servidor dispara automáticamente al intervalo configurado.
    }
  }, []);

  // Bucle principal: polling 10 s + visibilitychange para resistir throttling
  useEffect(() => {
    const check = () => {
      const ms = minRef.current * 60 * 1000;
      if (Date.now() - ultimaAlarmaRef.current >= ms) void dispararAlarma();
    };
    const iv = setInterval(check, 10_000);
    const onVisible = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
  }, [dispararAlarma]);

  // Countdown: actualizar cada segundo para mostrar tiempo restante
  useEffect(() => {
    if (!alarmaActiva) { setCountdown(0); return; }
    const iv = setInterval(() => {
      const ms = minRef.current * 60 * 1000;
      const restante = Math.max(0, Math.ceil((ms - (Date.now() - ultimaAlarmaRef.current)) / 1000));
      setCountdown(restante);
    }, 1000);
    return () => clearInterval(iv);
  }, [alarmaActiva]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ tipo: "accion" });
      if (filtroEstado) params.set("estado", filtroEstado);
      const [data, usrs] = await Promise.all([
        tapi(`/?${params}`, token),
        tapi("/usuarios", token),
      ]);
      const list: Ticket[] = Array.isArray(data) ? data.map(normalizeTicketForList) : [];
      setAcciones((prev) => {
        const ns = JSON.stringify(list.map((t) => t.id + t.estado));
        const ps = JSON.stringify(prev.map((t) => t.id + t.estado));
        return ns === ps ? prev : list;
      });
      setUsuarios(Array.isArray(usrs) ? usrs : []);
    } catch { /* ignore */ }
    finally { if (!silent) setLoading(false); }
  }, [token, filtroEstado]);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    const iv = setInterval(() => { void load(true); }, 30000);
    return () => clearInterval(iv);
  }, [load]);

  async function crear() {
    if (!form.titulo.trim()) return;
    setCreando(true);
    setMsg("");
    try {
      await tapi("/", token, { method: "POST", body: JSON.stringify({ ...form, tipo: "accion", descripcion: form.titulo }) });
      setForm({ titulo: "", asignado_a: "", prioridad: "media", categoria: "logistica" });
      setShowForm(false);
      await load(false);
      setMsg("Acción creada");
      setTimeout(() => setMsg(""), 2500);
    } catch (e: any) {
      setMsg(e.message ?? "Error al crear");
    } finally {
      setCreando(false);
    }
  }

  // Agrupar por asignado
  const porAsignado = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of acciones) {
      const key = t.asignado_a_nombre ?? "Sin asignar";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [acciones]);

  const sinResolver = acciones.filter((t) => t.estado !== "resuelto" && t.estado !== "rechazado").length;
  const hayEnProceso = acciones.some((t) => t.estado === "en_proceso");

  // La alarma nativa la controla el usuario vía el toggle/intervalo.
  // NO sincronizar automáticamente desde hayEnProceso: dispararía un
  // intent mckennaapp:// cada vez que carga la web app causando un loop
  // de LauncherActivity en el TWA.

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-extrabold text-ink flex items-center gap-2">
            <TopicIcon value="⚡" size={18} />
            Acciones
            {sinResolver > 0 && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{sinResolver}</span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted">Tareas rápidas asignadas a miembros del equipo</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Alarma: toggle + selector de intervalo + countdown + botón probar */}
          {hayEnProceso && (
            <div className="flex items-center gap-1 flex-wrap">
              {/* Toggle on/off */}
              <button
                type="button"
                title={alarmaActiva ? "Silenciar alarma" : "Activar alarma de voz periódica"}
                onClick={() => {
                  const next = !alarmaActiva;
                  setAlarmaActiva(next);
                  sincronizarAlarmaAndroid(next, minRef.current);
                  if (next) { ultimaAlarmaRef.current = Date.now(); void dispararAlarma(true); }
                }}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                  alarmaActiva
                    ? "border-orange-400 bg-orange-500/10 text-orange-500"
                    : "border-border text-muted hover:text-ink"
                }`}
              >
                {alarmaActiva ? "🔔" : "🔕"}
              </button>

              {/* Selector de intervalo */}
              <select
                value={alarmaMinutos}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setAlarmaMinutos(m);
                  if (androidAlarmDebounceRef.current) clearTimeout(androidAlarmDebounceRef.current);
                  androidAlarmDebounceRef.current = setTimeout(() => { sincronizarAlarmaAndroid(alarmaRef.current, m); androidAlarmDebounceRef.current = null; }, 1500);
                  ultimaAlarmaRef.current = Date.now(); // reiniciar countdown
                  setCountdown(m * 60);
                }}
                className="quest-input py-1 text-xs"
                title="Intervalo de notificación"
              >
                {[1, 2, 3, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>

              {/* Countdown hasta próxima alarma */}
              {alarmaActiva && countdown > 0 && (
                <span className="text-[10px] font-mono text-muted tabular-nums min-w-[36px] text-center">
                  {String(Math.floor(countdown / 60)).padStart(2, "0")}:{String(countdown % 60).padStart(2, "0")}
                </span>
              )}

              {/* Botón probar ahora */}
              <button
                type="button"
                title="Reproducir notificación de voz ahora"
                onClick={() => { ultimaAlarmaRef.current = Date.now() - minRef.current * 60 * 1000; void dispararAlarma(true); }}
                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-muted hover:border-accent hover:text-accent transition-colors"
              >
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Probar
              </button>
            </div>
          )}
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)}
            className="quest-input py-1.5 text-xs"
          >
            <option value="">Activas</option>
            <option value="pendiente">Pendiente</option>
            <option value="en_proceso">En proceso</option>
            <option value="resuelto">Resueltas</option>
          </select>
          {/* Botón voz (STT) — solo visible cuando no está grabando */}
          {!sttGrabando && (
            <button
              type="button"
              onClick={() => void iniciarGrabacion()}
              disabled={sttTranscribiendo}
              title="Describir acción por voz (Whisper STT)"
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold min-h-[40px] transition-colors disabled:opacity-50 ${
                sttTranscribiendo
                  ? "border-border text-muted"
                  : "border-border text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {sttTranscribiendo ? (
                <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                </svg>
              )}
              {sttTranscribiendo ? "Transcribiendo…" : "Voz"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="quest-board-toolbar-btn quest-board-toolbar-btn--active flex items-center gap-1 px-3"
          >
            <Icon name="plus" size={14} weight="bold" />
            Nueva acción
          </button>
        </div>
      </div>

      {/* STT status — banner de grabación con botón DETENER grande */}
      {sttGrabando && (
        <div className="flex items-center gap-3 rounded-xl border-2 border-red-400/60 bg-red-500/10 px-4 py-3">
          <span className="h-3 w-3 shrink-0 rounded-full bg-red-400 animate-pulse" />
          <span className="font-mono text-sm font-bold text-red-400 tabular-nums">
            {String(Math.floor(sttSegundos / 60)).padStart(2,"0")}:{String(sttSegundos % 60).padStart(2,"0")}
          </span>
          <span className="flex-1 text-sm text-red-400">Grabando…</span>
          <button
            type="button"
            onClick={detenerGrabacion}
            className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white min-h-[44px] shadow-md active:bg-red-700 hover:bg-red-600 transition-colors"
          >
            <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
            Detener grabación
          </button>
        </div>
      )}
      {sttError && !sttGrabando && (
        <p className="text-sm text-red-400">{sttError}</p>
      )}

      {/* Form rápido */}
      {showForm && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
          <p className="text-xs font-bold text-accent uppercase tracking-wide">Nueva acción</p>
          <div className="flex gap-2">
            <input
              className="quest-input flex-1"
              placeholder="¿Qué debe hacer? (escribe o usa el botón Voz)"
              value={form.titulo}
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") void crear(); }}
            />
            {/* Mic inline en el formulario */}
            {sttGrabando ? (
              <button
                type="button"
                onClick={detenerGrabacion}
                title="Detener grabación"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500 px-3 py-2.5 text-sm font-bold text-white min-h-[44px] min-w-[80px] shadow active:bg-red-700 hover:bg-red-600 transition-colors"
              >
                <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void iniciarGrabacion()}
                disabled={sttTranscribiendo}
                title="Describir por voz"
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm min-h-[44px] text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
              >
                {sttTranscribiendo ? (
                  <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                )}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="quest-input flex-1 min-w-[140px]"
              value={form.asignado_a}
              onChange={(e) => setForm((f) => ({ ...f, asignado_a: e.target.value }))}
            >
              <option value="">Sin asignar</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
            <select
              className="quest-input w-36"
              value={form.prioridad}
              onChange={(e) => setForm((f) => ({ ...f, prioridad: e.target.value }))}
            >
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
            <select
              className="quest-input w-36"
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
            >
              <option value="logistica">Logística</option>
              <option value="ventas">Ventas</option>
              <option value="rrhh">RRHH</option>
              <option value="mantenimiento">Mantenimiento</option>
              <option value="contabilidad">Contabilidad</option>
              <option value="compras">Compras</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={creando || !form.titulo.trim()}
              onClick={crear}
              className="quest-btn-primary px-4 py-1.5 text-sm"
            >
              {creando ? "Creando…" : "Crear acción"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-muted hover:text-ink">
              Cancelar
            </button>
            {msg && <span className="text-xs text-accent">{msg}</span>}
          </div>
        </div>
      )}

      {loading && (
        <div className="py-8 text-center text-sm text-muted">Cargando acciones…</div>
      )}

      {!loading && acciones.length === 0 && (
        <div className="py-12 text-center text-sm text-muted">
          No hay acciones {filtroEstado ? `con estado "${filtroEstado}"` : "activas"}.
        </div>
      )}

      {/* Tarjetas agrupadas por asignado */}
      {!loading && porAsignado.map(([nombre, items]) => (
        <div key={nombre}>
          <div className="mb-2 flex items-center gap-2">
            <Icon name="user" size={13} className="text-muted" />
            <span className="text-xs font-bold uppercase tracking-wide text-muted">{nombre}</span>
            <span className="rounded-full bg-surface border border-border px-1.5 py-0.5 text-[10px] text-muted">{items.length}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => (
              <AccionCard
                key={t.id}
                ticket={t}
                token={token}
                onSelect={onSelect}
                onChanged={() => void load(true)}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function TicketsPanel() {
  const { token, user, setAuth, clear } = useTicketsAuth();
  const questDark = useQuestTheme((s) => s.dark);
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedMisionId, setSelectedMisionId] = useState<number | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [bajoStockCount, setBajoStockCount] = useState(0);
  const [navScope, setNavScope] = useState<NavScope>({ kind: "all" });
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const carritoOpen = useInventarioCarrito((s) => s.modalOpen);
  const openCarrito = useInventarioCarrito((s) => s.setModalOpen);

  const reloadCats = useCallback(() => {
    if (!token) return;
    tapi("/categorias/", token).then((d) => setCategorias(Array.isArray(d) ? d : [])).catch(() => {});
  }, [token]);

  useEffect(() => { reloadCats(); }, [reloadCats]);

  useEffect(() => {
    if (!token) return;
    tapi("/materiales", token)
      .then((mats) => {
        if (Array.isArray(mats)) setBajoStockCount(mats.filter((m) => m.stock_minimo > 0 && m.stock_actual < m.stock_minimo).length);
      })
      .catch(() => {});
  }, [token, view]);

  // Auth is handled at App level; if somehow null here, bail early
  if (!token || !user) return null;

  const nivel = user.rol?.nivel ?? 1;
  const permisos = user.permisos_secciones;

  // Si el usuario no puede ver el tablero, mostrar acciones por defecto
  useEffect(() => {
    if (!puedeVerTab(permisos, nivel, "tablero") && view === "list") {
      if (puedeVerTab(permisos, nivel, "acciones")) setView("acciones");
    }
  }, [permisos, nivel]); // eslint-disable-line react-hooks/exhaustive-deps

  function goDetail(id: number) { setSelectedId(id); setView("detail"); }
  function goBack() {
    setBoardRefreshKey((k) => k + 1);
    setView("list");
    setSelectedId(null);
    setSelectedMisionId(null);
  }
  function goMisionDetail(id: number) { setSelectedMisionId(id); setView("mision_detail"); }
  function goTablero() {
    setNavScope({ kind: "all" });
    setBoardRefreshKey((k) => k + 1);
    setView("list");
    setSelectedId(null);
    setSelectedMisionId(null);
  }
  function goAcciones() { setView("acciones"); }
  function goInventario() { setView("inventario"); }
  function goReinos() { setView("reinos"); }
  function goWorkload() { setView("workload"); }
  function goPerfil() { setView("perfil"); }
  function goRecetas() { setView("recetas"); }
  function goCreateMision() { setView("crear_mision"); }
  function handleNavScope(scope: NavScope) { setNavScope(scope); }
  function goIrTableroConFiltro() {
    setBoardRefreshKey((k) => k + 1);
    setView("list");
  }
  function goIrInventarioConFiltro() { setView("inventario"); }

  return (
    <CategoriasCtx.Provider value={{ cats: categorias, reload: reloadCats }}>
    <div className={`quest-canvas relative min-h-full transition-colors duration-200 ${questDark ? "dark" : ""}`}>
        <QuestNavBar
          view={view}
          nivel={nivel}
          permisos={permisos}
          bajoStockCount={bajoStockCount}
          userNombre={user.nombre}
          onTablero={goTablero}
          onAcciones={goAcciones}
          onInventario={goInventario}
          onReinos={goReinos}
          onRecetas={goRecetas}
          onCarrito={() => openCarrito(true)}
          carritoOpen={carritoOpen}
          onWorkload={goWorkload}
          onPerfil={goPerfil}
          onCreateMision={goCreateMision}
          onLogout={clear}
        />
        <InventarioCarritoModal
          token={token}
          nivel={nivel}
          onMisionCreated={(id) => {
            setBoardRefreshKey((k) => k + 1);
            goMisionDetail(id);
          }}
        />
        {view === "reinos" && (
          <ReinosView
            token={token}
            user={user}
            navScope={navScope}
            onNavScope={handleNavScope}
            onIrTablero={goIrTableroConFiltro}
            onIrInventario={goIrInventarioConFiltro}
          />
        )}
        {view === "list" && (
          <TicketListView
            token={token} user={user}
            onSelect={goDetail}
            onEditMision={goMisionDetail}
            navScope={navScope}
            refreshKey={boardRefreshKey}
          />
        )}
        {view === "acciones" && (
          <AccionesView
            token={token}
            user={user}
            onSelect={goDetail}
          />
        )}
        {view === "create" && (
          <CreateTicketView
            token={token} user={user}
            onBack={goBack}
            onCreated={(id) => goDetail(id)}
          />
        )}
        {view === "detail" && selectedId != null && (
          <TicketDetailView
            token={token} user={user}
            ticketId={selectedId}
            onBack={() => {
              if (selectedMisionId) { setView("mision_detail"); }
              else { goBack(); }
            }}
          />
        )}
        {view === "perfil" && (
          <PerfilView
            token={token}
            user={user}
            onBack={goBack}
            onUserUpdated={(u) => setAuth(token, u)}
          />
        )}
        {view === "recetas" && (
          <RecetasPanel token={token} user={user} onBack={goBack} />
        )}
        {view === "workload" && nivel >= 2 && (
          <WorkloadView token={token} user={user} onBack={goBack} />
        )}
        {view === "crear_mision" && (
          <CreateMisionView
            token={token}
            user={user}
            onBack={goBack}
            onCreated={(id) => goMisionDetail(id)}
          />
        )}
        {view === "mision_detail" && selectedMisionId != null && (
          <MisionDetailView
            token={token} user={user}
            misionId={selectedMisionId}
            onBack={goBack}
            onTicket={(id) => { setSelectedId(id); setView("detail"); }}
          />
        )}
        {view === "inventario" && (
          <InventarioView
            token={token} user={user}
            navScope={navScope}
            onBack={goBack}
          />
        )}
    </div>
    </CategoriasCtx.Provider>
  );
}
