import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";

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
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Error de servidor");
    return data;
  });
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

const ESTADO_STYLES: Record<string, string> = {
  pendiente:             "bg-yellow-100 text-yellow-800 border-yellow-300",
  en_proceso:            "bg-blue-100 text-blue-800 border-blue-300",
  esperando_aprobacion:  "bg-orange-100 text-orange-800 border-orange-300",
  resuelto:              "bg-green-100 text-green-800 border-green-300",
  rechazado:             "bg-red-100 text-red-700 border-red-300",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente:             "Pendiente",
  en_proceso:            "En Proceso",
  esperando_aprobacion:  "Esperando Aprobación",
  resuelto:              "Resuelto",
  rechazado:             "Rechazado",
};

const CATEGORIA_FALLBACK: Record<string, { label: string; cls: string }> = {
  rrhh:          { label: "RR.HH.",       cls: "bg-amber-100 text-amber-800" },
  logistica:     { label: "Logística",    cls: "bg-teal-100 text-teal-800" },
  mantenimiento: { label: "Mantenimiento", cls: "bg-purple-100 text-purple-800" },
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

const PRIORIDAD_STYLES: Record<string, string> = {
  baja:    "bg-gray-100 text-gray-600",
  media:   "bg-blue-100 text-blue-700",
  alta:    "bg-orange-100 text-orange-700",
  urgente: "bg-red-100 text-red-700",
};

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
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ESTADO_STYLES[estado] || "bg-gray-100 text-gray-600 border-gray-300"}`}>
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
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${fb?.cls ?? "bg-gray-100 text-gray-600"}`}>
      {fb?.label ?? cat}
    </span>
  );
}

function PrioridadBadge({ p }: { p: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${PRIORIDAD_STYLES[p] || "bg-gray-100 text-gray-600"}`}>
      {p}
    </span>
  );
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

type View = "list" | "create" | "detail" | "admin" | "workload" | "misiones" | "crear_mision" | "mision_detail" | "inventario";

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
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
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
  tickets: Ticket[];
}

function TicketCard({ t, onClick }: { t: Ticket; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full rounded-paper border-2 border-border bg-surface-panel p-4 text-left shadow-paper-sm transition hover:border-accent hover:shadow-paper">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold text-muted">{t.numero}</span>
            <CategoriaBadge cat={t.categoria} />
            <PrioridadBadge p={t.prioridad} />
          </div>
          <p className="font-bold text-ink truncate">{t.titulo}</p>
          <p className="mt-0.5 text-xs text-muted">
            {fmtDate(t.creado_en)}
            {t.asignado_a_nombre && ` · 👤 ${t.asignado_a_nombre}`}
          </p>
        </div>
        <EstadoBadge estado={t.estado} />
      </div>
    </button>
  );
}

function MisionGroupCard({
  group, onSelect, onMisionDetail,
}: {
  group: MisionGroup;
  onSelect: (id: number) => void;
  onMisionDetail: (id: number) => void;
}) {
  const isSeq = group.mision_tipo === "secuencial";
  const done = ["resuelto", "rechazado"];
  const resolved = group.tickets.filter((t) => t.estado === "resuelto").length;
  const total = group.tickets.length;
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;

  // Sequential: show only the frontmost active (unblocked, not done)
  // Parallel: show all non-done tickets
  const visible = isSeq
    ? group.tickets.filter((t) => !t.bloqueado_por && !done.includes(t.estado))
    : group.tickets.filter((t) => !done.includes(t.estado));

  const isComplete = resolved === total && total > 0;

  return (
    <div className="rounded-paper border-2 overflow-hidden shadow-paper-sm"
      style={{ borderColor: group.mision_color + "66" }}>
      {/* Mission header */}
      <button
        onClick={() => onMisionDetail(group.mision_id)}
        className="w-full px-4 py-3 text-left transition hover:bg-surface-hover flex items-center gap-3"
        style={{ background: group.mision_color + "0d" }}>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="font-extrabold text-sm" style={{ color: group.mision_color }}>
              🎯 {group.mision_titulo}
            </span>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold text-gray-600 border border-gray-200">
              {isSeq ? "🔗 Secuencial" : "⚡ Paralelo"}
            </span>
            {isComplete && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700 border border-green-300">
                ✅ Completada
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-black/10">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: group.mision_color }} />
            </div>
            <span className="shrink-0 text-xs font-bold" style={{ color: group.mision_color }}>
              {resolved}/{total}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted font-semibold">Ver misión →</span>
      </button>

      {/* Active tickets */}
      {visible.length > 0 ? (
        <div className="border-t divide-y" style={{ borderColor: group.mision_color + "33" }}>
          {visible.map((t) => (
            <button key={t.id} onClick={() => onSelect(t.id)}
              className="w-full px-4 py-3 text-left transition hover:bg-surface-hover flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono font-bold text-muted">{t.numero}</span>
                  <PrioridadBadge p={t.prioridad} />
                  {isSeq && total > 1 && (
                    <span className="text-xs text-muted">
                      Etapa {group.tickets.findIndex((x) => x.id === t.id) + 1}/{total}
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold text-ink truncate">{t.titulo}</p>
                {t.asignado_a_nombre && (
                  <p className="text-xs text-muted">👤 {t.asignado_a_nombre}</p>
                )}
              </div>
              <EstadoBadge estado={t.estado} />
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-2 text-xs text-muted border-t" style={{ borderColor: group.mision_color + "33" }}>
          {isComplete ? "Todos los tickets resueltos" : "Sin etapas activas pendientes"}
        </div>
      )}
    </div>
  );
}

function TicketListView({
  token, user, onSelect, onCreate, onAdmin, onWorkload, onMisiones, onMisionDetail, onInventario,
}: {
  token: string; user: TicketsUser;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onAdmin: () => void;
  onWorkload: () => void;
  onMisiones: () => void;
  onMisionDetail: (id: number) => void;
  onInventario: () => void;
}) {
  const { cats: categorias } = useContext(CategoriasCtx);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [bajoStockCount, setBajoStockCount] = useState(0);

  useEffect(() => {
    tapi("/materiales", token)
      .then((mats: Material[]) => setBajoStockCount(mats.filter((m) => m.stock_minimo > 0 && m.stock_actual < m.stock_minimo).length))
      .catch(() => {});
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filtroEstado) params.set("estado", filtroEstado);
      if (filtroCategoria) params.set("categoria", filtroCategoria);
      const data = await tapi(`/?${params}`, token);
      setTickets(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, filtroEstado, filtroCategoria]);

  useEffect(() => { load(); }, [load]);

  const nivel = user.rol?.nivel ?? 1;
  const hasFilters = !!(filtroEstado || filtroCategoria);

  // Group tickets by mission when no filters active
  const misionGroups = new Map<number, MisionGroup>();
  const standalone: Ticket[] = [];

  if (!hasFilters) {
    for (const t of tickets) {
      if (t.mision_id) {
        if (!misionGroups.has(t.mision_id)) {
          misionGroups.set(t.mision_id, {
            mision_id: t.mision_id,
            mision_titulo: t.mision_titulo || `Misión #${t.mision_id}`,
            mision_color: t.mision_color || "#0c6069",
            mision_tipo: t.mision_tipo || "secuencial",
            tickets: [],
          });
        }
        misionGroups.get(t.mision_id)!.tickets.push(t);
      } else {
        standalone.push(t);
      }
    }
  }

  const stats = {
    pendientes: tickets.filter((t) => t.estado === "pendiente").length,
    en_proceso: tickets.filter((t) => t.estado === "en_proceso").length,
    esperando:  tickets.filter((t) => t.estado === "esperando_aprobacion").length,
    resueltos:  tickets.filter((t) => t.estado === "resuelto").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-ink">Centro de Mando</h2>
          <p className="text-sm text-muted">— {user.nombre}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onMisiones}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
            🎯 Misiones
          </button>
          <button onClick={onInventario}
            className="relative rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
            🧪 Inventario
            {bajoStockCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white leading-none">
                {bajoStockCount}
              </span>
            )}
          </button>
          {nivel >= 2 && (
            <button onClick={onWorkload}
              className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
              📊 Carga
            </button>
          )}
          {nivel >= 3 && (
            <button onClick={onAdmin}
              className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
              ⚙️ Admin
            </button>
          )}
          <button onClick={onCreate}
            className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none">
            + Nuevo ticket
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Pendientes", val: stats.pendientes, cls: "border-yellow-300 bg-yellow-50" },
          { label: "En proceso",  val: stats.en_proceso,  cls: "border-blue-300 bg-blue-50" },
          { label: "Esperando",   val: stats.esperando,   cls: "border-orange-300 bg-orange-50" },
          { label: "Resueltos",   val: stats.resueltos,   cls: "border-green-300 bg-green-50" },
        ].map((s) => (
          <div key={s.label} className={`rounded-paper border-2 p-3 text-center ${s.cls}`}>
            <div className="text-2xl font-black text-ink">{s.val}</div>
            <div className="text-xs font-semibold text-muted">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}
          className="rounded-paper border-2 border-border bg-surface-input px-3 py-1.5 text-sm text-ink outline-none focus:border-accent">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_proceso">En Proceso</option>
          <option value="esperando_aprobacion">Esperando Aprobación</option>
          <option value="resuelto">Resuelto</option>
          <option value="rechazado">Rechazado</option>
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}
          className="rounded-paper border-2 border-border bg-surface-input px-3 py-1.5 text-sm text-ink outline-none focus:border-accent">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.slug} value={c.slug}>{c.icono} {c.nombre}</option>
          ))}
        </select>
        <button onClick={load}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ↻ Actualizar
        </button>
        {hasFilters && (
          <button onClick={() => { setFiltroEstado(""); setFiltroCategoria(""); }}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-danger hover:text-danger">
            ✕ Limpiar filtros
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Cargando...</div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : tickets.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">No hay tickets con estos filtros.</div>
      ) : hasFilters ? (
        /* Flat list when filters are active */
        <div className="space-y-2">
          {tickets.map((t) => (
            <TicketCard key={t.id} t={t} onClick={() => onSelect(t.id)} />
          ))}
        </div>
      ) : (
        /* Grouped view */
        <div className="space-y-4">
          {misionGroups.size > 0 && (
            <div className="space-y-3">
              {Array.from(misionGroups.values()).map((group) => (
                <MisionGroupCard
                  key={group.mision_id}
                  group={group}
                  onSelect={onSelect}
                  onMisionDetail={onMisionDetail}
                />
              ))}
            </div>
          )}
          {standalone.length > 0 && (
            <div className="space-y-2">
              {misionGroups.size > 0 && (
                <p className="text-xs font-bold uppercase tracking-wider text-muted pt-1">Tickets independientes</p>
              )}
              {standalone.map((t) => (
                <TicketCard key={t.id} t={t} onClick={() => onSelect(t.id)} />
              ))}
            </div>
          )}
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

// Ticket detail
function TicketDetailView({
  token, user, ticketId, onBack,
}: {
  token: string; user: TicketsUser; ticketId: number; onBack: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comentario, setComentario] = useState("");
  const [esInterno, setEsInterno] = useState(false);
  const [asignarA, setAsignarA] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showComentarios, setShowComentarios] = useState(false);

  const nivel = user.rol?.nivel ?? 1;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [t, us] = await Promise.all([
        tapi(`/${ticketId}`, token),
        tapi("/usuarios", token),
      ]);
      setTicket(t);
      setUsuarios(us);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, ticketId]);

  useEffect(() => { reload(); }, [reload]);

  async function act(fn: () => Promise<any>) {
    setSubmitting(true);
    try {
      await fn();
      await reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="py-16 text-center text-sm text-muted">Cargando ticket...</div>;
  if (error || !ticket) return (
    <div className="space-y-3">
      <button onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent transition">← Volver</button>
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || "No encontrado"}</div>
    </div>
  );

  const canApprove = nivel >= 2 && (ticket.categoria !== "rrhh" || nivel >= 3);
  const canAssign = nivel >= 2;
  const isAssignee = ticket.asignado_a === user.id;
  const isClosed = ticket.estado === "resuelto" || ticket.estado === "rechazado";

  const availableStates: { val: string; label: string; cls: string }[] = [];
  if (ticket.estado === "pendiente" && canAssign) {
    availableStates.push({ val: "en_proceso", label: "▶ Iniciar", cls: "border-blue-400 bg-blue-500 text-white hover:bg-blue-600 shadow-[0_2px_0_#1d4ed8]" });
    availableStates.push({ val: "rechazado", label: "Rechazar", cls: "border-red-400 bg-red-500 text-white hover:bg-red-600 shadow-[0_2px_0_#991b1b]" });
  }
  if (ticket.estado === "en_proceso" && (isAssignee || nivel >= 2)) {
    availableStates.push({ val: "esperando_aprobacion", label: "✓ Marcar Listo", cls: "border-orange-400 bg-orange-500 text-white hover:bg-orange-600 shadow-[0_2px_0_#c2410c]" });
  }
  if (ticket.estado === "esperando_aprobacion" && canApprove) {
    availableStates.push({ val: "resuelto", label: "✅ Aprobar", cls: "border-green-500 bg-green-600 text-white hover:bg-green-700 shadow-[0_2px_0_#166534]" });
    availableStates.push({ val: "en_proceso", label: "↩ Devolver", cls: "border-gray-400 bg-gray-500 text-white hover:bg-gray-600 shadow-[0_2px_0_#374151]" });
    availableStates.push({ val: "rechazado", label: "❌ Rechazar", cls: "border-red-400 bg-red-500 text-white hover:bg-red-600 shadow-[0_2px_0_#991b1b]" });
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ← Volver
        </button>
        <span className="font-mono text-sm font-bold text-muted">{ticket.numero}</span>
        <CategoriaBadge cat={ticket.categoria} />
        <PrioridadBadge p={ticket.prioridad} />
        <EstadoBadge estado={ticket.estado} />
        {ticket.total_horas != null && ticket.total_horas > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 border border-accent/30 px-2.5 py-0.5 text-xs font-bold text-accent">
            ⏱ {ticket.total_horas}h
          </span>
        )}
      </div>

      {/* Info + acciones rápidas */}
      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-3">
        <h2 className="text-lg font-extrabold text-ink">{ticket.titulo}</h2>
        {ticket.mision_info && ticket.etapa_info && (
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
            style={{ borderColor: ticket.mision_info.color + "66", background: ticket.mision_info.color + "18", color: ticket.mision_info.color }}>
            🎯 {ticket.mision_info.titulo} · Etapa {ticket.etapa_info.orden}/{ticket.mision_info.total_etapas}
          </div>
        )}
        {ticket.bloqueado_por && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 ml-2">
            🔒 Bloqueado por {ticket.bloqueado_por_numero}
          </div>
        )}
        {ticket.descripcion && (
          <p className="whitespace-pre-wrap text-sm text-ink border-t border-border pt-3">{ticket.descripcion}</p>
        )}
        {ticket.soporte_archivo && (
          <a href={`/api/tickets/uploads/${ticket.soporte_archivo}?token=${token}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-paper border-2 border-border px-3 py-1 text-xs font-semibold text-accent hover:border-accent transition">
            📎 Ver adjunto
          </a>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted border-t border-border pt-3">
          <span>Creado por: <strong className="text-ink">{ticket.creado_por_info?.nombre || "—"}</strong></span>
          <span>{fmtDate(ticket.creado_en)}</span>
          {ticket.asignado_a_info && <span>→ <strong className="text-ink">{ticket.asignado_a_info.nombre}</strong></span>}
        </div>
        {/* Assign + state actions */}
        {!isClosed && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {canAssign && (
              <>
                <select value={asignarA} onChange={(e) => setAsignarA(e.target.value)}
                  className="rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent">
                  <option value="">Sin asignar</option>
                  {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
                <button disabled={submitting}
                  onClick={() => act(() => tapi(`/${ticketId}/asignar`, token, {
                    method: "PUT", body: JSON.stringify({ asignado_a: asignarA ? parseInt(asignarA) : null }),
                  }))}
                  className="rounded-paper border-2 border-border px-2.5 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent disabled:opacity-50">
                  Asignar
                </button>
              </>
            )}
            {availableStates.map((s) => (
              <button key={s.val} disabled={submitting}
                onClick={() => act(() => tapi(`/${ticketId}/estado`, token, {
                  method: "PUT", body: JSON.stringify({ estado: s.val }),
                }))}
                className={`rounded-paper border-2 px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 active:translate-y-0.5 active:shadow-none ${s.cls}`}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pasos — sección principal */}
      <PasosSection ticketId={ticket.id} token={token} />

      {/* Materiales */}
      <MaterialesSection ticketId={ticket.id} token={token} />

      {/* Participantes */}
      <ParticipantesSection
        ticket={ticket} token={token} user={user}
        usuarios={usuarios} submitting={submitting}
        onAct={act}
      />

      {/* Comentarios — colapsable */}
      <div className="rounded-paper border-2 border-border bg-surface-panel shadow-paper overflow-hidden">
        <button
          className="flex w-full items-center justify-between px-5 py-3 text-left"
          onClick={() => setShowComentarios((v) => !v)}
        >
          <span className="text-sm font-extrabold uppercase tracking-wide text-muted">
            💬 Comentarios
            {ticket.comentarios && ticket.comentarios.length > 0 && (
              <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-bold">{ticket.comentarios.length}</span>
            )}
          </span>
          <span className="text-xs text-muted">{showComentarios ? "▲" : "▼"}</span>
        </button>
        {showComentarios && (
          <div className="border-t border-border px-5 pb-5 space-y-3">
            {ticket.comentarios && ticket.comentarios.length > 0 ? (
              <div className="mt-4 space-y-2">
                {ticket.comentarios.map((c) => (
                  <div key={c.id} className={`rounded-paper border-2 p-3 ${c.es_interno ? "border-amber-200 bg-amber-50" : "border-border bg-surface"}`}>
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
            ) : (
              <p className="mt-4 text-sm text-muted">Sin comentarios aún.</p>
            )}
            <div className="space-y-2 border-t border-border pt-3">
              <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2}
                placeholder="Agregar comentario..."
                className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none transition focus:border-accent resize-none" />
              <div className="flex items-center justify-between">
                {nivel >= 2 && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted cursor-pointer">
                    <input type="checkbox" checked={esInterno} onChange={(e) => setEsInterno(e.target.checked)} className="rounded" />
                    Interno
                  </label>
                )}
                <button disabled={submitting || !comentario.trim()}
                  onClick={() => act(() => tapi(`/${ticketId}/comentarios`, token, {
                    method: "POST",
                    body: JSON.stringify({ texto: comentario, es_interno: esInterno }),
                  }).then(() => { setComentario(""); setEsInterno(false); }))}
                  className="ml-auto rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
                  Comentar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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

      <div className="flex flex-wrap gap-2">
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

function PasosSection({ ticketId, token }: { ticketId: number; token: string }) {
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

  async function stopTimer(pasoId: number) {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const elapsed = timerElapsed;
    const pasoDesc = pasos.find((p) => p.id === pasoId)?.descripcion ?? "";
    setTimerPasoId(null);
    timerStartRef.current = null;
    setTimerElapsed(0);
    if (elapsed >= 30) {
      const horas = Math.round((elapsed / 3600) * 100) / 100;
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
    const res = await tapi(`/pasos/${id}/completar`, token, { method: "POST" });
    setPasos(res);
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
              draggable
              onDragStart={() => { dragIdx.current = i; }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => drop(i)}
              onDragEnd={() => { dragIdx.current = null; setDragOver(null); }}
              className={`flex items-center gap-2 rounded-paper border px-3 py-2.5 transition
                ${p.completado ? "border-green-200 bg-green-50"
                  : isRunning ? "border-blue-300 bg-blue-50"
                  : "border-border bg-surface"}
                ${dragOver === i ? "opacity-50 border-dashed border-accent" : ""}`}
            >
              <span className="cursor-grab text-muted opacity-40 hover:opacity-70 select-none shrink-0">⠿</span>
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
              <button onClick={() => del(p.id)} className="text-xs text-muted hover:text-danger transition shrink-0 px-0.5">✕</button>
            </div>
          );
        })}
      </div>
      {pasos.length === 0 && (
        <p className="py-2 text-center text-xs text-muted">Sin pasos aún. Agrega los pasos del procedimiento.</p>
      )}
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
    </div>
  );
}

// ── MATERIALES ────────────────────────────────────────────────────────────────

interface Material { id: number; nombre: string; unidad: string; stock_actual: number; stock_minimo: number; precio_unitario: number; proveedor?: string; tipo?: "materia_prima" | "elaborado"; mision_origen_id?: number | null; }
interface TicketMaterial { id: number; ticket_id: number; material_id: number; nombre: string; unidad: string; cantidad_requerida: number; stock_actual: number; tipo?: "materia_prima" | "elaborado"; }

function MaterialesSection({ ticketId, token }: { ticketId: number; token: string }) {
  const [items, setItems] = useState<TicketMaterial[]>([]);
  const [catalogo, setCatalogo] = useState<Material[]>([]);
  const [selMat, setSelMat] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    tapi(`/${ticketId}/materiales`, token).then(setItems).catch(() => {});
    tapi("/materiales", token).then(setCatalogo).catch(() => {});
  }, [ticketId, token]);

  async function add() {
    if (!selMat || !cantidad) return;
    setSaving(true);
    try {
      const res = await tapi(`/${ticketId}/materiales`, token, {
        method: "POST", body: JSON.stringify({ material_id: parseInt(selMat), cantidad: parseFloat(cantidad) }),
      });
      setItems(res); setSelMat(""); setCantidad("");
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function del(tmId: number) {
    const res = await tapi(`/ticket_materiales/${tmId}`, token, { method: "DELETE" });
    setItems(res);
  }


  const disponibles = catalogo.filter((m) => !items.find((i) => i.material_id === m.id));

  return (
    <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-4">
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">📦 Materiales e insumos</h3>

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((it) => {
            const stockOk = it.stock_actual >= it.cantidad_requerida;
            return (
              <div key={it.id} className="rounded-paper border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-sm text-ink">{it.nombre}</p>
                      {it.tipo === "elaborado" && (
                        <span className="rounded-full bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 text-[10px] font-bold">✨ elaborado</span>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      Requerido: <span className="font-bold">{it.cantidad_requerida} {it.unidad}</span>
                      {" · "}
                      <span className={stockOk ? "text-green-600" : "text-red-500"}>
                        Stock: {it.stock_actual} {it.unidad} {stockOk ? "✓" : "⚠️ insuficiente"}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => del(it.id)} className="text-xs text-muted hover:text-danger transition px-1">✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted">Sin materiales asignados aún.</p>
      )}

      {disponibles.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          <select className="flex-1 min-w-32 rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent"
            value={selMat} onChange={(e) => setSelMat(e.target.value)}>
            <option value="">Seleccionar material...</option>
            {disponibles.map((m) => <option key={m.id} value={m.id}>{m.tipo === "elaborado" ? "✨ " : ""}{m.nombre} ({m.unidad})</option>)}
          </select>
          <input type="number" min="0" step="any"
            className="w-24 rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm outline-none focus:border-accent"
            placeholder="Cant." value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          <button onClick={add} disabled={saving || !selMat || !cantidad}
            className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
            + Agregar
          </button>
        </div>
      )}
    </div>
  );
}

// ── INVENTARIO ────────────────────────────────────────────────────────────────

interface OrdenCompra { id: number; numero: string; material_id: number; material_nombre: string; unidad: string; cantidad: number; precio_unitario: number; proveedor: string; estado: string; notas: string; creado_en: string; recibida_en: string | null; creado_por_nombre: string; }

function InventarioView({ token, user, onBack }: { token: string; user: TicketsUser; onBack: () => void }) {
  const [materiales, setMateriales] = useState<Material[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [tab, setTab] = useState<"lista" | "stock" | "nuevo">("lista");
  const [form, setForm] = useState({ nombre: "", descripcion: "", unidad: "kg", stock_actual: "", stock_minimo: "", precio_unitario: "", proveedor: "", tipo: "materia_prima" });
  const [saving, setSaving] = useState(false);
  // Formulario rápido de orden por material_id
  const [pedidoAbierto, setPedidoAbierto] = useState<number | null>(null);
  const [pedidoForm, setPedidoForm] = useState({ cantidad: "", precio_unitario: "", proveedor: "", notas: "" });
  const nivel = user.rol?.nivel ?? 1;

  const reload = useCallback(async () => {
    const [mats, ocs] = await Promise.all([
      tapi("/materiales", token),
      tapi("/ordenes-compra", token),
    ]);
    setMateriales(mats);
    setOrdenes(ocs);
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
      }) });
      setForm({ nombre: "", descripcion: "", unidad: "kg", stock_actual: "", stock_minimo: "", precio_unitario: "", proveedor: "", tipo: "materia_prima" });
      setTab("stock");
      reload();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function crearOCRapida(materialId: number) {
    if (!pedidoForm.cantidad) return;
    setSaving(true);
    try {
      await tapi("/ordenes-compra", token, {
        method: "POST",
        body: JSON.stringify({
          material_id: materialId,
          cantidad: parseFloat(pedidoForm.cantidad),
          precio_unitario: parseFloat(pedidoForm.precio_unitario || "0"),
          proveedor: pedidoForm.proveedor,
          notas: pedidoForm.notas,
        }),
      });
      setPedidoAbierto(null);
      setPedidoForm({ cantidad: "", precio_unitario: "", proveedor: "", notas: "" });
      reload();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function actualizarOC(id: number, estado: string) {
    await tapi(`/ordenes-compra/${id}`, token, { method: "PUT", body: JSON.stringify({ estado }) });
    reload();
  }

  const bajoStock = materiales
    .filter((m) => m.stock_minimo > 0 && m.stock_actual < m.stock_minimo)
    .sort((a, b) => {
      // Agotados primero, luego por mayor brecha relativa
      const aAgotado = a.stock_actual <= 0 ? 1 : 0;
      const bAgotado = b.stock_actual <= 0 ? 1 : 0;
      if (aAgotado !== bAgotado) return bAgotado - aAgotado;
      return (a.stock_actual / a.stock_minimo) - (b.stock_actual / b.stock_minimo);
    });

  const ocsActivas = ordenes.filter((oc) => oc.estado === "pendiente" || oc.estado === "aprobada");

  const OC_COLOR: Record<string, string> = {
    pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
    aprobada:  "bg-blue-100 text-blue-800 border-blue-300",
    recibida:  "bg-green-100 text-green-800 border-green-300",
    cancelada: "bg-gray-100 text-gray-600 border-gray-300",
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">← Volver</button>
          <div>
            <h2 className="text-xl font-extrabold text-ink">Inventario</h2>
            <p className="text-xs text-muted">Materiales, stock y lista de compras</p>
          </div>
        </div>
        {bajoStock.length > 0 && (
          <div className="flex items-center gap-2 rounded-full border-2 border-red-300 bg-red-50 px-4 py-1.5">
            <span className="text-sm font-black text-red-600">{bajoStock.length}</span>
            <span className="text-xs font-semibold text-red-600">
              {bajoStock.length === 1 ? "material necesita reposición" : "materiales necesitan reposición"}
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button onClick={() => setTab("lista")}
          className={`relative px-4 py-2.5 text-sm font-bold transition border-b-2 -mb-px ${tab === "lista" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>
          🛒 Lista de compras
          {bajoStock.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white">
              {bajoStock.length}
            </span>
          )}
        </button>
        <button onClick={() => setTab("stock")}
          className={`px-4 py-2.5 text-sm font-bold transition border-b-2 -mb-px ${tab === "stock" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>
          📦 Stock
        </button>
        {nivel >= 2 && (
          <button onClick={() => setTab("nuevo")}
            className={`px-4 py-2.5 text-sm font-bold transition border-b-2 -mb-px ${tab === "nuevo" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>
            + Nuevo material
          </button>
        )}
      </div>

      {/* ── LISTA DE COMPRAS ── */}
      {tab === "lista" && (
        <div className="space-y-6">
          {bajoStock.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mb-3 text-4xl">✅</div>
              <p className="text-sm font-semibold text-muted">Todo el stock está en nivel adecuado.</p>
              <p className="mt-1 text-xs text-muted">Cuando un material baje del mínimo aparecerá aquí automáticamente.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {bajoStock.map((m) => {
                  const agotado = m.stock_actual <= 0;
                  const sugerido = Math.max(0, m.stock_minimo - m.stock_actual);
                  const ocExistente = ocsActivas.find((oc) => oc.material_id === m.id);
                  const abriendo = pedidoAbierto === m.id;

                  return (
                    <div key={m.id} className={`rounded-paper border-2 bg-surface-panel shadow-paper-sm overflow-hidden ${agotado ? "border-red-400" : "border-orange-300"}`}>
                      {/* Urgency stripe */}
                      <div className={`h-1 w-full ${agotado ? "bg-red-500" : "bg-orange-400"}`} />

                      <div className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-base">{agotado ? "🔴" : "🟡"}</span>
                              <span className="font-bold text-sm text-ink">{m.nombre}</span>
                              {agotado && (
                                <span className="rounded-full bg-red-100 border border-red-300 px-2 py-0.5 text-xs font-black text-red-700">AGOTADO</span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                              <span>Stock actual: <strong className={agotado ? "text-red-600" : "text-orange-600"}>{m.stock_actual} {m.unidad}</strong></span>
                              <span>Mínimo: <strong className="text-ink">{m.stock_minimo} {m.unidad}</strong></span>
                              <span className="font-semibold text-ink">→ Pedir al menos: <strong className="text-accent">{sugerido} {m.unidad}</strong></span>
                            </div>
                            {m.proveedor && <p className="mt-1 text-xs text-muted">Proveedor habitual: {m.proveedor}</p>}
                            {m.precio_unitario > 0 && (
                              <p className="mt-0.5 text-xs text-muted">
                                Precio ref: ${m.precio_unitario.toLocaleString("es-CO")} / {m.unidad}
                                {sugerido > 0 && (
                                  <span className="ml-2 font-semibold text-ink">
                                    ≈ ${(m.precio_unitario * sugerido).toLocaleString("es-CO")} total
                                  </span>
                                )}
                              </p>
                            )}
                          </div>

                          {/* Acción principal */}
                          {nivel >= 2 && (
                            <div className="shrink-0">
                              {ocExistente ? (
                                <div className="text-right">
                                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${OC_COLOR[ocExistente.estado]}`}>
                                    {ocExistente.estado === "pendiente" ? "🕐 OC Pendiente" : "✓ OC Aprobada"}
                                  </span>
                                  <p className="mt-1 text-xs text-muted font-mono">{ocExistente.numero}</p>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (abriendo) { setPedidoAbierto(null); return; }
                                    setPedidoAbierto(m.id);
                                    setPedidoForm({
                                      cantidad: String(sugerido || m.stock_minimo),
                                      precio_unitario: String(m.precio_unitario || ""),
                                      proveedor: m.proveedor || "",
                                      notas: "",
                                    });
                                  }}
                                  className={`rounded-paper border-2 px-4 py-2 text-sm font-bold transition
                                    ${abriendo ? "border-accent bg-accent text-white" : "border-accent text-accent hover:bg-accent hover:text-white"}`}>
                                  🛒 Ordenar
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Formulario rápido de OC */}
                        {abriendo && nivel >= 2 && !ocExistente && (
                          <div className="mt-4 pt-4 border-t border-border space-y-3">
                            <p className="text-xs font-extrabold uppercase tracking-wide text-accent">Nueva orden de compra</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-1 block text-xs font-bold text-muted">Cantidad * ({m.unidad})</label>
                                <input type="number" min="0" step="any"
                                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                                  value={pedidoForm.cantidad}
                                  onChange={(e) => setPedidoForm((f) => ({ ...f, cantidad: e.target.value }))}
                                  autoFocus />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-bold text-muted">Precio unitario ($)</label>
                                <input type="number" min="0" step="any"
                                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                                  value={pedidoForm.precio_unitario}
                                  onChange={(e) => setPedidoForm((f) => ({ ...f, precio_unitario: e.target.value }))} />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-bold text-muted">Proveedor</label>
                                <input
                                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                                  value={pedidoForm.proveedor}
                                  onChange={(e) => setPedidoForm((f) => ({ ...f, proveedor: e.target.value }))} />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-bold text-muted">Notas</label>
                                <input
                                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                                  value={pedidoForm.notas}
                                  onChange={(e) => setPedidoForm((f) => ({ ...f, notas: e.target.value }))} />
                              </div>
                            </div>
                            {pedidoForm.cantidad && pedidoForm.precio_unitario && (
                              <p className="text-xs font-semibold text-accent">
                                Total estimado: ${(parseFloat(pedidoForm.cantidad) * parseFloat(pedidoForm.precio_unitario)).toLocaleString("es-CO")}
                              </p>
                            )}
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => setPedidoAbierto(null)}
                                className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface-hover transition">
                                Cancelar
                              </button>
                              <button onClick={() => crearOCRapida(m.id)} disabled={saving || !pedidoForm.cantidad}
                                className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
                                {saving ? "Guardando..." : "✓ Crear orden de compra"}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Acciones de OC existente */}
                        {ocExistente && nivel >= 2 && (
                          <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-2">
                            <span className="text-xs text-muted self-center">
                              {ocExistente.cantidad} {ocExistente.unidad}
                              {ocExistente.proveedor ? ` · ${ocExistente.proveedor}` : ""}
                            </span>
                            <div className="ml-auto flex gap-2">
                              {ocExistente.estado === "pendiente" && (
                                <button onClick={() => actualizarOC(ocExistente.id, "aprobada")}
                                  className="rounded border border-blue-400 px-2.5 py-1 text-xs font-bold text-blue-600 hover:bg-blue-500 hover:text-white transition">
                                  ✓ Aprobar
                                </button>
                              )}
                              <button onClick={() => actualizarOC(ocExistente.id, "recibida")}
                                className="rounded border border-green-400 px-2.5 py-1 text-xs font-bold text-green-600 hover:bg-green-500 hover:text-white transition">
                                📥 Recibida
                              </button>
                              <button onClick={() => actualizarOC(ocExistente.id, "cancelada")}
                                className="rounded border border-red-300 px-2.5 py-1 text-xs font-bold text-red-500 hover:bg-red-500 hover:text-white transition">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Órdenes activas adicionales (materiales NO bajo stock) */}
              {ocsActivas.filter((oc) => !bajoStock.find((m) => m.id === oc.material_id)).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Otras órdenes activas</p>
                  {ocsActivas
                    .filter((oc) => !bajoStock.find((m) => m.id === oc.material_id))
                    .map((oc) => (
                      <div key={oc.id} className="rounded-paper border-2 border-border bg-surface-panel p-3 shadow-paper-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-mono text-xs font-bold text-muted mr-2">{oc.numero}</span>
                            <span className="font-semibold text-sm text-ink">{oc.material_nombre}</span>
                            <span className="ml-2 text-xs text-muted">{oc.cantidad} {oc.unidad}{oc.proveedor ? ` · ${oc.proveedor}` : ""}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${OC_COLOR[oc.estado]}`}>
                              {oc.estado === "pendiente" ? "Pendiente" : "Aprobada"}
                            </span>
                            {nivel >= 2 && (
                              <>
                                {oc.estado === "pendiente" && (
                                  <button onClick={() => actualizarOC(oc.id, "aprobada")}
                                    className="rounded border border-blue-400 px-2 py-0.5 text-xs font-bold text-blue-600 hover:bg-blue-500 hover:text-white transition">
                                    ✓ Aprobar
                                  </button>
                                )}
                                <button onClick={() => actualizarOC(oc.id, "recibida")}
                                  className="rounded border border-green-400 px-2 py-0.5 text-xs font-bold text-green-600 hover:bg-green-500 hover:text-white transition">
                                  📥 Recibida
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── STOCK COMPLETO ── */}
      {tab === "stock" && (
        <div className="space-y-3">
          {materiales.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No hay materiales en el catálogo aún.</p>
          ) : materiales.map((m) => {
            const pct = m.stock_minimo > 0 ? Math.min(100, Math.round((m.stock_actual / m.stock_minimo) * 100)) : 100;
            const bajo = m.stock_minimo > 0 && m.stock_actual < m.stock_minimo;
            return (
              <div key={m.id} className={`rounded-paper border-2 bg-surface-panel p-4 shadow-paper-sm ${bajo ? "border-red-300" : "border-border"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      {bajo && <span className="text-sm">{m.stock_actual <= 0 ? "🔴" : "🟡"}</span>}
                      <p className="font-bold text-sm text-ink">{m.nombre}</p>
                      {m.tipo === "elaborado" && (
                        <span className="rounded-full bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 text-[10px] font-bold">✨ elaborado</span>
                      )}
                    </div>
                    {m.proveedor && <p className="text-xs text-muted">Proveedor: {m.proveedor}</p>}
                    {m.tipo === "elaborado" && <p className="text-xs text-purple-600">Producido internamente</p>}
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-black ${bajo ? "text-red-600" : "text-ink"}`}>
                      {m.stock_actual} <span className="text-sm font-normal text-muted">{m.unidad}</span>
                    </p>
                    {m.stock_minimo > 0 && <p className="text-xs text-muted">Mín: {m.stock_minimo} {m.unidad}</p>}
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
      )}

      {/* ── NUEVO MATERIAL ── */}
      {tab === "nuevo" && nivel >= 2 && (
        <div className="rounded-paper border-2 border-border bg-surface-panel p-5 space-y-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Agregar material al catálogo</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Nombre *</label>
              <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Tipo</label>
              <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
                <option value="materia_prima">🧱 Materia prima</option>
                <option value="elaborado">✨ Producto elaborado</option>
              </select>
              {form.tipo === "elaborado" && (
                <p className="mt-1 text-xs text-purple-600">El stock se actualizará automáticamente al completar la misión vinculada.</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Unidad</label>
              <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
                value={form.unidad} onChange={(e) => setForm((f) => ({ ...f, unidad: e.target.value }))}>
                {["kg","g","mg","L","mL","unidad","m","cm","m²","m³","caja","bolsa","rollo","galón"].map((u) => (
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
          </div>
          <div className="flex justify-end">
            <button onClick={crearMaterial} disabled={saving || !form.nombre.trim()}
              className="rounded-paper border-2 border-accent bg-accent px-6 py-2 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover disabled:opacity-50">
              {saving ? "Guardando..." : "Crear material"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Missions list
function MisionesView({
  token, user, onSelect, onCreate, onBack,
}: {
  token: string; user: TicketsUser;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onBack: () => void;
}) {
  const [misiones, setMisiones] = useState<Mision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    tapi("/misiones/", token)
      .then(setMisiones)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const MISION_ESTADO: Record<string, string> = {
    borrador: "bg-gray-100 text-gray-600 border-gray-300",
    activa: "bg-blue-100 text-blue-800 border-blue-300",
    completada: "bg-green-100 text-green-800 border-green-300",
    cancelada: "bg-red-100 text-red-700 border-red-300",
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
            ← Volver
          </button>
          <div>
            <h2 className="text-xl font-extrabold text-ink">Misiones</h2>
            <p className="text-sm text-muted">Proyectos multi-etapa</p>
          </div>
        </div>
        <button onClick={onCreate}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none">
          + Nueva Misión
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Cargando...</div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : misiones.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mb-3 text-4xl">🎯</div>
          <p className="text-sm font-semibold text-muted">No hay misiones aún.</p>
          <p className="mt-1 text-xs text-muted">Crea una misión para organizar proyectos en etapas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {misiones.map((m) => {
            const pct = m.total_etapas > 0 ? Math.round((m.etapas_completadas / m.total_etapas) * 100) : 0;
            const nivel = user.rol?.nivel ?? 1;
            return (
              <div key={m.id} className="rounded-paper border-2 border-border bg-surface-panel shadow-paper-sm transition hover:border-accent hover:shadow-paper">
                <button onClick={() => onSelect(m.id)} className="w-full p-4 text-left">
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-ink">{m.titulo}</span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${MISION_ESTADO[m.estado] || "bg-gray-100 text-gray-600"}`}>
                          {m.estado.charAt(0).toUpperCase() + m.estado.slice(1)}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-xs font-semibold text-muted">
                          {m.tipo === "secuencial" ? "🔗 Secuencial" : "⚡ Paralelo"}
                        </span>
                        <CategoriaBadge cat={m.categoria} />
                      </div>
                      {m.reino && <p className="text-xs text-muted">Reino: {m.reino}</p>}
                      {m.descripcion && <p className="text-xs text-muted mt-0.5 line-clamp-1">{m.descripcion}</p>}
                      {m.frecuencia && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-semibold">
                            {FRECUENCIA_LABEL[m.frecuencia] ?? m.frecuencia}
                          </span>
                          {m.proxima_renovacion && m.estado === "completada" && (
                            <span className="text-xs text-muted">Próxima: {fmtFecha(m.proxima_renovacion)}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-black text-ink">{m.etapas_completadas}/{m.total_etapas}</div>
                      <div className="text-xs text-muted">etapas</div>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: m.color || "#0c6069" }} />
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted">
                    <span>{m.creado_por_nombre && `Por ${m.creado_por_nombre}`}</span>
                    <span>{pct}% completado</span>
                  </div>
                </button>
                {nivel >= 3 && (
                  <div className="border-t border-border px-4 py-2 flex justify-end">
                    <button
                      onClick={async () => {
                        const msg = m.total_etapas > 0
                          ? `¿Eliminar la misión "${m.titulo}" y sus ${m.total_etapas} ticket(s) asociados?\n\nEsta acción no se puede deshacer.`
                          : `¿Eliminar la misión "${m.titulo}"?`;
                        if (!confirm(msg)) return;
                        try {
                          await tapi(`/misiones/${m.id}`, token, { method: "DELETE" });
                          setMisiones((prev) => prev.filter((x) => x.id !== m.id));
                        } catch (e: any) {
                          alert(e.message);
                        }
                      }}
                      className="text-xs font-semibold text-red-400 hover:text-red-600 transition"
                    >
                      🗑️ Eliminar misión
                    </button>
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

// Create mission form
function CreateMisionView({
  token, onBack, onCreated,
}: {
  token: string; onBack: () => void; onCreated: (id: number) => void;
}) {
  const { cats: categorias } = useContext(CategoriasCtx);
  const [form, setForm] = useState({
    titulo: "", descripcion: "", reino: "",
    tipo: "secuencial", categoria: "logistica", color: "#0c6069", frecuencia: "",
  });
  const [etapas, setEtapas] = useState([{ titulo: "", descripcion: "" }]);
  const [asignaciones, setAsignaciones] = useState<Record<number, string>>({});
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [todasMisiones, setTodasMisiones] = useState<Mision[]>([]);
  const [depIds, setDepIds] = useState<number[]>([]);

  useEffect(() => {
    tapi("/usuarios", token).then(setUsuarios).catch(() => {});
    tapi("/misiones/", token).then(setTodasMisiones).catch(() => {});
  }, [token]);

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
    if (!form.reino.trim()) { setError("El Reino es obligatorio"); return; }
    if (etapas.some((e) => !e.titulo)) { setError("Todas las etapas deben tener título"); return; }
    setLoading(true);
    const asignacionesPorOrden: Record<string, string> = {};
    Object.entries(asignaciones).forEach(([k, v]) => { if (v) asignacionesPorOrden[k] = v; });
    try {
      const m = await tapi("/misiones/", token, {
        method: "POST",
        body: JSON.stringify({
          ...form,
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
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Categoría</label>
              <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                value={form.categoria} onChange={setF("categoria")}>
                {categorias.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.icono} {c.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Descripción (opcional)</label>
            <textarea className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent resize-none"
              rows={2} placeholder="Objetivo general de la misión..."
              value={form.descripcion} onChange={setF("descripcion")} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Reino *</label>
              <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                placeholder="Ej: Hogar, Producción, Ventas" value={form.reino} onChange={setF("reino")} required />
            </div>
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
  const { cats: categorias } = useContext(CategoriasCtx);
  const [mision, setMision] = useState<Mision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [renewing, setRenewing] = useState(false);

  // Edit metadata panel
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({ titulo: "", descripcion: "", reino: "", color: "", frecuencia: "", estado: "" });
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
  }, [token]);
  useEffect(() => {
    if (mision) {
      setMetaForm({
        titulo: mision.titulo,
        descripcion: mision.descripcion || "",
        reino: mision.reino || "",
        color: mision.color || "#0c6069",
        frecuencia: mision.frecuencia || "",
        estado: mision.estado,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mision?.id]);

  const isLocked = false; // editing allowed for all states

  async function saveMeta() {
    if (!metaForm.reino.trim()) { alert("El Reino es obligatorio"); return; }
    setMetaSaving(true);
    try {
      const updated = await tapi(`/misiones/${misionId}`, token, {
        method: "PUT",
        body: JSON.stringify({ ...metaForm, frecuencia: metaForm.frecuencia || null }),
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
        <CategoriaBadge cat={mision.categoria} />
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
          <button
            onClick={() => setEditingMeta((v) => !v)}
            className={`rounded-paper border-2 px-3 py-1.5 text-sm font-bold transition
              ${editingMeta
                ? "border-accent bg-accent text-white"
                : "border-border text-muted hover:border-accent hover:text-accent"}`}>
            ✏️ Editar
          </button>
          {mision.frecuencia && nivel >= 2 && (
            <button
              disabled={renewing}
              onClick={async () => {
                if (!confirm(`¿Renovar la misión "${mision.titulo}" ahora?\n\nSe crearán tickets nuevos y la misión quedará activa.`)) return;
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
        </div>
      </div>

      {/* Edit metadata panel */}
      {editingMeta && (
        <div className="rounded-paper border-2 border-accent bg-surface-panel p-5 shadow-paper space-y-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Editar misión</h3>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Título *</label>
            <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={metaForm.titulo} onChange={(e) => setMetaForm((f) => ({ ...f, titulo: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Categoría</label>
              <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                value={metaForm.color} onChange={(e) => setMetaForm((f) => ({ ...f, color: e.target.value }))}>
                {categorias.map((c) => <option key={c.slug} value={c.slug}>{c.icono} {c.nombre}</option>)}
              </select>
            </div>
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Reino *</label>
              <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="Ej: Hogar, Producción, Ventas"
                value={metaForm.reino} onChange={(e) => setMetaForm((f) => ({ ...f, reino: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={metaForm.color}
                  onChange={(e) => setMetaForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-9 w-14 cursor-pointer rounded border-2 border-border p-0.5" />
                <span className="text-xs font-mono text-muted">{metaForm.color}</span>
              </div>
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
        {mision.reino && <p className="text-xs font-semibold text-muted mb-2">Reino: {mision.reino}</p>}
        {mision.descripcion && <p className="text-sm text-ink mb-3">{mision.descripcion}</p>}
        {mision.frecuencia && mision.proxima_renovacion && (
          <p className="mb-3 text-xs font-semibold" style={{ color: mision.color }}>
            {mision.estado === "completada"
              ? `⏰ Próxima renovación automática: ${fmtFecha(mision.proxima_renovacion)}`
              : `♻️ Se renovará el ${fmtFecha(mision.proxima_renovacion)} al completarse`}
          </p>
        )}
        <div className="h-2 rounded-full bg-white/60 overflow-hidden">
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
                    <button
                      onClick={async () => {
                        try {
                          const updated = await tapi(`/misiones/${misionId}/dependencias/${dep.id}`, token, { method: "DELETE" });
                          setMision(updated);
                        } catch (e: any) { alert(e.message); }
                      }}
                      className="text-muted hover:text-danger transition text-xs px-1">✕</button>
                  </div>
                ))}
              </div>
            )}
            {disponibles.length > 0 && (
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
          <div className="rounded-paper border-2 border-purple-200 bg-purple-50/40 p-5 shadow-paper space-y-3">
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-purple-700">✨ Producto resultante</h3>
              <p className="mt-0.5 text-xs text-purple-600">
                Al completar esta misión, el stock del producto vinculado aumenta automáticamente con la suma de todos los insumos usados.
              </p>
            </div>

            {prod ? (
              <div className="flex items-center gap-3 rounded-paper border border-purple-300 bg-white px-4 py-3">
                <div className="flex-1">
                  <p className="font-bold text-sm text-ink">{prod.nombre}</p>
                  <p className="text-xs text-muted">Stock actual: <span className="font-bold text-purple-700">{prod.stock_actual} {prod.unidad}</span></p>
                </div>
                <button
                  disabled={prodSaving}
                  onClick={() => setProd(null)}
                  className="text-xs text-muted hover:text-danger transition px-2">
                  {prodSaving ? "..." : "✕ Desvincular"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select
                    value={prodSelId}
                    onChange={(e) => setProdSelId(e.target.value)}
                    className="flex-1 rounded-paper border-2 border-border bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-purple-400">
                    <option value="">Seleccionar producto del catálogo...</option>
                    {disponiblesProd.map((m) => (
                      <option key={m.id} value={m.id}>{m.tipo === "elaborado" ? "✨ " : ""}{m.nombre} ({m.unidad})</option>
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
                  <div className="rounded-paper border border-purple-200 bg-white p-3 space-y-2">
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
                  draggable={!isLocked}
                  onDragStart={() => { dragIdx.current = i; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={() => { dragIdx.current = null; setDragOver(null); }}
                  className={isOver ? "opacity-50" : ""}
                >
                  <div className={`flex items-center gap-3 rounded-paper border-2 p-3 transition ${ETAPA_COLOR[et.estado]} ${isOver ? "border-accent border-dashed" : ""}`}>
                    {!isLocked && (
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
                      {et.ticket_id && (
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
                      {!isLocked && !isDone && (
                        <button onClick={() => deleteEtapa(et.id, et.titulo)}
                          className="text-xs text-red-400 hover:text-red-600 transition px-1">✕</button>
                      )}
                    </div>
                  </div>
                  {/* Panel de configuración inline */}
                  {configurandoTicketId === et.ticket_id && et.ticket_id && (
                    <div className="mt-2 rounded-paper border border-accent/30 bg-surface p-4 space-y-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-accent">
                        ⚙️ Configurar: {et.titulo}
                      </p>
                      <PasosSection ticketId={et.ticket_id} token={token} />
                      <MaterialesSection ticketId={et.ticket_id} token={token} />
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
                  draggable={!isLocked}
                  onDragStart={() => { dragIdx.current = i; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={() => { dragIdx.current = null; setDragOver(null); }}
                  className={`rounded-paper border-2 p-3 transition ${ETAPA_COLOR[et.estado]} ${isOver ? "opacity-50 border-accent border-dashed" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      {!isLocked && (
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
                      {et.ticket_id && (
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
                      {!isLocked && !isDone && (
                        <button onClick={() => deleteEtapa(et.id, et.titulo)}
                          className="text-xs text-red-400 hover:text-red-600 transition px-1">✕</button>
                      )}
                    </div>
                  </div>
                  <p className="font-semibold text-sm">{et.titulo}</p>
                  {et.descripcion && <p className="text-xs opacity-75 mt-0.5">{et.descripcion}</p>}
                  {et.asignado_nombre && <p className="text-xs opacity-75 mt-1 flex items-center gap-1"><span>👤</span>{et.asignado_nombre}</p>}
                  {/* Panel de configuración inline */}
                  {configurandoTicketId === et.ticket_id && et.ticket_id && (
                    <div className="mt-3 pt-3 border-t border-border space-y-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-accent">⚙️ Configurar</p>
                      <PasosSection ticketId={et.ticket_id} token={token} />
                      <MaterialesSection ticketId={et.ticket_id} token={token} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add ticket inline form */}
        {!isLocked && (
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
        <h2 className="text-xl font-extrabold text-ink">Dashboard de Carga Laboral</h2>
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
                    <div className="text-xl font-black text-accent">{u.total_horas}h</div>
                    <div className="text-xs font-semibold text-muted">Horas totales</div>
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

// ── Main panel ────────────────────────────────────────────────────────────────

export default function TicketsPanel() {
  const { token, user, setAuth, clear } = useTicketsAuth();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedMisionId, setSelectedMisionId] = useState<number | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);

  const reloadCats = useCallback(() => {
    if (!token) return;
    tapi("/categorias/", token).then(setCategorias).catch(() => {});
  }, [token]);

  useEffect(() => { reloadCats(); }, [reloadCats]);

  if (!token || !user) {
    return (
      <LoginView
        onLogin={(t, u) => { setAuth(t, u as TicketsUser); setView("list"); }}
      />
    );
  }

  const nivel = user.rol?.nivel ?? 1;

  function goDetail(id: number) { setSelectedId(id); setView("detail"); }
  function goBack() { setView("list"); setSelectedId(null); setSelectedMisionId(null); }
  function goMisionDetail(id: number) { setSelectedMisionId(id); setView("mision_detail"); }

  return (
    <CategoriasCtx.Provider value={{ cats: categorias, reload: reloadCats }}>
    <div className="relative">
      {/* Logout button */}
      <div className="absolute right-0 top-0 z-10">
        <button onClick={clear}
          className="flex items-center gap-1.5 rounded-paper border-2 border-border px-3 py-1 text-xs font-semibold text-muted transition hover:border-danger hover:text-danger">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Salir ({user.nombre})
        </button>
      </div>

      <div className="pt-8">
        {view === "list" && (
          <TicketListView
            token={token} user={user}
            onSelect={goDetail}
            onCreate={() => setView("create")}
            onAdmin={() => setView("admin")}
            onWorkload={() => setView("workload")}
            onMisiones={() => setView("misiones")}
            onMisionDetail={goMisionDetail}
            onInventario={() => setView("inventario")}
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
        {view === "admin" && nivel >= 3 && (
          <AdminView token={token} onBack={goBack} />
        )}
        {view === "workload" && nivel >= 2 && (
          <WorkloadView token={token} onBack={goBack} />
        )}
        {view === "misiones" && (
          <MisionesView
            token={token} user={user}
            onSelect={goMisionDetail}
            onCreate={() => setView("crear_mision")}
            onBack={goBack}
          />
        )}
        {view === "crear_mision" && (
          <CreateMisionView
            token={token}
            onBack={() => setView("misiones")}
            onCreated={(id) => goMisionDetail(id)}
          />
        )}
        {view === "mision_detail" && selectedMisionId != null && (
          <MisionDetailView
            token={token} user={user}
            misionId={selectedMisionId}
            onBack={() => setView("misiones")}
            onTicket={(id) => { setSelectedId(id); setView("detail"); }}
          />
        )}
        {view === "inventario" && (
          <InventarioView
            token={token} user={user}
            onBack={goBack}
          />
        )}
      </div>
    </div>
    </CategoriasCtx.Provider>
  );
}
