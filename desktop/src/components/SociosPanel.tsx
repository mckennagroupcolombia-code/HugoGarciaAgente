import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchAuthBlobUrl } from "../api/client";
import { Icon } from "../icons";
import type { IconName } from "../icons/types";
import { useAppStore } from "../stores/app";

const CuentaSocioPanel = lazy(() => import("./CuentaSocioPanel"));

/* ─── Tipos (espejo de app/services/declarador.py) ───────────────────────── */

type EstadoPaso = "hecho" | "parcial" | "pendiente";
type PasoId = "perfil" | "plan" | "extractos" | "mckenna" | "cruces" | "declarador" | "cierre";

interface Paso {
  id: PasoId;
  label: string;
  estado: EstadoPaso;
  detalle: string;
  cantidad: number;
}

interface SocioResumen {
  id: number;
  nombre: string;
  usuario_id: number | null;
  hallazgos_abiertos: number;
  documentos: number;
  anios: number;
  por_corregir: number;
}

interface Perfil {
  tercero: {
    id: number;
    nombre: string;
    identificacion: string;
    email: string;
    telefono: string;
    cuenta_bancaria: string;
    usuario_id: number | null;
    tipo_persona: string;
  };
  cedula: string;
  binance_uid: string;
  binance_desde: string;
  carpeta: string;
  notas: string;
  pasos: Record<string, { hecho: boolean; en: string }>;
  cuestionario: Record<string, unknown>;
}

interface Pregunta {
  id: string;
  pregunta: string;
  ayuda: string;
  tipo: "sino" | "anio";
}

interface RequisitoAnio {
  ano: number;
  mios: number;
  ref: number;
  unidad: "meses" | "archivos";
  ok: boolean;
}

interface Requisito {
  id: string;
  categoria: string;
  titulo: string;
  por_que: string;
  como: string;
  por_anio: boolean;
  es_extracto: boolean;
  aplica: boolean;
  omitido: boolean;
  estado: "hecho" | "parcial" | "pendiente" | "no_aplica" | "omitido";
  mios: number;
  ref: number;
  anios: RequisitoAnio[];
}

interface Plan {
  cuestionario: Record<string, unknown> & { _completo: boolean; _faltan: string[]; _inferido: string[]; _respondido: string[]; omitidos: string[] };
  preguntas: Pregunta[];
  anios: number[];
  requisitos: Requisito[];
  referencia: { id: number; nombre: string; documentos: number; anios: number[]; desde: number | null } | null;
  progreso: { hechos: number; total: number };
  carpeta: string;
  carpeta_existe: boolean;
}

interface Documento {
  id: number;
  categoria: string;
  ano: number | null;
  archivo_nombre: string;
  archivo_path: string;
  origen: "subido" | "carpeta";
  tamano: number;
  notas: string;
  existe: boolean;
  legible: boolean;
}

interface Anio {
  ano: number;
  formulario: string;
  presentada_en: string;
  patrimonio_bruto: number | null;
  deudas: number | null;
  patrimonio_liquido: number | null;
  renta_liquida: number | null;
  impuesto_pagado: number | null;
  ganancia_ocasional: number | null;
  estado: string;
  tenencia_cierre_usd: number | null;
  cripto_renta_ordinaria: number | null;
  cripto_ganancia_ocasional: number | null;
  cripto_sin_costo: number | null;
  cripto_eventos: number | null;
  cripto_total: number | null;
  requiere_revision: boolean;
  notas: string;
}

interface Hallazgo {
  id: number;
  clave: string;
  ano: number | null;
  severidad: "alta" | "media" | "baja";
  titulo: string;
  detalle: string;
  estado: "pendiente" | "en_curso" | "resuelto" | "descartado";
  origen: string;
  resolucion: string;
}

interface ExtractoResumen {
  id: number;
  nombre: string;
  banco: string;
  cuenta: string;
  periodo_desde: string;
  periodo_hasta: string;
  lineas_count: number;
  archivo_nombre: string;
}

interface Cobertura {
  cuentas: { banco: string; cuenta: string; meses: string[]; desde: string; hasta: string; lineas: number; extractos: number }[];
  anios: Record<string, { meses_con: number; faltan: string[] }>;
}

interface Expediente {
  perfil: Perfil;
  plan: Plan;
  documentos: Documento[];
  documentos_por_categoria: Record<string, number>;
  categorias: { id: string; label: string }[];
  anios: Anio[];
  hallazgos: Hallazgo[];
  hallazgos_abiertos: number;
  extractos: ExtractoResumen[];
  cobertura: Cobertura;
  cuenta_mckenna: { cuentas: { cuenta_id: number; codigo: string; nombre: string; saldo: number }[]; saldo_por_pagar: number };
  cruces: { pares?: number; contabilizados?: number; sin_asiento?: number; sin_par?: number; sin_extracto_socio?: boolean; error?: string };
  pasos: Paso[];
  progreso: { hechos: number; total: number };
  carpeta_declarador_disponible: boolean;
}

interface LineaBanco {
  id: number;
  fecha: string;
  descripcion: string;
  referencia: string;
  monto: number;
  tipo: string;
  banco: string;
  cuenta: string;
}

interface Cruces {
  desde: string;
  hasta: string;
  sin_extracto_socio: boolean;
  empresa_a_socio: { empresa: LineaBanco; socio: LineaBanco; dias: number; monto: number; contabilizado: boolean }[];
  socio_a_empresa: { empresa: LineaBanco; socio: LineaBanco; dias: number; monto: number; contabilizado: boolean }[];
  mencionan_mckenna_sin_par: LineaBanco[];
  resumen: { pares: number; contabilizados: number; sin_asiento: number; sin_par: number; lineas_socio?: number; lineas_empresa?: number };
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const PASOS_META: Record<PasoId, { icon: IconName; hint: string }> = {
  perfil: { icon: "user", hint: "Cinco preguntas y la cédula. Nada más: el resto se deduce de lo que cargues." },
  plan: { icon: "listChecks", hint: "Qué documentos pide tu caso, cómo conseguirlos y qué cargó el otro socio como referencia." },
  extractos: { icon: "receipt", hint: "Extractos personales por cuenta y mes. Los huecos se ven aquí." },
  mckenna: { icon: "building", hint: "Saldos y movimientos con la empresa, y gastos personales." },
  cruces: { icon: "link", hint: "Giros entre el banco personal y el banco de McKenna." },
  declarador: { icon: "scroll", hint: "Años gravables, documentos, activos digitales, pendientes y agente." },
  cierre: { icon: "check", hint: "Qué queda abierto antes de entregar al contador." },
};

const ESTILO_PASO: Record<EstadoPaso, { dot: string; wrap: string; txt: string }> = {
  hecho: { dot: "bg-emerald-600 text-white", wrap: "border-emerald-600/30 bg-emerald-600/5", txt: "text-emerald-700 dark:text-emerald-400" },
  parcial: { dot: "bg-amber-500 text-white", wrap: "border-amber-600/40 bg-amber-600/10", txt: "text-amber-800 dark:text-amber-300" },
  pendiente: { dot: "bg-danger text-white", wrap: "border-danger/40 bg-danger/10", txt: "text-danger" },
};

const SEV_BADGE: Record<string, string> = {
  alta: "bg-danger/15 text-danger",
  media: "bg-amber-600/15 text-amber-800 dark:text-amber-300",
  baja: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
};

const ESTADO_ANIO_LABEL: Record<string, string> = {
  sin_datos: "Sin datos",
  presentada: "Presentada",
  borrador: "Borrador",
  por_corregir: "Por corregir",
  corregida: "Corregida",
  no_obligado: "No obligado",
};

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function cop(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

function kb(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const input =
  "w-full rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";
const btnPrimario =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50";
const btnSec =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-panel px-3 py-1.5 text-xs font-bold text-ink hover:border-accent hover:text-accent disabled:opacity-50";
const card = "rounded-xl border border-border bg-surface-panel";

function Campo({ label, children, ancho }: { label: string; children: ReactNode; ancho?: string }) {
  return (
    <label className={`block space-y-1 text-[11px] font-bold uppercase tracking-wide text-muted ${ancho ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

function Msg({ m }: { m: { tipo: "ok" | "error"; texto: string } | null }) {
  if (!m) return null;
  return (
    <p
      className={`rounded-lg px-3 py-2 text-sm font-semibold ${
        m.tipo === "ok" ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-danger/10 text-danger"
      }`}
    >
      {m.texto}
    </p>
  );
}

async function abrirArchivo(path: string, onError: (t: string) => void) {
  const url = await fetchAuthBlobUrl(path);
  if (!url) {
    onError("No se pudo abrir el archivo (¿se movió del disco?)");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function pasoKey(tid: number) {
  return `mckenna-socios-paso:${tid}`;
}

/* ─── Panel ───────────────────────────────────────────────────────────────── */

/**
 * Contabilidad personal de cada socio, dentro de la de la empresa, como
 * wizard de seis pasos. El backend calcula el estado real de cada paso
 * (`/api/socios/<id>/expediente` → `pasos`); aquí solo se pinta y se navega.
 * Cada socio ve únicamente su expediente (lo garantiza app/routes_declarador.py).
 */
export default function SociosPanel({ embebido }: { embebido?: boolean } = {}) {
  const bootTerceroId = useAppStore((s) => s.libroMayorBootTerceroId);
  const setBootTerceroId = useAppStore((s) => s.setLibroMayorBootTerceroId);
  const [terceroId, setTerceroId] = useState<number | null>(null);

  const sociosQ = useQuery<{ socios: SocioResumen[]; es_admin: boolean }>({
    queryKey: ["socios-lista"],
    queryFn: () => api.get("/api/socios"),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (bootTerceroId) {
      // Llega desde «Ver cuenta completa» (Préstamos / Libro Mayor): aterrizar
      // en el paso de la relación con McKenna, no en el perfil.
      try {
        localStorage.setItem(pasoKey(bootTerceroId), "mckenna");
      } catch {
        /* ignore */
      }
      setTerceroId(bootTerceroId);
      setBootTerceroId(null);
      return;
    }
    const lista = sociosQ.data?.socios ?? [];
    if (terceroId == null && lista.length === 1) setTerceroId(lista[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootTerceroId, sociosQ.data]);

  const socios = sociosQ.data?.socios ?? [];

  return (
    <div className={embebido ? "space-y-4" : "mx-auto max-w-5xl space-y-4"}>
      {!embebido && (
        <div>
          <h2 className="text-base font-bold tracking-tight text-ink">Socios · expediente fiscal</h2>
          <p className="mt-0.5 text-xs text-muted">
            La contabilidad personal de cada socio vive aquí, al lado de su cuenta con McKenna: extractos propios,
            cruces con la empresa y la declaración de renta con activos digitales.
          </p>
        </div>
      )}

      {sociosQ.isLoading && <p className="text-sm text-muted">Cargando socios…</p>}
      {sociosQ.isError && (
        <p className="text-sm font-semibold text-danger">{(sociosQ.error as Error).message || "No se pudo cargar"}</p>
      )}
      {sociosQ.data && socios.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          Tu usuario no está vinculado a ningún socio. Pide que te vinculen desde Libro Mayor → Configurar → Terceros
          (campo «Usuario de login»).
        </p>
      )}

      {socios.length > 1 && (
        <div className="mck-stagger grid gap-2 sm:grid-cols-2" role="tablist" aria-label="Socio">
          {socios.map((s) => {
            const activo = s.id === terceroId;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={activo}
                onClick={() => setTerceroId(s.id)}
                className={`${card} flex items-center gap-3 px-3 py-2.5 text-left transition ${
                  activo ? "border-accent bg-accent/10" : "hover:bg-surface-hover"
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${activo ? "bg-accent text-white" : "bg-surface-hover text-ink-secondary"}`}>
                  <Icon name="user" size={18} weight="bold" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-ink">{s.nombre}</span>
                  <span className="block text-[11px] text-muted">
                    {s.anios} año(s) · {s.documentos} doc(s) · {s.hallazgos_abiertos} pendiente(s)
                    {s.por_corregir > 0 ? ` · ${s.por_corregir} por corregir` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {terceroId && <Wizard terceroId={terceroId} />}
    </div>
  );
}

/* ─── Wizard ──────────────────────────────────────────────────────────────── */

function Wizard({ terceroId }: { terceroId: number }) {
  const qc = useQueryClient();
  const expQ = useQuery<Expediente>({
    queryKey: ["socio-expediente", terceroId],
    queryFn: () => api.get(`/api/socios/${terceroId}/expediente`, { timeoutMs: 60_000 }),
  });
  const [paso, setPaso] = useState<PasoId>(() => {
    try {
      const v = localStorage.getItem(pasoKey(terceroId)) as PasoId | null;
      return v && v in PASOS_META ? v : "perfil";
    } catch {
      return "perfil";
    }
  });
  useEffect(() => {
    try {
      const v = localStorage.getItem(pasoKey(terceroId)) as PasoId | null;
      setPaso(v && v in PASOS_META ? v : "perfil");
    } catch {
      setPaso("perfil");
    }
  }, [terceroId]);

  function irA(p: PasoId) {
    setPaso(p);
    try {
      localStorage.setItem(pasoKey(terceroId), p);
    } catch {
      /* ignore */
    }
  }

  const refrescar = () => qc.invalidateQueries({ queryKey: ["socio-expediente", terceroId] });

  const exp = expQ.data;
  const pasos = exp?.pasos ?? [];
  const idx = pasos.findIndex((p) => p.id === paso);
  const anterior = idx > 0 ? pasos[idx - 1] : null;
  const siguiente = idx >= 0 && idx < pasos.length - 1 ? pasos[idx + 1] : null;

  if (expQ.isLoading) return <p className="text-sm text-muted">Cargando expediente…</p>;
  if (expQ.isError || !exp) {
    return (
      <p className="text-sm font-semibold text-danger">
        {(expQ.error as Error)?.message || "No se pudo cargar el expediente"}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cabecera del socio + progreso */}
      <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{exp.perfil.tercero.nombre}</p>
          <p className="text-[11px] text-muted">
            {exp.perfil.cedula ? `CC ${exp.perfil.cedula}` : "Sin cédula"}
            {exp.perfil.binance_uid ? ` · Binance ${exp.perfil.binance_uid}` : ""}
            {" · "}
            {exp.anios.length} año(s) gravable(s) · {exp.documentos.length} documento(s) · {exp.hallazgos_abiertos} pendiente(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${(exp.progreso.hechos / Math.max(1, exp.progreso.total)) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-ink-secondary">
            {exp.progreso.hechos}/{exp.progreso.total} listos
          </span>
        </div>
      </div>

      {/* Stepper */}
      <ol className="mck-stagger grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" role="tablist" aria-label="Pasos">
        {pasos.map((p, i) => {
          const st = ESTILO_PASO[p.estado];
          const activo = p.id === paso;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="tab"
                aria-selected={activo}
                title={p.detalle}
                onClick={() => irA(p.id)}
                className={`flex h-full w-full flex-col gap-1 rounded-xl border px-3 py-2 text-left transition ${st.wrap} ${
                  activo ? "ring-2 ring-accent" : "hover:brightness-95"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${st.dot}`}>
                    {p.estado === "hecho" ? "✓" : i + 1}
                  </span>
                  <span className="truncate text-xs font-bold text-ink">{p.label}</span>
                </span>
                <span className={`line-clamp-2 text-[10px] leading-snug ${st.txt}`}>{p.detalle}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Contenido del paso */}
      <div className={`${card} space-y-3 px-4 py-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
            <Icon name={PASOS_META[paso].icon} size={16} weight="bold" className="text-accent" />
            {idx + 1}. {pasos[idx]?.label}
          </h3>
          <p className="text-[11px] text-muted">{PASOS_META[paso].hint}</p>
        </div>

        {paso === "perfil" && <PasoEmpecemos terceroId={terceroId} exp={exp} onSaved={refrescar} onSiguiente={() => irA("plan")} />}
        {paso === "plan" && <PasoPlan terceroId={terceroId} exp={exp} onChanged={refrescar} onIr={irA} />}
        {paso === "extractos" && <PasoExtractos terceroId={terceroId} exp={exp} onChanged={refrescar} />}
        {paso === "mckenna" && (
          <Suspense fallback={<p className="text-sm text-muted">Cargando…</p>}>
            <CuentaSocioPanel terceroId={terceroId} />
          </Suspense>
        )}
        {paso === "cruces" && <PasoCruces terceroId={terceroId} />}
        {paso === "declarador" && <PasoDeclarador terceroId={terceroId} exp={exp} onChanged={refrescar} />}
        {paso === "cierre" && <PasoCierre terceroId={terceroId} exp={exp} onChanged={refrescar} onIr={irA} />}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" className={btnSec} disabled={!anterior} onClick={() => anterior && irA(anterior.id)}>
            ← {anterior?.label ?? "Inicio"}
          </button>
          <MarcarHecho terceroId={terceroId} paso={paso} hecho={Boolean(exp.perfil.pasos?.[paso]?.hecho)} onChanged={refrescar} />
          <button type="button" className={btnPrimario} disabled={!siguiente} onClick={() => siguiente && irA(siguiente.id)}>
            {siguiente ? `Siguiente: ${siguiente.label}` : "Fin"} →
          </button>
        </div>
      </div>
    </div>
  );
}

function MarcarHecho({ terceroId, paso, hecho, onChanged }: { terceroId: number; paso: PasoId; hecho: boolean; onChanged: () => void }) {
  const mut = useMutation({
    mutationFn: () => api.post(`/api/socios/${terceroId}/pasos/${paso}`, { hecho: !hecho }),
    onSuccess: onChanged,
  });
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-ink-secondary">
      <input type="checkbox" checked={hecho} onChange={() => mut.mutate()} disabled={mut.isPending} />
      Marcar este paso como revisado
    </label>
  );
}

/* ─── Paso 1: Empecemos (cuestionario interactivo) ────────────────────────── */

const ANIOS_OPCION = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

/**
 * Una pregunta a la vez, con botones grandes. Solo se pregunta lo que cambia
 * qué documentos se piden después; lo que ya se deduce del expediente (p. ej.
 * Armando tiene CSV de Binance → tiene cripto) aparece contestado y se puede
 * corregir. Único dato de identidad que se pide: la cédula (va en el F210).
 */
function PasoEmpecemos({ terceroId, exp, onSaved, onSiguiente }: { terceroId: number; exp: Expediente; onSaved: () => void; onSiguiente: () => void }) {
  const plan = exp.plan;
  const cq = plan.cuestionario;
  const preguntas = plan.preguntas;
  const [cedula, setCedula] = useState(exp.perfil.cedula || exp.perfil.tercero.identificacion || "");
  const [correo, setCorreo] = useState(exp.perfil.tercero.email || "");
  const [respuestas, setRespuestas] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(preguntas.map((q) => [q.id, cq[q.id]]).filter(([, v]) => v !== undefined)),
  );
  const [idx, setIdx] = useState(() => {
    const i = preguntas.findIndex((q) => cq[q.id] === undefined);
    return i === -1 ? preguntas.length : i;
  });
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const guardar = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<{ error?: string }>(`/api/socios/${terceroId}/perfil`, payload),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      onSaved();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });

  const responder = (id: string, valor: unknown) => {
    const next = { ...respuestas, [id]: valor };
    setRespuestas(next);
    guardar.mutate({ cuestionario: { [id]: valor } });
    const i = preguntas.findIndex((q) => q.id === id);
    if (i === idx) setIdx(i + 1);
  };

  const completo = preguntas.every((q) => respuestas[q.id] !== undefined);
  const actual = idx < preguntas.length ? preguntas[idx] : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Cédula (va en el Formulario 210)">
          <input
            className={input}
            value={cedula}
            onChange={(e) => setCedula(e.target.value)}
            onBlur={() => cedula.trim() && cedula !== exp.perfil.cedula && guardar.mutate({ cedula: cedula.trim() })}
            placeholder="1013630698"
            inputMode="numeric"
          />
        </Campo>
        <Campo label="Correo (opcional, para enviarte documentos)">
          <input
            className={input}
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            onBlur={() => correo !== (exp.perfil.tercero.email || "") && guardar.mutate({ email: correo.trim() })}
          />
        </Campo>
      </div>

      {/* Respondidas: chips editables */}
      <ol className="space-y-1.5">
        {preguntas.map((q, i) => {
          const v = respuestas[q.id];
          const respondida = v !== undefined;
          const inferida = cq._inferido?.includes(q.id) && !cq._respondido?.includes(q.id);
          const activa = i === idx;
          if (!respondida && !activa) {
            return (
              <li key={q.id} className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-hover text-[11px] font-bold">{i + 1}</span>
                {q.pregunta}
              </li>
            );
          }
          if (activa && !respondida) {
            return (
              <li key={q.id} className="space-y-2 rounded-xl border-2 border-accent bg-accent/5 px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-bold text-ink">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">{i + 1}</span>
                  {q.pregunta}
                </p>
                <p className="text-[11px] text-muted">{q.ayuda}</p>
                {q.tipo === "sino" ? (
                  <div className="flex gap-2">
                    <button type="button" className={btnPrimario} onClick={() => responder(q.id, true)}>Sí</button>
                    <button type="button" className={btnSec} onClick={() => responder(q.id, false)}>No</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {ANIOS_OPCION.map((a) => (
                      <button key={a} type="button" className={btnSec} onClick={() => responder(q.id, a)}>{a}</button>
                    ))}
                  </div>
                )}
              </li>
            );
          }
          return (
            <li key={q.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600/5 px-3 py-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">✓</span>
              <span className="min-w-0 flex-1 text-xs text-ink">{q.pregunta}</span>
              <span className="rounded-full bg-surface-panel px-2 py-0.5 text-[11px] font-bold text-ink">
                {q.tipo === "sino" ? (v ? "Sí" : "No") : String(v)}
                {inferida && <span className="ml-1 font-normal text-muted">(deducido)</span>}
              </span>
              <button type="button" className="text-[11px] font-bold text-accent underline" onClick={() => setIdx(i)}>
                cambiar
              </button>
              {i === idx && (
                <div className="flex w-full flex-wrap gap-1.5 pt-1">
                  {q.tipo === "sino" ? (
                    <>
                      <button type="button" className={btnPrimario} onClick={() => responder(q.id, true)}>Sí</button>
                      <button type="button" className={btnSec} onClick={() => responder(q.id, false)}>No</button>
                    </>
                  ) : (
                    ANIOS_OPCION.map((a) => (
                      <button key={a} type="button" className={btnSec} onClick={() => responder(q.id, a)}>{a}</button>
                    ))
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <Msg m={msg} />
      {completo && !actual && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600/5 px-3 py-2">
          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Listo. Con esto ya sabemos qué pedirte.</span>
          <button type="button" className={btnPrimario} onClick={onSiguiente}>Ver mi plan de carga →</button>
        </div>
      )}
    </div>
  );
}

/* ─── Paso 2: Plan de carga (guiado, con referencia del otro socio) ───────── */

const ESTILO_REQ: Record<Requisito["estado"], { wrap: string; badge: string; label: string }> = {
  hecho: { wrap: "border-emerald-600/30", badge: "bg-emerald-600 text-white", label: "Completo" },
  parcial: { wrap: "border-amber-600/40", badge: "bg-amber-500 text-white", label: "A medias" },
  pendiente: { wrap: "border-danger/40", badge: "bg-danger text-white", label: "Falta" },
  no_aplica: { wrap: "border-border opacity-60", badge: "bg-surface-hover text-muted", label: "No aplica" },
  omitido: { wrap: "border-border opacity-60", badge: "bg-surface-hover text-muted", label: "Omitido" },
};

function PasoPlan({ terceroId, exp, onChanged, onIr }: { terceroId: number; exp: Expediente; onChanged: () => void; onIr: (p: PasoId) => void }) {
  const plan = exp.plan;
  const ref = plan.referencia;
  const [abierto, setAbierto] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendienteRef = useRef<{ categoria: string; ano?: number } | null>(null);

  const omitir = useMutation({
    mutationFn: (v: { id: string; omitir: boolean }) => {
      const set = new Set(plan.cuestionario.omitidos ?? []);
      if (v.omitir) set.add(v.id);
      else set.delete(v.id);
      return api.post(`/api/socios/${terceroId}/perfil`, { cuestionario: { omitidos: [...set] } });
    },
    onSuccess: onChanged,
  });
  const carpeta = useMutation({
    mutationFn: () => api.post<{ error?: string; carpeta?: string; creadas?: string[]; existia?: boolean }>(`/api/socios/${terceroId}/carpeta`, {}),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      setMsg({ tipo: "ok", texto: r.existia ? `La carpeta ya existía: ${r.carpeta}` : `Carpeta creada en ${r.carpeta} (${r.creadas?.length} elementos, con LEEME y plantilla).` });
      onChanged();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });
  const importar = useMutation({
    mutationFn: () => api.post<{ error?: string; documentos_nuevos?: number }>(`/api/socios/${terceroId}/importar-carpeta`, {}, { timeoutMs: 120_000 }),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      setMsg({ tipo: "ok", texto: `${r.documentos_nuevos} documento(s) nuevo(s) registrados desde la carpeta.` });
      onChanged();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });

  const pedirArchivo = (categoria: string, ano?: number) => {
    pendienteRef.current = { categoria, ano };
    fileRef.current?.click();
  };
  const subir = async (file: File) => {
    const p = pendienteRef.current;
    if (!p) return;
    setSubiendo(p.categoria);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      fd.append("categoria", p.categoria);
      if (p.ano) fd.append("ano", String(p.ano));
      const r = await api.upload<{ error?: string }>(`/api/socios/${terceroId}/documentos`, fd, { timeoutMs: 120_000 });
      if (r.error) throw new Error(r.error);
      setMsg({ tipo: "ok", texto: `«${file.name}» guardado${p.ano ? ` (${p.ano})` : ""}.` });
      onChanged();
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message });
    } finally {
      setSubiendo(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const aplicables = plan.requisitos.filter((r) => r.aplica);
  const primeroPendiente = aplicables.find((r) => r.estado === "pendiente" || r.estado === "parcial");

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />

      {/* Referencia + carpeta */}
      <div className="grid gap-2 lg:grid-cols-2">
        <div className={`${card} px-3 py-2.5`}>
          {ref ? (
            <>
              <p className="text-xs font-bold text-ink">Así lo hizo {ref.nombre}</p>
              <p className="text-[11px] text-muted">
                {ref.documentos} documentos organizados{ref.desde ? ` desde ${ref.desde}` : ""}: en cada renglón de abajo verás «{ref.nombre}: n» para
                comparar con lo tuyo. Solo se muestran cantidades, no cifras ni archivos.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted">Eres el primer socio en organizar el expediente; tu carpeta servirá de referencia para el otro.</p>
          )}
        </div>
        <div className={`${card} space-y-1.5 px-3 py-2.5`}>
          <p className="text-xs font-bold text-ink">Tu carpeta en el servidor</p>
          <p className="break-all font-mono text-[11px] text-ink-secondary">{plan.carpeta}</p>
          <div className="flex flex-wrap gap-1.5">
            {!plan.carpeta_existe ? (
              <button type="button" className={btnPrimario} disabled={carpeta.isPending} onClick={() => carpeta.mutate()}>
                <Icon name="folder" size={14} weight="bold" /> Crear carpeta con la estructura de {ref?.nombre ?? "referencia"}
              </button>
            ) : (
              <button type="button" className={btnSec} disabled={importar.isPending} onClick={() => importar.mutate()}>
                <Icon name="refresh" size={14} weight="bold" /> {importar.isPending ? "Importando…" : "Registrar lo que dejé en la carpeta"}
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted">
            Puedes dejar los archivos en esa carpeta (hay un LEEME con qué va dónde) o subirlos aquí renglón por renglón. Da igual: el expediente queda igual.
          </p>
        </div>
      </div>
      <Msg m={msg} />

      {primeroPendiente && (
        <p className="rounded-lg bg-amber-600/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
          Siguiente cosa por conseguir: <b>{primeroPendiente.titulo}</b>. Abre el renglón para ver cómo.
        </p>
      )}

      {/* Requisitos */}
      <ol className="space-y-2">
        {plan.requisitos.map((r) => {
          const st = ESTILO_REQ[r.estado];
          const open = abierto === r.id;
          return (
            <li key={r.id} className={`${card} ${st.wrap}`}>
              <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left" onClick={() => setAbierto(open ? null : r.id)}>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.badge}`}>{st.label}</span>
                <span className="min-w-0 flex-1 text-sm font-bold text-ink">{r.titulo}</span>
                {r.aplica && !r.omitido && (
                  <span className="text-[11px] tabular-nums text-muted">
                    tú: <b className="text-ink">{r.mios}</b>
                    {ref ? <> · {ref.nombre}: <b className="text-ink">{r.ref}</b></> : null}
                  </span>
                )}
                <Icon name={open ? "caretDown" : "caretDown"} size={14} weight="bold" className={`text-muted transition ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <div className="space-y-3 border-t border-border px-3 py-3">
                  <p className="text-xs text-ink-secondary"><b>Para qué:</b> {r.por_que}</p>
                  <p className="text-xs text-ink-secondary"><b>Cómo conseguirlo:</b> {r.como}</p>
                  {r.aplica && !r.omitido && r.por_anio && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.anios.map((a) => (
                        <div key={a.ano} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${a.ok ? "border-emerald-600/40 bg-emerald-600/5" : "border-border"}`}>
                          <span className="font-bold tabular-nums text-ink">{a.ano}</span>
                          <span className="text-muted">
                            {a.mios}{a.unidad === "meses" ? "/12 m" : ""}
                            {ref ? ` · ${ref.nombre} ${a.ref}${a.unidad === "meses" ? "/12" : ""}` : ""}
                          </span>
                          {r.es_extracto ? (
                            <button type="button" className="font-bold text-accent underline" onClick={() => onIr("extractos")}>cargar</button>
                          ) : (
                            <button type="button" className="font-bold text-accent underline" disabled={subiendo === r.categoria} onClick={() => pedirArchivo(r.categoria, a.ano)}>
                              {a.ok ? "+1" : "subir"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {r.aplica && !r.omitido && !r.por_anio && (
                      <button type="button" className={btnPrimario} disabled={subiendo === r.categoria} onClick={() => pedirArchivo(r.categoria)}>
                        <Icon name="paperclip" size={14} weight="bold" /> {subiendo === r.categoria ? "Subiendo…" : "Subir archivo"}
                      </button>
                    )}
                    {r.aplica && !r.omitido && r.por_anio && !r.es_extracto && (
                      <button type="button" className={btnSec} disabled={subiendo === r.categoria} onClick={() => pedirArchivo(r.categoria)}>
                        <Icon name="paperclip" size={14} weight="bold" /> Subir sin año
                      </button>
                    )}
                    {r.aplica && (
                      <button type="button" className={btnSec} disabled={omitir.isPending} onClick={() => omitir.mutate({ id: r.id, omitir: !r.omitido })}>
                        {r.omitido ? "Volver a pedirlo" : "No aplica en mi caso"}
                      </button>
                    )}
                    {!r.aplica && <span className="text-[11px] text-muted">Según tus respuestas no hace falta. Cambia la respuesta en «Empecemos» si sí aplica.</span>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ─── Paso 2: Extractos personales ───────────────────────────────────────── */

function PasoExtractos({ terceroId, exp, onChanged }: { terceroId: number; exp: Expediente; onChanged: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [banco, setBanco] = useState("Bancolombia");
  const [cuenta, setCuenta] = useState("");
  const [nombre, setNombre] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verId, setVerId] = useState<number | null>(null);

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["extractos-bancarios"] });
    onChanged();
  };

  const subir = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      fd.append("tercero_id", String(terceroId));
      if (banco.trim()) fd.append("banco", banco.trim());
      if (cuenta.trim()) fd.append("cuenta", cuenta.trim());
      if (nombre.trim()) fd.append("nombre", nombre.trim());
      const r = await api.upload<{ ok?: boolean; error?: string; extracto?: ExtractoResumen }>(
        "/api/contabilidad/extractos",
        fd,
        { timeoutMs: 180_000 },
      );
      if (r.error) throw new Error(r.error);
      setMsg({
        tipo: "ok",
        texto: `Extracto «${r.extracto?.nombre}» guardado: ${r.extracto?.lineas_count ?? 0} líneas (${r.extracto?.periodo_desde} → ${r.extracto?.periodo_hasta}).`,
      });
      setNombre("");
      invalidar();
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message || "No se pudo subir" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const borrar = useMutation({
    mutationFn: (id: number) => api.delete(`/api/contabilidad/extractos/${id}`),
    onSuccess: invalidar,
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });

  const verQ = useQuery<{ movimientos: LineaBanco[]; nombre: string }>({
    queryKey: ["extracto-detalle", verId],
    queryFn: () => api.get(`/api/contabilidad/extractos/${verId}`),
    enabled: verId != null,
  });

  const anios = useMemo(() => Object.keys(exp.cobertura.anios).sort(), [exp.cobertura]);
  const mesesCubiertos = useMemo(() => {
    const s = new Set<string>();
    for (const c of exp.cobertura.cuentas) for (const m of c.meses) s.add(m);
    return s;
  }, [exp.cobertura]);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3 p-3`}>
        <p className="text-xs text-muted">
          Sube el extracto del banco <b>del socio</b> (CSV, Excel o PDF). Queda marcado como personal: no entra a la
          conciliación de McKenna, solo se cruza con ella en el paso «Cruces».
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Campo label="Banco">
            <input className={`${input} w-40`} value={banco} onChange={(e) => setBanco(e.target.value)} />
          </Campo>
          <Campo label="Cuenta">
            <input className={`${input} w-40`} value={cuenta} onChange={(e) => setCuenta(e.target.value)} placeholder="912-004312-49" />
          </Campo>
          <Campo label="Nombre (opcional)">
            <input className={`${input} w-52`} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ahorros 2025 T1" />
          </Campo>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.txt,.tsv,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
            }}
          />
          <button type="button" className={btnPrimario} disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="download" size={14} weight="bold" />
            {busy ? "Subiendo…" : "Subir extracto"}
          </button>
        </div>
        <Msg m={msg} />
      </div>

      {/* Cobertura mensual */}
      <div>
        <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Cobertura por mes</h4>
        {anios.length === 0 ? (
          <p className="text-xs text-muted">Aún no hay extractos personales cargados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-center text-[11px]">
              <thead>
                <tr className="text-muted">
                  <th className="px-2 py-1 text-left font-bold">Año</th>
                  {MESES.map((m) => (
                    <th key={m} className="px-1 py-1 font-bold">{m}</th>
                  ))}
                  <th className="px-2 py-1 font-bold">Faltan</th>
                </tr>
              </thead>
              <tbody>
                {anios.map((a) => {
                  const info = exp.cobertura.anios[a];
                  return (
                    <tr key={a} className="border-t border-border/50">
                      <td className="px-2 py-1 text-left font-bold tabular-nums text-ink">{a}</td>
                      {MESES.map((_, i) => {
                        const key = `${a}-${String(i + 1).padStart(2, "0")}`;
                        const ok = mesesCubiertos.has(key);
                        return (
                          <td key={key} className="px-1 py-1">
                            <span
                              title={key}
                              className={`inline-block h-4 w-4 rounded ${ok ? "bg-emerald-600" : "bg-danger/30"}`}
                            />
                          </td>
                        );
                      })}
                      <td className={`px-2 py-1 font-bold ${info.faltan.length ? "text-danger" : "text-emerald-700"}`}>
                        {info.faltan.length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {exp.cobertura.cuentas.length > 0 && (
          <p className="mt-1 text-[11px] text-muted">
            Cuentas: {exp.cobertura.cuentas.map((c) => `${c.banco || "?"} ${c.cuenta || ""} (${c.desde} → ${c.hasta}, ${c.lineas} líneas)`).join(" · ")}
          </p>
        )}
      </div>

      {/* Lista */}
      <div>
        <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Extractos cargados ({exp.extractos.length})</h4>
        <div className="space-y-1.5">
          {exp.extractos.map((ex) => (
            <div key={ex.id} className={`${card} flex flex-wrap items-center justify-between gap-2 px-3 py-2`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{ex.nombre}</p>
                <p className="text-[11px] text-muted">
                  {ex.banco} {ex.cuenta} · {ex.periodo_desde} → {ex.periodo_hasta} · {ex.lineas_count} líneas
                </p>
              </div>
              <div className="flex gap-1.5">
                <button type="button" className={btnSec} onClick={() => setVerId(verId === ex.id ? null : ex.id)}>
                  {verId === ex.id ? "Ocultar" : "Ver líneas"}
                </button>
                <button
                  type="button"
                  className={btnSec}
                  onClick={() => void abrirArchivo(`/api/contabilidad/extractos/${ex.id}/archivo`, (t) => setMsg({ tipo: "error", texto: t }))}
                >
                  Archivo
                </button>
                <button
                  type="button"
                  className={`${btnSec} text-danger`}
                  onClick={() => {
                    if (window.confirm(`¿Eliminar el extracto «${ex.nombre}» y sus ${ex.lineas_count} líneas?`)) borrar.mutate(ex.id);
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
        {verId != null && (
          <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-border">
            {verQ.isLoading && <p className="p-3 text-xs text-muted">Cargando líneas…</p>}
            {verQ.data && <TablaLineas lineas={verQ.data.movimientos} />}
          </div>
        )}
      </div>
    </div>
  );
}

function TablaLineas({ lineas }: { lineas: LineaBanco[] }) {
  return (
    <table className="min-w-full text-left text-xs">
      <thead className="sticky top-0 border-b border-border bg-surface text-[10px] uppercase text-muted">
        <tr>
          <th className="px-3 py-1.5 font-bold">Fecha</th>
          <th className="px-3 py-1.5 font-bold">Descripción</th>
          <th className="px-3 py-1.5 text-right font-bold">Monto</th>
        </tr>
      </thead>
      <tbody>
        {lineas.map((l) => (
          <tr key={l.id} className="border-t border-border/50">
            <td className="px-3 py-1 tabular-nums text-ink">{l.fecha}</td>
            <td className="px-3 py-1 text-ink">{l.descripcion}</td>
            <td className={`px-3 py-1 text-right tabular-nums font-semibold ${l.tipo === "debito" ? "text-danger" : "text-emerald-700"}`}>
              {l.tipo === "debito" ? "−" : "+"}
              {cop(Math.abs(l.monto))}
            </td>
          </tr>
        ))}
        {lineas.length === 0 && (
          <tr>
            <td colSpan={3} className="px-3 py-3 text-center text-muted">Sin líneas</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/* ─── Paso 4: Cruces ──────────────────────────────────────────────────────── */

function haceMeses(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function PasoCruces({ terceroId }: { terceroId: number }) {
  const [desde, setDesde] = useState(() => haceMeses(12));
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const q = useQuery<Cruces>({
    queryKey: ["socio-cruces", terceroId, desde, hasta],
    queryFn: () => api.get(`/api/socios/${terceroId}/cruces?desde=${desde}&hasta=${hasta}`, { timeoutMs: 60_000 }),
  });
  const c = q.data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Campo label="Desde">
          <input type="date" className={`${input} w-40`} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Campo>
        <Campo label="Hasta">
          <input type="date" className={`${input} w-40`} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </Campo>
      </div>
      {q.isLoading && <p className="text-xs text-muted">Cruzando…</p>}
      {c?.sin_extracto_socio && (
        <p className="rounded-lg bg-amber-600/10 px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          Sin extracto personal en este rango: carga primero uno en el paso «Extractos personales».
        </p>
      )}
      {c && !c.sin_extracto_socio && (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Kpi label="Giros cruzados" valor={String(c.resumen.pares)} />
            <Kpi label="Con asiento en McKenna" valor={String(c.resumen.contabilizados)} tono="ok" />
            <Kpi label="Sin asiento en McKenna" valor={String(c.resumen.sin_asiento)} tono={c.resumen.sin_asiento ? "warn" : "ok"} />
            <Kpi label="Mencionan McKenna sin par" valor={String(c.resumen.sin_par)} tono={c.resumen.sin_par ? "warn" : "ok"} />
          </div>
          <p className="text-[11px] text-muted">
            Un giro «sin asiento» existe en los dos bancos pero nadie lo contabilizó en McKenna: regístralo en Libro
            Mayor → Registrar (pago a socio, reintegro, préstamo). Uno «sin par» aparece solo en el banco del socio:
            falta el extracto de la empresa de ese mes o salió por otra cuenta.
          </p>
          <TablaCruces titulo="McKenna → socio" filas={c.empresa_a_socio} />
          <TablaCruces titulo="Socio → McKenna" filas={c.socio_a_empresa} />
          {c.mencionan_mckenna_sin_par.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
                Mencionan a McKenna sin contraparte ({c.mencionan_mckenna_sin_par.length})
              </h4>
              <div className="max-h-64 overflow-auto rounded-xl border border-border">
                <TablaLineas lineas={c.mencionan_mckenna_sin_par} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, valor, tono }: { label: string; valor: string; tono?: "ok" | "warn" }) {
  return (
    <div className={`${card} px-3 py-2`}>
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold tabular-nums ${tono === "ok" ? "text-emerald-700" : tono === "warn" ? "text-amber-700" : "text-ink"}`}>
        {valor}
      </p>
    </div>
  );
}

function TablaCruces({ titulo, filas }: { titulo: string; filas: Cruces["empresa_a_socio"] }) {
  if (filas.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
        {titulo} ({filas.length})
      </h4>
      <div className="max-h-64 overflow-auto rounded-xl border border-border">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 border-b border-border bg-surface text-[10px] uppercase text-muted">
            <tr>
              <th className="px-3 py-1.5 font-bold">Banco McKenna</th>
              <th className="px-3 py-1.5 font-bold">Banco socio</th>
              <th className="px-3 py-1.5 text-right font-bold">Monto</th>
              <th className="px-3 py-1.5 font-bold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={`${f.empresa.id}-${f.socio.id}`} className="border-t border-border/50">
                <td className="px-3 py-1 text-ink">
                  <span className="tabular-nums text-muted">{f.empresa.fecha}</span> {f.empresa.descripcion}
                </td>
                <td className="px-3 py-1 text-ink">
                  <span className="tabular-nums text-muted">{f.socio.fecha}</span> {f.socio.descripcion}
                </td>
                <td className="px-3 py-1 text-right tabular-nums font-semibold text-ink">{cop(f.monto)}</td>
                <td className="px-3 py-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${f.contabilizado ? "bg-emerald-600/10 text-emerald-700" : "bg-amber-600/15 text-amber-800"}`}>
                    {f.contabilizado ? "Con asiento" : "Sin asiento"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Paso 5: Declarador (activos digitales) ─────────────────────────────── */

type SubDecl = "anios" | "documentos" | "pendientes" | "agente";

function PasoDeclarador({ terceroId, exp, onChanged }: { terceroId: number; exp: Expediente; onChanged: () => void }) {
  const [sub, setSub] = useState<SubDecl>("anios");
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const importar = useMutation({
    mutationFn: () =>
      api.post<{ ok?: boolean; error?: string; documentos_nuevos?: number; anios_sembrados?: number; hallazgos_sembrados?: number; anios_con_cripto?: number; carpeta?: string }>(
        `/api/socios/${terceroId}/importar-carpeta`,
        { carpeta: exp.perfil.carpeta || undefined },
        { timeoutMs: 120_000 },
      ),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      setMsg({
        tipo: "ok",
        texto: `Importado desde ${r.carpeta}: ${r.documentos_nuevos} documento(s) nuevo(s), ${r.anios_sembrados} año(s) declarado(s), ${r.anios_con_cripto} año(s) con efecto cripto, ${r.hallazgos_sembrados} pendiente(s).`,
      });
      onChanged();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });

  const tabs: { id: SubDecl; label: string; n: number }[] = [
    { id: "anios", label: "Años gravables", n: exp.anios.length },
    { id: "documentos", label: "Documentos", n: exp.documentos.length },
    { id: "pendientes", label: "Pendientes", n: exp.hallazgos_abiertos },
    { id: "agente", label: "Agente", n: 0 },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={sub === t.id}
              onClick={() => setSub(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                sub === t.id ? "bg-accent text-white" : "border border-border bg-surface-panel text-ink hover:border-accent"
              }`}
            >
              {t.label}
              {t.n > 0 && <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-[10px]">{t.n}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={btnSec}
          disabled={importar.isPending}
          title="Registra los archivos de la carpeta del Declarador (sin copiarlos), los años declarados, el efecto cripto por año y los pendientes conocidos. Se puede repetir sin duplicar."
          onClick={() => importar.mutate()}
        >
          <Icon name="folder" size={14} weight="bold" />
          {importar.isPending ? "Importando…" : "Importar carpeta del Declarador"}
        </button>
      </div>
      <Msg m={msg} />
      {sub === "anios" && <TablaAnios terceroId={terceroId} anios={exp.anios} onChanged={onChanged} />}
      {sub === "documentos" && <Documentos terceroId={terceroId} exp={exp} onChanged={onChanged} />}
      {sub === "pendientes" && <Hallazgos terceroId={terceroId} hallazgos={exp.hallazgos} onChanged={onChanged} />}
      {sub === "agente" && <Agente terceroId={terceroId} onChanged={onChanged} />}
    </div>
  );
}

function TablaAnios({ terceroId, anios, onChanged }: { terceroId: number; anios: Anio[]; onChanged: () => void }) {
  const [edit, setEdit] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [nuevo, setNuevo] = useState("");
  const mut = useMutation({
    mutationFn: (v: { ano: number; campos: Record<string, string> }) =>
      api.patch<{ error?: string }>(`/api/socios/${terceroId}/anios/${v.ano}`, v.campos),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      setEdit(null);
      setMsg({ tipo: "ok", texto: "Año actualizado" });
      onChanged();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });

  const abrir = (a: Anio) => {
    setEdit(a.ano);
    setForm({
      formulario: a.formulario || "",
      presentada_en: a.presentada_en || "",
      patrimonio_bruto: a.patrimonio_bruto?.toString() ?? "",
      deudas: a.deudas?.toString() ?? "",
      renta_liquida: a.renta_liquida?.toString() ?? "",
      impuesto_pagado: a.impuesto_pagado?.toString() ?? "",
      tenencia_cierre_usd: a.tenencia_cierre_usd?.toString() ?? "",
      estado: a.estado,
      notas: a.notas || "",
    });
  };

  const totalCripto = anios.reduce((s, a) => s + (a.cripto_total ?? 0), 0);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        Izquierda: lo que dice el F210 presentado. Derecha: lo que arroja el motor FIFO de criptoactivos del
        Declarador para ese año. Si un año presentado tiene efecto cripto, queda marcado «revisar».
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-border bg-surface text-[10px] uppercase text-muted">
            <tr>
              <th className="px-3 py-2 font-bold">Año</th>
              <th className="px-3 py-2 font-bold">Estado</th>
              <th className="px-3 py-2 text-right font-bold">Patrimonio bruto</th>
              <th className="px-3 py-2 text-right font-bold">Deudas</th>
              <th className="px-3 py-2 text-right font-bold">Renta líquida</th>
              <th className="px-3 py-2 text-right font-bold">Impuesto</th>
              <th className="px-3 py-2 text-right font-bold">Cripto renta ord.</th>
              <th className="px-3 py-2 text-right font-bold">Cripto gan. ocas.</th>
              <th className="px-3 py-2 text-right font-bold">Tenencia cierre</th>
              <th className="px-3 py-2 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {anios.map((a) => (
              <tr key={a.ano} className={`border-t border-border/50 ${a.requiere_revision ? "bg-amber-600/5" : ""}`}>
                <td className="px-3 py-1.5 font-bold tabular-nums text-ink">
                  {a.ano}
                  {a.formulario && <span className="block text-[10px] font-normal text-muted">F {a.formulario}</span>}
                </td>
                <td className="px-3 py-1.5">
                  <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold text-ink">{ESTADO_ANIO_LABEL[a.estado] ?? a.estado}</span>
                  {a.requiere_revision && <span className="ml-1 rounded-full bg-amber-600/15 px-2 py-0.5 text-[10px] font-bold text-amber-800">revisar</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{cop(a.patrimonio_bruto)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{cop(a.deudas)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{cop(a.renta_liquida)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{cop(a.impuesto_pagado)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${(a.cripto_renta_ordinaria ?? 0) < 0 ? "text-danger" : "text-ink"}`}>
                  {cop(a.cripto_renta_ordinaria)}
                  {a.cripto_eventos ? <span className="block text-[10px] font-normal text-muted">{a.cripto_eventos} eventos</span> : null}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{cop(a.cripto_ganancia_ocasional)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{usd(a.tenencia_cierre_usd)}</td>
                <td className="px-3 py-1.5">
                  <button type="button" className={btnSec} onClick={() => (edit === a.ano ? setEdit(null) : abrir(a))}>
                    {edit === a.ano ? "Cerrar" : "Editar"}
                  </button>
                </td>
              </tr>
            ))}
            {anios.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-center text-muted">
                  Sin años gravables. Importa la carpeta del Declarador o agrega uno abajo.
                </td>
              </tr>
            )}
          </tbody>
          {anios.length > 0 && (
            <tfoot className="border-t border-border bg-surface text-[11px] font-bold text-ink">
              <tr>
                <td className="px-3 py-1.5" colSpan={6}>Efecto cripto acumulado (todos los años)</td>
                <td className="px-3 py-1.5 text-right tabular-nums" colSpan={2}>{cop(totalCripto)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {edit != null && (
        <form
          className={`${card} space-y-3 p-3`}
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate({ ano: edit, campos: form });
          }}
        >
          <p className="text-sm font-bold text-ink">Año gravable {edit}</p>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {(
              [
                ["formulario", "Nº formulario", "text"],
                ["presentada_en", "Presentada el", "date"],
                ["patrimonio_bruto", "Patrimonio bruto (r.29)", "number"],
                ["deudas", "Deudas (r.30)", "number"],
                ["renta_liquida", "Renta líquida gravable", "number"],
                ["impuesto_pagado", "Impuesto pagado", "number"],
                ["tenencia_cierre_usd", "Tenencia cripto 31-dic (USD)", "number"],
              ] as [string, string, string][]
            ).map(([k, l, t]) => (
              <Campo key={k} label={l}>
                <input className={input} type={t} value={form[k] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))} />
              </Campo>
            ))}
            <Campo label="Estado">
              <select className={input} value={form.estado} onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value }))}>
                {Object.entries(ESTADO_ANIO_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Campo>
          </div>
          <Campo label="Notas">
            <textarea className={`${input} min-h-[60px]`} value={form.notas ?? ""} onChange={(e) => setForm((p) => ({ ...p, notas: e.target.value }))} />
          </Campo>
          <div className="flex items-center gap-2">
            <button type="submit" className={btnPrimario} disabled={mut.isPending}>Guardar</button>
            <Msg m={msg} />
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Campo label="Agregar año">
          <input className={`${input} w-28`} type="number" min={2015} max={2035} value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="2026" />
        </Campo>
        <button
          type="button"
          className={btnSec}
          disabled={!nuevo}
          onClick={() => {
            mut.mutate({ ano: Number(nuevo), campos: { estado: "sin_datos" } });
            setNuevo("");
          }}
        >
          <Icon name="plus" size={14} weight="bold" /> Agregar
        </button>
      </div>
    </div>
  );
}

function Documentos({ terceroId, exp, onChanged }: { terceroId: number; exp: Expediente; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [categoria, setCategoria] = useState("declaracion_f210");
  const [ano, setAno] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [filtro, setFiltro] = useState<string>("todas");
  const [previewId, setPreviewId] = useState<number | null>(null);

  const subir = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      fd.append("categoria", categoria);
      if (ano) fd.append("ano", ano);
      const r = await api.upload<{ ok?: boolean; error?: string }>(`/api/socios/${terceroId}/documentos`, fd, { timeoutMs: 120_000 });
      if (r.error) throw new Error(r.error);
      setMsg({ tipo: "ok", texto: `«${file.name}» guardado en el expediente.` });
      onChanged();
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const borrar = useMutation({
    mutationFn: (id: number) => api.delete(`/api/socios/${terceroId}/documentos/${id}`),
    onSuccess: onChanged,
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });
  const previewQ = useQuery<{ texto: string }>({
    queryKey: ["socio-doc-texto", terceroId, previewId],
    queryFn: () => api.get(`/api/socios/${terceroId}/documentos/${previewId}/texto?max_chars=6000`),
    enabled: previewId != null,
  });

  const grupos = useMemo(() => {
    const m = new Map<string, Documento[]>();
    for (const d of exp.documentos) {
      if (filtro !== "todas" && d.categoria !== filtro) continue;
      m.set(d.categoria, [...(m.get(d.categoria) ?? []), d]);
    }
    return exp.categorias.filter((c) => m.has(c.id)).map((c) => ({ ...c, docs: m.get(c.id)! }));
  }, [exp, filtro]);

  return (
    <div className="space-y-3">
      <div className={`${card} space-y-2 p-3`}>
        <div className="flex flex-wrap items-end gap-2">
          <Campo label="Categoría">
            <select className={`${input} w-64`} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {exp.categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Año gravable">
            <input className={`${input} w-28`} type="number" value={ano} onChange={(e) => setAno(e.target.value)} placeholder="2025" />
          </Campo>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />
          <button type="button" className={btnPrimario} disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="paperclip" size={14} weight="bold" />
            {busy ? "Subiendo…" : "Subir documento"}
          </button>
        </div>
        <Msg m={msg} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFiltro("todas")} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${filtro === "todas" ? "bg-accent text-white" : "border border-border text-ink"}`}>
          Todas ({exp.documentos.length})
        </button>
        {exp.categorias
          .filter((c) => exp.documentos_por_categoria[c.id])
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFiltro(c.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${filtro === c.id ? "bg-accent text-white" : "border border-border text-ink"}`}
            >
              {c.label} ({exp.documentos_por_categoria[c.id]})
            </button>
          ))}
      </div>

      {grupos.length === 0 && <p className="text-xs text-muted">Sin documentos. Sube uno o importa la carpeta del Declarador.</p>}
      {grupos.map((g) => (
        <div key={g.id}>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{g.label} ({g.docs.length})</h4>
          <div className="space-y-1">
            {g.docs.map((d) => (
              <div key={d.id} className={`${card} flex flex-wrap items-center justify-between gap-2 px-3 py-1.5`}>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ink">
                    {d.archivo_nombre}
                    {!d.existe && <span className="ml-1 text-[10px] text-danger">(no está en disco)</span>}
                  </p>
                  <p className="text-[10px] text-muted">
                    {d.ano ?? "sin año"} · {kb(d.tamano)} · {d.origen === "carpeta" ? "carpeta Declarador" : "subido"}
                  </p>
                </div>
                <div className="flex gap-1">
                  {d.legible && (
                    <button type="button" className={btnSec} onClick={() => setPreviewId(previewId === d.id ? null : d.id)}>
                      {previewId === d.id ? "Ocultar" : "Leer"}
                    </button>
                  )}
                  {d.existe && (
                    <button type="button" className={btnSec} onClick={() => void abrirArchivo(`/api/socios/${terceroId}/documentos/${d.id}/archivo`, (t) => setMsg({ tipo: "error", texto: t }))}>
                      Abrir
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${btnSec} text-danger`}
                    onClick={() => {
                      if (window.confirm(d.origen === "subido" ? `¿Borrar «${d.archivo_nombre}» del expediente y del disco?` : `¿Quitar «${d.archivo_nombre}» del expediente? (el archivo original no se toca)`))
                        borrar.mutate(d.id);
                    }}
                  >
                    Quitar
                  </button>
                </div>
                {previewId === d.id && (
                  <pre className="mt-1 max-h-72 w-full overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-2 text-[10px] text-ink">
                    {previewQ.isLoading ? "Leyendo…" : previewQ.data?.texto}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Hallazgos({ terceroId, hallazgos, onChanged }: { terceroId: number; hallazgos: Hallazgo[]; onChanged: () => void }) {
  const [mostrarCerrados, setMostrarCerrados] = useState(false);
  const [nuevo, setNuevo] = useState({ titulo: "", detalle: "", severidad: "media", ano: "" });
  const [resol, setResol] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const crear = useMutation({
    mutationFn: () => api.post<{ error?: string }>(`/api/socios/${terceroId}/hallazgos`, nuevo),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      setNuevo({ titulo: "", detalle: "", severidad: "media", ano: "" });
      onChanged();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });
  const cambiar = useMutation({
    mutationFn: (v: { id: number; estado: string; resolucion?: string }) =>
      api.patch<{ error?: string }>(`/api/socios/${terceroId}/hallazgos/${v.id}`, v),
    onSuccess: onChanged,
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });
  const lista = hallazgos.filter((h) => mostrarCerrados || h.estado === "pendiente" || h.estado === "en_curso");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted">
          Preguntas abiertas y correcciones por hacer. Vienen de la carpeta del Declarador, del propio análisis de
          los datos (años presentados sin cripto) o del agente. Ciérralas con una nota de qué se decidió.
        </p>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-secondary">
          <input type="checkbox" checked={mostrarCerrados} onChange={(e) => setMostrarCerrados(e.target.checked)} />
          Ver resueltos
        </label>
      </div>
      <Msg m={msg} />
      <div className="space-y-2">
        {lista.map((h) => (
          <div key={h.id} className={`${card} space-y-1.5 px-3 py-2 ${h.estado === "resuelto" || h.estado === "descartado" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SEV_BADGE[h.severidad]}`}>{h.severidad}</span>
              {h.ano && <span className="text-[10px] font-bold tabular-nums text-muted">{h.ano}</span>}
              <span className="text-sm font-bold text-ink">{h.titulo}</span>
              <span className="ml-auto rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold text-ink-secondary">{h.estado.replace("_", " ")}</span>
            </div>
            <p className="text-xs text-ink-secondary">{h.detalle}</p>
            {h.resolucion && <p className="text-xs text-emerald-700 dark:text-emerald-400">✓ {h.resolucion}</p>}
            {(h.estado === "pendiente" || h.estado === "en_curso") && (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  className={`${input} min-w-[220px] flex-1`}
                  placeholder="Qué se decidió / cómo se resolvió"
                  value={resol[h.id] ?? ""}
                  onChange={(e) => setResol((p) => ({ ...p, [h.id]: e.target.value }))}
                />
                {h.estado === "pendiente" && (
                  <button type="button" className={btnSec} onClick={() => cambiar.mutate({ id: h.id, estado: "en_curso" })}>En curso</button>
                )}
                <button type="button" className={btnPrimario} onClick={() => cambiar.mutate({ id: h.id, estado: "resuelto", resolucion: resol[h.id] ?? "" })}>Resuelto</button>
                <button type="button" className={btnSec} onClick={() => cambiar.mutate({ id: h.id, estado: "descartado", resolucion: resol[h.id] ?? "" })}>Descartar</button>
              </div>
            )}
          </div>
        ))}
        {lista.length === 0 && <p className="text-xs text-emerald-700 dark:text-emerald-400">✅ Sin pendientes abiertos.</p>}
      </div>
      <form
        className={`${card} space-y-2 p-3`}
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate();
        }}
      >
        <p className="text-xs font-bold text-ink">Nuevo pendiente</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px_100px]">
          <input className={input} placeholder="Título" value={nuevo.titulo} onChange={(e) => setNuevo((p) => ({ ...p, titulo: e.target.value }))} required />
          <select className={input} value={nuevo.severidad} onChange={(e) => setNuevo((p) => ({ ...p, severidad: e.target.value }))}>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
          <input className={input} type="number" placeholder="Año" value={nuevo.ano} onChange={(e) => setNuevo((p) => ({ ...p, ano: e.target.value }))} />
        </div>
        <textarea className={`${input} min-h-[56px]`} placeholder="Detalle" value={nuevo.detalle} onChange={(e) => setNuevo((p) => ({ ...p, detalle: e.target.value }))} />
        <button type="submit" className={btnSec} disabled={crear.isPending || !nuevo.titulo.trim()}>
          <Icon name="plus" size={14} weight="bold" /> Agregar
        </button>
      </form>
    </div>
  );
}

function Agente({ terceroId, onChanged }: { terceroId: number; onChanged: () => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const histQ = useQuery<{ historial: { id: number; rol: string; texto: string; created_at: string }[] }>({
    queryKey: ["socio-agente", terceroId],
    queryFn: () => api.get(`/api/socios/${terceroId}/agente`),
  });
  const enviar = useMutation({
    mutationFn: (mensaje: string) =>
      api.post<{ respuesta?: string; acciones?: string[]; modelo?: string; error?: string }>(`/api/socios/${terceroId}/agente`, { mensaje }, { timeoutMs: 180_000 }),
    onSuccess: (r) => {
      if (r.error) {
        setErr(r.error);
        return;
      }
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["socio-agente", terceroId] });
      if (r.acciones?.some((a) => a === "registrar_hallazgo" || a === "actualizar_anio")) onChanged();
    },
    onError: (e: Error) => setErr(e.message),
  });
  const limpiar = useMutation({
    mutationFn: () => api.delete(`/api/socios/${terceroId}/agente`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["socio-agente", terceroId] }),
  });
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [histQ.data, enviar.isPending]);

  const historial = histQ.data?.historial ?? [];
  const sugerencias = [
    "¿Qué años debo corregir y por qué?",
    "Resume el efecto cripto por año y a qué renglón del F210 va.",
    "¿Qué documentos me faltan para justificar el patrimonio?",
    "Cruza mis giros con McKenna del último año.",
  ];

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">
        Contador experto en criptoactivos que lee este expediente con herramientas (documentos, extractos personales,
        cruces) y puede registrar pendientes o actualizar un año. Cada mensaje pasa por el presupuesto LLM. No sustituye
        la firma del contador.
      </p>
      <div className="max-h-[420px] min-h-[200px] space-y-2 overflow-auto rounded-xl border border-border bg-surface p-3">
        {historial.length === 0 && !enviar.isPending && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Empieza con una de estas preguntas:</p>
            <div className="flex flex-wrap gap-1.5">
              {sugerencias.map((s) => (
                <button key={s} type="button" className={btnSec} onClick={() => enviar.mutate(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {historial.map((t) => (
          <div key={t.id} className={`flex ${t.rol === "assistant" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${t.rol === "assistant" ? "bg-surface-panel text-ink" : "bg-accent text-white"}`}>
              {t.texto}
            </div>
          </div>
        ))}
        {enviar.isPending && <p className="text-xs text-muted">El agente está leyendo el expediente…</p>}
        <div ref={finRef} />
      </div>
      {err && <p className="text-xs font-semibold text-danger">{err}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const m = texto.trim();
          if (!m) return;
          setTexto("");
          enviar.mutate(m);
        }}
      >
        <input className={input} placeholder="Pregunta sobre la declaración, un año, un documento…" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={enviar.isPending} />
        <button type="submit" className={btnPrimario} disabled={enviar.isPending || !texto.trim()}>Enviar</button>
        <button type="button" className={btnSec} title="Borrar conversación" onClick={() => limpiar.mutate()} disabled={historial.length === 0}>
          <Icon name="trash" size={14} weight="bold" />
        </button>
      </form>
    </div>
  );
}

/* ─── Paso 6: Cierre ─────────────────────────────────────────────────────── */

function PasoCierre({ terceroId, exp, onChanged, onIr }: { terceroId: number; exp: Expediente; onChanged: () => void; onIr: (p: PasoId) => void }) {
  const abiertos = exp.hallazgos.filter((h) => h.estado === "pendiente" || h.estado === "en_curso");
  const porCorregir = exp.anios.filter((a) => a.requiere_revision || a.estado === "por_corregir" || a.estado === "borrador");
  const [copiado, setCopiado] = useState(false);

  const resumen = useMemo(() => {
    const l: string[] = [];
    l.push(`EXPEDIENTE FISCAL — ${exp.perfil.tercero.nombre}${exp.perfil.cedula ? ` (CC ${exp.perfil.cedula})` : ""}`);
    l.push(`Generado ${new Date().toLocaleDateString("es-CO")} desde el panel McKenna · Contabilidad · Socios`);
    l.push("");
    l.push("AÑOS GRAVABLES");
    for (const a of exp.anios) {
      l.push(
        `- ${a.ano} [${ESTADO_ANIO_LABEL[a.estado] ?? a.estado}]${a.formulario ? ` F${a.formulario}` : ""}: patrimonio bruto ${cop(a.patrimonio_bruto)}, deudas ${cop(a.deudas)}, renta líquida ${cop(a.renta_liquida)}, impuesto ${cop(a.impuesto_pagado)} · cripto: renta ord. ${cop(a.cripto_renta_ordinaria)}, gan. ocas. ${cop(a.cripto_ganancia_ocasional)}${a.tenencia_cierre_usd ? `, tenencia 31-dic ${usd(a.tenencia_cierre_usd)}` : ""}${a.requiere_revision ? " ⚠ presentada sin cripto" : ""}`,
      );
    }
    l.push("");
    l.push(`DOCUMENTOS (${exp.documentos.length})`);
    for (const c of exp.categorias) {
      const n = exp.documentos_por_categoria[c.id];
      if (n) l.push(`- ${c.label}: ${n}`);
    }
    l.push("");
    l.push(`EXTRACTOS PERSONALES: ${exp.extractos.length}`);
    for (const [a, info] of Object.entries(exp.cobertura.anios)) {
      l.push(`- ${a}: ${info.meses_con}/12 meses${info.faltan.length ? ` (faltan ${info.faltan.join(", ")})` : ""}`);
    }
    l.push("");
    l.push(`PENDIENTES ABIERTOS (${abiertos.length})`);
    for (const h of abiertos) l.push(`- [${h.severidad}]${h.ano ? ` ${h.ano}` : ""} ${h.titulo}: ${h.detalle}`);
    return l.join("\n");
  }, [exp, abiertos]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Kpi label="Pasos listos" valor={`${exp.progreso.hechos}/${exp.progreso.total}`} tono={exp.progreso.hechos === exp.progreso.total ? "ok" : undefined} />
        <Kpi label="Años por corregir o presentar" valor={String(porCorregir.length)} tono={porCorregir.length ? "warn" : "ok"} />
        <Kpi label="Pendientes abiertos" valor={String(abiertos.length)} tono={abiertos.length ? "warn" : "ok"} />
      </div>

      <div className="space-y-1.5">
        {exp.pasos.filter((p) => p.id !== "cierre").map((p) => {
          const st = ESTILO_PASO[p.estado];
          return (
            <button key={p.id} type="button" onClick={() => onIr(p.id)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${st.wrap}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${st.dot}`}>{p.estado === "hecho" ? "✓" : "!"}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">{p.label}</span>
                <span className={`block text-[11px] ${st.txt}`}>{p.detalle}</span>
              </span>
              <span className="text-[11px] font-bold text-ink-secondary">Ir →</span>
            </button>
          );
        })}
      </div>

      {porCorregir.length > 0 && (
        <div className={`${card} p-3`}>
          <p className="text-xs font-bold text-ink">Años que necesitan decisión del contador</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-ink-secondary">
            {porCorregir.map((a) => (
              <li key={a.ano}>
                {a.ano}: {ESTADO_ANIO_LABEL[a.estado] ?? a.estado}
                {a.cripto_total != null ? ` · efecto cripto ${cop(a.cripto_total)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`${card} space-y-2 p-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-ink">Resumen para el contador</p>
          <button
            type="button"
            className={btnSec}
            onClick={() => {
              void navigator.clipboard?.writeText(resumen).then(() => {
                setCopiado(true);
                window.setTimeout(() => setCopiado(false), 2000);
              });
            }}
          >
            {copiado ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-2 text-[11px] text-ink">{resumen}</pre>
        <p className="text-[10px] text-muted">
          Los soportes completos siguen en la carpeta del Declarador (`Para_Contador/`) y en los documentos del paso 5.
        </p>
      </div>
      <MarcarHechoInline terceroId={terceroId} onChanged={onChanged} />
    </div>
  );
}

function MarcarHechoInline({ terceroId, onChanged }: { terceroId: number; onChanged: () => void }) {
  const mut = useMutation({
    mutationFn: () => api.post(`/api/socios/${terceroId}/pasos/cierre`, { hecho: true }),
    onSuccess: onChanged,
  });
  return (
    <button type="button" className={btnPrimario} disabled={mut.isPending} onClick={() => mut.mutate()}>
      <Icon name="check" size={14} weight="bold" /> Marcar expediente como entregado al contador
    </button>
  );
}
