import { useState, useEffect, useCallback, useRef } from "react";
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

interface Mision {
  id: number;
  titulo: string;
  descripcion: string;
  reino: string;
  color: string;
  tipo: "secuencial" | "paralelo";
  categoria: "rrhh" | "logistica" | "mantenimiento";
  estado: "borrador" | "activa" | "completada" | "cancelada";
  total_etapas: number;
  etapas_completadas: number;
  creado_por: number;
  creado_por_nombre?: string;
  creado_por_info?: { id: number; nombre: string } | null;
  creado_en: string;
  completada_en: string | null;
  etapas?: EtapaMision[];
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

interface UserInfo {
  id: number;
  nombre: string;
  username: string;
  activo: number;
  rol: { id: number; nombre: string; nivel: number } | null;
  departamento: { id: number; nombre: string; color: string } | null;
}

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

const CATEGORIA_STYLES: Record<string, string> = {
  rrhh:          "bg-amber-100 text-amber-800",
  logistica:     "bg-teal-100 text-teal-800",
  mantenimiento: "bg-purple-100 text-purple-800",
};

const CATEGORIA_LABEL: Record<string, string> = {
  rrhh:          "RR.HH.",
  logistica:     "Logística",
  mantenimiento: "Mantenimiento",
};

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
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${CATEGORIA_STYLES[cat] || "bg-gray-100 text-gray-600"}`}>
      {CATEGORIA_LABEL[cat] || cat}
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

type View = "list" | "create" | "detail" | "admin" | "workload" | "misiones" | "crear_mision" | "mision_detail";

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
  token, user, onSelect, onCreate, onAdmin, onWorkload, onMisiones, onMisionDetail,
}: {
  token: string; user: TicketsUser;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onAdmin: () => void;
  onWorkload: () => void;
  onMisiones: () => void;
  onMisionDetail: (id: number) => void;
}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");

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
          <option value="rrhh">RR.HH.</option>
          <option value="logistica">Logística</option>
          <option value="mantenimiento">Mantenimiento</option>
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
              <option value="rrhh">👥 Recursos Humanos</option>
              <option value="logistica">🚚 Logística y Operaciones</option>
              <option value="mantenimiento">🔧 Mantenimiento y Sistemas</option>
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
  const [horas, setHoras] = useState("");
  const [notasTiempo, setNotasTiempo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [asignarA, setAsignarA] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
  const canChangeState = nivel >= 2 || ticket.asignado_a === user.id;
  const canAssign = nivel >= 2;
  const isAssignee = ticket.asignado_a === user.id;

  // Estado transitions available for current user
  const availableStates: { val: string; label: string }[] = [];
  if (ticket.estado === "pendiente" && canAssign) {
    availableStates.push({ val: "en_proceso", label: "Poner en Proceso" });
    availableStates.push({ val: "rechazado", label: "Rechazar" });
  }
  if (ticket.estado === "en_proceso" && (isAssignee || nivel >= 2)) {
    availableStates.push({ val: "esperando_aprobacion", label: "Marcar como Listo" });
    if (nivel >= 2) availableStates.push({ val: "rechazado", label: "Rechazar" });
  }
  if (ticket.estado === "esperando_aprobacion" && canApprove) {
    availableStates.push({ val: "resuelto", label: "✅ Aprobar y Cerrar" });
    availableStates.push({ val: "en_proceso", label: "↩ Devolver a proceso" });
    availableStates.push({ val: "rechazado", label: "❌ Rechazar" });
  }

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
          ← Volver
        </button>
        <span className="font-mono text-sm font-bold text-muted">{ticket.numero}</span>
        <CategoriaBadge cat={ticket.categoria} />
        <PrioridadBadge p={ticket.prioridad} />
        <EstadoBadge estado={ticket.estado} />
      </div>

      {/* Main info */}
      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper">
        <h2 className="mb-3 text-lg font-extrabold text-ink">{ticket.titulo}</h2>
        {ticket.mision_info && ticket.etapa_info && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
            style={{ borderColor: ticket.mision_info.color + "66", background: ticket.mision_info.color + "18", color: ticket.mision_info.color }}>
            🎯 {ticket.mision_info.titulo} · Etapa {ticket.etapa_info.orden}/{ticket.mision_info.total_etapas}
            {ticket.mision_info.tipo === "secuencial" ? " · 🔗 Secuencial" : " · ⚡ Paralela"}
          </div>
        )}
        {ticket.bloqueado_por && (
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-gray-100 border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 ml-2">
            🔒 Bloqueado por {ticket.bloqueado_por_numero}
          </div>
        )}
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div><span className="font-semibold text-muted">Creado por:</span><br/><span className="text-ink">{ticket.creado_por_info?.nombre || "—"}</span></div>
          <div><span className="font-semibold text-muted">Asignado a:</span><br/><span className="text-ink">{ticket.asignado_a_info?.nombre || <em className="text-muted">Sin asignar</em>}</span></div>
          <div><span className="font-semibold text-muted">Creado:</span><br/><span className="text-ink">{fmtDate(ticket.creado_en)}</span></div>
          <div><span className="font-semibold text-muted">Actualizado:</span><br/><span className="text-ink">{fmtDate(ticket.actualizado_en)}</span></div>
        </div>
        <div className="rounded-paper border border-border bg-surface p-3">
          <p className="text-sm font-bold uppercase tracking-wide text-muted mb-1">Descripción</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{ticket.descripcion}</p>
        </div>
        {ticket.soporte_archivo && (
          <div className="mt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted mb-1">Soporte documental</p>
            <a
              href={`/api/tickets/uploads/${ticket.soporte_archivo}?token=${token}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-paper border-2 border-border px-3 py-1.5 text-xs font-semibold text-accent transition hover:border-accent hover:bg-surface-hover"
            >
              📎 Ver archivo adjunto
            </a>
          </div>
        )}
      </div>

      {/* Actions */}
      {(availableStates.length > 0 || canAssign) && ticket.estado !== "resuelto" && ticket.estado !== "rechazado" && (
        <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Acciones</h3>

          {canAssign && (
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-48">
                <label className="mb-1 block text-xs font-bold text-muted">Asignar responsable</label>
                <select value={asignarA} onChange={(e) => setAsignarA(e.target.value)}
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent">
                  <option value="">Sin asignar</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
              </div>
              <button
                disabled={submitting}
                onClick={() => act(() => tapi(`/${ticketId}/asignar`, token, {
                  method: "PUT",
                  body: JSON.stringify({ asignado_a: asignarA ? parseInt(asignarA) : null }),
                }))}
                className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50"
              >
                Asignar
              </button>
            </div>
          )}

          {availableStates.length > 0 && (
            <div className="space-y-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-bold text-muted">Motivo / Nota (opcional)</label>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  placeholder="Agrega un comentario al cambio de estado..." />
              </div>
              <div className="flex flex-wrap gap-2">
                {availableStates.map((s) => (
                  <button key={s.val}
                    disabled={submitting}
                    onClick={() => act(() => tapi(`/${ticketId}/estado`, token, {
                      method: "PUT",
                      body: JSON.stringify({ estado: s.val, motivo }),
                    }).then(() => setMotivo("")))}
                    className={`rounded-paper border-2 px-4 py-2 text-xs font-bold transition disabled:opacity-50 active:translate-y-0.5 active:shadow-none
                      ${s.val === "resuelto" ? "border-green-600 bg-green-600 text-white shadow-[0_2px_0_#166534] hover:bg-green-700"
                        : s.val === "rechazado" ? "border-red-500 bg-red-500 text-white shadow-[0_2px_0_#991b1b] hover:bg-red-600"
                        : "border-accent bg-accent text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Time tracking */}
      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Tiempo Invertido</h3>
          <span className="text-lg font-black text-accent">{ticket.total_horas ?? 0} h</span>
        </div>
        {ticket.tiempo_registrado && ticket.tiempo_registrado.length > 0 && (
          <div className="mb-4 space-y-1">
            {ticket.tiempo_registrado.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs">
                <span className="font-semibold text-ink">{t.autor_nombre}</span>
                <span className="text-muted">{t.notas}</span>
                <span className="font-bold text-accent">{t.horas}h</span>
              </div>
            ))}
          </div>
        )}
        {ticket.estado !== "resuelto" && ticket.estado !== "rechazado" && (
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Horas</label>
              <input type="number" step="0.25" min="0.25" value={horas} onChange={(e) => setHoras(e.target.value)}
                placeholder="0.5"
                className="w-24 rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent" />
            </div>
            <div className="flex-1 min-w-32">
              <label className="mb-1 block text-xs font-bold text-muted">Nota</label>
              <input value={notasTiempo} onChange={(e) => setNotasTiempo(e.target.value)}
                placeholder="¿Qué hiciste?"
                className="w-full rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent" />
            </div>
            <button disabled={submitting || !horas}
              onClick={() => act(() => tapi(`/${ticketId}/tiempo`, token, {
                method: "POST",
                body: JSON.stringify({ horas: parseFloat(horas), notas: notasTiempo }),
              }).then(() => { setHoras(""); setNotasTiempo(""); }))}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50"
            >
              Registrar
            </button>
          </div>
        )}
      </div>

      {/* Participants */}
      <ParticipantesSection
        ticket={ticket} token={token} user={user}
        usuarios={usuarios} submitting={submitting}
        onAct={act}
      />

      {/* Comments */}
      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-4">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Comentarios</h3>
        {ticket.comentarios && ticket.comentarios.length > 0 ? (
          <div className="space-y-3">
            {ticket.comentarios.map((c) => (
              <div key={c.id} className={`rounded-paper border-2 p-3 ${c.es_interno ? "border-amber-200 bg-amber-50" : "border-border bg-surface"}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-bold text-ink">{c.autor_nombre}</span>
                  <div className="flex items-center gap-2">
                    {c.es_interno ? <span className="text-xs font-semibold text-amber-700">🔒 Interno</span> : null}
                    <span className="text-xs text-muted">{fmtDate(c.creado_en)}</span>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm text-ink">{c.texto}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No hay comentarios aún.</p>
        )}
        <div className="space-y-2 border-t border-border pt-4">
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3}
            placeholder="Agrega un comentario..."
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none transition focus:border-accent resize-none" />
          <div className="flex items-center justify-between">
            {nivel >= 2 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-muted cursor-pointer">
                <input type="checkbox" checked={esInterno} onChange={(e) => setEsInterno(e.target.checked)}
                  className="rounded" />
                Comentario interno (solo staff)
              </label>
            )}
            <button disabled={submitting || !comentario.trim()}
              onClick={() => act(() => tapi(`/${ticketId}/comentarios`, token, {
                method: "POST",
                body: JSON.stringify({ texto: comentario, es_interno: esInterno }),
              }).then(() => { setComentario(""); setEsInterno(false); }))}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50 ml-auto"
            >
              Comentar
            </button>
          </div>
        </div>
      </div>

      {/* Audit log */}
      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper">
        <h3 className="mb-4 text-sm font-extrabold uppercase tracking-wide text-muted">Historial de Auditoría</h3>
        <div className="space-y-2">
          {(ticket.historial || []).map((l) => (
            <div key={l.id} className="flex items-start gap-3 text-xs">
              <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent-sky" />
              <div className="flex-1">
                <span className="font-bold text-ink">{LOG_LABELS[l.accion] || l.accion}</span>
                {l.valor_anterior && l.valor_nuevo && (
                  <span className="text-muted"> · <span className="line-through">{l.valor_anterior}</span> → <span className="font-semibold">{l.valor_nuevo}</span></span>
                )}
                {l.detalles && <span className="text-muted"> · {l.detalles}</span>}
              </div>
              <div className="shrink-0 text-right text-muted">
                {l.usuario_nombre && <div className="font-semibold">{l.usuario_nombre}</div>}
                <div>{fmtDate(l.creado_en)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danger zone (admins only) */}
      {nivel >= 3 && (
        <div className="rounded-paper border-2 border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-red-500">Zona de peligro</p>
          <button
            disabled={submitting}
            onClick={async () => {
              if (!confirm(`¿Eliminar permanentemente el ticket ${ticket.numero}?\n\nEsta acción no se puede deshacer.`)) return;
              setSubmitting(true);
              try {
                await tapi(`/${ticketId}`, token, { method: "DELETE" });
                onBack();
              } catch (e: any) {
                alert(e.message);
              } finally {
                setSubmitting(false);
              }
            }}
            className="rounded-paper border-2 border-red-400 bg-white px-4 py-2 text-sm font-bold text-red-600 transition hover:bg-red-500 hover:text-white disabled:opacity-50"
          >
            🗑️ Eliminar ticket permanentemente
          </button>
        </div>
      )}
    </div>
  );
}

// Admin: Users, Roles, Departments
function AdminView({ token, onBack }: { token: string; onBack: () => void }) {
  const [tab, setTab] = useState<"usuarios" | "roles" | "departamentos">("usuarios");
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<"user" | "rol" | "dept" | null>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">← Volver</button>
        <h2 className="text-xl font-extrabold text-ink">Administración</h2>
      </div>

      <div className="flex gap-2">
        {(["usuarios", "roles", "departamentos"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-paper border-2 px-4 py-1.5 text-sm font-bold capitalize transition
              ${tab === t ? "border-accent bg-surface-hover text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t === "usuarios" ? "👤 Usuarios" : t === "roles" ? "🎭 Roles" : "🏢 Departamentos"}
          </button>
        ))}
      </div>

      {loading ? (
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
  const [form, setForm] = useState({
    titulo: "", descripcion: "", reino: "",
    tipo: "secuencial", categoria: "logistica", color: "#0c6069",
  });
  const [etapas, setEtapas] = useState([{ titulo: "", descripcion: "" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function setF(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  function addEtapa() { setEtapas((e) => [...e, { titulo: "", descripcion: "" }]); }
  function removeEtapa(i: number) { setEtapas((e) => e.filter((_, idx) => idx !== i)); }
  function setEtapa(i: number, k: "titulo" | "descripcion", v: string) {
    setEtapas((e) => e.map((et, idx) => idx === i ? { ...et, [k]: v } : et));
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!form.titulo) { setError("Título de misión requerido"); return; }
    if (etapas.some((e) => !e.titulo)) { setError("Todas las etapas deben tener título"); return; }
    setLoading(true);
    try {
      const m = await tapi("/misiones/", token, {
        method: "POST",
        body: JSON.stringify({ ...form, etapas }),
      });
      onCreated(m.id);
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
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Tipo</label>
              <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                value={form.tipo} onChange={setF("tipo")}>
                <option value="secuencial">🔗 Secuencial (etapas estrictas)</option>
                <option value="paralelo">⚡ Paralelo (etapas simultáneas)</option>
              </select>
              <p className="mt-1 text-xs text-muted">
                {form.tipo === "secuencial"
                  ? "Cada etapa se desbloquea al completar la anterior."
                  : "Todas las etapas se activan a la vez."}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Categoría</label>
              <select className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                value={form.categoria} onChange={setF("categoria")}>
                <option value="logistica">🚚 Logística</option>
                <option value="mantenimiento">🔧 Mantenimiento</option>
                <option value="rrhh">👥 Recursos Humanos</option>
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
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Reino / Contexto (opcional)</label>
              <input className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                placeholder="Ej: Producción de cacao" value={form.reino} onChange={setF("reino")} />
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
        </div>

        {/* Etapas */}
        <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">
              Etapas ({etapas.length})
            </h3>
            <button type="button" onClick={addEtapa}
              className="rounded-paper border-2 border-accent px-3 py-1 text-xs font-bold text-accent transition hover:bg-surface-hover">
              + Agregar etapa
            </button>
          </div>

          {etapas.map((et, i) => (
            <div key={i} className="rounded-paper border-2 border-border bg-surface p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                  style={{ background: form.color }}>
                  {i + 1}
                </span>
                {etapas.length > 1 && (
                  <button type="button" onClick={() => removeEtapa(i)}
                    className="text-xs font-bold text-muted hover:text-danger transition">
                    Eliminar
                  </button>
                )}
              </div>
              <input
                className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder={`Título de la etapa ${i + 1} *`}
                value={et.titulo} onChange={(e) => setEtapa(i, "titulo", e.target.value)} />
              <input
                className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="Descripción (opcional)"
                value={et.descripcion} onChange={(e) => setEtapa(i, "descripcion", e.target.value)} />
            </div>
          ))}
        </div>

        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onBack}
            className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted transition hover:bg-surface-hover">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="rounded-paper border-2 border-accent bg-accent px-6 py-2 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50">
            {loading ? "Creando..." : "Crear Misión"}
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
  const [mision, setMision] = useState<Mision | null>(null);
  const [usuarios, setUsuarios] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showLaunch, setShowLaunch] = useState(false);
  const [asignaciones, setAsignaciones] = useState<Record<number, string>>({});
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  // Inline editor state (borrador only)
  const [editEtapas, setEditEtapas] = useState<{ titulo: string; descripcion: string }[]>([]);
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const nivel = user.rol?.nivel ?? 1;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [m, us] = await Promise.all([
        tapi(`/misiones/${misionId}`, token),
        tapi("/usuarios", token),
      ]);
      setMision(m);
      setUsuarios(us);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, misionId]);

  useEffect(() => { reload(); }, [reload]);

  // Sync edit state when mission loads/reloads
  useEffect(() => {
    if (mision?.etapas) {
      setEditEtapas(mision.etapas.map((e) => ({ titulo: e.titulo, descripcion: e.descripcion || "" })));
      setEditDirty(false);
    }
  }, [mision]);

  async function saveEtapas() {
    if (!mision) return;
    setSaving(true);
    try {
      await tapi(`/misiones/${misionId}`, token, {
        method: "PUT",
        body: JSON.stringify({ etapas: editEtapas }),
      });
      await reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  function moveEtapa(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= editEtapas.length) return;
    const next = [...editEtapas];
    [next[i], next[j]] = [next[j], next[i]];
    setEditEtapas(next);
    setEditDirty(true);
  }

  function addEtapaEdit() {
    setEditEtapas((e) => [...e, { titulo: "", descripcion: "" }]);
    setEditDirty(true);
  }

  function removeEtapaEdit(i: number) {
    setEditEtapas((e) => e.filter((_, idx) => idx !== i));
    setEditDirty(true);
  }

  function updateEtapaEdit(i: number, k: "titulo" | "descripcion", v: string) {
    setEditEtapas((e) => e.map((et, idx) => idx === i ? { ...et, [k]: v } : et));
    setEditDirty(true);
  }

  async function launch() {
    setLaunching(true);
    setLaunchError("");
    try {
      await tapi(`/misiones/${misionId}/lanzar`, token, {
        method: "POST",
        body: JSON.stringify({ asignaciones }),
      });
      setShowLaunch(false);
      await reload();
    } catch (e: any) {
      setLaunchError(e.message);
    } finally {
      setLaunching(false);
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
        <div className="ml-auto flex gap-2">
          {nivel >= 2 && mision.estado === "borrador" && (
            <button onClick={() => { setAsignaciones({}); setShowLaunch(true); }}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none">
              🚀 Lanzar misión
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

      {/* Header card */}
      <div className="rounded-paper border-2 p-5 shadow-paper" style={{ borderColor: mision.color + "66", background: mision.color + "11" }}>
        <h2 className="text-xl font-extrabold text-ink mb-1">{mision.titulo}</h2>
        {mision.reino && <p className="text-xs font-semibold text-muted mb-2">Reino: {mision.reino}</p>}
        {mision.descripcion && <p className="text-sm text-ink mb-3">{mision.descripcion}</p>}
        <div className="h-2 rounded-full bg-white/60 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: mision.color }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs" style={{ color: mision.color }}>
          <span>{mision.etapas_completadas} de {mision.total_etapas} etapas completadas</span>
          <span className="font-bold">{pct}%</span>
        </div>
      </div>

      {/* Etapas pipeline */}
      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper">
        <h3 className="mb-4 text-sm font-extrabold uppercase tracking-wide text-muted">Pipeline de Etapas</h3>

        {mision.estado === "borrador" ? (
          <div className="space-y-3">
            {editEtapas.map((et, i) => (
              <div key={i}>
                <div className="rounded-paper border-2 border-dashed border-border bg-surface p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                      style={{ background: mision.color }}>
                      {i + 1}
                    </span>
                    <input
                      className="flex-1 rounded border border-border bg-surface-input px-2 py-1 text-sm font-semibold text-ink outline-none focus:border-accent"
                      placeholder="Título de la etapa *"
                      value={et.titulo}
                      onChange={(e) => updateEtapaEdit(i, "titulo", e.target.value)}
                    />
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => moveEtapa(i, -1)} disabled={i === 0}
                        className="rounded px-1.5 py-1 text-xs font-bold text-muted hover:bg-surface-hover disabled:opacity-30 transition">
                        ↑
                      </button>
                      <button onClick={() => moveEtapa(i, 1)} disabled={i === editEtapas.length - 1}
                        className="rounded px-1.5 py-1 text-xs font-bold text-muted hover:bg-surface-hover disabled:opacity-30 transition">
                        ↓
                      </button>
                      <button onClick={() => removeEtapaEdit(i)} disabled={editEtapas.length <= 1}
                        className="rounded px-1.5 py-1 text-xs font-bold text-muted hover:text-danger disabled:opacity-30 transition">
                        ✕
                      </button>
                    </div>
                  </div>
                  <input
                    className="w-full rounded border border-border bg-surface-input px-2 py-1 text-xs text-muted outline-none focus:border-accent"
                    placeholder="Descripción (opcional)"
                    value={et.descripcion}
                    onChange={(e) => updateEtapaEdit(i, "descripcion", e.target.value)}
                  />
                </div>
                {isSecuencial && i < editEtapas.length - 1 && (
                  <div className="flex justify-center my-0.5">
                    <div className="h-3 w-0.5 rounded-full opacity-30" style={{ background: mision.color }} />
                  </div>
                )}
              </div>
            ))}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={addEtapaEdit}
                className="rounded-paper border-2 border-dashed border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent">
                + Agregar etapa
              </button>
              {editDirty && (
                <button onClick={saveEtapas} disabled={saving || editEtapas.some(e => !e.titulo.trim())}
                  className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50">
                  {saving ? "Guardando..." : "💾 Guardar cambios"}
                </button>
              )}
              {editDirty && (
                <button onClick={() => {
                  if (mision.etapas) {
                    setEditEtapas(mision.etapas.map((e) => ({ titulo: e.titulo, descripcion: e.descripcion || "" })));
                    setEditDirty(false);
                  }
                }}
                  className="text-xs font-semibold text-muted hover:text-danger transition">
                  Descartar
                </button>
              )}
            </div>

            <p className="text-center text-xs font-semibold text-muted pt-1">
              Edita las etapas y luego lanza la misión para crear los tickets.
            </p>
          </div>
        ) : isSecuencial ? (
          <div className="space-y-2">
            {etapas.map((et, i) => (
              <div key={et.id}>
                <div className={`flex items-center gap-3 rounded-paper border-2 p-3 transition ${ETAPA_COLOR[et.estado]}`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black shadow-sm"
                    style={{ color: mision.color, border: `2px solid ${mision.color}33` }}>
                    {et.orden}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{et.titulo}</p>
                    {et.asignado_nombre && <p className="text-xs opacity-75">👤 {et.asignado_nombre}</p>}
                    {et.ticket_bloqueado_por && <p className="text-xs opacity-75">🔒 Bloqueado</p>}
                  </div>
                  {et.ticket_id && et.ticket_numero && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {et.ticket_estado && (
                        <span className={`h-2 w-2 rounded-full ${TICKET_DOT[et.ticket_estado] || "bg-gray-400"}`} />
                      )}
                      <button onClick={() => et.ticket_id && onTicket(et.ticket_id)}
                        className="text-xs font-mono font-bold underline underline-offset-2 hover:opacity-70 transition">
                        {et.ticket_numero}
                      </button>
                    </div>
                  )}
                </div>
                {i < etapas.length - 1 && (
                  <div className="flex justify-center">
                    <div className="my-0.5 h-4 w-0.5 rounded-full" style={{ background: mision.color + "44" }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {etapas.map((et) => (
              <div key={et.id} className={`rounded-paper border-2 p-3 ${ETAPA_COLOR[et.estado]}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black shadow-sm"
                    style={{ color: mision.color, border: `2px solid ${mision.color}33` }}>
                    {et.orden}
                  </span>
                  {et.ticket_id && et.ticket_numero && (
                    <div className="flex items-center gap-1.5">
                      {et.ticket_estado && (
                        <span className={`h-2 w-2 rounded-full ${TICKET_DOT[et.ticket_estado] || "bg-gray-400"}`} />
                      )}
                      <button onClick={() => et.ticket_id && onTicket(et.ticket_id)}
                        className="text-xs font-mono font-bold underline underline-offset-2 hover:opacity-70 transition">
                        {et.ticket_numero}
                      </button>
                    </div>
                  )}
                </div>
                <p className="font-semibold text-sm">{et.titulo}</p>
                {et.descripcion && <p className="text-xs opacity-75 mt-0.5">{et.descripcion}</p>}
                {et.asignado_nombre && <p className="text-xs opacity-75 mt-0.5">👤 {et.asignado_nombre}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Launch modal */}
      {showLaunch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-paper border-2 border-border bg-surface-panel p-6 shadow-paper-lg max-h-[90vh] overflow-y-auto">
            <h3 className="mb-1 text-lg font-extrabold text-ink">🚀 Lanzar misión</h3>
            <p className="mb-4 text-sm text-muted">
              Asigna responsables a cada etapa. {isSecuencial ? "Las etapas se desbloquean en orden." : "Todas las etapas se activan simultáneamente."}
            </p>

            <div className="space-y-3 mb-5">
              {etapas.map((et) => (
                <div key={et.id} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                    style={{ background: mision.color }}>
                    {et.orden}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{et.titulo}</p>
                  </div>
                  <select
                    value={asignaciones[et.orden] || ""}
                    onChange={(e) => setAsignaciones((a) => ({ ...a, [et.orden]: e.target.value }))}
                    className="rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent min-w-0 flex-shrink"
                  >
                    <option value="">Sin asignar</option>
                    {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {launchError && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{launchError}</div>}

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowLaunch(false)}
                className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted transition hover:bg-surface-hover">
                Cancelar
              </button>
              <button onClick={launch} disabled={launching}
                className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-50">
                {launching ? "Lanzando..." : "🚀 Confirmar lanzamiento"}
              </button>
            </div>
          </div>
        </div>
      )}
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
      </div>
    </div>
  );
}
