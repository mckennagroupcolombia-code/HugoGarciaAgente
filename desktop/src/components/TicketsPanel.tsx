import { useState, useEffect, useCallback, useRef, createContext, useContext, type CSSProperties } from "react";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";
import { useQuestTheme } from "../stores/questTheme";
import QuestThemeToggle from "./QuestThemeToggle";
import RecetasPanel from "./RecetasPanel";
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
  return fetch(`/api/tickets${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(!isForm ? { "Content-Type": "application/json" } : {}),
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
  historial?: LogEntry[];
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
  estado: "pendiente" | "activa" | "completada";
}

type Frecuencia = "diaria" | "semanal" | "quincenal" | "mensual" | "bimestral" | "trimestral" | "semestral";

interface Dependencia {
  id: number;
  titulo: string;
  estado: string;
  reino: string | null;
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
  etapas?: EtapaMision[];
  dependencias?: Dependencia[];
  producto_resultante_id?: number | null;
  producto_resultante?: { id: number; nombre: string; unidad: string; stock_actual: number } | null;
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
  activo: number;
  rol: { id: number; nombre: string; nivel: number } | null;
  departamento: { id: number; nombre: string; color: string } | null;
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
  diaria:     "♻️ Diaria",
  semanal:    "♻️ Semanal",
  quincenal:  "♻️ Quincenal",
  mensual:    "♻️ Mensual",
  bimestral:  "♻️ Bimestral",
  trimestral: "♻️ Trimestral",
  semestral:  "♻️ Semestral",
};

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
        {info.icono} {info.nombre}
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

type View =
  | "list"
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
  color?: string;
  icono?: string;
  orden?: number;
  activo?: number;
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
    if (g.reino_id) {
      const key = `id:${g.reino_id}`;
      const label = (g.reino || g.ubicacion_label || "").trim() || "Sin reino asignado";
      if (!buckets.has(key)) buckets.set(key, { label, groups: [], standalone: [] });
      buckets.get(key)!.groups.push(g);
    } else {
      bucketFor(g.reino).groups.push(g);
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
      color: z.color || "#0c6069",
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
  | { kind: "reino"; id: number; nombre: string }
  | { kind: "zona"; id: number; nombre: string; reinoNombre: string }
  | { kind: "subzona"; id: number; nombre: string; reinoNombre: string; zonaNombre: string }
  | {
    kind: "departamento";
    id: number;
    nombre: string;
    reinoNombre: string;
    zonaNombre: string;
    subzonaNombre: string;
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
  bajoStockCount,
  onTablero,
  onInventario,
  onReinos,
  onRecetas,
  onWorkload,
  onPerfil,
  onCreateMision,
}: {
  view: View;
  nivel: number;
  bajoStockCount: number;
  onTablero: () => void;
  onInventario: () => void;
  onReinos: () => void;
  onRecetas: () => void;
  onWorkload: () => void;
  onPerfil: () => void;
  onCreateMision: () => void;
}) {
  return (
    <nav
      className="quest-nav-bar sticky top-0 z-20 -mx-4 mb-5 flex flex-wrap items-center gap-2 border-b-2 border-border px-4 py-3 backdrop-blur-md lg:-mx-10"
      aria-label="Navegación Centro de Mando"
    >
      <button type="button" onClick={onTablero} className={questNavBtn(view === "list")}>
        📜 Tablero
      </button>
      <button
        type="button"
        onClick={onCreateMision}
        className={questNavBtn(view === "crear_mision", "quest-nav-btn--cta")}
      >
        + Nueva misión
      </button>
      <button type="button" onClick={onInventario} className={`relative ${questNavBtn(view === "inventario")}`}>
        🧪 Inventario
        {bajoStockCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white leading-none shadow-sm">
            {bajoStockCount}
          </span>
        )}
      </button>
      <button type="button" onClick={onReinos} className={questNavBtn(view === "reinos")}>
        🏰 Reinos
      </button>
      <button type="button" onClick={onRecetas} className={questNavBtn(view === "recetas")}>
        📖 Recetas
      </button>
      {nivel >= 2 && (
        <button type="button" onClick={onWorkload} className={questNavBtn(view === "workload")}>
          🤝 Aliados
        </button>
      )}
      <button type="button" onClick={onPerfil} className={questNavBtn(view === "perfil")}>
        👤 Perfil
      </button>
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
  const d = zonaProfundidad(z, zonas);
  if (d === 0) return "reino";
  if (d === 1) return "zona";
  if (d === 2) return "subzona";
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
  const [zonas, setZonas] = useState<ZonaTrabajo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [crear, setCrear] = useState<{
    tipo: CrearZonaTipo;
    parentId: number | "";
    nombre: string;
  } | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    return tapi("/zonas-trabajo", token)
      .then(setZonas)
      .catch(() => setZonas([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const arbol = buildReinoNavTree(zonas);
  const todosIds = zonas.map((z) => z.id);
  const zonasParaSub = zonas.filter((z) => zonaProfundidad(z, zonas) === 1);
  const subzonasParaDept = listarSubzonas(zonas);

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
    setCrear({ tipo, parentId: pid, nombre: "" });
    setActionMsg(null);
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
    if (crear.tipo === "departamento" && (crear.parentId === "" || crear.parentId == null)) {
      setActionMsg({
        type: "err",
        text: subzonasParaDept.length === 0
          ? "Elige la zona padre (ej. Cocina, Jardín en Hogar Dulce Hogar)."
          : "Elige la subzona padre.",
      });
      return;
    }
    setSaving(true);
    setActionMsg(null);
    try {
      const body: { nombre: string; nivel: CrearZonaTipo; parent_id?: number } = {
        nombre: crear.nombre.trim(),
        nivel: crear.tipo,
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
  }

  async function guardarEdicion() {
    if (editId == null || !editNombre.trim()) return;
    setSaving(true);
    setActionMsg(null);
    try {
      await tapi(`/zonas-trabajo/${editId}`, token, {
        method: "PUT",
        body: JSON.stringify({ nombre: editNombre.trim() }),
      });
      setEditId(null);
      setEditNombre("");
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
    if (niv === "reino") onNavScope({ kind: "reino", id: z.id, nombre: z.nombre });
    else if (niv === "zona") onNavScope({ kind: "zona", id: z.id, nombre: z.nombre, reinoNombre });
    else if (niv === "subzona") {
      onNavScope({
        kind: "subzona",
        id: z.id,
        nombre: z.nombre,
        reinoNombre,
        zonaNombre: zonaNombre || z.parent_nombre || "",
      });
    } else {
      onNavScope({
        kind: "departamento",
        id: z.id,
        nombre: z.nombre,
        reinoNombre,
        zonaNombre: zonaNombre || "",
        subzonaNombre: subzonaNombre || z.parent_nombre || "",
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
        <div key={z.id} className={`rounded-lg border-2 border-accent bg-surface p-2 ${indentCls}`}>
          <input
            className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm font-bold outline-none focus:border-accent"
            value={editNombre}
            onChange={(e) => setEditNombre(e.target.value)}
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => { setEditId(null); setEditNombre(""); }}
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
      >
        {canManage && (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-accent"
            checked={seleccionado}
            onChange={() => toggleSelect(z.id)}
          />
        )}
        <button
          type="button"
          onClick={() => aplicarFiltro(z, opts.reinoNombre, opts.zonaNombre, opts.subzonaNombre)}
          className="min-w-0 flex-1 text-left text-sm font-semibold text-ink hover:text-accent"
          title="Usar como filtro en tablero/inventario"
        >
          {icono} {z.nombre}
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
          <h2 className="text-xl font-extrabold text-ink">🏰 Reinos</h2>
          <p className="mt-1 text-xs text-muted">
            Reino → zona → subzona → departamento (labor). Clic en el nombre para filtrar tablero e inventario.
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
              title={
                subzonasParaDept.length === 0
                  ? "Labor bajo una zona (Cocina, Jardín…) — sin subzona"
                  : "Nuevo departamento (labor) bajo una subzona"
              }
              className="rounded-xl border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover active:translate-y-0.5 active:shadow-none"
            >
              + Departamento
            </button>
          </div>
        )}
      </div>

      {navScope.kind !== "all" && (
        <div className="flex flex-wrap items-center gap-2 rounded-paper border-2 border-accent/40 bg-accent/10 px-4 py-3">
          <span className="text-sm font-semibold text-accent">Filtro: {navScopeLabel(navScope)}</span>
          <button type="button" onClick={onIrTablero}
            className="rounded-paper border-2 border-accent bg-accent px-3 py-1 text-xs font-bold text-white hover:bg-accent-hover">
            Ver en tablero
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
              <label className="mb-1 block text-xs font-bold text-muted">
                {subzonasParaDept.length === 0 ? "Zona padre *" : "Subzona padre *"}
              </label>
              {subzonasParaDept.length === 0 ? (
                zonasParaSub.length === 0 ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    No hay zonas en el catálogo. Crea primero una <strong>zona</strong> bajo el reino (ej. Cocina).
                  </p>
                ) : (
                  <select
                    className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                    value={crear.parentId === "" ? "" : String(crear.parentId)}
                    onChange={(e) => setCrear((c) => c && { ...c, parentId: e.target.value ? parseInt(e.target.value, 10) : "" })}
                  >
                    <option value="">— Elegir zona —</option>
                    {zonasParaSub.map((z) => (
                      <option key={z.id} value={z.id}>{zonaRutaLabel(z, zonas)}</option>
                    ))}
                  </select>
                )
              ) : (
                <select
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                  value={crear.parentId === "" ? "" : String(crear.parentId)}
                  onChange={(e) => setCrear((c) => c && { ...c, parentId: e.target.value ? parseInt(e.target.value, 10) : "" })}
                >
                  <option value="">— Elegir subzona —</option>
                  {subzonasParaDept.map((s) => (
                    <option key={s.id} value={s.id}>{subzonaRutaLabel(s, zonas)}</option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-[10px] text-muted">
                {subzonasParaDept.length === 0
                  ? "Hogar y reinos simples: reino → zona (Cocina) → departamento (labor). Subzona es opcional en oficinas."
                  : "Oficinas: reino → zona → subzona → departamento (Contabilidad)."}
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
                || (crear.tipo === "departamento" && subzonasParaDept.length > 0 && (crear.parentId === "" || crear.parentId == null))
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
        <div className="space-y-4">
          {arbol.map(({ reino, zonas: zonasHijas }) => (
            <div key={reino.id} className="rounded-paper border-2 border-border bg-surface-panel p-3 shadow-paper-sm space-y-1">
              {filaZona(reino, { reinoNombre: reino.nombre })}
              {zonasHijas.map(({ zona, subzonas, departamentosDirectos }) => (
                <div key={zona.id}>
                  {filaZona(zona, { reinoNombre: reino.nombre, indent: "zona" })}
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
                    <div className="ml-4 py-1">
                      <button
                        type="button"
                        onClick={() => iniciarCrear("departamento", zona.id)}
                        className="rounded-lg border-2 border-dashed border-accent/60 bg-accent/5 px-3 py-2 text-xs font-bold text-accent hover:bg-accent/15"
                      >
                        + Crear labor en «{zona.nombre}» (sin subzona)
                      </button>
                    </div>
                  )}
                  {subzonas.map(({ subzona, departamentos }) => (
                    <div key={subzona.id}>
                      {filaZona(subzona, {
                        reinoNombre: reino.nombre,
                        zonaNombre: zona.nombre,
                        indent: "subzona",
                      })}
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
                        <div className="ml-8 py-1">
                          <button
                            type="button"
                            onClick={() => iniciarCrear("departamento", subzona.id)}
                            className="rounded-lg border-2 border-dashed border-accent/60 bg-accent/5 px-3 py-2 text-xs font-bold text-accent hover:bg-accent/15"
                          >
                            + Crear departamento en «{subzona.nombre}»
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Login
function LoginView({ onLogin }: { onLogin: (token: string, user: TicketsUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/tickets/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      onLogin(data.token, data.usuario);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-paper border-2 border-border bg-surface-panel p-8 shadow-paper">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white text-2xl font-black shadow-[0_4px_0_#045159]">
            🎫
          </div>
          <h2 className="text-xl font-extrabold text-ink">Centro de Mando</h2>
          <p className="mt-1 text-sm text-muted">Ingresa con tus credenciales</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Usuario</label>
            <input
              className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent"
              value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="username" autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Contraseña</label>
            <input
              type="password"
              className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && <p className={ALERT_ERROR_SM}>{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full rounded-paper border-2 border-accent bg-accent py-2.5 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-muted">
          Usuario por defecto: <code className="rounded bg-surface-hover px-1 font-mono">admin</code> / <code className="rounded bg-surface-hover px-1 font-mono">admin123</code>
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
  tickets: Ticket[];
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
  if (zonaId == null) {
    return { reinoId: "", zonaId: "", subzonaId: "", departamentoId: "" };
  }
  const byId = new Map(zonas.map((z) => [z.id, z]));
  const chain: ZonaTrabajo[] = [];
  let cur = byId.get(zonaId);
  for (let i = 0; i < 8 && cur; i++) {
    chain.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  if (chain.length === 0) {
    return { reinoId: "", zonaId: "", subzonaId: "", departamentoId: "" };
  }
  if (chain.length === 1) {
    return { reinoId: chain[0].id, zonaId: "", subzonaId: "", departamentoId: "" };
  }
  if (chain.length === 2) {
    return { reinoId: chain[0].id, zonaId: chain[1].id, subzonaId: "", departamentoId: "" };
  }
  if (chain.length === 3) {
    return {
      reinoId: chain[0].id,
      zonaId: chain[1].id,
      subzonaId: chain[2].id,
      departamentoId: "",
    };
  }
  return {
    reinoId: chain[0].id,
    zonaId: chain[1].id,
    subzonaId: chain[2].id,
    departamentoId: chain[3].id,
  };
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
  const zonasDelReino = reinoId !== "" ? zonas.filter((z) => z.parent_id === reinoId) : [];
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
            required
          >
            <option value="">— Elegir —</option>
            {reinos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.icono || "🏰"} {r.nombre}
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
              onChange({ reinoId, zonaId: id, subzonaId: "", departamentoId: "" });
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
              onChange({ reinoId, zonaId, subzonaId: id, departamentoId: "" });
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
            disabled={subzonaId === ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              onChange({ reinoId, zonaId, subzonaId, departamentoId: id });
            }}
            required={departamentos.length > 0}
          >
            <option value="">
              {subzonaId === ""
                ? "Primero la subzona"
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
        <p className="text-[11px] font-semibold text-accent">
          Se asignará a: {labelEfectivo}
        </p>
      )}
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
      className="quest-sticky quest-sticky-solo w-full"
      style={{
        transform: `rotate(${rot}deg)`,
        background: dark
          ? `linear-gradient(168deg, ${accent}28 0%, rgb(32 40 42) 50%, rgb(28 36 38) 100%)`
          : `linear-gradient(168deg, ${accent}32 0%, #fffef8 45%, #fff9e0 100%)`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "rotate(0deg) scale(1.02)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = `rotate(${rot}deg)`; }}
    >
      <span className="quest-sticky-tape" aria-hidden />
      <div className="flex items-start gap-2">
        <StatusOrb estado={t.estado} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-extrabold leading-snug text-ink">{t.titulo}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] font-bold text-muted">{t.numero}</span>
            <CategoriaBadge cat={t.categoria} />
          </div>
        </div>
        <PrioridadDot p={t.prioridad} />
      </div>
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

function MisionGroupCard({
  group, onSelect, onEditMision, onDeleteMision, canDelete, deleting,
}: {
  group: MisionGroup;
  onSelect: (id: number) => void;
  onEditMision: (id: number) => void;
  onDeleteMision?: (group: MisionGroup) => void;
  canDelete?: boolean;
  deleting?: boolean;
}) {
  const dark = useQuestTheme((s) => s.dark);
  const isSeq = group.mision_tipo === "secuencial";
  const done = ["resuelto", "rechazado"];
  const resolved = group.tickets.filter((t) => t.estado === "resuelto").length;
  const total = group.tickets.length;
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
  const isComplete = resolved === total && total > 0;
  const c = group.mision_color;
  const rot = stickyRotation(group.mision_id);

  const visible = isSeq
    ? group.tickets.filter((t) => !t.bloqueado_por && !done.includes(t.estado))
    : group.tickets.filter((t) => !done.includes(t.estado));

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
      className="quest-sticky quest-sticky-mission"
      style={stickyStyle}
      onMouseEnter={onStickyEnter}
      onMouseLeave={onStickyLeave}
    >
      <span className="quest-sticky-tape" aria-hidden />

      {canDelete && onDeleteMision && (
        <button
          type="button"
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteMision(group);
          }}
          title="Eliminar misión"
          aria-label="Eliminar misión"
          className="quest-sticky-close"
        >
          {deleting ? "…" : "×"}
        </button>
      )}

      <div className={`mb-2 flex items-start gap-2 pr-6 ${QUEST_MISION_CHROME}`}>
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-black text-white shadow-sm dark:opacity-85"
          style={{ background: c }}
        >
          {isSeq ? "🔗" : "⚡"}
        </div>
        <button
          type="button"
          onClick={() => onEditMision(group.mision_id)}
          className="min-w-0 flex-1 text-left transition hover:opacity-90"
          title="Editar misión"
        >
          <h4 className="line-clamp-2 text-[15px] font-extrabold leading-tight tracking-tight" style={{ color: c }}>
            {group.mision_titulo}
          </h4>
          <p className="mt-0.5 text-[10px] font-semibold text-muted">
            {isSeq ? "Secuencial" : "Paralelo"} · {total} etapa{total !== 1 ? "s" : ""}
            {(group.ubicacion_label || group.reino) && (
              <span className="block truncate text-[9px] font-medium text-accent/90">
                📍 {group.ubicacion_label || group.reino}
              </span>
            )}
            {isComplete && (
              <span className="ml-1.5 font-bold text-green-700 dark:text-green-500/70">✓ lista</span>
            )}
          </p>
        </button>
        <div className="shrink-0 text-right">
          <div className="text-xl font-black leading-none" style={{ color: c }}>
            {pct}<span className="text-xs font-bold">%</span>
          </div>
          <span className="text-[9px] font-bold text-muted">{resolved}/{total}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onEditMision(group.mision_id)}
        className="mb-3 w-full"
        title="Progreso de la misión"
      >
        <div
          className="h-2 overflow-hidden rounded-full border border-black/5 dark:border-white/10"
          style={{ background: dark ? `${c}22` : `${c}18` }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: dark ? `${c}bb` : `linear-gradient(90deg, ${c}cc, ${c})`,
            }}
          />
        </div>
      </button>

      {visible.length > 0 ? (
        <div className="flex flex-col gap-2">
          {visible.map((t) => {
            const taskRot = stickyRotation(t.id) * 0.35;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t.id)}
                className="quest-sticky-task"
                style={{ transform: `rotate(${taskRot}deg)` }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "rotate(0deg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = `rotate(${taskRot}deg)`; }}
              >
                <StatusOrb estado={t.estado} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-ink">{t.titulo}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <span className="font-mono text-[9px] text-muted">{t.numero}</span>
                    {isSeq && total > 1 && (
                      <span className="text-[9px] font-semibold text-muted">
                        Etapa {group.tickets.findIndex((x) => x.id === t.id) + 1}/{total}
                      </span>
                    )}
                  </div>
                </div>
                <PrioridadDot p={t.prioridad} />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="py-1 text-center text-[11px] font-medium text-muted">
          {isComplete ? "✅ Todas las etapas completadas" : "Sin etapas activas"}
        </p>
      )}

      <button
        type="button"
        onClick={() => onEditMision(group.mision_id)}
        className="mt-3 w-full rounded-md border border-dashed border-black/10 py-1 text-[10px] font-bold text-muted transition hover:border-accent hover:text-accent dark:border-white/15"
      >
        ✏️ Editar misión
      </button>
    </article>
  );
}

function ReinoBoardSectionBlock({
  section,
  onSelect,
  onEditMision,
  onDeleteMision,
  canDelete,
  deletingMisionId,
}: {
  section: TableroReinoSection;
  onSelect: (id: number) => void;
  onEditMision: (id: number) => void;
  onDeleteMision?: (group: MisionGroup) => void;
  canDelete?: boolean;
  deletingMisionId?: number | null;
}) {
  const totalQuests =
    section.groups.reduce((n, g) => n + g.tickets.length, 0) + section.standalone.length;
  const totalMisiones = section.groups.length;

  return (
    <section
      className="quest-board-reino"
      style={{ borderColor: `${section.color}55`, ["--reino-accent" as string]: section.color }}
    >
      <header
        className="quest-board-reino-header"
        style={{
          borderLeftColor: section.color,
          background: `linear-gradient(90deg, ${section.color}22 0%, transparent 72%)`,
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base shadow-sm"
            style={{ background: section.color, color: "#fff" }}
          >
            {section.icono || "🏰"}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-extrabold uppercase tracking-wide text-ink">
              {section.nombre}
            </h3>
            <p className="text-[10px] font-semibold text-muted">
              {totalMisiones} misión{totalMisiones !== 1 ? "es" : ""}
              {totalQuests > 0 && (
                <span> · {totalQuests} quest{totalQuests !== 1 ? "s" : ""}</span>
              )}
            </p>
          </div>
        </div>
      </header>
      <div className="quest-board-cork quest-board-cork--nested p-4 sm:p-5">
        {totalMisiones === 0 && section.standalone.length === 0 ? (
          <p className="py-6 text-center text-xs font-medium text-muted">
            Sin misiones activas en este reino
          </p>
        ) : (
          <div className="quest-sticky-grid">
            {section.groups.map((group) => (
              <MisionGroupCard
                key={group.mision_id}
                group={group}
                onSelect={onSelect}
                onEditMision={onEditMision}
                onDeleteMision={onDeleteMision}
                canDelete={canDelete}
                deleting={deletingMisionId === group.mision_id}
              />
            ))}
            {section.standalone.map((t) => (
              <TicketCard key={t.id} t={t} onClick={() => onSelect(t.id)} />
            ))}
          </div>
        )}
      </div>
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
  token, user, onSelect, onEditMision, navScope,
}: {
  token: string; user: TicketsUser;
  onSelect: (id: number) => void;
  onEditMision: (id: number) => void;
  navScope: NavScope;
}) {
  const questDark = useQuestTheme((s) => s.dark);
  const { cats: categorias } = useContext(CategoriasCtx);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [zonasReinos, setZonasReinos] = useState<ZonaTrabajo[]>([]);
  const [misionesActivas, setMisionesActivas] = useState<Mision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [deletingMisionId, setDeletingMisionId] = useState<number | null>(null);

  const nivel = user.rol?.nivel ?? 1;
  const canDeleteMision = nivel >= 3;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filtroEstado) params.set("estado", filtroEstado);
      if (filtroCategoria) params.set("categoria", filtroCategoria);
      const [data, zonas, misiones] = await Promise.all([
        tapi(`/?${params}`, token),
        tapi("/zonas-trabajo", token),
        tapi("/misiones/", token),
      ]);
      setTickets(data);
      setZonasReinos(zonas);
      setMisionesActivas(
        (misiones as Mision[]).filter((m) => m.estado === "activa" || m.estado === "borrador"),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, filtroEstado, filtroCategoria]);

  useEffect(() => { load(); }, [load]);

  const scopeActivo = navScope.kind !== "all";
  const ticketsVisibles = tickets.filter(
    (t) => navScope.kind === "all" || !t.mision_id || (
      t.mision_zona_id != null
        ? misionZonaEnScope(t.mision_zona_id, zonasReinos, navScope)
        : misionCoincideScope(t.mision_reino, navScope)
    ),
  );
  const ticketsFiltered = ticketsVisibles.filter((t) => {
    if (filtroEstado && t.estado !== filtroEstado) return false;
    if (filtroCategoria && t.categoria !== filtroCategoria) return false;
    return true;
  });
  const hasFilters = !!(filtroEstado || filtroCategoria || scopeActivo);
  const vistaAgrupada = !filtroEstado && !filtroCategoria;

  // Group tickets by mission when no estado/categoría filters
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
  }

  const reinoSections = vistaAgrupada
    ? buildTableroReinoSections(misionGroups, standalone, zonasReinos, navScope)
    : groupTicketsFlatByReino(ticketsFiltered, zonasReinos, navScope);

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
    <div className="space-y-5">
      {/* ── Daily Quest header ── */}
      <div className="quest-board-banner mb-1">
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">📌 Tablero de Quests</h2>
        <p className="text-sm text-muted mt-0.5">
          Misiones agrupadas por reino en notas adhesivas — pasa el cursor para enderezarlas.
        </p>
        <p className="text-xs text-muted/80 mt-1">
          {user.nombre} · <span className="font-bold text-accent quest-board-accent-count">{ticketsVisibles.length}</span> quest{ticketsVisibles.length !== 1 ? "s" : ""} activa{ticketsVisibles.length !== 1 ? "s" : ""}
          {scopeActivo && (
            <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
              {navScopeLabel(navScope)}
            </span>
          )}
        </p>
      </div>
      {/* ── Quest Log stats ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {QUEST_STAT_ITEMS.map((s) => {
          const val = stats[s.key];
          const valueColor = questTone(s.color, s.colorDark, questDark);
          const borderColor = questDark ? s.borderDark : s.color + "55";
          return (
            <div key={s.label} className="quest-stat-card rounded-xl border-2 p-3 text-center bg-surface-panel shadow-sm"
              style={{ borderColor }}>
              <div className="quest-stat-value text-2xl font-black" style={{ color: valueColor }}>{val}</div>
              <div className="text-[11px] font-bold text-muted mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}
          className="rounded-xl border-2 border-border bg-surface-input px-3 py-1.5 text-sm text-ink outline-none focus:border-accent">
          <option value="">Todos los estados</option>
          <option value="pendiente">⏳ Pendiente</option>
          <option value="en_proceso">⚔️ En proceso</option>
          <option value="esperando_aprobacion">🔔 Esperando revisión</option>
          <option value="resuelto">✅ Resuelto</option>
          <option value="rechazado">❌ Rechazado</option>
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}
          className="rounded-xl border-2 border-border bg-surface-input px-3 py-1.5 text-sm text-ink outline-none focus:border-accent">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.slug} value={c.slug}>{c.icono} {c.nombre}</option>
          ))}
        </select>
        <button onClick={load}
          className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent"
          title="Actualizar">
          ↻
        </button>
        {hasFilters && (
          <button onClick={() => { setFiltroEstado(""); setFiltroCategoria(""); }}
            className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-danger hover:text-danger">
            ✕ Limpiar
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Cargando...</div>
      ) : error ? (
        <div className={ALERT_ERROR}>{error}</div>
      ) : ticketsFiltered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">
          {scopeActivo ? `No hay quests en ${navScopeLabel(navScope)}.` : "No hay tickets con estos filtros."}
        </div>
      ) : reinoSections.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">
          {scopeActivo
            ? `No hay misiones en ${navScopeLabel(navScope)}.`
            : "No hay misiones en el tablero. Crea reinos en 🏰 Reinos y vincula la ubicación al crear la misión."}
        </div>
      ) : (
        <div className="quest-board-by-reinos space-y-6">
          {reinoSections.map((section) => (
            <ReinoBoardSectionBlock
              key={section.key}
              section={section}
              onSelect={onSelect}
              onEditMision={onEditMision}
              onDeleteMision={canDeleteMision ? handleDeleteMision : undefined}
              canDelete={canDeleteMision}
              deletingMisionId={deletingMisionId}
            />
          ))}
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
          ← Volver
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
        <div className="grid grid-cols-2 gap-4">
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

// Ticket detail — read-only board view (execution only: step timers + checkboxes)
function TicketDetailView({
  token, ticketId, onBack,
}: {
  token: string; user: TicketsUser; ticketId: number; onBack: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showComentarios, setShowComentarios] = useState(false);
  const [completandoTicket, setCompletandoTicket] = useState(false);

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
      await tapi(`/${ticketId}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "resuelto" }),
      });
      await reload();
    } catch { /* estado incorrecto u otro error — ignorar silenciosamente */ }
    finally { setCompletandoTicket(false); }
  }

  if (loading) return <div className="py-16 text-center text-sm text-muted">Cargando quest...</div>;
  if (error || !ticket) return (
    <div className="space-y-3">
      <button onClick={onBack} className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition">← Tablero</button>
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || "No encontrado"}</div>
    </div>
  );

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack}
          className="rounded-xl border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ← Tablero
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
        <span className="ml-auto rounded-full bg-surface-hover border border-border px-2.5 py-0.5 text-[10px] font-bold text-muted">
          👁 Solo visualización
        </span>
      </div>

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

      {/* Pasos — ejecución: timer + checkbox activos, sin edición */}
      {completandoTicket && (
        <div className="rounded-xl border-2 border-green-400 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
          ✅ Todos los pasos completados — marcando ticket como resuelto...
        </div>
      )}
      <PasosSection
        ticketId={ticket.id}
        token={token}
        editMode={false}
        onAllComplete={ticket.estado === "en_proceso" ? handleAllPasosComplete : undefined}
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
    </div>
  );
}

// Admin: Users, Roles, Departments
function AdminView({ token, onBack }: { token: string; onBack: () => void }) {
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
      setUsuarios(us);
      setRoles(rs);
      setDepts(ds);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  function openModal(type: typeof modal, item: any = null) {
    setModal(type);
    setEditItem(item);
    setError("");
    setForm(item ? { ...item, password: "" } : { activo: 1, color: "#0c6069", nivel: 1 });
  }

  async function saveUser() {
    if (!form.nombre || !form.username || (!editItem && !form.password) || !form.rol_id || !form.departamento_id) {
      setError("Todos los campos son requeridos"); return;
    }
    setSaving(true);
    try {
      if (editItem) {
        await tapi(`/usuarios/${editItem.id}`, token, { method: "PUT", body: JSON.stringify(form) });
      } else {
        await tapi("/usuarios", token, { method: "POST", body: JSON.stringify(form) });
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
        <button onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">← Volver</button>
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
                <label className="mb-1 block text-xs font-bold text-muted">Ícono (emoji)</label>
                <input
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="ej: 🏭"
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
                      {catForm.icono} {catForm.nombre}
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
                  <span className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
                    style={{ background: c.color + "22" }}>
                    {c.icono}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-ink">{c.nombre}</p>
                    <p className="text-xs font-mono text-muted">{c.slug}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: c.color + "22", color: c.color }}>
                    {c.icono} {c.nombre}
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
                <Field label="Nombre completo" value={form.nombre || ""} onChange={(v) => setForm({ ...form, nombre: v })} />
                <Field label="Username" value={form.username || ""} onChange={(v) => setForm({ ...form, username: v })} />
                <Field label={editItem ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña"} type="password" value={form.password || ""} onChange={(v) => setForm({ ...form, password: v })} />
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted">Rol</label>
                  <select value={form.rol_id || ""} onChange={(e) => setForm({ ...form, rol_id: parseInt(e.target.value) })}
                    className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent">
                    <option value="">Seleccionar...</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted">Departamento</label>
                  <select value={form.departamento_id || ""} onChange={(e) => setForm({ ...form, departamento_id: parseInt(e.target.value) })}
                    className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent">
                    <option value="">Seleccionar...</option>
                    {depts.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                  </select>
                </div>
                {editItem && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.activo === 1} onChange={(e) => setForm({ ...form, activo: e.target.checked ? 1 : 0 })} />
                    <span className="font-semibold text-ink">Usuario activo</span>
                  </label>
                )}
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

interface Paso {
  id: number; ticket_id: number; orden: number; descripcion: string;
  completado: number; completado_en: string | null; completado_por_nombre: string | null;
}

function PasosSection({ ticketId, token, editMode = true, onAllComplete }: {
  ticketId: number; token: string; editMode?: boolean;
  onAllComplete?: () => Promise<void>;
}) {
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [saving, setSaving] = useState(false);
  const dragIdx = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Cronómetro por paso
  const [timerPasoId, setTimerPasoId] = useState<number | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const timerStartRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tapi(`/${ticketId}/pasos`, token).then(setPasos).catch(() => {});
  }, [ticketId, token]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  function fmtTimer(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function startTimer(pasoId: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    const start = Date.now();
    timerStartRef.current = start;
    setTimerPasoId(pasoId);
    setTimerElapsed(0);
    timerRef.current = setInterval(() => {
      setTimerElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
  }

  async function stopTimer(pasoId: number, capturedElapsed?: number) {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const elapsed = capturedElapsed ?? timerElapsed;
    const pasoDesc = pasos.find((p) => p.id === pasoId)?.descripcion ?? "";
    setTimerPasoId(null);
    timerStartRef.current = null;
    setTimerElapsed(0);
    if (elapsed >= 1) {
      const horas = elapsed / 3600;
      try {
        await tapi(`/${ticketId}/tiempo`, token, {
          method: "POST",
          body: JSON.stringify({ horas, notas: `Paso: ${pasoDesc.slice(0, 60)}` }),
        });
      } catch { /* silent — tiempo guardado en segundo plano */ }
    }
  }

  async function add() {
    if (!nuevo.trim()) return;
    setSaving(true);
    try {
      const res = await tapi(`/${ticketId}/pasos`, token, {
        method: "POST", body: JSON.stringify({ descripcion: nuevo }),
      });
      setPasos(res); setNuevo("");
    } finally { setSaving(false); }
  }

  async function toggle(id: number) {
    // Auto-stop timer for this paso before completing so the time is saved
    if (timerPasoId === id) {
      await stopTimer(id, Math.floor((Date.now() - (timerStartRef.current ?? Date.now())) / 1000));
    }
    const res: Paso[] = await tapi(`/pasos/${id}/completar`, token, { method: "POST" });
    setPasos(res);
    if (onAllComplete && res.length > 0 && res.every((p) => p.completado)) {
      await onAllComplete();
    }
  }

  async function del(id: number) {
    const res = await tapi(`/pasos/${id}`, token, { method: "DELETE" });
    setPasos(res);
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
    setPasos(res);
  }

  const completados = pasos.filter((p) => p.completado).length;
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
      {pasos.length > 0 && (
        <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: pct === 100 ? "#16a34a" : "#0c6069" }} />
        </div>
      )}
      <div className="space-y-2">
        {pasos.map((p, i) => {
          const isRunning = timerPasoId === p.id;
          return (
            <div key={p.id}
              draggable={editMode}
              onDragStart={editMode ? () => { dragIdx.current = i; } : undefined}
              onDragOver={editMode ? (e) => { e.preventDefault(); setDragOver(i); } : undefined}
              onDragLeave={editMode ? () => setDragOver(null) : undefined}
              onDrop={editMode ? () => drop(i) : undefined}
              onDragEnd={editMode ? () => { dragIdx.current = null; setDragOver(null); } : undefined}
              className={`flex items-center gap-2 rounded-paper border px-3 py-2.5 transition
                ${p.completado ? "border-green-200 bg-green-50"
                  : isRunning ? "border-blue-300 bg-blue-50"
                  : "border-border bg-surface"}
                ${editMode && dragOver === i ? "opacity-50 border-dashed border-accent" : ""}`}
            >
              {editMode && (
                <span className="cursor-grab text-muted opacity-40 hover:opacity-70 select-none shrink-0">⠿</span>
              )}
              <button onClick={() => toggle(p.id)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition
                  ${p.completado ? "border-green-500 bg-green-500 text-white" : "border-border bg-white hover:border-accent"}`}>
                {p.completado && (
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className={`flex-1 text-sm ${p.completado ? "line-through text-muted" : "text-ink"}`}>
                {p.descripcion}
              </span>
              {p.completado_por_nombre && (
                <span className="text-xs text-muted shrink-0">👤 {p.completado_por_nombre}</span>
              )}
              {/* Cronómetro por paso */}
              {!p.completado && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {isRunning && (
                    <span className="font-mono text-xs font-bold text-blue-600 min-w-[46px] text-right">
                      {fmtTimer(timerElapsed)}
                    </span>
                  )}
                  <button
                    onClick={() => isRunning ? stopTimer(p.id) : startTimer(p.id)}
                    title={isRunning ? "Detener — guarda el tiempo automáticamente" : "Iniciar cronómetro"}
                    disabled={timerPasoId !== null && !isRunning}
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition
                      ${isRunning
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : timerPasoId !== null
                          ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                          : "border border-border bg-surface text-muted hover:border-accent hover:text-accent"}`}
                  >
                    {isRunning ? "⏹" : "▶"}
                  </button>
                </div>
              )}
              {editMode && (
                <button onClick={() => del(p.id)} className="text-xs text-muted hover:text-danger transition shrink-0 px-0.5">✕</button>
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
          <button onClick={add} disabled={saving || !nuevo.trim()}
            className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
            + Añadir
          </button>
        </div>
      )}
    </div>
  );
}

// ── MATERIALES ────────────────────────────────────────────────────────────────

type MaterialTipo = "materia_prima" | "elaborado" | "consumibles" | "repuestos" | "herramientas";

const UNIDADES_MATERIAL = ["kg", "g", "mg", "L", "mL", "unidad", "m", "cm", "m²", "m³", "caja", "bolsa", "rollo", "galón"];

function emptyNuevoMaterialForm() {
  return { nombre: "", tipo: "consumibles" as MaterialTipo, unidad: "unidad", cantidad: "", stock_actual: "0", notas: "" };
}

function materialTipoPrefix(tipo?: string) {
  if (tipo === "elaborado") return "✨ ";
  if (tipo === "consumibles") return "📦 ";
  if (tipo === "repuestos") return "🔩 ";
  if (tipo === "herramientas") return "🔧 ";
  return "";
}

function BadgeTipoMaterial({ tipo }: { tipo?: string }) {
  if (!tipo || tipo === "materia_prima") return null;
  const cfg = TIPO_MATERIAL_BADGE[tipo];
  if (!cfg) return null;
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${cfg.className}`}>
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
}: {
  zonas: ZonaTrabajo[];
  selected: number[];
  onChange: (ids: number[]) => void;
  readonly?: boolean;
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
  const chip = (z: ZonaTrabajo, indent?: boolean) => {
    const on = selected.includes(z.id);
    return (
      <label
        key={z.id}
        className={`flex cursor-pointer items-center gap-1.5 rounded-paper border-2 px-2.5 py-1.5 text-xs font-semibold transition ${
          on ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"
        } ${indent ? "ml-4" : ""} ${readonly ? "cursor-default opacity-80" : ""}`}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-accent"
          checked={on}
          disabled={readonly}
          onChange={() => toggle(z.id)}
        />
        <span className={on ? "text-accent" : "text-ink"}>{zonaLabel(z)}</span>
      </label>
    );
  };
  return (
    <div className="space-y-2">
      {raices.map((z) => (
        <div key={z.id} className="space-y-1.5">
          {chip(z)}
          {hijos(z.id).map((h) => chip(h, true))}
        </div>
      ))}
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
                      {materialTipoPrefix(m.tipo)}{m.nombre} ({m.unidad})
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
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className="mb-1 block text-[10px] font-bold text-muted">Nombre *</label>
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

function InventarioView({ token, user, navScope }: { token: string; user: TicketsUser; navScope: NavScope; onBack?: () => void }) {
  const [materiales, setMateriales] = useState<Material[]>([]);
  const [zonas, setZonas] = useState<ZonaTrabajo[]>([]);
  const [showNuevo, setShowNuevo] = useState(false);
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
  const nivel = user.rol?.nivel ?? 1;
  const canManageStock = nivel >= 2;

  const reload = useCallback(async () => {
    const [mats, zs] = await Promise.all([
      tapi("/materiales", token),
      tapi("/zonas-trabajo", token),
    ]);
    setMateriales(mats);
    setZonas(zs);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

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

  function toggleSelectAllStock() {
    if (selectedIds.size === materiales.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(materiales.map((m) => m.id)));
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
  const materialesVisibles = zonaIdsFiltro
    ? materiales.filter((m) => (m.zonas || []).some((z) => zonaIdsFiltro.includes(z.id)))
    : materiales;

  const formNuevoMaterial = (
    <div className="rounded-paper border-2 border-accent/50 bg-surface-panel p-5 space-y-4">
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Nuevo material o insumo</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Nombre *</label>
          <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Tipo</label>
          <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
            <option value="materia_prima">🧱 Materia prima</option>
            <option value="elaborado">✨ Producto elaborado</option>
            <option value="consumibles">📦 Consumibles / insumo</option>
            <option value="repuestos">🔩 Repuestos</option>
            <option value="herramientas">🔧 Herramientas</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Unidad</label>
          <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={form.unidad} onChange={(e) => setForm((f) => ({ ...f, unidad: e.target.value }))}>
            {UNIDADES_MATERIAL.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Stock inicial</label>
          <input type="number" min="0" step="any"
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={form.stock_actual} onChange={(e) => setForm((f) => ({ ...f, stock_actual: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Stock mínimo (alerta)</label>
          <input type="number" min="0" step="any"
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={form.stock_minimo} onChange={(e) => setForm((f) => ({ ...f, stock_minimo: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Precio unitario ($)</label>
          <input type="number" min="0" step="any"
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={form.precio_unitario} onChange={(e) => setForm((f) => ({ ...f, precio_unitario: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Proveedor</label>
          <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={form.proveedor} onChange={(e) => setForm((f) => ({ ...f, proveedor: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Descripción</label>
          <textarea rows={2} className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent resize-none"
            value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Zonas de trabajo</label>
          <ZonasPicker zonas={zonas} selected={formZonaIds} onChange={setFormZonaIds} />
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
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-ink">Inventario</h2>
          <p className="text-xs text-muted">
            {materialesVisibles.length} material{materialesVisibles.length !== 1 ? "es" : ""} e insumo{materialesVisibles.length !== 1 ? "s" : ""}
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

      {showNuevo && canManageStock && formNuevoMaterial}

      <div className="space-y-3">
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
          {materialesVisibles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {navScope.kind !== "all" ? `No hay materiales en ${navScopeLabel(navScope)}.` : "No hay materiales en el catálogo aún."}
            </p>
          ) : materialesVisibles.map((m) => {
            const pct = m.stock_minimo > 0 ? Math.min(100, Math.round((m.stock_actual / m.stock_minimo) * 100)) : 100;
            const bajo = m.stock_minimo > 0 && m.stock_actual < m.stock_minimo;
            const editando = editId === m.id;

            if (editando && nivel >= 2) {
              return (
                <div key={m.id} className="rounded-paper border-2 border-accent bg-surface-panel p-4 shadow-paper-sm space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-extrabold text-accent">✏️ Editar material</h3>
                    <button type="button" onClick={() => setEditId(null)}
                      className="text-xs font-bold text-muted hover:text-ink">Cancelar</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs font-bold text-muted">Nombre *</label>
                      <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                        value={editForm.nombre} onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-muted">Tipo</label>
                      <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                        value={editForm.tipo} onChange={(e) => setEditForm((f) => ({ ...f, tipo: e.target.value as MaterialTipo }))}>
                        <option value="materia_prima">🧱 Materia prima</option>
                        <option value="elaborado">✨ Producto elaborado</option>
                        <option value="consumibles">📦 Consumibles</option>
                        <option value="repuestos">🔩 Repuestos</option>
                        <option value="herramientas">🔧 Herramientas</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-muted">Unidad</label>
                      <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                        value={editForm.unidad} onChange={(e) => setEditForm((f) => ({ ...f, unidad: e.target.value }))}>
                        {["kg","g","mg","L","mL","unidad","m","cm","m²","m³","caja","bolsa","rollo","galón"].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-muted">Stock actual</label>
                      <input type="number" min="0" step="any"
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                        value={editForm.stock_actual} onChange={(e) => setEditForm((f) => ({ ...f, stock_actual: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-muted">Stock mínimo</label>
                      <input type="number" min="0" step="any"
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                        value={editForm.stock_minimo} onChange={(e) => setEditForm((f) => ({ ...f, stock_minimo: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-muted">Precio unitario ($)</label>
                      <input type="number" min="0" step="any"
                        className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                        value={editForm.precio_unitario} onChange={(e) => setEditForm((f) => ({ ...f, precio_unitario: e.target.value }))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-muted">Proveedor</label>
                      <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                        value={editForm.proveedor} onChange={(e) => setEditForm((f) => ({ ...f, proveedor: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs font-bold text-muted">Descripción</label>
                      <textarea rows={2} className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent resize-none"
                        value={editForm.descripcion} onChange={(e) => setEditForm((f) => ({ ...f, descripcion: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs font-bold text-muted">Zonas de trabajo</label>
                      <ZonasPicker zonas={zonas} selected={editZonaIds} onChange={setEditZonaIds} />
                    </div>
                  </div>
                  {editForm.tipo === "elaborado" && (
                    <p className="text-xs text-purple-600">El stock también puede actualizarse al completar la misión vinculada.</p>
                  )}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setEditId(null)}
                      className="rounded-paper border-2 border-border px-4 py-2 text-xs font-bold text-muted hover:bg-surface-hover">
                      Cancelar
                    </button>
                    <button type="button" onClick={guardarEdicion} disabled={saving || !editForm.nombre.trim()}
                      className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover disabled:opacity-50">
                      {saving ? "Guardando..." : "✓ Guardar cambios"}
                    </button>
                  </div>
                </div>
              );
            }

            const seleccionado = selectedIds.has(m.id);

            return (
              <div key={m.id} className={`rounded-paper border-2 bg-surface-panel p-4 shadow-paper-sm ${bajo ? "border-red-300" : seleccionado ? "border-accent/60 ring-1 ring-accent/30" : "border-border"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  {canManageStock && (
                    <label className="flex shrink-0 cursor-pointer items-center pt-0.5" title="Seleccionar para eliminar">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border accent-accent"
                        checked={seleccionado}
                        onChange={() => toggleSelect(m.id)}
                      />
                    </label>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {bajo && <span className="text-sm">{m.stock_actual <= 0 ? "🔴" : "🟡"}</span>}
                      <p className="font-bold text-sm text-ink">{m.nombre}</p>
                      <BadgeTipoMaterial tipo={m.tipo} />
                    </div>
                    <div className="mt-1"><BadgesZonas zonas={m.zonas} compact /></div>
                    {m.proveedor && <p className="text-xs text-muted">Proveedor: {m.proveedor}</p>}
                    {m.descripcion && <p className="text-xs text-muted line-clamp-2">{m.descripcion}</p>}
                    {m.tipo === "elaborado" && <p className="text-xs text-purple-600">Producido internamente</p>}
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    <div className="text-right">
                      <p className={`text-lg font-black ${bajo ? "text-red-600" : "text-ink"}`}>
                        {m.stock_actual} <span className="text-sm font-normal text-muted">{m.unidad}</span>
                      </p>
                      {m.stock_minimo > 0 && <p className="text-xs text-muted">Mín: {m.stock_minimo} {m.unidad}</p>}
                    </div>
                    {nivel >= 2 && (
                      <button type="button" onClick={() => iniciarEdicion(m)}
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
          })}
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
    tipo: "secuencial", color: "#0c6069", frecuencia: "",
  });
  const [ubicacion, setUbicacion] = useState<{
    reinoId: number | "";
    zonaId: number | "";
    subzonaId: number | "";
    departamentoId: number | "";
  }>({ reinoId: "", zonaId: "", subzonaId: "", departamentoId: "" });
  const [etapas, setEtapas] = useState([{ titulo: "", descripcion: "" }]);
  const [asignaciones, setAsignaciones] = useState<Record<number, string>>({});
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [todasMisiones, setTodasMisiones] = useState<Mision[]>([]);
  const [zonasCat, setZonasCat] = useState<ZonaTrabajo[]>([]);
  const [depIds, setDepIds] = useState<number[]>([]);
  const canManageZonas = (user.rol?.nivel ?? 1) >= 2;

  useEffect(() => {
    tapi("/usuarios", token).then(setUsuarios).catch(() => {});
    tapi("/misiones/", token).then(setTodasMisiones).catch(() => {});
    tapi("/zonas-trabajo", token).then(setZonasCat).catch(() => {});
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

  function addEtapa() { setEtapas((e) => [...e, { titulo: "", descripcion: "" }]); }
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
          frecuencia: form.frecuencia || null,
          etapas,
          asignaciones: asignacionesPorOrden,
        }),
      });
      // Add prerequisites sequentially
      for (const depId of depIds) {
        await tapi(`/misiones/${m.id}/dependencias`, token, {
          method: "POST",
          body: JSON.stringify({ depende_de_id: depId }),
        }).catch(() => {});
      }
      onCreated(m.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isSecuencial = form.tipo === "secuencial";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ← Volver
        </button>
        <h2 className="text-xl font-extrabold text-ink">Nueva Misión</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Información general</h3>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Título *</label>
            <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
              placeholder="Nombre de la misión" value={form.titulo} onChange={setF("titulo")} maxLength={150} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Tipo de flujo</label>
              <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                value={form.tipo} onChange={setF("tipo")}>
                <option value="secuencial">🔗 Secuencial — etapas en orden</option>
                <option value="paralelo">⚡ Asíncrono — etapas simultáneas</option>
              </select>
              <p className="mt-1 text-xs text-muted">
                {isSecuencial
                  ? "Cada ticket se desbloquea al completar el anterior."
                  : "Todos los tickets se activan a la vez, sin dependencias."}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Descripción (opcional)</label>
            <textarea className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent resize-none"
              rows={2} placeholder="Objetivo general de la misión..."
              value={form.descripcion} onChange={setF("descripcion")} />
          </div>

          <div className="grid grid-cols-2 gap-4">
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
              <div className="col-span-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Crea primero reinos y zonas en <strong>🏰 Reinos</strong> para vincular la misión.
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={form.color} onChange={setF("color")}
                  className="h-10 w-16 cursor-pointer rounded-paper border-2 border-border p-0.5" />
                <span className="text-sm font-mono text-muted">{form.color}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Recurrencia</label>
            <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
              value={form.frecuencia} onChange={setF("frecuencia")}>
              <option value="">Una sola vez (sin repetición)</option>
              <option value="diaria">♻️ Diaria — se renueva cada día</option>
              <option value="semanal">♻️ Semanal — se renueva cada semana</option>
              <option value="quincenal">♻️ Quincenal — se renueva cada 15 días</option>
              <option value="mensual">♻️ Mensual — se renueva cada mes</option>
              <option value="bimestral">♻️ Bimestral — se renueva cada 2 meses</option>
              <option value="trimestral">♻️ Trimestral — se renueva cada 3 meses</option>
              <option value="semestral">♻️ Semestral — se renueva cada 6 meses</option>
            </select>
            {form.frecuencia && (
              <p className="mt-1 text-xs text-muted">
                Al completarse todos los tickets, la misión se reiniciará automáticamente.
              </p>
            )}
          </div>
        </div>

        {/* Etapas + asignaciones */}
        <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">
                Tickets a generar ({etapas.length})
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                {isSecuencial
                  ? "🔗 Flujo secuencial: cada ticket depende del anterior"
                  : "⚡ Flujo asíncrono: todos los tickets se crean activos simultáneamente"}
              </p>
            </div>
            <button type="button" onClick={addEtapa}
              className="rounded-paper border-2 border-accent px-3 py-1 text-xs font-bold text-accent transition hover:bg-surface-hover">
              + Agregar
            </button>
          </div>

          {etapas.map((et, i) => (
            <div key={i}>
              <div className="rounded-paper border-2 border-border bg-surface p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                      style={{ background: form.color }}>
                      {i + 1}
                    </span>
                    {isSecuencial && i > 0 && (
                      <span className="text-xs font-semibold text-muted">🔒 Bloqueado hasta completar #{i}</span>
                    )}
                    {!isSecuencial && (
                      <span className="text-xs font-semibold text-muted">⚡ Activo desde el inicio</span>
                    )}
                  </div>
                  {etapas.length > 1 && (
                    <button type="button" onClick={() => removeEtapa(i)}
                      className="text-xs font-bold text-muted hover:text-danger transition">
                      Eliminar
                    </button>
                  )}
                </div>
                <input
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder={`Título del ticket ${i + 1} *`}
                  value={et.titulo} onChange={(e) => setEtapa(i, "titulo", e.target.value)} />
                <input
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="Descripción (opcional)"
                  value={et.descripcion} onChange={(e) => setEtapa(i, "descripcion", e.target.value)} />
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  <select
                    value={asignaciones[i + 1] || ""}
                    onChange={(e) => setAsignaciones((a) => ({ ...a, [i + 1]: e.target.value }))}
                    className="flex-1 rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent">
                    <option value="">Sin asignar</option>
                    {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
              </div>
              {isSecuencial && i < etapas.length - 1 && (
                <div className="flex justify-center my-0.5">
                  <div className="h-4 w-0.5 rounded-full opacity-30" style={{ background: form.color }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Misiones prerequisito */}
        {todasMisiones.length > 0 && (
          <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-3">
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Misiones prerequisito (opcional)</h3>
              <p className="mt-1 text-xs text-muted">
                Misiones que deben haberse completado antes de iniciar esta. Solo se muestran misiones existentes.
              </p>
            </div>
            <div className="space-y-1.5">
              {todasMisiones.map((m) => {
                const checked = depIds.includes(m.id);
                return (
                  <label key={m.id} className="flex items-center gap-2.5 cursor-pointer rounded-paper border border-border bg-surface px-3 py-2 hover:border-accent transition">
                    <input type="checkbox" checked={checked}
                      onChange={() => setDepIds((ids) => checked ? ids.filter((x) => x !== m.id) : [...ids, m.id])}
                      className="accent-accent" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{m.titulo}</p>
                      {m.reino && <p className="text-xs text-muted">{m.reino}</p>}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      m.estado === "completada" ? "bg-green-100 text-green-700"
                      : m.estado === "cancelada" ? "bg-red-100 text-red-600"
                      : "bg-blue-100 text-blue-700"
                    }`}>{m.estado}</span>
                  </label>
                );
              })}
            </div>
            {depIds.length > 0 && (
              <p className="text-xs font-semibold text-accent">
                {depIds.length} misión{depIds.length > 1 ? "es" : ""} seleccionada{depIds.length > 1 ? "s" : ""} como prerequisito
              </p>
            )}
          </div>
        )}

        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onBack}
            className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted transition hover:bg-surface-hover">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="rounded-paper border-2 border-accent bg-accent px-6 py-2 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50">
            {loading ? "Creando tickets..." : "✅ Crear Misión y Generar Tickets"}
          </button>
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
  const [metaForm, setMetaForm] = useState({ titulo: "", descripcion: "", color: "", frecuencia: "", estado: "" });
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
  const [depAddId, setDepAddId] = useState("");
  const [depAdding, setDepAdding] = useState(false);

  // Producto resultante
  const [catalogoMateriales, setCatalogoMateriales] = useState<Material[]>([]);
  const [prodSelId, setProdSelId] = useState("");
  const [prodSaving, setProdSaving] = useState(false);
  const [showNuevoProd, setShowNuevoProd] = useState(false);
  const [nuevoProdForm, setNuevoProdForm] = useState({ nombre: "", unidad: "kg" });
  const [nuevoProdSaving, setNuevoProdSaving] = useState(false);

  // Add-ticket inline form
  const [showAddEtapa, setShowAddEtapa] = useState(false);
  const [addForm, setAddForm] = useState({ titulo: "", descripcion: "", asignado_a: "" });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);

  // Drag-and-drop reorder
  const dragIdx = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Configurar pasos/materiales de un ticket inline desde la misión
  const [configurandoTicketId, setConfigurandoTicketId] = useState<number | null>(null);

  const nivel = user.rol?.nivel ?? 1;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const m = await tapi(`/misiones/${misionId}`, token);
      setMision(m);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, misionId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    tapi("/usuarios", token).then(setUsuarios).catch(() => {});
    tapi("/misiones/", token).then(setTodasMisiones).catch(() => {});
    tapi("/materiales?todos=1", token).then(setCatalogoMateriales).catch(() => {});
    tapi("/zonas-trabajo", token).then(setZonasCat).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (mision) {
      setMetaForm({
        titulo: mision.titulo,
        descripcion: mision.descripcion || "",
        color: mision.color || "#0c6069",
        frecuencia: mision.frecuencia || "",
        estado: mision.estado,
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

  async function saveMeta() {
    if (metaZonaIdEfectivo === "") {
      alert("Selecciona al menos el reino.");
      return;
    }
    setMetaSaving(true);
    try {
      const updated = await tapi(`/misiones/${misionId}`, token, {
        method: "PUT",
        body: JSON.stringify({
          ...metaForm,
          zona_id: metaZonaIdEfectivo,
          frecuencia: metaForm.frecuencia || null,
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
      const updated = await tapi(`/misiones/${misionId}/etapas`, token, {
        method: "POST",
        body: JSON.stringify({ ...addForm, asignado_a: addForm.asignado_a || null }),
      });
      setMision(updated);
      setAddForm({ titulo: "", descripcion: "", asignado_a: "" });
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

  if (loading) return <div className="py-16 text-center text-sm text-muted">Cargando misión...</div>;
  if (error || !mision) return (
    <div className="space-y-3">
      <button onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition">← Volver</button>
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Misión no encontrada"}</div>
    </div>
  );

  const pct = mision.total_etapas > 0 ? Math.round((mision.etapas_completadas / mision.total_etapas) * 100) : 0;
  const etapas = mision.etapas || [];
  const isSecuencial = mision.tipo === "secuencial";

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ← Volver
        </button>
        {(mision.departamento_nombre || mision.ubicacion_label) && (
          <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
            🏢 {mision.departamento_nombre || mision.ubicacion_label}
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-semibold text-muted">
          {isSecuencial ? "🔗 Secuencial" : "⚡ Paralelo"}
        </span>
        {mision.frecuencia && (
          <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold">
            {FRECUENCIA_LABEL[mision.frecuencia] ?? mision.frecuencia}
          </span>
        )}
        {mision.estado === "completada" && (
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
                    if (!confirm(`¿Renovar la misión "${mision.titulo}"?\n\nSe eliminarán los tickets actuales y se crearán nuevos. La misión quedará activa.`)) return;
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
                  {renewing ? "Renovando..." : "♻️ Renovar"}
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Recurrencia</label>
              <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                value={metaForm.frecuencia} onChange={(e) => setMetaForm((f) => ({ ...f, frecuencia: e.target.value }))}>
                <option value="">Sin repetición</option>
                <option value="diaria">♻️ Diaria</option>
                <option value="semanal">♻️ Semanal</option>
                <option value="quincenal">♻️ Quincenal</option>
                <option value="mensual">♻️ Mensual</option>
                <option value="bimestral">♻️ Bimestral</option>
                <option value="trimestral">♻️ Trimestral</option>
                <option value="semestral">♻️ Semestral</option>
              </select>
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
            <button onClick={saveMeta} disabled={metaSaving || !metaForm.titulo.trim()}
              className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
              {metaSaving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}

      {/* Header card */}
      <div className="rounded-paper border-2 p-5 shadow-paper" style={{ borderColor: mision.color + "66", background: mision.color + "11" }}>
        <h2 className="text-xl font-extrabold text-ink mb-1">{mision.titulo}</h2>
        {(mision.ubicacion_label || mision.reino) && (
          <p className="text-xs font-semibold text-muted mb-2">
            📍 {mision.ubicacion_label || mision.reino}
          </p>
        )}
        {mision.descripcion && <p className="text-sm text-ink mb-3">{mision.descripcion}</p>}
        {mision.frecuencia && mision.proxima_renovacion && (
          <p className="mb-3 text-xs font-semibold" style={{ color: mision.color }}>
            {mision.estado === "completada"
              ? `⏰ Próxima renovación automática: ${fmtFecha(mision.proxima_renovacion)}`
              : `♻️ Se renovará el ${fmtFecha(mision.proxima_renovacion)} al completarse`}
          </p>
        )}
        <div className="h-2 rounded-full bg-white/60 dark:bg-ink/20 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: mision.color }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs" style={{ color: mision.color }}>
          <span>{mision.etapas_completadas} de {mision.total_etapas} etapas completadas</span>
          <span className="font-bold">{pct}%</span>
        </div>
      </div>

      {/* Misiones prerequisito */}
      {(() => {
        const deps = mision.dependencias ?? [];
        const disponibles = todasMisiones.filter(
          (m) => m.id !== misionId && !deps.find((d) => d.id === m.id)
        );
        return (
          <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-3">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">🔗 Misiones prerequisito</h3>
            {deps.length === 0 ? (
              <p className="text-xs text-muted">Sin prerequisitos — esta misión puede iniciarse en cualquier momento.</p>
            ) : (
              <div className="space-y-1.5">
                {deps.map((dep) => (
                  <div key={dep.id} className="flex items-center gap-2 rounded-paper border border-border bg-surface px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{dep.titulo}</p>
                      {dep.reino && <p className="text-xs text-muted">{dep.reino}</p>}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      dep.estado === "completada" ? "bg-green-100 text-green-700"
                      : dep.estado === "cancelada" ? "bg-red-100 text-red-600"
                      : "bg-blue-100 text-blue-700"
                    }`}>{dep.estado}</span>
                    {!readonly && (
                      <button
                        onClick={async () => {
                          try {
                            const updated = await tapi(`/misiones/${misionId}/dependencias/${dep.id}`, token, { method: "DELETE" });
                            setMision(updated);
                          } catch (e: any) { alert(e.message); }
                        }}
                        className="text-muted hover:text-danger transition text-xs px-1">✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!readonly && disponibles.length > 0 && (
              <div className="flex gap-2">
                <select
                  value={depAddId}
                  onChange={(e) => setDepAddId(e.target.value)}
                  className="flex-1 rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm text-ink outline-none focus:border-accent">
                  <option value="">Agregar prerequisito...</option>
                  {disponibles.map((m) => (
                    <option key={m.id} value={m.id}>{m.titulo}{m.reino ? ` — ${m.reino}` : ""}</option>
                  ))}
                </select>
                <button
                  disabled={!depAddId || depAdding}
                  onClick={async () => {
                    if (!depAddId) return;
                    setDepAdding(true);
                    try {
                      const updated = await tapi(`/misiones/${misionId}/dependencias`, token, {
                        method: "POST",
                        body: JSON.stringify({ depende_de_id: parseInt(depAddId) }),
                      });
                      setMision(updated);
                      setDepAddId("");
                    } catch (e: any) { alert(e.message); }
                    finally { setDepAdding(false); }
                  }}
                  className="rounded-paper border-2 border-accent px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent hover:text-white transition disabled:opacity-50">
                  {depAdding ? "..." : "+ Agregar"}
                </button>
              </div>
            )}
          </div>
        );
      })()}

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
                      <option key={m.id} value={m.id}>{materialTipoPrefix(m.tipo)}{m.nombre} ({m.unidad})</option>
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
                      {etapaLocked && <p className="text-xs opacity-60">Esperando ticket anterior</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {et.ticket_id && et.ticket_numero && (
                        <div className="flex items-center gap-1.5">
                          {et.ticket_estado && (
                            <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-white ${TICKET_DOT[et.ticket_estado] || "bg-gray-400"}`} />
                          )}
                          <button onClick={() => et.ticket_id && onTicket(et.ticket_id)}
                            className="text-xs font-mono font-bold underline underline-offset-2 hover:opacity-70 transition">
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
                      <PasosSection ticketId={et.ticket_id} token={token} editMode={true} />
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
                      {et.ticket_id && et.ticket_numero && (
                        <div className="flex items-center gap-1.5">
                          {et.ticket_estado && (
                            <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-white ${TICKET_DOT[et.ticket_estado] || "bg-gray-400"}`} />
                          )}
                          <button onClick={() => et.ticket_id && onTicket(et.ticket_id)}
                            className="text-xs font-mono font-bold underline underline-offset-2 hover:opacity-70 transition">
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
                  {et.asignado_nombre && <p className="text-xs opacity-75 mt-1 flex items-center gap-1"><span>👤</span>{et.asignado_nombre}</p>}
                  {/* Panel de configuración inline — solo en modo edición */}
                  {!readonly && configurandoTicketId === et.ticket_id && et.ticket_id && (
                    <div className="mt-3 pt-3 border-t border-border space-y-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-accent">⚙️ Configurar</p>
                      <PasosSection ticketId={et.ticket_id} token={token} editMode={true} />
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
function WorkloadView({ token, onBack }: { token: string; onBack: () => void }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tapi("/dashboard/carga", token)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">← Volver</button>
        <h2 className="text-xl font-extrabold text-ink">Aliados</h2>
      </div>
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Cargando...</div>
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
          ← Volver
        </button>
        <h2 className="text-xl font-extrabold text-ink">👤 Mi perfil</h2>
      </div>

      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper-sm space-y-3">
        <div className="flex items-center gap-4">
          <UserAvatar user={user} token={token} size="lg" />
          <div>
            <p className="font-extrabold text-ink">{user.nombre}</p>
            <p className="text-sm text-muted">@{user.username}</p>
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

  const reloadCats = useCallback(() => {
    if (!token) return;
    tapi("/categorias/", token).then(setCategorias).catch(() => {});
  }, [token]);

  useEffect(() => { reloadCats(); }, [reloadCats]);

  useEffect(() => {
    if (!token) return;
    tapi("/materiales", token)
      .then((mats: Material[]) =>
        setBajoStockCount(mats.filter((m) => m.stock_minimo > 0 && m.stock_actual < m.stock_minimo).length),
      )
      .catch(() => {});
  }, [token, view]);

  if (!token || !user) {
    return (
      <div className={`quest-canvas min-h-[60vh] transition-colors duration-200 ${questDark ? "dark" : ""}`}>
        <div className="mb-4 flex justify-end">
          <QuestThemeToggle />
        </div>
        <LoginView
          onLogin={(t, u) => { setAuth(t, u as TicketsUser); setView("list"); }}
        />
      </div>
    );
  }

  const nivel = user.rol?.nivel ?? 1;

  function goDetail(id: number) { setSelectedId(id); setView("detail"); }
  function goBack() { setView("list"); setSelectedId(null); setSelectedMisionId(null); }
  function goMisionDetail(id: number) { setSelectedMisionId(id); setView("mision_detail"); }
  function goTablero() { setNavScope({ kind: "all" }); goBack(); }
  function goInventario() { setView("inventario"); }
  function goReinos() { setView("reinos"); }
  function goWorkload() { setView("workload"); }
  function goPerfil() { setView("perfil"); }
  function goRecetas() { setView("recetas"); }
  function goCreateMision() { setView("crear_mision"); }
  function handleNavScope(scope: NavScope) { setNavScope(scope); }
  function goIrTableroConFiltro() { setView("list"); }
  function goIrInventarioConFiltro() { setView("inventario"); }

  return (
    <CategoriasCtx.Provider value={{ cats: categorias, reload: reloadCats }}>
    <div className={`quest-canvas relative min-h-full transition-colors duration-200 ${questDark ? "dark" : ""}`}>
      {/* Logout + tema */}
      <div className="absolute right-0 top-0 z-30 flex items-center gap-2">
        <QuestThemeToggle />
        <button type="button" onClick={clear}
          className={`${questNavBtn(false, "quest-nav-btn--ghost-danger")} text-xs`}>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Salir ({user.nombre})
        </button>
      </div>

      <div className="pt-8">
        <QuestNavBar
          view={view}
          nivel={nivel}
          bajoStockCount={bajoStockCount}
          onTablero={goTablero}
          onInventario={goInventario}
          onReinos={goReinos}
          onRecetas={goRecetas}
          onWorkload={goWorkload}
          onPerfil={goPerfil}
          onCreateMision={goCreateMision}
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
          <WorkloadView token={token} onBack={goBack} />
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
    </div>
    </CategoriasCtx.Provider>
  );
}
