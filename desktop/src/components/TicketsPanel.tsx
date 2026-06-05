import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";
import {
  isAndroidMobileBrowser,
  isMcKennaAndroidApp,
  mckennaAndroidBridge,
  webNotificationsAvailable,
} from "../lib/androidApp";
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
import TelefonosOperadoresSection from "./TelefonosOperadoresSection";
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

// ── InfoTooltip: botón ⓘ discreto con ayuda contextual ───────────────────────
function InfoTooltip({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Ayuda"
        className="h-4 w-4 rounded-full border border-muted/40 text-[9px] font-bold text-muted hover:border-accent hover:text-accent transition-colors flex items-center justify-center leading-none select-none"
      >
        i
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-5 z-50 w-72 rounded-xl border border-border bg-surface p-3 shadow-xl text-xs text-muted leading-relaxed">
            {text}
          </div>
        </>
      )}
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ticket {
  id: number;
  numero: string;
  titulo: string;
  categoria: string;
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
  ticket_padre_id?: number | null;
  ticket_padre_numero?: string | null;
  ticket_padre_titulo?: string | null;
  ticket_padre_solicitante?: string | null;
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
  protocolo_id?: number | null;
  protocolo_titulo?: string | null;
  procedimiento_id?: number | null;
  procedimiento_titulo?: string | null;
  procedimiento_alcance?: "personal" | "global" | string | null;
  tipo?: "ticket" | "accion" | "solicitud";
  subtipo?: string | null;
  tiene_datos_sensibles?: boolean;
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
    hint: "Se repite: inicia un nuevo ciclo cuando termines y agrega tickets; no se cierra sola.",
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
  telefono?: string | null;
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
  if (!permisos) return tab === "acciones" || tab === "solicitudes";
  return Boolean(permisos[`tickets_${tab}`]);
}

const PROTOCOLOS_CREAR_EMAILS = new Set(["cynthua0418@gmail.com"]);

function puedeCrearProtocolos(user: TicketsUser): boolean {
  const nivel = user.rol?.nivel ?? 1;
  if (nivel >= 2) return true;
  const email = (user.email ?? "").trim().toLowerCase();
  if (email && PROTOCOLOS_CREAR_EMAILS.has(email)) return true;
  return Boolean(user.permisos_secciones?.tickets_protocolos_crear);
}

type View =
  | "home"
  | "list"
  | "acciones"
  | "solicitudes"
  | "create"
  | "detail"
  | "admin"
  | "administracion"
  | "workload"
  | "crear_mision"
  | "mision_detail"
  | "inventario"
  | "reinos"
  | "perfil"
  | "recetas"
  | "agente";

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
  onSolicitudes,
  onInventario,
  onReinos,
  onRecetas,
  onCarrito,
  carritoOpen,
  onWorkload,
  onPerfil,
  onCreateMision,
  onLogout,
  onAgente,
}: {
  view: View;
  nivel: number;
  permisos: Record<string, boolean> | null | undefined;
  bajoStockCount: number;
  userNombre: string;
  onTablero: () => void;
  onAcciones: () => void;
  onSolicitudes: () => void;
  onInventario: () => void;
  onReinos: () => void;
  onRecetas: () => void;
  onCarrito: () => void;
  carritoOpen: boolean;
  onWorkload: () => void;
  onPerfil: () => void;
  onCreateMision: () => void;
  onLogout: () => void;
  onAgente: () => void;
}) {
  const pVer = (tab: string) => puedeVerTab(permisos, nivel, tab);
  const [menuOpen, setMenuOpen] = useState(false);
  const cerrar = () => setMenuOpen(false);

  // Etiqueta de la sección activa (para la cabecera móvil)
  const viewLabels: Partial<Record<View, string>> = {
    home: "Inicio", list: "Tablero", acciones: "Acciones", solicitudes: "Solicitudes",
    crear_mision: "Nueva misión", inventario: "Inventario", reinos: "Reinos",
    recetas: "Recetas", workload: "Aliados", perfil: "Perfil",
    mision_detail: "Misión", detail: "Ticket", create: "Nuevo ticket",
    agente: "🎙️ Hugo",
  };
  const activeLabel = viewLabels[view] ?? "Menú";

  return (
    <nav
      className="quest-nav-bar sticky top-0 z-20 -mx-4 mb-5 border-b-2 border-border px-4 py-2.5 backdrop-blur-md lg:-mx-10"
      aria-label="Navegación Centro de Mando"
    >
      {/* ── Cabecera única (siempre visible) ───────────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Sección activa — mobile */}
        <span className="flex-1 truncate text-sm font-extrabold text-ink sm:hidden">
          {activeLabel}
        </span>

        {/* Items — desktop (siempre visibles desde sm) */}
        <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 sm:flex">
          <button type="button" onClick={onTablero} className={questNavBtn(view === "home" || view === "list")}>
            <TopicIcon value="🏠" size={14} weight="duotone" />Inicio
          </button>
          <button
            type="button"
            onClick={onAgente}
            className={questNavBtn(view === "agente")}
            title="Agente de voz — registrar acciones"
          >
            <TopicIcon value="🎙️" size={14} weight="duotone" />Hugo
          </button>
          {nivel >= 2 && pVer("workload") && (
            <button type="button" onClick={onWorkload} className={questNavBtn(view === "workload")}>
              <TopicIcon value="🤝" size={14} weight="duotone" />Aliados
            </button>
          )}
          {pVer("perfil") && (
            <button type="button" onClick={onPerfil} className={questNavBtn(view === "perfil")}>
              <TopicIcon value="👤" size={14} weight="duotone" />Perfil
            </button>
          )}
        </div>

        {/* Acciones siempre visibles */}
        <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto">
          <QuestThemeToggle />
          {/* Logout — desktop */}
          <button
            type="button" onClick={onLogout}
            title={`Cerrar sesión (${userNombre})`}
            className={`hidden sm:flex ${questNavBtn(false)} max-w-[12rem] truncate`}
          >
            <Icon name="signOut" size={14} weight="bold" className="shrink-0" />
            <span className="truncate">Salir</span>
          </button>
          {/* Hamburguesa — solo mobile */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-border text-base font-bold text-muted transition hover:border-accent hover:text-accent sm:hidden"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* ── Menú desplegable — solo mobile, solo cuando está abierto ────── */}
      {menuOpen && (
        <div className="mt-2.5 flex flex-col gap-1.5 border-t border-border pt-2.5 sm:hidden">
          <button type="button" onClick={() => { onTablero(); cerrar(); }}
            className={`${questNavBtn(view === "home" || view === "list")} w-full justify-start text-left`}>
            <TopicIcon value="🏠" size={14} weight="duotone" />Inicio
          </button>
          {nivel >= 2 && pVer("workload") && (
            <button type="button" onClick={() => { onWorkload(); cerrar(); }}
              className={`${questNavBtn(view === "workload")} w-full justify-start text-left`}>
              <TopicIcon value="🤝" size={14} weight="duotone" />Aliados
            </button>
          )}
          {pVer("perfil") && (
            <button type="button" onClick={() => { onPerfil(); cerrar(); }}
              className={`${questNavBtn(view === "perfil")} w-full justify-start text-left`}>
              <TopicIcon value="👤" size={14} weight="duotone" />Perfil
            </button>
          )}
          <button type="button" onClick={() => { onAgente(); cerrar(); }}
            className={`${questNavBtn(view === "agente")} w-full justify-start text-left`}>
            <TopicIcon value="🎙️" size={14} weight="duotone" />Hugo — Registrar acción
          </button>
          <button type="button" onClick={onLogout}
            className={`${questNavBtn(false)} w-full justify-start border-t border-border pt-2 text-left`}>
            <Icon name="signOut" size={14} weight="bold" className="shrink-0" />
            Salir ({userNombre})
          </button>
        </div>
      )}
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

/** Comparación segura de IDs (API a veces devuelve string). */
function uidEq(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

/** Solicitud delegada solo para ir de compras (checklist); no va en pestaña Acciones. */
function esSolicitudCompraDelegada(t: Ticket): boolean {
  if ((t.subtipo || "").trim() === "compra") return true;
  const tit = (t.titulo || "").trim().toLowerCase();
  if (tit.startsWith("compras:") && (t.ticket_padre_id || (t.tipo || "") === "solicitud")) return true;
  return false;
}

async function tapiSafe(path: string, token: string, options: RequestInit = {}): Promise<unknown> {
  try {
    return await tapi(path, token, options);
  } catch {
    return null;
  }
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
      <div className="p-3 sm:p-4">
        {totalMisiones === 0 && section.standalone.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="text-4xl select-none opacity-40">🏰</span>
            <p className="text-sm font-medium text-muted">Sin misiones activas en este reino</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.groups.map((group, i) => {
              const progMision = misionGrupoEjecucionPct(group);
              const isComplete = progMision.pct === 100;
              const c = group.mision_color || section.color || "#0c6069";
              const total = group.tickets.length;
              const hechos = group.tickets.filter(ticketEjecucionCompleto).length;
              return (
                <button
                  key={group.mision_id}
                  onClick={() => onEditMision(group.mision_id)}
                  className="mck-slide-up group relative flex flex-col gap-3 overflow-hidden rounded-2xl border-2 border-transparent p-4 text-left shadow-sm transition hover:shadow-md active:scale-[0.98]"
                  style={{
                    animationDelay: `${i * 60}ms`,
                    borderColor: `${c}44`,
                    background: `linear-gradient(135deg, ${c}12 0%, ${c}06 100%)`,
                  }}
                >
                  {/* Icono + título */}
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg shadow-sm"
                      style={{ background: c, color: "#fff" }}>
                      <TopicIcon value={(group as any).mision_icono || "🎯"} size={20} weight="fill" className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-extrabold text-ink leading-tight"
                        style={{ color: c }}>
                        {group.mision_titulo}
                      </h4>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {total} tarea{total !== 1 ? "s" : ""} · {progMision.pct}%
                      </p>
                    </div>
                    {isComplete && (
                      <span className="mck-bounce-in shrink-0 text-xl select-none">🏆</span>
                    )}
                  </div>
                  {/* Barra de progreso */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.max(progMision.pct, 2)}%`, background: isComplete ? "#16a34a" : c }} />
                  </div>
                  {/* Estado */}
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold
                      ${isComplete ? "bg-emerald-100 text-emerald-700" : "bg-black/5 text-muted"}`}>
                      {isComplete ? "✓ Completada" : `${hechos}/${total} listas`}
                    </span>
                    <span className="text-[10px] font-bold text-muted/60 group-hover:text-accent transition">
                      Abrir →
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
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

// ── CentroMandoHome ───────────────────────────────────────────────────────────

function CentroMandoHome({
  token, user, nivel, permisos,
  onAcciones, onSolicitudes, onTablero,
  onAccionesFuturas, onRecordatorios, onProcedimientos, onAgente,
}: {
  token: string;
  user: TicketsUser;
  nivel: number;
  permisos: Record<string, boolean> | null | undefined;
  onAcciones: () => void;
  onSolicitudes: () => void;
  onTablero: () => void;
  onAccionesFuturas: () => void;
  onRecordatorios: () => void;
  onProcedimientos: () => void;
  onAgente?: () => void;
}) {
  const pVer = (tab: string) => puedeVerTab(permisos, nivel, tab);

  interface HomeStat { label: string; value: number | null }
  const [stats, setStats] = useState<{
    acciones: HomeStat;
    solicitudes: HomeStat;
    pendientes: HomeStat;
    recordatorios: HomeStat;
    recordatoriosHoy: number;
    procedimientos: HomeStat;
  }>({
    acciones:       { label: "en curso", value: null },
    solicitudes:    { label: "por resolver", value: null },
    pendientes:     { label: "anotadas", value: null },
    recordatorios:  { label: "programados", value: null },
    recordatoriosHoy: 0,
    procedimientos: { label: "guardados", value: null },
  });
  const [accionesActivas, setAccionesActivas] = useState<any[]>([]);

  useEffect(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    Promise.allSettled([
      tapi("/?tipo=accion&activas=1", token),
      tapi("/?tipo=solicitud&activas=1", token),
      tapi("/pendientes", token),
      tapi("/recordatorios", token),
      tapi("/protocolos?alcance=mis", token),
    ]).then(([acc, sol, pend, rec, proc]) => {
      const accList = acc.status === "fulfilled" && Array.isArray(acc.value) ? acc.value as any[] : [];
      setAccionesActivas(accList);
      setStats({
        acciones:      { label: "en curso",      value: accList.length },
        solicitudes:   { label: "por resolver",  value: sol.status  === "fulfilled" && Array.isArray(sol.value)  ? (sol.value as any[]).filter((t: any) => t.asignado_a === user.id).length  : null },
        pendientes:    { label: "anotadas",      value: pend.status === "fulfilled" && Array.isArray(pend.value) ? pend.value.length : null },
        recordatorios: { label: "programados",   value: rec.status  === "fulfilled" && Array.isArray(rec.value)  ? rec.value.length  : null },
        recordatoriosHoy: rec.status === "fulfilled" && Array.isArray(rec.value)
          ? (rec.value as any[]).filter((r: any) => r.proxima_fecha <= hoy).length
          : 0,
        procedimientos:{ label: "guardados",     value: proc.status === "fulfilled" && Array.isArray(proc.value) ? proc.value.length : null },
      });
    });
  }, [token, user.id]);

  useEffect(() => {
    const iv = setInterval(() => {
      const hoy = new Date().toISOString().slice(0, 10);
      Promise.allSettled([
        tapi("/?tipo=accion&activas=1", token),
        tapi("/?tipo=solicitud&activas=1", token),
        tapi("/pendientes", token),
        tapi("/recordatorios", token),
        tapi("/protocolos?alcance=mis", token),
      ]).then(([acc, sol, pend, rec, proc]) => {
        const accList = acc.status === "fulfilled" && Array.isArray(acc.value) ? acc.value as any[] : [];
        setAccionesActivas(accList);
        setStats({
          acciones:       { label: "en curso",     value: accList.length },
          solicitudes:    { label: "por resolver",  value: sol.status  === "fulfilled" && Array.isArray(sol.value)  ? (sol.value as any[]).filter((t: any) => t.asignado_a === user.id).length  : null },
          pendientes:     { label: "anotadas",      value: pend.status === "fulfilled" && Array.isArray(pend.value) ? pend.value.length : null },
          recordatorios:  { label: "programados",   value: rec.status  === "fulfilled" && Array.isArray(rec.value)  ? rec.value.length  : null },
          recordatoriosHoy: rec.status === "fulfilled" && Array.isArray(rec.value)
            ? (rec.value as any[]).filter((r: any) => r.proxima_fecha <= hoy).length
            : 0,
          procedimientos: { label: "guardados",     value: proc.status === "fulfilled" && Array.isArray(proc.value) ? proc.value.length : null },
        });
      });
    }, 30000);
    return () => clearInterval(iv);
  }, [token, user.id]);

  function Stat({ s }: { s: HomeStat }) {
    if (s.value === null) return <span className="text-muted/40 dark:text-white/20 text-sm">—</span>;
    return <>{s.value}</>;
  }

  // Base compartida
  const cardBase = [
    "group relative flex flex-col gap-5 rounded-3xl border p-6 text-left",
    "shadow-[0_2px_14px_rgba(0,0,0,0.06)] hover:shadow-[0_6px_24px_rgba(0,0,0,0.11)]",
    "transition-all duration-200 cursor-pointer active:scale-[0.97]",
  ].join(" ");

  // Paleta por sección — tonos más presentes en dark mode
  const paleta = {
    acciones:   { card: "bg-amber-50  dark:bg-amber-950/50  border-amber-200    dark:border-amber-700/60",  icon: "bg-amber-200/70  dark:bg-amber-800/60  text-amber-700  dark:text-amber-300" },
    solicitudes:{ card: "bg-rose-50   dark:bg-rose-950/50   border-rose-200     dark:border-rose-700/60",   icon: "bg-rose-200/70   dark:bg-rose-800/60   text-rose-700   dark:text-rose-300"  },
    futuras:    { card: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700/60", icon: "bg-emerald-200/70 dark:bg-emerald-800/60 text-emerald-700 dark:text-emerald-300" },
    recordat:   { card: "bg-violet-50 dark:bg-violet-950/50 border-violet-200   dark:border-violet-700/60", icon: "bg-violet-200/70  dark:bg-violet-800/60  text-violet-700 dark:text-violet-300" },
    proced:     { card: "bg-sky-50    dark:bg-sky-950/50    border-sky-200      dark:border-sky-700/60",    icon: "bg-sky-200/70    dark:bg-sky-800/60    text-sky-700    dark:text-sky-300"   },
    tablero:    { card: "bg-stone-50  dark:bg-stone-900/60  border-stone-200    dark:border-stone-600/50",  icon: "bg-stone-200/70  dark:bg-stone-700/60  text-stone-600  dark:text-stone-300" },
  };

  function HomeCard({ onClick, p, emoji, titulo, stat, desc, badge }: {
    onClick: () => void;
    p: { card: string; icon: string };
    emoji: string;
    titulo: string;
    stat: React.ReactNode;
    desc: string;
    badge?: React.ReactNode;
  }) {
    return (
      <button type="button" onClick={onClick} className={`${cardBase} ${p.card}`}>
        {/* Fila superior: ícono + número */}
        <div className="flex items-center justify-between gap-3">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl ${p.icon}`}>
            {emoji}
          </span>
          <div className="text-right space-y-1">
            <div className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{stat}</div>
            {badge}
          </div>
        </div>
        {/* Título — Montserrat ExtraBold */}
        <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">{titulo}</p>
        {/* Descripción — Montserrat Bold, mayor tamaño y contraste */}
        <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">{desc}</p>
      </button>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      {/* Saludo */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted/60 mb-1">McKenna Group</p>
        <h2 className="text-3xl font-extrabold text-ink leading-tight">Centro de Mando</h2>
        <p className="mt-1 text-sm text-muted">Bienvenido, {user.nombre.split(" ")[0]} 👋</p>
      </div>

      {/* Grid principal */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

        {pVer("acciones") && (
          <HomeCard
            onClick={onAcciones} p={paleta.acciones} emoji="⚡"
            titulo="Acciones"
            stat={<Stat s={stats.acciones} />}
            desc="Arranca y registra tus labores del día. Graba lo que hiciste y no pierdas el hilo."
          />
        )}

        {pVer("solicitudes") && (
          <HomeCard
            onClick={onSolicitudes} p={paleta.solicitudes} emoji="📋"
            titulo="Solicitudes"
            stat={<Stat s={stats.solicitudes} />}
            desc="¿Alguien te pidió algo o tú le pediste a alguien del equipo? Acá están esas tareas."
          />
        )}

        {pVer("acciones") && (
          <HomeCard
            onClick={onAccionesFuturas} p={paleta.futuras} emoji="🗓️"
            titulo="Acciones futuras"
            stat={<Stat s={stats.pendientes} />}
            desc="Tareas que requieren tu atención pero todavía no arrancas. Anótalas y cuando estés listo, las conviertes en acción."
          />
        )}

        {pVer("acciones") && (
          <HomeCard
            onClick={onRecordatorios} p={paleta.recordat} emoji="🔔"
            titulo="Recordatorios"
            stat={<Stat s={stats.recordatorios} />}
            desc="Para cosas sencillas y recurrentes — pagar un recibo, llamar a alguien. Solo necesitas que te avisen."
            badge={stats.recordatoriosHoy > 0 ? (
              <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-bold text-white">
                {stats.recordatoriosHoy} para hoy
              </span>
            ) : undefined}
          />
        )}

        {pVer("acciones") && (
          <HomeCard
            onClick={onProcedimientos} p={paleta.proced} emoji="🔒"
            titulo="Procedimientos"
            stat={<Stat s={stats.procedimientos} />}
            desc="Los pasos que ya guardaste pa' no explicar lo mismo dos veces. Úsalos cuando quieras."
          />
        )}

        {nivel >= 3 && (
          <HomeCard
            onClick={onTablero} p={paleta.tablero} emoji="📊"
            titulo="Tablero completo"
            stat={<span className="text-sm font-semibold text-muted">Admin</span>}
            desc="Vista general de todas las tareas del equipo organizadas por zona de trabajo."
          />
        )}

      </div>

      {/* Panel de acciones activas asignadas */}
      {pVer("acciones") && accionesActivas.length > 0 && (
        <div className="rounded-3xl border border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base">⚡</span>
            <p className="text-xs font-extrabold uppercase tracking-widest text-amber-700 dark:text-amber-300">
              Tus acciones activas
            </p>
          </div>
          <div className="space-y-2">
            {accionesActivas.map((t: any) => {
              const prioBg: Record<string, string> = {
                urgente: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
                alta: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
                media: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-300",
                baja: "bg-surface-hover text-muted",
              };
              const estadoBg: Record<string, string> = {
                en_proceso: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300",
                pendiente: "bg-surface-hover text-muted",
                esperando_aprobacion: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
              };
              return (
                <button
                  key={t.id ?? t.numero}
                  type="button"
                  onClick={onAcciones}
                  className="w-full flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-amber-200 dark:border-amber-700/40 bg-white dark:bg-amber-950/30 px-4 py-3 text-left transition-all hover:border-amber-400 hover:shadow-sm active:scale-[0.98]"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-mono text-[11px] font-bold text-accent">{t.numero}</span>
                    <span className="text-sm font-semibold text-ink leading-tight">{t.titulo}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0 pt-0.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${estadoBg[t.estado] ?? "bg-surface-hover text-muted"}`}>
                      {t.estado === "en_proceso" ? "▶ en proceso" : t.estado === "esperando_aprobacion" ? "🕐 esperando" : "⏸ pendiente"}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${prioBg[t.prioridad] ?? prioBg.baja}`}>
                      {t.prioridad}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Botón agente — visible solo en pantallas pequeñas (móvil) */}
      {onAgente && (
        <div className="sm:hidden">
          <button
            type="button"
            onClick={onAgente}
            className="w-full flex items-center gap-4 rounded-3xl border-2 border-accent bg-accent/10 px-6 py-4 text-left transition hover:bg-accent/20 active:scale-[0.98]"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-2xl text-white shadow">
              🎙️
            </span>
            <div>
              <p className="text-lg font-extrabold text-ink dark:text-white leading-tight">Hugo, registra</p>
              <p className="text-sm font-semibold text-accent">Dictá o escribí lo que vas a hacer</p>
            </div>
            <span className="ml-auto text-accent text-xl">›</span>
          </button>
        </div>
      )}

    </div>
  );
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

// ── Resolver paso a paso (Duolingo-style) para un ticket con pasos ──────────────────────────
function TicketPasoAPasoView({
  token, ticket, onSalir, onCompletado,
}: {
  token: string; ticket: Ticket; onSalir: () => void; onCompletado: () => void;
}) {
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pasoIdx, setPasoIdx] = useState(0);
  const [fase, setFase] = useState<"cargando" | "paso" | "todo_ok">("cargando");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [slideDir, setSlideDir] = useState<"right" | "left">("right");

  const t0 = useRef(Date.now());
  const [seg, setSeg] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSeg(Math.floor((Date.now() - t0.current) / 1000)), 500);
    return () => clearInterval(iv);
  }, []);
  function fmtCronPA(s: number) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  useEffect(() => {
    tapi(`/${ticket.id}/pasos`, token).then((d) => {
      const ps: Paso[] = Array.isArray(d) ? d : (d as any).pasos ?? [];
      setPasos(ps);
      const first = ps.findIndex((p) => !pasoEstaCompletado(p));
      setPasoIdx(first >= 0 ? first : 0);
      setFase(ps.length === 0 ? "todo_ok" : "paso");
      setCargando(false);
    }).catch(() => { setCargando(false); setFase("paso"); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  const total = pasos.length;
  const hechos = pasos.filter((p) => pasoEstaCompletado(p)).length;
  const pct = total > 0 ? Math.round((hechos / total) * 100) : 0;
  const actual = pasos[pasoIdx];

  async function marcarHecho() {
    if (!actual || guardando || pasoEstaCompletado(actual)) return;
    setGuardando(true);
    try {
      if (nota.trim()) {
        await tapi(`/${ticket.id}/pasos/${actual.id}`, token, {
          method: "PUT", body: JSON.stringify({ notas: nota.trim() }),
        });
      }
      await tapi(`/${ticket.id}/pasos/${actual.id}`, token, {
        method: "PUT", body: JSON.stringify({ completado: 1 }),
      });
      const notaGuardada = nota.trim();
      setPasos((prev) => prev.map((p) =>
        p.id === actual.id ? { ...p, completado: 1, notas: notaGuardada || p.notas } : p
      ));
      setNota("");
      const nextIdx = pasoIdx + 1;
      if (nextIdx >= total) {
        try { await tapi(`/${ticket.id}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: "resuelto" }) }); } catch {}
        setFase("todo_ok");
      } else {
        setTimeout(() => { setSlideDir("right"); setPasoIdx(nextIdx); }, 300);
      }
    } catch {} finally { setGuardando(false); }
  }

  function saltar() {
    setNota("");
    const nextIdx = pasoIdx + 1;
    if (nextIdx >= total) { setFase("todo_ok"); return; }
    setSlideDir("right"); setPasoIdx(nextIdx);
  }
  function irAtras() {
    if (pasoIdx === 0) return;
    setNota(""); setSlideDir("left"); setPasoIdx(pasoIdx - 1);
  }

  if (cargando || fase === "cargando") return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4">
      <div className="h-10 w-10 rounded-full border-4 border-border border-t-accent animate-spin" />
      <p className="text-sm text-muted">Preparando revisión…</p>
    </div>
  );

  if (fase === "todo_ok") return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center px-4">
      <div className="relative">
        <div className="mck-bounce-in text-8xl select-none">🏆</div>
        <div className="absolute inset-0 rounded-full pointer-events-none"
          style={{ animation: "mck-ring-pulse 1s ease-out 0.3s both", background: "radial-gradient(circle, rgba(244,196,77,0.4) 0%, transparent 70%)" }} />
      </div>
      <div className="mck-slide-up space-y-2" style={{ animationDelay: "0.2s" }}>
        <h2 className="text-4xl font-extrabold text-ink">¡Órdenes revisadas!</h2>
        <p className="text-lg text-muted">{total} orden{total !== 1 ? "es" : ""} procesada{total !== 1 ? "s" : ""}</p>
        <div className="flex justify-center pt-1">
          <div className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1">
            <span className="text-sm">⏱</span>
            <span className="font-mono text-sm font-extrabold text-amber-700 tabular-nums">{fmtCronPA(seg)}</span>
          </div>
        </div>
      </div>
      <button onClick={onCompletado}
        className="mck-slide-up mt-4 rounded-2xl border-2 border-border px-8 py-3 text-base font-bold text-muted transition hover:border-accent hover:text-accent"
        style={{ animationDelay: "0.4s" }}>
        Ver ticket completo →
      </button>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-lg pb-8">
      <div className="mb-5 flex items-center justify-between">
        <button onClick={onSalir}
          className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent">
          ← Salir
        </button>
        <div className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/8 px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          <span className="font-mono text-sm font-extrabold text-accent tabular-nums">{fmtCronPA(seg)}</span>
        </div>
        <span className="text-xs font-bold text-muted">{pasoIdx + 1} / {total}</span>
      </div>

      <div className="mb-10 h-2.5 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent transition-all duration-700 ease-out"
          style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>

      <div key={`${pasoIdx}-${slideDir}`}
        className={slideDir === "right" ? "mck-slide-right" : "mck-slide-left"}>

        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-accent/70">
          Verificación de factura MeLi
        </p>

        <h2 className="text-[2rem] font-extrabold leading-tight text-ink mb-6">
          {actual?.descripcion || "Sin descripción"}
        </h2>

        {pasoEstaCompletado(actual) ? (
          <div className="mb-6 rounded-2xl border-2 border-green-400 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
            ✅ Ya verificado{actual?.notas ? ` · ${actual.notas}` : ""}
          </div>
        ) : (
          <div className="mb-6 space-y-2">
            <label className="text-xs font-bold uppercase tracking-wide text-muted">
              Nota del motivo <span className="normal-case font-normal">(opcional)</span>
            </label>
            <textarea
              className="w-full rounded-xl border-2 border-border bg-surface-input px-4 py-3 text-sm text-ink outline-none focus:border-accent resize-none placeholder:text-muted/40"
              placeholder="Ej: Factura pendiente en SIIGO, se creó manualmente y se subió a MeLi…"
              rows={3}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>
        )}

        <button
          disabled={guardando || pasoEstaCompletado(actual)}
          onClick={marcarHecho}
          className={`w-full rounded-2xl py-5 text-xl font-extrabold shadow-lg transition active:scale-95
            ${pasoEstaCompletado(actual)
              ? "bg-accent/30 text-white/60 cursor-default"
              : "bg-accent text-white hover:brightness-110"
            } disabled:opacity-60`}
        >
          {guardando ? "…" : pasoEstaCompletado(actual) ? "✓ Ya verificado" : "✓  ¡Verificado!"}
        </button>

        <div className="mt-4 flex gap-3">
          {pasoIdx > 0 && (
            <button onClick={irAtras}
              className="flex-1 rounded-xl border-2 border-border py-2.5 text-sm font-bold text-muted transition hover:border-accent/60 hover:text-accent">
              ← Atrás
            </button>
          )}
          {!pasoEstaCompletado(actual) && (
            <button onClick={saltar}
              className={`rounded-xl border-2 border-border py-2.5 text-sm font-bold text-muted/60 transition hover:border-accent/30 hover:text-muted ${pasoIdx > 0 ? "flex-1" : "w-full"}`}>
              Saltar →
            </button>
          )}
        </div>
      </div>
    </div>
  );
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
  const [pasoAPaso, setPasoAPaso] = useState(false);
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

  // Auto-lanzar modo paso a paso (solo tickets que no son acciones del operador)
  useEffect(() => {
    if (!loading && ticket && _autoStartPasoAPaso.has(ticket.id)) {
      _autoStartPasoAPaso.delete(ticket.id);
      if (ticket.tipo !== "accion") setPasoAPaso(true);
    }
  }, [loading, ticket]);

  if (loading) return <div className="py-16 text-center text-sm text-muted">Cargando quest...</div>;
  if (error || !ticket) return (
    <div className="space-y-3">
      <button onClick={onBack} className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition"><QuestBoardBackLabel /></button>
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || "No encontrado"}</div>
    </div>
  );

  if (pasoAPaso) return (
    <TicketPasoAPasoView
      token={token}
      ticket={ticket}
      onSalir={() => setPasoAPaso(false)}
      onCompletado={() => { setPasoAPaso(false); reload(); }}
    />
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
      {(ticket.pasos_total ?? 0) > 0 && ticketPermiteMarcarPasos(ticket) && ticket.tipo !== "accion" && (
        <button
          onClick={() => setPasoAPaso(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-accent bg-accent/8 px-5 py-3.5 text-sm font-extrabold text-accent transition hover:bg-accent hover:text-white active:scale-95"
        >
          <span className="text-base">▶</span> Resolver paso a paso
          <span className="ml-1 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-bold">
            {ticket.pasos_completados ?? 0}/{ticket.pasos_total ?? 0}
          </span>
        </button>
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
  const [tab, setTab] = useState<"usuarios" | "telefonos" | "roles" | "departamentos" | "categorias">("usuarios");
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
      telefono: (form.telefono || "").trim() || null,
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
        {(["usuarios", "telefonos", "roles", "departamentos", "categorias"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-paper border-2 px-4 py-1.5 text-sm font-bold capitalize transition
              ${tab === t ? "border-accent bg-surface-hover text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t === "usuarios" ? "👤 Usuarios"
              : t === "telefonos" ? "📱 Teléfonos WA"
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
      ) : tab === "telefonos" ? (
        <TelefonosOperadoresSection compact />
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
                <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted">
                  <span>{u.rol?.nombre}</span>·<span style={{ color: u.departamento?.color }}>{u.departamento?.nombre}</span>
                  {u.telefono ? (
                    <span className="font-mono text-emerald-600">📱 {u.telefono}</span>
                  ) : (
                    <span className="text-amber-600">Sin teléfono WA</span>
                  )}
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
                  <Field
                    label="WhatsApp (notas de voz)"
                    value={form.telefono || ""}
                    onChange={(v) => setForm({ ...form, telefono: v })}
                  />
                  <p className="mt-0.5 text-[10px] text-muted">
                    Colombia: 10 dígitos o 57… — también en Ajustes → Teléfonos
                  </p>
                </div>
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
                    { id: "fichas",    label: "Fichas técnicas" },
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
  completado: number | boolean; completado_en: string | null;
  completado_por?: number | null; completado_por_nombre: string | null;
  intervencion_pendiente_numero?: string | null;
  intervencion_asignado_nombre?: string | null;
  respuesta_intervencion?: string | null;
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

  // ── Modo Simple (wizard) ──────────────────────────────────────────────────
  const [modoSimple, setModoSimple] = useState(true);
  const [pasoSimple, setPasoSimple] = useState(1);
  const [wizardDir, setWizardDir] = useState<"right" | "left">("right");
  const [tituloSimple, setTituloSimple] = useState("");
  const [descSimple, setDescSimple] = useState("");
  const [frecSimple, setFrecSimple] = useState<"" | "unica" | "diaria" | "semanal" | "mensual">("");

  // Pasos del wizard — cada paso = un checklist item con descripción + materiales
  type MatSimple = { n: string; c: string };
  type PasoSimple = { nombre: string; desc: string; mats: MatSimple[] };
  const [pasosSimples, setPasosSimples] = useState<PasoSimple[]>([]);
  const [pasoNombre, setPasoNombre] = useState("");
  const [pasoDesc, setPasoDesc] = useState("");
  const [pasoMats, setPasoMats] = useState<MatSimple[]>([]);
  const [showMatsWizard, setShowMatsWizard] = useState(false);
  const [editandoPasoIdx, setEditandoPasoIdx] = useState<number | null>(null);

  function buildNotasPaso(p: PasoSimple): string {
    const partes: string[] = [];
    if (p.desc.trim()) partes.push(p.desc.trim());
    const matsOk = p.mats.filter((m) => m.n.trim());
    if (matsOk.length > 0)
      partes.push("📦 Materiales:\n" + matsOk.map((m) => `${m.n.trim()}: ${m.c.trim() || "—"}`).join("\n"));
    return partes.join("\n\n");
  }

  function iniciarEditarPaso(idx: number) {
    const p = pasosSimples[idx];
    setPasoNombre(p.nombre); setPasoDesc(p.desc);
    setPasoMats(p.mats.length ? p.mats : []);
    setShowMatsWizard(p.mats.length > 0);
    setEditandoPasoIdx(idx);
  }

  function cancelarEdicion() {
    setPasoNombre(""); setPasoDesc(""); setPasoMats([]); setShowMatsWizard(false); setEditandoPasoIdx(null);
  }

  function guardarPasoActual(crear = false) {
    if (!pasoNombre.trim()) { setError("Escribe el nombre del paso"); return; }
    setError("");
    const p: PasoSimple = { nombre: pasoNombre.trim(), desc: pasoDesc.trim(), mats: pasoMats.filter((m) => m.n.trim()) };
    let lista: PasoSimple[];
    if (editandoPasoIdx !== null) {
      lista = pasosSimples.map((x, i) => i === editandoPasoIdx ? p : x);
      setPasosSimples(lista); setEditandoPasoIdx(null);
    } else {
      lista = [...pasosSimples, p];
      setPasosSimples(lista);
    }
    setPasoNombre(""); setPasoDesc(""); setPasoMats([]); setShowMatsWizard(false);
    if (crear) submitSimpleConPasos(lista);
  }

  async function submitSimpleConPasos(pasos: PasoSimple[]) {
    setError("");
    if (!tituloSimple.trim()) { setError("Escribe el nombre de la misión"); return; }
    if (!frecSimple) { setError("Elige cada cuánto se repite"); return; }
    const pasosOk = pasos.filter((p) => p.nombre.trim());
    if (pasosOk.length === 0) { setError("Define al menos un paso"); return; }
    setLoading(true);
    try {
      const esRecurrente = frecSimple !== "unica";
      const m = await tapi("/misiones/", token, {
        method: "POST",
        body: JSON.stringify({
          titulo: tituloSimple.trim(),
          descripcion: descSimple.trim(),
          tipo: "secuencial",
          color: "#0c6069",
          modo_ciclo: esRecurrente ? "infinita" : "finita",
          reino: "Sin clasificar",
          etapas: [{
            titulo: tituloSimple.trim(),
            descripcion: descSimple.trim(),
            pasos: pasosOk.map((p) => ({ descripcion: p.nombre, notas: buildNotasPaso(p) })),
            frecuencia: esRecurrente ? frecSimple : null,
            materiales: [],
          }],
          asignaciones: {},
        }),
      });
      onCreated(m.id);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  }

  async function submitSimple() {
    const extra: PasoSimple[] = pasoNombre.trim()
      ? [{ nombre: pasoNombre.trim(), desc: pasoDesc.trim(), mats: pasoMats.filter((m) => m.n.trim()) }]
      : [];
    submitSimpleConPasos([...pasosSimples, ...extra]);
  }

  if (modoSimple) return (
    <div className="mx-auto w-full max-w-lg pb-10">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <button onClick={onBack} className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent">← Volver</button>
        <button onClick={() => setModoSimple(false)} className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent">
          ⚙️ Vista avanzada
        </button>
      </div>

      {/* Indicador de pasos */}
      <div className="mb-8 flex items-center gap-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className={`h-2 flex-1 rounded-full transition-all ${n <= pasoSimple ? "bg-accent" : "bg-border"}`} />
        ))}
      </div>

      {error && <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      {/* PASO 1 — Nombre */}
      {pasoSimple === 1 && (
        <div key="paso1" className={`space-y-6 ${wizardDir === "right" ? "mck-slide-right" : "mck-slide-left"}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">Paso 1 de 3</p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">¿Cómo se llama<br/>esta misión?</h2>
          </div>
          <input
            autoFocus
            className="w-full rounded-2xl border-2 border-border bg-surface-input px-5 py-4 text-xl font-semibold text-ink outline-none focus:border-accent placeholder:text-muted/50"
            placeholder="Ej: Elaborar Masa Madre"
            value={tituloSimple}
            onChange={(e) => setTituloSimple(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && tituloSimple.trim()) { setWizardDir("right"); setPasoSimple(2); } }}
            maxLength={150}
          />
          <textarea
            className="w-full rounded-2xl border-2 border-border bg-surface-input px-5 py-3 text-base text-ink outline-none focus:border-accent resize-none placeholder:text-muted/50"
            placeholder="Descripción breve (opcional)"
            rows={2}
            value={descSimple}
            onChange={(e) => setDescSimple(e.target.value)}
          />
          <button
            disabled={!tituloSimple.trim()}
            onClick={() => { setError(""); setWizardDir("right"); setPasoSimple(2); }}
            className="w-full rounded-2xl bg-accent py-4 text-lg font-extrabold text-white transition hover:brightness-110 disabled:opacity-40">
            Siguiente →
          </button>
        </div>
      )}

      {/* PASO 2 — Frecuencia */}
      {pasoSimple === 2 && (
        <div key="paso2" className={`space-y-6 ${wizardDir === "right" ? "mck-slide-right" : "mck-slide-left"}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">Paso 2 de 3</p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">¿Cada cuánto<br/>lo vas a hacer?</h2>
          </div>
          <div className="space-y-3">
            {([
              { key: "unica",    icon: "☑️",  label: "Una sola vez",    desc: "Se hace una vez y listo" },
              { key: "diaria",   icon: "🌅",  label: "Todos los días",  desc: "Se repite cada día" },
              { key: "semanal",  icon: "📆",  label: "Cada semana",     desc: "Se repite semanalmente" },
              { key: "mensual",  icon: "🗓️", label: "Cada mes",        desc: "Se repite mensualmente" },
            ] as const).map(({ key, icon, label, desc }) => (
              <button
                key={key}
                onClick={() => { setFrecSimple(key); setError(""); setWizardDir("right"); setPasoSimple(3); }}
                className={`w-full flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition
                  ${frecSimple === key ? "border-accent bg-accent/10" : "border-border bg-surface-panel hover:border-accent/60"}`}
              >
                <span className="text-3xl">{icon}</span>
                <div>
                  <p className="text-base font-extrabold text-ink">{label}</p>
                  <p className="text-xs text-muted">{desc}</p>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => { setWizardDir("left"); setPasoSimple(1); }} className="w-full rounded-2xl border-2 border-border py-3 text-sm font-bold text-muted transition hover:border-accent hover:text-accent">
            ← Atrás
          </button>
        </div>
      )}

      {/* PASO 3 — Definir pasos uno a uno */}
      {pasoSimple === 3 && (
        <div key="paso3" className={`space-y-5 ${wizardDir === "right" ? "mck-slide-right" : "mck-slide-left"}`}>
          {/* Cabecera */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">Paso 3 de 3</p>
            <h2 className="text-2xl font-extrabold text-ink leading-tight">Define los pasos<br/>de tu misión</h2>
          </div>

          {/* Pasos ya guardados */}
          {pasosSimples.length > 0 && (
            <div className="space-y-2">
              {pasosSimples.map((p, i) => (
                <div key={i} className={`mck-slide-up flex items-center gap-3 rounded-2xl border-2 px-4 py-2.5 transition
                  ${editandoPasoIdx === i ? "border-accent bg-accent/8" : "border-border bg-surface-panel"}`}
                  style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink">{p.nombre}</p>
                    {(p.desc || p.mats.length > 0) && (
                      <p className="truncate text-xs text-muted">
                        {p.desc && <span>{p.desc.slice(0, 40)}{p.desc.length > 40 ? "…" : ""}</span>}
                        {p.mats.length > 0 && <span className="ml-1 text-accent/70">· {p.mats.length} material{p.mats.length !== 1 ? "es" : ""}</span>}
                      </p>
                    )}
                  </div>
                  <button onClick={() => iniciarEditarPaso(i)}
                    className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted transition hover:border-accent hover:text-accent">✏️</button>
                  <button onClick={() => { setPasosSimples((ps) => ps.filter((_, j) => j !== i)); if (editandoPasoIdx === i) cancelarEdicion(); }}
                    className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted transition hover:border-danger hover:text-danger">✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Editor del paso actual */}
          <div className="rounded-2xl border-2 border-accent/40 bg-surface-panel p-4 space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-accent">
              {editandoPasoIdx !== null ? `Editando paso ${editandoPasoIdx + 1}` : `Paso ${pasosSimples.length + 1}`}
            </p>

            {/* Nombre del paso */}
            <div>
              <label className="mb-1.5 block text-xs font-bold text-muted uppercase tracking-wide">¿Qué se hace aquí?</label>
              <input
                autoFocus
                className="w-full rounded-xl border-2 border-border bg-surface-input px-4 py-3 text-base font-semibold text-ink outline-none focus:border-accent placeholder:text-muted/40"
                placeholder="Ej: Pesar los ingredientes"
                value={pasoNombre}
                maxLength={120}
                onChange={(e) => setPasoNombre(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && pasoNombre.trim()) e.currentTarget.blur(); }}
              />
            </div>

            {/* Descripción */}
            <div>
              <label className="mb-1.5 block text-xs font-bold text-muted uppercase tracking-wide">Descripción <span className="normal-case font-normal">(opcional)</span></label>
              <textarea
                className="w-full rounded-xl border-2 border-border bg-surface-input px-4 py-2.5 text-sm text-ink outline-none focus:border-accent resize-none placeholder:text-muted/40"
                placeholder="Detalla cómo se hace este paso…"
                rows={2}
                value={pasoDesc}
                onChange={(e) => setPasoDesc(e.target.value)}
              />
            </div>

            {/* Materiales accordion */}
            <div>
              <button
                type="button"
                onClick={() => { setShowMatsWizard((v) => !v); if (!showMatsWizard && pasoMats.length === 0) setPasoMats([{ n: "", c: "" }]); }}
                className="flex items-center gap-2 text-sm font-bold text-accent transition hover:text-accent/70">
                <span className={`transition-transform ${showMatsWizard ? "rotate-90" : ""}`}>▶</span>
                📦 Añadir materiales
              </button>
              {showMatsWizard && (
                <div className="mt-3 space-y-2 mck-slide-up">
                  {pasoMats.map((m, mi) => (
                    <div key={mi} className="flex gap-2">
                      <input
                        className="flex-[2] rounded-xl border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/40"
                        placeholder="Ingrediente / material"
                        value={m.n}
                        onChange={(e) => setPasoMats((ms) => ms.map((x, j) => j === mi ? { ...x, n: e.target.value } : x))}
                      />
                      <input
                        className="flex-1 rounded-xl border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/40"
                        placeholder="Cantidad"
                        value={m.c}
                        onChange={(e) => setPasoMats((ms) => ms.map((x, j) => j === mi ? { ...x, c: e.target.value } : x))}
                      />
                      <button onClick={() => setPasoMats((ms) => ms.filter((_, j) => j !== mi))}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-border text-muted transition hover:border-danger hover:text-danger">✕</button>
                    </div>
                  ))}
                  <button onClick={() => setPasoMats((ms) => [...ms, { n: "", c: "" }])}
                    className="flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
                    + Agregar material
                  </button>
                </div>
              )}
            </div>

            {/* Botones del editor */}
            <div className="flex gap-2 pt-1">
              {editandoPasoIdx !== null && (
                <button onClick={cancelarEdicion}
                  className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent">
                  Cancelar
                </button>
              )}
              <button
                disabled={!pasoNombre.trim()}
                onClick={() => guardarPasoActual(false)}
                className="flex-1 rounded-xl border-2 border-accent/60 py-2.5 text-sm font-extrabold text-accent transition hover:bg-accent/10 disabled:opacity-40">
                {editandoPasoIdx !== null ? "✓ Guardar cambios" : `✓ Guardar · agregar otro`}
              </button>
            </div>
          </div>

          {/* Botones finales */}
          <div className="flex gap-3">
            <button onClick={() => { setWizardDir("left"); setPasoSimple(2); cancelarEdicion(); }}
              className="rounded-2xl border-2 border-border px-4 py-3 text-sm font-bold text-muted transition hover:border-accent hover:text-accent">
              ← Atrás
            </button>
            <button
              disabled={loading || (pasosSimples.length === 0 && !pasoNombre.trim())}
              onClick={submitSimple}
              className="flex-1 rounded-2xl bg-accent py-3 text-base font-extrabold text-white transition hover:brightness-110 disabled:opacity-40">
              {loading ? "Creando…" : "✅ Crear misión"}
            </button>
          </div>
          {pasosSimples.length === 0 && !pasoNombre.trim() && (
            <p className="text-center text-xs text-muted">Guarda al menos un paso antes de crear</p>
          )}
        </div>
      )}
    </div>
  );

  // ── Modo Avanzado ─────────────────────────────────────────────────────────
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
          <button
            onClick={() => setModoSimple(true)}
            className="rounded-full border border-border bg-surface-panel px-3 py-1 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
            ✨ Vista simple
          </button>
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

// ── Modo Enfocado (Duolingo-style, una tarea a la vez) ────────────────────
function MisionFocusMode({
  token, user, mision, onSalir, onMisionUpdated,
}: {
  token: string; user: TicketsUser; mision: Mision;
  onSalir: () => void; onMisionUpdated: (m: Mision) => void;
}) {
  const etapasActivas = (mision.etapas || []).filter((e) => e.ticket_id);

  // Estado de carga de todos los pasos de todos los tickets
  type PasoItem = { ticketId: number; ticketTitulo: string; pasoId: number; desc: string; notas: string; completado: boolean; esUltimoDeTarea: boolean };
  const [allPasos, setAllPasos] = useState<PasoItem[]>([]);
  const [cargandoInit, setCargandoInit] = useState(true);
  const [pasoIdx, setPasoIdx] = useState(0);
  const [fase, setFase] = useState<"cargando" | "paso" | "tarea_ok" | "todo_ok">("cargando");
  const [slideDir, setSlideDir] = useState<"right" | "left">("right");
  const [marcando, setMarcando] = useState(false);

  // ── Cronómetro de toda la misión ──────────────────────────────────────────
  const t0Mision = useRef(Date.now());
  const [segMision, setSegMision] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSegMision(Math.floor((Date.now() - t0Mision.current) / 1000)), 500);
    return () => clearInterval(iv);
  }, []);
  function fmtCron(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  // Cargar todos los pasos al montar
  useEffect(() => {
    (async () => {
      const items: PasoItem[] = [];
      for (const et of etapasActivas) {
        if (!et.ticket_id) continue;
        try {
          const data = await tapi(`/${et.ticket_id}/pasos`, token);
          const pasos: Paso[] = Array.isArray(data) ? data : (data as any).pasos ?? [];
          pasos.forEach((p, i) => items.push({
            ticketId: et.ticket_id!,
            ticketTitulo: et.titulo,
            pasoId: p.id,
            desc: p.descripcion,
            notas: (p as any).notas ?? "",
            completado: !!p.completado,
            esUltimoDeTarea: i === pasos.length - 1,
          }));
        } catch {}
      }
      setAllPasos(items);
      // Encontrar primer paso no completado
      const first = items.findIndex((p) => !p.completado);
      setPasoIdx(first >= 0 ? first : 0);
      setFase(items.length === 0 ? "todo_ok" : "paso");
      setCargandoInit(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mision.id]);

  const total = allPasos.length;
  const hechos = allPasos.filter((p) => p.completado).length;
  const pct = total > 0 ? Math.round((hechos / total) * 100) : 0;
  const actual = allPasos[pasoIdx];

  async function marcarHecho() {
    if (!actual || marcando) return;
    setMarcando(true);
    try {
      const data = await tapi(`/${actual.ticketId}/pasos/${actual.pasoId}`, token, {
        method: "PUT", body: JSON.stringify({ completado: 1 }),
      });
      // Actualizar estado local
      const _pasos: Paso[] = Array.isArray(data) ? data : (data as any).pasos ?? [];
      void _pasos;
      setAllPasos((prev) => prev.map((p) =>
        p.pasoId === actual.pasoId ? { ...p, completado: true } : p
      ));
      const nextIdx = pasoIdx + 1;
      const eraUltimaDelTicket = actual.esUltimoDeTarea;
      const eraElUltimo = nextIdx >= total;

      if (eraElUltimo) {
        // Resolver el último ticket también
        try {
          await tapi(`/${actual.ticketId}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: "resuelto" }) });
          tapi(`/misiones/${mision.id}`, token).then(onMisionUpdated).catch(() => {});
        } catch {}
        setFase("todo_ok");
      } else if (eraUltimaDelTicket) {
        // Resolver el ticket actual
        try {
          await tapi(`/${actual.ticketId}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: "resuelto" }) });
        } catch {}
        setFase("tarea_ok");
        setTimeout(() => {
          setSlideDir("right");
          setPasoIdx(nextIdx);
          setFase("paso");
        }, 1800);
      } else {
        // Siguiente paso del mismo ticket
        setTimeout(() => {
          setSlideDir("right");
          setPasoIdx(nextIdx);
        }, 300);
      }
    } catch {} finally { setMarcando(false); }
  }

  async function saltarPaso() {
    const nextIdx = pasoIdx + 1;
    if (nextIdx >= total) { setFase("todo_ok"); return; }
    setSlideDir("right");
    setPasoIdx(nextIdx);
  }

  function irAtras() {
    if (pasoIdx === 0) return;
    setSlideDir("left");
    setPasoIdx(pasoIdx - 1);
  }

  // ── Pantalla: cargando ──
  if (cargandoInit || fase === "cargando") return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4">
      <div className="h-10 w-10 rounded-full border-4 border-border border-t-accent animate-spin" />
      <p className="text-sm text-muted">Preparando misión…</p>
    </div>
  );

  // Widget cronómetro reutilizable (visible en todas las pantallas activas)
  const CronWidget = () => (
    <div className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/8 px-3 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
      <span className="font-mono text-sm font-extrabold text-accent tabular-nums">{fmtCron(segMision)}</span>
    </div>
  );

  // ── Pantalla: todo ok 🏆 ──
  if (fase === "todo_ok") return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center px-4">
      <div className="relative">
        <div className="mck-bounce-in text-8xl select-none">🏆</div>
        <div className="absolute inset-0 rounded-full pointer-events-none"
          style={{ animation: "mck-ring-pulse 1s ease-out 0.3s both", background: "radial-gradient(circle, rgba(244,196,77,0.4) 0%, transparent 70%)" }} />
      </div>
      <div className="mck-slide-up space-y-2" style={{ animationDelay: "0.2s" }}>
        <h2 className="text-4xl font-extrabold text-ink">¡Misión completada!</h2>
        <p className="text-lg text-muted">{mision.titulo}</p>
        <p className="text-sm text-muted">{total} paso{total !== 1 ? "s" : ""} completado{total !== 1 ? "s" : ""}</p>
        <div className="flex justify-center pt-1">
          <div className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1">
            <span className="text-sm">⏱</span>
            <span className="font-mono text-sm font-extrabold text-amber-700 tabular-nums">{fmtCron(segMision)}</span>
          </div>
        </div>
      </div>
      <button onClick={onSalir}
        className="mck-slide-up mt-4 rounded-2xl border-2 border-border px-8 py-3 text-base font-bold text-muted transition hover:border-accent hover:text-accent"
        style={{ animationDelay: "0.4s" }}>
        Ver misión completa →
      </button>
    </div>
  );

  // ── Pantalla: tarea completada ──
  if (fase === "tarea_ok") return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 text-center px-4">
      <div className="flex w-full justify-end px-4 pt-2">
        <CronWidget />
      </div>
      <div className="relative">
        <div className="mck-celebrate text-7xl select-none">✅</div>
        <div className="absolute inset-0 rounded-full pointer-events-none"
          style={{ animation: "mck-ring-pulse 0.8s ease-out both", background: "radial-gradient(circle, rgba(74,154,106,0.35) 0%, transparent 70%)" }} />
      </div>
      <div className="mck-slide-up space-y-1" style={{ animationDelay: "0.15s" }}>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">¡Tarea completada!</p>
        <h3 className="text-2xl font-extrabold text-ink">{actual?.ticketTitulo}</h3>
      </div>
      <p className="mck-slide-up text-sm text-muted" style={{ animationDelay: "0.3s" }}>Preparando el siguiente paso…</p>
    </div>
  );

  // ── Pantalla: un paso ──
  return (
    <div className="mx-auto w-full max-w-lg pb-8">
      {/* Header con cronómetro de misión */}
      <div className="mb-5 flex items-center justify-between">
        <button onClick={onSalir}
          className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent">
          ← Salir
        </button>
        <CronWidget />
        <span className="text-xs font-bold text-muted">{pasoIdx + 1} / {total}</span>
      </div>

      {/* Barra de progreso */}
      <div className="mb-10 h-2.5 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent transition-all duration-700 ease-out"
          style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>

      {/* Contenido del paso */}
      <div key={`${pasoIdx}-${slideDir}`}
        className={slideDir === "right" ? "mck-slide-right" : "mck-slide-left"}>

        {/* Nombre de tarea (pequeño, contexto) */}
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-accent/70">
          {actual?.ticketTitulo}
        </p>

        {/* El paso en grande */}
        <h2 className="text-[2rem] font-extrabold leading-tight text-ink">
          {actual?.desc || "Sin descripción"}
        </h2>

        {/* Descripción + materiales de las notas */}
        {actual?.notas && (() => {
          const partes = actual.notas.split(/\n\n📦 Materiales:\n/);
          const descNota = partes[0]?.trim();
          const matsRaw = partes[1]?.trim();
          const matItems = matsRaw
            ? matsRaw.split("\n").filter(Boolean).map((l) => {
                const idx = l.indexOf(": ");
                return idx >= 0
                  ? { n: l.slice(0, idx).trim(), c: l.slice(idx + 2).trim() }
                  : { n: l.trim(), c: "—" };
              })
            : [];
          return (
            <div className="mt-5 mb-8 space-y-4">
              {descNota && (
                <p className="text-base text-muted leading-relaxed">{descNota}</p>
              )}
              {matItems.length > 0 && (
                <div className="overflow-hidden rounded-2xl border-2 border-accent/25 bg-surface-panel">
                  {/* Header */}
                  <div className="flex items-center gap-2 border-b border-accent/20 bg-accent/8 px-5 py-3">
                    <span className="text-lg">📦</span>
                    <span className="text-xs font-extrabold uppercase tracking-widest text-accent">
                      Materiales · {matItems.length} ítem{matItems.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {/* Lista */}
                  <ul className="divide-y divide-border">
                    {matItems.map((m, li) => (
                      <li key={li} className="flex items-center gap-4 px-5 py-4">
                        {/* Número */}
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-extrabold text-accent">
                          {li + 1}
                        </span>
                        {/* Nombre */}
                        <span className="flex-1 text-base font-bold text-ink leading-tight">
                          {m.n}
                        </span>
                        {/* Cantidad */}
                        <span className="shrink-0 rounded-xl border-2 border-accent/30 bg-accent/8 px-3 py-1.5 text-sm font-extrabold text-accent tabular-nums">
                          {m.c}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
        {!actual?.notas && <div className="mb-6" />}

        {/* Botón principal */}
        <button
          disabled={marcando || actual?.completado}
          onClick={marcarHecho}
          className={`w-full rounded-2xl py-5 text-xl font-extrabold shadow-lg transition active:scale-95
            ${actual?.completado
              ? "bg-accent/30 text-white/60 cursor-default"
              : "bg-accent text-white hover:brightness-110"
            } disabled:opacity-60`}
        >
          {marcando ? "…" : actual?.completado ? "✓ Ya completado" : "✓  ¡Listo!"}
        </button>

        {/* Botones secundarios */}
        <div className="mt-4 flex gap-3">
          {pasoIdx > 0 && (
            <button onClick={irAtras}
              className="flex-1 rounded-xl border-2 border-border py-2.5 text-sm font-bold text-muted transition hover:border-accent/60 hover:text-accent">
              ← Atrás
            </button>
          )}
          <button onClick={saltarPaso}
            className={`rounded-xl border-2 border-border py-2.5 text-sm font-bold text-muted/60 transition hover:border-accent/30 hover:text-muted ${pasoIdx > 0 ? "flex-1" : "w-full"}`}>
            Saltar →
          </button>
        </div>
      </div>
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
  const esOrquestador = user.username === "admin" || (user.email ?? "").toLowerCase().includes("mckenna.group.colombia");
  const [modoFocus, setModoFocus] = useState(false);

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

  // Modo Enfocado — pantalla completa, una tarea a la vez
  if (modoFocus) return (
    <MisionFocusMode
      token={token} user={user} mision={mision}
      onSalir={() => setModoFocus(false)}
      onMisionUpdated={setMision}
    />
  );

  // Nivel 1: vista simplificada (sólo botón Comenzar)
  if (nivel < 2) {
    const totalPasos = etapas.reduce((n, e) => n + (e.ticket_pasos_total ?? 0), 0);
    const hechosPasos = etapas.reduce((n, e) => n + (e.ticket_pasos_completados ?? 0), 0);
    const pct = totalPasos > 0 ? Math.round((hechosPasos / totalPasos) * 100) : 0;
    // Misión completada: estado explícito O todos los pasos hechos O todas las etapas resueltas
    const etapasCompletadas = (mision as any).etapas_completadas ?? 0;
    const totalEtapas = (mision as any).total_etapas ?? etapas.length;
    const estaCompleta = mision.estado === "completada"
      || (totalPasos > 0 && hechosPasos >= totalPasos)
      || (totalEtapas > 0 && etapasCompletadas >= totalEtapas && etapas.every((e) => e.ticket_estado === "resuelto"));
    const segsMision = (mision as any).total_segundos_mision ?? 0;
    const fechaCompletada = mision.completada_en
      ? new Date(mision.completada_en).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })
      : null;

    // ── Vista: misión completada ──────────────────────────────────────────
    if (estaCompleta) return (
      <div className="mx-auto flex min-h-[80vh] w-full max-w-lg flex-col items-center justify-center gap-7 px-4 text-center">
        <div className="relative">
          <div className="mck-bounce-in text-8xl select-none">🏆</div>
          <div className="absolute inset-0 rounded-full pointer-events-none"
            style={{ animation: "mck-ring-pulse 1.2s ease-out 0.4s both", background: "radial-gradient(circle, rgba(244,196,77,0.35) 0%, transparent 70%)" }} />
        </div>

        <div className="mck-slide-up space-y-2" style={{ animationDelay: "0.15s" }}>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">Misión completada</p>
          <h1 className="text-3xl font-extrabold text-ink">{mision.titulo}</h1>
        </div>

        {/* Stats */}
        <div className="mck-slide-up w-full rounded-2xl border border-border bg-surface-panel px-6 py-5 space-y-3" style={{ animationDelay: "0.25s" }}>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Pasos completados</span>
            <span className="font-extrabold text-ink">{hechosPasos} de {totalPasos}</span>
          </div>
          {segsMision > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">Tiempo total</span>
              <span className="font-extrabold text-ink">
                {segsMision >= 3600
                  ? `${Math.floor(segsMision / 3600)}h ${Math.floor((segsMision % 3600) / 60)}min`
                  : `${Math.floor(segsMision / 60)}min`}
              </span>
            </div>
          )}
          {fechaCompletada && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">Última vez</span>
              <span className="font-extrabold text-ink">{fechaCompletada}</span>
            </div>
          )}
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full w-full rounded-full bg-emerald-500" />
          </div>
        </div>

        {/* Botones */}
        {!esOrquestador && (
          <button
            className="mck-slide-up w-full rounded-2xl bg-accent py-5 text-xl font-extrabold text-white shadow-lg transition hover:brightness-110 active:scale-95"
            style={{ animationDelay: "0.35s" }}
            onClick={async () => {
              try {
                const res = await tapi(`/misiones/${misionId}/renovar`, token, { method: "POST" });
                setMision(res.mision);
                setModoFocus(true);
              } catch (e: any) { alert(e.message); }
            }}>
            🚀 Volver a hacer la misión
          </button>
        )}
        <button onClick={onBack}
          className="mck-slide-up text-sm font-bold text-muted transition hover:text-accent"
          style={{ animationDelay: "0.45s" }}>
          ← Volver
        </button>
      </div>
    );

    // ── Vista: misión activa (en progreso o sin iniciar) ──────────────────
    return (
      <div className="mx-auto w-full max-w-lg space-y-8 py-6 px-2">
        <button onClick={onBack}
          className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent">
          ← Volver
        </button>
        <div className="mck-slide-up space-y-3 text-center">
          <div className="text-6xl select-none mck-bounce-in"
            style={{ filter: `drop-shadow(0 4px 12px ${mision.color}66)` }}>
            🎯
          </div>
          <h1 className="text-3xl font-extrabold text-ink">{mision.titulo}</h1>
          {mision.descripcion && <p className="text-base text-muted">{mision.descripcion}</p>}
        </div>
        {totalPasos > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-muted">
              <span>{hechosPasos} de {totalPasos} pasos</span>
              <span>{pct}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-accent transition-all duration-700"
                style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
          </div>
        )}
        <button
          onClick={() => setModoFocus(true)}
          className="w-full rounded-2xl bg-accent py-5 text-xl font-extrabold text-white shadow-lg transition hover:brightness-110 active:scale-95">
          {pct > 0 ? "▶ Continuar misión" : "🎯 Comenzar misión"}
        </button>
      </div>
    );
  }

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
              {nivel >= 1 && !esOrquestador && (
                <button
                  disabled={renewing}
                  onClick={async () => {
                    if (!confirm(`¿Iniciar un nuevo ciclo de "${mision.titulo}"?\n\nCada ticket vuelve a quedar activo con su checklist en blanco.\nEl historial y registros anteriores se conservan.`)) return;
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
                  {renewing ? "Iniciando..." : "🚀 Iniciar misión"}
                </button>
              )}
              {etapas.filter((e) => e.ticket_id).length > 0 && (
                <button
                  onClick={() => setModoFocus(true)}
                  className="rounded-paper border-2 border-accent px-3 py-1.5 text-sm font-bold text-accent transition hover:bg-accent hover:text-white">
                  🎯 Modo enfocado
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
                Misión recurrente: agrega tickets o usa 🚀 Iniciar misión para comenzar un nuevo ciclo.
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
function WorkloadView({
  token, user, onBack, onAdministracion,
}: {
  token: string;
  user: TicketsUser;
  onBack: () => void;
  onAdministracion?: () => void;
}) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showNuevo, setShowNuevo] = useState(false);
  const [roles, setRoles] = useState<{ id: number; nombre: string; nivel: number }[]>([]);
  const [depts, setDepts] = useState<{ id: number; nombre: string; color?: string }[]>([]);
  const [tareas, setTareas] = useState<{ slug: string; nombre: string }[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<string, { usuario_id: number | null }>>({});
  const [savingAsign, setSavingAsign] = useState<string | null>(null);
  const [deptForm, setDeptForm] = useState({ nombre: "", descripcion: "", color: "#0c6069" });
  const [deptError, setDeptError] = useState("");
  const [deptSaving, setDeptSaving] = useState(false);
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
  const isAdmin = nivel >= 3;

  const reload = useCallback(() => {
    setLoading(true);
    return tapi("/dashboard/carga", token)
      .then((d) => setData(Array.isArray(d) ? d : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if ((!showNuevo && !isAdmin) || !canManageAliados) return;
    Promise.all([tapi("/roles", token), tapi("/departamentos", token)])
      .then(([rs, ds]) => {
        setRoles(Array.isArray(rs) ? rs : []);
        setDepts(Array.isArray(ds) ? ds : []);
      })
      .catch(() => {});
  }, [showNuevo, canManageAliados, isAdmin, token]);

  useEffect(() => {
    if (!canManageAliados) return;
    tapi("/aliados/asignaciones", token)
      .then((d) => {
        setTareas(Array.isArray(d?.tareas) ? d.tareas : []);
        const raw = d?.asignaciones && typeof d.asignaciones === "object" ? d.asignaciones : {};
        const norm: Record<string, { usuario_id: number | null }> = {};
        for (const k of Object.keys(raw)) {
          const uid = raw[k]?.usuario_id;
          norm[k] = { usuario_id: typeof uid === "number" ? uid : null };
        }
        setAsignaciones(norm);
      })
      .catch(() => {});
  }, [canManageAliados, token]);

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

  async function guardarAsignacion(tarea_slug: string, usuario_id: number | null) {
    if (!isAdmin) {
      alert("Solo un Administrador puede cambiar asignaciones.");
      return;
    }
    setSavingAsign(tarea_slug);
    try {
      await tapi("/aliados/asignaciones", token, {
        method: "PUT",
        body: JSON.stringify({ tarea_slug, usuario_id }),
      });
      setAsignaciones((a) => ({ ...a, [tarea_slug]: { usuario_id } }));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "No se pudo guardar la asignación.");
    } finally {
      setSavingAsign(null);
    }
  }

  async function crearDepartamento() {
    if (!isAdmin) return;
    if (!deptForm.nombre.trim()) {
      setDeptError("Nombre requerido.");
      return;
    }
    setDeptSaving(true);
    setDeptError("");
    try {
      const nuevo = await tapi("/departamentos", token, {
        method: "POST",
        body: JSON.stringify({
          nombre: deptForm.nombre.trim(),
          descripcion: deptForm.descripcion.trim(),
          color: deptForm.color || "#0c6069",
        }),
      });
      setDepts((ds) => [...ds, nuevo].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))));
      setDeptForm({ nombre: "", descripcion: "", color: "#0c6069" });
    } catch (e: unknown) {
      setDeptError(e instanceof Error ? e.message : "No se pudo crear el departamento.");
    } finally {
      setDeptSaving(false);
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
        <div className="flex flex-wrap gap-2">
          {onAdministracion && (
            <button
              type="button"
              onClick={onAdministracion}
              className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
            >
              ⚙ Administración
            </button>
          )}
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

      {/* ── Asignación de labores ─────────────────────────────────────────── */}
      {canManageAliados && (
        <div className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-ink">Asignación de labores</h3>
              <p className="text-[11px] text-muted">
                Define a qué aliado se le asignan automáticamente ciertas acciones del sistema.
              </p>
            </div>
            {!isAdmin && (
              <span className="rounded-full bg-surface-hover px-2 py-1 text-[11px] font-bold text-muted">
                Solo lectura (requiere admin)
              </span>
            )}
          </div>
          {tareas.length === 0 ? (
            <p className="text-xs text-muted">No hay tareas configuradas.</p>
          ) : (
            <div className="grid gap-3">
              {tareas.map((t) => {
                const cur = asignaciones[t.slug]?.usuario_id ?? null;
                return (
                  <div key={t.slug} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-ink truncate">{t.nombre}</p>
                      <p className="text-[10px] text-muted font-mono">{t.slug}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={cur ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          const next = v ? Number(v) : null;
                          setAsignaciones((a) => ({ ...a, [t.slug]: { usuario_id: next } }));
                        }}
                        disabled={!isAdmin}
                        className="min-w-[16rem] rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-xs font-semibold text-ink outline-none focus:border-accent disabled:opacity-60"
                      >
                        <option value="">Sin asignar</option>
                        {data.map((u: any) => (
                          <option key={u.id} value={u.id}>{u.nombre}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void guardarAsignacion(t.slug, asignaciones[t.slug]?.usuario_id ?? null)}
                        disabled={!isAdmin || savingAsign === t.slug}
                        className="rounded-paper border-2 border-accent bg-accent px-3 py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover disabled:opacity-50"
                      >
                        {savingAsign === t.slug ? "Guardando…" : "Guardar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Departamentos (admin) ─────────────────────────────────────────── */}
      {isAdmin && (
        <div className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-ink">Departamentos</h3>
              <p className="text-[11px] text-muted">Crea departamentos nuevos para organizar aliados.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre del departamento *" value={deptForm.nombre} onChange={(v) => setDeptForm((f) => ({ ...f, nombre: v }))} />
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Color</label>
              <input
                type="color"
                value={deptForm.color}
                onChange={(e) => setDeptForm((f) => ({ ...f, color: e.target.value }))}
                className="h-10 w-full rounded-paper border-2 border-border bg-surface-input px-2"
              />
            </div>
            <div className="sm:col-span-2">
              <Field label="Descripción" value={deptForm.descripcion} onChange={(v) => setDeptForm((f) => ({ ...f, descripcion: v }))} />
            </div>
          </div>
          {deptError && <p className="text-xs font-semibold text-red-600">{deptError}</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">Existentes: {depts.length}</p>
            <button
              type="button"
              onClick={() => void crearDepartamento()}
              disabled={deptSaving}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover disabled:opacity-50"
            >
              {deptSaving ? "Creando…" : "+ Crear departamento"}
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
          {data.map((u: any) => {
            const isExpanded = expandedId === u.id;
            const lista: any[] = Array.isArray(u.tickets_lista) ? u.tickets_lista : [];
            const prioBadge: Record<string, string> = {
              urgente: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
              alta: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
              media: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-300",
              baja: "bg-surface-hover text-muted",
            };
            const tipoBadge: Record<string, string> = {
              accion: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
              solicitud: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
              ticket: "bg-surface-hover text-muted",
            };
            return (
            <div key={u.id} className="rounded-paper border-2 border-border bg-surface-panel shadow-paper-sm">
              <div className="p-4">
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
                {/* Load bar + expand toggle */}
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-muted">
                    <span>Carga actual</span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : u.id)}
                      className="font-semibold text-accent hover:underline"
                    >
                      {u.tickets_abiertos} tickets abiertos {isExpanded ? "▲" : "▼"}
                    </button>
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

              {/* Tickets list expandable */}
              {isExpanded && (
                <div className="border-t-2 border-border px-4 pb-4 pt-3">
                  {lista.length === 0 ? (
                    <p className="text-xs text-muted">Sin tickets activos asignados.</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-2">Asignaciones activas</p>
                      {lista.map((t: any) => (
                        <div key={t.numero} className="flex flex-wrap items-start justify-between gap-2 rounded-paper border border-border bg-surface px-3 py-2">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-mono text-[11px] font-bold text-accent shrink-0">{t.numero}</span>
                            <span className="text-xs font-semibold text-ink truncate max-w-xs">{t.titulo}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tipoBadge[t.tipo] ?? tipoBadge.ticket}`}>
                              {t.tipo === "accion" ? "⚡ acción" : t.tipo === "solicitud" ? "📋 solicitud" : "🎫 ticket"}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${prioBadge[t.prioridad] ?? prioBadge.baja}`}>
                              {t.prioridad}
                            </span>
                            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-semibold text-muted">
                              {t.estado}
                            </span>
                          </div>
                        </div>
                      ))}
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

/** Reproduce alerta de voz para recordatorios vencidos usando la voz de Hugo García. */
async function playRecordatorioAlerta(apiToken: string, count: number): Promise<void> {
  const texto = count === 1
    ? "Hola. Tienes un recordatorio pendiente para hoy."
    : `Hola. Tienes ${count} recordatorios pendientes para hoy.`;
  try {
    const res = await fetch("/api/voz/sintetizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({
        texto,
        motor: "voicebox",
        voicebox_engine: "qwen3",
        voicebox_profile: "3762e0ae-ae88-4f5e-8d77-af4f8eb7cc23",
        language: "Spanish",
      }),
    });
    if (!res.ok) throw new Error("tts error");
    const buffer = await res.arrayBuffer();
    const type = res.headers.get("content-type") || "audio/wav";
    await _playBlobBuffer(buffer, type);
  } catch {
    // Fallback: síntesis del navegador
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(texto);
      utt.lang = "es-CO"; utt.rate = 0.92; utt.volume = 1;
      window.speechSynthesis.speak(utt);
    }
  }
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
      body: JSON.stringify({
        texto: "Recuerda: tienes una tarea en proceso.",
        motor: "voicebox",
        voicebox_engine: "qwen3",
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

/** IDs de acciones cuyo detail debe abrir el modo paso-a-paso automáticamente. */
const _autoStartPasoAPaso = new Set<number>();

function esTarjetaSoloCompras(ticket: Ticket, user?: TicketsUser): boolean {
  return esSolicitudCompraDelegada(ticket) || (
    !!user && uidEq(ticket.asignado_a, user.id)
    && (ticket.titulo || "").trim().toLowerCase().startsWith("compras:")
  );
}

function AccionCardAvisoCompras({ ticket }: { ticket: Ticket }) {
  return (
    <div className="rounded-xl border border-blue-400/50 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-2">
      <p className="text-sm font-bold text-ink">🛒 {ticket.titulo}</p>
      <p className="text-xs text-muted font-mono">{ticket.numero}</p>
      <p className="text-xs text-muted">
        Esta tarea es solo la lista de compras. Ábrela en <strong className="text-ink">Solicitudes</strong>.
      </p>
    </div>
  );
}

function AccionCard(props: {
  ticket: Ticket; token: string;
  user?: TicketsUser;
  onSelect: (id: number) => void;
  onChanged: () => void;
  onContinuar?: (ticket: Ticket) => void;
  isAdmin?: boolean;
  readOnly?: boolean;
}) {
  if (esTarjetaSoloCompras(props.ticket, props.user)) {
    return <AccionCardAvisoCompras ticket={props.ticket} />;
  }
  return <AccionCardOperativa {...props} />;
}

function AccionCardOperativa({
  ticket, token, onSelect, onChanged, onContinuar, isAdmin, readOnly,
}: {
  ticket: Ticket; token: string;
  onSelect: (id: number) => void;
  onChanged: () => void;
  onContinuar?: (ticket: Ticket) => void;
  isAdmin?: boolean;
  readOnly?: boolean;
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
      // Tickets operativos (no acciones): modo paso a paso MeLi al iniciar
      if (
        ticket.tipo !== "accion"
        && nuevoEstado === "en_proceso"
        && (ticket.pasos_total ?? 0) > 0
      ) {
        _autoStartPasoAPaso.add(ticket.id);
        onSelect(ticket.id);
      }
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  async function resolver() {
    if (busy) return;
    if (!confirm(`¿Marcar "${ticket.titulo}" como terminada?\n\nEsta acción no se puede deshacer.`)) return;
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

  async function cancelar() {
    if (busy) return;
    if (!confirm(`¿Cancelar la acción "${ticket.titulo}"?\n\nSe marcará como cancelada y quedará en el historial.`)) return;
    setBusy(true);
    try {
      if (corridaId) {
        try { await tapi(`/corridas/${corridaId}/pausar`, token, { method: "POST" }); } catch {}
      }
      await tapi(`/${ticket.id}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: "rechazado", motivo: "Acción cancelada por el responsable" }) });
      inicioRef.current = null;
      _timerStore.delete(ticket.id);
      onChanged();
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
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-ink">{ticket.titulo}</span>
          {ticket.descripcion && ticket.descripcion !== ticket.titulo && (
            <p className="mt-0.5 text-xs text-muted line-clamp-2">{ticket.descripcion}</p>
          )}
        </div>
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

      {!resuelta && !resolucionInfo && !readOnly && (
        <div className="flex flex-col gap-2 pt-1">
          {onContinuar && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onContinuar(ticket)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-3 text-sm font-extrabold text-white min-h-[44px] transition hover:brightness-110"
            >
              📋 Continuar donde quedé
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={iniciarPausar}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold min-h-[40px] transition-colors ${
                enProceso
                  ? "border-yellow-400 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400"
                  : "border-border bg-surface-panel text-muted hover:border-accent hover:text-accent"
              }`}
            >
              <Icon name={enProceso ? "clock" : "lightning"} size={14} weight="bold" />
              {enProceso ? "Pausar" : "▶ Iniciar"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={resolver}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-green-500 bg-green-50 px-3 py-2.5 text-xs font-bold text-green-700 min-h-[40px] transition-colors hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400"
            >
              <Icon name="check" size={14} weight="bold" />
              Listo
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelar}
              title="Cancelar esta acción"
              className="flex items-center justify-center rounded-xl border border-border px-2.5 py-2.5 text-xs font-bold text-muted min-h-[40px] transition-colors hover:border-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {!resuelta && readOnly && (
        <p className="text-[10px] text-center text-muted">Vista de supervisión — solo lectura</p>
      )}
    </div>
  );
}

// ── tipos lista de compras ────────────────────────────────────────────────────
interface Adjunto {
  id: number;
  ticket_id: number;
  nombre_archivo: string;
  nombre_original: string;
  mime?: string | null;
  creado_por_nombre?: string | null;
  creado_en: string;
  paso_id?: number | null;
}

interface ProtocoloPaso {
  descripcion: string;
  notas?: string | null;
  adjuntos_ref?: { nombre_archivo: string; mime: string }[];
}

interface Protocolo {
  id: number;
  titulo: string;
  descripcion?: string | null;
  categoria?: string | null;
  pasos: ProtocoloPaso[];
  lista_compras?: ItemCompraAccion[];
  alcance?: "personal" | "global" | "seleccionado" | string;
  usuarios_compartidos?: { id: number; nombre: string }[];
  ticket_origen?: number | null;
  ticket_origen_numero?: string | null;
  ticket_origen_titulo?: string | null;
  creado_por_nombre?: string | null;
  creado_en: string;
}

/** Plantilla para re-ejecutar una acción sin volver a describirla. */
interface PlantillaAccion {
  titulo: string;
  listaCompras: ItemCompraAccion[];
  pasos: PasoAccionDraft[];
  protocoloId?: number;
}

function plantillaDesdeProtocolo(p: Protocolo): PlantillaAccion {
  const lista = Array.isArray(p.lista_compras) ? p.lista_compras : [];
  return {
    titulo: p.titulo,
    protocoloId: p.id,
    listaCompras: lista.map((it) => ({
      n: it.n || "",
      cantidad: it.cantidad || "",
      unidad: (it.unidad === "u" ? "u" : "g") as UnidadCompra,
      comprado: false,
    })),
    pasos: (p.pasos || []).map((paso) => ({
      nombre: paso.descripcion,
      desc: paso.notas || "",
      adjuntos_ref: paso.adjuntos_ref ?? [],
    })),
  };
}

type PlantillaAccionApi = {
  titulo: string;
  lista_compras?: { n?: string; nombre?: string; cantidad?: string; unidad?: string }[];
  pasos?: { descripcion: string; notas?: string | null }[];
  protocolo_id?: number | null;
};

function plantillaDesdeApi(d: PlantillaAccionApi): PlantillaAccion {
  const lista = Array.isArray(d.lista_compras) ? d.lista_compras : [];
  return {
    titulo: d.titulo || "",
    protocoloId: d.protocolo_id ?? undefined,
    listaCompras: lista.map((it) => ({
      n: (it.n || it.nombre || "").trim(),
      cantidad: String(it.cantidad ?? ""),
      unidad: (it.unidad === "u" || it.unidad === "und" ? "u" : "g") as UnidadCompra,
      comprado: false,
    })),
    pasos: (d.pasos || []).map((paso) => ({
      nombre: paso.descripcion,
      desc: paso.notas || "",
      adjuntos_ref: (paso as any).adjuntos_ref ?? [],
    })),
  };
}

function parseListaComprasDesdeNotas(notas: string): ItemCompraAccion[] {
  const items: ItemCompraAccion[] = [];
  for (const line of (notas || "").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("•")) continue;
    const body = t.replace(/^•\s*/, "").trim();
    let nombre = body;
    let cantidad = "";
    let unidad: UnidadCompra = "g";
    if (body.includes("—")) {
      const [n, resto] = body.split("—", 2);
      nombre = n.trim();
      const partes = resto.trim().split(/\s+/);
      if (partes.length >= 2) {
        cantidad = partes[0];
        unidad = partes[1] === "u" || partes[1] === "und" ? "u" : "g";
      } else if (partes.length === 1) cantidad = partes[0];
    }
    if (nombre) items.push({ n: nombre, cantidad, unidad, comprado: false });
  }
  return items;
}

/** Pantalla de logro al completar una tarea (compras, pasos, etc.). */
function PantallaLogro({
  titulo,
  subtitulo,
  detalle,
  emoji = "🏆",
  variant = "gold",
  botonLabel = "Continuar →",
  onContinuar,
}: {
  titulo: string;
  subtitulo?: string;
  detalle?: string;
  emoji?: string;
  variant?: "gold" | "green";
  botonLabel?: string;
  onContinuar: () => void;
}) {
  const ringBg = variant === "green"
    ? "radial-gradient(circle, rgba(74,154,106,0.35) 0%, transparent 70%)"
    : "radial-gradient(circle, rgba(244,196,77,0.4) 0%, transparent 70%)";
  const iconClass = variant === "green" ? "mck-celebrate text-7xl" : "mck-bounce-in text-8xl";
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center px-4">
      <div className="relative">
        <div className={`${iconClass} select-none`}>{emoji}</div>
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ animation: "mck-ring-pulse 1s ease-out 0.3s both", background: ringBg }}
        />
      </div>
      <div className="mck-slide-up space-y-2" style={{ animationDelay: "0.2s" }}>
        <h2 className="text-4xl font-extrabold text-ink">{titulo}</h2>
        {subtitulo && <p className="text-lg text-muted">{subtitulo}</p>}
        {detalle && <p className="text-sm text-muted">{detalle}</p>}
      </div>
      <button
        type="button"
        onClick={onContinuar}
        className="mck-slide-up mt-4 rounded-2xl border-2 border-border px-8 py-3 text-base font-bold text-muted transition hover:border-accent hover:text-accent"
        style={{ animationDelay: "0.4s" }}
      >
        {botonLabel}
      </button>
    </div>
  );
}

/** Vista mínima: solo checklist de compras para solicitudes delegadas (subtipo=compra). */
function SolicitudCompraChecklist({
  ticket, token, user, onChanged, onTerminado, supervision, pantallaCompleta,
}: {
  ticket: Ticket; token: string; user: TicketsUser;
  onChanged: () => void;
  onTerminado?: () => void;
  supervision?: boolean;
  pantallaCompleta?: boolean;
}) {
  const [items, setItems] = useState<ItemCompra[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [facturaFile, setFacturaFile] = useState<File | null>(null);
  const [estadoLocal, setEstadoLocal] = useState(ticket.estado);
  const [faseLogro, setFaseLogro] = useState(false);
  const esAsignado = uidEq(ticket.asignado_a, user.id);
  const puedeOperar = esAsignado && !supervision;
  const resuelta = estadoLocal === "resuelto" || estadoLocal === "rechazado";
  const itemsActivos = items.filter((i) => i.nombre.trim());
  const todosComprados = itemsActivos.length > 0 && itemsActivos.every((i) => !!i.comprado);
  const enCompras = estadoLocal === "en_proceso";
  const tieneProductos = itemsActivos.length > 0;
  const mostrarChecklist = puedeOperar && !resuelta && enCompras && tieneProductos;

  useEffect(() => { setEstadoLocal(ticket.estado); }, [ticket.id, ticket.estado]);

  async function cargar() {
    setLoading(true);
    setMsg("");
    try {
      const data = await tapi(`/${ticket.id}/lista-compras`, token);
      const raw = Array.isArray(data) ? data : [];
      setItems(raw.map((row) => {
        const r = row as ItemCompra & { material_nombre?: string };
        return {
          ...r,
          nombre: (r.nombre || r.material_nombre || "").trim(),
        };
      }));
    } catch (e: unknown) {
      setItems([]);
      setMsg(e instanceof Error ? e.message : "No se pudo cargar la lista de compras");
    } finally { setLoading(false); }
  }

  useEffect(() => { void cargar(); }, [ticket.id, token]);

  async function toggleItem(item: ItemCompra) {
    try {
      const data = await tapi(`/lista-compras/${item.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ comprado: item.comprado ? 0 : 1 }),
      });
      setItems(Array.isArray(data) ? data : items);
    } catch { /* ignore */ }
  }

  async function iniciar() {
    setBusy(true);
    setMsg("");
    try {
      await tapi(`/${ticket.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "en_proceso" }),
      });
      setEstadoLocal("en_proceso");
      onChanged();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Error al iniciar");
    } finally { setBusy(false); }
  }

  async function terminarCompras() {
    if (!todosComprados) {
      setMsg("Marca todos los productos antes de terminar");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      if (facturaFile) {
        const fd = new FormData();
        fd.append("archivo", facturaFile);
        await tapi(`/${ticket.id}/adjuntos`, token, { method: "POST", body: fd });
      }
      const nombre = user.nombre || "Operador";
      await tapi(`/${ticket.id}/comentarios`, token, {
        method: "POST",
        body: JSON.stringify({
          texto: facturaFile
            ? `✅ Compras terminadas por ${nombre} — factura adjunta.`
            : `✅ Compras terminadas por ${nombre}.`,
          es_interno: false,
        }),
      });
      if (ticket.ticket_padre_id) {
        await tapi(`/${ticket.ticket_padre_id}/comentarios`, token, {
          method: "POST",
          body: JSON.stringify({
            texto: `🛒 **Compras delegadas listas** (${ticket.numero})\nPor: ${nombre}`,
            es_interno: false,
          }),
        }).catch(() => {});
      }
      await tapi(`/${ticket.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "resuelto" }),
      });
      setEstadoLocal("resuelto");
      onChanged();
      if (pantallaCompleta) {
        onTerminado?.();
      } else {
        setFaseLogro(true);
      }
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Error al cerrar");
    } finally { setBusy(false); }
  }

  function fmtItem(it: ItemCompra) {
    const q = String(it.cantidad ?? "");
    const u = (it.unidad || "und").toLowerCase();
    if (!q) return "";
    return u === "g" ? `${q} g` : `${q} u`;
  }

  const wrapClass = pantallaCompleta ? "space-y-4" : "space-y-3 pt-1";

  if (faseLogro && !pantallaCompleta) {
    const n = itemsActivos.length;
    return (
      <PantallaLogro
        emoji="🛒"
        variant="green"
        titulo="¡Compras completadas!"
        subtitulo={ticket.titulo}
        detalle={
          ticket.ticket_padre_titulo
            ? `${n} producto${n !== 1 ? "s" : ""} · Para: ${ticket.ticket_padre_titulo}`
            : `${n} producto${n !== 1 ? "s" : ""} marcados en la lista`
        }
        botonLabel="Listo →"
        onContinuar={() => {
          setFaseLogro(false);
          onTerminado?.();
        }}
      />
    );
  }

  return (
    <div className={wrapClass}>
      {pantallaCompleta && (
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Ir de compras</p>
      )}
      {ticket.ticket_padre_titulo && (
        <p className={pantallaCompleta ? "text-sm text-muted" : "text-xs text-muted"}>
          Para la acción: <strong className="text-ink">{ticket.ticket_padre_titulo}</strong>
        </p>
      )}
      {loading && <p className="text-sm text-muted">Cargando lista…</p>}
      {!loading && !tieneProductos && !msg && (
        <p className="text-sm text-muted">Sin productos en la lista.</p>
      )}
      {!loading && !tieneProductos && msg && (
        <div className="space-y-2">
          <p className="text-sm text-red-500">{msg}</p>
          <button
            type="button"
            onClick={() => void cargar()}
            className="w-full rounded-xl border border-border py-2 text-xs font-bold text-accent hover:border-accent"
          >
            Reintentar cargar lista
          </button>
        </div>
      )}
      {!loading && tieneProductos && !enCompras && puedeOperar && (
        <ul className="space-y-1 rounded-xl border border-border/60 bg-surface-panel/50 px-3 py-2">
          {itemsActivos.map((it) => (
            <li key={it.id} className="text-sm text-ink">
              · {it.nombre}{fmtItem(it) ? ` (${fmtItem(it)})` : ""}
            </li>
          ))}
        </ul>
      )}
      {!loading && mostrarChecklist && itemsActivos.map((it) => (
        <button
          key={it.id}
          type="button"
          disabled={resuelta || !puedeOperar}
          onClick={() => void toggleItem(it)}
          className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition
            ${it.comprado ? "border-accent bg-accent/10" : "border-border bg-surface-panel hover:border-accent/40"}
            disabled:opacity-60`}
        >
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold
            ${it.comprado ? "border-accent bg-accent text-white" : "border-border text-muted"}`}>
            {it.comprado ? "✓" : ""}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${it.comprado ? "text-accent line-through" : "text-ink"}`}>
              {it.nombre}
            </p>
            {fmtItem(it) && <p className="text-xs text-muted">{fmtItem(it)}</p>}
          </div>
        </button>
      ))}

      {!resuelta && puedeOperar && tieneProductos && (
        <>
          {!enCompras && (
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void iniciar()}
              className="w-full rounded-xl bg-accent py-3.5 text-sm font-extrabold text-white shadow-sm"
            >
              {busy ? "Iniciando…" : "Iniciar compras"}
            </button>
          )}
          {mostrarChecklist && (
            <>
              <p className="text-xs font-bold text-accent">Lista de compras — marca cada producto</p>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-4">
                <span className="text-sm font-bold text-accent">
                  {facturaFile ? facturaFile.name : "📷 Factura de caja (opcional)"}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  className="sr-only"
                  onChange={(e) => setFacturaFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                disabled={busy || !todosComprados}
                onClick={() => void terminarCompras()}
                className="w-full rounded-2xl bg-accent py-4 text-base font-extrabold text-white disabled:opacity-40"
              >
                {busy ? "Guardando…" : "Terminé las compras ✓"}
              </button>
              {!todosComprados && (
                <p className="text-center text-xs text-muted">Marca los {itemsActivos.length} productos</p>
              )}
            </>
          )}
        </>
      )}
      {!resuelta && esAsignado && supervision && (
        <p className="text-[10px] text-center text-muted">Vista de supervisión</p>
      )}
      {msg && <p className="text-xs text-accent font-semibold">{msg}</p>}
    </div>
  );
}

/** Pantalla dedicada: solo lista de compras (sin wizard de acción completa). */
function PanelIrDeCompras({
  ticket, token, user, onSalir, onTerminado,
}: {
  ticket: Ticket; token: string; user: TicketsUser;
  onSalir: () => void;
  onTerminado: () => void;
}) {
  const [faseLogro, setFaseLogro] = useState(false);

  if (faseLogro) {
    return (
      <div className="mx-auto max-w-lg">
        <PantallaLogro
          emoji="🛒"
          variant="green"
          titulo="¡Compras completadas!"
          subtitulo={ticket.titulo}
          detalle={
            ticket.ticket_padre_titulo
              ? `Quien delegó puede continuar: ${ticket.ticket_padre_titulo}`
              : "Tu solicitud de compras quedó cerrada"
          }
          botonLabel="Volver a solicitudes →"
          onContinuar={onTerminado}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-10">
      <button
        type="button"
        onClick={onSalir}
        className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent"
      >
        ← Volver a solicitudes
      </button>
      <div>
        <h2 className="text-2xl font-extrabold text-ink leading-tight">Ir de compras</h2>
        <p className="mt-1 font-mono text-sm text-muted">{ticket.numero}</p>
        <p className="mt-2 text-sm text-ink">{ticket.titulo}</p>
      </div>
      <div className="rounded-2xl border-2 border-blue-400/40 bg-surface p-4 shadow-sm">
        <SolicitudCompraChecklist
          ticket={ticket}
          token={token}
          user={user}
          pantallaCompleta
          onChanged={() => {}}
          onTerminado={() => setFaseLogro(true)}
        />
      </div>
      <p className="text-center text-xs text-muted">
        Al terminar, tu tarea queda cerrada. Quien delegó la lista podrá seguir con la acción.
      </p>
    </div>
  );
}

interface ItemCompra {
  id: number;
  ticket_id: number;
  nombre: string;
  sku: string | null;
  material_id: number | null;
  cantidad: number;
  unidad: string;
  precio_estimado: number | null;
  comprado: number;
  notas: string | null;
  creado_por_nombre: string | null;
  material_nombre: string | null;
  material_unidad: string | null;
}

interface ProductoCatalogo {
  id: number;
  nombre: string;
  codigo: string | null;
  unidad_medida: string | null;
  tipo: string;
}

// ── SolicitudCard ─────────────────────────────────────────────────────────────

function SolicitudCard({
  ticket, token, user, onChanged, isAdmin, supervision, protocolos = [],
  onRegistrarEjecucion,
}: {
  ticket: Ticket; token: string; user: TicketsUser;
  onChanged: () => void;
  isAdmin?: boolean;
  /** Vista equipo/admin: estado visible, sin botones ni aviso de "solo el asignado". */
  supervision?: boolean;
  protocolos?: Protocolo[];
  /** Abre el asistente de acción vinculado a esta solicitud. */
  onRegistrarEjecucion?: (ticket: Ticket) => void;
}) {
  const nivel = (user.rol?.nivel ?? 1);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState("");
  const esAsignado = uidEq(ticket.asignado_a, user.id);
  const esCreadoPorMi = uidEq(ticket.creado_por, user.id);
  const esParticipante = ticket.participantes?.some((p) => p.usuario_id === user.id) ?? false;
  const esIntervencion = !!ticket.ticket_padre_id;
  const puedeVerSensible = nivel >= 2 || esAsignado || esCreadoPorMi || esParticipante;
  const resuelta = ticket.estado === "resuelto" || ticket.estado === "rechazado";

  // Pasos/checklist
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [loadingPasos, setLoadingPasos] = useState(false);
  const [showPasos, setShowPasos] = useState(false);
  const [editandoPasoId, setEditandoPasoId] = useState<number | null>(null);
  const [editPasoDesc, setEditPasoDesc] = useState("");
  const [editPasoNotas, setEditPasoNotas] = useState("");
  const [nuevoPasoDesc, setNuevoPasoDesc] = useState("");
  const [agregandoPaso, setAgregandoPaso] = useState(false);
  const [showAddPaso, setShowAddPaso] = useState(false);

  // Lista de compras
  const [showCompras, setShowCompras] = useState(false);
  const [compras, setCompras] = useState<ItemCompra[]>([]);
  const [loadingCompras, setLoadingCompras] = useState(false);
  const [nuevoProducto, setNuevoProducto] = useState({ nombre: "", sku: "", cantidad: "1", unidad: "und", precio: "" });
  const [busqProducto, setBusqProducto] = useState("");
  const [resultadosBusq, setResultadosBusq] = useState<ProductoCatalogo[]>([]);
  const [agregandoCompra, setAgregandoCompra] = useState(false);

  // Intervención (blocker)
  const [showIntervencion, setShowIntervencion] = useState(false);
  const [interForm, setInterForm] = useState({ titulo: "", descripcion: "", asignado_a: "", paso_ref: "", paso_id: 0 });
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [creandoInter, setCreandoInter] = useState(false);

  // Resolución de intervención
  const [resolucionInter, setResolucionInter] = useState("");

  // Comentarios (respuestas de intervención)
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [showComentarios, setShowComentarios] = useState(false);
  const [loadingComentarios, setLoadingComentarios] = useState(false);

  // Adjuntos
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [loadingAdjuntos, setLoadingAdjuntos] = useState(false);
  const [showAdjuntos, setShowAdjuntos] = useState(false);
  const [eliminandoAdj, setEliminandoAdj] = useState<number | null>(null);
  const [subiendoAdjPaso, setSubiendoAdjPaso] = useState<number | null>(null);
  const [subiendoAdjTicket, setSubiendoAdjTicket] = useState(false);
  const [showPedirRevision, setShowPedirRevision] = useState(false);
  const [notaRevision, setNotaRevision] = useState("");
  const [showPedirAjustes, setShowPedirAjustes] = useState(false);
  const [ajustesMensaje, setAjustesMensaje] = useState("");

  // Guardar como protocolo
  const [showProtocoloForm, setShowProtocoloForm] = useState(false);
  const [protocoloForm, setProtocoloForm] = useState({ titulo: "", descripcion: "", categoria: "" });
  const [guardandoProtocolo, setGuardandoProtocolo] = useState(false);
  const [protocoloMsg, setProtocoloMsg] = useState("");

  // Enlazar protocolo existente
  const [showVincularProtocolo, setShowVincularProtocolo] = useState(false);
  const [protocoloVincularId, setProtocoloVincularId] = useState<number | "">("");
  const [reemplazarPasosProtocolo, setReemplazarPasosProtocolo] = useState(false);
  const [vinculandoProtocolo, setVinculandoProtocolo] = useState(false);
  const [vincularProtocoloMsg, setVincularProtocoloMsg] = useState("");

  // Datos sensibles
  const [showSensible, setShowSensible] = useState(false);
  const [sensibleTexto, setSensibleTexto] = useState("");
  const [editandoSensible, setEditandoSensible] = useState(false);
  const [sensibleDraft, setSensibleDraft] = useState("");
  const [loadingSensible, setLoadingSensible] = useState(false);
  const [sensibleMsg, setSensibleMsg] = useState("");

  // Cargar pasos al iniciar (siempre que esté en proceso) o al hacer clic
  useEffect(() => {
    if (ticket.estado === "en_proceso") {
      void cargarPasos();
      setShowPasos(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, ticket.estado]);

  async function cargarPasos() {
    setLoadingPasos(true);
    try {
      const data = await tapi(`/${ticket.id}/pasos`, token);
      setPasos(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setLoadingPasos(false); }
  }

  async function togglePaso(paso: Paso) {
    try {
      const data = await tapi(`/${ticket.id}/pasos/${paso.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ completado: paso.completado ? 0 : 1 }),
      });
      if (data.pasos) setPasos(data.pasos);
      else if (Array.isArray(data)) setPasos(data);
      onChanged();
    } catch { /* ignore */ }
  }

  async function subirAdjuntoPaso(pasoId: number, file: File) {
    setSubiendoAdjPaso(pasoId);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      await fetch(`/api/tickets/${ticket.id}/pasos/${pasoId}/adjuntos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
    } catch { /* no crítico */ } finally {
      setSubiendoAdjPaso(null);
    }
  }

  async function subirAdjuntoTicket(file: File) {
    setSubiendoAdjTicket(true);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      await tapi(`/${ticket.id}/adjuntos`, token, { method: "POST", body: fd });
      void cargarAdjuntos();
    } catch { /* no crítico */ } finally {
      setSubiendoAdjTicket(false);
    }
  }

  function iniciarEditPaso(p: Paso) {
    setEditandoPasoId(p.id);
    setEditPasoDesc(p.descripcion);
    setEditPasoNotas((p.notas as string | null) ?? "");
  }

  async function guardarEditPaso(paso: Paso) {
    if (!editPasoDesc.trim()) return;
    try {
      const data = await tapi(`/${ticket.id}/pasos/${paso.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ descripcion: editPasoDesc, notas: editPasoNotas }),
      });
      setPasos(Array.isArray(data) ? data : data.pasos ?? pasos);
    } catch { /* ignore */ } finally {
      setEditandoPasoId(null);
    }
  }

  async function agregarPasoInline() {
    if (!nuevoPasoDesc.trim()) return;
    setAgregandoPaso(true);
    try {
      const data = await tapi(`/${ticket.id}/pasos`, token, {
        method: "POST",
        body: JSON.stringify({ descripcion: nuevoPasoDesc }),
      });
      setPasos(Array.isArray(data) ? data : pasos);
      setNuevoPasoDesc("");
      setShowAddPaso(false);
      onChanged();
    } catch { /* ignore */ } finally { setAgregandoPaso(false); }
  }

  async function eliminarPasoInline(pasoId: number) {
    try {
      const data = await tapi(`/pasos/${pasoId}`, token, { method: "DELETE" });
      setPasos(Array.isArray(data) ? data : pasos);
      onChanged();
    } catch { /* ignore */ }
  }

  async function cargarCompras() {
    setLoadingCompras(true);
    try {
      const data = await tapi(`/${ticket.id}/lista-compras`, token);
      setCompras(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setLoadingCompras(false); }
  }

  async function buscarProducto(q: string) {
    setBusqProducto(q);
    setNuevoProducto((p) => ({ ...p, nombre: q }));
    if (q.length < 2) { setResultadosBusq([]); return; }
    try {
      const data = await tapi(`/productos/buscar?q=${encodeURIComponent(q)}`, token);
      setResultadosBusq(Array.isArray(data) ? data : []);
    } catch { setResultadosBusq([]); }
  }

  function seleccionarProductoCatalogo(prod: ProductoCatalogo) {
    setNuevoProducto((p) => ({
      ...p,
      nombre: prod.nombre,
      sku: prod.codigo ?? "",
      unidad: prod.unidad_medida ?? "und",
    }));
    setBusqProducto(prod.nombre);
    setResultadosBusq([]);
  }

  async function agregarCompra() {
    if (!nuevoProducto.nombre.trim()) return;
    setAgregandoCompra(true);
    try {
      const data = await tapi(`/${ticket.id}/lista-compras`, token, {
        method: "POST",
        body: JSON.stringify({
          nombre: nuevoProducto.nombre,
          sku: nuevoProducto.sku || undefined,
          cantidad: parseFloat(nuevoProducto.cantidad) || 1,
          unidad: nuevoProducto.unidad,
          precio_estimado: nuevoProducto.precio ? parseFloat(nuevoProducto.precio) : undefined,
        }),
      });
      setCompras(Array.isArray(data) ? data : compras);
      setNuevoProducto({ nombre: "", sku: "", cantidad: "1", unidad: "und", precio: "" });
      setBusqProducto("");
    } catch { /* ignore */ } finally { setAgregandoCompra(false); }
  }

  async function toggleComprado(item: ItemCompra) {
    try {
      const data = await tapi(`/lista-compras/${item.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ comprado: item.comprado ? 0 : 1 }),
      });
      setCompras(Array.isArray(data) ? data : compras);
    } catch { /* ignore */ }
  }

  async function eliminarCompra(itemId: number) {
    try {
      const data = await tapi(`/lista-compras/${itemId}`, token, { method: "DELETE" });
      setCompras(Array.isArray(data) ? data : compras);
    } catch { /* ignore */ }
  }

  function abrirIntervencionDesdePaso(paso: Paso) {
    void abrirIntervencion();
    setInterForm((f) => ({
      ...f,
      titulo: `Paso ${paso.orden}: ${paso.descripcion}`,
      descripcion: "",
      paso_ref: `Paso ${paso.orden}: ${paso.descripcion}`,
      paso_id: paso.id,
    }));
  }

  async function resolver() {
    if (!esAsignado || busy) return;
    // Validación previa en el cliente usando contadores del ticket
    const total = ticket.pasos_total ?? 0;
    const hechos = ticket.pasos_completados ?? 0;
    if (total > 0 && hechos < total) {
      setMsg(`Faltan ${total - hechos} paso(s) por completar antes de marcar como lista.`);
      setTimeout(() => setMsg(""), 4000);
      return;
    }
    // Validación adicional con pasos cargados en memoria
    const pasosPendientes = pasos.filter((p) => !pasoEstaCompletado(p));
    if (pasos.length > 0 && pasosPendientes.length > 0) {
      setMsg(`Faltan ${pasosPendientes.length} paso(s) por completar antes de marcar como lista.`);
      setTimeout(() => setMsg(""), 4000);
      return;
    }
    if (!confirm(`¿Marcar "${ticket.titulo}" como lista?\n\nEsta acción no se puede deshacer.`)) return;
    setBusy(true);
    try {
      await tapi(`/${ticket.id}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: "resuelto" }) });
      onChanged();
    } catch (e: any) {
      setMsg(e.message ?? "Error");
      setTimeout(() => setMsg(""), 4000);
    } finally { setBusy(false); }
  }

  async function pedirRevision() {
    if (!esAsignado || busy) return;
    const total = ticket.pasos_total ?? 0;
    const hechos = ticket.pasos_completados ?? 0;
    if (total > 0 && hechos < total) {
      setMsg(`Faltan ${total - hechos} paso(s) por completar antes de pedir revisión.`);
      setTimeout(() => setMsg(""), 4000);
      return;
    }
    setBusy(true);
    try {
      await tapi(`/${ticket.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({
          estado: "esperando_aprobacion",
          motivo: notaRevision.trim() || undefined,
        }),
      });
      setShowPedirRevision(false);
      setNotaRevision("");
      onChanged();
    } catch (e: any) {
      setMsg(e.message ?? "Error al pedir revisión");
      setTimeout(() => setMsg(""), 4000);
    } finally { setBusy(false); }
  }

  async function aprobar() {
    if (!esCreadoPorMi || busy) return;
    if (!confirm(`¿Aprobar y cerrar la solicitud "${ticket.titulo}"?`)) return;
    setBusy(true);
    try {
      await tapi(`/${ticket.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "resuelto" }),
      });
      onChanged();
    } catch (e: any) {
      setMsg(e.message ?? "Error al aprobar");
      setTimeout(() => setMsg(""), 4000);
    } finally { setBusy(false); }
  }

  async function pedirAjustes() {
    if (!esCreadoPorMi || busy) return;
    if (!ajustesMensaje.trim()) {
      setMsg("Describe qué ajustes necesitas.");
      setTimeout(() => setMsg(""), 3000);
      return;
    }
    setBusy(true);
    try {
      await tapi(`/${ticket.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "en_proceso", motivo: ajustesMensaje.trim() }),
      });
      setShowPedirAjustes(false);
      setAjustesMensaje("");
      onChanged();
    } catch (e: any) {
      setMsg(e.message ?? "Error");
      setTimeout(() => setMsg(""), 4000);
    } finally { setBusy(false); }
  }

  async function rechazarRevision() {
    if (!esCreadoPorMi || busy) return;
    const motivo = prompt("Motivo del rechazo (opcional):");
    if (motivo === null) return;
    setBusy(true);
    try {
      await tapi(`/${ticket.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "rechazado", motivo: motivo.trim() || undefined }),
      });
      onChanged();
    } catch (e: any) {
      setMsg(e.message ?? "Error al rechazar");
      setTimeout(() => setMsg(""), 4000);
    } finally { setBusy(false); }
  }

  async function cancelarRevision() {
    if (!esAsignado || busy) return;
    setBusy(true);
    try {
      await tapi(`/${ticket.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "en_proceso" }),
      });
      onChanged();
    } catch (e: any) {
      setMsg(e.message ?? "Error");
      setTimeout(() => setMsg(""), 4000);
    } finally { setBusy(false); }
  }

  async function resolverIntervencion() {
    if (!esAsignado || busy) return;
    if (!resolucionInter.trim()) {
      setMsg("Escribe tu respuesta antes de resolver la intervención.");
      setTimeout(() => setMsg(""), 3000);
      return;
    }
    setBusy(true);
    try {
      await tapi(`/${ticket.id}/comentarios`, token, {
        method: "POST",
        body: JSON.stringify({ texto: resolucionInter.trim() }),
      });
      await tapi(`/${ticket.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "resuelto" }),
      });
      onChanged();
    } catch (e: any) {
      setMsg(e.message ?? "Error");
      setTimeout(() => setMsg(""), 3000);
    } finally { setBusy(false); }
  }

  async function iniciarPausar() {
    if (!esAsignado || busy) return;
    setBusy(true);
    try {
      const nuevoEstado = ticket.estado === "en_proceso" ? "pendiente" : "en_proceso";
      await tapi(`/${ticket.id}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: nuevoEstado }) });
      if (nuevoEstado === "en_proceso") {
        await cargarPasos();
        setShowPasos(true);
        setShowAddPaso(true);
      }
      onChanged();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  async function eliminar() {
    if (busy) return;
    setBusy(true);
    try {
      await tapi(`/${ticket.id}`, token, { method: "DELETE" });
      onChanged();
    } catch { /* ignore */ } finally { setBusy(false); setConfirmDelete(false); }
  }

  async function abrirIntervencion() {
    if (usuarios.length === 0) {
      try {
        const data = await tapi("/usuarios", token);
        setUsuarios(Array.isArray(data) ? data.filter((u: UserInfo) => u.id !== user.id && u.activo) : []);
      } catch { /* ignore */ }
    }
    setShowIntervencion(true);
  }

  async function crearIntervencion() {
    if (!interForm.titulo.trim() || !interForm.asignado_a) return;
    setCreandoInter(true);
    try {
      const desc = interForm.paso_ref
        ? `${interForm.descripcion}\n\n[Origen: ${interForm.paso_ref}]`
        : interForm.descripcion;
      await tapi(`/${ticket.id}/pedir-intervencion`, token, {
        method: "POST",
        body: JSON.stringify({
          titulo: interForm.titulo,
          descripcion: desc,
          asignado_a: Number(interForm.asignado_a),
          paso_id: interForm.paso_id || undefined,
        }),
      });
      setShowIntervencion(false);
      setInterForm({ titulo: "", descripcion: "", asignado_a: "", paso_ref: "", paso_id: 0 });
      await cargarPasos();
      onChanged();
    } catch (e: any) {
      setMsg(e.message ?? "Error al crear intervencion");
      setTimeout(() => setMsg(""), 4000);
    } finally { setCreandoInter(false); }
  }

  async function cargarComentarios() {
    setLoadingComentarios(true);
    try {
      const data = await tapi(`/${ticket.id}/comentarios`, token);
      const lista = Array.isArray(data) ? data : [];
      setComentarios(lista);
      if (lista.length > 0) setShowComentarios(true);
    } catch { /* ignore */ } finally { setLoadingComentarios(false); }
  }

  // Auto-cargar comentarios al montar y cuando el ticket se desbloquea
  useEffect(() => {
    void cargarComentarios();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  useEffect(() => {
    if (!ticket.bloqueado_por) {
      void cargarComentarios();
      if (showPasos) void cargarPasos(); // recargar pasos para mostrar respuesta inline
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.bloqueado_por]);

  async function cargarAdjuntos() {
    setLoadingAdjuntos(true);
    try {
      const data = await tapi(`/${ticket.id}/adjuntos`, token);
      setAdjuntos(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setLoadingAdjuntos(false); }
  }

  async function eliminarAdjunto(adjId: number) {
    if (!confirm("¿Eliminar este archivo adjunto?")) return;
    setEliminandoAdj(adjId);
    try {
      await tapi(`/adjuntos/${adjId}`, token, { method: "DELETE" });
      setAdjuntos((prev) => prev.filter((a) => a.id !== adjId));
    } catch { /* ignore */ } finally { setEliminandoAdj(null); }
  }

  async function guardarComoProtocolo() {
    if (!protocoloForm.titulo.trim()) return;
    setGuardandoProtocolo(true);
    try {
      await tapi(`/${ticket.id}/guardar-como-protocolo`, token, {
        method: "POST",
        body: JSON.stringify(protocoloForm),
      });
      setProtocoloMsg("Procedimiento guardado");
      setShowProtocoloForm(false);
      setProtocoloForm({ titulo: "", descripcion: "", categoria: "" });
      setTimeout(() => setProtocoloMsg(""), 3000);
    } catch (e: any) {
      setProtocoloMsg(e.message ?? "Error al guardar procedimiento");
      setTimeout(() => setProtocoloMsg(""), 4000);
    } finally { setGuardandoProtocolo(false); }
  }

  async function vincularProtocolo() {
    if (!protocoloVincularId) return;
    setVinculandoProtocolo(true);
    setVincularProtocoloMsg("");
    try {
      await tapi(`/${ticket.id}/vincular-protocolo`, token, {
        method: "POST",
        body: JSON.stringify({
          protocolo_id: protocoloVincularId,
          reemplazar_pasos: reemplazarPasosProtocolo,
        }),
      });
      setVincularProtocoloMsg("Procedimiento vinculado");
      setShowVincularProtocolo(false);
      setProtocoloVincularId("");
      setReemplazarPasosProtocolo(false);
      setShowPasos(true);
      void cargarPasos();
      onChanged();
      setTimeout(() => setVincularProtocoloMsg(""), 3000);
    } catch (e: any) {
      setVincularProtocoloMsg(e.message ?? "Error al vincular");
    } finally { setVinculandoProtocolo(false); }
  }

  const puedeVincularProtocolo = !resuelta && !supervision
    && (nivel >= 2 || esAsignado || esCreadoPorMi || esParticipante);

  async function cargarSensible() {
    if (!puedeVerSensible) {
      setSensibleMsg("Sin permisos para ver datos sensibles");
      return;
    }
    setLoadingSensible(true);
    try {
      const data = await tapi(`/${ticket.id}/sensible`, token);
      setSensibleTexto(data.texto ?? "");
      setSensibleDraft(data.texto ?? "");
    } catch (e: any) {
      setSensibleMsg(e.message ?? "Error");
    } finally { setLoadingSensible(false); }
  }

  async function guardarSensible() {
    setLoadingSensible(true);
    try {
      await tapi(`/${ticket.id}/sensible`, token, {
        method: "PUT",
        body: JSON.stringify({ texto: sensibleDraft }),
      });
      setSensibleTexto(sensibleDraft);
      setEditandoSensible(false);
      setSensibleMsg("Guardado");
      setTimeout(() => setSensibleMsg(""), 2000);
      onChanged();
    } catch (e: any) {
      setSensibleMsg(e.message ?? "Error");
    } finally { setLoadingSensible(false); }
  }

  const FREC_SHORT: Record<string, string> = {
    diaria: "Diaria", cada_2_dias: "Cada 2 días", cada_3_dias: "Cada 3 días",
    semanal: "Semanal", quincenal: "Quincenal", mensual: "Mensual",
    bimestral: "Bimestral", trimestral: "Trimestral", semestral: "Semestral",
  };

  const pasosCompletados = pasos.filter((p) => p.completado).length;
  const pasosTotal = pasos.length;

  if (esSolicitudCompraDelegada(ticket)) {
    return (
      <div className={`flex flex-col gap-2 rounded-xl border border-blue-400/40 bg-surface p-3 shadow-sm transition-opacity ${resuelta ? "opacity-60" : ""}`}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-sm font-bold text-ink">🛒 {ticket.titulo}</span>
            <p className="mt-0.5 text-xs text-muted font-mono">{ticket.numero}</p>
          </div>
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px]">
            {ESTADO_LABEL[ticket.estado] ?? ticket.estado}
          </span>
        </div>
        <p className="text-xs text-muted">
          {esCreadoPorMi ? "Delegaste esta lista" : `Te la asignó ${ticket.creado_por_nombre ?? "?"}`}
        </p>
        <SolicitudCompraChecklist
          ticket={ticket}
          token={token}
          user={user}
          onChanged={onChanged}
          supervision={supervision}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm transition-opacity ${resuelta ? "opacity-60" : ""}`}>
      {/* Encabezado */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-ink">{ticket.titulo}</span>
          {ticket.descripcion && ticket.descripcion !== ticket.titulo && (
            <p className="mt-0.5 text-xs text-muted line-clamp-2">{ticket.descripcion}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORIDAD_COLOR[ticket.prioridad ?? "media"] ?? "bg-gray-200 text-gray-700"}`}>
          {ticket.prioridad ?? "media"}
        </span>
        {/* Ícono de datos sensibles */}
        <button
          type="button"
          title={ticket.tiene_datos_sensibles ? "Ver datos sensibles 🔒" : "Agregar datos sensibles 🔓"}
          onClick={() => {
            setShowSensible((v) => !v);
            if (!showSensible) void cargarSensible();
          }}
          className={`shrink-0 rounded p-0.5 transition-colors ${ticket.tiene_datos_sensibles ? "text-yellow-500 hover:text-yellow-400" : "text-muted hover:text-accent"}`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </button>
        {(isAdmin || esCreadoPorMi) && !confirmDelete && (
          <button type="button" title="Eliminar" onClick={() => setConfirmDelete(true)}
            className="shrink-0 rounded p-0.5 text-muted hover:text-red-600 transition-colors">
            <Icon name="trash" size={13} />
          </button>
        )}
        {(isAdmin || esCreadoPorMi) && confirmDelete && (
          <div className="flex items-center gap-1">
            <button type="button" disabled={busy} onClick={eliminar}
              className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-red-700">Sí</button>
            <button type="button" onClick={() => setConfirmDelete(false)}
              className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-bold text-muted hover:text-ink">No</button>
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1">
          <Icon name="user" size={11} />
          {esCreadoPorMi ? "Solicitado por ti" : `Solicitado por ${ticket.creado_por_nombre ?? "?"}`}
        </span>
        <span className="flex items-center gap-1">
          <Icon name="user" size={11} />
          Para: <strong className="text-ink">{ticket.asignado_a_nombre ?? "Sin asignar"}</strong>
        </span>
        {ticket.frecuencia && (
          <span className="flex items-center gap-1">
            ♻️ {FREC_SHORT[ticket.frecuencia] ?? ticket.frecuencia}
          </span>
        )}
        {/* Progreso de pasos en header */}
        {(ticket.pasos_total ?? 0) > 0 && !showPasos && (
          <button type="button" onClick={() => { setShowPasos(true); void cargarPasos(); }}
            className="flex items-center gap-1 text-accent hover:underline">
            ☑ {ticket.pasos_completados}/{ticket.pasos_total} pasos
          </button>
        )}
        {ticket.protocolo_titulo && (
          <span className="flex items-center gap-1 text-accent/90" title="Procedimiento vinculado">
            📋 {ticket.protocolo_titulo}
          </span>
        )}
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px]">
          {ESTADO_LABEL[ticket.estado] ?? ticket.estado}
        </span>
      </div>

      {/* Banner: esta solicitud ES una intervención que otro usuario necesita */}
      {esIntervencion && (
        <div className="rounded-lg border border-orange-400/60 bg-orange-50/60 dark:bg-orange-900/15 px-3 py-2.5 space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold text-orange-700 dark:text-orange-400">
            <span>🛑</span>
            <span>Intervención solicitada</span>
          </div>
          <p className="text-xs text-orange-700/80 dark:text-orange-300/80 leading-snug">
            <strong>{ticket.creado_por_nombre ?? "Un compañero"}</strong> necesita tu ayuda
            para continuar{ticket.ticket_padre_numero ? ` el ticket ${ticket.ticket_padre_numero}` : ""}.
            {ticket.ticket_padre_titulo ? ` — ${ticket.ticket_padre_titulo}` : ""}
          </p>
          {ticket.descripcion && ticket.descripcion !== ticket.titulo && (
            <p className="text-xs text-orange-600/70 dark:text-orange-400/70 italic">
              {ticket.descripcion}
            </p>
          )}
        </div>
      )}

      {/* Bloqueado por intervención */}
      {ticket.bloqueado_por && (
        <div className="rounded-lg border border-yellow-400/40 bg-yellow-50/50 dark:bg-yellow-900/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Esperando intervención <strong>{ticket.bloqueado_por_numero}</strong>
        </div>
      )}

      {/* Datos sensibles */}
      {showSensible && (
        <div className="rounded-xl border border-yellow-400/50 bg-yellow-50/30 dark:bg-yellow-900/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
              🔒 Datos sensibles / Protocolo privado
              <InfoTooltip text="Visible solo para el asignado, quien creó la solicitud, participantes directos y supervisores. Aquí puedes guardar contraseñas, procedimientos internos o notas confidenciales de resolución. Solo supervisores pueden editar." />
            </span>
            <button type="button" onClick={() => setShowSensible(false)} className="text-muted hover:text-ink text-xs">✕</button>
          </div>
          {loadingSensible && <p className="text-xs text-muted">Cargando…</p>}
          {sensibleMsg && <p className="text-xs text-accent">{sensibleMsg}</p>}
          {!loadingSensible && !puedeVerSensible && (
            <p className="text-xs text-muted">Sin permisos para ver datos sensibles.</p>
          )}
          {!loadingSensible && puedeVerSensible && !editandoSensible && (
            <>
              <p className="text-xs text-ink whitespace-pre-wrap min-h-[2rem]">
                {sensibleTexto || <span className="text-muted italic">Sin datos sensibles aún.</span>}
              </p>
              {nivel >= 2 && (
                <button type="button" onClick={() => { setEditandoSensible(true); setSensibleDraft(sensibleTexto); }}
                  className="text-xs text-accent hover:underline">Editar</button>
              )}
            </>
          )}
          {!loadingSensible && puedeVerSensible && editandoSensible && (
            <div className="space-y-2">
              <textarea
                className="quest-input w-full resize-none text-xs"
                rows={4}
                placeholder="Escribe aquí contraseñas, pasos de resolución, notas privadas…"
                value={sensibleDraft}
                onChange={(e) => setSensibleDraft(e.target.value)}
              />
              <div className="flex gap-2">
                <button type="button" disabled={loadingSensible} onClick={guardarSensible}
                  className="quest-btn-primary px-3 py-1 text-xs">Guardar</button>
                <button type="button" onClick={() => setEditandoSensible(false)} className="text-xs text-muted hover:text-ink">Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Comentarios / respuestas de intervención */}
      {comentarios.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-hover p-3 space-y-2">
          <button type="button"
            onClick={() => setShowComentarios((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-bold text-ink">
            <span>
              💬 Respuestas{comentarios.length > 0 && <span className="ml-1 font-normal text-muted">({comentarios.length})</span>}
            </span>
            <span className="text-muted">{showComentarios ? "▲" : "▼"}</span>
          </button>
          {showComentarios && (
            <div className="space-y-2 pt-1">
              {loadingComentarios && <p className="text-xs text-muted">Cargando…</p>}
              {comentarios.map((c) => (
                <div key={c.id} className={`rounded-lg px-3 py-2 text-xs ${c.es_interno ? "bg-surface border border-border/50" : "bg-accent/5 border border-accent/20"}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold text-ink">{c.autor_nombre}</span>
                    <span className="text-muted shrink-0">{new Date(c.creado_en).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-ink/90 leading-relaxed">{c.texto}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Adjuntos */}
      {(adjuntos.length > 0 || showAdjuntos) && (
        <div className="rounded-xl border border-border bg-surface-hover p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-ink">
              📎 Adjuntos {adjuntos.length > 0 && <span className="font-normal text-muted">({adjuntos.length})</span>}
            </span>
            <div className="flex items-center gap-2">
              {(esAsignado || esCreadoPorMi || nivel >= 2) && !resuelta && (
                <label title="Subir archivo adjunto" className="cursor-pointer flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-[10px] font-semibold text-muted hover:border-accent hover:text-accent transition-colors">
                  {subiendoAdjTicket
                    ? <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    : <span>+ Subir</span>
                  }
                  <input
                    type="file"
                    accept="image/*,.pdf,application/pdf,.doc,.docx"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void subirAdjuntoTicket(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <button type="button" onClick={() => setShowAdjuntos(false)} className="text-muted hover:text-ink text-xs">▲</button>
            </div>
          </div>
          {loadingAdjuntos && <p className="text-xs text-muted">Cargando…</p>}
          {!loadingAdjuntos && adjuntos.length === 0 && (
            <p className="text-xs text-muted italic">Sin archivos adjuntos.</p>
          )}
          <div className="space-y-1">
            {adjuntos.map((a) => {
              const esImagen = /\.(jpg|jpeg|png|gif|webp)$/i.test(a.nombre_original);
              const esPdf = /\.pdf$/i.test(a.nombre_original);
              const icono = esImagen ? "🖼" : esPdf ? "📄" : "📁";
              const url = ticketsUploadUrl(a.nombre_archivo, token);
              return (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-surface px-2 py-1.5">
                  {esImagen ? (
                    <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={url} alt={a.nombre_original} className="h-8 w-8 rounded object-cover border border-border" />
                    </a>
                  ) : (
                    <span className="text-base shrink-0">{icono}</span>
                  )}
                  <a href={url} target="_blank" rel="noreferrer"
                    className="min-w-0 flex-1 text-xs text-accent hover:underline truncate">
                    {a.nombre_original}
                  </a>
                  {a.creado_por_nombre && (
                    <span className="text-[10px] text-muted shrink-0 hidden sm:inline">{a.creado_por_nombre}</span>
                  )}
                  {(nivel >= 2 || ticket.creado_por === user.id) && (
                    <button type="button" disabled={eliminandoAdj === a.id}
                      onClick={() => void eliminarAdjunto(a.id)}
                      className="shrink-0 text-muted hover:text-red-500 transition-colors p-0.5">
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Checklist de pasos — con edición inline, agregar paso y botón de intervención por paso */}
      {showPasos && (
        <div className="rounded-xl border border-border bg-surface-hover p-3 space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-ink flex items-center gap-1">
              Protocolo de pasos
              <InfoTooltip text="Manual de operación: marca cada paso al completarlo. Puedes editar o agregar pasos en cualquier momento. Si un paso necesita que otro usuario haga algo, usa el botón 🛑 para pedir intervención en ese paso específico." />
              {pasosTotal > 0 && <span className="text-muted font-normal">({pasosCompletados}/{pasosTotal})</span>}
              {ticket.protocolo_titulo && (
                <span className="text-[10px] font-normal text-accent bg-accent/10 rounded-full px-2 py-0.5">
                  📋 {ticket.protocolo_titulo}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {puedeVincularProtocolo && protocolos.length > 0 && (
                <button type="button"
                  onClick={() => setShowVincularProtocolo((v) => !v)}
                  className="text-[10px] text-accent hover:underline">
                  {showVincularProtocolo ? "Cancelar" : "Enlazar procedimiento"}
                </button>
              )}
              <button type="button" onClick={() => setShowPasos(false)} className="text-muted hover:text-ink text-xs">▲</button>
            </div>
          </div>
          {vincularProtocoloMsg && <p className="text-xs text-accent">{vincularProtocoloMsg}</p>}
          {showVincularProtocolo && puedeVincularProtocolo && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-ink">Enlazar procedimiento estándar</p>
              <select
                className="quest-input w-full text-xs"
                value={protocoloVincularId}
                onChange={(e) => setProtocoloVincularId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Selecciona un procedimiento…</option>
                {protocolos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.titulo}{p.categoria ? ` (${p.categoria})` : ""} — {p.pasos.length} paso{p.pasos.length !== 1 ? "s" : ""}
                  </option>
                ))}
              </select>
              {(ticket.pasos_total ?? 0) > 0 && (
                <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer">
                  <input type="checkbox" checked={reemplazarPasosProtocolo}
                    onChange={(e) => setReemplazarPasosProtocolo(e.target.checked)}
                    className="rounded border-border accent-accent" />
                  Reemplazar pasos actuales por los del procedimiento
                </label>
              )}
              <button type="button"
                disabled={vinculandoProtocolo || !protocoloVincularId}
                onClick={() => void vincularProtocolo()}
                className="quest-btn-primary px-3 py-1 text-xs">
                {vinculandoProtocolo ? "Vinculando…" : "Vincular"}
              </button>
            </div>
          )}
          {loadingPasos && <p className="text-xs text-muted">Cargando pasos…</p>}
          {!loadingPasos && pasos.length === 0 && (
            <p className="text-xs text-muted italic">Sin pasos definidos. Agrega el primero abajo.</p>
          )}
          <div className="space-y-1">
            {pasos.map((p) => (
              <div key={p.id} className={`rounded-lg border px-2 py-1.5 transition-colors ${p.completado ? "border-transparent opacity-60" : "border-border/50 hover:bg-surface"}`}>
                {editandoPasoId === p.id ? (
                  /* Modo edición inline */
                  <div className="space-y-1.5">
                    <input autoFocus className="quest-input w-full text-xs" value={editPasoDesc}
                      onChange={(e) => setEditPasoDesc(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void guardarEditPaso(p)} />
                    <input className="quest-input w-full text-xs" placeholder="Notas (opcional)" value={editPasoNotas}
                      onChange={(e) => setEditPasoNotas(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void guardarEditPaso(p)}
                        className="text-xs text-accent hover:underline">Guardar</button>
                      <button type="button" onClick={() => setEditandoPasoId(null)}
                        className="text-xs text-muted hover:text-ink">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-start gap-2">
                      <input type="checkbox"
                        checked={pasoEstaCompletado(p)}
                        onChange={() => esAsignado && !supervision && !p.intervencion_pendiente_numero && void togglePaso(p)}
                        disabled={!esAsignado || supervision || !!p.intervencion_pendiente_numero}
                        className="mt-0.5 h-4 w-4 rounded border-border accent-accent shrink-0 cursor-pointer disabled:cursor-not-allowed" />
                      <div className="min-w-0 flex-1">
                        <span className={`text-xs ${pasoEstaCompletado(p) ? "line-through text-muted" : "text-ink"}`}>
                          <span className="text-muted mr-1">{p.orden}.</span>{p.descripcion}
                        </span>
                        {pasoEstaCompletado(p) && p.completado_por_nombre && (
                          <p className="text-[10px] text-muted">✓ {p.completado_por_nombre}</p>
                        )}
                      </div>
                      {/* Acciones del paso */}
                      {esAsignado && !supervision && !pasoEstaCompletado(p) && !p.intervencion_pendiente_numero && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" title="Editar paso" onClick={() => iniciarEditPaso(p)}
                            className="text-muted hover:text-accent transition-colors p-0.5">
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          {ticket.estado === "en_proceso" && !ticket.bloqueado_por && (
                            <button type="button" title="Necesito ayuda en este paso"
                              onClick={() => abrirIntervencionDesdePaso(p)}
                              className="text-muted hover:text-orange-500 transition-colors p-0.5 text-[10px]">
                              🛑
                            </button>
                          )}
                          <button type="button" title="Eliminar paso" onClick={() => void eliminarPasoInline(p.id)}
                            className="text-muted hover:text-red-500 transition-colors p-0.5">
                            <Icon name="trash" size={11} />
                          </button>
                        </div>
                      )}
                      {/* Adjuntar archivo al paso — visible para el ejecutor en cualquier estado */}
                      {esAsignado && !supervision && (
                        <label title="Adjuntar archivo a este paso" className="cursor-pointer text-muted hover:text-accent transition-colors p-0.5 shrink-0">
                          {subiendoAdjPaso === p.id
                            ? <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                            : <span className="text-[11px]">📎</span>
                          }
                          <input
                            type="file"
                            accept="image/*,.pdf,application/pdf,.doc,.docx"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void subirAdjuntoPaso(p.id, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                    {/* Intervención pendiente en este paso */}
                    {p.intervencion_pendiente_numero && (
                      <div className="ml-6 rounded-lg border border-orange-300/60 bg-orange-50/60 dark:bg-orange-900/15 px-2.5 py-1.5 text-[11px]">
                        <span className="font-semibold text-orange-700 dark:text-orange-400">
                          🛑 Esperando intervención {p.intervencion_pendiente_numero}
                        </span>
                        {p.intervencion_asignado_nombre && (
                          <span className="text-orange-600/70 dark:text-orange-400/70"> — asignada a <strong>{p.intervencion_asignado_nombre}</strong></span>
                        )}
                      </div>
                    )}
                    {/* Respuesta de la intervención resuelta */}
                    {p.respuesta_intervencion && !p.intervencion_pendiente_numero && (
                      <div className="ml-6 rounded-lg border border-green-300/60 bg-green-50/60 dark:bg-green-900/15 px-2.5 py-1.5 text-[11px] space-y-0.5">
                        <p className="font-semibold text-green-700 dark:text-green-400">✅ Intervención resuelta</p>
                        <p className="text-green-700/80 dark:text-green-300/80 whitespace-pre-wrap leading-relaxed">{p.respuesta_intervencion}</p>
                      </div>
                    )}
                    {/* Notas del paso (si no son respuesta de intervención) */}
                    {p.notas && !p.respuesta_intervencion && (
                      <p className="ml-6 text-[10px] text-muted">{p.notas}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Barra de progreso */}
          {pasosTotal > 0 && (
            <div className="h-1 rounded-full bg-border overflow-hidden">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(pasosCompletados / pasosTotal) * 100}%` }} />
            </div>
          )}
          {/* Agregar paso inline */}
          {esAsignado && !supervision && (
            showAddPaso ? (
              <div className="flex gap-2 pt-1">
                <input autoFocus className="quest-input flex-1 text-xs" placeholder="Descripción del nuevo paso…"
                  value={nuevoPasoDesc} onChange={(e) => setNuevoPasoDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void agregarPasoInline()} />
                <button type="button" disabled={agregandoPaso || !nuevoPasoDesc.trim()} onClick={() => void agregarPasoInline()}
                  className="shrink-0 quest-btn-primary px-2 py-1 text-xs">
                  {agregandoPaso ? "…" : "Agregar"}
                </button>
                <button type="button" onClick={() => { setShowAddPaso(false); setNuevoPasoDesc(""); }}
                  className="shrink-0 text-muted hover:text-ink text-xs px-1">✕</button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowAddPaso(true)}
                className="flex items-center gap-1 text-xs text-accent hover:underline pt-0.5">
                <Icon name="plus" size={11} weight="bold" /> Agregar paso
              </button>
            )
          )}
        </div>
      )}

      {/* Modal: Pedir intervención */}
      {showIntervencion && (
        <div className="rounded-xl border border-orange-400/50 bg-orange-50/30 dark:bg-orange-900/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-700 dark:text-orange-400 flex items-center gap-1">
              🛑 Pedir intervención
              <InfoTooltip text="Crea una sub-solicitud para otro usuario. Esta solicitud quedará PAUSADA hasta que el otro usuario resuelva su tarea. Cuando termine, la solicitud se reactiva sola y puedes continuar donde quedaste." />
            </span>
            <button type="button" onClick={() => { setShowIntervencion(false); setInterForm({ titulo: "", descripcion: "", asignado_a: "", paso_ref: "", paso_id: 0 }); }} className="text-muted hover:text-ink text-xs">✕</button>
          </div>
          {interForm.paso_ref && (
            <p className="text-[10px] text-orange-600/80 bg-orange-100/50 dark:bg-orange-900/20 rounded px-2 py-1">
              Origen: {interForm.paso_ref}
            </p>
          )}
          <input
            className="quest-input w-full text-sm"
            placeholder="¿Qué necesita hacer el otro usuario?"
            value={interForm.titulo}
            onChange={(e) => setInterForm((f) => ({ ...f, titulo: e.target.value }))}
          />
          <textarea
            className="quest-input w-full text-xs resize-none"
            rows={2}
            placeholder="Contexto adicional — ¿por qué se necesita esta intervención?"
            value={interForm.descripcion}
            onChange={(e) => setInterForm((f) => ({ ...f, descripcion: e.target.value }))}
          />
          <select
            className="quest-input w-full text-sm"
            value={interForm.asignado_a}
            onChange={(e) => setInterForm((f) => ({ ...f, asignado_a: e.target.value }))}
          >
            <option value="">Selecciona a quién necesitas…</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={creandoInter || !interForm.titulo.trim() || !interForm.asignado_a}
              onClick={crearIntervencion}
              className="quest-btn-primary px-3 py-1.5 text-xs"
            >
              {creandoInter ? "Creando…" : "Solicitar intervención — pausar esta solicitud"}
            </button>
            <button type="button" onClick={() => { setShowIntervencion(false); setInterForm({ titulo: "", descripcion: "", asignado_a: "", paso_ref: "", paso_id: 0 }); }} className="text-xs text-muted hover:text-ink">Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista de compras */}
      {showCompras && (
        <div className="rounded-xl border border-blue-400/40 bg-blue-50/20 dark:bg-blue-900/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1">
              🛒 Lista de compras
              <InfoTooltip text="Agrega los productos que se deben comprar para esta solicitud. Puedes buscarlos en el catálogo de materiales o escribir uno nuevo. Marca los que ya se compraron." />
            </span>
            <button type="button" onClick={() => setShowCompras(false)} className="text-muted hover:text-ink text-xs">▲</button>
          </div>
          {loadingCompras && <p className="text-xs text-muted">Cargando…</p>}
          {/* Items existentes */}
          {compras.length > 0 && (
            <div className="space-y-1">
              {compras.map((item) => (
                <div key={item.id} className={`flex items-center gap-2 rounded-lg border border-border/40 px-2 py-1.5 text-xs ${item.comprado ? "opacity-50" : ""}`}>
                  <input type="checkbox" checked={!!item.comprado}
                    onChange={() => !supervision && void toggleComprado(item)}
                    className="h-3.5 w-3.5 accent-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className={item.comprado ? "line-through text-muted" : "text-ink"}>{item.nombre}</span>
                    {item.sku && <span className="ml-1 text-muted text-[10px]">({item.sku})</span>}
                    <span className="ml-1 text-muted">{item.cantidad} {item.unidad}</span>
                    {item.precio_estimado && <span className="ml-1 text-muted">${item.precio_estimado.toLocaleString("es-CO")}</span>}
                    {item.notas && <p className="text-[10px] text-muted">{item.notas}</p>}
                  </div>
                  {!supervision && (
                    <button type="button" onClick={() => void eliminarCompra(item.id)}
                      className="text-muted hover:text-red-500 shrink-0">
                      <Icon name="trash" size={11} />
                    </button>
                  )}
                </div>
              ))}
              {/* Total estimado */}
              {compras.some((i) => i.precio_estimado) && (
                <p className="text-[10px] text-right text-muted pt-0.5">
                  Total estimado: <strong className="text-ink">
                    ${compras.reduce((sum, i) => sum + (i.precio_estimado ?? 0) * i.cantidad, 0).toLocaleString("es-CO")}
                  </strong>
                </p>
              )}
            </div>
          )}
          {!loadingCompras && compras.length === 0 && (
            <p className="text-xs text-muted italic">Sin productos en la lista.</p>
          )}
          {/* Agregar producto */}
          {!supervision && (
            <div className="space-y-1.5 pt-1 border-t border-border/30">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">Agregar producto</p>
              <div className="relative">
                <input className="quest-input w-full text-xs"
                  placeholder="Buscar en catálogo o escribir nombre…"
                  value={busqProducto}
                  onChange={(e) => void buscarProducto(e.target.value)} />
                {resultadosBusq.length > 0 && (
                  <div className="absolute top-full left-0 z-50 w-full rounded-xl border border-border bg-surface shadow-xl mt-1 max-h-40 overflow-y-auto">
                    {resultadosBusq.map((prod) => (
                      <button key={prod.id} type="button"
                        onClick={() => seleccionarProductoCatalogo(prod)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-accent/10 border-b border-border/30 last:border-0">
                        <span className="font-medium text-ink">{prod.nombre}</span>
                        {prod.codigo && <span className="ml-1 text-muted">[{prod.codigo}]</span>}
                        <span className="ml-1 text-muted">{prod.unidad_medida}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5">
                <input className="quest-input w-16 text-xs" placeholder="Cant." type="number" min="0.01" step="0.01"
                  value={nuevoProducto.cantidad} onChange={(e) => setNuevoProducto((p) => ({ ...p, cantidad: e.target.value }))} />
                <input className="quest-input w-16 text-xs" placeholder="Unid."
                  value={nuevoProducto.unidad} onChange={(e) => setNuevoProducto((p) => ({ ...p, unidad: e.target.value }))} />
                <input className="quest-input flex-1 text-xs" placeholder="$ Precio est."
                  value={nuevoProducto.precio} onChange={(e) => setNuevoProducto((p) => ({ ...p, precio: e.target.value }))} />
                <button type="button" disabled={agregandoCompra || !nuevoProducto.nombre.trim()} onClick={() => void agregarCompra()}
                  className="shrink-0 quest-btn-primary px-2 py-1 text-xs">
                  {agregandoCompra ? "…" : "Agregar"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Intervención: interfaz dedicada ── */}
      {!resuelta && esAsignado && !supervision && esIntervencion && (
        <div className="space-y-2 pt-1">
          {msg && <p className="text-xs text-red-400">{msg}</p>}
          <textarea
            className="quest-input w-full resize-none text-sm"
            rows={3}
            placeholder="Escribe tu respuesta o resolución aquí…"
            value={resolucionInter}
            onChange={(e) => setResolucionInter(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !resolucionInter.trim()}
              onClick={() => void resolverIntervencion()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-orange-500 bg-orange-500 px-3 py-2.5 text-sm font-bold text-white min-h-[44px] transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              <Icon name="check" size={15} weight="bold" />
              {busy ? "Resolviendo…" : "Resolver intervención"}
            </button>
            <button type="button"
              onClick={() => { setShowAdjuntos(true); void cargarAdjuntos(); }}
              className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${showAdjuntos ? "border-accent text-accent" : "border-border text-muted hover:text-accent hover:border-accent"}`}>
              📎
            </button>
          </div>
          <p className="text-[10px] text-muted text-center">
            Tu respuesta quedará registrada y desbloqueará al compañero que la solicitó
          </p>
        </div>
      )}

      {/* ── Solicitud normal: interfaz estándar ── */}
      {!resuelta && esAsignado && !supervision && !esIntervencion && !esSolicitudCompraDelegada(ticket) && (
        <div className="space-y-2 pt-1">
          {msg && <p className="text-xs text-red-400">{msg}</p>}

          {/* Solicitud con protocolo → botón único que abre el wizard */}
          {onRegistrarEjecucion && ticket.protocolo_id ? (
            <div className="space-y-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => onRegistrarEjecucion(ticket)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-3 text-sm font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                <Icon name="lightning" size={15} weight="bold" />
                {ticket.estado === "en_proceso" ? "Continuar ejecución" : "Ejecutar procedimiento"}
              </button>
              {ticket.estado === "en_proceso" && (
                <button type="button" disabled={busy} onClick={iniciarPausar}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-yellow-400 bg-yellow-50 px-3 py-2 text-xs font-bold text-yellow-700 transition hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400 disabled:opacity-40"
                >
                  <Icon name="clock" size={13} weight="bold" /> Pausar
                </button>
              )}
            </div>
          ) : ticket.estado === "esperando_aprobacion" ? (
            /* En revisión — esperando al creador */
            <div className="rounded-xl border border-orange-400/50 bg-orange-50/30 dark:bg-orange-900/10 px-3 py-2.5 space-y-2">
              <p className="text-sm font-bold text-orange-700 dark:text-orange-400 flex items-center gap-2">
                🔔 Esperando revisión del solicitante
              </p>
              <p className="text-xs text-orange-600/80 dark:text-orange-400/70">
                {ticket.creado_por_nombre ?? "El solicitante"} debe aprobar para cerrar la solicitud.
              </p>
              <button type="button" disabled={busy} onClick={cancelarRevision}
                className="text-xs text-muted hover:text-ink border border-border rounded-lg px-3 py-1 transition-colors">
                Cancelar revisión — volver a en proceso
              </button>
            </div>
          ) : (
            /* Solicitud libre → Iniciar/Pausar + Listo + Solicitar revisión */
            <div className="space-y-2">
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={iniciarPausar}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-bold min-h-[44px] transition-colors ${
                    ticket.estado === "en_proceso"
                      ? "border-yellow-400 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400"
                      : "border-accent bg-accent/10 text-accent hover:bg-accent/20"
                  }`}
                >
                  <Icon name={ticket.estado === "en_proceso" ? "clock" : "lightning"} size={15} weight="bold" />
                  {ticket.estado === "en_proceso" ? "Pausar" : "Iniciar"}
                </button>
                {(() => {
                  const total = ticket.pasos_total ?? 0;
                  const hechos = ticket.pasos_completados ?? 0;
                  const pasosFaltantes = total > 0 ? total - hechos : 0;
                  return (
                    <button type="button" disabled={busy} onClick={resolver}
                      title={pasosFaltantes > 0 ? `Faltan ${pasosFaltantes} paso(s) por completar` : undefined}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-bold min-h-[44px] transition-colors ${
                        pasosFaltantes > 0
                          ? "border-border bg-surface-hover text-muted cursor-not-allowed"
                          : "border-green-500 bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400"
                      }`}
                    >
                      <Icon name="check" size={15} weight="bold" />
                      {pasosFaltantes > 0 ? `Listo (${hechos}/${total} pasos)` : "Listo"}
                    </button>
                  );
                })()}
              </div>
              {/* Solicitar revisión del solicitante */}
              {!showPedirRevision ? (
                <button type="button" disabled={busy}
                  onClick={() => setShowPedirRevision(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-orange-400/50 bg-orange-50/20 dark:bg-orange-900/10 px-3 py-2 text-xs font-bold text-orange-700 dark:text-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-900/20 transition-colors">
                  🔔 Solicitar revisión del solicitante
                </button>
              ) : (
                <div className="rounded-xl border border-orange-400/40 bg-orange-50/20 dark:bg-orange-900/10 p-3 space-y-2">
                  <p className="text-xs font-bold text-orange-700 dark:text-orange-400">
                    Solicitar revisión a {ticket.creado_por_nombre ?? "el solicitante"}
                  </p>
                  <textarea
                    className="quest-input w-full text-xs resize-none"
                    rows={2}
                    placeholder="Nota para el solicitante (opcional): qué revisó, cómo quedó…"
                    value={notaRevision}
                    onChange={(e) => setNotaRevision(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={pedirRevision}
                      className="flex-1 rounded-xl bg-orange-500 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-orange-600 transition-colors">
                      {busy ? "Enviando…" : "Enviar para revisión"}
                    </button>
                    <button type="button" onClick={() => { setShowPedirRevision(false); setNotaRevision(""); }}
                      className="rounded-xl border border-border px-3 py-2 text-xs text-muted hover:text-ink">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Botones secundarios */}
          <div className="flex flex-wrap gap-1.5">
            <button type="button"
              onClick={() => { setShowAdjuntos(true); void cargarAdjuntos(); }}
              className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${showAdjuntos ? "border-accent text-accent" : "border-border text-muted hover:text-accent hover:border-accent"}`}>
              📎 Adjuntos{adjuntos.length > 0 ? ` (${adjuntos.length})` : ""}
            </button>
            {/* Ver pasos solo para solicitudes sin protocolo (las de protocolo usan el wizard) */}
            {!(onRegistrarEjecucion && ticket.protocolo_id) && (ticket.pasos_total ?? 0) > 0 && !showPasos && (
              <button type="button" onClick={() => { setShowPasos(true); void cargarPasos(); }}
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted hover:text-accent hover:border-accent transition-colors">
                ☑ Ver pasos
              </button>
            )}
            {(ticket.pasos_total ?? 0) === 0 && !showPasos && puedeVincularProtocolo && protocolos.length > 0 && (
              <button type="button"
                onClick={() => { setShowPasos(true); setShowVincularProtocolo(true); void cargarPasos(); }}
                className="rounded-lg border border-accent/40 px-2 py-1.5 text-xs text-accent hover:bg-accent/10 transition-colors">
                📋 Enlazar procedimiento
              </button>
            )}
            {ticket.estado === "en_proceso" && !ticket.bloqueado_por && showPasos && (
              <button type="button" onClick={() => setShowAddPaso(true)}
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted hover:text-accent hover:border-accent transition-colors">
                + Paso
              </button>
            )}
            <button type="button"
              onClick={() => { setShowCompras((v) => !v); if (!showCompras) void cargarCompras(); }}
              className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${showCompras ? "border-blue-400 text-blue-600" : "border-border text-muted hover:text-blue-500 hover:border-blue-400"}`}>
              🛒 Compras{compras.length > 0 ? ` (${compras.length})` : ""}
            </button>
            {/* Intervención solo disponible por paso — botón general eliminado */}
          </div>
        </div>
      )}

      {/* Panel de aprobación — visible al creador cuando la solicitud espera revisión */}
      {!resuelta && esCreadoPorMi && !esAsignado && ticket.estado === "esperando_aprobacion" && (
        <div className="rounded-xl border-2 border-orange-400/50 bg-orange-50/30 dark:bg-orange-900/10 p-3 space-y-3">
          <p className="text-sm font-extrabold text-orange-700 dark:text-orange-400 flex items-center gap-2">
            🔔 {ticket.asignado_a_nombre ?? "El ejecutor"} completó la solicitud y pide tu revisión
          </p>
          {msg && <p className="text-xs text-red-400">{msg}</p>}

          {/* Aprobar */}
          <button type="button" disabled={busy} onClick={aprobar}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-3 py-2.5 text-sm font-extrabold text-white hover:bg-green-700 transition-colors disabled:opacity-40">
            <Icon name="check" size={15} weight="bold" />
            Aprobar y cerrar
          </button>

          {/* Pedir ajustes */}
          {!showPedirAjustes ? (
            <button type="button" disabled={busy}
              onClick={() => setShowPedirAjustes(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-orange-400/50 px-3 py-2 text-xs font-bold text-orange-700 dark:text-orange-400 hover:bg-orange-50/40 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-40">
              🔄 Pedir ajustes
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                autoFocus
                className="quest-input w-full text-xs resize-none"
                rows={3}
                placeholder="¿Qué necesita corregirse o completarse?"
                value={ajustesMensaje}
                onChange={(e) => setAjustesMensaje(e.target.value)}
              />
              <div className="flex gap-2">
                <button type="button" disabled={busy || !ajustesMensaje.trim()} onClick={pedirAjustes}
                  className="flex-1 rounded-xl bg-orange-500 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-orange-600 transition-colors">
                  {busy ? "Enviando…" : "Enviar ajustes"}
                </button>
                <button type="button" onClick={() => { setShowPedirAjustes(false); setAjustesMensaje(""); }}
                  className="rounded-xl border border-border px-3 py-2 text-xs text-muted hover:text-ink">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Rechazar */}
          <button type="button" disabled={busy} onClick={rechazarRevision}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/40 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50/30 dark:hover:bg-red-900/10 transition-colors disabled:opacity-40">
            ❌ Rechazar solicitud
          </button>
        </div>
      )}

      {/* Banner "solo el asignado puede resolver" — oculto cuando el creador tiene el panel de revisión */}
      {!resuelta && !esAsignado && !supervision
        && !(esCreadoPorMi && ticket.estado === "esperando_aprobacion") && (
        <div className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs text-muted text-center">
          {ticket.estado === "esperando_aprobacion"
            ? <span>🔔 Esperando revisión de <strong>{ticket.creado_por_nombre ?? "el solicitante"}</strong></span>
            : <span>Solo <strong>{ticket.asignado_a_nombre ?? "el asignado"}</strong> puede resolver esta solicitud</span>
          }
        </div>
      )}
      {!resuelta && supervision && !isAdmin && (
        <p className="text-[10px] text-center text-muted">Seguimiento del equipo — solo lectura</p>
      )}

      {/* Botón: guardar como protocolo (solo para tickets resueltos, nivel supervisor+) */}
      {resuelta && puedeCrearProtocolos(user) && (
        <div className="pt-1 space-y-2">
          {protocoloMsg && (
            <p className="text-xs text-accent">{protocoloMsg}</p>
          )}
          {!showProtocoloForm ? (
            <button
              type="button"
              onClick={() => {
                setProtocoloForm({ titulo: ticket.titulo, descripcion: ticket.descripcion ?? "", categoria: ticket.categoria ?? "" });
                setShowProtocoloForm(true);
              }}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-accent border border-dashed border-border hover:border-accent rounded-lg px-3 py-1.5 w-full justify-center transition-colors"
            >
              📋 Guardar como procedimiento estándar
            </button>
          ) : (
            <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 space-y-2">
              <p className="text-xs font-bold text-accent flex items-center gap-1">
                📋 Guardar como procedimiento
                <InfoTooltip text="Crea un procedimiento reutilizable a partir de esta solicitud resuelta. El procedimiento guardará todos los pasos ejecutados y servirá como plantilla para nuevas solicitudes del mismo tipo." />
              </p>
              <input
                className="quest-input w-full text-sm"
                placeholder="Nombre del procedimiento (ej: Pago a proveedor)"
                value={protocoloForm.titulo}
                onChange={(e) => setProtocoloForm((f) => ({ ...f, titulo: e.target.value }))}
              />
              <input
                className="quest-input w-full text-sm"
                placeholder="Categoría (ej: pagos, compras, logística)"
                value={protocoloForm.categoria}
                onChange={(e) => setProtocoloForm((f) => ({ ...f, categoria: e.target.value }))}
              />
              <textarea
                className="quest-input w-full text-xs resize-none"
                rows={2}
                placeholder="Descripción breve (opcional)"
                value={protocoloForm.descripcion}
                onChange={(e) => setProtocoloForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={guardandoProtocolo || !protocoloForm.titulo.trim()}
                  onClick={() => void guardarComoProtocolo()}
                  className="quest-btn-primary px-3 py-1 text-xs"
                >
                  {guardandoProtocolo ? "Guardando…" : "Guardar procedimiento"}
                </button>
                <button type="button" onClick={() => setShowProtocoloForm(false)} className="text-xs text-muted hover:text-ink">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── useStt: hook voz → texto reutilizable ────────────────────────────────────

function useStt(token: string, chatApiToken: string | null | undefined) {
  const [grabando, setGrabando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const [error, setError] = useState("");
  const [segundos, setSegundos] = useState(0);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);
  const onTextRef = useRef<((text: string) => void) | null>(null);

  async function iniciar(onText: (text: string) => void) {
    onTextRef.current = onText;
    setError("");
    setSegundos(0);
    unlockAudioContext();
    if (isMcKennaAndroidApp()) {
      const bridge = mckennaAndroidBridge();
      if (bridge?.hasAudioPermission && !bridge.hasAudioPermission()) {
        bridge.requestAudioPermission?.();
        setError("Concede el permiso de micrófono en el diálogo del sistema y toca el micrófono de nuevo.");
        return;
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        const durSeg = Math.round((Date.now() - startRef.current) / 1000);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        if (blob.size === 0 || durSeg < 1) {
          setError("Grabación muy corta. Habla al menos 1 segundo.");
          setGrabando(false);
          return;
        }
        setTranscribiendo(true);
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
            setError(`Error del servidor (${res.status}). ¿Está activo Whisper?`);
          } else {
            const data = await res.json();
            const texto = (data.texto ?? "").trim();
            if (texto) {
              onTextRef.current?.(texto);
              setError("");
            } else {
              setError("Whisper no detectó palabras. Habla más cerca del micrófono e intenta de nuevo.");
            }
          }
        } catch {
          setError("Sin conexión con el servidor. Verifica que agente-pro esté activo.");
        }
        setTranscribiendo(false);
        setGrabando(false);
        setSegundos(0);
      };
      mrRef.current = mr;
      startRef.current = Date.now();
      mr.start(250);
      setGrabando(true);
      timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        setError(
          isMcKennaAndroidApp()
            ? "Permiso denegado. Ve a Ajustes del teléfono → Aplicaciones → McKenna → Permisos → Micrófono y actívalo."
            : "Permiso de micrófono denegado. Habilítalo en la configuración del navegador."
        );
      } else if (e.name === "NotFoundError") {
        setError("No se encontró micrófono en este dispositivo.");
      } else {
        setError(`Error al acceder al micrófono: ${e.message}`);
      }
    }
  }

  function detener() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const mr = mrRef.current;
    if (mr && (mr.state === "recording" || mr.state === "paused")) {
      mr.stop();
    } else {
      setGrabando(false);
      setTranscribiendo(false);
    }
  }

  return { grabando, transcribiendo, error, setError, segundos, iniciar, detener };
}

const MIC_ICON = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
  </svg>
);

const STOP_ICON = (
  <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);

function SttBanner({ stt }: { stt: ReturnType<typeof useStt> }) {
  if (!stt.grabando) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-red-400/60 bg-red-500/10 px-4 py-3">
      <span className="h-3 w-3 shrink-0 rounded-full bg-red-400 animate-pulse" />
      <span className="font-mono text-sm font-bold text-red-400 tabular-nums">
        {String(Math.floor(stt.segundos / 60)).padStart(2, "0")}:{String(stt.segundos % 60).padStart(2, "0")}
      </span>
      <span className="flex-1 text-sm text-red-400">Grabando…</span>
      <button
        type="button"
        onClick={stt.detener}
        className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white min-h-[44px] shadow-md active:bg-red-700 hover:bg-red-600 transition-colors"
      >
        {STOP_ICON}
        Detener grabación
      </button>
    </div>
  );
}

function SttInlineBtn({ stt, onStart, label = "Voz" }: {
  stt: ReturnType<typeof useStt>;
  onStart: () => void;
  label?: string;
}) {
  if (stt.grabando) {
    return (
      <button
        type="button"
        onClick={stt.detener}
        title="Detener grabación"
        className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500 px-3 py-2.5 text-sm font-bold text-white min-h-[44px] min-w-[72px] shadow active:bg-red-700 hover:bg-red-600 transition-colors"
      >
        {STOP_ICON}
        Stop
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={stt.transcribiendo}
      title="Dictar por voz (Whisper STT)"
      className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm min-h-[44px] text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
    >
      {stt.transcribiendo
        ? <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
        : MIC_ICON
      }
      <span className="hidden sm:inline">{stt.transcribiendo ? "…" : label}</span>
    </button>
  );
}

// ── Wizard: registrar nueva acción (estilo misión simple) ─────────────────────

type UnidadCompra = "g" | "u";
type ItemCompraAccion = { n: string; cantidad: string; unidad: UnidadCompra; comprado: boolean };
type PasoAccionDraft = {
  nombre: string;
  desc: string;
  foto?: File | null;
  adjuntos_ref?: { nombre_archivo: string; mime: string }[];
};
type FaseAccionWizard = "titulo" | "compras_lista" | "compras_tienda" | "pasos" | "cierre";

function nuevoItemCompra(): ItemCompraAccion {
  return { n: "", cantidad: "", unidad: "g", comprado: false };
}

function formatCantidadItem(m: ItemCompraAccion): string {
  const q = m.cantidad.trim();
  if (!q) return "";
  return m.unidad === "g" ? `${q} g` : `${q} u`;
}

function notasListaCompras(items: ItemCompraAccion[]): string {
  const ok = items.filter((m) => m.n.trim());
  return "📦 Lista de compras:\n"
    + ok.map((m) => {
      const c = formatCantidadItem(m);
      return `• ${m.n.trim()}${c ? ` — ${c}` : ""}`;
    }).join("\n");
}

function indiceProgresoWizard(fase: FaseAccionWizard, conCompras: boolean): number {
  if (fase === "titulo") return 1;
  if (fase === "compras_lista") return 2;
  if (fase === "compras_tienda") return 3;
  if (fase === "pasos") return conCompras ? 4 : 3;
  return conCompras ? 5 : 4;
}

/** Estado para reabrir el asistente donde el operador lo dejó. */
type ResumeAccionState = {
  ticketId: number;
  faseInicial: FaseAccionWizard;
  plantilla: PlantillaAccion;
  subCompras: "idle" | "editando";
  pasoComprasId: number | null;
  bloqueoCompras: {
    solicitud_id: number;
    numero: string;
    titulo: string;
    asignado_nombre: string | null;
    estado?: string;
  } | null;
  bloqueadoIntervencion?: string | null;
  ticket: Ticket;
};

async function cargarEstadoReanudacion(ticketId: number, token: string): Promise<ResumeAccionState> {
  const [det, pasosRaw, bloqueoResp] = await Promise.all([
    tapi(`/${ticketId}`, token) as Promise<Ticket>,
    tapi(`/${ticketId}/pasos`, token) as Promise<Paso[]>,
    tapi(`/${ticketId}/bloqueo-compras`, token) as Promise<{ bloqueo: ResumeAccionState["bloqueoCompras"] }>,
  ]);
  const pasosArr = Array.isArray(pasosRaw) ? pasosRaw : [];
  let listaCompras: ItemCompraAccion[] = [];
  const pasosEj: PasoAccionDraft[] = [];
  let pasoComprasId: number | null = null;
  let pasoComprasHecho = false;

  for (const p of pasosArr) {
    if (p.descripcion === "Ir de compras") {
      pasoComprasId = p.id;
      pasoComprasHecho = pasoEstaCompletado(p);
      listaCompras = parseListaComprasDesdeNotas((p.notas as string) || "");
      if (pasoComprasHecho) {
        listaCompras = listaCompras.map((it) => ({ ...it, comprado: true }));
      }
    } else if (p.descripcion) {
      pasosEj.push({ nombre: p.descripcion, desc: (p.notas as string) || "" });
    }
  }

  const bloqueo = bloqueoResp.bloqueo ?? null;
  const conCompras = listaCompras.length > 0;
  const pasosEnServidor = pasosArr.filter((p) => p.descripcion !== "Ir de compras").length > 0;

  let fase: FaseAccionWizard = "compras_lista";
  let subCompras: "idle" | "editando" = "idle";

  if (bloqueo) {
    fase = "compras_lista";
    subCompras = "editando";
  } else if (conCompras && !pasoComprasHecho) {
    fase = "compras_tienda";
    subCompras = "editando";
  } else if (pasosEnServidor) {
    fase = "cierre";
  } else if (conCompras && pasoComprasHecho) {
    fase = "pasos";
    subCompras = "editando";
  } else if (det.estado === "en_proceso" || (det.segundos_trabajo ?? 0) > 0) {
    fase = "compras_lista";
    subCompras = conCompras ? "editando" : "idle";
  }

  const plantilla: PlantillaAccion = {
    titulo: det.titulo,
    protocoloId: det.protocolo_id ?? undefined,
    listaCompras,
    pasos: pasosEj,
  };

  return {
    ticketId,
    faseInicial: fase,
    plantilla,
    subCompras,
    pasoComprasId,
    bloqueoCompras: bloqueo,
    bloqueadoIntervencion: det.bloqueado_por ? (det.bloqueado_por_numero ?? `TCK-${det.bloqueado_por}`) : null,
    ticket: det,
  };
}

function NuevaAccionWizard({
  token,
  user,
  chatApiToken,
  tituloInicial = "",
  plantilla,
  reanudar,
  solicitudPadreId,
  onCancel,
  onCreated,
}: {
  token: string;
  user: TicketsUser;
  chatApiToken: string | null | undefined;
  tituloInicial?: string;
  plantilla?: PlantillaAccion;
  /** Reanudar acción en curso (misma UI, fase inferida del servidor). */
  reanudar?: ResumeAccionState;
  solicitudPadreId?: number;
  onCancel: () => void;
  onCreated: (ticketId: number) => void;
}) {
  const stt = useStt(token, chatApiToken);
  const plantillaEff = reanudar?.plantilla ?? plantilla;
  const [fase, setFase] = useState<FaseAccionWizard>(
    reanudar?.faseInicial ?? (plantillaEff ? "compras_lista" : "titulo"),
  );
  const [wizardDir, setWizardDir] = useState<"right" | "left">("right");
  const [titulo, setTitulo] = useState(plantillaEff?.titulo ?? tituloInicial);
  const [conCompras, setConCompras] = useState((plantillaEff?.listaCompras?.length ?? 0) > 0);
  const [subCompras, setSubCompras] = useState<"idle" | "editando">(
    reanudar?.subCompras ?? ((plantillaEff?.listaCompras?.length ?? 0) > 0 ? "editando" : "idle"),
  );
  const [listaCompras, setListaCompras] = useState<ItemCompraAccion[]>(
    plantillaEff?.listaCompras?.length ? plantillaEff.listaCompras : [],
  );
  const [pasosGuardados, setPasosGuardados] = useState<PasoAccionDraft[]>(plantillaEff?.pasos ?? []);
  const [reporteSolicitud, setReporteSolicitud] = useState("");
  const [guardarComoProcedimiento, setGuardarComoProcedimiento] = useState(false);
  const [alcanceProcedimiento, setAlcanceProcedimiento] = useState<"personal" | "global">("personal");
  const [pasoNombre, setPasoNombre] = useState("");
  const [pasoDesc, setPasoDesc] = useState("");
  const [pasoFoto, setPasoFoto] = useState<File | null>(null);
  const [editandoPasoIdx, setEditandoPasoIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ticketId, setTicketId] = useState<number | null>(reanudar?.ticketId ?? null);
  const [pasoComprasId, setPasoComprasId] = useState<number | null>(reanudar?.pasoComprasId ?? null);
  const [bloqueadoIntervencion, setBloqueadoIntervencion] = useState<string | null>(
    reanudar?.bloqueadoIntervencion ?? null,
  );
  const [facturaFile, setFacturaFile] = useState<File | null>(null);
  const [facturaPreview, setFacturaPreview] = useState<string | null>(null);
  const [cierreArchivo, setCierreArchivo] = useState<File | null>(null);
  const [cierrePreview, setCierrePreview] = useState<string | null>(null);
  const [usuariosDelegar, setUsuariosDelegar] = useState<UserInfo[]>([]);
  const [delegarAId, setDelegarAId] = useState<number | "">("");
  const [delegacionMsg, setDelegacionMsg] = useState("");
  const [bloqueoCompras, setBloqueoCompras] = useState<{
    solicitud_id: number;
    numero: string;
    titulo: string;
    asignado_nombre: string | null;
    estado?: string;
  } | null>(reanudar?.bloqueoCompras ?? null);
  const [showInterPaso, setShowInterPaso] = useState(false);
  const [interPasoIdx, setInterPasoIdx] = useState<number | null>(null);
  const [interForm, setInterForm] = useState({ titulo: "", descripcion: "", asignado_a: "" });
  const [creandoInter, setCreandoInter] = useState(false);

  const inicioRef = useRef<number | null>(null);
  const [segBase, setSegBase] = useState(0);
  const [segLive, setSegLive] = useState(0);
  const [cronometroActivo, setCronometroActivo] = useState(false);
  const corridaIdRef = useRef<number | null>(null);

  const maxProgreso = conCompras ? 5 : 4;
  const progresoActual = indiceProgresoWizard(fase, conCompras);
  const segDisplay = segBase + segLive;
  const itemsCompraOk = listaCompras.filter((m) => m.n.trim());
  const todosComprados = itemsCompraOk.length > 0 && itemsCompraOk.every((m) => m.comprado);

  useEffect(() => {
    const iv = setInterval(() => {
      if (inicioRef.current == null) return;
      const s = Math.floor((Date.now() - inicioRef.current) / 1000);
      setSegLive((p) => (p === s ? p : s));
    }, 250);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    return () => {
      if (facturaPreview) URL.revokeObjectURL(facturaPreview);
      if (cierrePreview) URL.revokeObjectURL(cierrePreview);
    };
  }, [facturaPreview, cierrePreview]);

  useEffect(() => {
    if (!["compras_lista", "pasos"].includes(fase) || usuariosDelegar.length > 0) return;
    tapi("/usuarios", token)
      .then((data) => setUsuariosDelegar(Array.isArray(data) ? data : []))
      .catch(() => setUsuariosDelegar([]));
  }, [fase, token, usuariosDelegar.length]);

  const refrescarBloqueoCompras = useCallback(async (tid?: number) => {
    const id = tid ?? ticketId;
    if (!id) return;
    try {
      const data = await tapi(`/${id}/bloqueo-compras`, token) as {
        bloqueo: typeof bloqueoCompras;
      };
      setBloqueoCompras(data.bloqueo ?? null);
    } catch {
      setBloqueoCompras(null);
    }
  }, [ticketId, token]);

  useEffect(() => {
    if (!ticketId) return;
    void refrescarBloqueoCompras(ticketId);
    const iv = setInterval(() => void refrescarBloqueoCompras(ticketId), 8000);
    return () => clearInterval(iv);
  }, [ticketId, refrescarBloqueoCompras]);

  useEffect(() => {
    if (!reanudar) return;
    const t = reanudar.ticket;
    setBloqueoCompras(reanudar.bloqueoCompras);
    setBloqueadoIntervencion(reanudar.bloqueadoIntervencion ?? null);
    if (t.corrida) {
      corridaIdRef.current = t.corrida.id ?? null;
      setSegBase(t.corrida.segundos_acumulados ?? t.segundos_trabajo ?? 0);
      if (t.corrida.estado === "activa" && t.corrida.iniciada_en) {
        const srvTs = parseUtcTs(t.corrida.iniciada_en);
        inicioRef.current = srvTs;
        _timerStore.set(reanudar.ticketId, srvTs);
        setCronometroActivo(true);
        setSegLive(Math.max(0, Math.floor((Date.now() - srvTs) / 1000)));
      } else {
        inicioRef.current = null;
        _timerStore.delete(reanudar.ticketId);
        setCronometroActivo(false);
        setSegLive(0);
      }
    } else if ((t.segundos_trabajo ?? 0) > 0) {
      setSegBase(t.segundos_trabajo ?? 0);
    }
    if (reanudar.bloqueoCompras) setConCompras(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function irFase(next: FaseAccionWizard) {
    const orden: FaseAccionWizard[] = ["titulo", "compras_lista", "compras_tienda", "pasos", "cierre"];
    const prev = orden.indexOf(fase);
    const nxt = orden.indexOf(next);
    setWizardDir(nxt >= prev ? "right" : "left");
    setFase(next);
    setError("");
  }

  async function asegurarTicketIniciado(): Promise<number> {
    if (ticketId) return ticketId;
    const ticket = await tapi("/", token, {
      method: "POST",
      body: JSON.stringify({
        titulo: titulo.trim(),
        descripcion: titulo.trim(),
        prioridad: "media",
        categoria: solicitudPadreId ? "logistica" : "logistica",
        asignado_a: user.id,
        tipo: "accion",
        ticket_padre_id: solicitudPadreId ?? undefined,
        protocolo_id: plantilla?.protocoloId,
      }),
    }) as Ticket;
    const tid = ticket.id;
    setTicketId(tid);
    const t0 = Date.now();
    inicioRef.current = t0;
    setSegLive(0);
    setCronometroActivo(true);
    try {
      const data = await tapi(`/${tid}/corridas/iniciar`, token, {
        method: "POST",
        body: JSON.stringify({ segundos_previos: 0 }),
      }) as Ticket;
      if (data.corrida) {
        corridaIdRef.current = data.corrida.id ?? null;
        setSegBase(data.corrida.segundos_acumulados ?? 0);
        if (data.corrida.iniciada_en) {
          const srvTs = parseUtcTs(data.corrida.iniciada_en);
          if (srvTs < t0 && t0 - srvTs < 30_000) inicioRef.current = srvTs;
        }
      }
    } catch { /* cronómetro local sigue */ }
    return tid;
  }

  async function avanzarDesdeTitulo() {
    if (!titulo.trim()) return;
    setLoading(true);
    setError("");
    try {
      await asegurarTicketIniciado();
      irFase("compras_lista");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar la acción");
    } finally {
      setLoading(false);
    }
  }

  async function delegarListaCompras() {
    if (!delegarAId) {
      setError("Elige quién irá de compras");
      return;
    }
    const items = listaCompras.filter((m) => m.n.trim());
    if (items.length === 0) {
      setError("Agrega productos antes de delegar");
      return;
    }
    setLoading(true);
    setError("");
    setDelegacionMsg("");
    try {
      const tid = await asegurarTicketIniciado();
      const res = await tapi(`/${tid}/delegar-compras`, token, {
        method: "POST",
        body: JSON.stringify({ asignado_a: delegarAId, items }),
      }) as { solicitud?: Ticket; accion?: Ticket };
      const sol = res.solicitud;
      const nombre = usuariosDelegar.find((u) => u.id === delegarAId)?.nombre ?? "compañero";
      if (sol) {
        setDelegacionMsg(`Solicitud ${sol.numero} creada para ${nombre}`);
        setBloqueoCompras({
          solicitud_id: sol.id,
          numero: sol.numero,
          titulo: sol.titulo,
          asignado_nombre: nombre,
          estado: sol.estado,
        });
      } else {
        setDelegacionMsg(`Lista enviada a ${nombre}`);
      }
      setDelegarAId("");
      void refrescarBloqueoCompras(tid);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo delegar la lista");
    } finally {
      setLoading(false);
    }
  }

  function pantallaEsperaCompras() {
    if (!bloqueoCompras) return null;
    return (
      <div className="rounded-2xl border-2 border-amber-400/60 bg-amber-50/80 dark:bg-amber-950/30 p-4 space-y-3">
        <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200">
          Esperando compras delegadas
        </p>
        <p className="text-sm text-amber-800/90 dark:text-amber-100/90">
          <strong>{bloqueoCompras.asignado_nombre ?? "Tu compañero"}</strong> está con la lista
          ({bloqueoCompras.numero}). Cuando marque <em>Terminé las compras</em>, podrás continuar.
        </p>
        <p className="text-xs text-muted font-mono">{bloqueoCompras.titulo}</p>
        <button
          type="button"
          disabled={loading}
          onClick={() => void refrescarBloqueoCompras()}
          className="w-full rounded-xl border border-amber-500/50 py-2 text-xs font-bold text-amber-800 dark:text-amber-200"
        >
          Actualizar estado
        </button>
      </div>
    );
  }

  async function pedirIntervencionPaso() {
    if (!interForm.titulo.trim() || !interForm.asignado_a) return;
    const paso = interPasoIdx != null ? pasosGuardados[interPasoIdx] : null;
    setCreandoInter(true);
    setError("");
    try {
      const tid = ticketId ?? await asegurarTicketIniciado();
      const desc = paso
        ? `${interForm.descripcion}\n\n[Paso: ${paso.nombre}]`
        : interForm.descripcion;
      await tapi(`/${tid}/pedir-intervencion`, token, {
        method: "POST",
        body: JSON.stringify({
          titulo: interForm.titulo.trim(),
          descripcion: desc.trim(),
          asignado_a: Number(interForm.asignado_a),
        }),
      });
      setShowInterPaso(false);
      setInterForm({ titulo: "", descripcion: "", asignado_a: "" });
      setInterPasoIdx(null);
      await refrescarBloqueoCompras(tid);
      setError("");
      setDelegacionMsg("Intervención solicitada — la acción queda en pausa hasta que respondan");
      setTimeout(() => setDelegacionMsg(""), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al pedir intervención");
    } finally {
      setCreandoInter(false);
    }
  }

  async function terminarListaCompras() {
    if (bloqueoCompras) {
      setError("Hay compras delegadas pendientes. Espera a que terminen o continúa sin ir tú.");
      return;
    }
    const items = listaCompras.filter((m) => m.n.trim());
    if (items.length === 0) {
      setError("Agrega al menos un producto a la lista");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const tid = await asegurarTicketIniciado();
      const pasos = await tapi(`/${tid}/pasos`, token, {
        method: "POST",
        body: JSON.stringify({
          descripcion: "Ir de compras",
          notas: notasListaCompras(items),
        }),
      }) as { id: number; descripcion: string }[];
      const pasoCompras = Array.isArray(pasos)
        ? pasos.find((p) => p.descripcion === "Ir de compras")
        : null;
      setPasoComprasId(pasoCompras?.id ?? (Array.isArray(pasos) && pasos.length ? pasos[pasos.length - 1].id : null));
      setListaCompras(items.map((m) => ({ ...m, comprado: false })));
      setConCompras(true);
      irFase("compras_tienda");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar la lista");
    } finally {
      setLoading(false);
    }
  }

  async function termineCompras() {
    if (!todosComprados) {
      setError("Marca todos los productos de la lista antes de continuar");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const tid = ticketId ?? await asegurarTicketIniciado();
      if (facturaFile) {
        const fd = new FormData();
        fd.append("archivo", facturaFile);
        await tapi(`/${tid}/adjuntos`, token, { method: "POST", body: fd });
      }
      if (pasoComprasId) {
        await tapi(`/${tid}/pasos/${pasoComprasId}`, token, {
          method: "PUT",
          body: JSON.stringify({ completado: 1 }),
        });
      }
      await tapi(`/${tid}/comentarios`, token, {
        method: "POST",
        body: JSON.stringify({
          texto: facturaFile
            ? "✅ Compras terminadas — factura adjunta."
            : "✅ Compras terminadas.",
          es_interno: false,
        }),
      }).catch(() => {});
      irFase("pasos");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al cerrar compras");
    } finally {
      setLoading(false);
    }
  }

  async function saltarCompras() {
    setLoading(true);
    try {
      await asegurarTicketIniciado();
      irFase("pasos");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al continuar");
    } finally {
      setLoading(false);
    }
  }

  function iniciarEditarPaso(idx: number) {
    const p = pasosGuardados[idx];
    setPasoNombre(p.nombre);
    setPasoDesc(p.desc);
    setPasoFoto(p.foto ?? null);
    setEditandoPasoIdx(idx);
  }

  function cancelarEdicionPaso() {
    setPasoNombre("");
    setPasoDesc("");
    setPasoFoto(null);
    setEditandoPasoIdx(null);
  }

  function guardarPasoEnLista(soloGuardar: boolean) {
    if (!pasoNombre.trim()) {
      setError("Escribe o dicta qué harás en este paso");
      return;
    }
    setError("");
    const p: PasoAccionDraft = { nombre: pasoNombre.trim(), desc: pasoDesc.trim(), foto: pasoFoto };
    if (editandoPasoIdx !== null) {
      setPasosGuardados((ps) => ps.map((x, i) => (i === editandoPasoIdx ? p : x)));
      cancelarEdicionPaso();
    } else {
      setPasosGuardados((ps) => [...ps, p]);
      setPasoNombre("");
      setPasoDesc("");
      setPasoFoto(null);
    }
    if (!soloGuardar) void finalizarConPasos(editandoPasoIdx !== null
      ? pasosGuardados.map((x, i) => (i === editandoPasoIdx ? p : x))
      : [...pasosGuardados, p]);
  }

  async function finalizarConPasos(pasosEjec?: PasoAccionDraft[]) {
    setError("");
    const ejec = (pasosEjec ?? pasosGuardados).filter((p) => p.nombre.trim());
    if (ejec.length === 0) {
      setError("Agrega al menos un paso de ejecución");
      return;
    }
    setLoading(true);
    try {
      const tid = ticketId ?? await asegurarTicketIniciado();
      const existentes = await tapi(`/${tid}/pasos`, token).catch(() => []) as Paso[];
      const nombresExistentes = new Map(
        (Array.isArray(existentes) ? existentes : [])
          .filter((p) => p.descripcion !== "Ir de compras")
          .map((p) => [p.descripcion.trim(), p.id as number]),
      );
      for (const p of ejec) {
        const nombre = p.nombre.trim();
        let pasoId: number | null = nombresExistentes.get(nombre) ?? null;
        if (!pasoId) {
          const res = await tapi(`/${tid}/pasos`, token, {
            method: "POST",
            body: JSON.stringify({
              descripcion: nombre,
              notas: p.desc.trim() || undefined,
            }),
          }) as { id?: number } | Paso[];
          const creado = Array.isArray(res) ? res.find((x) => x.descripcion?.trim() === nombre) : res;
          pasoId = (creado as any)?.id ?? null;
          if (pasoId) nombresExistentes.set(nombre, pasoId);
        }
        if (p.foto && pasoId) {
          try {
            const fd = new FormData();
            fd.append("archivo", p.foto);
            await fetch(`/api/tickets/${tid}/pasos/${pasoId}/adjuntos`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: fd,
            });
          } catch { /* no crítico */ }
        }
      }
      irFase("cierre");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al registrar pasos");
    } finally {
      setLoading(false);
    }
  }

  async function completarAccionEnServidor(tid: number, itemsLista: ItemCompraAccion[]) {
    const payload = {
      reporte: reporteSolicitud.trim(),
      lista_compras: itemsLista,
      cerrar_solicitud: !!solicitudPadreId,
      guardar_como_procedimiento: guardarComoProcedimiento,
      alcance_procedimiento: alcanceProcedimiento,
    };
    const res = await fetch(`/api/tickets/${tid}/completar-accion`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 404) {
      try {
        await tapi(`/${tid}/guardar-procedimiento`, token, {
          method: "POST",
          body: JSON.stringify({ lista_compras: itemsLista, alcance: alcanceProcedimiento }),
        });
      } catch { /* servidor antiguo sin procedimientos */ }
      if (solicitudPadreId && reporteSolicitud.trim()) {
        const nombre = user.nombre || "Operador";
        await tapi(`/${solicitudPadreId}/comentarios`, token, {
          method: "POST",
          body: JSON.stringify({
            texto: `📋 **Reporte de ejecución**\nPor: ${nombre}\n\n${reporteSolicitud.trim()}`,
            es_interno: false,
          }),
        });
      }
      await tapi(`/${tid}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "resuelto" }),
      });
      if (solicitudPadreId) {
        await tapi(`/${solicitudPadreId}/estado`, token, {
          method: "PUT",
          body: JSON.stringify({ estado: "resuelto" }),
        });
      }
      return;
    }
    let data: { error?: string };
    try {
      data = await res.json();
    } catch {
      if (!res.ok) throw new Error(`Error ${res.status}`);
      return;
    }
    if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  }

  async function terminarAccion() {
    if (solicitudPadreId && !reporteSolicitud.trim()) {
      setError("Escribe el reporte para quien solicitó la acción");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const tid = ticketId ?? await asegurarTicketIniciado();
      if (corridaIdRef.current) {
        try {
          await tapi(`/corridas/${corridaIdRef.current}/finalizar`, token, { method: "POST" });
        } catch { /* ignore */ }
      }
      if (cierreArchivo) {
        const fd = new FormData();
        fd.append("archivo", cierreArchivo);
        await tapi(`/${tid}/adjuntos`, token, { method: "POST", body: fd });
      }
      const itemsLista = listaCompras.filter((m) => m.n.trim());
      await completarAccionEnServidor(tid, itemsLista);
      onCreated(tid);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al terminar la acción");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!plantilla) return;
    void asegurarTicketIniciado().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finalizar() {
    const extra = pasoNombre.trim()
      ? [{ nombre: pasoNombre.trim(), desc: pasoDesc.trim() }]
      : [];
    await finalizarConPasos([...pasosGuardados, ...extra]);
  }

  async function cancelarWizard() {
    if (ticketId && !confirm("¿Cancelar? La acción iniciada seguirá en tu tablero como borrador.")) return;
    if (ticketId && corridaIdRef.current) {
      try {
        await tapi(`/corridas/${corridaIdRef.current}/pausar`, token, { method: "POST" });
      } catch { /* ignore */ }
    }
    onCancel();
  }

  function onArchivoSeleccionado(
    file: File | null,
    setFile: (f: File | null) => void,
    preview: string | null,
    setPreview: (u: string | null) => void,
  ) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(file);
    if (file && file.type.startsWith("image/")) {
      setPreview(URL.createObjectURL(file));
    } else {
      setPreview(null);
    }
  }

  const slide = wizardDir === "right" ? "mck-slide-right" : "mck-slide-left";
  const cronometroVisible = fase !== "titulo" && (!!ticketId || cronometroActivo || segBase > 0);

  return (
    <div className="mx-auto w-full max-w-lg pb-10">
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => void cancelarWizard()}
          className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
        >
          ← Cancelar
        </button>
        <span className="text-xs font-bold uppercase tracking-widest text-muted">
          {reanudar ? "Continuar acción" : "Nueva acción"}
        </span>
      </div>

      {bloqueadoIntervencion && !bloqueoCompras && (
        <div className="mb-4 rounded-xl border border-orange-400/50 bg-orange-50/60 dark:bg-orange-950/25 px-4 py-3 text-sm text-orange-800 dark:text-orange-200">
          Esperando intervención <strong>{bloqueadoIntervencion}</strong> antes de seguir.
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        {Array.from({ length: maxProgreso }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={`h-2 flex-1 rounded-full transition-all ${n <= progresoActual ? "bg-accent" : "bg-border"}`}
          />
        ))}
      </div>

      {cronometroVisible && (
        <div className="mb-4 flex items-center justify-center gap-3 rounded-2xl border-2 border-accent/35 bg-accent/8 px-4 py-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">En proceso</span>
          <span className="font-mono text-2xl font-extrabold tabular-nums text-accent">{fmtTiempo(segDisplay)}</span>
        </div>
      )}

      <SttBanner stt={stt} />
      {error && (
        <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {fase === "titulo" && (
        <div key="acc-p1" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso 1 de {maxProgreso}
            </p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">
              ¿Qué vas<br />a hacer?
            </h2>
            <p className="mt-2 text-sm text-muted">Solo esta pregunta — escribe o usa el micrófono.</p>
          </div>
          <div className="flex gap-2">
            <input
              autoFocus
              className="w-full flex-1 rounded-2xl border-2 border-border bg-surface-input px-5 py-4 text-xl font-semibold text-ink outline-none focus:border-accent placeholder:text-muted/50"
              placeholder="Ej: Preparar torta de zanahoria"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && titulo.trim() && !loading) void avanzarDesdeTitulo();
              }}
              maxLength={150}
            />
            <SttInlineBtn
              stt={stt}
              onStart={() => void stt.iniciar((t) => setTitulo(t))}
            />
          </div>
          <button
            type="button"
            disabled={!titulo.trim() || loading}
            onClick={() => void avanzarDesdeTitulo()}
            className="w-full rounded-2xl bg-accent py-4 text-lg font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {loading ? "Iniciando…" : "Siguiente →"}
          </button>
        </div>
      )}

      {fase === "compras_lista" && (
        <div key="acc-p2" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso 2 de {maxProgreso}
            </p>
            <h2 className="text-2xl font-extrabold text-ink leading-tight">Tu acción<br />ha comenzado</h2>
            <p className="mt-3 rounded-2xl border-2 border-accent/30 bg-accent/5 px-4 py-3 text-base font-bold text-ink">
              {titulo.trim()}
            </p>
          </div>

          {subCompras === "idle" && (
            <div className="space-y-3">
              <p className="text-sm text-muted">¿Necesitas conseguir ingredientes o materiales antes?</p>
              <button
                type="button"
                onClick={() => {
                  setConCompras(true);
                  setSubCompras("editando");
                  if (listaCompras.length === 0) setListaCompras([nuevoItemCompra()]);
                }}
                className="w-full flex items-center gap-4 rounded-2xl border-2 border-border bg-surface-panel px-5 py-4 text-left transition hover:border-accent/60"
              >
                <span className="text-3xl">🛒</span>
                <div>
                  <p className="text-base font-extrabold text-ink">Ir de compras</p>
                  <p className="text-xs text-muted">Arma la lista con gramos o unidades</p>
                </div>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void saltarCompras()}
                className="w-full rounded-2xl border-2 border-border py-3.5 text-sm font-bold text-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
              >
                Ya tengo todo · continuar →
              </button>
            </div>
          )}

          {subCompras === "editando" && (
            <div className="space-y-4 mck-slide-up">
              <p className="text-xs font-bold uppercase tracking-wide text-accent">Lista de compras</p>
              {listaCompras.map((m, mi) => (
                <div key={mi} className="flex flex-wrap gap-2 sm:flex-nowrap">
                  <input
                    className="min-w-0 flex-[2] rounded-xl border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/40"
                    placeholder="Producto"
                    value={m.n}
                    onChange={(e) => setListaCompras((ms) => ms.map((x, j) => (j === mi ? { ...x, n: e.target.value } : x)))}
                  />
                  <input
                    className="w-20 rounded-xl border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/40"
                    placeholder="Cant."
                    inputMode="decimal"
                    value={m.cantidad}
                    onChange={(e) => setListaCompras((ms) => ms.map((x, j) => (j === mi ? { ...x, cantidad: e.target.value } : x)))}
                  />
                  <select
                    className="w-[5.5rem] rounded-xl border-2 border-border bg-surface-input px-2 py-2.5 text-sm font-bold text-ink outline-none focus:border-accent"
                    value={m.unidad}
                    onChange={(e) => setListaCompras((ms) => ms.map((x, j) => (
                      j === mi ? { ...x, unidad: e.target.value as UnidadCompra } : x
                    )))}
                    aria-label="Unidad de medida"
                  >
                    <option value="g">g</option>
                    <option value="u">u</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setListaCompras((ms) => ms.filter((_, j) => j !== mi))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-border text-muted transition hover:border-danger hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setListaCompras((ms) => [...ms, nuevoItemCompra()])}
                className="flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent"
              >
                + Agregar producto
              </button>

              <div className="rounded-2xl border border-blue-400/30 bg-blue-50/30 dark:bg-blue-900/10 p-3 space-y-2">
                <p className="text-xs font-bold text-ink">¿Alguien más va de compras?</p>
                <p className="text-[11px] text-muted">
                  Se crea una solicitud solo con este checklist para esa persona.
                </p>
                <select
                  className="quest-input w-full text-sm"
                  value={delegarAId}
                  onChange={(e) => setDelegarAId(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Elegir compañero…</option>
                  {usuariosDelegar
                    .filter((u) => u.id !== user.id && u.activo !== 0)
                    .map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={loading || !delegarAId || itemsCompraOk.length === 0}
                  onClick={() => void delegarListaCompras()}
                  className="w-full rounded-xl border-2 border-blue-500 py-2.5 text-sm font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-500/10 disabled:opacity-40"
                >
                  Enviar lista a compañero
                </button>
                {delegacionMsg && (
                  <p className="text-xs font-semibold text-accent">{delegacionMsg}</p>
                )}
              </div>

              {bloqueoCompras && pantallaEsperaCompras()}

              {!bloqueoCompras && (
                <button
                  type="button"
                  disabled={loading || itemsCompraOk.length === 0}
                  onClick={() => void terminarListaCompras()}
                  className="w-full rounded-2xl bg-accent py-4 text-base font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
                >
                  {loading ? "Guardando…" : "Yo voy de compras →"}
                </button>
              )}
              {bloqueoCompras && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true);
                    try {
                      const tid = ticketId ?? await asegurarTicketIniciado();
                      const data = await tapi(`/${tid}/bloqueo-compras`, token) as {
                        bloqueo: typeof bloqueoCompras;
                      };
                      if (data.bloqueo) {
                        setBloqueoCompras(data.bloqueo);
                        setError("Aún esperando que terminen las compras delegadas");
                      } else {
                        setBloqueoCompras(null);
                        irFase("pasos");
                      }
                    } catch (e: unknown) {
                      setError(e instanceof Error ? e.message : "Error al verificar");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="w-full rounded-2xl border-2 border-amber-500 py-3.5 text-sm font-bold text-amber-800 dark:text-amber-200"
                >
                  Compras delegadas — verificar y continuar →
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (subCompras === "editando") setSubCompras("idle");
              else irFase("titulo");
            }}
            className="w-full rounded-2xl border-2 border-border py-3 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
          >
            ← Atrás
          </button>
        </div>
      )}

      {fase === "compras_tienda" && (
        <div key="acc-p3-tienda" className={`space-y-5 ${slide}`}>
          {bloqueoCompras ? (
            <>
              {pantallaEsperaCompras()}
              <button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    const tid = ticketId ?? await asegurarTicketIniciado();
                    const data = await tapi(`/${tid}/bloqueo-compras`, token) as {
                      bloqueo: typeof bloqueoCompras;
                    };
                    if (data.bloqueo) {
                      setBloqueoCompras(data.bloqueo);
                      setError("Aún esperando las compras delegadas");
                    } else {
                      setBloqueoCompras(null);
                      irFase("pasos");
                    }
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : "Error al verificar");
                  } finally {
                    setLoading(false);
                  }
                }}
                className="w-full rounded-2xl border-2 border-amber-500 py-3 text-sm font-bold text-amber-800 dark:text-amber-200"
              >
                Verificar si ya terminaron →
              </button>
            </>
          ) : (
          <>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso 3 de {maxProgreso}
            </p>
            <h2 className="text-2xl font-extrabold text-ink leading-tight">En la tienda</h2>
            <p className="mt-1 text-sm text-muted">Marca cada producto al conseguirlo.</p>
          </div>

          <div className="space-y-2">
            {listaCompras.map((m, mi) => !m.n.trim() ? null : (
              <button
                key={mi}
                type="button"
                onClick={() => setListaCompras((ms) => ms.map((x, j) => (
                  j === mi ? { ...x, comprado: !x.comprado } : x
                )))}
                className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition
                  ${m.comprado ? "border-accent bg-accent/10" : "border-border bg-surface-panel hover:border-accent/40"}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold
                  ${m.comprado ? "border-accent bg-accent text-white" : "border-border text-muted"}`}>
                  {m.comprado ? "✓" : ""}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold ${m.comprado ? "text-accent line-through decoration-accent/50" : "text-ink"}`}>
                    {m.n.trim()}
                  </p>
                  {formatCantidadItem(m) && (
                    <p className="text-xs text-muted">{formatCantidadItem(m)}</p>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border-2 border-dashed border-border bg-surface-panel p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Factura de caja</p>
            <p className="text-xs text-muted">Foto o PDF del ticket al pagar (opcional antes de salir).</p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-border bg-surface-input px-4 py-6 transition hover:border-accent">
              <span className="text-2xl">📷</span>
              <span className="text-sm font-bold text-accent">
                {facturaFile ? facturaFile.name : "Subir captura de factura"}
              </span>
              <input
                type="file"
                accept="image/*,.pdf,application/pdf"
                className="sr-only"
                onChange={(e) => onArchivoSeleccionado(
                  e.target.files?.[0] ?? null,
                  setFacturaFile,
                  facturaPreview,
                  setFacturaPreview,
                )}
              />
            </label>
            {facturaPreview && (
              <img src={facturaPreview} alt="Vista previa factura" className="max-h-40 w-full rounded-xl object-contain border border-border" />
            )}
          </div>

          <button
            type="button"
            disabled={loading || !todosComprados}
            onClick={() => void termineCompras()}
            className="w-full rounded-2xl bg-accent py-4 text-base font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {loading ? "Guardando…" : "Terminé las compras →"}
          </button>
          {!todosComprados && itemsCompraOk.length > 0 && (
            <p className="text-center text-xs text-muted">
              Marca los {itemsCompraOk.length} productos de la lista
            </p>
          )}

          <button
            type="button"
            onClick={() => irFase("compras_lista")}
            className="w-full rounded-2xl border-2 border-border py-3 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
          >
            ← Editar lista
          </button>
          </>
          )}
        </div>
      )}

      {fase === "pasos" && (
        <div key="acc-p3" className={`space-y-5 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso {progresoActual} de {maxProgreso}
            </p>
            <h2 className="text-2xl font-extrabold text-ink leading-tight">
              Describe los pasos<br />de tu labor
            </h2>
            <p className="mt-1 text-sm text-muted">Texto o voz — uno a la vez. Puedes pedir verificación en un paso.</p>
          </div>

          {bloqueoCompras && pantallaEsperaCompras()}

          {pasosGuardados.length > 0 && (
            <div className="space-y-2">
              {pasosGuardados.map((p, i) => (
                <div
                  key={i}
                  className={`mck-slide-up flex items-center gap-3 rounded-2xl border-2 px-4 py-2.5 transition
                    ${editandoPasoIdx === i ? "border-accent bg-accent/8" : "border-border bg-surface-panel"}`}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink">{p.nombre}</p>
                    <div className="flex items-center gap-2">
                      {p.desc && (
                        <p className="truncate text-xs text-muted">
                          {p.desc.slice(0, 48)}{p.desc.length > 48 ? "…" : ""}
                        </p>
                      )}
                      {p.foto && <span className="text-xs text-accent shrink-0">📎</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => iniciarEditarPaso(i)}
                    className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted transition hover:border-accent hover:text-accent"
                    title="Editar paso"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInterPasoIdx(i);
                      setInterForm({
                        titulo: `Verificar: ${p.nombre}`,
                        descripcion: p.desc || "",
                        asignado_a: "",
                      });
                      setShowInterPaso(true);
                    }}
                    className="shrink-0 rounded-lg border border-orange-400/50 px-2 py-1 text-[10px] font-bold text-orange-600 transition hover:bg-orange-50 dark:hover:bg-orange-950/30"
                    title="Pedir verificación a otro usuario"
                  >
                    🛑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasosGuardados((ps) => ps.filter((_, j) => j !== i));
                      if (editandoPasoIdx === i) cancelarEdicionPaso();
                    }}
                    className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted transition hover:border-danger hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {showInterPaso && (
            <div className="rounded-2xl border border-orange-400/50 bg-orange-50/50 dark:bg-orange-950/20 p-4 space-y-3">
              <p className="text-sm font-bold text-orange-800 dark:text-orange-300">
                Pedir verificación{interPasoIdx != null ? ` — paso ${interPasoIdx + 1}` : ""}
              </p>
              <input
                className="quest-input w-full text-sm"
                placeholder="Título de la intervención"
                value={interForm.titulo}
                onChange={(e) => setInterForm((f) => ({ ...f, titulo: e.target.value }))}
              />
              <textarea
                className="quest-input w-full resize-none text-sm"
                rows={2}
                placeholder="Qué debe verificar o hacer…"
                value={interForm.descripcion}
                onChange={(e) => setInterForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
              <select
                className="quest-input w-full text-sm"
                value={interForm.asignado_a}
                onChange={(e) => setInterForm((f) => ({ ...f, asignado_a: e.target.value }))}
              >
                <option value="">Usuario que verifica…</option>
                {usuariosDelegar
                  .filter((u) => u.id !== user.id && u.activo !== 0)
                  .map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={creandoInter || !interForm.titulo.trim() || !interForm.asignado_a}
                  onClick={() => void pedirIntervencionPaso()}
                  className="flex-1 rounded-xl bg-orange-500 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  {creandoInter ? "Enviando…" : "Solicitar intervención"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowInterPaso(false); setInterPasoIdx(null); }}
                  className="rounded-xl border border-border px-3 py-2 text-sm text-muted"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border-2 border-accent/40 bg-surface-panel p-4 space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-accent">
              {editandoPasoIdx !== null
                ? `Editando paso ${editandoPasoIdx + 1}`
                : `Paso ${pasosGuardados.length + 1}`}
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-muted uppercase tracking-wide">
                ¿Qué haces en este paso?
              </label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="w-full flex-1 rounded-xl border-2 border-border bg-surface-input px-4 py-3 text-base font-semibold text-ink outline-none focus:border-accent placeholder:text-muted/40"
                  placeholder="Ej: Mezclar harina y zanahoria"
                  value={pasoNombre}
                  maxLength={120}
                  onChange={(e) => setPasoNombre(e.target.value)}
                />
                <SttInlineBtn
                  stt={stt}
                  onStart={() => void stt.iniciar((t) => setPasoNombre(t))}
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-muted uppercase tracking-wide">
                Detalle <span className="normal-case font-normal">(opcional)</span>
              </label>
              <div className="flex gap-2">
                <textarea
                  className="w-full flex-1 rounded-xl border-2 border-border bg-surface-input px-4 py-2.5 text-sm text-ink outline-none focus:border-accent resize-none placeholder:text-muted/40"
                  placeholder="Instrucciones, tiempos, temperatura…"
                  rows={2}
                  value={pasoDesc}
                  onChange={(e) => setPasoDesc(e.target.value)}
                />
                <SttInlineBtn
                  stt={stt}
                  label="Det."
                  onStart={() => void stt.iniciar((t) => setPasoDesc((d) => (d ? `${d} ${t}` : t)))}
                />
              </div>
            </div>
            <div>
              <label className={`flex items-center gap-3 rounded-xl border-2 cursor-pointer px-4 py-2.5 transition
                ${pasoFoto ? "border-accent bg-accent/8" : "border-dashed border-border hover:border-accent/60"}`}>
                <span className="text-lg">{pasoFoto ? "📎" : "📷"}</span>
                <span className="text-sm font-semibold text-muted truncate">
                  {pasoFoto ? pasoFoto.name : "Adjuntar foto, pantallazo o archivo (opcional)"}
                </span>
                {pasoFoto && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setPasoFoto(null); }}
                    className="ml-auto text-xs text-danger hover:underline shrink-0"
                  >
                    Quitar
                  </button>
                )}
                <input
                  type="file"
                  accept="image/*,.pdf,application/pdf,.doc,.docx"
                  className="sr-only"
                  onChange={(e) => setPasoFoto(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <div className="flex gap-2 pt-1">
              {editandoPasoIdx !== null && (
                <button
                  type="button"
                  onClick={cancelarEdicionPaso}
                  className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
                >
                  Cancelar
                </button>
              )}
              <button
                type="button"
                disabled={!pasoNombre.trim()}
                onClick={() => guardarPasoEnLista(true)}
                className="flex-1 rounded-xl border-2 border-accent/60 py-2.5 text-sm font-extrabold text-accent transition hover:bg-accent/10 disabled:opacity-40"
              >
                {editandoPasoIdx !== null ? "✓ Guardar cambios" : "✓ Guardar · agregar otro"}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                cancelarEdicionPaso();
                irFase(conCompras ? "compras_tienda" : "compras_lista");
              }}
              className="rounded-2xl border-2 border-border px-4 py-3 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
            >
              ← Atrás
            </button>
            <button
              type="button"
              disabled={loading || (pasosGuardados.length === 0 && !pasoNombre.trim())}
              onClick={() => void finalizar()}
              className="flex-1 rounded-2xl bg-accent py-3 text-base font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {loading ? "Guardando…" : "Continuar →"}
            </button>
          </div>
          {pasosGuardados.length === 0 && !pasoNombre.trim() && (
            <p className="text-center text-xs text-muted">Guarda al menos un paso antes de continuar</p>
          )}
        </div>
      )}

      {fase === "cierre" && (
        <div key="acc-cierre" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso {progresoActual} de {maxProgreso}
            </p>
            <h2 className="text-2xl font-extrabold text-ink leading-tight">Cerrar acción</h2>
            <p className="mt-2 text-sm text-muted">
              {solicitudPadreId
                ? "Envía el reporte a quien solicitó la tarea."
                : "Revisa los pasos y cierra la acción."}
            </p>
            <p className="mt-3 rounded-2xl border-2 border-accent/30 bg-accent/5 px-4 py-3 text-base font-bold text-ink">
              {titulo.trim()}
            </p>
          </div>

          {pasosGuardados.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface-panel px-4 py-3 space-y-1">
              <p className="text-xs font-bold uppercase text-muted">Pasos registrados</p>
              {pasosGuardados.map((p, i) => (
                <p key={i} className="text-sm text-ink">
                  <span className="text-muted">{i + 1}.</span> {p.nombre}
                </p>
              ))}
            </div>
          )}

          {solicitudPadreId && (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-accent">
                Reporte para el solicitante
              </label>
              <textarea
                className="w-full rounded-xl border-2 border-border bg-surface-input px-4 py-3 text-sm text-ink outline-none focus:border-accent resize-none"
                rows={4}
                placeholder="Qué hiciste, resultados, observaciones…"
                value={reporteSolicitud}
                onChange={(e) => setReporteSolicitud(e.target.value)}
              />
            </div>
          )}

          <div className="rounded-2xl border-2 border-dashed border-border bg-surface-panel p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Adjunto opcional</p>
            <p className="text-xs text-muted">Foto o imagen de referencia (resultado, comprobante, etc.).</p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-border bg-surface-input px-4 py-6 transition hover:border-accent">
              <span className="text-2xl">📎</span>
              <span className="text-sm font-bold text-accent">
                {cierreArchivo ? cierreArchivo.name : "Adjuntar captura o imagen"}
              </span>
              <input
                type="file"
                accept="image/*,.pdf,application/pdf"
                className="sr-only"
                onChange={(e) => onArchivoSeleccionado(
                  e.target.files?.[0] ?? null,
                  setCierreArchivo,
                  cierrePreview,
                  setCierrePreview,
                )}
              />
            </label>
            {cierrePreview && (
              <img
                src={cierrePreview}
                alt="Vista previa adjunto"
                className="max-h-40 w-full rounded-xl object-contain border border-border"
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => setGuardarComoProcedimiento((v) => !v)}
            className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition ${
              guardarComoProcedimiento
                ? "border-accent bg-accent/8 text-accent"
                : "border-border text-muted hover:border-accent/60"
            }`}
          >
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs font-black transition ${
              guardarComoProcedimiento ? "border-accent bg-accent text-white" : "border-border"
            }`}>{guardarComoProcedimiento ? "✓" : ""}</span>
            <div>
              <p className="text-sm font-semibold">Guardar como procedimiento</p>
              <p className="text-xs text-muted">Quedará en «Mis procedimientos» para reutilizar</p>
            </div>
          </button>

          {guardarComoProcedimiento && (
            <div className="flex gap-2 rounded-2xl border-2 border-accent/30 bg-accent/5 p-1">
              <button
                type="button"
                onClick={() => setAlcanceProcedimiento("personal")}
                className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition ${
                  alcanceProcedimiento === "personal"
                    ? "bg-accent text-white shadow"
                    : "text-muted hover:text-ink"
                }`}
              >
                🔒 Solo para mí
              </button>
              <button
                type="button"
                onClick={() => setAlcanceProcedimiento("global")}
                className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition ${
                  alcanceProcedimiento === "global"
                    ? "bg-accent text-white shadow"
                    : "text-muted hover:text-ink"
                }`}
              >
                🌐 Compartir con el equipo
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={() => void terminarAccion()}
            className="w-full rounded-2xl bg-accent py-4 text-lg font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {loading ? "Guardando…" : "Terminar acción"}
          </button>

          <button
            type="button"
            onClick={() => irFase("pasos")}
            className="w-full rounded-2xl border-2 border-border py-3 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
          >
            ← Atrás
          </button>
        </div>
      )}
    </div>
  );
}

// ── ProtocolosView ────────────────────────────────────────────────────────────

function ProtocolosView({
  token, user, protocolos, loading, onRecargar, onUsarProtocolo,
}: {
  token: string;
  user: TicketsUser;
  protocolos: Protocolo[];
  loading: boolean;
  onRecargar: () => void;
  onUsarProtocolo: (p: Protocolo) => void;
}) {
  const [expandido, setExpandido] = useState<number | null>(null);
  const [msg] = useState("");

  void onRecargar; // usado externamente

  if (loading) return <div className="py-8 text-center text-sm text-muted">Cargando procedimientos…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ink flex items-center gap-1">
            📋 Procedimientos disponibles
            <InfoTooltip text="Procedimientos del equipo que puedes usar como plantilla al crear una solicitud. Para editarlos o crear nuevos, ve a Acciones → Procedimientos." />
          </p>
          <p className="text-xs text-muted mt-0.5">
            Para editar o crear procedimientos ve a <strong>Acciones → Procedimientos</strong>
          </p>
        </div>
        <button type="button" onClick={onRecargar} className="text-xs text-muted hover:text-accent transition-colors shrink-0">
          ↻ Actualizar
        </button>
      </div>
      {msg && <p className="text-xs text-accent">{msg}</p>}

      {protocolos.length === 0 && (
        <div className="py-12 text-center space-y-2">
          <p className="text-3xl">📋</p>
          <p className="text-sm text-muted">Aún no hay procedimientos compartidos con el equipo.</p>
        </div>
      )}

      <div className="space-y-2">
        {protocolos.map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-surface shadow-sm">
            <div className="flex items-start gap-2 p-3">
              <button
                type="button"
                onClick={() => setExpandido(expandido === p.id ? null : p.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">📋</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink truncate">{p.titulo}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                      {p.categoria && (
                        <span className="text-[10px] bg-accent/10 text-accent rounded-full px-2 py-0.5 font-medium">
                          {p.categoria}
                        </span>
                      )}
                      <span className="text-[10px] text-muted">{p.pasos.length} paso{p.pasos.length !== 1 ? "s" : ""}</span>
                      {p.creado_por_nombre && (
                        <span className="text-[10px] text-muted">por {p.creado_por_nombre}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-muted text-xs shrink-0">{expandido === p.id ? "▲" : "▼"}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onUsarProtocolo(p)}
                title="Usar como plantilla en nueva solicitud"
                className="shrink-0 rounded-lg border border-accent/40 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/10 transition-colors"
              >
                Usar
              </button>
            </div>

            {expandido === p.id && (
              <div className="border-t border-border px-3 pb-3 pt-2 space-y-1.5">
                {p.descripcion && <p className="text-xs text-muted italic">{p.descripcion}</p>}
                {p.pasos.length === 0 && <p className="text-xs text-muted">Sin pasos definidos.</p>}
                {p.pasos.map((paso, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <span className="text-xs text-muted shrink-0 w-5 text-right">{idx + 1}.</span>
                    <div>
                      <p className="text-xs text-ink">{paso.descripcion}</p>
                      {paso.notas && <p className="text-[10px] text-muted">{paso.notas}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NuevaSolicitudWizard ──────────────────────────────────────────────────────

type FaseSolicWizard = "tipo" | "descripcion" | "elegir_proc" | "asignados" | "confirmar";
type TipoSolicWizard = "nueva" | "protocolo";

function NuevaSolicitudWizard({
  token,
  user,
  protocolos,
  usuarios,
  onCancel,
  onCreated,
}: {
  token: string;
  user: TicketsUser;
  protocolos: Protocolo[];
  usuarios: UserInfo[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { apiToken: chatApiToken } = useTicketsAuth();
  const stt = useStt(token, chatApiToken);
  const [fase, setFase] = useState<FaseSolicWizard>("tipo");
  const [wizardDir, setWizardDir] = useState<"right" | "left">("right");
  const [tipo, setTipo] = useState<TipoSolicWizard | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [protocoloId, setProtocoloId] = useState<number | null>(null);
  const [asignados, setAsignados] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adjuntoFile, setAdjuntoFile] = useState<File | null>(null);

  const otrosUsuarios = usuarios.filter((u) => u.id !== user.id && u.activo);
  const protDisp = protocolos.filter((p) => p.alcance === "global" || !p.alcance || p.alcance === "seleccionado");
  const protSel = protDisp.find((p) => p.id === protocoloId) ?? null;

  const pasoActual = fase === "tipo" ? 1 : (fase === "descripcion" || fase === "elegir_proc") ? 2 : fase === "asignados" ? 3 : 4;
  const totalPasos = 4;
  const slide = wizardDir === "right" ? "mck-slide-right" : "mck-slide-left";

  function irFase(next: FaseSolicWizard, dir: "right" | "left" = "right") {
    setWizardDir(dir);
    setFase(next);
    setError("");
  }

  function elegirTipo(t: TipoSolicWizard) {
    setTipo(t);
    irFase(t === "nueva" ? "descripcion" : "elegir_proc");
  }

  function toggleAsignado(uid: number) {
    setAsignados((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  }

  async function crear() {
    if (!titulo.trim() || asignados.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const tickets = await Promise.all(
        asignados.map((uid) =>
          tapi("/", token, {
            method: "POST",
            body: JSON.stringify({
              titulo: titulo.trim(),
              descripcion: descripcion.trim() || titulo.trim(),
              categoria: "logistica",
              prioridad: "media",
              asignado_a: uid,
              tipo: "solicitud",
              pasos: undefined,
              protocolo_id: protocoloId ?? undefined,
            }),
          }),
        ),
      ) as { id: number }[];
      if (adjuntoFile) {
        await Promise.all(tickets.map(async (t) => {
          const fd = new FormData();
          fd.append("archivo", adjuntoFile);
          await fetch(`/api/tickets/${t.id}/adjuntos`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
        }));
      }
      onCreated();
    } catch (e: any) {
      setError(e.message ?? "Error al crear la solicitud");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg pb-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={fase === "tipo" ? onCancel : () => {
            const prev: Record<FaseSolicWizard, FaseSolicWizard> = {
              tipo: "tipo",
              descripcion: "tipo",
              elegir_proc: "tipo",
              asignados: tipo === "nueva" ? "descripcion" : "elegir_proc",
              confirmar: "asignados",
            };
            irFase(prev[fase], "left");
          }}
          className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
        >
          {fase === "tipo" ? "✕ Cancelar" : "← Atrás"}
        </button>
        <span className="text-xs font-bold uppercase tracking-widest text-muted">
          Nueva solicitud
        </span>
      </div>

      {/* Barra de progreso */}
      <div className="mb-6 flex items-center gap-2">
        {Array.from({ length: totalPasos }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={`h-2 flex-1 rounded-full transition-all ${n <= pasoActual ? "bg-accent" : "bg-border"}`}
          />
        ))}
      </div>

      <SttBanner stt={stt} />
      {error && (
        <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Paso 1: Tipo */}
      {fase === "tipo" && (
        <div key="sol-p1" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso 1 de {totalPasos}
            </p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">
              ¿Qué quieres<br />hacer?
            </h2>
            <p className="mt-2 text-sm text-muted">Elige cómo quieres enviar esta solicitud.</p>
          </div>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => elegirTipo("nueva")}
              className="w-full text-left rounded-2xl border-2 border-border bg-surface px-5 py-5 transition hover:border-accent hover:bg-accent/5 group"
            >
              <p className="text-lg font-extrabold text-ink group-hover:text-accent transition-colors">
                ✍️ Solicitud nueva
              </p>
              <p className="mt-1 text-sm text-muted">
                Describir con tus palabras qué necesitas que alguien haga.
              </p>
            </button>
            <button
              type="button"
              onClick={() => elegirTipo("protocolo")}
              className="w-full text-left rounded-2xl border-2 border-border bg-surface px-5 py-5 transition hover:border-accent hover:bg-accent/5 group"
            >
              <p className="text-lg font-extrabold text-ink group-hover:text-accent transition-colors">
                📋 Delegar un procedimiento
              </p>
              <p className="mt-1 text-sm text-muted">
                Pedirle a alguien que ejecute un proceso que ya está creado.
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Paso 2A: Descripción (solicitud nueva) */}
      {fase === "descripcion" && (
        <div key="sol-p2a" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso 2 de {totalPasos}
            </p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">
              ¿Qué quieres<br />que haga?
            </h2>
            <p className="mt-2 text-sm text-muted">Describe la tarea con tus propias palabras.</p>
          </div>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                autoFocus
                className="w-full flex-1 rounded-2xl border-2 border-border bg-surface-input px-5 py-4 text-xl font-semibold text-ink outline-none focus:border-accent placeholder:text-muted/50"
                placeholder="Ej: Revisar el inventario de la bodega"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && titulo.trim()) irFase("asignados");
                }}
                maxLength={150}
              />
              <SttInlineBtn
                stt={stt}
                onStart={() => void stt.iniciar((t) => setTitulo(t))}
              />
            </div>
            <div className="flex gap-2">
              <textarea
                className="w-full flex-1 rounded-2xl border-2 border-border bg-surface-input px-5 py-3 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50 resize-none"
                placeholder="Detalles adicionales (opcional)"
                rows={2}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
              <SttInlineBtn
                stt={stt}
                label="Desc."
                onStart={() => void stt.iniciar((t) => setDescripcion(t))}
              />
            </div>
            <label className={`flex items-center gap-3 rounded-2xl border-2 cursor-pointer px-4 py-3 transition
              ${adjuntoFile ? "border-accent bg-accent/8" : "border-dashed border-border hover:border-accent/60"}`}>
              <span className="text-xl">{adjuntoFile ? "📎" : "📷"}</span>
              <span className="text-sm font-semibold text-muted truncate">
                {adjuntoFile ? adjuntoFile.name : "Adjuntar foto o archivo (opcional)"}
              </span>
              {adjuntoFile && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setAdjuntoFile(null); }}
                  className="ml-auto text-xs text-danger hover:underline shrink-0"
                >
                  Quitar
                </button>
              )}
              <input
                type="file"
                accept="image/*,.pdf,application/pdf,.doc,.docx,.xls,.xlsx"
                className="sr-only"
                onChange={(e) => setAdjuntoFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={!titulo.trim()}
            onClick={() => irFase("asignados")}
            className="w-full rounded-2xl bg-accent py-4 text-lg font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* Paso 2B: Elegir procedimiento */}
      {fase === "elegir_proc" && (
        <div key="sol-p2b" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso 2 de {totalPasos}
            </p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">
              ¿Qué procedimiento<br />quieres delegar?
            </h2>
            <p className="mt-2 text-sm text-muted">Selecciona el proceso que el otro usuario debe ejecutar.</p>
          </div>
          {protDisp.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border px-5 py-8 text-center text-sm text-muted">
              No hay procedimientos disponibles.<br />
              <button type="button" onClick={() => elegirTipo("nueva")} className="mt-2 text-accent hover:underline text-sm font-semibold">
                Crear solicitud nueva en cambio →
              </button>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {protDisp.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProtocoloId(p.id);
                    setTitulo(p.titulo);
                    setDescripcion(p.descripcion ?? "");
                    irFase("asignados");
                  }}
                  className={`w-full text-left rounded-2xl border-2 px-4 py-4 transition ${
                    protocoloId === p.id
                      ? "border-accent bg-accent/10"
                      : "border-border bg-surface hover:border-accent hover:bg-accent/5"
                  }`}
                >
                  <p className="font-bold text-ink">{p.titulo}</p>
                  {p.descripcion && (
                    <p className="mt-0.5 text-xs text-muted line-clamp-2">{p.descripcion}</p>
                  )}
                  {p.pasos?.length > 0 && (
                    <p className="mt-1 text-xs text-accent font-semibold">
                      {p.pasos.length} paso{p.pasos.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Paso 3: Asignados */}
      {fase === "asignados" && (
        <div key="sol-p3" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso 3 de {totalPasos}
            </p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">
              ¿A quién se<br />lo asignas?
            </h2>
            <p className="mt-2 rounded-2xl border-2 border-accent/30 bg-accent/5 px-4 py-3 text-base font-bold text-ink">
              {titulo.trim()}
            </p>
            {asignados.length > 1 && (
              <p className="mt-2 text-xs text-muted">
                Se creará una solicitud independiente para cada persona seleccionada.
              </p>
            )}
          </div>
          {otrosUsuarios.length === 0 ? (
            <p className="text-sm text-muted">No hay otros usuarios disponibles.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {otrosUsuarios.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleAsignado(u.id)}
                  className={`flex items-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-semibold transition ${
                    asignados.includes(u.id)
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted hover:border-accent hover:text-accent"
                  }`}
                >
                  <span
                    className="h-6 w-6 flex items-center justify-center rounded-full text-[11px] font-black text-white shrink-0"
                    style={{ background: u.departamento?.color || "#0c6069" }}
                  >
                    {u.nombre.charAt(0).toUpperCase()}
                  </span>
                  {u.nombre}
                  {asignados.includes(u.id) && <Icon name="check" size={13} weight="bold" />}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={asignados.length === 0}
            onClick={() => irFase("confirmar")}
            className="w-full rounded-2xl bg-accent py-4 text-lg font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* Paso 4: Confirmar */}
      {fase === "confirmar" && (
        <div key="sol-p4" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">
              Paso 4 de {totalPasos}
            </p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">
              Listo para<br />enviar
            </h2>
            <p className="mt-2 text-sm text-muted">Revisa antes de crear la solicitud.</p>
          </div>
          <div className="rounded-2xl border-2 border-border bg-surface px-5 py-5 space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-0.5">Tarea</p>
              <p className="text-lg font-extrabold text-ink">{titulo.trim()}</p>
              {descripcion.trim() && descripcion.trim() !== titulo.trim() && (
                <p className="mt-1 text-sm text-muted">{descripcion.trim()}</p>
              )}
            </div>
            {protSel && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-0.5">Procedimiento</p>
                <p className="text-sm font-semibold text-accent">📋 {protSel.titulo}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Para</p>
              <div className="flex flex-wrap gap-1.5">
                {asignados.map((uid) => {
                  const u = otrosUsuarios.find((x) => x.id === uid);
                  if (!u) return null;
                  return (
                    <span
                      key={uid}
                      className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/8 px-3 py-1 text-sm font-semibold text-accent"
                    >
                      <span
                        className="h-5 w-5 flex items-center justify-center rounded-full text-[10px] font-black text-white shrink-0"
                        style={{ background: u.departamento?.color || "#0c6069" }}
                      >
                        {u.nombre.charAt(0).toUpperCase()}
                      </span>
                      {u.nombre}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void crear()}
            className="w-full rounded-2xl bg-accent py-4 text-lg font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {loading ? "Creando…" : asignados.length > 1 ? `Crear ${asignados.length} solicitudes` : "Crear solicitud"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Historial detalle — helpers ───────────────────────────────────────────────

function _fmtDuracionMs(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "< 1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

function _fmtSegs(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h} h ${rm} min` : `${h} h`;
}

function _fmtFechaHist(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s.includes("T") ? s : s + "T00:00:00").toLocaleString("es-CO", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return s; }
}

// ── HistorialSolicitudCard — tarjeta compacta del historial ───────────────────

function HistorialSolicitudCard({
  ticket,
  onClick,
}: {
  ticket: Ticket;
  onClick: () => void;
}) {
  const duracionMs = ticket.creado_en && ticket.resuelto_en
    ? new Date(ticket.resuelto_en).getTime() - new Date(ticket.creado_en).getTime()
    : null;
  const pasoTotal = ticket.pasos_total ?? 0;
  const pasoComp  = ticket.pasos_completados ?? 0;
  const rechazado = ticket.estado === "rechazado";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-2xl border-2 px-4 py-3.5 transition space-y-2 group
        ${rechazado
          ? "border-red-400/30 bg-red-50/10 dark:bg-red-900/10 hover:border-red-400/50"
          : "border-green-500/30 bg-green-50/20 dark:bg-green-900/10 hover:border-green-400/60 hover:bg-green-50/40 dark:hover:bg-green-900/20"
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-ink leading-snug truncate">{ticket.titulo}</p>
          {ticket.descripcion && ticket.descripcion !== ticket.titulo && (
            <p className="text-xs text-muted mt-0.5 line-clamp-1">{ticket.descripcion}</p>
          )}
        </div>
        <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 border
          ${rechazado
            ? "text-red-600 dark:text-red-400 bg-red-500/15 border-red-500/25"
            : "text-green-600 dark:text-green-400 bg-green-500/15 border-green-500/25"
          }`}>
          {rechazado ? "✕ Rechazada" : "✓ Resuelta"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {ticket.creado_por_nombre && <span>📋 {ticket.creado_por_nombre}</span>}
        {ticket.asignado_a_nombre && <span>→ 👤 {ticket.asignado_a_nombre}</span>}
        {duracionMs !== null && <span>⏱ {_fmtDuracionMs(duracionMs)}</span>}
        {pasoTotal > 0 && <span>☑ {pasoComp}/{pasoTotal} pasos</span>}
        <span className="ml-auto text-[10px] text-accent/70 group-hover:text-accent transition-colors">
          Ver detalle →
        </span>
      </div>
    </button>
  );
}

// ── HistorialSolicitudDetalle — vista completa de solo lectura ────────────────

function HistorialSolicitudDetalle({
  ticket: ticketResumen,
  token,
  onBack,
}: {
  ticket: Ticket;
  token: string;
  onBack: () => void;
}) {
  const [ticket, setTicket]       = useState<Ticket | null>(null);
  const [pasos, setPasos]         = useState<Paso[]>([]);
  const [adjuntos, setAdjuntos]   = useState<Adjunto[]>([]);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [loading, setLoading]     = useState(true);
  const [usuarios, setUsuarios]   = useState<UserInfo[]>([]);
  const [showRepetir, setShowRepetir] = useState(false);
  const [repetirAsignado, setRepetirAsignado] = useState<number | "">("");
  const [repetirMsg, setRepetirMsg] = useState("");
  const [creandoRepeticion, setCreandoRepeticion] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      tapi(`/${ticketResumen.id}`, token),
      tapi(`/${ticketResumen.id}/pasos`, token).catch(() => []),
      tapi(`/${ticketResumen.id}/adjuntos`, token).catch(() => []),
      tapi(`/${ticketResumen.id}/comentarios`, token).catch(() => []),
    ]).then(([t, p, a, c]) => {
      setTicket(t as Ticket);
      setPasos(Array.isArray(p) ? p as Paso[] : []);
      setAdjuntos(Array.isArray(a) ? a as Adjunto[] : []);
      setComentarios(Array.isArray(c) ? c as Comentario[] : []);
    }).catch(() => {}).finally(() => setLoading(false));
    tapi("/usuarios", token).then((d) => setUsuarios(Array.isArray(d) ? d as UserInfo[] : [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketResumen.id]);

  async function repetirSolicitud() {
    const t = ticket ?? ticketResumen;
    setCreandoRepeticion(true);
    setRepetirMsg("");
    try {
      await tapi("/", token, {
        method: "POST",
        body: JSON.stringify({
          titulo: t.titulo,
          descripcion: t.descripcion || t.titulo,
          tipo: "solicitud",
          asignado_a: repetirAsignado || t.asignado_a || undefined,
          protocolo_id: (t as any).protocolo_id || undefined,
        }),
      });
      setRepetirMsg("✓ Solicitud creada. Aparecerá en tu lista de solicitudes.");
      setShowRepetir(false);
      setRepetirAsignado("");
    } catch (e: any) {
      setRepetirMsg(`Error: ${e instanceof Error ? e.message : "No se pudo crear"}`);
    } finally { setCreandoRepeticion(false); }
  }

  const t = ticket ?? ticketResumen;
  const duracionMs = t.creado_en && t.resuelto_en
    ? new Date(t.resuelto_en).getTime() - new Date(t.creado_en).getTime()
    : null;

  const adjuntosPorPaso = useMemo(() => {
    const map = new Map<number, Adjunto[]>();
    for (const a of adjuntos) {
      if (a.paso_id) {
        if (!map.has(a.paso_id)) map.set(a.paso_id, []);
        map.get(a.paso_id)!.push(a);
      }
    }
    return map;
  }, [adjuntos]);

  const adjuntosTicket = useMemo(() => adjuntos.filter((a) => !a.paso_id), [adjuntos]);

  function AdjuntoLink({ a }: { a: Adjunto }) {
    const esImagen = /\.(jpg|jpeg|png|gif|webp)$/i.test(a.nombre_original);
    const esPdf    = /\.pdf$/i.test(a.nombre_original);
    const icono    = esImagen ? "🖼" : esPdf ? "📄" : "📁";
    const url      = ticketsUploadUrl(a.nombre_archivo, token);
    return (
      <a href={url} target="_blank" rel="noreferrer"
        className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-accent hover:bg-surface-hover transition-colors min-w-0">
        {esImagen
          ? <img src={url} alt={a.nombre_original} className="h-8 w-8 shrink-0 rounded object-cover border border-border" />
          : <span className="text-base shrink-0">{icono}</span>
        }
        <span className="min-w-0 truncate flex-1">{a.nombre_original}</span>
        {a.creado_por_nombre && (
          <span className="text-[10px] text-muted shrink-0 hidden sm:inline">{a.creado_por_nombre}</span>
        )}
      </a>
    );
  }

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 rounded-full border-4 border-border border-t-accent animate-spin" />
    </div>
  );

  const rechazado = t.estado === "rechazado";

  return (
    <div className="space-y-5 pb-10">
      {/* Nav: volver */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-bold text-muted hover:border-accent hover:text-accent transition-colors shrink-0">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Historial
        </button>
        <span className={`text-[10px] font-bold rounded-full px-2.5 py-1 border
          ${rechazado
            ? "text-red-600 dark:text-red-400 bg-red-500/15 border-red-500/25"
            : "text-green-600 dark:text-green-400 bg-green-500/15 border-green-500/25"
          }`}>
          {rechazado ? "✕ Rechazada" : "✓ Resuelta"}
        </span>
      </div>

      {/* Título */}
      <div>
        <h2 className="text-2xl font-extrabold text-ink leading-tight">{t.titulo}</h2>
        {t.descripcion && t.descripcion !== t.titulo && (
          <p className="mt-2 text-sm text-muted leading-relaxed">{t.descripcion}</p>
        )}
      </div>

      {/* Quién */}
      <div className="flex flex-wrap gap-3">
        {t.creado_por_nombre && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-panel px-3 py-2 text-sm">
            <span className="text-base">📋</span>
            <div>
              <p className="text-[10px] text-muted font-bold uppercase tracking-wide leading-none mb-0.5">Solicitado por</p>
              <p className="font-semibold text-ink">{t.creado_por_nombre}</p>
            </div>
          </div>
        )}
        {t.asignado_a_nombre && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-panel px-3 py-2 text-sm">
            <span className="text-base">👤</span>
            <div>
              <p className="text-[10px] text-muted font-bold uppercase tracking-wide leading-none mb-0.5">Resuelto por</p>
              <p className="font-semibold text-ink">{t.asignado_a_nombre}</p>
            </div>
          </div>
        )}
      </div>

      {/* Estadísticas de tiempo */}
      <div className="rounded-2xl border-2 border-border bg-surface-panel p-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-0.5">Creada</p>
          <p className="text-xs font-semibold text-ink leading-snug">{_fmtFechaHist(t.creado_en)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-0.5">Resuelta</p>
          <p className="text-xs font-semibold text-ink leading-snug">{_fmtFechaHist(t.resuelto_en)}</p>
        </div>
        {duracionMs !== null && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-0.5">Duración total</p>
            <p className="text-sm font-extrabold text-ink">{_fmtDuracionMs(duracionMs)}</p>
          </div>
        )}
        {(t.segundos_trabajo ?? 0) > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-0.5">Tiempo activo</p>
            <p className="text-sm font-extrabold text-accent">{_fmtSegs(t.segundos_trabajo!)}</p>
          </div>
        )}
      </div>

      {/* Pasos — solo lectura */}
      {pasos.length > 0 && (
        <div className="rounded-2xl border-2 border-border bg-surface-panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-extrabold uppercase tracking-wide text-ink flex items-center gap-2">
              ☑ Protocolo de pasos
              <span className="text-[10px] font-normal text-muted normal-case tracking-normal">
                ({pasos.filter(pasoEstaCompletado).length}/{pasos.length} completados)
              </span>
            </p>
          </div>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${pasos.length ? (pasos.filter(pasoEstaCompletado).length / pasos.length) * 100 : 0}%` }}
            />
          </div>
          <div className="space-y-2">
            {pasos.map((p) => {
              const hecho    = pasoEstaCompletado(p);
              const pasoAdjs = adjuntosPorPaso.get(p.id) ?? [];
              return (
                <div key={p.id}
                  className={`rounded-xl border px-3 py-2.5 space-y-1.5 transition-colors
                    ${hecho
                      ? "border-green-500/30 bg-green-50/20 dark:bg-green-900/10"
                      : "border-border/40 bg-surface opacity-55"
                    }`}>
                  <div className="flex items-start gap-2.5">
                    {/* Visual checkbox — nunca interactivo */}
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2
                      ${hecho ? "border-green-500 bg-green-500" : "border-border/60"}`}>
                      {hecho && (
                        <svg className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold leading-snug ${hecho ? "text-ink" : "text-muted"}`}>
                        <span className="text-muted/50 text-xs mr-1">{p.orden}.</span>{p.descripcion}
                      </p>
                      {p.notas && !p.respuesta_intervencion && (
                        <p className="text-[11px] text-muted mt-0.5">{p.notas}</p>
                      )}
                      {p.respuesta_intervencion && (
                        <p className="text-[11px] text-green-600 dark:text-green-400 mt-0.5">
                          ✅ {p.respuesta_intervencion}
                        </p>
                      )}
                      {hecho && p.completado_por_nombre && (
                        <p className="text-[10px] text-muted mt-0.5">
                          ✓ {p.completado_por_nombre}
                          {p.completado_en ? ` · ${_fmtFechaHist(p.completado_en)}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  {pasoAdjs.length > 0 && (
                    <div className="ml-6 flex flex-wrap gap-2 pt-0.5">
                      {pasoAdjs.map((a) => <AdjuntoLink key={a.id} a={a} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Archivos adjuntos generales */}
      {adjuntosTicket.length > 0 && (
        <div className="rounded-2xl border-2 border-border bg-surface-panel p-4 space-y-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-ink">📎 Archivos adjuntos</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {adjuntosTicket.map((a) => <AdjuntoLink key={a.id} a={a} />)}
          </div>
        </div>
      )}

      {/* Timeline de comentarios / actividad */}
      {comentarios.length > 0 && (
        <div className="rounded-2xl border-2 border-border bg-surface-panel p-4 space-y-4">
          <p className="text-xs font-extrabold uppercase tracking-wide text-ink">💬 Actividad</p>
          <div className="space-y-4">
            {comentarios.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-hover border border-border text-xs font-extrabold text-ink/60">
                  {(c.autor_nombre || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
                    <span className="text-xs font-bold text-ink">{c.autor_nombre ?? "—"}</span>
                    <span className="text-[10px] text-muted">{_fmtFechaHist(c.creado_en)}</span>
                  </div>
                  <p className="text-sm text-muted whitespace-pre-wrap leading-relaxed">{c.texto}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pasos.length === 0 && adjuntos.length === 0 && comentarios.length === 0 && (
        <p className="text-sm text-muted text-center py-6 italic">Sin registros adicionales para esta solicitud.</p>
      )}

      {/* Repetir solicitud */}
      <div className="rounded-2xl border-2 border-dashed border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-ink">🔁 Repetir esta solicitud</p>
            <p className="text-xs text-muted mt-0.5">
              Crea una nueva solicitud con el mismo contenido para que alguien la resuelva de nuevo.
            </p>
          </div>
          {!showRepetir && (
            <button type="button" onClick={() => setShowRepetir(true)}
              className="shrink-0 rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition-colors">
              Repetir
            </button>
          )}
        </div>
        {repetirMsg && (
          <p className={`text-xs font-semibold ${repetirMsg.startsWith("✓") ? "text-green-500" : "text-red-400"}`}>
            {repetirMsg}
          </p>
        )}
        {showRepetir && (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-bold text-muted uppercase tracking-wide mb-1">Asignar a</p>
              <select
                className="quest-input w-full text-sm"
                value={repetirAsignado}
                onChange={(e) => setRepetirAsignado(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Mismo ejecutor ({t.asignado_a_nombre ?? "sin asignar"})</option>
                {usuarios
                  .filter((u) => u.activo !== 0)
                  .map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={creandoRepeticion} onClick={repetirSolicitud}
                className="flex-1 rounded-xl bg-accent py-2 text-sm font-extrabold text-white disabled:opacity-40 hover:brightness-110 transition-all">
                {creandoRepeticion ? "Creando…" : "Crear solicitud"}
              </button>
              <button type="button" onClick={() => { setShowRepetir(false); setRepetirAsignado(""); }}
                className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:text-ink">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SolicitudesView ───────────────────────────────────────────────────────────

const FRECUENCIA_OPTS: { value: Frecuencia; label: string }[] = [
  { value: "diaria", label: "Diaria" },
  { value: "cada_2_dias", label: "Cada 2 días" },
  { value: "cada_3_dias", label: "Cada 3 días" },
  { value: "semanal", label: "Semanal" },
  { value: "quincenal", label: "Quincenal" },
  { value: "mensual", label: "Mensual" },
  { value: "bimestral", label: "Bimestral" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
];

function SolicitudesView({
  token, user, onInicio,
}: {
  token: string; user: TicketsUser;
  onInicio?: () => void;
}) {
  const isAdmin = (user.rol?.nivel ?? 1) >= 3;
  const { apiToken: chatApiToken } = useTicketsAuth();
  const stt = useStt(token, chatApiToken);
  const [showEjecWizard, setShowEjecWizard] = useState(false);
  const [showRepetirEjecWizard, setShowRepetirEjecWizard] = useState(false);
  const [plantillaRepetirEjec, setPlantillaRepetirEjec] = useState<PlantillaAccion | undefined>();
  const [showWizard, setShowWizard] = useState(false);
  const [plantillaEjec, setPlantillaEjec] = useState<PlantillaAccion | undefined>();
  const [solicitudEjecId, setSolicitudEjecId] = useState<number | undefined>();
  const [tab, setTab] = useState<"subhome" | "asignadas" | "creadas" | "equipo" | "historial" | "protocolos">("subhome");
  const [selectedHistorialTicket, setSelectedHistorialTicket] = useState<Ticket | null>(null);
  const [solicitudes, setSolicitudes] = useState<Ticket[]>([]);
  const [solicitudesEquipo, setSolicitudesEquipo] = useState<Ticket[]>([]);
  const [comprasDelegadas, setComprasDelegadas] = useState<Ticket[]>([]);
  const [compraActiva, setCompraActiva] = useState<Ticket | null>(null);
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [protocolos, setProtocolos] = useState<Protocolo[]>([]);
  const [loadingProtocolos, setLoadingProtocolos] = useState(false);
  const [historialSol, setHistorialSol] = useState<Ticket[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setMsg("");
    const [solRes, equipoRes, usrsRes, comprasRes] = await Promise.allSettled([
      tapi("/?tipo=solicitud&activas=1", token),
      tapi("/?tipo=solicitud&vista_equipo=1&activas=1", token),
      tapi("/usuarios", token),
      tapiSafe("/compras-delegadas", token),
    ]);
    if (solRes.status === "fulfilled" && Array.isArray(solRes.value)) {
      setSolicitudes(solRes.value.map(normalizeTicketForList));
    } else if (!silent) {
      setSolicitudes([]);
      setMsg("No se pudieron cargar tus solicitudes");
    }
    if (equipoRes.status === "fulfilled" && Array.isArray(equipoRes.value)) {
      setSolicitudesEquipo(equipoRes.value.map(normalizeTicketForList));
    }
    if (usrsRes.status === "fulfilled" && Array.isArray(usrsRes.value)) {
      setUsuarios(usrsRes.value);
    }
    if (comprasRes.status === "fulfilled" && Array.isArray(comprasRes.value)) {
      setComprasDelegadas(comprasRes.value.map(normalizeTicketForList));
    }
    if (!silent) setLoading(false);
  }, [token]);

  const cargarHistorial = useCallback(async () => {
    setLoadingHistorial(true);
    try {
      const data = await tapi("/?tipo=solicitud", token) as Ticket[];
      const resueltas = (Array.isArray(data) ? data : [])
        .map(normalizeTicketForList)
        .filter((t) => t.estado === "resuelto" || t.estado === "rechazado");
      setHistorialSol(resueltas);
    } catch { /* ignore */ } finally { setLoadingHistorial(false); }
  }, [token]);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    const iv = setInterval(() => void load(true), 30000);
    return () => clearInterval(iv);
  }, [load]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  async function cargarProtocolos() {
    setLoadingProtocolos(true);
    try {
      const data = await tapi("/protocolos", token);
      setProtocolos(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setLoadingProtocolos(false); }
  }

  useEffect(() => { void cargarProtocolos(); }, [token]);
  useEffect(() => {
    if (tab === "protocolos" || tab === "subhome") void cargarProtocolos();
    if (tab === "historial") void cargarHistorial();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const asignadas = solicitudes.filter(
    (t) => uidEq(t.asignado_a, user.id) && t.estado !== "resuelto" && t.estado !== "rechazado",
  );
  const comprasPendientes = comprasDelegadas.length > 0
    ? comprasDelegadas
    : asignadas.filter(esSolicitudCompraDelegada);
  const otrasAsignadas = asignadas.filter((t) => !esSolicitudCompraDelegada(t));
  const creadas = solicitudes.filter(
    (t) => uidEq(t.creado_por, user.id) && t.estado !== "resuelto" && t.estado !== "rechazado",
  );
  const enEquipo = solicitudesEquipo;
  const historial = historialSol;
  const lista = tab === "asignadas"
    ? otrasAsignadas
    : tab === "creadas"
      ? creadas
      : tab === "historial"
        ? historial
        : enEquipo;
  const pendientes = otrasAsignadas.length + comprasPendientes.length;

  useEffect(() => {
    if (compraActiva && !comprasPendientes.some((t) => t.id === compraActiva.id)) {
      setCompraActiva(null);
    }
  }, [compraActiva, comprasPendientes]);

  const equipoPorAsignado = useMemo(() => {
    const map = new Map<number, { nombre: string; items: Ticket[] }>();
    for (const t of enEquipo) {
      const uid = t.asignado_a ?? 0;
      if (!map.has(uid)) map.set(uid, { nombre: t.asignado_a_nombre ?? "Sin asignar", items: [] });
      map.get(uid)!.items.push(t);
    }
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [enEquipo]);

  async function iniciarEjecucionSolicitud(t: Ticket) {
    let plantilla: PlantillaAccion = {
      titulo: t.titulo,
      listaCompras: [],
      pasos: [],
    };
    if (t.protocolo_id) {
      try {
        const p = await tapi(`/protocolos/${t.protocolo_id}`, token) as Protocolo;
        plantilla = plantillaDesdeProtocolo(p);
      } catch { /* usar título de solicitud */ }
    }
    setSolicitudEjecId(t.id);
    // Si el protocolo tiene ingredientes o pasos definidos, usar el flujo
    // paso-a-paso (RepetirAccionWizard) en lugar del formulario editable.
    const tieneContenido = plantilla.listaCompras.length > 0 || plantilla.pasos.length > 0;
    if (tieneContenido) {
      setPlantillaRepetirEjec(plantilla);
      setShowRepetirEjecWizard(true);
    } else {
      setPlantillaEjec(plantilla);
      setShowEjecWizard(true);
    }
  }

  if (showRepetirEjecWizard && plantillaRepetirEjec) {
    return (
      <RepetirAccionWizard
        token={token}
        user={user}
        chatApiToken={chatApiToken}
        plantilla={plantillaRepetirEjec}
        solicitudPadreId={solicitudEjecId}
        onCancel={() => {
          setShowRepetirEjecWizard(false);
          setPlantillaRepetirEjec(undefined);
          setSolicitudEjecId(undefined);
        }}
        onCreated={() => {
          setShowRepetirEjecWizard(false);
          setPlantillaRepetirEjec(undefined);
          setSolicitudEjecId(undefined);
          void load(false);
          setMsg("Ejecución completada");
          setTimeout(() => setMsg(""), 3000);
        }}
      />
    );
  }

  if (showWizard) {
    return (
      <NuevaSolicitudWizard
        token={token}
        user={user}
        protocolos={protocolos}
        usuarios={usuarios}
        onCancel={() => setShowWizard(false)}
        onCreated={() => {
          setShowWizard(false);
          void load(false);
          setMsg("Solicitud creada correctamente");
          setTimeout(() => setMsg(""), 3000);
        }}
      />
    );
  }

  if (showEjecWizard) {
    return (
      <NuevaAccionWizard
        token={token}
        user={user}
        chatApiToken={chatApiToken}
        plantilla={plantillaEjec}
        solicitudPadreId={solicitudEjecId}
        onCancel={() => { setShowEjecWizard(false); setSolicitudEjecId(undefined); }}
        onCreated={() => {
          setShowEjecWizard(false);
          setSolicitudEjecId(undefined);
          void load(false);
          setMsg("Ejecución registrada y reporte enviado");
          setTimeout(() => setMsg(""), 3000);
        }}
      />
    );
  }

  if (compraActiva) {
    return (
      <PanelIrDeCompras
        ticket={compraActiva}
        token={token}
        user={user}
        onSalir={() => setCompraActiva(null)}
        onTerminado={() => {
          setCompraActiva(null);
          void load(false);
          setMsg("Compras terminadas");
          setTimeout(() => setMsg(""), 2500);
        }}
      />
    );
  }

  if (selectedHistorialTicket) {
    return (
      <HistorialSolicitudDetalle
        ticket={selectedHistorialTicket}
        token={token}
        onBack={() => setSelectedHistorialTicket(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      {tab === "subhome" ? (
        <div className="rounded-3xl border border-rose-200 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/50 p-6 shadow-[0_2px_14px_rgba(0,0,0,0.06)] space-y-4">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-200/70 dark:bg-rose-800/60 text-rose-700 dark:text-rose-300 text-2xl">📋</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-extrabold text-ink">Solicitudes</h2>
                {onInicio && (
                  <button
                    type="button"
                    onClick={onInicio}
                    className="ml-auto flex items-center gap-1 rounded-xl border-2 border-rose-300 dark:border-rose-600/70 px-3 py-1 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition"
                    title="Volver al inicio"
                  >
                    🏠 Inicio
                  </button>
                )}
              </div>
              <p className="mt-1 text-base font-bold text-ink/80 dark:text-white/90 leading-snug">
                Tareas entre miembros del equipo. Recibe lo que te piden y delega lo que necesitas.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            className="w-full rounded-2xl bg-rose-500 hover:bg-rose-600 active:scale-[0.98] text-white font-extrabold text-lg py-4 flex items-center justify-center gap-2 transition-all shadow-[0_3px_0_#9f1239] active:shadow-none active:translate-y-0.5"
          >
            <Icon name="plus" size={18} weight="bold" />
            Nueva solicitud
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {onInicio && (
            <button
              type="button"
              onClick={onInicio}
              className="flex items-center gap-1 rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition shrink-0"
              title="Volver al inicio"
            >
              🏠 Inicio
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab("subhome")}
            className="flex items-center gap-1.5 rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition"
          >
            ← Volver a Solicitudes
          </button>
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            className="ml-auto quest-board-toolbar-btn quest-board-toolbar-btn--active flex items-center gap-1 px-3 shrink-0"
          >
            <Icon name="plus" size={14} weight="bold" />
            Nueva solicitud
          </button>
        </div>
      )}

      {/* Título de la sub-sección activa */}
      {tab !== "subhome" && (
        <p className="text-base font-extrabold text-ink">
          {tab === "asignadas" ? "📥 Por resolver"
            : tab === "creadas" ? "📤 Enviadas"
            : tab === "equipo" ? "👥 En curso — equipo"
            : tab === "historial" ? "📜 Historial"
            : "📋 Procedimientos"}
        </p>
      )}

      {msg && (
        <p className="rounded-xl border border-accent/30 bg-accent/8 px-4 py-2 text-sm text-accent font-semibold">
          {msg}
        </p>
      )}

      {/* ── Sub-home: cards de solicitudes ── */}
      {tab === "subhome" && !loading && (() => {
        const sc = [
          "group flex flex-col gap-5 rounded-3xl border p-6 text-left w-full",
          "shadow-[0_2px_14px_rgba(0,0,0,0.06)] hover:shadow-[0_6px_22px_rgba(0,0,0,0.10)]",
          "transition-all duration-200 cursor-pointer active:scale-[0.97]",
        ].join(" ");
        const total = otrasAsignadas.length + comprasPendientes.length;
        return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

            <button type="button" onClick={() => setTab("asignadas")}
              className={`${sc} bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-700/60`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-200/70 dark:bg-rose-800/60 text-rose-700 dark:text-rose-300 text-2xl shrink-0">📥</span>
                <span className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{total}</span>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">Por resolver</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Solicitudes que te asignaron y te están esperando. Ábrelas, ejecútalas y márcalas como listas.</p>
            </button>

            <button type="button" onClick={() => setTab("creadas")}
              className={`${sc} bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-700/60`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-200/70 dark:bg-orange-800/60 text-orange-700 dark:text-orange-300 text-2xl shrink-0">📤</span>
                <span className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{creadas.length}</span>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">Enviadas</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Lo que tú le pediste a alguien del equipo. Revisa cómo van las tareas que mandaste.</p>
            </button>

            <button type="button" onClick={() => setTab("equipo")}
              className={`${sc} bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-700/60`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-200/70 dark:bg-indigo-800/60 text-indigo-700 dark:text-indigo-300 text-2xl shrink-0">👥</span>
                <span className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{enEquipo.length}</span>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">En curso — equipo</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Un vistazo general a lo que tiene todo el equipo activo en este momento.</p>
            </button>

            <button type="button" onClick={() => setTab("historial")}
              className={`${sc} bg-stone-50 dark:bg-stone-900/60 border-stone-200 dark:border-stone-600/50`}>
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-200/70 dark:bg-stone-700/60 text-stone-600 dark:text-stone-300 text-2xl shrink-0">📜</span>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">Historial</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Las solicitudes que ya se cerraron — resueltas o rechazadas. Pa' que quede el registro.</p>
            </button>

            <button type="button" onClick={() => setTab("protocolos")}
              className={`${sc} bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-700/60`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-200/70 dark:bg-teal-800/60 text-teal-700 dark:text-teal-300 text-2xl shrink-0">📋</span>
                <span className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{protocolos.length}</span>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">Procedimientos</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Procesos del equipo listos pa' delegar. Asígnale uno a alguien sin explicar todo desde cero.</p>
            </button>

          </div>
        );
      })()}

      {tab === "subhome" && loading && <div className="py-8 text-center text-sm text-muted">Cargando solicitudes…</div>}

      {tab !== "subhome" && loading && <div className="py-8 text-center text-sm text-muted">Cargando solicitudes…</div>}
      {tab === "historial" && loadingHistorial && <div className="py-8 text-center text-sm text-muted">Cargando historial…</div>}

      {tab === "asignadas" && !loading && comprasPendientes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Ir de compras</p>
          {comprasPendientes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCompraActiva(t)}
              className="w-full rounded-xl border-2 border-blue-400/50 bg-blue-50/60 dark:bg-blue-950/30 px-4 py-3 text-left transition hover:border-accent"
            >
              <p className="text-sm font-bold text-ink">🛒 {t.titulo}</p>
              <p className="text-xs text-muted font-mono">{t.numero}</p>
              {t.ticket_padre_titulo && (
                <p className="mt-1 text-xs text-muted">Para: {t.ticket_padre_titulo}</p>
              )}
              <p className="mt-2 text-xs font-bold text-accent">Toca para abrir → Iniciar compras</p>
            </button>
          ))}
        </div>
      )}

      {tab !== "subhome" && !loading && !loadingHistorial && lista.length === 0 && (tab !== "asignadas" || comprasPendientes.length === 0) && (
        <div className="py-12 text-center space-y-2">
          <p className="text-sm text-muted">
            {tab === "asignadas"
              ? "No tienes solicitudes pendientes."
              : tab === "creadas"
                ? "No tienes solicitudes activas enviadas."
                : tab === "historial"
                  ? "No hay solicitudes resueltas en tu historial."
                  : "No hay solicitudes en curso en el equipo."}
          </p>
          {tab === "historial" && (
            <button
              type="button"
              onClick={() => void cargarHistorial()}
              className="text-xs text-accent hover:underline"
            >
              ↻ Recargar historial
            </button>
          )}
        </div>
      )}

      {/* Vista historial: cards compactas con vista de detalle */}
      {tab === "historial" && !loading && !loadingHistorial && historial.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted flex items-center gap-1">
            {historial.length} solicitud{historial.length !== 1 ? "es" : ""} completada{historial.length !== 1 ? "s" : ""} o rechazada{historial.length !== 1 ? "s" : ""}
            <InfoTooltip text="Haz clic en una solicitud para ver el detalle completo: pasos ejecutados, archivos adjuntos, comentarios y estadísticas de tiempo. Los pasos son de solo lectura." />
          </p>
          {historial.map((t) => (
            <HistorialSolicitudCard
              key={t.id}
              ticket={t}
              onClick={() => setSelectedHistorialTicket(t)}
            />
          ))}
        </div>
      )}

      {tab === "equipo" && !loading && equipoPorAsignado.length > 0 && (
        <div className="space-y-5">
          {equipoPorAsignado.map(({ nombre, items }) => (
            <div key={nombre}>
              <div className="mb-2 flex items-center gap-2">
                <Icon name="user" size={13} className="text-muted" />
                <span className="text-xs font-bold uppercase tracking-wide text-muted">{nombre}</span>
                <span className="rounded-full bg-surface border border-border px-1.5 py-0.5 text-[10px] text-muted">{items.length}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((t) => (
                  <SolicitudCard
                    key={t.id}
                    ticket={t}
                    token={token}
                    user={user}
                    isAdmin={isAdmin}
                    supervision
                    onChanged={() => void load(true)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab !== "equipo" && tab !== "historial" && tab !== "protocolos" && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {!loading && lista.map((t) => (
            <SolicitudCard
              key={t.id}
              ticket={t}
              token={token}
              user={user}
              isAdmin={isAdmin}
              protocolos={protocolos}
              onChanged={() => void load(true)}
              onRegistrarEjecucion={
                esSolicitudCompraDelegada(t)
                  ? undefined
                  : (sol) => void iniciarEjecucionSolicitud(sol)
              }
            />
          ))}
        </div>
      )}

      {/* Vista protocolos */}
      {tab === "protocolos" && (
        <ProtocolosView
          token={token}
          user={user}
          protocolos={protocolos}
          loading={loadingProtocolos}
          onRecargar={() => void cargarProtocolos()}
          onUsarProtocolo={() => { setShowWizard(true); setTab("asignadas"); }}
        />
      )}
    </div>
  );
}

// ── RepetirAccionWizard ───────────────────────────────────────────────────────

type FaseRepetir = "iniciando" | "bienvenida" | "compras_lista" | "compras_tienda" | "paso" | "cierre" | "completada";

type ReanudarRepetirState = {
  ticketId: number;
  pasosIds: number[];
  corridaId: number | null;
  segundosBase: number;
  startPasoIdx: number;
};

function RepetirAccionWizard({
  token,
  user,
  chatApiToken,
  plantilla,
  solicitudPadreId,
  reanudar,
  onCancel,
  onCreated,
}: {
  token: string;
  user: TicketsUser;
  chatApiToken: string | null | undefined;
  plantilla: PlantillaAccion;
  solicitudPadreId?: number;
  reanudar?: ReanudarRepetirState;
  onCancel: () => void;
  onCreated: (ticketId: number) => void;
}) {
  const stt = useStt(token, chatApiToken);
  const [fase, setFase] = useState<FaseRepetir>("iniciando");
  const [slideDir, setSlideDir] = useState<"right" | "left">("right");
  const [ticketId, setTicketId] = useState<number | null>(reanudar?.ticketId ?? null);
  const [pasosIds, setPasosIds] = useState<number[]>(reanudar?.pasosIds ?? []);
  const [pasoIdx, setPasoIdx] = useState(reanudar?.startPasoIdx ?? 0);
  const [segBase] = useState(reanudar?.segundosBase ?? 0);
  const [reporteTexto, setReporteTexto] = useState("");
  const [completando, setCompletando] = useState(false);
  const [error, setError] = useState("");
  const [listaCompras, setListaCompras] = useState<ItemCompraAccion[]>(() =>
    plantilla.listaCompras.filter((m) => m.n.trim()).map((m) => ({ ...m, comprado: false }))
  );
  const [usuariosDelegar, setUsuariosDelegar] = useState<UserInfo[]>([]);
  const [delegarAId, setDelegarAId] = useState<number | "">("");
  const [delegacionMsg, setDelegacionMsg] = useState("");
  const [delegando, setDelegando] = useState(false);
  const [pasoFile, setPasoFile] = useState<File | null>(null);
  const [cierreFile, setCierreFile] = useState<File | null>(null);

  const inicioRef = useRef<number | null>(null);
  const corridaIdRef = useRef<number | null>(reanudar?.corridaId ?? null);
  const [seg, setSeg] = useState(reanudar?.segundosBase ?? 0);
  useEffect(() => {
    const iv = setInterval(() => {
      if (inicioRef.current == null) return;
      setSeg(segBase + Math.floor((Date.now() - inicioRef.current) / 1000));
    }, 500);
    return () => clearInterval(iv);
  }, [segBase]);

  const pasos = plantilla.pasos;
  const totalItems = pasos.length;
  const posActual = fase === "paso" ? pasoIdx : totalItems;
  const pct = totalItems > 0 ? Math.round((posActual / totalItems) * 100) : 0;
  const todosComprados = listaCompras.every((m) => !m.n.trim() || m.comprado);

  function fmtSeg(s: number) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  useEffect(() => { void init(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fase !== "compras_lista" || usuariosDelegar.length > 0) return;
    tapi("/usuarios", token)
      .then((data) => setUsuariosDelegar(Array.isArray(data) ? data : []))
      .catch(() => setUsuariosDelegar([]));
  }, [fase, token, usuariosDelegar.length]);

  async function init() {
    // ── Reanudar acción existente ──
    if (reanudar) {
      try {
        const cr = await tapi(`/${reanudar.ticketId}/corridas/iniciar`, token, {
          method: "POST", body: JSON.stringify({ segundos_previos: reanudar.segundosBase }),
        }) as Ticket;
        corridaIdRef.current = cr.corrida?.id ?? reanudar.corridaId;
      } catch { /* usa corridaId del reanudar */ }
      inicioRef.current = Date.now();
      if (reanudar.startPasoIdx >= pasos.length && pasos.length > 0) {
        setFase("cierre");
      } else if (pasos.length > 0) {
        setFase("paso");
      } else {
        setFase("cierre");
      }
      return;
    }

    // ── Nueva acción ──
    try {
      const ticket = await tapi("/", token, {
        method: "POST",
        body: JSON.stringify({
          titulo: plantilla.titulo,
          descripcion: plantilla.titulo,
          prioridad: "media",
          categoria: "logistica",
          asignado_a: user.id,
          tipo: "accion",
          ticket_padre_id: solicitudPadreId ?? undefined,
          protocolo_id: plantilla.protocoloId ?? undefined,
        }),
      }) as Ticket;
      const tid = ticket.id;
      setTicketId(tid);
      try {
        const cr = await tapi(`/${tid}/corridas/iniciar`, token, {
          method: "POST", body: JSON.stringify({ segundos_previos: 0 }),
        }) as Ticket;
        corridaIdRef.current = cr.corrida?.id ?? null;
      } catch { /* cronómetro local */ }
      inicioRef.current = Date.now();
      const ids: number[] = [];
      for (const p of pasos) {
        try {
          const saved = await tapi(`/${tid}/pasos`, token, {
            method: "POST",
            body: JSON.stringify({ descripcion: p.nombre, notas: p.desc || "" }),
          }) as { id: number };
          ids.push(saved.id);
        } catch { /* no crítico */ }
      }
      setPasosIds(ids);
      setFase("bienvenida");
    } catch (e: any) {
      setError(e.message ?? "No se pudo iniciar la acción");
    }
  }

  async function delegarListaCompras() {
    if (!delegarAId) return;
    const items = listaCompras.filter((m) => m.n.trim());
    if (items.length === 0) { setError("Lista vacía"); return; }
    setDelegando(true);
    setError("");
    try {
      const tid = ticketId!;
      await tapi(`/${tid}/delegar-compras`, token, {
        method: "POST",
        body: JSON.stringify({ asignado_a: delegarAId, items }),
      });
      const nombre = usuariosDelegar.find((u) => u.id === delegarAId)?.nombre ?? "compañero";
      setDelegacionMsg(`✅ Lista enviada a ${nombre}`);
      setDelegarAId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo delegar la lista");
    } finally {
      setDelegando(false);
    }
  }

  async function avanzarPaso() {
    const pid = pasosIds[pasoIdx];
    if (pid && ticketId) {
      try {
        if (pasoFile) {
          const fd = new FormData();
          fd.append("archivo", pasoFile);
          await fetch(`/api/tickets/${ticketId}/pasos/${pid}/adjuntos`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
        }
        await tapi(`/${ticketId}/pasos/${pid}`, token, {
          method: "PUT", body: JSON.stringify({ completado: 1 }),
        });
      } catch { /* no crítico */ }
    }
    setPasoFile(null);
    const next = pasoIdx + 1;
    setSlideDir("right");
    if (next >= pasos.length) {
      setFase("cierre");
    } else {
      setPasoIdx(next);
    }
  }

  function retrocederPaso() {
    setSlideDir("left");
    if (pasoIdx === 0) {
      setFase("bienvenida");
      return;
    }
    setPasoIdx(pasoIdx - 1);
  }

  async function completar() {
    if (solicitudPadreId && !reporteTexto.trim()) {
      setError("Escribe el reporte para quien te hizo la solicitud");
      return;
    }
    setCompletando(true);
    setError("");
    try {
      const tid = ticketId!;
      if (corridaIdRef.current) {
        try { await tapi(`/corridas/${corridaIdRef.current}/finalizar`, token, { method: "POST" }); } catch { /* */ }
      }
      if (cierreFile) {
        try {
          const fd = new FormData();
          fd.append("archivo", cierreFile);
          await fetch(`/api/tickets/${tid}/adjuntos`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
        } catch { /* no crítico */ }
      }
      const res = await fetch(`/api/tickets/${tid}/completar-accion`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reporte: reporteTexto.trim(),
          lista_compras: listaCompras,
          cerrar_solicitud: !!solicitudPadreId,
        }),
      });
      if (!res.ok && res.status !== 404) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error || `Error ${res.status}`);
      }
      if (res.status === 404) {
        await tapi(`/${tid}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: "resuelto" }) });
        if (solicitudPadreId) {
          await tapi(`/${solicitudPadreId}/estado`, token, { method: "PUT", body: JSON.stringify({ estado: "resuelto" }) });
        }
      }
      inicioRef.current = null;
      setFase("completada");
    } catch (e: any) {
      setError(e.message ?? "Error al completar");
    } finally {
      setCompletando(false);
    }
  }

  const slide = slideDir === "right" ? "mck-slide-right" : "mck-slide-left";

  // ── Iniciando ──
  if (fase === "iniciando") {
    if (error) return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 text-center px-6">
        <p className="text-4xl">⚠️</p>
        <p className="text-base font-bold text-ink">{error}</p>
        <button onClick={onCancel} className="rounded-2xl border-2 border-border px-6 py-3 text-sm font-bold text-muted hover:border-accent hover:text-accent transition">
          Cancelar
        </button>
      </div>
    );
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 text-center px-6">
        <div className="h-12 w-12 rounded-full border-4 border-border border-t-accent animate-spin" />
        <div className="space-y-1">
          <p className="text-lg font-extrabold text-ink">{plantilla.titulo}</p>
          <p className="text-sm text-muted">Preparando acción…</p>
        </div>
      </div>
    );
  }

  // ── Completada 🏆 ──
  if (fase === "completada") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center px-4">
        <div className="relative">
          <div className="mck-bounce-in text-8xl select-none">🏆</div>
          <div className="absolute inset-0 rounded-full pointer-events-none"
            style={{ animation: "mck-ring-pulse 1s ease-out 0.3s both", background: "radial-gradient(circle, rgba(244,196,77,0.4) 0%, transparent 70%)" }} />
        </div>
        <div className="mck-slide-up space-y-2" style={{ animationDelay: "0.2s" }}>
          <p className="text-xs font-bold uppercase tracking-widest text-accent">¡Acción completada!</p>
          <h2 className="text-4xl font-extrabold text-ink">{plantilla.titulo}</h2>
          {pasos.length > 0 && (
            <p className="text-sm text-muted">{pasos.length} paso{pasos.length !== 1 ? "s" : ""} completado{pasos.length !== 1 ? "s" : ""}</p>
          )}
          <div className="flex justify-center pt-1">
            <div className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-1">
              <span className="text-sm">⏱</span>
              <span className="font-mono text-sm font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">{fmtSeg(seg)}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => onCreated(ticketId!)}
          className="mck-slide-up mt-4 rounded-2xl border-2 border-border px-8 py-3 text-base font-bold text-muted transition hover:border-accent hover:text-accent"
          style={{ animationDelay: "0.4s" }}
        >
          Ver acción completa →
        </button>
      </div>
    );
  }

  const pasoActual = pasos[pasoIdx];

  return (
    <div className="mx-auto w-full max-w-lg pb-10">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <button
          type="button"
          onClick={async () => {
            if (!confirm("¿Cancelar? La acción iniciada seguirá en tu tablero como borrador.")) return;
            if (ticketId && corridaIdRef.current) {
              try { await tapi(`/corridas/${corridaIdRef.current}/pausar`, token, { method: "POST" }); } catch { /* */ }
            }
            onCancel();
          }}
          className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
        >
          ← Salir
        </button>
        {inicioRef.current != null && (
          <div className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/8 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-mono text-sm font-extrabold text-accent tabular-nums">{fmtSeg(seg)}</span>
          </div>
        )}
        {fase === "paso" && totalItems > 0 && (
          <span className="text-xs font-bold text-muted">{pasoIdx + 1} / {totalItems}</span>
        )}
        {(fase === "cierre" || fase === "bienvenida" || fase === "compras_lista" || fase === "compras_tienda") && <span />}
      </div>

      {/* Barra de progreso — solo durante los pasos */}
      {totalItems > 0 && fase === "paso" && (
        <div className="mb-8 h-2.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-all duration-700 ease-out"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
      )}

      {/* ── Bienvenida ── */}
      {fase === "bienvenida" && (
        <div key="rep-bienvenida" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">Tu acción ha comenzado</p>
            <h2 className="text-2xl font-extrabold text-ink leading-tight">{plantilla.titulo}</h2>
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted">¿Necesitas conseguir ingredientes o materiales antes?</p>
            {listaCompras.length > 0 && (
              <button
                type="button"
                onClick={() => { setSlideDir("right"); setFase("compras_lista"); }}
                className="w-full flex items-center gap-4 rounded-2xl border-2 border-border bg-surface-panel px-5 py-4 text-left transition hover:border-accent/60"
              >
                <span className="text-3xl">🛒</span>
                <div>
                  <p className="text-base font-extrabold text-ink">Ir de compras</p>
                  <p className="text-xs text-muted">
                    {listaCompras.length} {listaCompras.length === 1 ? "producto" : "productos"} en lista
                  </p>
                </div>
              </button>
            )}
            <button
              type="button"
              onClick={() => { setSlideDir("right"); setFase(pasos.length > 0 ? "paso" : "cierre"); }}
              className="w-full rounded-2xl border-2 border-border py-3.5 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
            >
              Ya tengo todo · continuar →
            </button>
          </div>
        </div>
      )}

      {/* ── Lista de compras (read-only + delegable) ── */}
      {fase === "compras_lista" && (
        <div key="rep-compras-lista" className={`space-y-5 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">Lista de compras</p>
            <h2 className="text-2xl font-extrabold text-ink leading-tight">{plantilla.titulo}</h2>
            <p className="mt-1 text-sm text-muted">Productos necesarios para esta acción.</p>
          </div>

          <div className="space-y-2">
            {listaCompras.map((m, mi) => !m.n.trim() ? null : (
              <div key={mi} className="flex items-center gap-3 rounded-2xl border-2 border-border bg-surface-panel px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-border text-sm font-bold text-muted">
                  {mi + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink">{m.n.trim()}</p>
                  {formatCantidadItem(m) && <p className="text-xs text-muted">{formatCantidadItem(m)}</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-blue-400/30 bg-blue-50/30 dark:bg-blue-900/10 p-3 space-y-2">
            <p className="text-xs font-bold text-ink">¿Alguien más va de compras?</p>
            <p className="text-[11px] text-muted">Crea una solicitud con este checklist para esa persona.</p>
            <select
              className="quest-input w-full text-sm"
              value={delegarAId}
              onChange={(e) => setDelegarAId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Elegir compañero…</option>
              {usuariosDelegar
                .filter((u) => u.id !== user.id && u.activo !== 0)
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
            </select>
            <button
              type="button"
              disabled={delegando || !delegarAId}
              onClick={() => void delegarListaCompras()}
              className="w-full rounded-xl border-2 border-blue-500 py-2.5 text-sm font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-500/10 disabled:opacity-40"
            >
              {delegando ? "Enviando…" : "Enviar lista a compañero"}
            </button>
            {delegacionMsg && <p className="text-xs font-semibold text-accent">{delegacionMsg}</p>}
          </div>

          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
          )}

          <button
            type="button"
            onClick={() => { setSlideDir("right"); setFase("compras_tienda"); }}
            className="w-full rounded-2xl bg-accent py-4 text-base font-extrabold text-white transition hover:brightness-110"
          >
            Yo voy de compras →
          </button>
          <button
            type="button"
            onClick={() => { setSlideDir("left"); setFase("bienvenida"); }}
            className="w-full rounded-2xl border-2 border-border py-3 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
          >
            ← Atrás
          </button>
        </div>
      )}

      {/* ── En la tienda (checklist) ── */}
      {fase === "compras_tienda" && (
        <div key="rep-compras-tienda" className={`space-y-5 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">En la tienda</p>
            <h2 className="text-2xl font-extrabold text-ink leading-tight">Marca cada producto al conseguirlo</h2>
          </div>

          <div className="space-y-2">
            {listaCompras.map((m, mi) => !m.n.trim() ? null : (
              <button
                key={mi}
                type="button"
                onClick={() => setListaCompras((ms) => ms.map((x, j) => (j === mi ? { ...x, comprado: !x.comprado } : x)))}
                className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition
                  ${m.comprado ? "border-accent bg-accent/10" : "border-border bg-surface-panel hover:border-accent/40"}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold
                  ${m.comprado ? "border-accent bg-accent text-white" : "border-border text-muted"}`}>
                  {m.comprado ? "✓" : ""}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold ${m.comprado ? "text-accent line-through decoration-accent/50" : "text-ink"}`}>
                    {m.n.trim()}
                  </p>
                  {formatCantidadItem(m) && <p className="text-xs text-muted">{formatCantidadItem(m)}</p>}
                </div>
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!todosComprados}
            onClick={() => { setSlideDir("right"); setFase(pasos.length > 0 ? "paso" : "cierre"); }}
            className="w-full rounded-2xl bg-accent py-4 text-base font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Ya tengo todo · continuar →
          </button>
          {!todosComprados && listaCompras.filter((m) => m.n.trim()).length > 0 && (
            <p className="text-center text-xs text-muted">
              Marca los {listaCompras.filter((m) => m.n.trim()).length} productos de la lista
            </p>
          )}
          <button
            type="button"
            onClick={() => { setSlideDir("left"); setFase("compras_lista"); }}
            className="w-full rounded-2xl border-2 border-border py-3 text-sm font-bold text-muted transition hover:border-accent hover:text-accent"
          >
            ← Ver lista
          </button>
        </div>
      )}

      {/* ── Paso uno a uno ── */}
      {fase === "paso" && pasoActual && (
        <div key={`rep-paso-${pasoIdx}`} className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent/70 mb-2">
              {plantilla.titulo}
            </p>
            <h2 className="text-[2rem] font-extrabold leading-tight text-ink">
              {pasoActual.nombre}
            </h2>
            {pasoActual.desc && (
              <p className="mt-3 text-base text-muted">{pasoActual.desc}</p>
            )}
          </div>

          {/* Fotos/archivos de referencia del paso original */}
          {pasoActual.adjuntos_ref && pasoActual.adjuntos_ref.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted">
                Referencia visual
              </p>
              <div className="flex flex-wrap gap-3">
                {pasoActual.adjuntos_ref.map((a, i) => {
                  const esImagen = a.mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.nombre_archivo);
                  const url = ticketsUploadUrl(a.nombre_archivo, token);
                  if (esImagen) {
                    return (
                      <a key={i} href={url} target="_blank" rel="noreferrer" className="shrink-0">
                        <img
                          src={url}
                          alt={`Referencia ${i + 1}`}
                          className="h-44 w-auto max-w-full rounded-2xl border-2 border-border object-cover shadow-md hover:border-accent transition-colors"
                        />
                      </a>
                    );
                  }
                  return (
                    <a key={i} href={url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 rounded-2xl border-2 border-border bg-surface px-4 py-3 text-sm font-semibold text-accent hover:border-accent transition-colors">
                      📄 Ver archivo de referencia
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <label className={`flex items-center gap-3 rounded-2xl border-2 cursor-pointer px-4 py-3 transition
            ${pasoFile ? "border-accent bg-accent/8" : "border-dashed border-border hover:border-accent/60"}`}>
            <span className="text-xl">{pasoFile ? "📎" : "📷"}</span>
            <span className="text-sm font-semibold text-muted truncate">
              {pasoFile ? pasoFile.name : "Adjuntar foto o archivo (opcional)"}
            </span>
            {pasoFile && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setPasoFile(null); }}
                className="ml-auto text-xs text-danger hover:underline shrink-0"
              >
                Quitar
              </button>
            )}
            <input
              type="file"
              accept="image/*,.pdf,application/pdf,.doc,.docx"
              className="sr-only"
              onChange={(e) => setPasoFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            onClick={() => void avanzarPaso()}
            className="w-full rounded-2xl bg-accent py-5 text-xl font-extrabold text-white transition hover:brightness-110 active:scale-95 shadow-lg"
          >
            ✓ &nbsp;Hecho
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={retrocederPaso}
              className="flex-1 rounded-xl border-2 border-border py-2.5 text-sm font-bold text-muted transition hover:border-accent/60 hover:text-accent"
            >
              ← Atrás
            </button>
            <button
              type="button"
              onClick={() => { setPasoFile(null); setSlideDir("right"); const next = pasoIdx + 1; if (next >= pasos.length) setFase("cierre"); else setPasoIdx(next); }}
              className="flex-1 rounded-xl border-2 border-border py-2.5 text-sm font-bold text-muted/60 transition hover:border-accent/30 hover:text-muted"
            >
              Saltar →
            </button>
          </div>
        </div>
      )}

      {/* ── Cierre / reporte ── */}
      {fase === "cierre" && (
        <div key="rep-cierre" className={`space-y-6 ${slide}`}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-1">Último paso</p>
            <h2 className="text-3xl font-extrabold text-ink leading-tight">
              {solicitudPadreId ? "Reporte final" : "¡Ya casi!"}
            </h2>
            <p className="mt-2 rounded-2xl border-2 border-accent/30 bg-accent/5 px-4 py-3 text-base font-bold text-ink">
              {plantilla.titulo}
            </p>
          </div>
          {solicitudPadreId ? (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted">
                Reporte para quien te hizo la solicitud
              </label>
              <div className="flex gap-2">
                <textarea
                  autoFocus
                  className="w-full rounded-2xl border-2 border-border bg-surface-input px-4 py-3 text-sm text-ink outline-none focus:border-accent resize-none placeholder:text-muted/40"
                  placeholder="Describe cómo quedó la tarea…"
                  rows={4}
                  value={reporteTexto}
                  onChange={(e) => setReporteTexto(e.target.value)}
                />
                <SttInlineBtn stt={stt} onStart={() => void stt.iniciar((t) => setReporteTexto(t))} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">¿Todo listo? Marca la acción como completada.</p>
          )}

          <label className={`flex items-center gap-3 rounded-2xl border-2 cursor-pointer px-4 py-3 transition
            ${cierreFile ? "border-accent bg-accent/8" : "border-dashed border-border hover:border-accent/60"}`}>
            <span className="text-xl">{cierreFile ? "📎" : "📷"}</span>
            <span className="text-sm font-semibold text-muted truncate">
              {cierreFile ? cierreFile.name : "Adjuntar foto o evidencia (opcional)"}
            </span>
            {cierreFile && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setCierreFile(null); }}
                className="ml-auto text-xs text-danger hover:underline shrink-0"
              >
                Quitar
              </button>
            )}
            <input
              type="file"
              accept="image/*,.pdf,application/pdf,.doc,.docx"
              className="sr-only"
              onChange={(e) => setCierreFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <button
            type="button"
            disabled={completando || (!!solicitudPadreId && !reporteTexto.trim())}
            onClick={() => void completar()}
            className="w-full rounded-2xl bg-accent py-4 text-lg font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {completando ? "Completando…" : "Completar acción →"}
          </button>
          {pasos.length > 0 && (
            <button
              type="button"
              onClick={() => { setSlideDir("left"); setPasoIdx(pasos.length - 1); setFase("paso"); }}
              className="w-full text-center text-sm text-muted hover:text-ink transition"
            >
              ← Ver pasos
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface PendienteItem {
  id: number;
  titulo: string;
  descripcion?: string | null;
  fecha_recordatorio?: string | null;
  estado: "pendiente" | "iniciado" | "descartado";
  ticket_id?: number | null;
  creado_en: string;
}

interface RecordatorioItem {
  id: number;
  titulo: string;
  descripcion?: string | null;
  tipo_rep: "una_vez" | "diario" | "semanal" | "mensual" | "cada_n_dias";
  proxima_fecha: string;
  cada_n_dias?: number | null;
  dias_semana?: number[] | null;
  dias_semana_parsed?: number[];
  dias_mes?: number[] | null;
  dias_mes_parsed?: number[];
  activo: number;
  creado_en: string;
}

// ── PendientesPanel ───────────────────────────────────────────────────────────

function PendientesPanel({
  token,
  pendientes,
  loading,
  onRecargar,
  onIniciarAccion,
}: {
  token: string;
  pendientes: PendienteItem[];
  loading: boolean;
  onRecargar: () => void;
  onIniciarAccion: (p: PendienteItem) => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);

  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [fecha, setFecha] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editTitulo, setEditTitulo] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editFecha, setEditFecha] = useState("");
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  function estadoFecha(f: string | null | undefined): "vencido" | "hoy" | "pronto" | "futuro" | null {
    if (!f) return null;
    if (f < hoy) return "vencido";
    if (f === hoy) return "hoy";
    const diff = Math.ceil((new Date(f).getTime() - new Date(hoy).getTime()) / 86400000);
    return diff <= 3 ? "pronto" : "futuro";
  }

  function fmtFecha(f: string) {
    try {
      const d = new Date(f + "T12:00:00");
      return d.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
    } catch { return f; }
  }

  async function crear() {
    if (!titulo.trim()) return;
    setGuardando(true);
    setError("");
    try {
      await tapi("/pendientes", token, {
        method: "POST",
        body: JSON.stringify({
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || undefined,
          fecha_recordatorio: fecha || undefined,
        }),
      });
      setTitulo("");
      setDescripcion("");
      setFecha("");
      onRecargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally { setGuardando(false); }
  }

  async function descartar(id: number) {
    try {
      await tapi(`/pendientes/${id}`, token, { method: "DELETE" });
      onRecargar();
    } catch { /* ignore */ }
  }

  function abrirEditar(p: PendienteItem) {
    setEditandoId(p.id);
    setEditTitulo(p.titulo);
    setEditDesc(p.descripcion ?? "");
    setEditFecha(p.fecha_recordatorio ?? "");
  }

  async function guardarEdicion(id: number) {
    if (!editTitulo.trim()) return;
    setGuardandoEdit(true);
    try {
      await tapi(`/pendientes/${id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          titulo: editTitulo.trim(),
          descripcion: editDesc.trim() || null,
          fecha_recordatorio: editFecha || null,
        }),
      });
      setEditandoId(null);
      onRecargar();
    } catch { /* ignore */ } finally { setGuardandoEdit(false); }
  }

  const badgeClases = {
    vencido: "bg-danger/15 text-danger border border-danger/30",
    hoy:     "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300/50",
    pronto:  "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-300/40",
    futuro:  "bg-surface border border-border text-muted",
  };

  const [showForm, setShowForm] = useState(false);

  function resetForm() {
    setTitulo(""); setDescripcion(""); setFecha(""); setError("");
  }

  return (
    <div className="space-y-3">
      {/* Encabezado con botón crear */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">
          {pendientes.length > 0 ? `${pendientes.length} acción${pendientes.length !== 1 ? "es" : ""} futura${pendientes.length !== 1 ? "s" : ""}` : "Acciones futuras"}
        </p>
        <button
          type="button"
          onClick={() => { setShowForm((v) => !v); if (showForm) resetForm(); }}
          className={`flex items-center gap-1.5 rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition ${
            showForm ? "border-border text-muted hover:border-danger hover:text-danger" : "border-accent text-accent hover:bg-accent/10"
          }`}
        >
          {showForm ? "✕ Cancelar" : "+ Nueva acción futura"}
        </button>
      </div>

      {/* Formulario colapsable */}
      {showForm && (
        <div className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3">
          <input
            autoFocus
            className="w-full rounded-xl border-2 border-border bg-surface-input px-4 py-3 text-base font-semibold text-ink outline-none focus:border-accent placeholder:text-muted/40"
            placeholder="Ej: Reparar el computador, revisar la cotización del proveedor…"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && titulo.trim()) void crear().then(() => setShowForm(false)); }}
            maxLength={150}
          />
          <textarea
            className="w-full rounded-xl border-2 border-border bg-surface-input px-4 py-2.5 text-sm text-ink outline-none focus:border-accent resize-none placeholder:text-muted/40"
            placeholder="Detalle opcional…"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
          {/* Fecha opcional */}
          <div className="flex items-center gap-2 rounded-xl border-2 border-border bg-surface-input px-3 py-2">
            <span className="text-base shrink-0">📅</span>
            <span className="text-xs text-muted shrink-0">Fecha recordatorio</span>
            <input
              type="date"
              className="flex-1 bg-transparent text-sm text-ink outline-none"
              value={fecha}
              min={hoy}
              onChange={(e) => setFecha(e.target.value)}
              aria-label="Fecha de recordatorio (opcional)"
            />
            {fecha && (
              <button type="button" onClick={() => setFecha("")} className="shrink-0 text-xs text-muted hover:text-danger">✕</button>
            )}
          </div>
          {!fecha && <p className="text-[11px] text-muted -mt-1">Sin fecha — aparecerá en la lista sin recordatorio</p>}
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            type="button"
            disabled={!titulo.trim() || guardando}
            onClick={() => void crear().then(() => setShowForm(false))}
            className="w-full rounded-xl bg-accent py-3 text-sm font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Guardar acción futura"}
          </button>
        </div>
      )}

      {/* Lista */}
      {loading && <p className="py-6 text-center text-sm text-muted">Cargando…</p>}

      {!loading && pendientes.length === 0 && !showForm && (
        <div className="py-12 text-center space-y-2">
          <p className="text-3xl">🗓️</p>
          <p className="text-sm text-muted">Sin acciones futuras anotadas.</p>
          <p className="text-xs text-muted">Úsala para tareas que requieren tu atención pero todavía no arrancas — como reparar algo, resolver un tema o empezar un proyecto. Cuando estés listo, la conviertes en acción.</p>
        </div>
      )}

      {!loading && pendientes.length > 0 && (
        <div className="space-y-2">
          {pendientes.map((p) => {
            const ef = estadoFecha(p.fecha_recordatorio);
            const esEditando = editandoId === p.id;
            return (
              <div
                key={p.id}
                className={`rounded-2xl border-2 bg-surface-panel transition ${
                  ef === "vencido" ? "border-danger/40" : ef === "hoy" ? "border-amber-400/50" : "border-border"
                }`}
              >
                {esEditando ? (
                  <div className="p-4 space-y-2">
                    <input
                      autoFocus
                      className="w-full rounded-xl border-2 border-border bg-surface-input px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-accent"
                      value={editTitulo}
                      onChange={(e) => setEditTitulo(e.target.value)}
                      maxLength={150}
                    />
                    <textarea
                      className="w-full rounded-xl border-2 border-border bg-surface-input px-3 py-2 text-xs text-ink outline-none focus:border-accent resize-none"
                      rows={2}
                      placeholder="Detalle (opcional)"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                    />
                    <div className="flex items-center gap-2 rounded-xl border-2 border-border bg-surface-input px-3 py-2">
                      <span className="text-sm shrink-0">📅</span>
                      <span className="text-xs text-muted shrink-0">Fecha</span>
                      <input
                        type="date"
                        className="flex-1 bg-transparent text-xs text-ink outline-none"
                        value={editFecha}
                        onChange={(e) => setEditFecha(e.target.value)}
                      />
                      {editFecha && (
                        <button type="button" onClick={() => setEditFecha("")} className="text-xs text-muted hover:text-danger">✕</button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={guardandoEdit || !editTitulo.trim()}
                        onClick={() => void guardarEdicion(p.id)}
                        className="flex-1 rounded-xl bg-accent py-2 text-xs font-bold text-white disabled:opacity-40"
                      >
                        {guardandoEdit ? "Guardando…" : "✓ Guardar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditandoId(null)}
                        className="rounded-xl border-2 border-border px-4 py-2 text-xs font-bold text-muted hover:border-accent hover:text-accent"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 font-semibold text-sm text-ink leading-snug">{p.titulo}</p>
                      {ef && (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClases[ef]}`}>
                          {ef === "vencido" ? "⚠ Vencido" : ef === "hoy" ? "🔔 Hoy" : `📅 ${fmtFecha(p.fecha_recordatorio!)}`}
                        </span>
                      )}
                    </div>
                    {p.descripcion && <p className="text-xs text-muted">{p.descripcion}</p>}
                    <div className="flex gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => onIniciarAccion(p)}
                        className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-2.5 text-sm font-extrabold text-white transition active:scale-[0.98]"
                      >
                        ▶ Iniciar acción
                      </button>
                      <button
                        type="button"
                        onClick={() => abrirEditar(p)}
                        className="rounded-xl border-2 border-border px-3 py-2 text-xs font-bold text-muted transition hover:border-accent hover:text-accent"
                        title="Editar"
                      >✏️</button>
                      <button
                        type="button"
                        onClick={() => void descartar(p.id)}
                        className="rounded-xl border-2 border-border px-3 py-2 text-xs font-bold text-muted transition hover:border-danger hover:text-danger"
                        title="Descartar"
                      >✕</button>
                    </div>
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

// ── RecordatoriosPanel ────────────────────────────────────────────────────────

const DIAS_SEMANA_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const TIPO_REP_LABELS: Record<string, string> = {
  una_vez: "Una sola vez",
  diario: "Todos los días",
  semanal: "Semanal",
  mensual: "Días del mes",
  cada_n_dias: "Cada N días",
};

function descRepeticion(r: RecordatorioItem): string {
  switch (r.tipo_rep) {
    case "una_vez":   return "Una sola vez";
    case "diario":    return "Todos los días";
    case "cada_n_dias": return `Cada ${r.cada_n_dias ?? "?"} día${(r.cada_n_dias ?? 1) !== 1 ? "s" : ""}`;
    case "semanal": {
      const dias = (r.dias_semana_parsed ?? []).map((d) => DIAS_SEMANA_LABELS[d]).join(", ");
      return dias ? `Cada semana: ${dias}` : "Semanal";
    }
    case "mensual": {
      const dias = (r.dias_mes_parsed ?? []).join(", ");
      return dias ? `Día${(r.dias_mes_parsed ?? []).length !== 1 ? "s" : ""} ${dias} de cada mes` : "Mensual";
    }
    default: return r.tipo_rep;
  }
}

function RecordatoriosPanel({
  token,
  recordatorios,
  loading,
  onRecargar,
}: {
  token: string;
  recordatorios: RecordatorioItem[];
  loading: boolean;
  onRecargar: () => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [tipoRep, setTipoRep] = useState<RecordatorioItem["tipo_rep"]>("una_vez");
  const [fechaInicio, setFechaInicio] = useState(hoy);
  const [cadaN, setCadaN] = useState(1);
  const [diasSemana, setDiasSemana] = useState<number[]>([]);
  const [diasMes, setDiasMes] = useState<number[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);

  function toggleDiaSemana(d: number) {
    setDiasSemana((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  }
  function toggleDiaMes(d: number) {
    setDiasMes((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b));
  }

  async function crear() {
    if (!titulo.trim()) return;
    if (tipoRep === "semanal" && diasSemana.length === 0) { setError("Elige al menos un día de la semana"); return; }
    if (tipoRep === "mensual" && diasMes.length === 0) { setError("Elige al menos un día del mes"); return; }
    setGuardando(true); setError("");
    try {
      await tapi("/recordatorios", token, {
        method: "POST",
        body: JSON.stringify({
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || undefined,
          tipo_rep: tipoRep,
          fecha_inicio: fechaInicio || hoy,
          cada_n_dias: tipoRep === "cada_n_dias" ? cadaN : undefined,
          dias_semana: tipoRep === "semanal" ? diasSemana : undefined,
          dias_mes: tipoRep === "mensual" ? diasMes : undefined,
        }),
      });
      setTitulo(""); setDescripcion(""); setTipoRep("una_vez");
      setFechaInicio(hoy); setCadaN(1); setDiasSemana([]); setDiasMes([]);
      onRecargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally { setGuardando(false); }
  }

  async function marcarVisto(id: number) {
    try {
      await tapi(`/recordatorios/${id}/visto`, token, { method: "POST" });
      onRecargar();
    } catch { /* ignore */ }
  }

  async function eliminar(id: number) {
    if (!confirm("¿Eliminar este recordatorio?")) return;
    try {
      await tapi(`/recordatorios/${id}`, token, { method: "DELETE" });
      onRecargar();
    } catch { /* ignore */ }
  }

  function fmtFecha(f: string) {
    try {
      return new Date(f + "T12:00:00").toLocaleDateString("es-CO", {
        weekday: "short", day: "numeric", month: "short",
      });
    } catch { return f; }
  }

  const activos = recordatorios.filter((r) => r.proxima_fecha <= hoy);
  const proximos = recordatorios.filter((r) => r.proxima_fecha > hoy);

  return (
    <div className="space-y-5">
      {/* Formulario */}
      <div className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Nuevo recordatorio</p>
        <p className="text-xs text-muted">Para cosas simples del día a día — pagar un recibo, llamar a alguien, renovar algo. Solo necesitas que te avise en el momento.</p>

        <input
          className="w-full rounded-xl border-2 border-border bg-surface-input px-4 py-3 text-base font-semibold text-ink outline-none focus:border-accent placeholder:text-muted/40"
          placeholder="Ej: Pagar recibo del celular, llamar al banco, renovar el seguro…"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          maxLength={150}
        />
        <textarea
          className="w-full rounded-xl border-2 border-border bg-surface-input px-4 py-2.5 text-sm text-ink outline-none focus:border-accent resize-none placeholder:text-muted/40"
          placeholder="Detalle opcional…"
          rows={2}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />

        {/* Tipo de repetición */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {(Object.entries(TIPO_REP_LABELS) as [RecordatorioItem["tipo_rep"], string][]).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTipoRep(k)}
              className={`rounded-xl border-2 py-2 text-xs font-bold transition ${
                tipoRep === k ? "border-accent bg-accent text-white" : "border-border text-muted hover:border-accent/60"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Fecha de inicio */}
        <div className="flex items-center gap-2 rounded-xl border-2 border-border bg-surface-input px-3 py-2">
          <span className="text-base">📅</span>
          <span className="text-xs text-muted shrink-0">
            {tipoRep === "una_vez" ? "Fecha:" : "Empieza el:"}
          </span>
          <input
            type="date"
            className="flex-1 bg-transparent text-sm text-ink outline-none"
            value={fechaInicio}
            min={hoy}
            onChange={(e) => setFechaInicio(e.target.value)}
          />
        </div>

        {/* Cada N días */}
        {tipoRep === "cada_n_dias" && (
          <div className="flex items-center gap-3 rounded-xl border-2 border-border bg-surface-input px-4 py-2.5">
            <span className="text-sm text-muted">Repetir cada</span>
            <input
              type="number"
              min={1}
              max={365}
              className="w-20 bg-transparent text-center text-base font-bold text-ink outline-none"
              value={cadaN}
              onChange={(e) => setCadaN(Math.max(1, Number(e.target.value)))}
            />
            <span className="text-sm text-muted">día{cadaN !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Días de la semana */}
        {tipoRep === "semanal" && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted font-semibold">Días de la semana:</p>
            <div className="flex gap-1.5 flex-wrap">
              {DIAS_SEMANA_LABELS.map((lbl, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDiaSemana(i)}
                  className={`rounded-lg border-2 px-3 py-1.5 text-xs font-bold transition ${
                    diasSemana.includes(i) ? "border-accent bg-accent text-white" : "border-border text-muted hover:border-accent/60"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Días del mes */}
        {tipoRep === "mensual" && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted font-semibold">Días del mes:</p>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDiaMes(d)}
                  className={`rounded-lg border py-1.5 text-xs font-bold transition ${
                    diasMes.includes(d) ? "border-accent bg-accent text-white" : "border-border text-muted hover:border-accent/50"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        <button
          type="button"
          disabled={!titulo.trim() || guardando}
          onClick={() => void crear()}
          className="w-full rounded-xl bg-accent py-3 text-sm font-extrabold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Programar recordatorio"}
        </button>
      </div>

      {loading && <p className="py-6 text-center text-sm text-muted">Cargando recordatorios…</p>}

      {/* Activos hoy / vencidos */}
      {!loading && activos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-danger flex items-center gap-1.5">
            🔔 Para hoy
          </p>
          {activos.map((r) => (
            <div key={r.id} className={`rounded-2xl border-2 bg-surface-panel p-4 space-y-2 ${
              r.proxima_fecha < hoy ? "border-danger/50" : "border-amber-400/60"
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-ink leading-snug">{r.titulo}</p>
                  {r.descripcion && <p className="text-xs text-muted mt-0.5">{r.descripcion}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => eliminar(r.id)}
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] text-muted hover:border-danger hover:text-danger transition"
                >✕</button>
              </div>
              <p className="text-[11px] text-muted">{descRepeticion(r)}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void marcarVisto(r.id)}
                  className="flex-1 rounded-xl bg-accent py-2 text-xs font-extrabold text-white transition hover:brightness-110"
                >
                  {r.tipo_rep === "una_vez" ? "✓ Listo, eliminar" : "✓ Visto · programar siguiente"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditandoId(editandoId === r.id ? null : r.id)}
                  className="rounded-xl border-2 border-border px-3 py-2 text-xs font-bold text-muted hover:border-accent hover:text-accent transition"
                >✏️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Próximos */}
      {!loading && proximos.length > 0 && (
        <div className="space-y-2">
          {activos.length > 0 && <p className="text-xs font-bold uppercase tracking-wide text-muted">Próximos</p>}
          {proximos.map((r) => (
            <div key={r.id} className="rounded-2xl border-2 border-border bg-surface-panel p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-ink leading-snug">{r.titulo}</p>
                  {r.descripcion && <p className="text-xs text-muted mt-0.5">{r.descripcion}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => eliminar(r.id)}
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] text-muted hover:border-danger hover:text-danger transition"
                >✕</button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">{descRepeticion(r)}</span>
                <span className="rounded-full bg-surface border border-border px-2.5 py-0.5 text-[11px] font-semibold text-ink">
                  📅 {fmtFecha(r.proxima_fecha)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && recordatorios.length === 0 && (
        <div className="py-12 text-center space-y-2">
          <p className="text-3xl">🔔</p>
          <p className="text-sm text-muted">Sin recordatorios programados.</p>
          <p className="text-xs text-muted">Ideal para cosas simples y recurrentes — pagar recibos, llamadas pendientes, renovaciones. No necesitas describir pasos, solo que el sistema te avise a tiempo.</p>
          <p className="text-xs text-muted">Programa una alerta que se repite automáticamente.</p>
        </div>
      )}
    </div>
  );
}

// ── ProcedimientoCard ─────────────────────────────────────────────────────────

function ProcedimientoCard({
  p,
  token,
  onEjecutar,
  onActualizado,
}: {
  p: Protocolo;
  token: string;
  onEjecutar: () => void;
  onActualizado: () => void;
}) {
  type PasoDraft = {
    descripcion: string;
    notas: string;
    adjuntos_ref: { nombre_archivo: string; mime: string }[];
  };

  const alcanceActual = (p.alcance ?? "personal") as "personal" | "global" | "seleccionado";
  const esGlobal = alcanceActual === "global";
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(p.titulo);
  const [pasosDraft, setPasosDraft] = useState<PasoDraft[]>(
    () => (p.pasos || []).map((x) => ({
      descripcion: x.descripcion,
      notas: x.notas ?? "",
      adjuntos_ref: x.adjuntos_ref ?? [],
    }))
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [subiendoFoto, setSubiendoFoto] = useState<number | null>(null);

  // Picker de visibilidad
  const [showPicker, setShowPicker] = useState(false);
  const [pickerAlcance, setPickerAlcance] = useState<"personal" | "global" | "seleccionado">(alcanceActual);
  const [pickerUserIds, setPickerUserIds] = useState<number[]>(
    () => (p.usuarios_compartidos ?? []).map((u) => u.id)
  );
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(false);
  const [savingPicker, setSavingPicker] = useState(false);

  async function subirFotoPaso(pasoIdx: number, file: File) {
    setSubiendoFoto(pasoIdx);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      const res = await fetch("/api/tickets/protocolos/upload-foto", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error || `Error ${res.status}`);
      }
      const { nombre_archivo, mime } = await res.json();
      setPasosDraft((prev) =>
        prev.map((x, i) =>
          i === pasoIdx
            ? { ...x, adjuntos_ref: [...x.adjuntos_ref, { nombre_archivo, mime }] }
            : x
        )
      );
    } catch (e: any) {
      setMsg(e.message ?? "Error al subir foto");
      setTimeout(() => setMsg(""), 3000);
    } finally { setSubiendoFoto(null); }
  }

  async function guardarEdicion() {
    if (!titulo.trim()) { setMsg("El título no puede estar vacío."); return; }
    setSaving(true);
    setMsg("");
    try {
      await tapi(`/protocolos/${p.id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          titulo: titulo.trim(),
          descripcion: p.descripcion ?? "",
          categoria: p.categoria ?? "",
          pasos: pasosDraft
            .filter((x) => x.descripcion.trim())
            .map((x) => ({
              descripcion: x.descripcion.trim(),
              notas: x.notas.trim() || null,
              adjuntos_ref: x.adjuntos_ref.length ? x.adjuntos_ref : undefined,
            })),
        }),
      });
      setEditando(false);
      onActualizado();
    } catch (e: any) {
      setMsg(e.message ?? "Error al guardar");
    } finally { setSaving(false); }
  }

  function abrirPicker() {
    setPickerAlcance(alcanceActual);
    setPickerUserIds((p.usuarios_compartidos ?? []).map((u) => u.id));
    setShowPicker(true);
    if (usuarios.length === 0) {
      setLoadingUsuarios(true);
      tapi("/usuarios", token)
        .then((d) => setUsuarios(Array.isArray(d) ? d as UserInfo[] : []))
        .catch(() => {})
        .finally(() => setLoadingUsuarios(false));
    }
  }

  async function guardarVisibilidad() {
    if (pickerAlcance === "seleccionado" && pickerUserIds.length === 0) {
      setMsg("Selecciona al menos un usuario.");
      return;
    }
    setSavingPicker(true);
    setMsg("");
    try {
      await tapi(`/protocolos/${p.id}/visibilidad`, token, {
        method: "POST",
        body: JSON.stringify({ alcance: pickerAlcance, usuario_ids: pickerUserIds }),
      });
      setShowPicker(false);
      onActualizado();
    } catch (e: any) {
      setMsg(e.message ?? "Error al guardar visibilidad");
    } finally { setSavingPicker(false); }
  }

  function cancelarEdicion() {
    setTitulo(p.titulo);
    setPasosDraft((p.pasos || []).map((x) => ({
      descripcion: x.descripcion,
      notas: x.notas ?? "",
      adjuntos_ref: x.adjuntos_ref ?? [],
    })));
    setEditando(false);
    setMsg("");
  }

  return (
    <div className={`rounded-xl border-2 bg-surface-panel p-3 space-y-2 transition-colors
      ${esGlobal ? "border-accent/40" : "border-border"}`}>

      {/* Cabecera: título + badge de privacidad (cliclable) */}
      {!editando ? (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink text-sm leading-snug">{p.titulo}</p>
            <p className="text-xs text-muted mt-0.5">
              {p.pasos?.length ?? 0} paso{(p.pasos?.length ?? 0) !== 1 ? "s" : ""}
              {(p.lista_compras?.length ?? 0) > 0 && ` · ${p.lista_compras!.length} ingrediente${p.lista_compras!.length !== 1 ? "s" : ""}`}
            </p>
            {alcanceActual === "seleccionado" && (p.usuarios_compartidos ?? []).length > 0 && (
              <p className="text-[10px] text-muted mt-0.5 truncate">
                👤 {(p.usuarios_compartidos ?? []).map((u) => u.nombre.split(" ")[0]).join(", ")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={abrirPicker}
            title="Cambiar visibilidad"
            className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 border transition-colors hover:opacity-80
              ${alcanceActual === "global"
                ? "text-accent bg-accent/10 border-accent/25"
                : alcanceActual === "seleccionado"
                  ? "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/25"
                  : "text-muted bg-surface-hover border-border"
              }`}>
            {alcanceActual === "global" ? "🌐 Equipo" : alcanceActual === "seleccionado" ? "👤 Específico" : "🔒 Privado"}
          </button>
        </div>
      ) : (
        /* Modo edición */
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1 block">Título</label>
            <input
              autoFocus
              className="quest-input w-full text-sm"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted block">
              Pasos {pasosDraft.length > 0 && <span className="font-normal">({pasosDraft.length})</span>}
            </label>
            {pasosDraft.map((paso, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-2.5 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-muted mt-2 shrink-0 w-4 text-center">{i + 1}</span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      className="quest-input w-full text-xs"
                      placeholder="Nombre del paso…"
                      value={paso.descripcion}
                      onChange={(e) => setPasosDraft((prev) =>
                        prev.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x)
                      )}
                    />
                    <input
                      className="quest-input w-full text-xs"
                      placeholder="Notas / instrucciones (opcional)…"
                      value={paso.notas}
                      onChange={(e) => setPasosDraft((prev) =>
                        prev.map((x, j) => j === i ? { ...x, notas: e.target.value } : x)
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setPasosDraft((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 text-muted hover:text-red-500 p-1 transition-colors mt-0.5"
                    title="Eliminar paso"
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </div>

                {/* Fotos de referencia del paso */}
                <div className="ml-6 space-y-1.5">
                  {paso.adjuntos_ref.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {paso.adjuntos_ref.map((a, ai) => {
                        const esImagen = a.mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.nombre_archivo);
                        const url = ticketsUploadUrl(a.nombre_archivo, token);
                        return (
                          <div key={ai} className="relative group">
                            {esImagen
                              ? <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-border" />
                              : <a href={url} target="_blank" rel="noreferrer"
                                  className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface text-xl">📄</a>
                            }
                            <button
                              type="button"
                              onClick={() => setPasosDraft((prev) =>
                                prev.map((x, j) =>
                                  j === i
                                    ? { ...x, adjuntos_ref: x.adjuntos_ref.filter((_, k) => k !== ai) }
                                    : x
                                )
                              )}
                              className="absolute -top-1 -right-1 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold shadow"
                              title="Quitar foto"
                            >✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Botón agregar foto */}
                  <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors
                    ${subiendoFoto === i
                      ? "border-accent/40 text-accent/60"
                      : "border-dashed border-border text-muted hover:border-accent hover:text-accent"
                    }`}>
                    {subiendoFoto === i
                      ? <><span className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> Subiendo…</>
                      : <><span>📷</span> Agregar foto de referencia</>
                    }
                    <input
                      type="file"
                      accept="image/*,.pdf,application/pdf"
                      className="sr-only"
                      disabled={subiendoFoto !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void subirFotoPaso(i, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPasosDraft((prev) => [...prev, { descripcion: "", notas: "", adjuntos_ref: [] }])}
              className="flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Icon name="plus" size={11} weight="bold" /> Agregar paso
            </button>
          </div>

          {msg && <p className="text-xs text-red-400">{msg}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" disabled={saving} onClick={guardarEdicion}
              className="flex-1 rounded-xl bg-accent py-2 text-xs font-bold text-white disabled:opacity-40">
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
            <button type="button" onClick={cancelarEdicion}
              className="rounded-xl border border-border px-3 py-2 text-xs text-muted hover:text-ink">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {msg && !editando && <p className="text-xs text-red-400">{msg}</p>}

      {/* Picker de visibilidad */}
      {showPicker && !editando && (
        <div className="rounded-xl border-2 border-accent/30 bg-accent/5 p-3 space-y-3">
          <p className="text-xs font-extrabold text-ink">¿Quién puede ver este procedimiento?</p>
          <div className="space-y-2">
            {([
              { value: "personal",    icon: "🔒", label: "Solo yo",              desc: "Solo tú puedes verlo y ejecutarlo" },
              { value: "global",      icon: "🌐", label: "Todo el equipo",       desc: "Cualquier persona del equipo puede ejecutarlo" },
              { value: "seleccionado",icon: "👤", label: "Personas específicas", desc: "Elige exactamente quién puede verlo" },
            ] as const).map((opt) => (
              <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name={`vis-${p.id}`}
                  value={opt.value}
                  checked={pickerAlcance === opt.value}
                  onChange={() => setPickerAlcance(opt.value)}
                  className="mt-0.5 accent-accent shrink-0"
                />
                <div>
                  <p className="text-xs font-semibold text-ink">{opt.icon} {opt.label}</p>
                  <p className="text-[10px] text-muted">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Selector de usuarios cuando es "seleccionado" */}
          {pickerAlcance === "seleccionado" && (
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              {loadingUsuarios ? (
                <p className="px-3 py-2 text-xs text-muted">Cargando usuarios…</p>
              ) : usuarios.filter((u) => u.activo !== 0).length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted">No hay otros usuarios.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto divide-y divide-border/40">
                  {usuarios.filter((u) => u.activo !== 0).map((u) => (
                    <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface-hover transition-colors">
                      <input
                        type="checkbox"
                        checked={pickerUserIds.includes(u.id)}
                        onChange={(e) => setPickerUserIds((prev) =>
                          e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                        )}
                        className="h-3.5 w-3.5 accent-accent rounded"
                      />
                      <span className="text-xs font-semibold text-ink">{u.nombre}</span>
                      {u.departamento && (
                        <span className="text-[10px] text-muted ml-auto shrink-0">{u.departamento.nombre}</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {pickerAlcance === "seleccionado" && pickerUserIds.length > 0 && (
                <p className="px-3 py-1.5 text-[10px] text-accent font-semibold border-t border-border/40">
                  {pickerUserIds.length} persona{pickerUserIds.length !== 1 ? "s" : ""} seleccionada{pickerUserIds.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" disabled={savingPicker} onClick={guardarVisibilidad}
              className="flex-1 rounded-xl bg-accent py-2 text-xs font-extrabold text-white disabled:opacity-40 hover:brightness-110 transition-all">
              {savingPicker ? "Guardando…" : "Guardar visibilidad"}
            </button>
            <button type="button" onClick={() => { setShowPicker(false); setMsg(""); }}
              className="rounded-xl border border-border px-3 py-2 text-xs text-muted hover:text-ink">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Botones de acción */}
      {!editando && !showPicker && (
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" onClick={onEjecutar}
            className="flex-1 rounded-xl bg-accent py-2 text-xs font-bold text-white hover:brightness-110 transition-all min-w-[70px]">
            ↻ Ejecutar
          </button>
          <button type="button" onClick={() => setEditando(true)}
            className="rounded-xl border border-border px-2.5 py-2 text-xs font-bold text-muted hover:border-accent hover:text-accent transition-colors"
            title="Editar nombre y pasos">
            ✏️ Editar
          </button>
          <button type="button" onClick={abrirPicker}
            className="rounded-xl border border-border px-2.5 py-2 text-xs font-bold text-muted hover:border-accent hover:text-accent transition-colors"
            title="Cambiar visibilidad">
            🔒 Visibilidad
          </button>
        </div>
      )}
    </div>
  );
}

// ── AccionesView — paleta por subtab (nivel módulo, no depende de estado) ─────
const ACCIONES_TAB_CFG = {
  subhome:        { card: "border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/50",               icon: "bg-amber-200/70 dark:bg-amber-800/60 text-amber-700 dark:text-amber-300",             emoji: "⚡", titulo: "Acciones",         desc: "Registra labores y reutiliza procedimientos. Las listas de compras delegadas están en Solicitudes.", btnCtaCls: "bg-amber-500 hover:bg-amber-600 shadow-[0_3px_0_#b45309]",   ctaBase: true  },
  activas:        { card: "border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/50",               icon: "bg-amber-200/70 dark:bg-amber-800/60 text-amber-700 dark:text-amber-300",             emoji: "⚡", titulo: "Acciones",          desc: "Registra y gestiona tus acciones — pendientes, en proceso, resueltas y canceladas.",                 btnCtaCls: "bg-amber-500 hover:bg-amber-600 shadow-[0_3px_0_#b45309]",   ctaBase: true  },
  pendientes:     { card: "border-emerald-200 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/50",       icon: "bg-emerald-200/70 dark:bg-emerald-800/60 text-emerald-700 dark:text-emerald-300",     emoji: "🗓️", titulo: "Acciones futuras",  desc: "Tareas que aún no arrancas. Anótalas y conviértelas en acción cuando estés listo.",                  btnCtaCls: "bg-emerald-600 hover:bg-emerald-700 shadow-[0_3px_0_#065f46]", ctaBase: false },
  recordatorios:  { card: "border-violet-200 dark:border-violet-700/60 bg-violet-50 dark:bg-violet-950/50",          icon: "bg-violet-200/70 dark:bg-violet-800/60 text-violet-700 dark:text-violet-300",         emoji: "🔔", titulo: "Recordatorios",     desc: "Alertas simples para cosas cotidianas — sin pasos complejos.",                                       btnCtaCls: "bg-violet-600 hover:bg-violet-700 shadow-[0_3px_0_#4c1d95]",  ctaBase: false },
  procedimientos: { card: "border-sky-200 dark:border-sky-700/60 bg-sky-50 dark:bg-sky-950/50",                      icon: "bg-sky-200/70 dark:bg-sky-800/60 text-sky-700 dark:text-sky-300",                     emoji: "🔒", titulo: "Procedimientos",    desc: "Pasos guardados listos pa' reutilizar. Sin tener que explicar todo de nuevo.",                      btnCtaCls: "bg-sky-600 hover:bg-sky-700 shadow-[0_3px_0_#0c4a6e]",       ctaBase: false },
  historial:      { card: "border-stone-200 dark:border-stone-600/50 bg-stone-50 dark:bg-stone-900/60",              icon: "bg-stone-200/70 dark:bg-stone-700/60 text-stone-600 dark:text-stone-300",             emoji: "📜", titulo: "Historial",         desc: "Todo lo que ya completaste. Pa' que no se pierda nada.",                                             btnCtaCls: "bg-stone-500 hover:bg-stone-600 shadow-[0_3px_0_#292524]",   ctaBase: false },
} as const;
type AccionesTab = keyof typeof ACCIONES_TAB_CFG;

// ── AccionesView ──────────────────────────────────────────────────────────────

function AccionesView({
  token, user, onSelect, onIrCompras, initialTab, onInicio,
}: {
  token: string; user: TicketsUser;
  onSelect: (id: number) => void;
  onIrCompras?: () => void;
  initialTab?: "subhome" | "activas" | "pendientes" | "recordatorios" | "procedimientos" | "historial";
  onInicio?: () => void;
}) {
  const isAdmin = (user.rol?.nivel ?? 1) >= 3;
  // apiToken = CHAT_API_TOKEN que usa /api/voz/transcribir (distinto del JWT de tickets)
  const { apiToken: chatApiToken } = useTicketsAuth();
  const [acciones, setAcciones] = useState<Ticket[]>([]);
  const [comprasDelegadas, setComprasDelegadas] = useState<Ticket[]>([]);
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState<"" | "pendiente" | "en_proceso" | "resuelto" | "rechazado">(""); // "" = activas
  const [showWizard, setShowWizard] = useState(false);
  const [showIniciarMenu, setShowIniciarMenu] = useState(false);
  const [protocolosMenu, setProtocolosMenu] = useState<Protocolo[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [wizardTituloInicial, setWizardTituloInicial] = useState("");
  const [plantillaWizard, setPlantillaWizard] = useState<PlantillaAccion | undefined>();
  const [reanudarWizard, setReanudarWizard] = useState<ResumeAccionState | null>(null);
  const [showRepetirWizard, setShowRepetirWizard] = useState(false);
  const [plantillaRepetir, setPlantillaRepetir] = useState<PlantillaAccion | undefined>();
  const [reanudarRepetir, setReanudarRepetir] = useState<ReanudarRepetirState | undefined>();
  const [tabAcciones, setTabAcciones] = useState<"subhome" | "activas" | "historial" | "procedimientos" | "pendientes" | "recordatorios">(initialTab ?? "activas");
  const [historial, setHistorial] = useState<Ticket[]>([]);
  const [procedimientos, setProcedimientos] = useState<Protocolo[]>([]);
  const [pendientes, setPendientes] = useState<PendienteItem[]>([]);
  const [recordatorios, setRecordatorios] = useState<RecordatorioItem[]>([]);
  const [loadingPendientes, setLoadingPendientes] = useState(false);
  const [loadingRecordatorios, setLoadingRecordatorios] = useState(false);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [msg, setMsg] = useState("");
  const [registroExpandido, setRegistroExpandido] = useState<number | null>(null);
  const [registros, setRegistros] = useState<Record<number, { comentarios: any[]; adjuntos: any[] }>>({});
  const nivel = user.rol?.nivel ?? 1;

  // ── STT (voz → título de acción) ─────────────────────────────────────────
  const stt = useStt(token, chatApiToken);

  // ── Alarma: voz periódica configurable ────────────────────────────────────
  const hayEnProceso = useMemo(
    () => acciones.some((t) => t.estado === "en_proceso"),
    [acciones],
  );
  const [alarmaActiva, setAlarmaActiva] = useState(true);
  const [alarmaMinutos, setAlarmaMinutos] = useState(5); // 1-60 min
  const [countdown, setCountdown]  = useState(0);        // segundos para próxima alarma
  const alarmaRef    = useRef(alarmaActiva);
  const minRef       = useRef(alarmaMinutos);
  const androidAlarmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accionesRef  = useRef(acciones);
  const tokenRef     = useRef(chatApiToken ?? token);
  const ultimaAlarmaRef = useRef(Date.now());
  const prevHayEnProcesoRef = useRef<boolean | null>(null);
  useEffect(() => { alarmaRef.current = alarmaActiva; }, [alarmaActiva]);
  useEffect(() => { minRef.current = alarmaMinutos; }, [alarmaMinutos]);
  useEffect(() => { accionesRef.current = acciones; }, [acciones]);
  useEffect(() => { tokenRef.current = chatApiToken ?? token; }, [chatApiToken, token]);

  const ANDROID_PANEL_PKG = "co.mckennagroup.panel";

  const fireAndroidIntent = useCallback((path: string) => {
    if (isMcKennaAndroidApp() && mckennaAndroidBridge()) return;
    // intent:// solo en Android; en escritorio/Linux dispara diálogos "Abrir con…"
    if (!isAndroidMobileBrowser()) return;
    try {
      const url = `intent://${path}#Intent;scheme=mckennaapp;package=${ANDROID_PANEL_PKG};S.browser_fallback_url=about%3Ablank;end`;
      const a = document.createElement("a");
      a.href = url;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 500);
    } catch { /* ignorar si no es APK Android */ }
  }, []);

  /** Guarda CHAT_API_TOKEN en la app para que descargue el WAV de Voicebox en nativo. */
  const sincronizarTokenAndroid = useCallback((apiToken: string) => {
    if (!apiToken) return;
    const bridge = mckennaAndroidBridge();
    if (bridge?.saveApiToken) {
      bridge.saveApiToken(apiToken);
      return;
    }
    fireAndroidIntent(`token?t=${encodeURIComponent(apiToken)}`);
  }, [fireAndroidIntent]);

  /** Configura AlarmManager nativo + opcional precache del WAV (precache=1). */
  const sincronizarAlarmaAndroid = useCallback((
    activa: boolean,
    minutos: number,
    hayTarea: boolean,
    precache = false,
  ) => {
    const bridge = mckennaAndroidBridge();
    if (bridge?.syncAlarma) {
      bridge.syncAlarma(activa, minutos, hayTarea, precache);
      return;
    }
    fireAndroidIntent(
      `alarma?activa=${activa}&intervalo=${minutos}&hay_tarea=${hayTarea}&precache=${precache ? "1" : "0"}`,
    );
  }, [fireAndroidIntent]);

  useEffect(() => {
    const tok = chatApiToken ?? token;
    if (!tok) return;
    // Esperar a que el TWA termine permisos + arranque de Chrome antes de lanzar intents
    const tid = setTimeout(() => sincronizarTokenAndroid(tok), 12_000);
    return () => clearTimeout(tid);
  }, [chatApiToken, token, sincronizarTokenAndroid]);

  useEffect(() => {
    if (prevHayEnProcesoRef.current === null) {
      prevHayEnProcesoRef.current = hayEnProceso;
      return;
    }
    if (prevHayEnProcesoRef.current === hayEnProceso) return;
    prevHayEnProcesoRef.current = hayEnProceso;
    const tid = setTimeout(
      () => sincronizarAlarmaAndroid(alarmaRef.current, minRef.current, hayEnProceso, false),
      600,
    );
    return () => clearTimeout(tid);
  }, [hayEnProceso, sincronizarAlarmaAndroid]);

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
    if (isMcKennaAndroidApp() || !("serviceWorker" in navigator) || !webNotificationsAvailable()) return;
    const init = async () => {
      const NotificationApi = globalThis.Notification;
      let perm = NotificationApi.permission;
      if (perm === "default") {
        perm = await NotificationApi.requestPermission();
      }
      if (perm !== "granted") return;

      const reg = await navigator.serviceWorker.register("/app/sw-alarm.js", { scope: "/app/" });
      await navigator.serviceWorker.ready;
      await registrarPush(reg, alarmaMinutos, alarmaActiva);
    };
    init().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-registrar push cuando cambia intervalo o estado de alarma
  useEffect(() => {
    if (
      isMcKennaAndroidApp() ||
      !("serviceWorker" in navigator) ||
      !webNotificationsAvailable() ||
      globalThis.Notification.permission !== "granted"
    ) {
      return;
    }
    navigator.serviceWorker.ready.then((reg) => registrarPush(reg, alarmaMinutos, alarmaActiva)).catch(() => {});
  }, [alarmaMinutos, alarmaActiva, registrarPush]);

  // Pre-calentar caché web + nativo (WAV Voicebox) cuando la alarma está activa
  useEffect(() => {
    if (!alarmaActiva || !chatApiToken) return;
    const tok = chatApiToken;
    const tid = setTimeout(() => {
      void (async () => {
        await warmAlarmCache(tok);
        sincronizarAlarmaAndroid(alarmaRef.current, minRef.current, accionesRef.current.some((t) => t.estado === "en_proceso"), true);
      })();
    }, 14_000);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmaActiva, chatApiToken, sincronizarAlarmaAndroid]);

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
      if (ctrl && webNotificationsAvailable() && globalThis.Notification.permission === "granted") {
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
      const paramsAccion = new URLSearchParams({ tipo: "accion", ...(isAdmin ? { vista_equipo: "1" } : {}) });
      const [data, usrs, compras] = await Promise.allSettled([
        tapi(`/?${paramsAccion}`, token),
        tapi("/usuarios", token),
        tapiSafe("/compras-delegadas", token),
      ]);
      const accRaw = data.status === "fulfilled" && Array.isArray(data.value) ? data.value : [];
      const comprasList = compras.status === "fulfilled" && Array.isArray(compras.value)
        ? compras.value.map(normalizeTicketForList)
        : [];
      setComprasDelegadas(comprasList);
      const padresCompra = new Set(
        comprasList.map((c) => c.ticket_padre_id).filter((id): id is number => id != null),
      );
      const accList: Ticket[] = accRaw.map(normalizeTicketForList);
      const list = accList.filter((t) => {
        const tipo = (t.tipo || "").toLowerCase();
        if (tipo !== "accion") return false;
        if (esSolicitudCompraDelegada(t)) return false;
        if (padresCompra.has(t.id)) return false;
        return true;
      });
      setAcciones((prev) => {
        const ns = JSON.stringify(list.map((t) => t.id + t.estado));
        const ps = JSON.stringify(prev.map((t) => t.id + t.estado));
        return ns === ps ? prev : list;
      });
      if (usrs.status === "fulfilled" && Array.isArray(usrs.value)) {
        setUsuarios(usrs.value);
      }
    } catch { /* ignore */ }
    finally { if (!silent) setLoading(false); }
  }, [token, isAdmin, user.id]);

  useEffect(() => {
    const iv = setInterval(() => { void load(true); }, 30000);
    return () => clearInterval(iv);
  }, [load]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  function abrirWizard(tituloPrefill = "", plantilla?: PlantillaAccion) {
    setReanudarWizard(null);
    setWizardTituloInicial(tituloPrefill);
    setPlantillaWizard(plantilla);
    setShowWizard(true);
    setMsg("");
  }

  async function continuarAccion(t: Ticket) {
    const tipo = (t.tipo || "").toLowerCase();
    if (tipo !== "accion" || esTarjetaSoloCompras(t, user) || esSolicitudCompraDelegada(t)) {
      setMsg("Esta tarea es solo ir de compras — ábrela en Solicitudes.");
      onIrCompras?.();
      return;
    }
    if (comprasDelegadas.some((c) => c.ticket_padre_id === t.id)) {
      setMsg("Las compras de esta acción las llevas en Solicitudes → Ir de compras.");
      onIrCompras?.();
      return;
    }
    setLoadingExtra(true);
    setMsg("");
    try {
      const resume = await cargarEstadoReanudacion(t.id, token);
      if (t.estado === "pendiente") {
        try {
          const segPrev = resume.ticket.corrida?.segundos_acumulados ?? resume.ticket.segundos_trabajo ?? 0;
          await tapi(`/${t.id}/corridas/iniciar`, token, {
            method: "POST",
            body: JSON.stringify({ segundos_previos: segPrev }),
          });
          await tapi(`/${t.id}/estado`, token, {
            method: "PUT",
            body: JSON.stringify({ estado: "en_proceso" }),
          });
          const det = await tapi(`/${t.id}`, token) as Ticket;
          resume.ticket = det;
        } catch { /* wizard sincroniza al abrir */ }
      }

      // Detectar si este ticket fue creado por RepetirAccionWizard:
      // Tiene pasos guardados, no hay compras pendientes y no hay bloqueos.
      // En ese caso, retomar con la UI Duolingo paso-a-paso.
      const esRepetir =
        resume.faseInicial === "cierre" &&
        resume.plantilla.pasos.length > 0 &&
        !resume.bloqueoCompras &&
        !resume.bloqueadoIntervencion &&
        resume.plantilla.listaCompras.length === 0;

      if (esRepetir) {
        // Cargar IDs de pasos del servidor para poder marcarlos completados
        let pasosIds: number[] = [];
        let startPasoIdx = 0;
        try {
          const pasosRaw = await tapi(`/${t.id}/pasos`, token) as Paso[];
          const reales = pasosRaw.filter((p) => p.descripcion !== "Ir de compras");
          pasosIds = reales.map((p) => p.id);
          const primerIncompleto = reales.findIndex((p) => !pasoEstaCompletado(p));
          startPasoIdx = primerIncompleto >= 0 ? primerIncompleto : reales.length;
        } catch { /* usamos idx 0 */ }

        const segundosBase = resume.ticket.corrida?.segundos_acumulados ?? resume.ticket.segundos_trabajo ?? 0;
        setPlantillaRepetir(resume.plantilla);
        setReanudarRepetir({
          ticketId: t.id,
          pasosIds,
          corridaId: resume.ticket.corrida?.id ?? null,
          segundosBase,
          startPasoIdx,
        });
        setShowRepetirWizard(true);
        return;
      }

      setReanudarWizard(resume);
      setPlantillaWizard(undefined);
      setWizardTituloInicial("");
      setShowWizard(true);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "No se pudo abrir la acción");
    } finally {
      setLoadingExtra(false);
    }
  }

  const cargarHistorialYProcedimientos = useCallback(async () => {
    setLoadingExtra(true);
    // Cargar independientemente para que un fallo en historial no bloquee procedimientos
    const [histRes, procRes] = await Promise.allSettled([
      tapi("/acciones/historial", token),
      tapi("/protocolos?alcance=mis", token),
    ]);
    if (histRes.status === "fulfilled") {
      setHistorial(Array.isArray(histRes.value) ? histRes.value.map(normalizeTicketForList) : []);
    }
    if (procRes.status === "fulfilled") {
      setProcedimientos(Array.isArray(procRes.value) ? procRes.value : []);
    }
    setLoadingExtra(false);
  }, [token]);

  const cargarPendientes = useCallback(async () => {
    setLoadingPendientes(true);
    try {
      const data = await tapi("/pendientes", token);
      setPendientes(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setLoadingPendientes(false); }
  }, [token]);

  const cargarRecordatorios = useCallback(async () => {
    setLoadingRecordatorios(true);
    try {
      const data = await tapi("/recordatorios", token);
      const lista = Array.isArray(data) ? data : [];
      setRecordatorios(lista);
      const hoy = new Date().toISOString().slice(0, 10);
      const activos = lista.filter((r: RecordatorioItem) => r.proxima_fecha <= hoy);
      const sessionKey = `mck-rec-notif-${hoy}`;
      if (activos.length > 0 && !sessionStorage.getItem(sessionKey)) {
        sessionStorage.setItem(sessionKey, "1");
        // Notificación WhatsApp (voz Hugo García por WhatsApp)
        fetch("/api/tickets/recordatorios/notificar-hoy", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
        // Audio en el navegador (voz Hugo García)
        const apiTok = chatApiToken ?? token;
        if (apiTok) void playRecordatorioAlerta(apiTok, activos.length);
      }
    } catch { /* ignore */ } finally { setLoadingRecordatorios(false); }
  }, [token, chatApiToken]);

  useEffect(() => {
    void load(false);
    void cargarPendientes();
    void cargarRecordatorios();
  }, [load, cargarPendientes, cargarRecordatorios]);

  useEffect(() => {
    if (tabAcciones === "historial" || tabAcciones === "procedimientos") {
      void cargarHistorialYProcedimientos();
    }
    if (tabAcciones === "pendientes" || tabAcciones === "subhome") void cargarPendientes();
    if (tabAcciones === "recordatorios" || tabAcciones === "subhome") void cargarRecordatorios();
  }, [tabAcciones, cargarHistorialYProcedimientos, cargarPendientes, cargarRecordatorios]);

  async function repetirProcedimiento(protocoloId: number) {
    setLoadingExtra(true);
    try {
      const p = await tapi(`/protocolos/${protocoloId}`, token) as Protocolo;
      const plantilla = plantillaDesdeProtocolo(p);
      // Si el procedimiento tiene pasos o lista de compras → usar el wizard guía visual
      if (plantilla.pasos.length > 0 || plantilla.listaCompras.length > 0) {
        setPlantillaRepetir(plantilla);
        setShowRepetirWizard(true);
      } else {
        abrirWizard("", plantilla);
      }
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "No se pudo cargar el procedimiento");
    } finally {
      setLoadingExtra(false);
    }
  }

  async function repetirDesdeHistorial(accionId: number) {
    setLoadingExtra(true);
    try {
      let plantilla: PlantillaAccion;
      try {
        const data = await tapi(`/${accionId}/plantilla-accion`, token) as PlantillaAccionApi;
        plantilla = plantillaDesdeApi(data);
      } catch {
        const [det, pasosRaw] = await Promise.all([
          tapi(`/${accionId}`, token) as Promise<Ticket>,
          tapi(`/${accionId}/pasos`, token) as Promise<Paso[]>,
        ]);
        const pasosArr = Array.isArray(pasosRaw) ? pasosRaw : [];
        let listaCompras: ItemCompraAccion[] = [];
        const pasosEj: PasoAccionDraft[] = [];
        for (const p of pasosArr) {
          if (p.descripcion === "Ir de compras" && p.notas) {
            listaCompras = parseListaComprasDesdeNotas(p.notas as string);
          } else if (p.descripcion) {
            pasosEj.push({ nombre: p.descripcion, desc: (p.notas as string) || "" });
          }
        }
        plantilla = {
          titulo: det.titulo,
          protocoloId: det.protocolo_id ?? undefined,
          listaCompras,
          pasos: pasosEj,
        };
      }
      setPlantillaRepetir(plantilla);
      setShowRepetirWizard(true);
      setMsg("");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "No se pudo cargar la acción");
    } finally {
      setLoadingExtra(false);
    }
  }

  async function guardarProcedimientoHistorial(accionId: number, alcance: "personal" | "global") {
    setLoadingExtra(true);
    try {
      await tapi(`/${accionId}/guardar-procedimiento`, token, {
        method: "POST",
        body: JSON.stringify({ alcance }),
      });
      setMsg(alcance === "global"
        ? "Procedimiento compartido con el equipo"
        : "Procedimiento guardado en «Mis procedimientos»");
      void cargarHistorialYProcedimientos();
      setTimeout(() => setMsg(""), 3000);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Error al guardar procedimiento");
    } finally {
      setLoadingExtra(false);
    }
  }

  async function promoverProtocolo(protocoloId: number) {
    try {
      await tapi(`/protocolos/${protocoloId}/promover`, token, { method: "POST" });
      setMsg("Procedimiento disponible para delegar en solicitudes");
      void cargarHistorialYProcedimientos();
      setTimeout(() => setMsg(""), 3000);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Error al promover");
    }
  }

  async function onAccionCreada(_ticketId: number) {
    setShowWizard(false);
    setWizardTituloInicial("");
    setPlantillaWizard(undefined);
    setReanudarWizard(null);
    await load(false);
    if (tabAcciones !== "activas") void cargarHistorialYProcedimientos();
    setMsg("Acción registrada");
    setTimeout(() => setMsg(""), 2500);
  }

  // Agrupar acciones por usuario asignado (las solicitudes van solo en pestaña Solicitudes)
  const porAsignado = useMemo(() => {
    const map = new Map<number, { nombre: string; acciones: Ticket[] }>();
    for (const t of acciones) {
      if ((t.tipo || "") !== "accion" || esSolicitudCompraDelegada(t)) continue;
      const uid = t.asignado_a ?? 0;
      if (!map.has(uid)) {
        map.set(uid, { nombre: t.asignado_a_nombre ?? "Sin asignar", acciones: [] });
      }
      map.get(uid)!.acciones.push(t);
    }
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [acciones]);

  const sinResolver = acciones.filter((t) => t.estado !== "resuelto" && t.estado !== "rechazado").length;

  if (showRepetirWizard && plantillaRepetir) {
    return (
      <RepetirAccionWizard
        token={token}
        user={user}
        chatApiToken={chatApiToken}
        plantilla={plantillaRepetir}
        reanudar={reanudarRepetir}
        onCancel={() => {
          setShowRepetirWizard(false);
          setPlantillaRepetir(undefined);
          setReanudarRepetir(undefined);
          void load(true);
        }}
        onCreated={(id) => {
          setShowRepetirWizard(false);
          setPlantillaRepetir(undefined);
          setReanudarRepetir(undefined);
          void onAccionCreada(id);
        }}
      />
    );
  }

  if (showWizard && !isAdmin) {
    return (
      <NuevaAccionWizard
        token={token}
        user={user}
        chatApiToken={chatApiToken}
        tituloInicial={wizardTituloInicial}
        plantilla={plantillaWizard}
        reanudar={reanudarWizard ?? undefined}
        onCancel={() => {
          setShowWizard(false);
          setWizardTituloInicial("");
          setPlantillaWizard(undefined);
          setReanudarWizard(null);
          void load(true);
        }}
        onCreated={(id) => void onAccionCreada(id)}
      />
    );
  }

  const tc = ACCIONES_TAB_CFG[tabAcciones as AccionesTab] ?? ACCIONES_TAB_CFG.subhome;
  const mostrarCta = tc.ctaBase && !isAdmin;

  return (
    <div className="space-y-4">
      {/* Header — hero card adaptativo al subtab activo */}
      <div className={`rounded-3xl border ${tc.card} p-6 shadow-[0_2px_14px_rgba(0,0,0,0.06)] space-y-4`}>
        {/* Fila: ícono + título + descripción + botones de navegación */}
        <div className="flex items-start gap-4">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tc.icon} text-2xl`}>{tc.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-extrabold text-ink flex items-center gap-2">
                {tc.titulo}
                {(tabAcciones === "subhome" || tabAcciones === "activas") && sinResolver > 0 && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{sinResolver}</span>
                )}
              </h2>
              {tabAcciones === "subhome" && onInicio && (
                <button
                  type="button"
                  onClick={onInicio}
                  className="ml-auto flex items-center gap-1 rounded-xl border-2 border-border/60 px-3 py-1 text-xs font-bold text-muted hover:border-accent hover:text-accent transition"
                  title="Volver al inicio"
                >
                  🏠 Inicio
                </button>
              )}
            </div>
            <p className="mt-1 text-base font-bold text-ink/80 dark:text-white/90 leading-snug">
              {isAdmin && tabAcciones === "subhome"
                ? "Supervisión: acciones del equipo (solo ver o eliminar). Las solicitudes están en Solicitudes."
                : tc.desc}
            </p>
          </div>
        </div>
        {/* CTA principal — solo en subhome y activas, nunca para admin */}
        {mostrarCta && (
          <button
            type="button"
            onClick={async () => {
              setLoadingMenu(true);
              setShowIniciarMenu(true);
              try {
                const data = await tapi("/protocolos", token);
                setProtocolosMenu(Array.isArray(data) ? data : []);
              } catch { setProtocolosMenu([]); } finally { setLoadingMenu(false); }
            }}
            className={`w-full rounded-2xl ${tc.btnCtaCls} active:scale-[0.98] text-white font-extrabold text-lg py-4 flex items-center justify-center gap-2 transition-all active:shadow-none active:translate-y-0.5`}
          >
            <Icon name="plus" size={18} weight="bold" />
            Iniciar acción
          </button>
        )}
        {/* Toolbar: alarma + filtro + STT */}
        <div className="flex gap-2 flex-wrap items-center">
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
                  sincronizarAlarmaAndroid(next, minRef.current, hayEnProceso, next);
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
                  androidAlarmDebounceRef.current = setTimeout(() => { sincronizarAlarmaAndroid(alarmaRef.current, m, hayEnProceso, false); androidAlarmDebounceRef.current = null; }, 1500);
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
                onClick={() => {
                  sincronizarAlarmaAndroid(alarmaRef.current, minRef.current, true, true);
                  ultimaAlarmaRef.current = Date.now() - minRef.current * 60 * 1000;
                  void dispararAlarma(true);
                }}
                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-muted hover:border-accent hover:text-accent transition-colors"
              >
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Probar
              </button>
            </div>
          )}
          {/* Botón voz (STT) — solo quien puede crear acciones */}
          {!isAdmin && (
            <SttInlineBtn
              stt={stt}
              label="Voz"
              onStart={() => void stt.iniciar((t) => abrirWizard(t))}
            />
          )}
        </div>
      </div>

      {/* ── Menú de inicio: libre o desde procedimiento ── */}
      {showIniciarMenu && !isAdmin && (
        <div className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-accent">¿Cómo quieres empezar?</p>
            <button type="button" onClick={() => setShowIniciarMenu(false)} className="text-muted hover:text-ink text-sm">✕</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => { setShowIniciarMenu(false); abrirWizard(); }}
              className="text-left rounded-2xl border-2 border-border bg-surface px-4 py-4 transition hover:border-accent hover:bg-accent/5 group"
            >
              <p className="text-sm font-extrabold text-ink group-hover:text-accent transition-colors">✍️ Acción libre</p>
              <p className="mt-1 text-xs text-muted">Describe con tus palabras qué vas a hacer.</p>
            </button>
            <div className="rounded-2xl border-2 border-border bg-surface px-4 py-4 space-y-2">
              <p className="text-sm font-extrabold text-ink">📋 Desde procedimiento</p>
              <p className="text-xs text-muted">Ejecuta un proceso ya definido del equipo.</p>
              {loadingMenu && <p className="text-xs text-muted">Cargando…</p>}
              {!loadingMenu && protocolosMenu.length === 0 && (
                <p className="text-xs text-muted italic">No hay procedimientos disponibles.</p>
              )}
              {!loadingMenu && protocolosMenu.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {protocolosMenu.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setShowIniciarMenu(false);
                        const plantilla = plantillaDesdeProtocolo(p);
                        const tieneContenido = plantilla.listaCompras.length > 0 || plantilla.pasos.length > 0;
                        if (tieneContenido) {
                          setPlantillaRepetir(plantilla);
                          setReanudarRepetir(undefined);
                          setShowRepetirWizard(true);
                        } else {
                          abrirWizard("", plantilla);
                        }
                      }}
                      className="w-full text-left rounded-xl border border-border px-3 py-2 text-xs font-semibold text-ink hover:border-accent hover:bg-accent/5 transition"
                    >
                      <span className="block truncate">{p.titulo}</span>
                      {(p.pasos?.length ?? 0) > 0 && (
                        <span className="text-[10px] text-muted">{p.pasos.length} paso{p.pasos.length !== 1 ? "s" : ""}{(p.lista_compras?.length ?? 0) > 0 ? ` · ${p.lista_compras!.length} ingredientes` : ""}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {msg && !showWizard && (
        <p className="text-sm text-accent font-semibold">{msg}</p>
      )}

      {!isAdmin && comprasDelegadas.length > 0 && (
        <div className="rounded-2xl border-2 border-blue-400/60 bg-blue-50/70 dark:bg-blue-950/30 p-4 space-y-2">
          <p className="text-sm font-extrabold text-ink">
            Tienes {comprasDelegadas.length} lista{comprasDelegadas.length !== 1 ? "s" : ""} de compras delegada{comprasDelegadas.length !== 1 ? "s" : ""}
          </p>
          <p className="text-xs text-muted">
            No uses el asistente de acciones para eso. Abre <strong className="text-ink">Solicitudes → Ir de compras</strong>, marca los productos y pulsa Terminé las compras.
          </p>
          {onIrCompras && (
            <button
              type="button"
              onClick={onIrCompras}
              className="w-full rounded-xl bg-accent py-3 text-sm font-extrabold text-white"
            >
              Ir a Solicitudes — compras
            </button>
          )}
        </div>
      )}

      {/* ── Sub-home de Acciones: cards por sección ── */}
      {!isAdmin && tabAcciones === "subhome" && (() => {
        const hoy = new Date().toISOString().slice(0, 10);
        const recHoy = recordatorios.filter((r) => r.proxima_fecha <= hoy).length;
        const pendHoy = pendientes.filter((p) => p.fecha_recordatorio && p.fecha_recordatorio <= hoy).length;
        const activas = acciones.filter((t) => t.estado === "en_proceso").length;
        const subCard = [
          "group flex flex-col gap-5 rounded-3xl border p-6 text-left w-full",
          "shadow-[0_2px_14px_rgba(0,0,0,0.06)] hover:shadow-[0_6px_22px_rgba(0,0,0,0.10)]",
          "transition-all duration-200 cursor-pointer active:scale-[0.97]",
        ].join(" ");
        return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

            <button type="button" onClick={() => setTabAcciones("activas")}
              className={`${subCard} bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-700/60`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-200/70 dark:bg-amber-800/60 text-amber-700 dark:text-amber-300 text-2xl shrink-0">⚡</span>
                <span className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{acciones.length}</span>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">En curso</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Las acciones que tienes activas ahorita mismo.</p>
            </button>

            <button type="button" onClick={() => setTabAcciones("pendientes")}
              className={`${subCard} bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700/60`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-200/70 dark:bg-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-2xl shrink-0">🗓️</span>
                <div className="text-right space-y-1">
                  <span className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{pendientes.length}</span>
                  {pendHoy > 0 && <p className="text-xs font-bold text-amber-600 dark:text-amber-300">{pendHoy} para hoy</p>}
                </div>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">Acciones futuras</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Tareas que necesitan tu atención pero todavía no arrancas. Anótala y cuando estés listo la conviertes en acción.</p>
            </button>

            <button type="button" onClick={() => setTabAcciones("recordatorios")}
              className={`${subCard} bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-700/60`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-200/70 dark:bg-violet-800/60 text-violet-700 dark:text-violet-300 text-2xl shrink-0">🔔</span>
                <div className="text-right space-y-1">
                  <span className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{recordatorios.length}</span>
                  {recHoy > 0 && <p className="text-xs font-bold text-amber-600 dark:text-amber-300">{recHoy} para hoy</p>}
                </div>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">Recordatorios</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Alertas simples para cosas cotidianas — pagar recibos, llamadas — sin pasos complejos.</p>
            </button>

            <button type="button" onClick={() => setTabAcciones("historial")}
              className={`${subCard} bg-stone-50 dark:bg-stone-900/60 border-stone-200 dark:border-stone-600/50`}>
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-200/70 dark:bg-stone-700/60 text-stone-600 dark:text-stone-300 text-2xl shrink-0">📜</span>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">Historial</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Todo lo que ya completaste. Pa' que no se pierda nada de lo que hiciste.</p>
            </button>

            <button type="button" onClick={() => setTabAcciones("procedimientos")}
              className={`${subCard} bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-700/60`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-200/70 dark:bg-sky-800/60 text-sky-700 dark:text-sky-300 text-2xl shrink-0">🔒</span>
                <span className="text-4xl font-black text-ink dark:text-white tabular-nums leading-none tracking-tight">{procedimientos.length}</span>
              </div>
              <p className="text-2xl font-extrabold text-ink dark:text-white leading-snug tracking-tight">Procedimientos</p>
              <p className="text-base font-bold text-ink/80 dark:text-white/90 leading-snug">Pasos que ya guardaste listos pa' reutilizar. Sin tener que explicar todo de nuevo.</p>
            </button>

          </div>
        );
      })()}


      {tabAcciones === "pendientes" && !isAdmin && (
        <PendientesPanel
          token={token}
          pendientes={pendientes}
          loading={loadingPendientes}
          onRecargar={() => void cargarPendientes()}
          onIniciarAccion={(p) => {
            abrirWizard(p.titulo);
            void tapi(`/pendientes/${p.id}/iniciar`, token, { method: "POST", body: "{}" });
            setPendientes((ps) => ps.filter((x) => x.id !== p.id));
          }}
        />
      )}

      {tabAcciones === "recordatorios" && !isAdmin && (
        <RecordatoriosPanel
          token={token}
          recordatorios={recordatorios}
          loading={loadingRecordatorios}
          onRecargar={() => void cargarRecordatorios()}
        />
      )}

      {tabAcciones === "historial" && !isAdmin && (
        <div className="space-y-3">
          {loadingExtra && <p className="text-sm text-muted">Cargando historial…</p>}
          {!loadingExtra && historial.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">Aún no hay acciones en tu historial.</p>
          )}
          {!loadingExtra && historial.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {historial.map((t) => {
                const total = t.pasos_total ?? 0;
                const ok = t.pasos_completados ?? 0;
                const seg = t.segundos_trabajo ?? 0;
                const tieneProcedimiento = !!(t.procedimiento_id ?? t.protocolo_id);

                const estado =
                  total === 0 ? "vacia"
                  : ok === total ? "completa"
                  : "incompleta";

                const borderClass =
                  estado === "completa" ? "border-green-400/50"
                  : estado === "incompleta" ? "border-amber-400/50"
                  : "border-border";

                const badge =
                  estado === "completa"
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-950/40 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:text-green-400">✓ Completa</span>
                  : estado === "incompleta"
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">⚠ Incompleta</span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-bold text-muted">Sin pasos</span>;

                const tiempoStr = (() => {
                  if (seg < 60) return seg > 0 ? `${seg}s` : null;
                  const h = Math.floor(seg / 3600);
                  const m = Math.floor((seg % 3600) / 60);
                  return h > 0 ? `${h}h ${m}m` : `${m}m`;
                })();

                const fechaStr = (() => {
                  const raw = t.actualizado_en ?? t.creado_en;
                  if (!raw) return null;
                  try {
                    const d = new Date(raw.includes("T") || raw.includes("Z") ? raw : raw + "Z");
                    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
                    if (diff === 0) return "hoy";
                    if (diff === 1) return "ayer";
                    if (diff < 30) return `hace ${diff}d`;
                    return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
                  } catch { return null; }
                })();

                return (
                  <div key={t.id} className={`rounded-xl border-2 ${borderClass} bg-surface-panel p-3 space-y-2.5`}>
                    {/* Header: badge + fecha */}
                    <div className="flex items-start justify-between gap-2">
                      {badge}
                      {fechaStr && <span className="text-[10px] text-muted shrink-0">{fechaStr}</span>}
                    </div>

                    {/* Título */}
                    <p className="font-bold text-sm text-ink leading-snug">{t.titulo}</p>
                    <p className="text-[10px] text-muted font-mono">{t.numero}</p>

                    {/* Stats */}
                    <div className="flex flex-wrap gap-1.5">
                      {total > 0 && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                          estado === "completa"
                            ? "bg-green-50 dark:bg-green-950/30 border-green-400/40 text-green-700 dark:text-green-400"
                            : "bg-amber-50 dark:bg-amber-950/30 border-amber-400/40 text-amber-700 dark:text-amber-400"
                        }`}>
                          {estado === "completa" ? "✓" : `${ok}/`}{estado !== "completa" && total} {total === 1 ? "paso" : "pasos"}
                        </span>
                      )}
                      {tiempoStr && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-semibold text-muted">
                          ⏱ {tiempoStr}
                        </span>
                      )}
                      {t.categoria && (
                        <span className="inline-flex items-center rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] text-muted">
                          {t.categoria}
                        </span>
                      )}
                      {tieneProcedimiento && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 border border-accent/30 px-2 py-0.5 text-[10px] font-bold text-accent">
                          📋 Procedimiento
                        </span>
                      )}
                    </div>

                    {/* Registro de actividad expandible */}
                    {registroExpandido === t.id && (
                      <div className="rounded-xl bg-surface border border-border p-3 space-y-2">
                        {!registros[t.id] ? (
                          <p className="text-xs text-muted text-center py-2">Cargando…</p>
                        ) : (() => {
                            const items = [
                              ...registros[t.id].comentarios.map((c: any) => ({ ...c, _tipo: "comentario" })),
                              ...registros[t.id].adjuntos.map((a: any) => ({ ...a, _tipo: "adjunto" })),
                            ].sort((a, b) => (a.creado_en ?? "").localeCompare(b.creado_en ?? ""));

                            if (items.length === 0) return (
                              <p className="text-xs text-muted text-center py-2">No hay notas ni fotos registradas.</p>
                            );

                            const fmt = (ts: string) => {
                              try { return new Date(ts.includes("T") || ts.includes("Z") ? ts : ts + "Z").toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }); }
                              catch { return ts; }
                            };

                            return (
                              <div className="space-y-2">
                                {items.map((item: any, idx: number) => (
                                  <div key={idx}>
                                    {item._tipo === "adjunto" ? (
                                      <div>
                                        <a href={`/api/tickets/uploads/${encodeURIComponent(item.nombre_archivo)}?token=${token}`}
                                          target="_blank" rel="noopener noreferrer">
                                          <img src={`/api/tickets/uploads/${encodeURIComponent(item.nombre_archivo)}?token=${token}`}
                                            alt={item.nombre_original ?? "foto"}
                                            className="rounded-xl w-full max-w-xs border border-border object-cover hover:opacity-80 transition"/>
                                        </a>
                                        <p className="text-[10px] text-muted mt-1">{fmt(item.creado_en)}</p>
                                      </div>
                                    ) : (
                                      <div className="rounded-lg bg-surface-hover px-3 py-2">
                                        <p className="text-xs text-ink leading-relaxed whitespace-pre-wrap">{item.texto}</p>
                                        <p className="text-[10px] text-muted mt-1">{fmt(item.creado_en)}</p>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })()
                        }
                      </div>
                    )}

                    {/* Acciones */}
                    <div className="flex flex-col gap-1.5 pt-0.5">
                      {/* Ver registro */}
                      <button
                        type="button"
                        onClick={async () => {
                          if (registroExpandido === t.id) { setRegistroExpandido(null); return; }
                          setRegistroExpandido(t.id);
                          if (!registros[t.id]) {
                            const [coms, adjs] = await Promise.allSettled([
                              tapi(`/${t.id}/comentarios`, token),
                              tapi(`/${t.id}/adjuntos`, token),
                            ]);
                            setRegistros(prev => ({
                              ...prev,
                              [t.id]: {
                                comentarios: coms.status === "fulfilled" && Array.isArray(coms.value) ? coms.value : [],
                                adjuntos: adjs.status === "fulfilled" && Array.isArray(adjs.value) ? adjs.value : [],
                              },
                            }));
                          }
                        }}
                        className="w-full rounded-xl border-2 border-border py-2 text-sm font-bold text-ink hover:border-accent hover:text-accent transition"
                      >
                        {registroExpandido === t.id ? "▲ Ocultar registro" : "📷 Ver fotos y notas"}
                      </button>
                      <button
                        type="button"
                        disabled={loadingExtra}
                        onClick={() => void repetirDesdeHistorial(t.id)}
                        className="w-full rounded-xl border-2 border-accent/50 py-2 text-sm font-bold text-accent hover:bg-accent/10 disabled:opacity-40 transition"
                      >
                        ↻ Ejecutar de nuevo
                      </button>
                      {!tieneProcedimiento && (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={loadingExtra}
                            onClick={() => void guardarProcedimientoHistorial(t.id, "personal")}
                            className="flex-1 rounded-xl border border-border py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-40 transition"
                            title="Solo tú lo verás en Mis procedimientos"
                          >
                            🔒 Guardar personal
                          </button>
                          <button
                            type="button"
                            disabled={loadingExtra}
                            onClick={() => void guardarProcedimientoHistorial(t.id, "global")}
                            className="flex-1 rounded-xl border border-border py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-40 transition"
                            title="Todo el equipo podrá usarlo y delegarlo"
                          >
                            🌐 Compartir
                          </button>
                        </div>
                      )}
                      {tieneProcedimiento && (
                        <button
                          type="button"
                          disabled={loadingExtra}
                          onClick={() => { const pid = t.procedimiento_id ?? t.protocolo_id; if (pid) void repetirProcedimiento(pid); }}
                          className="w-full rounded-xl border border-border py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent transition"
                        >
                          ↻ Desde procedimiento guardado
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tabAcciones === "procedimientos" && !isAdmin && (
        <div className="space-y-4">
          {loadingExtra && <p className="text-sm text-muted">Cargando…</p>}
          {!loadingExtra && procedimientos.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">
              Guarda una acción como procedimiento para verla aquí.
            </p>
          )}

          {/* Privados */}
          {procedimientos.filter((p) => (p.alcance ?? "personal") === "personal").length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted flex items-center gap-1.5">
                🔒 Privados — solo tú los ves
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {procedimientos.filter((p) => (p.alcance ?? "personal") === "personal").map((p) => (
                  <ProcedimientoCard
                    key={p.id}
                    p={p}
                    token={token}
                    onEjecutar={() => {
                        const plantilla = plantillaDesdeProtocolo(p);
                        if (plantilla.pasos.length > 0 || plantilla.listaCompras.length > 0) {
                          setPlantillaRepetir(plantilla);
                          setShowRepetirWizard(true);
                        } else {
                          abrirWizard("", plantilla);
                        }
                      }}
                    onActualizado={() => void cargarHistorialYProcedimientos()}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Compartidos con personas específicas */}
          {procedimientos.filter((p) => p.alcance === "seleccionado").length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted flex items-center gap-1.5">
                👤 Compartido con personas específicas
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {procedimientos.filter((p) => p.alcance === "seleccionado").map((p) => (
                  <ProcedimientoCard
                    key={p.id}
                    p={p}
                    token={token}
                    onEjecutar={() => {
                        const plantilla = plantillaDesdeProtocolo(p);
                        if (plantilla.pasos.length > 0 || plantilla.listaCompras.length > 0) {
                          setPlantillaRepetir(plantilla);
                          setShowRepetirWizard(true);
                        } else {
                          abrirWizard("", plantilla);
                        }
                      }}
                    onActualizado={() => void cargarHistorialYProcedimientos()}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Compartidos con el equipo */}
          {procedimientos.filter((p) => (p.alcance ?? "personal") === "global").length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted flex items-center gap-1.5">
                🌐 Compartidos — todo el equipo puede ejecutarlos
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {procedimientos.filter((p) => (p.alcance ?? "personal") === "global").map((p) => (
                  <ProcedimientoCard
                    key={p.id}
                    p={p}
                    token={token}
                    onEjecutar={() => {
                        const plantilla = plantillaDesdeProtocolo(p);
                        if (plantilla.pasos.length > 0 || plantilla.listaCompras.length > 0) {
                          setPlantillaRepetir(plantilla);
                          setShowRepetirWizard(true);
                        } else {
                          abrirWizard("", plantilla);
                        }
                      }}
                    onActualizado={() => void cargarHistorialYProcedimientos()}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Secciones secundarias — visibles salvo cuando se está dentro de un subtab */}
      {!isAdmin && tabAcciones !== "pendientes" && tabAcciones !== "recordatorios" && tabAcciones !== "historial" && tabAcciones !== "procedimientos" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { tab: "pendientes" as const,    emoji: "🗓️", label: "Futuras",        count: pendientes.length,      color: "border-emerald-200 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/50 hover:border-emerald-400" },
            { tab: "recordatorios" as const, emoji: "🔔", label: "Recordatorios",  count: recordatorios.length,   color: "border-violet-200  dark:border-violet-700/60  bg-violet-50  dark:bg-violet-950/50  hover:border-violet-400"  },
            { tab: "procedimientos" as const,emoji: "🔒", label: "Procedimientos", count: procedimientos.length,  color: "border-sky-200     dark:border-sky-700/60     bg-sky-50     dark:bg-sky-950/50     hover:border-sky-400"     },
            { tab: "historial" as const,     emoji: "📜", label: "Historial",      count: null,                   color: "border-stone-200   dark:border-stone-600/50   bg-stone-50   dark:bg-stone-900/60   hover:border-stone-400"   },
          ].map(({ tab, emoji, label, count, color }) => (
            <button
              key={tab}
              type="button"
              onClick={() => setTabAcciones(tab)}
              className={`flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-all active:scale-[0.97] cursor-pointer shadow-sm ${color}`}
            >
              <span className="text-2xl">{emoji}</span>
              <span className="text-sm font-extrabold text-ink leading-tight">{label}</span>
              {count != null && (
                <span className="text-xs font-bold text-muted">{count} {count === 1 ? "ítem" : "ítems"}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {!["pendientes","recordatorios","historial","procedimientos"].includes(tabAcciones) && loading && (
        <div className="py-8 text-center text-sm text-muted">Cargando acciones…</div>
      )}

      {!["pendientes","recordatorios","historial","procedimientos"].includes(tabAcciones) && !loading && acciones.length === 0 && (
        <div className="py-12 text-center space-y-2">
          <p className="text-2xl">⚡</p>
          <p className="text-sm text-muted">No hay acciones registradas.</p>
        </div>
      )}

      {/* Tarjetas agrupadas por estado */}
      {!["pendientes","recordatorios","historial","procedimientos"].includes(tabAcciones) && !loading && (
        <>
          {(
            [
              { key: "pendiente",             emoji: "⏸", label: "Pendientes" },
              { key: "en_proceso",            emoji: "▶", label: "En proceso" },
              { key: "esperando_aprobacion",  emoji: "🕐", label: "Esperando aprobación" },
              { key: "resuelto",              emoji: "✓", label: "Resueltas" },
              { key: "rechazado",             emoji: "✕", label: "Canceladas" },
            ] as { key: string; emoji: string; label: string }[]
          ).map(({ key, emoji, label }) => {
            const grupo = acciones.filter((t) => t.estado === key && (t.tipo || "") === "accion" && !esSolicitudCompraDelegada(t));
            if (grupo.length === 0) return null;
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{emoji}</span>
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
                  <span className="rounded-full bg-surface border border-border px-1.5 py-0.5 text-[10px] text-muted">{grupo.length}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {grupo.map((t) => (
                    <AccionCard
                      key={t.id}
                      ticket={t}
                      token={token}
                      user={user}
                      onSelect={onSelect}
                      onChanged={() => void load(true)}
                      onContinuar={
                        !isAdmin && !comprasDelegadas.some((c) => c.ticket_padre_id === t.id)
                          ? (tk) => void continuarAccion(tk)
                          : undefined
                      }
                      isAdmin={isAdmin}
                      readOnly={isAdmin}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ── EjecucionAccionChat ───────────────────────────────────────────────────────

function EjecucionAccionChat({
  token, accion, stt, chatApiToken, onVolver, onTerminado,
}: {
  token: string;
  accion: { id: number; titulo: string };
  stt: ReturnType<typeof useStt>;
  chatApiToken: string | null | undefined;
  onVolver: () => void;
  onTerminado: () => void;
}) {
  type Nota = { id: number; texto: string; fotoUrl?: string; guardando?: boolean; errorGuarda?: boolean };

  const SECS_KEY = `mckenna-accion-secs-${accion.id}`;
  const [notas, setNotas] = useState<Nota[]>([]);
  const [inputNota, setInputNota] = useState("");
  const [terminando, setTerminando] = useState(false);
  const [error, setError] = useState("");
  const [segundos, setSegundos] = useState(() => parseInt(localStorage.getItem(SECS_KEY) ?? "0") || 0);
  const t0 = useRef(Date.now() - segundos * 1000);
  const notaIdRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      const s = Math.floor((Date.now() - t0.current) / 1000);
      setSegundos(s);
      localStorage.setItem(SECS_KEY, String(s));
    }, 1000);
    return () => clearInterval(iv);
  }, [SECS_KEY]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [notas]);

  function fmtSeg(s: number) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")}`
      : `${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")}`;
  }

  // Guarda cada ítem inmediatamente para preservar el orden cronológico real
  async function agregarNota(texto: string, fotoFile?: File, fotoUrl?: string) {
    if (!texto.trim() && !fotoFile) return;
    const nid = ++notaIdRef.current;
    setNotas(prev => [...prev, { id: nid, texto: texto.trim(), fotoUrl, guardando: true }]);
    setInputNota("");
    try {
      if (fotoFile) {
        const fd = new FormData();
        fd.append("archivo", fotoFile);
        await fetch(`/api/tickets/${accion.id}/adjuntos`, {
          method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
        });
      } else if (texto.trim()) {
        await fetch(`/api/tickets/${accion.id}/comentarios`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ texto: texto.trim() }),
        });
      }
      setNotas(prev => prev.map(n => n.id === nid ? { ...n, guardando: false } : n));
    } catch {
      setNotas(prev => prev.map(n => n.id === nid ? { ...n, guardando: false, errorGuarda: true } : n));
    }
  }

  function onFotoSeleccionada(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void agregarNota("", file, URL.createObjectURL(file));
    e.target.value = "";
  }

  async function terminar() {
    // Esperar que todo esté guardado antes de cerrar
    const pendientes = notas.filter(n => n.guardando).length;
    if (pendientes > 0) { setError(`Aún guardando ${pendientes} ítem(s)…`); return; }
    setTerminando(true);
    setError("");
    try {
      await fetch(`/api/tickets/${accion.id}/completar-accion`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reporte: `Duración: ${fmtSeg(segundos)}` }),
      });
      localStorage.removeItem(SECS_KEY);
      localStorage.removeItem("mckenna-accion-activa");
      onTerminado();
    } catch { setError("No se pudo cerrar. Intenta de nuevo."); }
    finally { setTerminando(false); }
  }

  function guardarYVolver() {
    localStorage.setItem("mckenna-accion-activa", JSON.stringify({ id: accion.id, titulo: accion.titulo }));
    onVolver();
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">
      {/* Header con cronómetro */}
      <div className="shrink-0 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-gray-950">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button type="button" onClick={guardarYVolver}
            className="flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 transition shrink-0">‹</button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-white/40">En ejecución</p>
            <p className="text-sm font-extrabold text-gray-900 dark:text-white leading-snug truncate">{accion.titulo}</p>
          </div>
          {/* Cronómetro */}
          <div className="shrink-0 flex items-center gap-1.5 bg-accent/10 rounded-full px-3 py-1">
            <span className="text-xs">⏱</span>
            <span className="text-sm font-black tabular-nums text-accent">{fmtSeg(segundos)}</span>
          </div>
        </div>
      </div>

      {/* Área de actividad */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50 dark:bg-gray-950">
        {notas.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <p className="text-3xl">📋</p>
            <p className="text-sm text-gray-400 dark:text-white/40">
              Describí lo que vas haciendo,<br/>tomá fotos como evidencia.
            </p>
          </div>
        )}
        {notas.map(nota => (
          <div key={nota.id} className="flex justify-end">
            <div className="max-w-[88%] space-y-1">
              {nota.fotoUrl && (
                <img src={nota.fotoUrl} alt="foto"
                  className={`rounded-xl w-full max-w-xs border object-cover transition ${nota.guardando ? "opacity-60 border-gray-200 dark:border-white/10" : "border-gray-200 dark:border-white/10"}`}/>
              )}
              {nota.texto && (
                <div className={`bg-accent rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-white leading-relaxed transition ${nota.guardando ? "opacity-60" : ""}`}>
                  {nota.texto}
                </div>
              )}
              <p className="text-right text-[10px] text-gray-400 dark:text-white/30">
                {nota.errorGuarda ? "⚠ No se guardó" : nota.guardando ? "Guardando…" : "✓"}
              </p>
            </div>
          </div>
        ))}
        {error && <p className="text-center text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div ref={bottomRef}/>
      </div>

      {/* Terminar */}
      <div className="shrink-0 px-4 pt-3 pb-2 bg-white dark:bg-gray-950">
        <button type="button" onClick={terminar} disabled={terminando || notas.some(n => n.guardando)}
          className="w-full rounded-2xl bg-green-500 hover:bg-green-400 disabled:opacity-50 py-3.5 text-base font-extrabold text-white transition active:scale-[0.98] shadow-lg">
          {terminando ? "Cerrando…" : notas.some(n => n.guardando) ? "Guardando…" : "✅ Terminé la actividad"}
        </button>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-gray-200 dark:border-white/10 px-4 py-3 flex items-center gap-2 bg-white dark:bg-gray-950">
        <input type="file" accept="image/*" capture="environment" ref={fotoInputRef} className="hidden" onChange={onFotoSeleccionada}/>
        <button type="button" onClick={() => fotoInputRef.current?.click()}
          className="h-11 w-11 shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 flex items-center justify-center text-gray-500 dark:text-white/70 transition" title="Foto">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
        <input value={inputNota} onChange={e => setInputNota(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); agregarNota(inputNota); } }}
          placeholder="Describí lo que hiciste…"
          className="flex-1 rounded-full bg-gray-100 border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-accent/60 transition dark:bg-gray-800 dark:border-white/15 dark:text-white dark:placeholder:text-white/40"/>
        {inputNota.trim() ? (
          <button type="button" onClick={() => agregarNota(inputNota)}
            className="h-11 w-11 shrink-0 rounded-full bg-accent flex items-center justify-center text-white shadow active:scale-95 transition">
            <svg className="h-5 w-5 rotate-90" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
          </button>
        ) : (
          <button type="button" onClick={() => stt.grabando ? stt.detener() : stt.iniciar(txt => agregarNota(txt))}
            disabled={stt.transcribiendo}
            className={`h-11 w-11 shrink-0 rounded-full flex items-center justify-center shadow transition active:scale-95 disabled:opacity-50 ${
              stt.grabando ? "bg-red-500 animate-pulse text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            }`}>
            {stt.grabando
              ? <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              : <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
            }
          </button>
        )}
      </div>
      {(stt.grabando || stt.transcribiendo) && (
        <p className="shrink-0 text-center text-xs text-accent pb-2 bg-white dark:bg-gray-950">
          {stt.grabando ? `🎙️ ${stt.segundos}s` : "✨ Transcribiendo…"}
        </p>
      )}
    </div>
  );
}

// ── ResolverActividadChat ─────────────────────────────────────────────────────

function ResolverActividadChat({
  token, solicitud, stt, chatApiToken, onVolver, onTerminado,
}: {
  token: string;
  solicitud: { id: number; titulo: string; numero: string; creado_por_nombre: string };
  stt: ReturnType<typeof useStt>;
  chatApiToken: string | null | undefined;
  onVolver: () => void;
  onTerminado: () => void;
}) {
  type Nota = { id: number; texto: string; fotoUrl?: string; guardando?: boolean; errorGuarda?: boolean };
  const [notas, setNotas] = useState<Nota[]>([]);
  const [inputNota, setInputNota] = useState("");
  const [terminando, setTerminando] = useState(false);
  const [error, setError] = useState("");
  const notaIdRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [notas]);

  async function agregarNota(texto: string, fotoFile?: File, fotoUrl?: string) {
    if (!texto.trim() && !fotoFile) return;
    const nid = ++notaIdRef.current;
    setNotas(prev => [...prev, { id: nid, texto: texto.trim(), fotoUrl, guardando: true }]);
    setInputNota("");
    try {
      if (fotoFile) {
        const fd = new FormData();
        fd.append("archivo", fotoFile);
        await fetch(`/api/tickets/${solicitud.id}/adjuntos`, {
          method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
        });
      } else if (texto.trim()) {
        await fetch(`/api/tickets/${solicitud.id}/comentarios`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ texto: texto.trim() }),
        });
      }
      setNotas(prev => prev.map(n => n.id === nid ? { ...n, guardando: false } : n));
    } catch {
      setNotas(prev => prev.map(n => n.id === nid ? { ...n, guardando: false, errorGuarda: true } : n));
    }
  }

  function onFotoSeleccionada(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void agregarNota("", file, URL.createObjectURL(file));
    e.target.value = "";
  }

  async function terminar() {
    if (notas.some(n => n.guardando)) { setError("Aún guardando ítems…"); return; }
    setTerminando(true);
    setError("");
    try {
      const res = await fetch(`/api/tickets/${solicitud.id}/estado`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "resuelto" }),
      });
      if (!res.ok) throw new Error("No se pudo cerrar la actividad");
      onTerminado();
    } catch (e: any) {
      setError(e.message || "Ocurrió un error. Intenta de nuevo.");
    } finally {
      setTerminando(false);
    }
  }

  const hayContenido = notas.length > 0;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="shrink-0 flex items-start gap-3 px-4 py-3 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-gray-950">
        <button type="button" onClick={onVolver}
          className="mt-0.5 flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 transition shrink-0"
        >‹</button>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-0.5">Actividad pendiente</p>
          <p className="text-sm font-extrabold text-gray-900 dark:text-white leading-snug line-clamp-2">{solicitud.titulo}</p>
          {solicitud.creado_por_nombre && (
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">De: {solicitud.creado_por_nombre}</p>
          )}
        </div>
      </div>

      {/* Área de notas / actividad */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50 dark:bg-gray-950">
        {notas.length === 0 && (
          <div className="text-center py-10 space-y-2">
            <p className="text-3xl">📝</p>
            <p className="text-sm text-gray-400 dark:text-white/40">
              Contá lo que vas haciendo o tomá fotos.<br />Cuando termines, tocá el botón verde.
            </p>
          </div>
        )}
        {notas.map(nota => (
          <div key={nota.id} className="flex justify-end">
            <div className="max-w-[88%] space-y-1">
              {nota.fotoUrl && (
                <img src={nota.fotoUrl} alt="foto"
                  className={`rounded-xl w-full max-w-xs border border-gray-200 dark:border-white/10 object-cover transition ${nota.guardando ? "opacity-60" : ""}`}/>
              )}
              {nota.texto && (
                <div className={`bg-accent rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-white leading-relaxed transition ${nota.guardando ? "opacity-60" : ""}`}>
                  {nota.texto}
                </div>
              )}
              <p className="text-right text-[10px] text-gray-400 dark:text-white/30">
                {nota.errorGuarda ? "⚠ No se guardó" : nota.guardando ? "Guardando…" : "✓"}
              </p>
            </div>
          </div>
        ))}
        {error && <p className="text-center text-xs text-red-500 dark:text-red-400">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Botón terminar */}
      <div className="shrink-0 px-4 pt-3 pb-2 bg-white dark:bg-gray-950">
        <button type="button" onClick={terminar} disabled={terminando || notas.some(n => n.guardando)}
          className="w-full rounded-2xl bg-green-500 hover:bg-green-400 disabled:opacity-50 py-3.5 text-base font-extrabold text-white transition active:scale-[0.98] shadow-lg">
          {terminando ? "Cerrando…" : notas.some(n => n.guardando) ? "Guardando…" : "✅ Terminé la actividad"}
        </button>
        {!hayContenido && (
          <p className="text-center text-[10px] text-gray-400 dark:text-white/30 mt-1.5">Podés terminar sin agregar notas</p>
        )}
      </div>

      {/* Input de notas + mic + cámara */}
      <div className="shrink-0 border-t border-gray-200 dark:border-white/10 px-4 py-3 flex items-center gap-2 bg-white dark:bg-gray-950">
        <input type="file" accept="image/*" capture="environment" ref={fotoInputRef} className="hidden" onChange={onFotoSeleccionada}/>
        <button type="button" onClick={() => fotoInputRef.current?.click()}
          className="h-11 w-11 shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 flex items-center justify-center text-gray-500 dark:text-white/70 hover:text-gray-700 dark:hover:text-white transition"
          title="Tomar foto">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
        <input value={inputNota} onChange={e => setInputNota(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); agregarNota(inputNota); } }}
          placeholder="Describí lo que hiciste…"
          className="flex-1 rounded-full bg-gray-100 border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-accent/60 transition dark:bg-gray-800 dark:border-white/15 dark:text-white dark:placeholder:text-white/40"
        />
        {inputNota.trim() ? (
          <button type="button" onClick={() => agregarNota(inputNota)}
            className="h-11 w-11 shrink-0 rounded-full bg-accent flex items-center justify-center text-white shadow active:scale-95 transition">
            <svg className="h-5 w-5 rotate-90" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
          </button>
        ) : (
          <button type="button" onClick={() => stt.grabando ? stt.detener() : stt.iniciar(txt => agregarNota(txt))}
            disabled={stt.transcribiendo}
            className={`h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-white shadow transition active:scale-95 disabled:opacity-50 ${
              stt.grabando ? "bg-red-500 animate-pulse" : "bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            }`}>
            {stt.grabando
              ? <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              : <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
            }
          </button>
        )}
      </div>
      {(stt.grabando || stt.transcribiendo) && (
        <p className="shrink-0 text-center text-xs text-accent pb-2 bg-white dark:bg-gray-950">
          {stt.grabando ? `🎙️ Grabando… ${stt.segundos}s` : "✨ Transcribiendo…"}
        </p>
      )}
    </div>
  );
}

// ── AgenteMandoView ───────────────────────────────────────────────────────────

type AgenteBurbuja = {
  id: number;
  rol: "agente" | "usuario";
  texto: string;
  chips?: AgentChip[];
};

type AgentChip = {
  label: string;
  cmd?: string;
  datos?: Record<string, unknown>;
  onTap?: () => void;
};

function AgenteMandoView({
  token, user, onSalir, onGoSolicitudes, onGoAcciones, onGoTablero, onGoHistorialAcciones,
}: {
  token: string;
  user: TicketsUser;
  onSalir: () => void;
  onGoSolicitudes: () => void;
  onGoAcciones: () => void;
  onGoTablero: () => void;
  onGoHistorialAcciones: () => void;
}) {
  const { apiToken: chatApiToken } = useTicketsAuth();
  const stt = useStt(token, chatApiToken);
  const nombre = user.nombre.split(" ")[0];

  const [burbujas, setBurbujas] = useState<AgenteBurbuja[]>([]);
  const [protocolos, setProtocolos] = useState<{ id: number; titulo: string; pasos?: any[]; lista_compras?: any[] }[]>([]);
  const [accionActual, setAccionActual] = useState<{
    id: number; titulo: string; pasos: any[];
    pasos_total: number; pasos_completados: number;
  } | null>(null);
  const [solicitudResolviendo, setSolicitudResolviendo] = useState<{
    id: number; titulo: string; numero: string; creado_por_nombre: string;
  } | null>(null);
  const [modoEjecucion, setModoEjecucion] = useState<{ id: number; titulo: string } | null>(() => {
    try {
      const s = localStorage.getItem("mckenna-accion-activa");
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [esperandoTituloAccion, setEsperandoTituloAccion] = useState(false);
  const [solicitudesCount, setSolicitudesCount] = useState(0);
  const [accionesCount, setAccionesCount] = useState(0);
  const [pensando, setPensando] = useState(false);
  const [input, setInput] = useState("");
  const [ttsPlaying, setTtsPlaying] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const burbulaIdRef = useRef(0);

  function nextId() { return ++burbulaIdRef.current; }

  function agregarBurbuja(rol: "agente" | "usuario", texto: string, chips?: AgentChip[]) {
    setBurbujas(prev => [...prev, { id: nextId(), rol, texto, chips }]);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [burbujas, pensando]);

  // Cargar contexto inicial
  useEffect(() => {
    void cargarContextoInicial();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function cargarContextoInicial() {
    setPensando(true);
    try {
      const res = await tapi("/agente-chat", token, {
        method: "POST",
        body: JSON.stringify({ mensaje: "", historial: [] }),
      });
      const prots: { id: number; titulo: string }[] = res.contexto?.protocolos ?? [];
      const accActivas: any[] = res.contexto?.acciones_activas ?? [];
      const solAsignadas: any[] = res.contexto?.solicitudes_asignadas ?? [];
      setProtocolos(prots);
      setSolicitudesCount(solAsignadas.length);
      setAccionesCount(accActivas.length);

      const mainChips = buildMainChips(prots, accActivas);
      agregarBurbuja("agente", `¡Hola ${nombre}! ¿Qué vas a hacer?`, mainChips);

      if (solAsignadas.length > 0) {
        const chipsSol: AgentChip[] = solAsignadas.slice(0, 3).map((s: any) => ({
          label: `📋 ${s.titulo}`,
          onTap: () => setSolicitudResolviendo({
            id: s.id, titulo: s.titulo,
            numero: s.numero, creado_por_nombre: s.creado_por_nombre,
          }),
        }));
        agregarBurbuja(
          "agente",
          `Tenés ${solAsignadas.length} solicitud${solAsignadas.length > 1 ? "es" : ""} pendiente${solAsignadas.length > 1 ? "s" : ""} de resolver:`,
          chipsSol,
        );
      }

      if (accActivas.length > 0) {
        const chipsContinuar: AgentChip[] = accActivas.slice(0, 3).map((a: any) => ({
          label: `⚡ Continuar: ${a.titulo}`,
          onTap: () => continuarAccion(a),
        }));
        agregarBurbuja(
          "agente",
          `Tenés ${accActivas.length} acción${accActivas.length > 1 ? "es" : ""} en curso:`,
          chipsContinuar,
        );
      }
    } catch {
      agregarBurbuja("agente", `¡Hola ${nombre}! ¿Qué vas a hacer hoy?`, [
        { label: "⚡ Registrar acción", onTap: mostrarProcedimientos },
        { label: "📋 Crear solicitud", onTap: onGoSolicitudes },
      ]);
    } finally {
      setPensando(false);
    }
  }

  function buildMainChips(prots: { id: number; titulo: string }[], accActivas: any[]): AgentChip[] {
    const chips: AgentChip[] = [];
    if (accActivas.length > 0) {
      chips.push({ label: `📊 Ver mis ${accActivas.length} activa${accActivas.length > 1 ? "s" : ""}`, onTap: mostrarActivas });
    }
    chips.push({ label: "⚡ Registrar acción", onTap: mostrarProcedimientos });
    chips.push({ label: "📋 Crear solicitud", onTap: onGoSolicitudes });
    return chips;
  }

  function mostrarProcedimientos(_procsOverride?: typeof protocolos) {
    agregarBurbuja("agente", "¿Es algo nuevo o algo que ya has hecho antes?", [
      { label: "🆕 Acción nueva",       onTap: pedirTituloLibre },
      { label: "🔄 Acción recurrente",  onTap: mostrarListaProcedimientos },
    ]);
  }

  function mostrarListaProcedimientos() {
    const prots = protocolos;
    if (prots.length === 0) {
      agregarBurbuja("agente", "No tenés procedimientos guardados aún. ¿Cómo se llama la acción?");
      inputRef.current?.focus();
      return;
    }
    const chips: AgentChip[] = prots.slice(0, 6).map(p => ({
      label: p.titulo,
      cmd: "crear_accion",
      datos: { protocolo_id: p.id, titulo: p.titulo, lista_compras: p.lista_compras ?? [] },
    }));
    agregarBurbuja("agente", "Elegí el que corresponde:", chips);
  }

  function pedirTituloLibre() {
    setEsperandoTituloAccion(true);
    agregarBurbuja("agente", "¿Cómo se llama la acción?");
    inputRef.current?.focus();
  }

  function mostrarActivas() {
    agregarBurbuja("agente", "Aquí van tus acciones en curso. Tocá una para continuar.");
  }

  function continuarAccion(a: any) {
    setAccionActual({
      id: a.id, titulo: a.titulo, pasos: [],
      pasos_total: a.pasos_total ?? 0,
      pasos_completados: a.pasos_completados ?? 0,
    });
    void cargarPasosAccion(a.id, a.titulo);
  }

  async function cargarPasosAccion(id: number, titulo: string) {
    setPensando(true);
    try {
      const t = await tapi(`/${id}`, token) as any;
      const pasosRaw: any[] = t.pasos ?? [];
      // normalizar: usar descripcion como campo principal
      const pasos = pasosRaw.map((p: any) => ({
        ...p,
        descripcion: (p.descripcion || p.nombre || "").trim(),
      })).filter((p: any) => p.descripcion);
      const completados = pasos.filter((p: any) => p.completado).length;
      const total = pasos.length;
      setAccionActual({ id, titulo, pasos, pasos_total: total, pasos_completados: completados });

      if (total === 0) {
        agregarBurbuja("agente", `"${titulo}" lista para trabajar. Decime cuando termines.`, [
          { label: "🏁 Cerrar acción", onTap: () => pedirCierre(id) },
        ]);
        return;
      }

      const pendientes = pasos.filter((p: any) => !p.completado);
      if (pendientes.length === 0) {
        agregarBurbuja("agente", `¡Todos los pasos listos! ¿Cerramos "${titulo}"?`, [
          { label: "🏁 Sí, cerrar", onTap: () => pedirCierre(id) },
        ]);
        return;
      }

      mostrarPasoActual(id, titulo, pasos, completados, total);
    } catch {
      agregarBurbuja("agente", "No pude cargar los pasos. Intenta de nuevo.");
    } finally {
      setPensando(false);
    }
  }

  function mostrarPasoActual(ticketId: number, titulo: string, pasos: any[], completados: number, total: number) {
    const pendientes = pasos.filter((p: any) => !p.completado);
    if (pendientes.length === 0) {
      agregarBurbuja("agente", `¡Todos los pasos de "${titulo}" listos!`, [
        { label: "🏁 Cerrar acción", onTap: () => pedirCierre(ticketId) },
      ]);
      return;
    }
    const sig = pendientes[0];
    const notas = (sig.notas || "").trim();
    const msgPaso = `Paso ${completados + 1}/${total}: ${sig.descripcion}${notas ? `\n📝 ${notas}` : ""}`;
    agregarBurbuja(
      "agente",
      msgPaso,
      [
        { label: `✓ Listo`, cmd: "marcar_paso", datos: { ticket_id: ticketId, paso_id: sig.id } },
        { label: "🏁 Cerrar acción", onTap: () => pedirCierre(ticketId) },
      ],
    );
  }

  function pedirCierre(id: number) {
    agregarBurbuja("agente", "¿Querés dejar un reporte de cierre? (opcional, podés omitir)");
    setAccionActual(prev => prev ? { ...prev, id } : prev);
    inputRef.current?.focus();
  }

  async function enviar(texto: string, cmd?: string, datos?: Record<string, unknown>) {
    if (pensando || (!texto.trim() && !cmd)) return;

    // Interceptar cuando el bot esperaba el nombre de la acción
    if (esperandoTituloAccion && texto.trim() && !cmd) {
      setEsperandoTituloAccion(false);
      cmd = "crear_accion";
      datos = { titulo: texto.trim() };
    }

    if (texto.trim()) agregarBurbuja("usuario", texto.trim());
    setInput("");
    setPensando(true);

    try {
      const historialEnvio = burbujas.slice(-10).map(b => ({ rol: b.rol, texto: b.texto }));
      const res = await tapi("/agente-chat", token, {
        method: "POST",
        body: JSON.stringify({
          mensaje: texto.trim(),
          historial: historialEnvio,
          accion_cmd: cmd ?? null,
          accion_datos: datos ?? null,
        }),
      });

      const protsActualizados = res.contexto?.protocolos ?? protocolos;
      if (res.contexto?.protocolos) setProtocolos(res.contexto.protocolos);
      const accActivas: any[] = res.contexto?.acciones_activas ?? [];

      // ── Comando ejecutado ────────────────────────────────────────────────────
      const resultado = res.accion_resultado as any;
      if (resultado && !resultado.error) {

        if (cmd === "crear_accion" && resultado.ticket_id) {
          const titulo = resultado.titulo ?? texto;
          // Guardar en localStorage para persistencia
          localStorage.setItem("mckenna-accion-activa", JSON.stringify({ id: resultado.ticket_id, titulo }));
          // Entrar directamente al modo de ejecución libre
          setModoEjecucion({ id: resultado.ticket_id, titulo });
          return;
        }

        if (cmd === "marcar_paso") {
          const pasosAct: any[] = (resultado.pasos ?? []).map((p: any) => ({
            ...p,
            descripcion: (p.descripcion || p.nombre || "").trim(),
          })).filter((p: any) => p.descripcion);
          const total = resultado.pasos_total ?? pasosAct.length;
          const completados = resultado.pasos_completados ?? 0;
          setAccionActual(prev => prev ? { ...prev, pasos: pasosAct, pasos_total: total, pasos_completados: completados } : prev);
          const ticketId = datos?.ticket_id as number;
          const tituloActual = accionActual?.titulo ?? "";
          mostrarPasoActual(ticketId, tituloActual, pasosAct, completados, total);
          return;
        }

        if (cmd === "completar_accion") {
          setAccionActual(null);
          agregarBurbuja("agente", res.respuesta, buildMainChips(protsActualizados, accActivas));
          return;
        }

        if (cmd === "crear_solicitud") {
          agregarBurbuja("agente", res.respuesta, [
            { label: "📋 Ver mis solicitudes", onTap: onGoSolicitudes },
            { label: "🏠 Inicio", onTap: onSalir },
          ]);
          return;
        }
      }

      if (resultado?.error) {
        agregarBurbuja("agente", `No pude hacerlo: ${resultado.error}`, buildMainChips(protsActualizados, accActivas));
        return;
      }

      // ── Texto libre: detectar intención ──────────────────────────────────────
      const procsRel: any[] = res.procs_relevantes ?? [];
      const esIntent: boolean = res.es_intent ?? false;
      const solCtx = res.solicitud_ctx ?? {};

      // Mostrar respuesta del LLM (o fallback del servidor)
      if (res.respuesta) agregarBurbuja("agente", res.respuesta);

      if (solCtx.es_solicitud) {
        // ── SOLICITUD A OTRA PERSONA ────────────────────────────────────────
        const u = solCtx.usuario as { id: number; nombre: string } | null;
        const tituloSol: string = solCtx.titulo_sugerido ?? texto.trim();
        if (u && tituloSol) {
          // Tenemos persona + título → ofrecer crear directamente
          agregarBurbuja("agente", `¿Creo la solicitud para ${u.nombre}?`, [
            {
              label: `📋 Sí, crear solicitud`,
              cmd: "crear_solicitud",
              datos: { titulo: tituloSol, asignado_a: u.id, asignado_a_nombre: u.nombre },
            },
            { label: "✏️ Cambiar texto", onTap: () => inputRef.current?.focus() },
          ]);
        } else if (u && !tituloSol) {
          // Tenemos persona pero no título → el bot ya preguntó, no agregar más chips
        } else if (!u && solCtx.persona_nombre) {
          // Persona no encontrada → ya el servidor respondió el error, sin chips extra
        }
        // Si es solicitud genérica sin persona, el servidor ya preguntó
      } else if (procsRel.length > 0 || esIntent) {
        // Intención de acción detectada → pregunta simple, sin listar procedimientos
        agregarBurbuja("agente", "¿La registramos?", [
          { label: "🆕 Acción nueva",      cmd: "crear_accion", datos: { titulo: texto.trim() } },
          { label: "🔄 Acción recurrente", onTap: mostrarListaProcedimientos },
        ]);
      } else {
        // Respuesta genérica: pegar chips contextuales a la última burbuja del agente
        const chips = buildChipsContextuales(accActivas);
        if (chips.length > 0) setBurbujas(prev => {
          const last = prev[prev.length - 1];
          if (last?.rol === "agente" && !last.chips) {
            return [...prev.slice(0, -1), { ...last, chips }];
          }
          return prev;
        });
      }
    } catch {
      agregarBurbuja("agente", "Sin conexión con el servidor. Intenta de nuevo.", [
        { label: "🔄 Reintentar", onTap: () => void enviar(texto, cmd, datos) },
      ]);
    } finally {
      setPensando(false);
    }
  }

  function buildChipsContextuales(accActivas: any[]): AgentChip[] {
    if (accionActual) {
      const pendientes = accionActual.pasos.filter((p: any) => !p.completado);
      if (pendientes.length > 0) {
        return [
          { label: "✓ Listo el paso", cmd: "marcar_paso", datos: { ticket_id: accionActual.id, paso_id: pendientes[0].id } },
          { label: "🏁 Cerrar acción", onTap: () => pedirCierre(accionActual.id) },
        ];
      }
      return [{ label: "🏁 Cerrar acción", onTap: () => pedirCierre(accionActual.id) }];
    }
    return buildMainChips(protocolos, accActivas);
  }

  async function hablar(texto: string, burbulaId: number) {
    if (ttsPlaying === burbulaId) return;
    setTtsPlaying(burbulaId);
    try {
      const r = await fetch("/api/voz/sintetizar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(chatApiToken ? { Authorization: `Bearer ${chatApiToken}` } : {}),
        },
        body: JSON.stringify({ texto, motor: "auto" }),
      });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audio.onended = () => setTtsPlaying(null);
      audio.onerror = () => setTtsPlaying(null);
      await audio.play();
    } catch {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = "es-CO";
        u.onend = () => setTtsPlaying(null);
        window.speechSynthesis.speak(u);
      } else {
        setTtsPlaying(null);
      }
    }
  }

  function onChipTap(chip: AgentChip) {
    if (chip.onTap) { chip.onTap(); return; }
    if (chip.cmd) {
      void enviar(chip.label, chip.cmd, chip.datos as Record<string, unknown>);
    } else {
      void enviar(chip.label);
    }
  }

  const lastChips = burbujas.length > 0 ? burbujas[burbujas.length - 1].chips : undefined;

  // ── Modo ejecución de acción propia ─────────────────────────────────────────
  if (modoEjecucion) {
    return (
      <EjecucionAccionChat
        token={token}
        accion={modoEjecucion}
        stt={stt}
        chatApiToken={chatApiToken}
        onVolver={() => setModoEjecucion(null)}
        onTerminado={() => {
          setModoEjecucion(null);
          setAccionesCount(c => Math.max(0, c - 1));
          agregarBurbuja("agente", "¡Buena! Actividad registrada. ¿Qué más hacemos?", buildMainChips(protocolos, []));
        }}
      />
    );
  }

  // ── Modo resolver solicitud ──────────────────────────────────────────────────
  if (solicitudResolviendo) {
    return (
      <ResolverActividadChat
        token={token}
        solicitud={solicitudResolviendo}
        stt={stt}
        chatApiToken={chatApiToken}
        onVolver={() => setSolicitudResolviendo(null)}
        onTerminado={() => {
          setSolicitudResolviendo(null);
          agregarBurbuja("agente", "¡Actividad registrada! ¿Qué más hacemos?", buildMainChips(protocolos, []));
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-white/10 shrink-0 bg-white dark:bg-gray-950">
        <button type="button" onClick={onSalir}
          className="flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 transition shrink-0"
          aria-label="Volver">‹</button>
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-accent text-white font-black text-sm shadow shrink-0">H</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-gray-900 dark:text-white leading-tight">Hugo García</p>
          <p className="text-[11px] text-gray-400 dark:text-white/40">Asistente de Operaciones</p>
        </div>
        {accionActual && (
          <span className="text-[10px] font-bold text-accent bg-accent/10 rounded-full px-2 py-0.5 shrink-0">En curso</span>
        )}
      </div>

      {/* ── Chat — mitad superior ────────────────────────────────────────────── */}
      <div className="overflow-y-auto px-4 py-3 space-y-2.5 bg-gray-50 dark:bg-gray-950" style={{ maxHeight: "42vh" }}>
        {burbujas.map((b) => (
          <div key={b.id} className={`flex flex-col ${b.rol === "usuario" ? "items-end" : "items-start"} gap-1`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
              b.rol === "usuario"
                ? "bg-accent text-white rounded-br-sm"
                : "bg-gray-100 text-gray-900 rounded-bl-sm dark:bg-white/10 dark:text-white"
            }`}>
              <p>{b.texto}</p>
              {b.rol === "agente" && (
                <button type="button" onClick={() => void hablar(b.texto, b.id)}
                  className={`mt-1 flex items-center gap-1 text-[10px] font-semibold transition ${
                    ttsPlaying === b.id ? "text-accent animate-pulse" : "text-gray-400 hover:text-gray-600 dark:text-white/25 dark:hover:text-white/50"
                  }`}>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                  </svg>
                  {ttsPlaying === b.id ? "Escuchando…" : "Escuchar"}
                </button>
              )}
            </div>
          </div>
        ))}
        {lastChips && lastChips.length > 0 && !pensando && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {lastChips.map((chip, i) => (
              <button key={i} type="button" onClick={() => onChipTap(chip)}
                className="rounded-full border border-accent/60 bg-accent/10 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/20 active:scale-95 transition">
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {pensando && (
          <div className="flex items-start">
            <div className="bg-gray-100 dark:bg-white/10 rounded-2xl rounded-bl-sm px-4 py-2.5 flex gap-1">
              {[0,1,2].map(i => <span key={i} className="block h-2 w-2 rounded-full bg-gray-400 dark:bg-white/40 animate-bounce" style={{ animationDelay: `${i*150}ms` }}/>)}
            </div>
          </div>
        )}
        {(stt.grabando || stt.transcribiendo) && (
          <div className="flex justify-end">
            <div className="bg-accent/20 border border-accent/40 rounded-2xl px-3 py-1.5 text-xs font-semibold text-accent">
              {stt.grabando ? `🎙️ ${stt.segundos}s` : "✨ Transcribiendo…"}
            </div>
          </div>
        )}
        {stt.error && <p className="text-center text-xs text-red-500 dark:text-red-400">{stt.error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* ── Panel inferior — accesos rápidos ────────────────────────────────── */}
      <div className="flex-1 flex flex-col border-t border-gray-200 dark:border-white/10 min-h-0 bg-white dark:bg-gray-950">

        {/* Barra de progreso si hay acción activa */}
        {accionActual && accionActual.pasos_total > 0 && (
          <div className="px-4 pt-3 pb-1 shrink-0">
            <div className="flex justify-between text-[10px] font-bold text-gray-400 dark:text-white/50 mb-1">
              <span className="truncate">{accionActual.titulo}</span>
              <span className="text-accent shrink-0 ml-2">{accionActual.pasos_completados}/{accionActual.pasos_total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.round((accionActual.pasos_completados / accionActual.pasos_total) * 100)}%` }}/>
            </div>
          </div>
        )}

        {/* Estadísticas rápidas */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onGoSolicitudes}
              className={`flex items-center gap-2.5 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.97] border ${
                solicitudesCount > 0
                  ? "bg-rose-50 border-rose-200 hover:bg-rose-100 dark:bg-rose-500/15 dark:border-rose-500/30 dark:hover:bg-rose-500/25"
                  : "bg-gray-50 border-gray-200 hover:bg-gray-100 dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10"
              }`}>
              <span className="text-2xl leading-none">📋</span>
              <div className="min-w-0">
                <p className={`text-lg font-black leading-none tabular-nums ${solicitudesCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-gray-300 dark:text-white/30"}`}>
                  {solicitudesCount}
                </p>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-white/50 mt-0.5 leading-tight">
                  {solicitudesCount === 1 ? "solicitud" : "solicitudes"} por resolver
                </p>
              </div>
            </button>

            <button type="button" onClick={onGoAcciones}
              className={`flex items-center gap-2.5 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.97] border ${
                accionesCount > 0
                  ? "bg-amber-50 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/15 dark:border-amber-500/30 dark:hover:bg-amber-500/25"
                  : "bg-gray-50 border-gray-200 hover:bg-gray-100 dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10"
              }`}>
              <span className="text-2xl leading-none">⚡</span>
              <div className="min-w-0">
                <p className={`text-lg font-black leading-none tabular-nums ${accionesCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-300 dark:text-white/30"}`}>
                  {accionesCount}
                </p>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-white/50 mt-0.5 leading-tight">
                  {accionesCount === 1 ? "acción" : "acciones"} en curso
                </p>
              </div>
            </button>
          </div>

          {/* Historial de acciones propias */}
          <button type="button" onClick={onGoHistorialAcciones}
            className="mt-2 w-full flex items-center gap-3 rounded-2xl bg-gray-50 border border-gray-200 px-3.5 py-2.5 text-left hover:bg-gray-100 active:scale-[0.97] transition dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10">
            <span className="text-lg leading-none">📂</span>
            <span className="text-xs font-bold text-gray-500 dark:text-white/60">Historial de mis acciones</span>
            <span className="ml-auto text-gray-300 dark:text-white/20 text-sm">›</span>
          </button>
        </div>

        {/* Input */}
        <div className="mt-auto border-t border-gray-200 dark:border-white/10 px-4 py-2.5 flex items-center gap-2 shrink-0">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(input); } }}
            placeholder="Escribí o dictá…"
            disabled={pensando}
            className="flex-1 rounded-full bg-gray-100 border border-gray-200 px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-accent/60 transition disabled:opacity-50 dark:bg-gray-800 dark:border-white/15 dark:text-white dark:placeholder:text-white/40"
          />
          {input.trim() ? (
            <button type="button" onClick={() => void enviar(input)} disabled={pensando}
              className="h-10 w-10 shrink-0 rounded-full bg-accent flex items-center justify-center text-white shadow disabled:opacity-50 active:scale-95 transition">
              <svg className="h-4 w-4 rotate-90" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
            </button>
          ) : (
            <button type="button"
              onClick={() => stt.grabando ? stt.detener() : stt.iniciar(txt => void enviar(txt))}
              disabled={pensando || stt.transcribiendo}
              className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white shadow transition active:scale-95 disabled:opacity-50 ${
                stt.grabando ? "bg-red-500 animate-pulse" : "bg-accent hover:brightness-110"
              }`}
              aria-label={stt.grabando ? "Detener" : "Grabar voz"}>
              {stt.grabando
                ? <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                  </svg>
              }
            </button>
          )}
        </div>

        {/* Botones rápidos — debajo del input */}
        <div className="px-4 pb-3 pt-1 shrink-0">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Tablero",         emoji: "🏠", onTap: onGoTablero },
              { label: "Nueva acción",    emoji: "➕", onTap: () => mostrarProcedimientos() },
              { label: "Crear solicitud", emoji: "📤", onTap: () => {
                agregarBurbuja("agente", "¿A quién le vas a hacer la solicitud y qué necesitás que haga?");
                inputRef.current?.focus();
              }},
            ].map(btn => (
              <button key={btn.label} type="button" onClick={btn.onTap}
                className="flex flex-col items-center gap-1 rounded-2xl bg-gray-50 border border-gray-200 px-2 py-2.5 text-center hover:bg-gray-100 active:scale-95 transition dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10">
                <span className="text-xl leading-none">{btn.emoji}</span>
                <span className="text-[10px] font-bold text-gray-500 dark:text-white/60 leading-tight">{btn.label}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function TicketsPanel() {
  const { token, user, setAuth, clear } = useTicketsAuth();
  const questDark = useQuestTheme((s) => s.dark);
  const [view, setView] = useState<View>("home");
  const [accionesInitialTab, setAccionesInitialTab] = useState<"subhome" | "activas" | "pendientes" | "recordatorios" | "procedimientos" | "historial">("activas");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedMisionId, setSelectedMisionId] = useState<number | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [bajoStockCount, setBajoStockCount] = useState(0);
  const [navScope, setNavScope] = useState<NavScope>({ kind: "all" });
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [accionesKey, setAccionesKey] = useState(0);
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


  function goDetail(id: number) { setSelectedId(id); setView("detail"); }
  function goBack() {
    setBoardRefreshKey((k) => k + 1);
    setView("home");
    setSelectedId(null);
    setSelectedMisionId(null);
  }
  function goMisionDetail(id: number) { setSelectedMisionId(id); setView("mision_detail"); }
  function goTablero() {
    setNavScope({ kind: "all" });
    setBoardRefreshKey((k) => k + 1);
    setView("home");
    setSelectedId(null);
    setSelectedMisionId(null);
  }
  function goKingdom() {
    setNavScope({ kind: "all" });
    setBoardRefreshKey((k) => k + 1);
    setView("list");
  }
  function goAcciones(tab: "subhome" | "activas" | "pendientes" | "recordatorios" | "procedimientos" | "historial" = "activas") {
    setAccionesInitialTab(tab);
    setAccionesKey((k) => k + 1);
    setView("acciones");
  }
  function goSolicitudes() { setView("solicitudes"); }
  function goAgente() { setView("agente"); }
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
          onSolicitudes={goSolicitudes}
          onInventario={goInventario}
          onReinos={goReinos}
          onRecetas={goRecetas}
          onCarrito={() => openCarrito(true)}
          carritoOpen={carritoOpen}
          onWorkload={goWorkload}
          onPerfil={goPerfil}
          onCreateMision={goCreateMision}
          onLogout={clear}
          onAgente={goAgente}
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
        {view === "home" && (
          <CentroMandoHome
            token={token}
            user={user}
            nivel={nivel}
            permisos={permisos}
            onAcciones={goAcciones}
            onSolicitudes={goSolicitudes}
            onTablero={goKingdom}
            onAccionesFuturas={() => goAcciones("pendientes")}
            onRecordatorios={() => goAcciones("recordatorios")}
            onProcedimientos={() => goAcciones("procedimientos")}
            onAgente={goAgente}
          />
        )}
        {/* AgenteMandoView se renderiza como overlay fixed — ver abajo */}
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
            key={accionesKey}
            token={token}
            user={user}
            onSelect={goDetail}
            onIrCompras={goSolicitudes}
            initialTab={accionesInitialTab}
            onInicio={goTablero}
          />
        )}
        {view === "solicitudes" && (
          <SolicitudesView
            token={token}
            user={user}
            onInicio={goTablero}
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
          <WorkloadView
            token={token}
            user={user}
            onBack={goBack}
            onAdministracion={nivel >= 3 ? () => setView("administracion") : undefined}
          />
        )}
        {view === "administracion" && nivel >= 3 && (
          <AdminView token={token} onBack={goBack} />
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

    {/* ── Agente overlay: full-screen, escapa el padding del layout ─────────── */}
    {view === "agente" && (
      <div className={`fixed inset-0 z-50 ${questDark ? "dark" : ""}`}>
        <AgenteMandoView
          token={token}
          user={user}
          onSalir={goTablero}
          onGoSolicitudes={goSolicitudes}
          onGoAcciones={goAcciones}
          onGoTablero={goTablero}
          onGoHistorialAcciones={() => goAcciones("historial")}
        />
      </div>
    )}
    </CategoriasCtx.Provider>
  );
}
