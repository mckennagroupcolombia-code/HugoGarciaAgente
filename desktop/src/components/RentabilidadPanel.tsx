import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Componente {
  id: number;
  name: string;
  quantity: number;
}

interface CostosConfig {
  costo_materiales?: number;
  costo_nomina?: number;
  costo_envase?: number;
  costo_etiqueta?: number;
  otros_costos?: number;
  comision_pct?: number;
  margen_objetivo_pct?: number;
  updated_at?: string;
}

interface Producto {
  code: string;
  name: string;
  precio_lista: number;
  iva_pct: number;
  tax_included: boolean;
  components: Componente[];
  config_guardada: boolean;
  costos: CostosConfig | null;
}

interface ResultadoCalculo {
  precio_lista: number;
  precio_sin_iva: number;
  iva_valor: number;
  comision_valor: number;
  comision_pct: number;
  ingreso_neto: number;
  costo_total: number;
  utilidad_bruta: number;
  utilidad_neta: number;
  margen_bruto_pct: number;
  margen_neto_pct: number;
  es_rentable: boolean;
  precio_sugerido: number | null;
}

interface TopProducto {
  code: string;
  name: string;
  qty: number;
  total: number;
  utilidad_estimada?: number;
}

interface ResumenPeriodo {
  fecha_inicio: string;
  fecha_fin: string;
  num_facturas: number;
  total_con_iva: number;
  total_sin_iva: number;
  total_iva: number;
  promedio_por_factura: number;
  top_productos: TopProducto[];
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function cop(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function haceNDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Shared form controls ─────────────────────────────────────────────────────

function CampoMoneda({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-ink-secondary">{label}</label>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
      <div className="flex items-center rounded-paper border-2 border-border bg-surface focus-within:border-accent transition">
        <span className="px-2 text-xs text-muted select-none">$</span>
        <input
          type="number"
          min="0"
          step="100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent py-2 pr-2 text-sm text-ink outline-none"
          placeholder="0"
        />
      </div>
    </div>
  );
}

function CampoPorcentaje({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-ink-secondary">{label}</label>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
      <div className="flex items-center rounded-paper border-2 border-border bg-surface focus-within:border-accent transition">
        <input
          type="number"
          min="0"
          max="99"
          step="0.5"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent py-2 pl-2 text-sm text-ink outline-none"
          placeholder="0"
        />
        <span className="px-2 text-xs text-muted select-none">%</span>
      </div>
    </div>
  );
}

// ─── Resultado de la calculadora ─────────────────────────────────────────────

function ResultadoCard({ r }: { r: ResultadoCalculo }) {
  const ivaPct =
    r.precio_sin_iva > 0
      ? ((r.iva_valor / r.precio_sin_iva) * 100).toFixed(0)
      : "0";

  const filas: { label: string; valor: string; sub?: boolean; color?: string }[] = [
    { label: `Precio lista (IVA ${ivaPct}% incluido)`, valor: cop(r.precio_lista) },
    { label: `IVA (${ivaPct}%)`, valor: `– ${cop(r.iva_valor)}`, sub: true },
    { label: "Precio sin IVA", valor: cop(r.precio_sin_iva) },
    { label: `Comisión canal (${(r.comision_pct * 100).toFixed(1)}%)`, valor: `– ${cop(r.comision_valor)}`, sub: true },
    { label: "Ingreso neto", valor: cop(r.ingreso_neto) },
    { label: "Costo total", valor: `– ${cop(r.costo_total)}`, sub: true },
    {
      label: "Utilidad neta",
      valor: `${r.utilidad_neta >= 0 ? "+" : ""}${cop(r.utilidad_neta)}`,
      color: r.utilidad_neta >= 0
        ? "text-green-600 dark:text-green-400"
        : "text-red-600 dark:text-red-400",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-surface-panel">
        <table className="w-full text-sm">
          <tbody>
            {filas.map((f, i) => (
              <tr
                key={i}
                className={`border-b border-border/50 last:border-0 ${f.sub ? "bg-surface/40" : ""}`}
              >
                <td
                  className={`px-4 py-2.5 ${f.sub ? "pl-7 text-xs text-muted" : "font-medium text-ink"}`}
                >
                  {f.label}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-mono ${f.color ?? (f.sub ? "text-xs text-muted" : "text-ink")}`}
                >
                  {f.valor}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* KPI chips */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface-panel p-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Margen bruto</div>
          <div
            className={`mt-1 text-xl font-black ${
              r.margen_bruto_pct >= 30
                ? "text-green-600 dark:text-green-400"
                : r.margen_bruto_pct >= 15
                ? "text-yellow-600 dark:text-yellow-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {pct(r.margen_bruto_pct)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">sin comisión canal</div>
        </div>
        <div className="rounded-xl border border-border bg-surface-panel p-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Margen neto</div>
          <div
            className={`mt-1 text-xl font-black ${
              r.margen_neto_pct >= 20
                ? "text-green-600 dark:text-green-400"
                : r.margen_neto_pct >= 5
                ? "text-yellow-600 dark:text-yellow-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {pct(r.margen_neto_pct)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">con comisión canal</div>
        </div>
        <div className="col-span-2 rounded-xl border border-border bg-surface-panel p-3 text-center sm:col-span-1">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Resultado</div>
          <div
            className={`mt-1 text-sm font-black ${
              r.es_rentable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {r.es_rentable ? "Rentable" : "No rentable"}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">
            utilidad {r.es_rentable ? "positiva" : "negativa"}
          </div>
        </div>
      </div>

      {r.precio_sugerido != null && (
        <div className="rounded-xl border-2 border-accent/40 bg-accent/5 px-4 py-3">
          <div className="text-xs font-bold text-accent">Precio sugerido para el margen objetivo</div>
          <div className="mt-1 text-2xl font-black text-ink">{cop(r.precio_sugerido)}</div>
          <div className="mt-0.5 text-[11px] text-muted">incluye IVA · aplica comisión canal</div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Calculadora de producto ─────────────────────────────────────────────

function TabCalculadora() {
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loadingProductos, setLoadingProductos] = useState(false);
  const [errorProductos, setErrorProductos] = useState<string | null>(null);
  const [productoSel, setProductoSel] = useState<Producto | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const [costoMateriales, setCostoMateriales] = useState("0");
  const [costoNomina, setCostoNomina] = useState("0");
  const [costoEnvase, setCostoEnvase] = useState("0");
  const [costoEtiqueta, setCostoEtiqueta] = useState("0");
  const [otrosCostos, setOtrosCostos] = useState("0");
  const [comisionPct, setComisionPct] = useState("16.5");
  const [margenObjetivo, setMargenObjetivo] = useState("");
  const [showComponentes, setShowComponentes] = useState(false);

  const [resultado, setResultado] = useState<ResultadoCalculo | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const cargarProductos = useCallback(async () => {
    setLoadingProductos(true);
    setErrorProductos(null);
    try {
      const data = await api.get<{ productos: Producto[] }>("/api/rentabilidad/productos");
      setProductos(data.productos ?? []);
    } catch (e) {
      setErrorProductos((e as Error).message);
    } finally {
      setLoadingProductos(false);
    }
  }, []);

  useEffect(() => { void cargarProductos(); }, [cargarProductos]);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos.slice(0, 20);
    return productos
      .filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      .slice(0, 15);
  }, [productos, busqueda]);

  const aplicarConfig = (p: Producto) => {
    const c = p.costos;
    setCostoMateriales(String(c?.costo_materiales ?? 0));
    setCostoNomina(String(c?.costo_nomina ?? 0));
    setCostoEnvase(String(c?.costo_envase ?? 0));
    setCostoEtiqueta(String(c?.costo_etiqueta ?? 0));
    setOtrosCostos(String(c?.otros_costos ?? 0));
    setComisionPct(String(((c?.comision_pct ?? 0.165) * 100).toFixed(1)));
    setMargenObjetivo(c?.margen_objetivo_pct != null ? String(c.margen_objetivo_pct) : "");
  };

  const seleccionarProducto = (p: Producto) => {
    setProductoSel(p);
    setBusqueda(`${p.code} — ${p.name}`);
    setShowDropdown(false);
    setResultado(null);
    setShowComponentes(false);
    aplicarConfig(p);
  };

  const calcular = async () => {
    if (!productoSel) return;
    setCalculando(true);
    setResultado(null);
    try {
      const r = await api.post<ResultadoCalculo>("/api/rentabilidad/calcular", {
        precio_lista: productoSel.precio_lista,
        iva_pct: productoSel.iva_pct,
        tax_included: productoSel.tax_included,
        costo_materiales: parseFloat(costoMateriales) || 0,
        costo_nomina: parseFloat(costoNomina) || 0,
        costo_envase: parseFloat(costoEnvase) || 0,
        costo_etiqueta: parseFloat(costoEtiqueta) || 0,
        otros_costos: parseFloat(otrosCostos) || 0,
        comision_pct: (parseFloat(comisionPct) || 16.5) / 100,
        margen_objetivo_pct: margenObjetivo !== "" ? parseFloat(margenObjetivo) : null,
      });
      setResultado(r);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCalculando(false);
    }
  };

  const guardarConfig = async () => {
    if (!productoSel) return;
    setGuardando(true);
    setGuardadoOk(false);
    try {
      await api.post("/api/rentabilidad/config", {
        codigo: productoSel.code,
        costo_materiales: parseFloat(costoMateriales) || 0,
        costo_nomina: parseFloat(costoNomina) || 0,
        costo_envase: parseFloat(costoEnvase) || 0,
        costo_etiqueta: parseFloat(costoEtiqueta) || 0,
        otros_costos: parseFloat(otrosCostos) || 0,
        comision_pct: (parseFloat(comisionPct) || 16.5) / 100,
        margen_objetivo_pct: margenObjetivo !== "" ? parseFloat(margenObjetivo) : null,
      });
      setGuardadoOk(true);
      await cargarProductos();
      setTimeout(() => setGuardadoOk(false), 2500);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Selector de producto */}
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-ink-secondary">
          Producto (combo Siigo)
        </label>
        <div className="relative">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setShowDropdown(true);
              if (!e.target.value) {
                setProductoSel(null);
                setResultado(null);
              }
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="Buscar por nombre o código…"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted outline-none focus:border-accent transition"
          />
          {loadingProductos && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          )}
          {showDropdown && productosFiltrados.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-paper border-2 border-border bg-surface-panel shadow-paper">
              {productosFiltrados.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  onMouseDown={() => seleccionarProducto(p)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-hover transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted">{p.code}</span>
                      <span className="text-[11px] text-muted">{cop(p.precio_lista)}</span>
                      {p.config_guardada && (
                        <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Config ✓
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {errorProductos && (
          <p className="text-xs text-red-600 dark:text-red-400">{errorProductos}</p>
        )}
      </div>

      {productoSel && (
        <>
          {/* Info producto */}
          <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-ink">{productoSel.name}</div>
                <div className="mt-0.5 font-mono text-xs text-muted">{productoSel.code}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-bold text-ink">{cop(productoSel.precio_lista)}</div>
                <div className="text-[11px] text-muted">
                  {productoSel.tax_included
                    ? `IVA ${(productoSel.iva_pct * 100).toFixed(0)}% incluido`
                    : "sin IVA"}
                </div>
              </div>
            </div>

            {productoSel.components.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowComponentes((v) => !v)}
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <span>
                    {showComponentes ? "Ocultar" : "Ver"} {productoSel.components.length} componentes
                  </span>
                  <span
                    className={`transition-transform ${showComponentes ? "rotate-180" : ""}`}
                  >
                    ▾
                  </span>
                </button>
                {showComponentes && (
                  <div className="mt-2 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                    {productoSel.components.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 py-0.5 text-xs">
                        <span className="truncate text-ink-secondary">{c.name}</span>
                        <span className="shrink-0 font-mono text-muted">×{c.quantity}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Campos de costos */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CampoMoneda
              label="Costo materias primas"
              hint="Materia prima e insumos del combo"
              value={costoMateriales}
              onChange={setCostoMateriales}
            />
            <CampoMoneda
              label="Costo nómina por unidad"
              hint="Fracción del costo laboral asignado a esta unidad"
              value={costoNomina}
              onChange={setCostoNomina}
            />
            <CampoMoneda
              label="Costo envase"
              hint="Frasco, bolsa, doypack, etc."
              value={costoEnvase}
              onChange={setCostoEnvase}
            />
            <CampoMoneda
              label="Costo etiqueta"
              hint="Impresión + papel de etiqueta"
              value={costoEtiqueta}
              onChange={setCostoEtiqueta}
            />
            <CampoMoneda
              label="Otros costos operativos"
              hint="Empaque, flejes, envío interno, etc."
              value={otrosCostos}
              onChange={setOtrosCostos}
            />
            <CampoPorcentaje
              label="Comisión canal (%)"
              hint="MeLi: 16.5 · Web directa: 0 · Distribuidor: varía"
              value={comisionPct}
              onChange={setComisionPct}
            />
            <CampoPorcentaje
              label="Margen neto objetivo (%)"
              hint="Opcional — calcula precio sugerido automáticamente"
              value={margenObjetivo}
              onChange={setMargenObjetivo}
            />
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void calcular()}
              disabled={calculando}
              className="rounded-paper border-2 border-accent bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent/90 active:translate-y-0.5 disabled:opacity-40"
            >
              {calculando ? "Calculando…" : "Calcular rentabilidad"}
            </button>
            <button
              type="button"
              onClick={() => void guardarConfig()}
              disabled={guardando}
              className="rounded-paper border-2 border-border px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {guardando ? "Guardando…" : "Guardar costos"}
            </button>
            {guardadoOk && (
              <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                Costos guardados ✓
              </span>
            )}
          </div>

          {resultado && <ResultadoCard r={resultado} />}
        </>
      )}
    </div>
  );
}

// ─── Tab: Análisis de período ─────────────────────────────────────────────────

function TabPeriodo() {
  const [fechaInicio, setFechaInicio] = useState(() => haceNDias(30));
  const [fechaFin, setFechaFin] = useState(() => new Date().toISOString().slice(0, 10));
  const [cargando, setCargando] = useState(false);
  const [resumen, setResumen] = useState<ResumenPeriodo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analizar = async () => {
    setCargando(true);
    setError(null);
    setResumen(null);
    try {
      const params = new URLSearchParams({ fecha_inicio: fechaInicio, fecha_fin: fechaFin });
      const data = await api.get<ResumenPeriodo>(`/api/rentabilidad/resumen?${params}`);
      setResumen(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  };

  const atajo = (dias: number) => {
    setFechaInicio(haceNDias(dias));
    setFechaFin(new Date().toISOString().slice(0, 10));
  };

  const hayUtilidades = resumen?.top_productos.some((p) => p.utilidad_estimada != null);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Hoy", dias: 0 },
            { label: "7 días", dias: 7 },
            { label: "30 días", dias: 30 },
            { label: "90 días", dias: 90 },
          ].map(({ label, dias }) => (
            <button
              key={label}
              type="button"
              onClick={() => atajo(dias)}
              className="rounded-full border-2 border-border px-3 py-1 text-xs font-semibold text-ink hover:border-accent hover:text-accent transition"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-ink-secondary">Desde</label>
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-ink-secondary">Hasta</label>
            <input
              type="date"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
              className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void analizar()}
          disabled={cargando}
          className="rounded-paper border-2 border-accent bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent/90 active:translate-y-0.5 disabled:opacity-40"
        >
          {cargando ? "Consultando facturas Siigo…" : "Analizar período"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {resumen && (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: "Total facturado",
                valor: cop(resumen.total_con_iva),
                sub: "con IVA",
              },
              {
                label: "Sin IVA",
                valor: cop(resumen.total_sin_iva),
                sub: "ingreso base",
              },
              {
                label: "Facturas",
                valor: String(resumen.num_facturas),
                sub: "en el período",
              },
              {
                label: "Promedio",
                valor: cop(resumen.promedio_por_factura),
                sub: "por factura",
              },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-xl border border-border bg-surface-panel p-4 text-center"
              >
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
                  {k.label}
                </div>
                <div className="mt-1 text-lg font-black leading-tight text-ink">{k.valor}</div>
                <div className="text-[10px] text-muted">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Top productos */}
          {resumen.top_productos.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-ink">Top productos por facturación</h3>
              {hayUtilidades && (
                <p className="text-xs text-muted">
                  * Utilidad estimada según costos guardados en la Calculadora.
                </p>
              )}
              <div className="overflow-x-auto overflow-hidden rounded-xl border border-border bg-surface-panel">
                <table className="w-full min-w-[500px] text-left text-sm">
                  <thead className="border-b border-border bg-surface-hover text-[11px] font-bold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2.5">#</th>
                      <th className="px-4 py-2.5">Producto</th>
                      <th className="px-4 py-2.5 text-right">Unid.</th>
                      <th className="px-4 py-2.5 text-right">Facturado</th>
                      {hayUtilidades && (
                        <th className="px-4 py-2.5 text-right">Utilidad*</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.top_productos.map((p, i) => (
                      <tr
                        key={p.code}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="px-4 py-2.5 text-xs text-muted">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="max-w-xs truncate font-medium text-ink">{p.name}</div>
                          <div className="font-mono text-[11px] text-muted">{p.code}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-ink">
                          {p.qty.toLocaleString("es-CO", { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm text-ink">
                          {cop(p.total)}
                        </td>
                        {hayUtilidades && (
                          <td
                            className={`px-4 py-2.5 text-right font-mono text-sm ${
                              p.utilidad_estimada != null
                                ? p.utilidad_estimada >= 0
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                                : "text-muted"
                            }`}
                          >
                            {p.utilidad_estimada != null ? cop(p.utilidad_estimada) : "—"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {resumen.num_facturas === 0 && (
            <p className="text-sm text-muted">
              No hay facturas de venta Siigo en ese período.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

type Tab = "calculadora" | "periodo";

export default function RentabilidadPanel() {
  const [tab, setTab] = useState<Tab>("calculadora");

  const tabs: { id: Tab; label: string }[] = [
    { id: "calculadora", label: "Calculadora de producto" },
    { id: "periodo", label: "Análisis de período" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Rentabilidad</h2>
        <p className="mt-1 text-sm text-muted">
          Calcula el costo real por producto y analiza el margen neto cruzando costos operativos,
          materiales y facturación Siigo.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-paper border-2 border-border bg-surface-hover p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              tab === t.id
                ? "bg-surface-panel text-ink shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "calculadora" ? <TabCalculadora /> : <TabPeriodo />}
    </div>
  );
}
