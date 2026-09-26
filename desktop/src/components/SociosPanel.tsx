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
  /** "no_presentada": ese año no hubo declaración · "no_aplica" · "alternativa": lo cubre otro documento. */
  nota?: string;
  alternativa_en?: string;
}

interface MontoMoneda {
  operaciones: number | null;
  valor: number;
}

interface TarjetaAnio {
  tarjetas?: string[];
  consumos?: Record<string, MontoMoneda>;
  pagos_capital?: Record<string, MontoMoneda>;
  intereses_pagados?: Record<string, MontoMoneda>;
  avances?: { operaciones: number; comision: number };
  cuota_manejo?: number;
  intereses_causados?: number;
  saldo_31dic?: { capital: number; interes: number | null; otros: number | null };
  saldo_ahorros_31dic?: number;
  fuentes?: string[];
}

interface CorreccionAnio {
  rlg_declarada: number | null;
  ajuste_cripto: number | null;
  rlg_corregida: number;
  impuesto_pagado: number | null;
  impuesto_declarado_recalculado: number | null;
  impuesto_corregido: number | null;
  mayor_valor: number | null;
  sancion_correccion_10: number;
  uvt_cargada: boolean;
  intereses_mora: number;
  intereses_dias: number;
  intereses_desde: string;
  total_estimado: number;
}

interface Tenencia {
  anios?: Record<string, { cripto_costo_cierre_usd: number; cripto_costo_cierre_cop: number | null; trm_cierre: number | null; detalle: { coin: string; cantidad: number; costo_usd: number }[] }>;
  mensual?: { mes: string; costo_usd: number; costo_cop: number | null }[];
}

interface ObjetivoAnio {
  ano: number;
  estado: string;
  situacion: string;
  accion: string;
  via: string | null;
  cripto_total: number | null;
  tenencia_cierre_usd: number | null;
  cripto_costo_cierre_usd: number | null;
  cripto_costo_cierre_cop: number | null;
  trm_cierre: number | null;
  patrimonio_bruto_declarado: number | null;
  correccion: CorreccionAnio | null;
  presentacion: { estado: string; ventana: string; turno_habitual: string | null; nota: string } | null;
  bloqueos: string[];
  insumos: { f210: boolean; f210_aplica: boolean; efecto_cripto: boolean; historial: boolean; tenencia: boolean };
}

interface Objetivo {
  aplica: boolean;
  anios: ObjetivoAnio[];
  resumen: Record<string, number>;
  totales?: { mayor_valor: number; sancion_correccion_10: number; intereses_mora: number; total_estimado: number; a_favor_no_reclamable: number };
  parametros?: { tasa_mora_anual: number; hoy: string; tasa_default: number };
  calculable: boolean;
  anios_bloqueados: number[];
  vias: { id: string; titulo: string; detalle: string }[];
}

interface Requisito {
  id: string;
  categoria: string;
  titulo: string;
  por_que: string;
  como: string;
  /** calculo = sin esto no hay cifras · base = F210 sobre el que se corrige · soporte = justifica, no cambia el cálculo */
  rol: "calculo" | "base" | "soporte";
  impacto: string;
  por_anio: boolean;
  es_extracto: boolean;
  alternativa_nota: string;
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
  hasta_f210: number;
}

interface Documento {
  id: number;
  categoria: string;
  ano: number | null;
  /** Último año cubierto cuando un solo archivo abarca varios (historial 2020-2025). */
  ano_hasta: number | null;
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
  cripto_costo_cierre_usd: number | null;
  cripto_costo_cierre_cop: number | null;
  trm_cierre: number | null;
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
  objetivo: Objetivo;
  tenencia: Tenencia;
  tarjeta: Record<string, TarjetaAnio>;
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
  cierre: { icon: "book", hint: "El expediente completo en orden cronológico: año por año, qué se declaró, qué pasó y con qué se prueba." },
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
  borrador: "Borrador (en preparación)",
  por_corregir: "Por corregir",
  corregida: "Corregida",
  no_obligado: "No obligado",
  no_presentada: "No presentada",
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

/** Un documento cubre el año si es su año o cae dentro de su rango (ano → ano_hasta). */
function docCubre(d: Documento, ano: number): boolean {
  if (d.ano === null) return false;
  return d.ano <= ano && ano <= (d.ano_hasta ?? d.ano);
}

function etiquetaAnos(d: Documento): string {
  if (d.ano === null) return "sin año";
  return d.ano_hasta && d.ano_hasta !== d.ano ? `${d.ano}–${d.ano_hasta}` : String(d.ano);
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
            {exp.anios.length} año(s) gravable(s) · {exp.hallazgos_abiertos} pendiente(s)
          </p>
          <ResumenDocsLinea exp={exp} onIr={irA} />
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
        {paso === "declarador" && <PasoDeclarador terceroId={terceroId} exp={exp} onChanged={refrescar} onIr={irA} />}
        {paso === "cierre" && <PasoCierre terceroId={terceroId} exp={exp} onIr={irA} />}

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

/* ─── Paso 2: Plan de carga (matriz documento × año + qué falta + ya cargado) ─ */

const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

interface Faltante {
  req: Requisito;
  ano: number | null;
  /** Para extractos: meses del año sin extracto ("2025-03"). */
  meses: string[];
  mios: number;
  /** Para extractos: archivos de ese año que están en el expediente pero no se importaron como extracto. */
  sinImportar: number;
}

/**
 * Resumen calculable del plan: cuántas "casillas" (documento × año, o un
 * documento suelto) están cubiertas y cuáles faltan. Es lo que se pinta en
 * la cabecera del wizard, en el paso «Plan de carga» y en la pestaña
 * «Documentos» del Declarador, para que las tres digan lo mismo.
 */
function resumenPlan(exp: Expediente): { total: number; cargadas: number; faltantes: Faltante[]; noAplican: Requisito[] } {
  const plan = exp.plan;
  const aplicables = plan.requisitos.filter((r) => r.aplica && !r.omitido);
  const noAplican = plan.requisitos.filter((r) => !r.aplica || r.omitido);
  let total = 0;
  let cargadas = 0;
  const faltantes: Faltante[] = [];
  for (const r of aplicables) {
    if (r.por_anio) {
      for (const a of r.anios) {
        if (a.nota === "no_presentada" || a.nota === "no_aplica") continue;
        total += 1;
        if (a.ok) cargadas += 1;
        else {
          const meses = r.es_extracto ? exp.cobertura.anios[String(a.ano)]?.faltan ?? MESES_CORTO.map((_, i) => `${a.ano}-${String(i + 1).padStart(2, "0")}`) : [];
          const sinImportar = r.es_extracto ? exp.documentos.filter((d) => d.categoria === r.categoria && d.ano === a.ano).length : 0;
          faltantes.push({ req: r, ano: a.ano, meses, mios: a.mios, sinImportar });
        }
      }
    } else {
      total += 1;
      if (r.estado === "hecho") cargadas += 1;
      else faltantes.push({ req: r, ano: null, meses: [], mios: r.mios, sinImportar: 0 });
    }
  }
  return { total, cargadas, faltantes, noAplican };
}

function mesesTexto(meses: string[]): string {
  const n = meses.map((m) => MESES_CORTO[Number(m.slice(5, 7)) - 1] ?? m).filter(Boolean);
  if (n.length === 12) return "todo el año";
  if (n.length <= 4) return n.join(", ");
  return `${n.slice(0, 3).join(", ")} y ${n.length - 3} más`;
}

/** Nombre corto para las cabeceras/lista (el título completo va en el tooltip). */
const TITULO_CORTO: Record<string, string> = {
  f210: "Declaración de renta (F210)",
  exogena: "Información exógena DIAN",
  extracto_banco: "Extractos bancarios",
  extracto_tarjeta: "Tarjetas de crédito",
  certificado_banco: "Certificados bancarios anuales",
  binance_csv: "Historial Binance (CSV)",
  binance_snapshot: "Tenencia Binance a 31-dic",
  binance_api: "Evidencia API Binance",
  otra_plataforma: "Otras plataformas",
  inversiones: "Comisionista de bolsa",
  soporte: "Soportes de préstamos",
};

/** Línea corta para la cabecera del wizard: cargado / falta, con salto al plan. */
function ResumenDocsLinea({ exp, onIr }: { exp: Expediente; onIr: (p: PasoId) => void }) {
  const r = useMemo(() => resumenPlan(exp), [exp]);
  const completo = r.total > 0 && r.faltantes.length === 0;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" /> {r.cargadas} de {r.total} documentos cargados
      </span>
      {completo ? (
        <span className="font-semibold text-muted">· expediente completo</span>
      ) : (
        <button type="button" className="inline-flex items-center gap-1 font-bold text-danger underline" onClick={() => onIr("plan")}>
          <span className="inline-block h-2 w-2 rounded-full bg-danger" /> faltan {r.faltantes.length} · ver cuáles
        </button>
      )}
    </p>
  );
}

/** Aviso en la pestaña «Documentos» del Declarador: aquí se ven los archivos, en el plan lo que falta. */
function ResumenDocsBanner({ exp, onIr }: { exp: Expediente; onIr: (p: PasoId) => void }) {
  const r = useMemo(() => resumenPlan(exp), [exp]);
  if (r.total === 0) return null;
  if (r.faltantes.length === 0) {
    return (
      <p className="rounded-lg bg-emerald-600/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        Los {r.total} documentos que pide tu caso están cargados. Aquí ves y abres los archivos.
      </p>
    );
  }
  const primeros = r.faltantes.slice(0, 3).map((f) => `${TITULO_CORTO[f.req.id] ?? f.req.titulo}${f.ano ? ` ${f.ano}` : ""}`);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs">
      <span className="font-bold text-danger">Faltan {r.faltantes.length} de {r.total}:</span>
      <span className="min-w-0 flex-1 text-ink-secondary">
        {primeros.join(" · ")}
        {r.faltantes.length > 3 ? ` y ${r.faltantes.length - 3} más` : ""}
      </span>
      <button type="button" className={btnSec} onClick={() => onIr("plan")}>
        <Icon name="listChecks" size={14} weight="bold" /> Ver qué falta y cómo conseguirlo
      </button>
    </div>
  );
}

/* ─── Meta del expediente: qué se presenta o corrige por año ─────────────── */

const SITUACION_META: Record<string, { label: string; cls: string }> = {
  corregir: { label: "Corregir", cls: "bg-danger text-white" },
  corregir_sin_calculo: { label: "Corregir · falta cálculo", cls: "bg-amber-500 text-white" },
  presentada_sin_efecto: { label: "Revisar con contador", cls: "bg-amber-500 text-white" },
  presentar: { label: "Presentar", cls: "bg-amber-500 text-white" },
  presentar_extemporanea: { label: "Presentar (no declarada)", cls: "bg-danger text-white" },
  por_definir: { label: "¿Declaraste?", cls: "bg-surface-hover text-ink" },
  corregida: { label: "Corregida ✓", cls: "bg-emerald-600 text-white" },
  en_preparacion: { label: "En preparación", cls: "bg-sky-600 text-white" },
  futura: { label: "Aún no abre", cls: "bg-surface-hover text-muted" },
  fuera_alcance: { label: "Fuera del período elegido", cls: "bg-surface-hover text-muted" },
};

const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function turnoTexto(mmdd: string | null): string | null {
  if (!mmdd || mmdd.length < 5) return null;
  const m = Number(mmdd.slice(0, 2));
  const d = Number(mmdd.slice(3, 5));
  return Number.isFinite(m) && Number.isFinite(d) ? `${d} de ${MES_LARGO[m - 1]}` : null;
}

function Insumo({ ok, label, aplica = true }: { ok: boolean; label: string; aplica?: boolean }) {
  if (!aplica) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-danger"}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-600" : "bg-danger"}`} /> {label}
    </span>
  );
}

function Tile({ label, valor, sub, tono }: { label: string; valor: string; sub?: string; tono?: "rojo" | "verde" | "neutro" }) {
  const cls = tono === "rojo" ? "border-danger/40 bg-danger/10" : tono === "verde" ? "border-emerald-600/30 bg-emerald-600/5" : "";
  return (
    <div className={`${card} ${cls} px-3 py-2`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-lg font-extrabold tabular-nums text-ink">{valor}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

/** Evolución de la tenencia en Binance (costo fiscal FIFO): barras por mes y tabla moneda × cierre de año. */
function EvolucionTenencia({ tenencia, anios }: { tenencia: Tenencia; anios: number[] }) {
  const mensual = tenencia.mensual ?? [];
  const max = Math.max(1, ...mensual.map((m) => m.costo_cop ?? 0));
  const porAno = tenencia.anios ?? {};
  const coins = useMemo(() => {
    const maxCosto = new Map<string, number>();
    for (const y of Object.keys(porAno)) for (const d of porAno[y].detalle ?? []) maxCosto.set(d.coin, Math.max(maxCosto.get(d.coin) ?? 0, d.costo_usd));
    return [...maxCosto.entries()].filter(([, c]) => c >= 50).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
  }, [porAno]);
  if (!mensual.length && !Object.keys(porAno).length) return <p className="text-[11px] text-muted">Sin ledger de Binance importado: no hay tenencia que mostrar.</p>;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-bold text-ink">Costo fiscal de lo que había en Binance, mes a mes (COP a la TRM de cada cierre)</p>
        <div className="mt-1 flex h-28 items-stretch gap-px overflow-x-auto rounded-lg border border-border bg-surface px-1 pt-1">
          {mensual.map((m) => {
            const h = Math.max(1, Math.round(((m.costo_cop ?? 0) / max) * 100));
            const dic = m.mes.endsWith("-12");
            return (
              <div key={m.mes} className="flex h-full min-w-[6px] flex-1 flex-col items-center justify-end" title={`${m.mes}: ${cop(m.costo_cop)} (${usd(m.costo_usd)})`}>
                <div className={`w-full rounded-t-sm ${dic ? "bg-accent" : "bg-emerald-600/60"}`} style={{ height: `${h}%`, minHeight: 2 }} />
                {dic && <span className="mt-0.5 text-[8px] font-bold text-ink">{m.mes.slice(0, 4)}</span>}
              </div>
            );
          })}
        </div>
        <p className="mt-0.5 text-[10px] text-muted">Barra oscura = cierre de año (31-dic), que es lo que va al patrimonio bruto. Pasa el cursor para ver el mes.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-border bg-surface text-[10px] uppercase text-muted">
              <th className="px-2 py-1 text-left font-bold">Al 31-dic</th>
              {anios.map((y) => (
                <th key={y} className="px-2 py-1 text-right font-bold tabular-nums">{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coins.map((c) => (
              <tr key={c} className="border-b border-border/60">
                <td className="px-2 py-1 font-bold text-ink">{c}</td>
                {anios.map((y) => {
                  const d = (porAno[String(y)]?.detalle ?? []).find((x) => x.coin === c);
                  return (
                    <td key={y} className="px-2 py-1 text-right tabular-nums text-ink-secondary" title={d ? `costo ${usd(d.costo_usd)}` : ""}>
                      {d ? d.cantidad.toLocaleString("es-CO", { maximumFractionDigits: 4 }) : <span className="text-muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="bg-surface font-bold">
              <td className="px-2 py-1 text-ink">Costo fiscal total</td>
              {anios.map((y) => {
                const a = porAno[String(y)];
                return (
                  <td key={y} className="px-2 py-1 text-right tabular-nums text-ink" title={a ? `${usd(a.cripto_costo_cierre_usd)} · TRM ${a.trm_cierre ?? "—"}` : ""}>
                    {a ? cop(a.cripto_costo_cierre_cop) : "—"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted">
        Cantidades = lotes vivos según el ledger de Binance (FIFO, stablecoins a 1 USD). Solo cuenta lo que estaba EN Binance a esa fecha; lo que estuviera en Littio o en billetera propia se suma aparte.
        El motor coincide con el snapshot oficial del 31-dic-2025 (BTC 0,1599 vs 0,1597).
      </p>
    </div>
  );
}

function MetaDeclaraciones({ objetivo, tenencia, anios, onEstadoAnio, onSubirF210, onIr, onTasa, pendienteEstado }: {
  objetivo: Objetivo;
  tenencia: Tenencia;
  anios: number[];
  onEstadoAnio: (ano: number, estado: string) => void;
  onSubirF210: (ano: number) => void;
  onIr: (p: PasoId) => void;
  onTasa: (tasa: number) => void;
  pendienteEstado: boolean;
}) {
  const [verVias, setVerVias] = useState(false);
  const [verTenencia, setVerTenencia] = useState(false);
  const [tasaTxt, setTasaTxt] = useState<string>(() => String(Math.round((objetivo.parametros?.tasa_mora_anual ?? 0.23) * 1000) / 10));
  useEffect(() => {
    setTasaTxt(String(Math.round((objetivo.parametros?.tasa_mora_anual ?? 0.23) * 1000) / 10));
  }, [objetivo.parametros?.tasa_mora_anual]);
  if (!objetivo.aplica) return null;
  const t = objetivo.totales;
  const corregir = objetivo.anios.filter((a) => a.situacion.startsWith("corregir") || a.situacion === "presentada_sin_efecto");
  const conMayor = objetivo.anios.filter((a) => (a.correccion?.mayor_valor ?? 0) > 0);
  const ultimoCierre = [...objetivo.anios].reverse().find((a) => a.situacion !== "en_preparacion" && a.situacion !== "futura" && a.cripto_costo_cierre_cop !== null);
  const enPrep = objetivo.anios.find((a) => a.situacion === "en_preparacion");
  const turno = turnoTexto(enPrep?.presentacion?.turno_habitual ?? null);

  return (
    <div className={`${card} overflow-hidden border-accent/40`}>
      <div className="flex flex-wrap items-start justify-between gap-2 bg-accent/10 px-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-ink">
            <Icon name="target" size={16} weight="bold" className="text-accent" /> La meta: declarar los criptoactivos que nunca se incluyeron
          </p>
          <p className="text-[11px] text-ink-secondary">
            Los F210 ya presentados van sin criptoactivos. Hay que corregir {corregir.length} año{corregir.length !== 1 ? "s" : ""} ({corregir.map((a) => a.ano).join(", ")})
            {conMayor.length > 0 && <>; en {conMayor.map((a) => a.ano).join(" y ")} la corrección genera impuesto adicional</>}.
            {enPrep && <> La de {enPrep.ano} no falta: está en preparación y se presenta ahora.</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btnSec} onClick={() => setVerTenencia((v) => !v)}>
            <Icon name="chartBar" size={13} weight="bold" /> {verTenencia ? "Ocultar tenencia" : "Evolución de la tenencia"}
          </button>
          <button type="button" className={btnSec} onClick={() => setVerVias((v) => !v)}>
            <Icon name="book" size={13} weight="bold" /> {verVias ? "Ocultar vías" : "¿Por qué vía se hace?"}
          </button>
        </div>
      </div>

      {/* Veredicto: ¿se puede calcular con lo cargado? */}
      <div className={`px-3 py-2 text-xs font-semibold ${objetivo.calculable ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-danger/10 text-danger"}`}>
        {objetivo.calculable
          ? "Con lo que ya está cargado el cálculo está completo para todos los años: activos omitidos a cada 31 de diciembre, efecto en renta, impuesto, sanción e intereses. Lo que falta en el mapa de abajo es soporte, no bloquea."
          : `Falta el historial de Binance de ${objetivo.anios_bloqueados.join(", ")}: sin él no se puede calcular el efecto cripto de ese año.`}
      </div>

      {/* Cifras grandes */}
      <div className="grid gap-2 px-3 py-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          label={`Activos omitidos al 31-dic-${ultimoCierre?.ano ?? "—"}`}
          valor={cop(ultimoCierre?.cripto_costo_cierre_cop ?? null)}
          sub={ultimoCierre ? `costo fiscal ${usd(ultimoCierre.cripto_costo_cierre_usd)} · no estaba en el patrimonio bruto declarado` : undefined}
          tono="rojo"
        />
        <Tile label="Mayor impuesto (todos los años)" valor={cop(t?.mayor_valor ?? 0)} sub={conMayor.map((a) => `${a.ano}: ${cop(a.correccion?.mayor_valor)}`).join(" · ") || "ningún año paga más"} tono="rojo" />
        <Tile label="Sanción por corrección (10 %)" valor={cop(t?.sancion_correccion_10 ?? 0)} sub="Art. 644 ET, antes de emplazamiento" />
        <Tile label="Intereses de mora (estimado)" valor={cop(t?.intereses_mora ?? 0)} sub={`al ${Math.round((objetivo.parametros?.tasa_mora_anual ?? 0) * 1000) / 10} % anual, desde cada vencimiento hasta hoy`} />
        <Tile label="Total estimado si se corrige hoy" valor={cop(t?.total_estimado ?? 0)} sub={t && t.a_favor_no_reclamable > 0 ? `sin contar ${cop(t.a_favor_no_reclamable)} a favor de 2022 (Art. 589)` : undefined} tono="rojo" />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1.5 text-[10px] text-muted">
        <span>Tasa de mora usada (Art. 635 ET: usura de consumo menos 2 puntos, la publica la Superfinanciera cada mes):</span>
        <input className="w-16 rounded border border-border bg-surface-panel px-1 py-0.5 text-right text-[11px] text-ink" value={tasaTxt} onChange={(e) => setTasaTxt(e.target.value)} />
        <span>% anual</span>
        <button type="button" className={btnSec} disabled={pendienteEstado} onClick={() => { const v = Number(tasaTxt.replace(",", ".")); if (Number.isFinite(v) && v > 0 && v < 100) onTasa(v / 100); }}>
          Recalcular
        </button>
        <span>· los intereses definitivos los da el liquidador de la DIAN.</span>
      </div>

      {verTenencia && (
        <div className="border-t border-border px-3 py-3">
          <EvolucionTenencia tenencia={tenencia} anios={anios} />
        </div>
      )}

      {verVias && (
        <ul className="grid gap-2 border-t border-border px-3 py-3 sm:grid-cols-2">
          {objetivo.vias.map((v) => (
            <li key={v.id} className="rounded-lg border border-border bg-surface-panel px-2.5 py-2">
              <p className="text-xs font-bold text-ink">{v.titulo}</p>
              <p className="text-[11px] leading-snug text-ink-secondary">{v.detalle}</p>
            </li>
          ))}
          <li className="text-[10px] text-muted sm:col-span-2">La vía concreta y la sanción la define el contador; aquí solo se deja claro qué corresponde a cada año.</li>
        </ul>
      )}

      {/* Año por año */}
      <div className="overflow-x-auto border-t border-border">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 text-left font-bold">Año</th>
              <th className="px-3 py-2 text-left font-bold">Qué hay que hacer</th>
              <th className="px-3 py-2 text-right font-bold">Activo omitido a 31-dic</th>
              <th className="px-3 py-2 text-right font-bold">Efecto cripto del año</th>
              <th className="px-3 py-2 text-right font-bold">Impuesto: pagado → corregido</th>
              <th className="px-3 py-2 text-right font-bold">Costo de corregir hoy</th>
            </tr>
          </thead>
          <tbody>
            {objetivo.anios.map((a) => {
              const st = SITUACION_META[a.situacion] ?? { label: a.situacion, cls: "bg-surface-hover text-ink" };
              const c = a.correccion;
              const faltanInsumos = [
                !a.insumos.f210 && a.insumos.f210_aplica ? "F210 presentado" : null,
                !a.insumos.historial && a.situacion !== "futura" ? "historial Binance" : null,
                !a.insumos.efecto_cripto ? "efecto calculado" : null,
                !a.insumos.tenencia ? "snapshot 31-dic" : null,
              ].filter(Boolean) as string[];
              return (
                <tr key={a.ano} className={`border-b border-border align-top last:border-b-0 ${a.situacion === "en_preparacion" ? "bg-sky-500/5" : ""}`}>
                  <td className="px-3 py-2 font-bold tabular-nums text-ink">{a.ano}</td>
                  <td className="max-w-[340px] px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                    <p className="mt-1 text-[11px] leading-snug text-ink-secondary">{a.accion}</p>
                    {a.situacion === "en_preparacion" && a.presentacion && (
                      <p className="mt-1 text-[10px] text-ink-secondary">
                        Ventana: {a.presentacion.ventana}.{turno ? ` Tu turno en años anteriores fue el ${turno}.` : ""} {a.presentacion.nota}
                      </p>
                    )}
                    {a.bloqueos.length > 0 && <p className="mt-1 text-[10px] font-bold text-danger">Bloquea el cálculo: falta {a.bloqueos.join(", ")}.</p>}
                    {a.bloqueos.length === 0 && faltanInsumos.length > 0 && (
                      <p className="mt-1 text-[10px] text-muted">Soporte pendiente (no bloquea): {faltanInsumos.join(", ")}.</p>
                    )}
                    {a.bloqueos.length === 0 && faltanInsumos.length === 0 && <p className="mt-1 text-[10px]"><Insumo ok label="insumos completos" /></p>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.situacion === "por_definir" && (
                        <>
                          <button type="button" className={btnPrimario} onClick={() => onSubirF210(a.ano)}><Icon name="paperclip" size={12} weight="bold" /> Sí, subir F210 {a.ano}</button>
                          <button type="button" className={btnSec} disabled={pendienteEstado} onClick={() => onEstadoAnio(a.ano, "no_presentada")}>No presenté ese año</button>
                        </>
                      )}
                      {a.situacion === "presentar_extemporanea" && (
                        <button type="button" className={btnSec} disabled={pendienteEstado} onClick={() => onEstadoAnio(a.ano, "sin_datos")}>Sí presenté (deshacer)</button>
                      )}
                      {(a.situacion.startsWith("corregir") || a.situacion === "presentar" || a.situacion === "presentada_sin_efecto" || a.situacion === "en_preparacion") && (
                        <button type="button" className={btnSec} onClick={() => onIr("declarador")}>Ver cifras del año</button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {a.cripto_costo_cierre_cop === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <>
                        <span className="font-bold">{cop(a.cripto_costo_cierre_cop)}</span>
                        <p className="text-[10px] text-muted">{usd(a.cripto_costo_cierre_usd)} · TRM {a.trm_cierre?.toLocaleString("es-CO") ?? "—"} → renglón 29</p>
                        {a.patrimonio_bruto_declarado !== null && <p className="text-[10px] text-muted">declarado: {cop(a.patrimonio_bruto_declarado)}</p>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {a.cripto_total === null ? <span className="text-danger">sin calcular</span> : <span className="font-bold">{cop(a.cripto_total)}</span>}
                    {a.cripto_total !== null && <p className="text-[10px] text-muted">→ renglón 74</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {c ? (
                      c.uvt_cargada ? (
                        <>
                          {cop(c.impuesto_pagado ?? 0)} → <span className="font-bold">{cop(c.impuesto_corregido)}</span>
                          <p className="text-[10px] text-muted">renta líquida {cop(c.rlg_declarada)} → {cop(c.rlg_corregida)}</p>
                          {c.mayor_valor !== null && c.mayor_valor < 0 && <p className="text-[10px] text-muted">queda a favor {cop(-c.mayor_valor)} (Art. 589, ver vía)</p>}
                        </>
                      ) : (
                        <span className="text-[10px] text-muted">UVT {a.ano} no cargada</span>
                      )
                    ) : a.situacion === "en_preparacion" ? (
                      <span className="text-[10px] text-muted">se liquida en la declaración que se presenta ahora</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {c && (c.mayor_valor ?? 0) > 0 ? (
                      <>
                        <span className="font-bold text-danger">{cop(c.total_estimado)}</span>
                        <p className="text-[10px] text-muted">
                          impuesto {cop(c.mayor_valor)} + sanción {cop(c.sancion_correccion_10)} + intereses {cop(c.intereses_mora)} ({c.intereses_dias} días desde {c.intereses_desde})
                        </p>
                      </>
                    ) : c ? (
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">$ 0 · sin mayor impuesto</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Lo que el certificado anual de Bancolombia dice de la tarjeta ese año. */
function CifrasTarjeta({ datos, ano }: { datos: TarjetaAnio; ano: number }) {
  const fila = (label: string, m?: Record<string, MontoMoneda>) => {
    if (!m) return null;
    const partes = Object.entries(m).map(([mon, v]) => `${mon === "USD" ? usd(v.valor) : cop(v.valor)}${v.operaciones ? ` (${v.operaciones} ops)` : ""}`);
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-1">
        <span className="text-[11px] text-muted">{label}</span>
        <span className="text-[11px] font-bold tabular-nums text-ink">{partes.join(" + ")}</span>
      </div>
    );
  };
  return (
    <div className="mt-2 grid gap-x-6 gap-y-0 sm:grid-cols-2">
      <div>
        {fila("Consumos del año", datos.consumos)}
        {fila("Pagos a capital", datos.pagos_capital)}
        {fila("Intereses pagados", datos.intereses_pagados)}
      </div>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-1">
          <span className="text-[11px] text-muted">Avances en efectivo</span>
          <span className={`text-[11px] font-bold tabular-nums ${datos.avances ? "text-danger" : "text-ink"}`}>
            {datos.avances ? `${datos.avances.operaciones} avance${datos.avances.operaciones !== 1 ? "s" : ""} · comisión ${cop(datos.avances.comision)}` : "ninguno"}
          </span>
        </div>
        {datos.saldo_31dic && (
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-1">
            <span className="text-[11px] text-muted">Saldo al 31-dic (deuda, renglón 30)</span>
            <span className="text-[11px] font-bold tabular-nums text-ink">{cop(datos.saldo_31dic.capital)}</span>
          </div>
        )}
        {datos.cuota_manejo !== undefined && (
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-1">
            <span className="text-[11px] text-muted">Cuotas de manejo</span>
            <span className="text-[11px] font-bold tabular-nums text-ink">{cop(datos.cuota_manejo)}</span>
          </div>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
          <span className="text-[11px] text-muted">Tarjetas</span>
          <span className="text-[11px] font-bold tabular-nums text-ink">{(datos.tarjetas ?? []).join(" · ") || "—"}</span>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-muted sm:col-span-2">
        Fuente: {(datos.fuentes ?? []).join(", ")} ({ano}).
        {!datos.avances && " Sin avances en efectivo ese año: ninguna compra de cripto se fondeó con la tarjeta por esa vía."}
        {datos.saldo_31dic === undefined && " El saldo a 31-dic sale del certificado de retención o de la exógena de ese año."}
      </p>
    </div>
  );
}

/** Panel bajo la matriz con el contenido de la casilla (documento × año) seleccionada. */
function DetalleCasilla({
  req: r,
  ano,
  exp,
  terceroId,
  subiendo,
  onSubir,
  onCerrar,
  onError,
  onEstadoAnio,
  onOmitirAno,
  onRango,
}: {
  req: Requisito;
  ano: number | null;
  exp: Expediente;
  terceroId: number;
  subiendo: string | null;
  onSubir: (ano?: number) => void;
  onCerrar: () => void;
  onError: (t: string) => void;
  onEstadoAnio: (ano: number, estado: string) => void;
  onOmitirAno: (ano: number, omitir: boolean) => void;
  onRango: (docId: number, hasta: number) => void;
}) {
  const [previewId, setPreviewId] = useState<number | null>(null);
  const previewQ = useQuery<{ texto: string }>({
    queryKey: ["socio-doc-texto", terceroId, previewId],
    queryFn: () => api.get(`/api/socios/${terceroId}/documentos/${previewId}/texto?max_chars=6000`),
    enabled: previewId != null,
  });
  const titulo = TITULO_CORTO[r.id] ?? r.titulo;
  const celda = ano !== null ? r.anios.find((a) => a.ano === ano) : null;
  const ok = ano !== null ? Boolean(celda?.ok) : r.estado === "hecho";
  const todosCat = exp.documentos.filter((d) => d.categoria === r.categoria);
  const enRango = ano !== null ? todosCat.filter((d) => docCubre(d, ano)) : todosCat;
  const sinZip = enRango.filter((d) => !d.archivo_nombre.toLowerCase().endsWith(".zip"));
  const archivos = sinZip.length ? sinZip : enRango;
  const anosPlan = exp.plan.anios;
  const cob = ano !== null ? exp.cobertura.anios[String(ano)] : undefined;
  const mesesFaltan = new Set(cob?.faltan ?? []);
  const cargando = subiendo === `${r.categoria}:${ano ?? ""}`;
  const noPresentada = celda?.nota === "no_presentada";
  const tarjetaAno = ano !== null ? exp.tarjeta?.[String(ano)] : undefined;
  const porAlternativa = celda?.nota === "alternativa";

  if (celda?.nota === "no_aplica" && ano !== null) {
    return (
      <div className="border-t-2 border-border bg-surface px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">
              {titulo} · {ano}
              <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold text-ink">No aplica este año</span>
            </p>
            <p className="text-[11px] text-ink-secondary">Lo marcaste como no aplicable para {ano}: no cuenta como faltante. Si sí existe, deshaz y súbelo.</p>
          </div>
          <button type="button" className={btnSec} onClick={onCerrar}><Icon name="close" size={12} weight="bold" /> cerrar</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={btnSec} onClick={() => onOmitirAno(ano, false)}>Sí aplica (deshacer)</button>
        </div>
      </div>
    );
  }

  if (porAlternativa && ano !== null) {
    return (
      <div className="border-t-2 border-emerald-600/50 bg-emerald-600/5 px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">
              {titulo} · {ano}
              <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">Cubierto por certificado anual</span>
            </p>
            <p className="text-[11px] text-ink-secondary">
              El banco ya no entrega extractos mensuales de ese año, pero el certificado anual trae las cifras que el expediente necesita.
              Lo que no da es el detalle comercio por comercio.
            </p>
          </div>
          <button type="button" className={btnSec} onClick={onCerrar}><Icon name="close" size={12} weight="bold" /> cerrar</button>
        </div>
        {tarjetaAno ? <CifrasTarjeta datos={tarjetaAno} ano={ano} /> : <p className="mt-2 text-[11px] text-muted">Sin cifras legibles en el certificado de {ano}.</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={btnSec} disabled={cargando} onClick={() => onSubir(ano)}>
            <Icon name="paperclip" size={13} weight="bold" /> Subir extracto mensual de {ano} si lo consigues
          </button>
        </div>
      </div>
    );
  }

  if (noPresentada && ano !== null) {
    return (
      <div className="border-t-2 border-border bg-surface px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">
              {titulo} · {ano}
              <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold text-ink">No se declaró</span>
            </p>
            <p className="text-[11px] text-ink-secondary">
              Ese año no se presentó declaración, así que no hay F210 que cargar. Lo que corresponde es <b>presentarla ahora incluyendo los criptoactivos</b> (ver «La meta» arriba).
            </p>
          </div>
          <button type="button" className={btnSec} onClick={onCerrar}><Icon name="close" size={12} weight="bold" /> cerrar</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={btnSec} onClick={() => onEstadoAnio(ano, "sin_datos")}>Sí presenté ese año (deshacer)</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`border-t-2 ${ok ? "border-emerald-600/50 bg-emerald-600/5" : "border-danger/50 bg-danger/5"} px-3 py-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">
            {titulo}
            {ano !== null ? ` · ${ano}` : ""}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${ok ? "bg-emerald-600" : celda && celda.mios > 0 ? "bg-amber-500" : "bg-danger"}`}>
              {ok ? "Cargado" : celda && celda.mios > 0 ? "Incompleto" : "Falta"}
            </span>
          </p>
          <p className="text-[11px] text-ink-secondary"><b className="text-ink">Para qué sirve:</b> {r.por_que}</p>
        </div>
        <button type="button" className={btnSec} onClick={onCerrar}><Icon name="close" size={12} weight="bold" /> cerrar</button>
      </div>

      {r.es_extracto ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1">
            {MESES_CORTO.map((m, i) => {
              const clave = `${ano}-${String(i + 1).padStart(2, "0")}`;
              const tiene = cob ? !mesesFaltan.has(clave) : false;
              return (
                <span key={m} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${tiene ? "bg-emerald-600 text-white" : "bg-danger/15 text-danger"}`} title={tiene ? `${m} ${ano}: con extracto` : `${m} ${ano}: sin extracto`}>
                  {m}
                </span>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-secondary">
            {cob ? `${cob.meses_con} de 12 meses con extracto importado.` : "Ningún mes con extracto importado."}
            {archivos.length > 0 && ` Hay ${archivos.length} archivo${archivos.length !== 1 ? "s" : ""} de ${ano} en el expediente que no se importaron como extracto (no cuentan aquí).`}
          </p>
          {!ok && <p className="text-[11px] text-ink-secondary"><b className="text-ink">Cómo conseguirlo:</b> {r.como}</p>}
          <button type="button" className={btnPrimario} onClick={() => onSubir(ano ?? undefined)}>
            <Icon name="receipt" size={14} weight="bold" /> {ok ? "Ver extractos" : `Cargar extractos ${ano}`}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {archivos.length > 0 ? (
            <ul className="space-y-1">
              {archivos.map((d) => (
                <li key={d.id} className="rounded-lg border border-border bg-surface-panel px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <Icon name="file" size={13} weight="bold" className="shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={d.archivo_nombre}>{d.archivo_nombre}</span>
                    <span className="text-[10px] text-muted">
                      {d.ano_hasta && d.ano_hasta !== d.ano ? <b className="text-ink">cubre {etiquetaAnos(d)}</b> : etiquetaAnos(d)} · {kb(d.tamano)} · {d.origen === "carpeta" ? "carpeta Declarador" : "subido"}
                    </span>
                    {r.por_anio && d.ano !== null && (
                      <label className="inline-flex items-center gap-1 text-[10px] text-muted" title="Si este archivo abarca varios años, indica hasta cuál: contará en cada uno">
                        hasta
                        <select
                          className="rounded border border-border bg-surface-panel px-1 py-0.5 text-[10px] text-ink"
                          value={d.ano_hasta ?? d.ano}
                          onChange={(e) => onRango(d.id, Number(e.target.value))}
                        >
                          {anosPlan.filter((y) => y >= (d.ano ?? y)).map((y) => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {!d.existe && <span className="text-[10px] font-bold text-danger">no está en disco</span>}
                    {d.legible && (
                      <button type="button" className="font-bold text-accent underline" onClick={() => setPreviewId(previewId === d.id ? null : d.id)}>
                        {previewId === d.id ? "ocultar" : "leer"}
                      </button>
                    )}
                    {d.existe && (
                      <button type="button" className="font-bold text-accent underline" onClick={() => void abrirArchivo(`/api/socios/${terceroId}/documentos/${d.id}/archivo`, onError)}>
                        abrir
                      </button>
                    )}
                  </div>
                  {previewId === d.id && (
                    <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-2 text-[10px] text-ink">
                      {previewQ.isLoading ? "Leyendo…" : previewQ.data?.texto}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-secondary"><b className="text-ink">Cómo conseguirlo:</b> {r.como}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {ok ? (
              <button type="button" className={btnSec} disabled={cargando} onClick={() => onSubir(ano ?? undefined)}>
                <Icon name="plus" size={13} weight="bold" /> {cargando ? "Subiendo…" : "Añadir otro archivo"}
              </button>
            ) : (
              <button type="button" className={btnPrimario} disabled={cargando} onClick={() => onSubir(ano ?? undefined)}>
                <Icon name="paperclip" size={14} weight="bold" /> {cargando ? "Subiendo…" : ano !== null ? `Subir ${titulo} ${ano}` : `Subir ${titulo}`}
              </button>
            )}
            {!ok && ano !== null && r.por_anio && (
              <button type="button" className={btnSec} onClick={() => onOmitirAno(ano, true)} title="Solo este año deja de pedirse; los demás siguen igual">
                No aplica en {ano}
              </button>
            )}
            {r.id === "f210" && !ok && ano !== null && (
              <button type="button" className={btnSec} onClick={() => onEstadoAnio(ano, "no_presentada")} title="Ese año no presentaste declaración: deja de pedirse el F210 y el año pasa a «presentar»">
                No presenté declaración ese año
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PasoPlan({ terceroId, exp, onChanged, onIr }: { terceroId: number; exp: Expediente; onChanged: () => void; onIr: (p: PasoId) => void }) {
  const plan = exp.plan;
  const ref = plan.referencia;
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [compararRef, setCompararRef] = useState(false);
  const [verCompletos, setVerCompletos] = useState(false);
  const [verCargados, setVerCargados] = useState(false);
  const [verNoAplican, setVerNoAplican] = useState(false);
  const [abiertoFalta, setAbiertoFalta] = useState<string | null>(null);
  const [sel, setSel] = useState<{ reqId: string; ano: number | null } | null>(null);
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
  const tasa = useMutation({
    mutationFn: (t: number) => api.post<{ error?: string }>(`/api/socios/${terceroId}/perfil`, { cuestionario: { tasa_mora_anual: t } }),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      onChanged();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });
  const rango = useMutation({
    mutationFn: (v: { docId: number; hasta: number }) => api.patch<{ error?: string }>(`/api/socios/${terceroId}/documentos/${v.docId}`, { ano_hasta: v.hasta }),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      onChanged();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });
  const estadoAnio = useMutation({
    mutationFn: (v: { ano: number; estado: string }) => api.patch<{ error?: string }>(`/api/socios/${terceroId}/anios/${v.ano}`, { estado: v.estado }),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      onChanged();
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
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
    setSubiendo(`${p.categoria}:${p.ano ?? ""}`);
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

  const resumen = useMemo(() => resumenPlan(exp), [exp]);
  const aplicables = plan.requisitos.filter((r) => r.aplica && !r.omitido);
  const anios = plan.anios;
  const pct = resumen.total ? Math.round((resumen.cargadas / resumen.total) * 100) : 0;

  // Archivos ya cargados por categoría y año (un archivo con rango cuenta en cada año que cubre).
  const docsDe = useMemo(() => {
    const porCat = new Map<string, Documento[]>();
    for (const d of exp.documentos) porCat.set(d.categoria, [...(porCat.get(d.categoria) ?? []), d]);
    return (cat: string, ano: number | null): Documento[] => {
      const lista = porCat.get(cat) ?? [];
      const sinZip = lista.filter((d) => !d.archivo_nombre.toLowerCase().endsWith(".zip"));
      const base = ano === null ? lista.filter((d) => d.ano === null) : lista.filter((d) => docCubre(d, ano));
      // un zip ya descomprimido no se lista dos veces
      const conArchivos = base.filter((d) => !d.archivo_nombre.toLowerCase().endsWith(".zip"));
      return conArchivos.length ? conArchivos : base.length ? base : ano === null ? [] : sinZip.filter((d) => docCubre(d, ano));
    };
  }, [exp.documentos]);

  // Faltantes agrupados por requisito, en el orden del plan.
  const faltaPorReq = useMemo(() => {
    const m = new Map<string, Faltante[]>();
    for (const f of resumen.faltantes) m.set(f.req.id, [...(m.get(f.req.id) ?? []), f]);
    const peso = (r: Requisito) => (r.rol === "calculo" ? 0 : r.rol === "base" ? 1 : 2);
    return aplicables
      .filter((r) => m.has(r.id))
      .sort((a, b) => peso(a) - peso(b))
      .map((r) => ({ req: r, items: m.get(r.id)! }));
  }, [resumen.faltantes, aplicables]);

  const selReq = sel ? plan.requisitos.find((r) => r.id === sel.reqId) ?? null : null;

  const accion = (r: Requisito, ano?: number) => {
    if (r.es_extracto) onIr("extractos");
    else pedirArchivo(r.categoria, ano);
  };

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />

      {/* 0. Meta: qué se presenta o corrige por año */}
      <MetaDeclaraciones
        objetivo={exp.objetivo}
        tenencia={exp.tenencia}
        anios={plan.anios}
        onTasa={(t) => tasa.mutate(t)}
        pendienteEstado={estadoAnio.isPending || tasa.isPending}
        onEstadoAnio={(ano, estado) => estadoAnio.mutate({ ano, estado })}
        onSubirF210={(ano) => pedirArchivo("declaracion_f210", ano)}
        onIr={onIr}
      />

      {/* 1. Resumen en tres cifras */}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className={`${card} border-emerald-600/30 bg-emerald-600/5 px-3 py-2.5`}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Ya cargado</p>
          <p className="text-2xl font-extrabold tabular-nums text-ink">
            {resumen.cargadas}
            <span className="text-sm font-bold text-muted"> de {resumen.total}</span>
          </p>
          <p className="text-[11px] text-muted">documentos por año que pide tu caso</p>
        </div>
        <div className={`${card} ${resumen.faltantes.length ? "border-danger/40 bg-danger/10" : "border-emerald-600/30 bg-emerald-600/5"} px-3 py-2.5`}>
          <p className={`text-[10px] font-bold uppercase tracking-wide ${resumen.faltantes.length ? "text-danger" : "text-emerald-700 dark:text-emerald-400"}`}>Falta</p>
          <p className="text-2xl font-extrabold tabular-nums text-ink">{resumen.faltantes.length}</p>
          <p className="text-[11px] text-muted">
            {resumen.faltantes.length
              ? `en ${faltaPorReq.length} tipo${faltaPorReq.length !== 1 ? "s" : ""} de documento · lista abajo`
              : "nada pendiente: el expediente está completo"}
          </p>
        </div>
        <div className={`${card} px-3 py-2.5`}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Avance</p>
          <p className="text-2xl font-extrabold tabular-nums text-ink">{pct}%</p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
            <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <Msg m={msg} />

      {/* 2. Matriz documento × año */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-xs font-bold text-ink">Mapa del expediente: qué hay de cada documento en cada año</p>
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" /> cargado</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" /> incompleto</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-danger" /> falta</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-dashed border-emerald-600/70 bg-emerald-600/15" /> cubierto por certificado anual</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-surface-hover" /> no se exige aún</span>
            <label className="inline-flex cursor-pointer items-center gap-1 font-semibold text-ink">
              <input type="checkbox" checked={verCompletos} onChange={(e) => setVerCompletos(e.target.checked)} /> desplegar los completos
            </label>
            {ref && (
              <label className="inline-flex cursor-pointer items-center gap-1 font-semibold text-ink">
                <input type="checkbox" checked={compararRef} onChange={(e) => setCompararRef(e.target.checked)} /> comparar con {ref.nombre}
              </label>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
                <th className="sticky left-0 z-10 w-[240px] min-w-[240px] bg-surface px-3 py-2 text-left font-bold">Documento</th>
                {anios.map((a) => (
                  <th key={a} className="w-[6.75rem] px-1.5 py-2 text-center font-bold tabular-nums">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {aplicables.map((r) => {
                const porAno = new Map(r.anios.map((a) => [a.ano, a]));
                const exigidos = r.anios.filter((a) => a.nota !== "no_presentada" && a.nota !== "no_aplica");
                const oks = exigidos.filter((a) => a.ok).length;
                const resumenFila = r.por_anio
                  ? oks === exigidos.length
                    ? `${oks} de ${exigidos.length} años · completo`
                    : `${oks} de ${exigidos.length} años · faltan ${exigidos.length - oks}`
                  : r.estado === "hecho"
                    ? `${r.mios} archivo${r.mios !== 1 ? "s" : ""} · completo`
                    : "sin archivos · falta";
                const filaOk = r.por_anio ? oks === exigidos.length : r.estado === "hecho";
                return (
                  <tr key={r.id} className="border-b border-border last:border-b-0">
                    <th scope="row" className="sticky left-0 z-10 w-[240px] min-w-[240px] max-w-[240px] bg-surface-panel px-3 py-2 text-left align-top" title={r.titulo}>
                      <p className="text-xs font-bold text-ink">{TITULO_CORTO[r.id] ?? r.titulo}</p>
                      <p className={`text-[10px] font-bold ${filaOk ? "text-emerald-700 dark:text-emerald-400" : "text-danger"}`}>
                        {resumenFila}
                        {!filaOk && (
                          <span className={`ml-1 rounded px-1 py-px text-[9px] font-bold ${r.rol === "calculo" ? "bg-danger text-white" : "bg-surface-hover text-muted"}`}>
                            {r.rol === "calculo" ? "bloquea el cálculo" : "soporte, no bloquea"}
                          </span>
                        )}
                      </p>
                      {!filaOk && <p className="text-[10px] font-normal leading-snug text-muted">{r.por_que}</p>}
                    </th>
                    {filaOk && !verCompletos ? (
                      <td colSpan={anios.length} className="px-1.5 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => setVerCompletos(true)}
                          className="inline-flex items-center gap-2 rounded-md bg-emerald-600/15 px-2.5 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-600/25 dark:text-emerald-300"
                          title="Desplegar año por año"
                        >
                          ✓ Completo{r.por_anio ? ` · ${exigidos[0]?.ano}–${exigidos[exigidos.length - 1]?.ano}` : ""} · {r.mios} archivo{r.mios !== 1 ? "s" : ""}
                          {compararRef && ref ? ` · ${ref.nombre}: ${r.ref}` : ""}
                        </button>
                      </td>
                    ) : r.por_anio ? (
                      anios.map((ano) => {
                        const a = porAno.get(ano);
                        const seleccionada = sel?.reqId === r.id && sel.ano === ano;
                        if (!a) {
                          return (
                            <td key={ano} className="px-1.5 py-2 text-center align-top">
                              <span className="inline-block rounded-md bg-surface-hover px-2 py-1 text-[10px] font-semibold text-muted" title="Este año todavía no se exige (se presenta el año siguiente)">
                                aún no
                              </span>
                            </td>
                          );
                        }
                        if (a.nota === "no_aplica") {
                          return (
                            <td key={ano} className="px-1.5 py-2 text-center align-top">
                              <button
                                type="button"
                                title={`${ano}: marcado como «no aplica este año» · clic para ver o deshacer`}
                                aria-pressed={seleccionada}
                                onClick={() => setSel(seleccionada ? null : { reqId: r.id, ano })}
                                className={`flex w-[6.25rem] flex-col items-center rounded-md border border-border bg-surface-hover px-1.5 py-1 text-ink transition hover:border-accent ${seleccionada ? "ring-2 ring-accent ring-offset-1" : ""}`}
                              >
                                <span className="text-[11px] font-bold">no aplica</span>
                                <span className="w-full truncate text-[9px] font-normal text-muted">{a.mios > 0 ? `${a.mios} archivo(s)` : "este año"}</span>
                              </button>
                            </td>
                          );
                        }
                        if (a.nota === "no_presentada") {
                          return (
                            <td key={ano} className="px-1.5 py-2 text-center align-top">
                              <button
                                type="button"
                                title={`${ano}: no se presentó declaración · el año pasa a «presentar con los activos»`}
                                aria-pressed={seleccionada}
                                onClick={() => setSel(seleccionada ? null : { reqId: r.id, ano })}
                                className={`flex w-[6.25rem] flex-col items-center rounded-md border border-border bg-surface-hover px-1.5 py-1 text-ink transition hover:border-accent ${seleccionada ? "ring-2 ring-accent ring-offset-1" : ""}`}
                              >
                                <span className="text-[11px] font-bold">no declaró</span>
                                <span className="w-full truncate text-[9px] font-normal text-muted">se presenta con cripto</span>
                              </button>
                            </td>
                          );
                        }
                        if (a.nota === "alternativa") {
                          return (
                            <td key={ano} className="px-1.5 py-2 text-center align-top">
                              <button
                                type="button"
                                title={`${ano}: ${r.alternativa_nota || "cubierto por otro documento"} · clic para ver las cifras`}
                                aria-pressed={seleccionada}
                                onClick={() => setSel(seleccionada ? null : { reqId: r.id, ano })}
                                className={`flex w-[6.25rem] flex-col items-center rounded-md border-2 border-dashed border-emerald-600/70 bg-emerald-600/15 px-1.5 py-1 text-emerald-800 transition hover:bg-emerald-600/25 dark:text-emerald-300 ${seleccionada ? "ring-2 ring-accent ring-offset-1" : ""}`}
                              >
                                <span className="text-[11px] font-bold">✓ cubierto</span>
                                <span className="w-full truncate text-[9px] font-normal">por certificado</span>
                              </button>
                            </td>
                          );
                        }
                        const incompleto = !a.ok && a.mios > 0;
                        const cls = a.ok ? "bg-emerald-600 text-white" : incompleto ? "bg-amber-500 text-white" : "bg-danger text-white";
                        const archivos = r.es_extracto ? [] : docsDe(r.categoria, ano);
                        const texto = a.unidad === "meses" ? `${a.mios}/12 m` : a.ok ? `✓ ${a.mios} arch.` : "falta";
                        const sub = a.unidad === "meses"
                          ? a.ok ? "todos los meses" : a.mios > 0 ? `faltan ${12 - a.mios} meses` : "sin extractos"
                          : archivos.length === 1
                            ? (archivos[0].ano_hasta && archivos[0].ano_hasta !== archivos[0].ano ? `cubre ${etiquetaAnos(archivos[0])}: ` : "") + archivos[0].archivo_nombre
                            : archivos.length > 1 ? `${archivos[0].archivo_nombre} +${archivos.length - 1}` : "sin archivo";
                        const tip = a.ok ? `${ano}: ${sub} · clic para ver qué hay` : `${ano}: ${sub} · clic para ver qué falta`;
                        return (
                          <td key={ano} className="px-1.5 py-2 text-center align-top">
                            <button
                              type="button"
                              title={tip}
                              aria-pressed={seleccionada}
                              onClick={() => setSel(seleccionada ? null : { reqId: r.id, ano })}
                              className={`flex w-[6.25rem] flex-col items-center rounded-md px-1.5 py-1 transition hover:opacity-90 ${cls} ${seleccionada ? "ring-2 ring-accent ring-offset-1" : ""}`}
                            >
                              <span className="text-[11px] font-bold tabular-nums">{texto}</span>
                              <span className="w-full truncate text-[9px] font-normal opacity-90" title={sub}>{sub}</span>
                            </button>
                            {compararRef && ref && (
                              <p className="mt-0.5 text-[9px] tabular-nums text-muted">{ref.nombre}: {a.unidad === "meses" ? `${a.ref}/12` : a.ref}</p>
                            )}
                          </td>
                        );
                      })
                    ) : (
                      <td colSpan={anios.length} className="px-1.5 py-2 align-top">
                        {(() => {
                          const seleccionada = sel?.reqId === r.id && sel.ano === null;
                          const archivos = docsDe(r.categoria, null);
                          const todos = exp.documentos.filter((d) => d.categoria === r.categoria);
                          const n = todos.length || archivos.length;
                          return (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                aria-pressed={seleccionada}
                                onClick={() => setSel(seleccionada ? null : { reqId: r.id, ano: null })}
                                title={r.estado === "hecho" ? "clic para ver qué hay" : "clic para ver qué falta"}
                                className={`flex min-w-[5.5rem] flex-col items-start rounded-md px-2 py-1 text-left transition hover:opacity-90 ${r.estado === "hecho" ? "bg-emerald-600 text-white" : "bg-danger text-white"} ${seleccionada ? "ring-2 ring-accent ring-offset-1" : ""}`}
                              >
                                <span className="text-[11px] font-bold">{r.estado === "hecho" ? `✓ ${n} archivo${n !== 1 ? "s" : ""}` : "falta"}</span>
                                <span className="text-[9px] font-normal opacity-90">{r.estado === "hecho" ? (todos[0]?.archivo_nombre ?? "") + (n > 1 ? ` +${n - 1}` : "") : "sin archivos"}</span>
                              </button>
                              <span className="text-[10px] text-muted">no va por año: un solo bloque de archivos</span>
                              {compararRef && ref && <span className="text-[9px] tabular-nums text-muted">· {ref.nombre}: {r.ref}</span>}
                            </div>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Detalle de la casilla seleccionada */}
        {selReq ? (
          <DetalleCasilla
            req={selReq}
            ano={sel?.ano ?? null}
            exp={exp}
            terceroId={terceroId}
            subiendo={subiendo}
            onSubir={(ano) => accion(selReq, ano)}
            onCerrar={() => setSel(null)}
            onError={(t) => setMsg({ tipo: "error", texto: t })}
            onEstadoAnio={(ano, estado) => estadoAnio.mutate({ ano, estado })}
            onOmitirAno={(ano, om) => omitir.mutate({ id: `${selReq.id}:${ano}`, omitir: om })}
            onRango={(docId, hasta) => rango.mutate({ docId, hasta })}
          />
        ) : (
          <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted">
            Haz clic en una casilla: si está en verde verás los archivos cargados; si está en rojo, qué falta, para qué sirve y el botón para subirlo.
          </p>
        )}
      </div>
      {/* 3. Qué falta y cómo conseguirlo */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink">
          <Icon name="warning" size={14} weight="bold" className={resumen.faltantes.length ? "text-danger" : "text-emerald-600"} />
          {resumen.faltantes.length ? `Qué falta y cómo conseguirlo (${resumen.faltantes.length})` : "No falta nada"}
        </h4>
        {faltaPorReq.length > 0 && (
          <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${faltaPorReq.some((g) => g.req.rol === "calculo") ? "bg-danger/10 text-danger" : "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"}`}>
            {faltaPorReq.some((g) => g.req.rol === "calculo")
              ? "Hay documentos que bloquean el cálculo (primero en la lista). El resto es soporte."
              : "Nada de lo que falta bloquea el cálculo: son soportes para justificar origen de fondos y cifras del resto del F210. Se pueden conseguir en paralelo a la corrección."}
          </p>
        )}
        {faltaPorReq.length === 0 && (
          <p className="rounded-lg bg-emerald-600/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            Todos los documentos que pide tu caso están cargados. Sigue con el siguiente paso.
          </p>
        )}
        {faltaPorReq.map(({ req: r, items }, i) => {
          const open = abiertoFalta === r.id || (abiertoFalta === null && i === 0);
          return (
            <div key={r.id} className={`${card} ${r.rol === "calculo" ? "border-danger/50" : "border-amber-600/30"}`}>
              <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left" onClick={() => setAbiertoFalta(open ? "" : r.id)}>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${r.rol === "calculo" ? "bg-danger" : "bg-amber-500"}`}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">
                    {TITULO_CORTO[r.id] ?? r.titulo}
                    <span className={`ml-2 rounded px-1.5 py-px text-[9px] font-bold ${r.rol === "calculo" ? "bg-danger text-white" : "bg-surface-hover text-muted"}`}>
                      {r.rol === "calculo" ? "bloquea el cálculo" : "soporte, no bloquea"}
                    </span>
                  </span>
                  <span className="block text-[11px] text-danger">
                    {r.por_anio
                      ? `Falta: ${items.map((f) => (f.req.es_extracto && f.mios > 0 ? `${f.ano} (${mesesTexto(f.meses)})` : String(f.ano))).join(" · ")}`
                      : "Falta el bloque completo"}
                  </span>
                </span>
                <Icon name="caretDown" size={14} weight="bold" className={`text-muted transition ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <div className="space-y-2.5 border-t border-border px-3 py-3">
                  <p className="text-xs text-ink-secondary"><b className="text-ink">Para qué sirve:</b> {r.por_que}</p>
                  {r.impacto && <p className="text-xs text-ink-secondary"><b className="text-ink">Si no se consigue:</b> {r.impacto}</p>}
                  <p className="text-xs text-ink-secondary"><b className="text-ink">Cómo conseguirlo:</b> {r.como}</p>
                  {r.es_extracto && items.some((f) => f.sinImportar > 0) && (
                    <p className="rounded-lg bg-amber-600/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Ojo: {items.filter((f) => f.sinImportar > 0).map((f) => `${f.sinImportar} archivo${f.sinImportar !== 1 ? "s" : ""} de ${f.ano}`).join(" y ")} ya están en el
                      expediente como documentos, pero no se han importado como extracto, así que no cuentan para la cobertura mensual. Súbelos en «Extractos personales».
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {r.por_anio ? (
                      items.map((f) => (
                        <button
                          key={f.ano ?? "x"}
                          type="button"
                          className={btnPrimario}
                          disabled={subiendo === `${r.categoria}:${f.ano}`}
                          onClick={() => accion(r, f.ano ?? undefined)}
                        >
                          <Icon name={r.es_extracto ? "receipt" : "paperclip"} size={14} weight="bold" />
                          {r.es_extracto ? `Cargar extractos ${f.ano}` : subiendo === `${r.categoria}:${f.ano}` ? "Subiendo…" : `Subir ${f.ano}`}
                        </button>
                      ))
                    ) : (
                      <button type="button" className={btnPrimario} disabled={subiendo === `${r.categoria}:`} onClick={() => accion(r)}>
                        <Icon name="paperclip" size={14} weight="bold" /> {subiendo === `${r.categoria}:` ? "Subiendo…" : "Subir archivo"}
                      </button>
                    )}
                    <button type="button" className={btnSec} disabled={omitir.isPending} onClick={() => omitir.mutate({ id: r.id, omitir: true })}>
                      No aplica en mi caso
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 4. Ya cargado: archivos reales por documento y año */}
      <div className={card}>
        <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left" onClick={() => setVerCargados((v) => !v)}>
          <Icon name="check" size={14} weight="bold" className="text-emerald-600" />
          <span className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-ink">
            Ya cargado: {exp.documentos.length} archivo{exp.documentos.length !== 1 ? "s" : ""}
            {exp.extractos.length ? ` y ${exp.extractos.length} extracto${exp.extractos.length !== 1 ? "s" : ""}` : ""}
          </span>
          <span className="text-[11px] text-muted">{verCargados ? "ocultar" : "ver la lista"}</span>
          <Icon name="caretDown" size={14} weight="bold" className={`text-muted transition ${verCargados ? "rotate-180" : ""}`} />
        </button>
        {verCargados && (
          <div className="space-y-3 border-t border-border px-3 py-3">
            {aplicables.map((r) => {
              if (r.es_extracto) {
                const cuentas = exp.cobertura.cuentas;
                if (!cuentas.length) return null;
                return (
                  <div key={r.id}>
                    <p className="text-xs font-bold text-ink">{TITULO_CORTO[r.id] ?? r.titulo}</p>
                    <ul className="mt-1 space-y-0.5">
                      {cuentas.map((c) => (
                        <li key={`${c.banco}:${c.cuenta}`} className="text-[11px] text-ink-secondary">
                          {c.banco} {c.cuenta ? `· ${c.cuenta}` : ""}: {c.meses.length} mes{c.meses.length !== 1 ? "es" : ""} ({c.desde} → {c.hasta}), {c.extractos} extracto{c.extractos !== 1 ? "s" : ""}, {c.lineas} movimientos
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="mt-1 text-[11px] font-bold text-accent underline" onClick={() => onIr("extractos")}>ver o cargar extractos</button>
                    {(() => {
                      const archivos = exp.documentos.filter((d) => d.categoria === r.categoria);
                      if (!archivos.length) return null;
                      return (
                        <p className="mt-1 text-[10px] text-muted">
                          Además hay {archivos.length} archivo{archivos.length !== 1 ? "s" : ""} de extracto en el expediente (carpeta o subidos) que no se importaron como
                          extracto y no cuentan en la cobertura: se ven en «Activos digitales → Documentos».
                        </p>
                      );
                    })()}
                  </div>
                );
              }
              const anosConDocs = r.por_anio ? r.anios.filter((a) => a.mios > 0).map((a) => a.ano) : [];
              const sueltos = docsDe(r.categoria, null);
              const yaListados = new Set<number>();
              if (!anosConDocs.length && !sueltos.length) return null;
              return (
                <div key={r.id}>
                  <p className="text-xs font-bold text-ink">{TITULO_CORTO[r.id] ?? r.titulo}</p>
                  <ul className="mt-1 space-y-0.5">
                    {anosConDocs.map((ano) =>
                      docsDe(r.categoria, ano).filter((d) => !yaListados.has(d.id) && yaListados.add(d.id)).map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2 text-[11px] text-ink-secondary">
                          <span className="w-16 shrink-0 font-bold tabular-nums text-ink">{etiquetaAnos(d)}</span>
                          <span className="min-w-0 flex-1 truncate">{d.archivo_nombre}</span>
                          {!d.existe && <span className="text-[10px] text-danger">(no está en disco)</span>}
                          {d.existe && (
                            <button type="button" className="font-bold text-accent underline" onClick={() => void abrirArchivo(`/api/socios/${terceroId}/documentos/${d.id}/archivo`, (t) => setMsg({ tipo: "error", texto: t }))}>
                              abrir
                            </button>
                          )}
                        </li>
                      )),
                    )}
                    {sueltos.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 text-[11px] text-ink-secondary">
                        <span className="w-10 shrink-0 text-[10px] text-muted">s/año</span>
                        <span className="min-w-0 flex-1 truncate">{d.archivo_nombre}</span>
                        {!d.existe && <span className="text-[10px] text-danger">(no está en disco)</span>}
                        {d.existe && (
                          <button type="button" className="font-bold text-accent underline" onClick={() => void abrirArchivo(`/api/socios/${terceroId}/documentos/${d.id}/archivo`, (t) => setMsg({ tipo: "error", texto: t }))}>
                            abrir
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {exp.documentos.length === 0 && exp.extractos.length === 0 && <p className="text-xs text-muted">Todavía no hay nada cargado.</p>}
          </div>
        )}
      </div>

      {/* 5. No aplica / omitidos */}
      {resumen.noAplican.length > 0 && (
        <div className={card}>
          <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left" onClick={() => setVerNoAplican((v) => !v)}>
            <Icon name="minus" size={14} weight="bold" className="text-muted" />
            <span className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-muted">No se pide en tu caso ({resumen.noAplican.length})</span>
            <Icon name="caretDown" size={14} weight="bold" className={`text-muted transition ${verNoAplican ? "rotate-180" : ""}`} />
          </button>
          {verNoAplican && (
            <ul className="space-y-1.5 border-t border-border px-3 py-3">
              {resumen.noAplican.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 text-ink">{TITULO_CORTO[r.id] ?? r.titulo}</span>
                  {r.omitido ? (
                    <>
                      <span className="text-[10px] text-muted">lo marcaste como «no aplica»</span>
                      <button type="button" className={btnSec} disabled={omitir.isPending} onClick={() => omitir.mutate({ id: r.id, omitir: false })}>Volver a pedirlo</button>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted">según tus respuestas no hace falta · cámbialas en «Empecemos» si sí aplica</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 6. Otras formas de cargar: carpeta del servidor + referencia */}
      <div className="grid gap-2 lg:grid-cols-2">
        <div className={`${card} space-y-1.5 px-3 py-2.5`}>
          <p className="text-xs font-bold text-ink">Otra forma de cargar: tu carpeta en el servidor</p>
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
            Puedes dejar los archivos en esa carpeta (hay un LEEME con qué va dónde) o subirlos desde la matriz de arriba. El expediente queda igual.
          </p>
        </div>
        <div className={`${card} px-3 py-2.5`}>
          {ref ? (
            <>
              <p className="text-xs font-bold text-ink">Referencia: así lo hizo {ref.nombre}</p>
              <p className="text-[11px] text-muted">
                {ref.documentos} documentos organizados{ref.desde ? ` desde ${ref.desde}` : ""}. Activa «comparar con {ref.nombre}» en el mapa para ver sus cantidades
                junto a las tuyas. Solo se muestran cantidades, nunca cifras ni archivos.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted">Eres el primer socio en organizar el expediente; tu carpeta servirá de referencia para el otro.</p>
          )}
        </div>
      </div>
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

  const subirUno = async (file: File, aplicarNombre: boolean) => {
    const fd = new FormData();
    fd.append("archivo", file);
    fd.append("tercero_id", String(terceroId));
    if (banco.trim()) fd.append("banco", banco.trim());
    if (cuenta.trim()) fd.append("cuenta", cuenta.trim());
    if (aplicarNombre && nombre.trim()) fd.append("nombre", nombre.trim());
    const r = await api.upload<{ ok?: boolean; error?: string; extracto?: ExtractoResumen }>(
      "/api/contabilidad/extractos",
      fd,
      { timeoutMs: 180_000 },
    );
    if (r.error) throw new Error(r.error);
    return r.extracto;
  };

  /** Sube uno o varios extractos, en orden: el nombre manual solo aplica cuando es un solo archivo. */
  const subir = async (archivos: File[]) => {
    if (archivos.length === 0) return;
    const varios = archivos.length > 1;
    setBusy(true);
    setMsg(varios ? { tipo: "ok", texto: `Subiendo 1 de ${archivos.length}…` } : null);
    const hechos: string[] = [];
    const fallos: string[] = [];
    try {
      for (let i = 0; i < archivos.length; i++) {
        const file = archivos[i];
        if (varios) setMsg({ tipo: "ok", texto: `Subiendo ${i + 1} de ${archivos.length}: «${file.name}»…` });
        try {
          const ex = await subirUno(file, !varios);
          hechos.push(
            `«${ex?.nombre ?? file.name}»: ${ex?.lineas_count ?? 0} líneas (${ex?.periodo_desde} → ${ex?.periodo_hasta})`,
          );
        } catch (e) {
          fallos.push(`«${file.name}»: ${(e as Error).message || "no se pudo subir"}`);
        }
      }
      if (!varios) {
        setMsg(
          hechos.length
            ? { tipo: "ok", texto: `Extracto ${hechos[0]}.` }
            : { tipo: "error", texto: fallos[0] ?? "No se pudo subir" },
        );
      } else {
        const partes = [
          `${hechos.length} de ${archivos.length} extractos guardados.`,
          ...(hechos.length ? [hechos.join(" · ")] : []),
          ...(fallos.length ? [`No se pudieron subir: ${fallos.join(" · ")}`] : []),
        ];
        setMsg({ tipo: fallos.length ? "error" : "ok", texto: partes.join(" ") });
      }
      if (hechos.length) {
        if (!varios) setNombre("");
        invalidar();
      }
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
          Sube los extractos del banco <b>del socio</b> (CSV, Excel o PDF); puedes marcar varios con Shift o Ctrl y se
          suben uno tras otro. Quedan marcados como personales: no entran a la conciliación de McKenna, solo se cruzan
          con ella en el paso «Cruces».
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Campo label="Banco">
            <input className={`${input} w-40`} value={banco} onChange={(e) => setBanco(e.target.value)} />
          </Campo>
          <Campo label="Cuenta">
            <input className={`${input} w-40`} value={cuenta} onChange={(e) => setCuenta(e.target.value)} placeholder="912-004312-49" />
          </Campo>
          <Campo label="Nombre (opcional, solo si subes uno)">
            <input className={`${input} w-52`} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ahorros 2025 T1" />
          </Campo>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.txt,.tsv,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void subir(files);
            }}
          />
          <button
            type="button"
            className={btnPrimario}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            title="Puedes marcar varios archivos con Shift o Ctrl"
          >
            <Icon name="download" size={14} weight="bold" />
            {busy ? "Subiendo…" : "Subir extractos"}
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

function PasoDeclarador({ terceroId, exp, onChanged, onIr }: { terceroId: number; exp: Expediente; onChanged: () => void; onIr: (p: PasoId) => void }) {
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
      {sub === "documentos" && <Documentos terceroId={terceroId} exp={exp} onChanged={onChanged} onIr={onIr} />}
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
              <th className="px-3 py-2 text-right font-bold">Costo cripto 31-dic</th>
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
                <td className="px-3 py-1.5 text-right tabular-nums text-ink" title={a.cripto_costo_cierre_usd !== null ? `${usd(a.cripto_costo_cierre_usd)} · TRM ${a.trm_cierre ?? "—"}` : ""}>{cop(a.cripto_costo_cierre_cop)}</td>
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

function Documentos({ terceroId, exp, onChanged, onIr }: { terceroId: number; exp: Expediente; onChanged: () => void; onIr: (p: PasoId) => void }) {
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
      <ResumenDocsBanner exp={exp} onIr={onIr} />
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
                    {etiquetaAnos(d)} · {kb(d.tamano)} · {d.origen === "carpeta" ? "carpeta Declarador" : "subido"}
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

/* ─── Paso 7: Expediente para el contador (línea de tiempo) ──────────────── */

interface HitoCrono {
  fecha: string;
  tipo: "declaracion" | "credito" | "p2p" | "movimiento";
  titulo: string;
  detalle: string;
  monto: number | null;
  entrada?: boolean;
  fuente: string;
}

interface DocCrono {
  id: number;
  categoria: string;
  categoria_label: string;
  archivo_nombre: string;
  ruta: string;
  ano?: number | null;
  ano_hasta?: number | null;
  existe?: boolean;
  legible?: boolean;
}

interface AnioCrono {
  ano: number;
  estado: string;
  situacion: string | null;
  accion: string | null;
  presentacion: { estado: string; ventana: string; turno_habitual: string | null; nota: string } | null;
  declarado: {
    formulario: string;
    presentada_en: string;
    patrimonio_bruto: number | null;
    deudas: number | null;
    patrimonio_liquido: number | null;
    renta_liquida: number | null;
    impuesto_pagado: number | null;
  };
  cripto: {
    efecto: number | null;
    renta_ordinaria: number | null;
    ganancia_ocasional: number | null;
    sin_costo: number | null;
    eventos: number | null;
    tenencia_usd: number | null;
    tenencia_cop: number | null;
    trm: number | null;
    detalle: { coin: string; cantidad: number; costo_usd: number }[];
    snapshot_usd: number | null;
  };
  correccion: CorreccionAnio | null;
  banco: { meses_extracto: number; meses_faltan: string[]; tarjeta?: TarjetaAnio };
  hitos: HitoCrono[];
  documentos: DocCrono[];
  hallazgos: { id: number; titulo: string; severidad: string; estado: string; detalle: string }[];
}

interface Cronologia {
  carpeta: string;
  titular: { nombre: string; cedula: string; binance_uid: string };
  anios: AnioCrono[];
  sin_ano: DocCrono[];
  totales?: Objetivo["totales"];
  parametros?: Objetivo["parametros"];
  generado: string;
}

const ICONO_HITO: Record<HitoCrono["tipo"], { icon: IconName; cls: string; label: string }> = {
  declaracion: { icon: "scroll", cls: "bg-accent text-white", label: "Declaración" },
  credito: { icon: "handshake", cls: "bg-amber-500 text-white", label: "Crédito" },
  p2p: { icon: "arrowSub", cls: "bg-sky-600 text-white", label: "P2P" },
  movimiento: { icon: "package", cls: "bg-surface-hover text-ink", label: "Movimiento" },
};

function fechaLarga(iso: string): string {
  const [y, m, d] = (iso || "").split("-");
  if (!y || !m || !d) return iso;
  return `${Number(d)} ${MES_LARGO[Number(m) - 1]?.slice(0, 3) ?? m} ${y}`;
}

function Dato({ label, valor, nota, fuerte }: { label: string; valor: ReactNode; nota?: string; fuerte?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 py-1 last:border-b-0">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`text-right tabular-nums ${fuerte ? "text-sm font-extrabold text-ink" : "text-[11px] font-bold text-ink"}`}>
        {valor}
        {nota && <span className="block text-[10px] font-normal text-muted">{nota}</span>}
      </span>
    </div>
  );
}

function BloqueAnio({ a, terceroId, onError }: { a: AnioCrono; terceroId: number; onError: (t: string) => void }) {
  const [verHitos, setVerHitos] = useState(false);
  const [verDocs, setVerDocs] = useState(false);
  const st = SITUACION_META[a.situacion ?? ""] ?? { label: ESTADO_ANIO_LABEL[a.estado] ?? a.estado, cls: "bg-surface-hover text-ink" };
  const d = a.declarado;
  const c = a.cripto;
  const patrimonioReal = d.patrimonio_bruto !== null && c.tenencia_cop !== null ? d.patrimonio_bruto + c.tenencia_cop : null;
  const hitosClave = a.hitos.filter((h) => h.tipo === "declaracion" || h.tipo === "credito" || (h.tipo === "p2p" && (h.monto ?? 0) >= 1_000_000));
  const mostrados = verHitos ? a.hitos : hitosClave;

  return (
    <section id={`crono-${a.ano}`} className={`${card} scroll-mt-4 overflow-hidden`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-2.5">
        <h3 className="text-2xl font-extrabold tabular-nums text-ink">{a.ano}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
        {d.presentada_en && <span className="text-[11px] text-muted">Declarada el {fechaLarga(d.presentada_en)} · F{d.formulario || "—"}</span>}
        {a.correccion && (a.correccion.mayor_valor ?? 0) > 0 && (
          <span className="ml-auto text-[11px] font-bold text-danger">Corregir cuesta {cop(a.correccion.total_estimado)}</span>
        )}
      </header>

      {a.accion && (
        <p className="border-b border-border bg-surface-panel px-4 py-2 text-xs text-ink-secondary">
          <b className="text-ink">Qué hacer con este año:</b> {a.accion}
          {a.situacion === "en_preparacion" && a.presentacion && <> Ventana: {a.presentacion.ventana}.</>}
        </p>
      )}

      <div className="grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-3">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">1 · Lo que dice la declaración</p>
          {d.presentada_en || d.patrimonio_bruto !== null ? (
            <>
              <Dato label="Patrimonio bruto (r. 29)" valor={cop(d.patrimonio_bruto)} />
              <Dato label="Deudas (r. 30)" valor={cop(d.deudas)} />
              <Dato label="Renta líquida gravable" valor={cop(d.renta_liquida)} />
              <Dato label="Impuesto a cargo" valor={cop(d.impuesto_pagado)} />
              <p className="mt-1 text-[10px] text-danger">Sin criptoactivos: ni en el patrimonio ni en los ingresos.</p>
            </>
          ) : (
            <p className="text-[11px] text-muted">{a.situacion === "en_preparacion" ? "Todavía no se presenta; se está preparando." : "No hay declaración registrada para este año."}</p>
          )}
        </div>

        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">2 · Lo que realmente pasó</p>
          <Dato
            label="Tenencia en Binance al 31-dic"
            valor={c.tenencia_cop === null ? "—" : cop(c.tenencia_cop)}
            nota={c.tenencia_usd !== null ? `${usd(c.tenencia_usd)} a costo fiscal · TRM ${c.trm?.toLocaleString("es-CO") ?? "—"}` : undefined}
            fuerte
          />
          {c.detalle.length > 0 && (
            <p className="py-1 text-[10px] leading-relaxed text-ink-secondary">
              {c.detalle.map((x) => `${x.coin} ${x.cantidad.toLocaleString("es-CO", { maximumFractionDigits: 4 })}`).join(" · ")}
            </p>
          )}
          <Dato
            label="Ganancia o pérdida realizada"
            valor={c.efecto === null ? "sin calcular" : cop(c.efecto)}
            nota={c.eventos ? `${c.eventos.toLocaleString("es-CO")} operaciones de disposición` : undefined}
            fuerte
          />
          {patrimonioReal !== null && (
            <p className="mt-1 rounded bg-danger/10 px-2 py-1 text-[10px] font-semibold text-danger">
              Patrimonio bruto real del año: {cop(patrimonioReal)} ({cop(d.patrimonio_bruto)} declarado + {cop(c.tenencia_cop)} en cripto).
            </p>
          )}
          {c.snapshot_usd !== null && <p className="mt-1 text-[10px] text-muted">Snapshot oficial de Binance: {usd(c.snapshot_usd)}.</p>}
        </div>

        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">3 · Efecto de corregir</p>
          {a.correccion && a.correccion.uvt_cargada ? (
            <>
              <Dato label="Renta líquida corregida" valor={cop(a.correccion.rlg_corregida)} nota={`declarada ${cop(a.correccion.rlg_declarada)}`} />
              <Dato label="Impuesto corregido" valor={cop(a.correccion.impuesto_corregido)} nota={`pagado ${cop(a.correccion.impuesto_pagado ?? 0)}`} />
              {(a.correccion.mayor_valor ?? 0) > 0 ? (
                <>
                  <Dato label="Mayor impuesto" valor={<span className="text-danger">{cop(a.correccion.mayor_valor)}</span>} />
                  <Dato label="Sanción (10 %)" valor={cop(a.correccion.sancion_correccion_10)} />
                  <Dato label="Intereses de mora" valor={cop(a.correccion.intereses_mora)} nota={`${a.correccion.intereses_dias} días desde ${fechaLarga(a.correccion.intereses_desde)}`} />
                  <Dato label="Total" valor={<span className="text-danger">{cop(a.correccion.total_estimado)}</span>} fuerte />
                </>
              ) : (a.correccion.mayor_valor ?? 0) < 0 ? (
                <p className="mt-1 text-[11px] text-ink-secondary">La corrección da <b>{cop(-(a.correccion.mayor_valor ?? 0))} a favor</b>; evaluar si el término del Art. 589 sigue abierto.</p>
              ) : (
                <p className="mt-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">Incluir la cripto no genera impuesto adicional este año.</p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-muted">{a.situacion === "en_preparacion" ? "Se liquida directamente en la declaración que se presenta ahora." : "Sin cálculo para este año."}</p>
          )}
          <div className="mt-2 space-y-0.5 border-t border-border pt-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Respaldo bancario</p>
            <p className="text-[11px] text-ink-secondary">
              Cuenta de ahorros: <b className={a.banco.meses_extracto >= 12 ? "text-emerald-700 dark:text-emerald-400" : "text-danger"}>{a.banco.meses_extracto}/12 meses</b>
              {a.banco.meses_faltan.length > 0 && ` (faltan ${mesesTexto(a.banco.meses_faltan)})`}
            </p>
            {a.banco.tarjeta && (
              <p className="text-[11px] text-ink-secondary">
                Tarjeta: consumos {cop(a.banco.tarjeta.consumos?.COP?.valor ?? 0)}
                {a.banco.tarjeta.consumos?.USD ? ` + ${usd(a.banco.tarjeta.consumos.USD.valor)}` : ""} ·{" "}
                {a.banco.tarjeta.avances ? <b className="text-danger">{a.banco.tarjeta.avances.operaciones} avance(s) en efectivo</b> : "sin avances"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Línea de tiempo del año */}
      {a.hitos.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
              Movimientos del año: declaración, créditos y operaciones con contraparte bancaria ({mostrados.length}{verHitos || mostrados.length === a.hitos.length ? "" : ` de ${a.hitos.length}`})
            </p>
            {mostrados.length !== a.hitos.length || verHitos ? (
              <button type="button" className="text-[11px] font-bold text-accent underline" onClick={() => setVerHitos((v) => !v)}>
                {verHitos ? "ver solo los relevantes" : `ver también los ${a.hitos.length - hitosClave.length} traslados y retiros`}
              </button>
            ) : null}
          </div>
          <ol className="mt-2 space-y-0">
            {mostrados.map((h, i) => {
              const ic = ICONO_HITO[h.tipo] ?? ICONO_HITO.movimiento;
              return (
                <li key={`${h.fecha}-${i}`} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${ic.cls}`} title={ic.label}>
                      <Icon name={ic.icon} size={12} weight="bold" />
                    </span>
                    {i < mostrados.length - 1 && <span className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-3">
                    <p className="text-[11px] font-bold text-ink">
                      <span className="tabular-nums text-muted">{fechaLarga(h.fecha)}</span> · {h.titulo}
                      {h.monto ? <span className="ml-1 tabular-nums text-ink-secondary">({cop(h.monto)})</span> : null}
                    </p>
                    <p className="text-[10px] leading-snug text-muted">{h.detalle} · fuente: {h.fuente}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Soportes */}
      <div className="border-t border-border px-4 py-2.5">
        <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setVerDocs((v) => !v)}>
          <Icon name="paperclip" size={13} weight="bold" className="text-muted" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink">Soportes de {a.ano} ({a.documentos.length})</span>
          <span className="text-[10px] text-muted">{verDocs ? "ocultar" : "ver y abrir"}</span>
          <Icon name="caretDown" size={12} weight="bold" className={`text-muted transition ${verDocs ? "rotate-180" : ""}`} />
        </button>
        {verDocs && (
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {a.documentos.map((doc) => (
              <button
                key={doc.id}
                type="button"
                disabled={!doc.existe}
                onClick={() => void abrirArchivo(`/api/socios/${terceroId}/documentos/${doc.id}/archivo`, onError)}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1 text-left hover:border-accent disabled:opacity-50"
              >
                <span className="rounded bg-surface-hover px-1.5 py-px text-[9px] font-bold text-muted">{doc.categoria_label}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-ink">{doc.archivo_nombre}</span>
                  <span className="block truncate font-mono text-[9px] text-muted" title={doc.ruta}>{doc.ruta}</span>
                </span>
                {doc.ano_hasta && doc.ano_hasta !== doc.ano && <span className="text-[9px] text-muted">{doc.ano}–{doc.ano_hasta}</span>}
              </button>
            ))}
            {a.documentos.length === 0 && <p className="text-[11px] text-muted">Sin documentos fechados en este año.</p>}
          </div>
        )}
      </div>

      {a.hallazgos.length > 0 && (
        <div className="border-t border-border bg-amber-600/5 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Preguntas abiertas de este año ({a.hallazgos.length})</p>
          <ul className="mt-1 space-y-1">
            {a.hallazgos.map((h) => (
              <li key={h.id} className="text-[11px] text-ink-secondary">
                <span className={`mr-1 rounded px-1 py-px text-[9px] font-bold ${SEV_BADGE[h.severidad] ?? ""}`}>{h.severidad}</span>
                <b className="text-ink">{h.titulo}.</b> {h.detalle.slice(0, 260)}{h.detalle.length > 260 ? "…" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PasoCierre({ terceroId, exp, onIr }: { terceroId: number; exp: Expediente; onIr: (p: PasoId) => void }) {
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [bajando, setBajando] = useState(false);

  /** El PDF se regenera en cada descarga y queda también en la carpeta del socio. */
  const descargarPdf = async () => {
    setBajando(true);
    setMsg(null);
    try {
      const url = await fetchAuthBlobUrl(`/api/socios/${terceroId}/informe.pdf`);
      if (!url) throw new Error("No se pudo generar el PDF");
      const a = document.createElement("a");
      a.href = url;
      a.download = "Expediente_Criptoactivos.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMsg({ tipo: "ok", texto: "PDF descargado. También quedó guardado en 00_Informe_Para_El_Contador/ dentro de la carpeta del expediente." });
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message });
    } finally {
      setBajando(false);
    }
  };
  const cronoQ = useQuery<Cronologia>({
    queryKey: ["socio-cronologia", terceroId],
    queryFn: () => api.get(`/api/socios/${terceroId}/cronologia`),
  });
  const abiertos = exp.hallazgos.filter((h) => h.estado === "pendiente" || h.estado === "en_curso");

  const texto = useMemo(() => {
    const c = cronoQ.data;
    if (!c) return "";
    const l: string[] = [];
    l.push(`EXPEDIENTE FISCAL — ${c.titular.nombre}${c.titular.cedula ? ` (CC ${c.titular.cedula})` : ""}`);
    l.push(`Criptoactivos omitidos en las declaraciones de renta. Generado ${new Date(c.generado).toLocaleString("es-CO")} desde el panel McKenna.`);
    if (c.totales) {
      l.push("");
      l.push(`TOTAL A REGULARIZAR: impuesto ${cop(c.totales.mayor_valor)} + sanción ${cop(c.totales.sancion_correccion_10)} + intereses ${cop(c.totales.intereses_mora)} = ${cop(c.totales.total_estimado)}`);
      l.push(`(intereses estimados al ${Math.round((c.parametros?.tasa_mora_anual ?? 0) * 1000) / 10} % anual; liquidar con la herramienta oficial de la DIAN)`);
    }
    for (const a of c.anios) {
      l.push("");
      l.push(`── ${a.ano} · ${SITUACION_META[a.situacion ?? ""]?.label ?? a.estado} ──`);
      if (a.declarado.presentada_en) l.push(`Declarada ${a.declarado.presentada_en} · F${a.declarado.formulario}`);
      l.push(`Declarado: patrimonio ${cop(a.declarado.patrimonio_bruto)} · deudas ${cop(a.declarado.deudas)} · renta líquida ${cop(a.declarado.renta_liquida)} · impuesto ${cop(a.declarado.impuesto_pagado)}`);
      l.push(`Cripto: tenencia 31-dic ${cop(a.cripto.tenencia_cop)} (${usd(a.cripto.tenencia_usd)}) · efecto del año ${cop(a.cripto.efecto)}`);
      if (a.correccion?.uvt_cargada && (a.correccion.mayor_valor ?? 0) > 0) {
        l.push(`Corregir: impuesto ${cop(a.correccion.mayor_valor)} + sanción ${cop(a.correccion.sancion_correccion_10)} + intereses ${cop(a.correccion.intereses_mora)} = ${cop(a.correccion.total_estimado)}`);
      }
      l.push(`Soportes (${a.documentos.length}): ${a.documentos.map((d) => d.archivo_nombre).join(", ") || "—"}`);
      if (a.hallazgos.length) l.push(`Pendientes: ${a.hallazgos.map((h) => h.titulo).join(" · ")}`);
    }
    return l.join("\n");
  }, [cronoQ.data]);

  if (cronoQ.isLoading) return <p className="text-sm text-muted">Armando la línea de tiempo…</p>;
  if (cronoQ.isError || !cronoQ.data) return <p className="text-sm font-semibold text-danger">{(cronoQ.error as Error)?.message || "No se pudo cargar la cronología"}</p>;
  const c = cronoQ.data;

  return (
    <div className="space-y-3">
      <div className={`${card} flex flex-wrap items-start justify-between gap-3 px-4 py-3`}>
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">Expediente de {c.titular.nombre}{c.titular.cedula ? ` · CC ${c.titular.cedula}` : ""}</p>
          <p className="text-[11px] text-ink-secondary">
            Un bloque por año gravable, en orden: qué se declaró, qué pasó de verdad, qué cuesta corregirlo y con qué documento se prueba.
            {c.titular.binance_uid && ` Cuenta Binance ${c.titular.binance_uid}.`}
          </p>
          {c.carpeta && (
            <p className="mt-0.5 font-mono text-[10px] text-muted" title="Los soportes citados están aquí, en subcarpetas numeradas">
              {c.carpeta}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btnPrimario} disabled={bajando} onClick={() => void descargarPdf()}>
            <Icon name="download" size={13} weight="bold" /> {bajando ? "Generando…" : "Descargar informe en PDF"}
          </button>
          <button
            type="button"
            className={btnSec}
            onClick={() => {
              void navigator.clipboard.writeText(texto).then(() => {
                setCopiado(true);
                window.setTimeout(() => setCopiado(false), 2500);
              });
            }}
          >
            <Icon name="file" size={13} weight="bold" /> {copiado ? "¡Copiado!" : "Copiar como texto"}
          </button>
          {abiertos.length > 0 && (
            <button type="button" className={btnSec} onClick={() => onIr("declarador")}>
              <Icon name="warning" size={13} weight="bold" /> {abiertos.length} pendiente{abiertos.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>

      {c.totales && c.totales.total_estimado > 0 && (
        <div className={`${card} border-danger/40 bg-danger/5 px-4 py-3`}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-danger">Total a regularizar por los años ya presentados</p>
          <p className="text-2xl font-extrabold tabular-nums text-ink">{cop(c.totales.total_estimado)}</p>
          <p className="text-[11px] text-ink-secondary">
            impuesto {cop(c.totales.mayor_valor)} + sanción por corrección {cop(c.totales.sancion_correccion_10)} + intereses de mora {cop(c.totales.intereses_mora)} (estimados al{" "}
            {Math.round((c.parametros?.tasa_mora_anual ?? 0) * 1000) / 10} % anual; los definitivos los liquida la DIAN).
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {c.anios.map((a) => {
          const st = SITUACION_META[a.situacion ?? ""] ?? { label: a.estado, cls: "bg-surface-hover text-ink" };
          return (
            <a key={a.ano} href={`#crono-${a.ano}`} className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>
              {a.ano} · {st.label}
            </a>
          );
        })}
      </div>

      {c.anios.map((a) => (
        <BloqueAnio key={a.ano} a={a} terceroId={terceroId} onError={(t) => setMsg({ tipo: "error", texto: t })} />
      ))}

      {c.sin_ano.length > 0 && (
        <details className={`${card} px-4 py-2.5`}>
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-muted">
            Soportes sin año asignado ({c.sin_ano.length}) — cálculos, informes y evidencia que cubre todo el período
          </summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {c.sin_ano.map((doc) => (
              <button
                key={doc.id}
                type="button"
                disabled={!doc.existe}
                onClick={() => void abrirArchivo(`/api/socios/${terceroId}/documentos/${doc.id}/archivo`, (t) => setMsg({ tipo: "error", texto: t }))}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1 text-left hover:border-accent disabled:opacity-50"
              >
                <span className="rounded bg-surface-hover px-1.5 py-px text-[9px] font-bold text-muted">{doc.categoria_label}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{doc.archivo_nombre}</span>
              </button>
            ))}
          </div>
        </details>
      )}
      <Msg m={msg} />
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
