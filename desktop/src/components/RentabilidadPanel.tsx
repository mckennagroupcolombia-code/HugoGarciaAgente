import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../api/client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Componente {
  id: number;
  name: string;
  quantity: number;
}

interface ComponenteDesglose {
  nombre: string;
  cantidad: number;
  categoria: string;
  costo_unit: number;
  costo_total: number;
  costo_conocido: boolean;
}

interface ComboTotales {
  costo_materiales: number;
  costo_envase: number;
  costo_etiqueta: number;
  otros_costos: number;
  costo_nomina: number;
  componentes_sin_costo: number;
  componentes_total: number;
}

interface ComboDesglose {
  code: string;
  nombre: string;
  precio_lista: number;
  iva_pct: number;
  tax_included: boolean;
  componentes: ComponenteDesglose[];
  totales: ComboTotales;
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

interface Empleado {
  id: number;
  nombre: string;
  cargo: string;
  tipo_contrato: string;
  sueldo_mensual: number;
  activo: number;
  fecha_ingreso: string | null;
  notas: string;
  created_at: string;
}

interface ResumenNomina {
  total_mensual: number;
  activos: number;
}

interface Servicio {
  id: number;
  empresa: string;
  tipo: string;
  numero_contrato: string;
  direccion: string;
  activo: number;
  dia_vencimiento: number | null;
  notas: string;
  created_at: string;
  pagos: PagoServicio[];
}

interface PagoServicio {
  id: number;
  servicio_id: number;
  fecha: string;
  monto: number;
  comprobante: string;
  notas: string;
  created_at: string;
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

const CATEGORIA_LABELS: Record<string, string> = {
  material: "Material",
  envase: "Envase",
  etiqueta: "Etiqueta",
  empaque: "Empaque",
  operativo: "Operativo",
};

const TIPO_SERVICIO_LABELS: Record<string, string> = {
  luz: "Luz",
  agua: "Agua",
  telefono: "Teléfono",
  internet: "Internet",
  gas: "Gas",
  otro: "Otro",
};

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
                <td className={`px-4 py-2.5 ${f.sub ? "pl-7 text-xs text-muted" : "font-medium text-ink"}`}>
                  {f.label}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${f.color ?? (f.sub ? "text-xs text-muted" : "text-ink")}`}>
                  {f.valor}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface-panel p-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Margen bruto</div>
          <div className={`mt-1 text-xl font-black ${r.margen_bruto_pct >= 30 ? "text-green-600 dark:text-green-400" : r.margen_bruto_pct >= 15 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
            {pct(r.margen_bruto_pct)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">sin comisión canal</div>
        </div>
        <div className="rounded-xl border border-border bg-surface-panel p-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Margen neto</div>
          <div className={`mt-1 text-xl font-black ${r.margen_neto_pct >= 20 ? "text-green-600 dark:text-green-400" : r.margen_neto_pct >= 5 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
            {pct(r.margen_neto_pct)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">con comisión canal</div>
        </div>
        <div className="col-span-2 rounded-xl border border-border bg-surface-panel p-3 text-center sm:col-span-1">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Resultado</div>
          <div className={`mt-1 text-sm font-black ${r.es_rentable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {r.es_rentable ? "Rentable" : "No rentable"}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">utilidad {r.es_rentable ? "positiva" : "negativa"}</div>
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

  const [desglose, setDesglose] = useState<ComboDesglose | null>(null);
  const [loadingDesglose, setLoadingDesglose] = useState(false);
  const [showDesglose, setShowDesglose] = useState(false);
  const [editandoCostos, setEditandoCostos] = useState<Record<string, string>>({});
  const [guardandoCostos, setGuardandoCostos] = useState<Record<string, boolean>>({});

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

  const aplicarDesglose = (d: ComboDesglose) => {
    setCostoMateriales(String(d.totales.costo_materiales));
    setCostoEnvase(String(d.totales.costo_envase));
    setCostoEtiqueta(String(d.totales.costo_etiqueta));
    setOtrosCostos(String(d.totales.otros_costos));
    setCostoNomina(String(d.totales.costo_nomina));
  };

  const cargarDesglose = async (p: Producto) => {
    setLoadingDesglose(true);
    setDesglose(null);
    try {
      const d = await api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${p.code}`);
      setDesglose(d);
      aplicarDesglose(d);
      setEditandoCostos({});
    } catch {
      // silently fail — user can still enter costs manually
    } finally {
      setLoadingDesglose(false);
    }
  };

  const seleccionarProducto = (p: Producto) => {
    setProductoSel(p);
    setBusqueda(`${p.code} — ${p.name}`);
    setShowDropdown(false);
    setResultado(null);
    setShowDesglose(false);
    setDesglose(null);
    aplicarConfig(p);
    void cargarDesglose(p);
  };

  const guardarCostoComponente = async (nombre: string, categoria: string, costoStr: string) => {
    const costo = parseFloat(costoStr);
    if (isNaN(costo)) return;
    setGuardandoCostos((prev) => ({ ...prev, [nombre]: true }));
    try {
      await api.post("/api/rentabilidad/componentes", { nombre, costo_unitario: costo, categoria });
      if (productoSel) void cargarDesglose(productoSel);
    } catch {
      // ignore
    } finally {
      setGuardandoCostos((prev) => ({ ...prev, [nombre]: false }));
      setEditandoCostos((prev) => { const n = { ...prev }; delete n[nombre]; return n; });
    }
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

  const sinCosto = desglose?.totales.componentes_sin_costo ?? 0;

  return (
    <div className="space-y-6">
      {/* Selector de producto */}
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-ink-secondary">Producto (combo Siigo)</label>
        <div className="relative">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setShowDropdown(true);
              if (!e.target.value) { setProductoSel(null); setResultado(null); }
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
        {errorProductos && <p className="text-xs text-red-600 dark:text-red-400">{errorProductos}</p>}
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDesglose((v) => !v)}
                    className="flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <span>{showDesglose ? "Ocultar" : "Ver"} {productoSel.components.length} componentes</span>
                    <span className={`transition-transform ${showDesglose ? "rotate-180" : ""}`}>▾</span>
                  </button>
                  {loadingDesglose && (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  )}
                  {sinCosto > 0 && (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      {sinCosto} sin costo
                    </span>
                  )}
                </div>

                {showDesglose && desglose && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="border-b border-border bg-surface-hover text-[10px] font-bold uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-3 py-2 text-left">Componente</th>
                          <th className="px-3 py-2 text-center">Cat.</th>
                          <th className="px-3 py-2 text-right">Cant.</th>
                          <th className="px-3 py-2 text-right">Costo unit.</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {desglose.componentes.map((c) => {
                          const editVal = editandoCostos[c.nombre];
                          const isEditing = editVal !== undefined;
                          return (
                            <tr key={c.nombre} className={`border-b border-border/50 last:border-0 ${!c.costo_conocido ? "bg-orange-50/40 dark:bg-orange-900/10" : ""}`}>
                              <td className="px-3 py-1.5 text-ink-secondary max-w-[180px] truncate">{c.nombre}</td>
                              <td className="px-3 py-1.5 text-center">
                                <span className="text-[10px] text-muted">{CATEGORIA_LABELS[c.categoria] ?? c.categoria}</span>
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-muted">×{c.cantidad}</td>
                              <td className="px-3 py-1.5 text-right">
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min="0"
                                    step="50"
                                    value={editVal}
                                    onChange={(e) => setEditandoCostos((prev) => ({ ...prev, [c.nombre]: e.target.value }))}
                                    className="w-20 rounded border border-accent bg-surface px-1 py-0.5 text-right text-ink outline-none"
                                    autoFocus
                                  />
                                ) : (
                                  <span className={c.costo_conocido ? "font-mono text-ink" : "text-orange-500"}>
                                    {c.costo_conocido ? cop(c.costo_unit) : "—"}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-ink">
                                {c.costo_conocido ? cop(c.costo_total) : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {isEditing ? (
                                  <div className="flex gap-1 justify-end">
                                    <button
                                      type="button"
                                      onClick={() => void guardarCostoComponente(c.nombre, c.categoria, editVal)}
                                      disabled={guardandoCostos[c.nombre]}
                                      className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
                                    >
                                      {guardandoCostos[c.nombre] ? "…" : "Guardar"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditandoCostos((prev) => { const n = { ...prev }; delete n[c.nombre]; return n; })}
                                      className="rounded border border-border px-2 py-0.5 text-[10px] text-muted"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setEditandoCostos((prev) => ({ ...prev, [c.nombre]: String(c.costo_unit) }))}
                                    className="text-[10px] text-accent hover:underline"
                                  >
                                    {c.costo_conocido ? "Editar" : "Ingresar"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Campos de costos */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CampoMoneda label="Costo materias primas" hint="Materia prima e insumos del combo" value={costoMateriales} onChange={setCostoMateriales} />
            <CampoMoneda label="Costo nómina por unidad" hint="Fracción del costo laboral asignado a esta unidad" value={costoNomina} onChange={setCostoNomina} />
            <CampoMoneda label="Costo envase" hint="Frasco, bolsa, doypack, etc." value={costoEnvase} onChange={setCostoEnvase} />
            <CampoMoneda label="Costo etiqueta" hint="Impresión + papel de etiqueta" value={costoEtiqueta} onChange={setCostoEtiqueta} />
            <CampoMoneda label="Otros costos operativos" hint="Empaque, flejes, envío interno, etc." value={otrosCostos} onChange={setOtrosCostos} />
            <CampoPorcentaje label="Comisión canal (%)" hint="MeLi: 16.5 · Web directa: 0 · Distribuidor: varía" value={comisionPct} onChange={setComisionPct} />
            <CampoPorcentaje label="Margen neto objetivo (%)" hint="Opcional — calcula precio sugerido automáticamente" value={margenObjetivo} onChange={setMargenObjetivo} />
          </div>

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
              <span className="text-xs font-semibold text-green-600 dark:text-green-400">Costos guardados ✓</span>
            )}
          </div>

          {resultado && <ResultadoCard r={resultado} />}
        </>
      )}
    </div>
  );
}

// ─── Tab: Nómina ──────────────────────────────────────────────────────────────

const CONTRATO_LABELS: Record<string, string> = { fijo: "Fijo", servicios: "Servicios", aprendiz: "Aprendiz" };

function FormEmpleado({
  inicial,
  onGuardar,
  onCancelar,
}: {
  inicial?: Partial<Empleado>;
  onGuardar: (data: Partial<Empleado>) => Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [cargo, setCargo] = useState(inicial?.cargo ?? "");
  const [tipoContrato, setTipoContrato] = useState(inicial?.tipo_contrato ?? "fijo");
  const [sueldo, setSueldo] = useState(String(inicial?.sueldo_mensual ?? ""));
  const [fechaIngreso, setFechaIngreso] = useState(inicial?.fecha_ingreso ?? "");
  const [notas, setNotas] = useState(inicial?.notas ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!nombre.trim()) return;
    setSaving(true);
    try {
      await onGuardar({
        id: inicial?.id,
        nombre,
        cargo,
        tipo_contrato: tipoContrato,
        sueldo_mensual: parseFloat(sueldo) || 0,
        activo: inicial?.activo ?? 1,
        fecha_ingreso: fechaIngreso || null,
        notas,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-accent/30 bg-surface-panel p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Nombre *</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Cargo</label>
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo o rol"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Tipo contrato</label>
          <select value={tipoContrato} onChange={(e) => setTipoContrato(e.target.value)}
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition">
            <option value="fijo">Fijo</option>
            <option value="servicios">Servicios</option>
            <option value="aprendiz">Aprendiz</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Sueldo mensual</label>
          <div className="flex items-center rounded-paper border-2 border-border bg-surface focus-within:border-accent transition">
            <span className="px-2 text-xs text-muted">$</span>
            <input type="number" min="0" step="50000" value={sueldo} onChange={(e) => setSueldo(e.target.value)}
              placeholder="0" className="flex-1 bg-transparent py-2 pr-2 text-sm text-ink outline-none" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Fecha ingreso</label>
          <input type="date" value={fechaIngreso} onChange={(e) => setFechaIngreso(e.target.value)}
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Notas</label>
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void handleSubmit()} disabled={saving || !nombre.trim()}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onCancelar}
          className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent transition">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function TabNomina() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [resumen, setResumen] = useState<ResumenNomina | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState<Empleado | null>(null);
  const [unidadesMes, setUnidadesMes] = useState("100");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [empData, resData] = await Promise.all([
        api.get<{ empleados: Empleado[] }>("/api/nomina/empleados"),
        api.get<ResumenNomina>("/api/nomina/resumen"),
      ]);
      setEmpleados(empData.empleados ?? []);
      setResumen(resData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const guardarEmpleado = async (data: Partial<Empleado>) => {
    await api.post("/api/nomina/empleados", data);
    setShowForm(false);
    setEditando(null);
    void cargar();
  };

  const eliminar = async (id: number) => {
    if (!confirm("¿Desactivar este empleado?")) return;
    await api.delete(`/api/nomina/empleados/${id}`);
    void cargar();
  };

  const costoPorUnidad = resumen && parseFloat(unidadesMes) > 0
    ? resumen.total_mensual / parseFloat(unidadesMes)
    : 0;

  return (
    <div className="space-y-5">
      {resumen && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface-panel p-4 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Nómina mensual</div>
            <div className="mt-1 text-xl font-black text-ink">{cop(resumen.total_mensual)}</div>
            <div className="text-[10px] text-muted">{resumen.activos} activo{resumen.activos !== 1 ? "s" : ""}</div>
          </div>
          <div className="col-span-1 sm:col-span-2 rounded-xl border border-border bg-surface-panel p-4">
            <div className="text-xs font-semibold text-ink-secondary mb-2">Costo nómina por unidad producida</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-[11px] text-muted">Unidades/mes</label>
                <input type="number" min="1" value={unidadesMes} onChange={(e) => setUnidadesMes(e.target.value)}
                  className="w-full rounded-paper border-2 border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent transition" />
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] text-muted">Costo/unidad</div>
                <div className="text-lg font-black text-accent">{cop(Math.round(costoPorUnidad))}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">Empleados</h3>
        <button type="button" onClick={() => { setShowForm(true); setEditando(null); }}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white">
          + Agregar
        </button>
      </div>

      {showForm && !editando && (
        <FormEmpleado onGuardar={guardarEmpleado} onCancelar={() => setShowForm(false)} />
      )}

      {loading && <p className="text-sm text-muted">Cargando…</p>}
      {!loading && empleados.length === 0 && <p className="text-sm text-muted">No hay empleados registrados.</p>}

      {empleados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-panel">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-hover text-[11px] font-bold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 text-left">Nombre</th>
                <th className="px-4 py-2.5 text-left">Cargo</th>
                <th className="px-4 py-2.5 text-left">Contrato</th>
                <th className="px-4 py-2.5 text-right">Sueldo</th>
                <th className="px-4 py-2.5 text-center">Estado</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {empleados.map((e) =>
                editando?.id === e.id ? (
                  <tr key={e.id} className="border-b border-border/50">
                    <td colSpan={6} className="px-4 py-3">
                      <FormEmpleado inicial={e} onGuardar={guardarEmpleado} onCancelar={() => setEditando(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} className={`border-b border-border/50 last:border-0 ${!e.activo ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-medium text-ink">{e.nombre}</td>
                    <td className="px-4 py-2.5 text-ink-secondary text-xs">{e.cargo || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{CONTRATO_LABELS[e.tipo_contrato] ?? e.tipo_contrato}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm text-ink">{cop(e.sueldo_mensual)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${e.activo ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-surface-hover text-muted"}`}>
                        {e.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setEditando(e)} className="text-xs text-accent hover:underline">Editar</button>
                        {Boolean(e.activo) && (
                          <button type="button" onClick={() => void eliminar(e.id)} className="text-xs text-red-500 hover:underline">Desactivar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Servicios públicos ───────────────────────────────────────────────────

function FormServicio({
  inicial,
  onGuardar,
  onCancelar,
}: {
  inicial?: Partial<Servicio>;
  onGuardar: (data: Partial<Servicio>) => Promise<void>;
  onCancelar: () => void;
}) {
  const [empresa, setEmpresa] = useState(inicial?.empresa ?? "");
  const [tipo, setTipo] = useState(inicial?.tipo ?? "otro");
  const [contrato, setContrato] = useState(inicial?.numero_contrato ?? "");
  const [direccion, setDireccion] = useState(inicial?.direccion ?? "");
  const [diaVenc, setDiaVenc] = useState(String(inicial?.dia_vencimiento ?? ""));
  const [notas, setNotas] = useState(inicial?.notas ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!empresa.trim()) return;
    setSaving(true);
    try {
      await onGuardar({
        id: inicial?.id,
        empresa,
        tipo,
        numero_contrato: contrato,
        direccion,
        dia_vencimiento: diaVenc ? parseInt(diaVenc) : null,
        notas,
        activo: 1,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-accent/30 bg-surface-panel p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Empresa *</label>
          <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Ej: EPM, Claro"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition">
            {Object.entries(TIPO_SERVICIO_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Número contrato</label>
          <input value={contrato} onChange={(e) => setContrato(e.target.value)} placeholder="Opcional"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Día vencimiento (1-31)</label>
          <input type="number" min="1" max="31" value={diaVenc} onChange={(e) => setDiaVenc(e.target.value)} placeholder="Ej: 15"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="block text-xs font-semibold text-ink-secondary">Dirección / ubicación</label>
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Opcional"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="block text-xs font-semibold text-ink-secondary">Notas</label>
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void handleSubmit()} disabled={saving || !empresa.trim()}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onCancelar}
          className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent transition">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function FormPago({
  srvId,
  onGuardar,
  onCancelar,
}: {
  srvId: number;
  onGuardar: () => void;
  onCancelar: () => void;
}) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [monto, setMonto] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const m = parseFloat(monto);
    if (!fecha || isNaN(m) || m <= 0) return;
    setSaving(true);
    try {
      await api.post(`/api/servicios/${srvId}/pago`, { fecha, monto: m, comprobante, notas });
      onGuardar();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-accent/30 bg-surface p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-ink-secondary">Fecha *</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="w-full rounded border-2 border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-ink-secondary">Monto *</label>
          <div className="flex items-center rounded border-2 border-border bg-surface focus-within:border-accent transition">
            <span className="px-1.5 text-xs text-muted">$</span>
            <input type="number" min="0" step="1000" value={monto} onChange={(e) => setMonto(e.target.value)}
              placeholder="0" className="flex-1 bg-transparent py-1 pr-1.5 text-sm text-ink outline-none" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-ink-secondary">Comprobante</label>
          <input value={comprobante} onChange={(e) => setComprobante(e.target.value)} placeholder="N° o ref."
            className="w-full rounded border-2 border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-ink-secondary">Notas</label>
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional"
            className="w-full rounded border-2 border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent transition" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void handleSubmit()} disabled={saving || !monto}
          className="rounded border-2 border-accent bg-accent px-3 py-1 text-xs font-bold text-white disabled:opacity-40">
          {saving ? "…" : "Registrar pago"}
        </button>
        <button type="button" onClick={onCancelar} className="text-xs text-muted hover:text-ink">Cancelar</button>
      </div>
    </div>
  );
}

function ServicioCard({ srv, onRefresh }: { srv: Servicio; onRefresh: () => void }) {
  const [showPagos, setShowPagos] = useState(false);
  const [showFormPago, setShowFormPago] = useState(false);
  const [editando, setEditando] = useState(false);

  const ultimoPago = srv.pagos[0];

  const eliminarPago = async (pagoId: number) => {
    if (!confirm("¿Eliminar este pago?")) return;
    await api.delete(`/api/servicios/pagos/${pagoId}`);
    onRefresh();
  };

  const eliminarServicio = async () => {
    if (!confirm(`¿Desactivar ${srv.empresa}?`)) return;
    await api.delete(`/api/servicios/${srv.id}`);
    onRefresh();
  };

  const guardarServicio = async (data: Partial<Servicio>) => {
    await api.post("/api/servicios", data);
    setEditando(false);
    onRefresh();
  };

  if (editando) {
    return <FormServicio inicial={srv} onGuardar={guardarServicio} onCancelar={() => setEditando(false)} />;
  }

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold uppercase text-muted">
              {TIPO_SERVICIO_LABELS[srv.tipo] ?? srv.tipo}
            </span>
            <span className="font-semibold text-ink">{srv.empresa}</span>
          </div>
          {srv.numero_contrato && (
            <div className="mt-0.5 text-xs text-muted">Contrato: {srv.numero_contrato}</div>
          )}
          {srv.dia_vencimiento && (
            <div className="mt-0.5 text-xs text-muted">Vence día {srv.dia_vencimiento} de cada mes</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          {ultimoPago ? (
            <>
              <div className="text-xs text-muted">Último pago</div>
              <div className="font-mono text-sm font-bold text-ink">{cop(ultimoPago.monto)}</div>
              <div className="text-[11px] text-muted">{ultimoPago.fecha}</div>
            </>
          ) : (
            <div className="text-xs text-muted">Sin pagos</div>
          )}
        </div>
      </div>

      {showFormPago && (
        <FormPago
          srvId={srv.id}
          onGuardar={() => { setShowFormPago(false); onRefresh(); }}
          onCancelar={() => setShowFormPago(false)}
        />
      )}

      {showPagos && srv.pagos.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">Historial de pagos</div>
          {srv.pagos.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-1.5 text-xs">
              <span className="text-muted">{p.fecha}</span>
              <span className="font-mono font-bold text-ink">{cop(p.monto)}</span>
              {p.comprobante && <span className="text-muted">#{p.comprobante}</span>}
              <button type="button" onClick={() => void eliminarPago(p.id)} className="text-red-400 hover:text-red-600">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1 border-t border-border/50">
        <button
          type="button"
          onClick={() => { setShowFormPago((v) => !v); setShowPagos(false); }}
          className="text-xs text-accent hover:underline"
        >
          {showFormPago ? "Cancelar pago" : "Registrar pago"}
        </button>
        {srv.pagos.length > 0 && (
          <button type="button" onClick={() => setShowPagos((v) => !v)} className="text-xs text-muted hover:text-ink">
            {showPagos ? "Ocultar" : "Ver"} pagos ({srv.pagos.length})
          </button>
        )}
        <button type="button" onClick={() => setEditando(true)} className="text-xs text-muted hover:text-ink">Editar</button>
        <button type="button" onClick={() => void eliminarServicio()} className="text-xs text-red-400 hover:text-red-600">Desactivar</button>
      </div>
    </div>
  );
}

function TabServicios() {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ servicios: Servicio[] }>("/api/servicios");
      setServicios(data.servicios ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const guardarServicio = async (data: Partial<Servicio>) => {
    await api.post("/api/servicios", data);
    setShowForm(false);
    void cargar();
  };

  const grupos = useMemo(() => {
    const g: Record<string, Servicio[]> = {};
    for (const s of servicios) {
      if (!g[s.tipo]) g[s.tipo] = [];
      g[s.tipo].push(s);
    }
    return g;
  }, [servicios]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Contratos de servicios públicos y pagos recurrentes.</p>
        <button type="button" onClick={() => setShowForm((v) => !v)}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white">
          {showForm ? "Cancelar" : "+ Agregar servicio"}
        </button>
      </div>

      {showForm && <FormServicio onGuardar={guardarServicio} onCancelar={() => setShowForm(false)} />}
      {loading && <p className="text-sm text-muted">Cargando…</p>}
      {!loading && servicios.length === 0 && !showForm && <p className="text-sm text-muted">No hay servicios registrados.</p>}

      {Object.entries(grupos).map(([tipo, srvs]) => (
        <div key={tipo} className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
            {TIPO_SERVICIO_LABELS[tipo] ?? tipo}
          </h3>
          {srvs.map((s) => (
            <ServicioCard key={s.id} srv={s} onRefresh={cargar} />
          ))}
        </div>
      ))}
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
          {[{ label: "Hoy", dias: 0 }, { label: "7 días", dias: 7 }, { label: "30 días", dias: 30 }, { label: "90 días", dias: 90 }].map(({ label, dias }) => (
            <button key={label} type="button" onClick={() => atajo(dias)}
              className="rounded-full border-2 border-border px-3 py-1 text-xs font-semibold text-ink hover:border-accent hover:text-accent transition">
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-ink-secondary">Desde</label>
            <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)}
              className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-ink-secondary">Hasta</label>
            <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)}
              className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
          </div>
        </div>
        <button type="button" onClick={() => void analizar()} disabled={cargando}
          className="rounded-paper border-2 border-accent bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent/90 active:translate-y-0.5 disabled:opacity-40">
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total facturado", valor: cop(resumen.total_con_iva), sub: "con IVA" },
              { label: "Sin IVA", valor: cop(resumen.total_sin_iva), sub: "ingreso base" },
              { label: "Facturas", valor: String(resumen.num_facturas), sub: "en el período" },
              { label: "Promedio", valor: cop(resumen.promedio_por_factura), sub: "por factura" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-border bg-surface-panel p-4 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{k.label}</div>
                <div className="mt-1 text-lg font-black leading-tight text-ink">{k.valor}</div>
                <div className="text-[10px] text-muted">{k.sub}</div>
              </div>
            ))}
          </div>

          {resumen.top_productos.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-ink">Top productos por facturación</h3>
              {hayUtilidades && (
                <p className="text-xs text-muted">* Utilidad estimada según costos guardados en la Calculadora.</p>
              )}
              <div className="overflow-x-auto overflow-hidden rounded-xl border border-border bg-surface-panel">
                <table className="w-full min-w-[500px] text-left text-sm">
                  <thead className="border-b border-border bg-surface-hover text-[11px] font-bold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2.5">#</th>
                      <th className="px-4 py-2.5">Producto</th>
                      <th className="px-4 py-2.5 text-right">Unid.</th>
                      <th className="px-4 py-2.5 text-right">Facturado</th>
                      {hayUtilidades && <th className="px-4 py-2.5 text-right">Utilidad*</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.top_productos.map((p, i) => (
                      <tr key={p.code} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2.5 text-xs text-muted">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="max-w-xs truncate font-medium text-ink">{p.name}</div>
                          <div className="font-mono text-[11px] text-muted">{p.code}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-ink">
                          {p.qty.toLocaleString("es-CO", { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm text-ink">{cop(p.total)}</td>
                        {hayUtilidades && (
                          <td className={`px-4 py-2.5 text-right font-mono text-sm ${p.utilidad_estimada != null ? p.utilidad_estimada >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400" : "text-muted"}`}>
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
            <p className="text-sm text-muted">No hay facturas de venta Siigo en ese período.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

type Tab = "calculadora" | "nomina" | "servicios" | "periodo";

export default function RentabilidadPanel() {
  const [tab, setTab] = useState<Tab>("calculadora");

  const tabs: { id: Tab; label: string }[] = [
    { id: "calculadora", label: "Calculadora" },
    { id: "nomina", label: "Nómina" },
    { id: "servicios", label: "Servicios" },
    { id: "periodo", label: "Análisis de período" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Rentabilidad</h2>
        <p className="mt-1 text-sm text-muted">
          Costos reales por producto, nómina, servicios públicos y análisis de márgenes.
        </p>
      </div>

      <div className="flex gap-1 rounded-paper border-2 border-border bg-surface-hover p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
              tab === t.id ? "bg-surface-panel text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "calculadora" && <TabCalculadora />}
      {tab === "nomina" && <TabNomina />}
      {tab === "servicios" && <TabServicios />}
      {tab === "periodo" && <TabPeriodo />}
    </div>
  );
}
