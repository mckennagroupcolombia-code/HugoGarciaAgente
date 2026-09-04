import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import { ConsultarFacturaPorProducto } from "./FacturasCompraPanel";
import FloatingToolWindow, { defaultFloatRect } from "./FloatingToolWindow";
import { AddIconButton } from "./AddIconButton";

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
  code_siigo?: string | null;
  costo_unit: number;
  costo_total: number;
  costo_conocido: boolean;
  fuente?: "siigo" | "excel" | "manual" | null;
  fecha_compra?: string | null;
}

interface CatalogoEstado {
  existe: boolean;
  vigente: boolean;
  productos_total?: number;
  con_precio_compra?: number;
  edad_horas?: number;
  actualizado?: string | null;
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

interface Producto {
  code: string;
  name: string;
  precio_lista: number;
  iva_pct: number;
  tax_included: boolean;
  components: Componente[];
}

interface ResumenCosto {
  costo_total: number;
  sin_costo: number;
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

interface UsuarioApp {
  id: number;
  nombre: string;
  email: string;
  telefono: string;
}

interface Empleado {
  id: number;
  nombre: string;
  cargo: string;
  tipo_contrato: string;
  sueldo_mensual: number;
  activo: number;
  usuario_id: number | null;
  dia_pago: number | null;
  telefono_wa: string;
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

function haceNDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const CATEGORIA_LABELS: Record<string, string> = {
  material: "Materia prima",
  envase: "Envase",
  etiqueta: "Etiqueta",
  embalaje: "Embalaje",
  empaque: "Embalaje",
  operativo: "Operativo",
};

/** Contenedor con scroll vertical; títulos de tabla quedan fijos al hacer scroll. */
const TABLE_SCROLL =
  "max-h-[min(70vh,640px)] overflow-auto rounded-xl border border-border bg-surface-panel";
const TABLE_SCROLL_PAPER =
  "max-h-[min(70vh,640px)] overflow-auto rounded-paper border-2 border-border";
/** Sticky en <th> (más fiable que sticky en <thead> en algunos navegadores). */
const THEAD_STICKY =
  "border-b border-border bg-surface-hover shadow-[0_1px_0_0_var(--color-border,rgba(0,0,0,0.08))] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-surface-hover";
const THEAD_STICKY_NESTED =
  "border-b border-border bg-surface-hover text-[10px] font-bold uppercase tracking-wide text-muted [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-surface-hover";

const TIPO_SERVICIO_LABELS: Record<string, string> = {
  luz: "Luz",
  agua: "Agua",
  telefono: "Teléfono",
  internet: "Internet",
  gas: "Gas",
  saas: "Suscripción / SaaS",
  otro: "Otro",
};

// ─── Tab: Productos Combo Alegra ───────────────────────────────────────────────

function TabCombos() {
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [costosTodos, setCostosTodos] = useState<Record<string, ResumenCosto>>({});
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [desgloses, setDesgloses] = useState<Record<string, ComboDesglose>>({});
  const [loadingDesgloses, setLoadingDesgloses] = useState<Set<string>>(new Set());
  const [editandoCostos, setEditandoCostos] = useState<Record<string, string>>({});
  const [guardandoCostos, setGuardandoCostos] = useState<Record<string, boolean>>({});
  const [ivaIncluidoKeys, setIvaIncluidoKeys] = useState<Set<string>>(new Set());
  const [siigoCostoResult, setSiigoCostoResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [catalogoEstado, setCatalogoEstado] = useState<CatalogoEstado | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [autofillPreview, setAutofillPreview] = useState<{
    componentes_sin_costo: number;
    con_propuesta_autofill: number;
    sin_propuesta: number;
    componentes: Array<{
      nombre: string;
      propuesta_costo: number | null;
      propuesta_fuente: string | null;
      combos_afectados: number;
    }>;
  } | null>(null);
  const [autofillLoading, setAutofillLoading] = useState(false);
  const [autofillResult, setAutofillResult] = useState<string | null>(null);

  const cargarProductos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ productos: Producto[] }>("/api/rentabilidad/productos");
      setProductos((data.productos ?? []).filter((p) => p.components.length > 0));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    api.get<Record<string, ResumenCosto>>("/api/rentabilidad/costos-todos")
      .then(setCostosTodos)
      .catch(() => {});
  }, []);

  const cargarCatalogoEstado = useCallback(async () => {
    try {
      const d = await api.get<CatalogoEstado>("/api/rentabilidad/catalogo-estado");
      setCatalogoEstado(d);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void cargarProductos(); }, [cargarProductos]);
  useEffect(() => { void cargarCatalogoEstado(); }, [cargarCatalogoEstado]);

  const toggleExpandir = async (p: Producto) => {
    const code = p.code;
    if (expandidos.has(code)) {
      setExpandidos((prev) => { const s = new Set(prev); s.delete(code); return s; });
      return;
    }
    setExpandidos((prev) => new Set(prev).add(code));
    if (desgloses[code]) return;
    setLoadingDesgloses((prev) => new Set(prev).add(code));
    try {
      const d = await api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${code}`);
      setDesgloses((prev) => ({ ...prev, [code]: d }));
    } catch { /* ignore */ }
    finally {
      setLoadingDesgloses((prev) => { const s = new Set(prev); s.delete(code); return s; });
    }
  };

  const guardarCostoComponente = async (
    nombre: string,
    categoria: string,
    costoStr: string,
    parentCode: string,
    ivaIncluido: boolean,
  ) => {
    const costo = parseFloat(costoStr);
    if (isNaN(costo) || costo <= 0) return;
    const key = `${parentCode}::${nombre}`;
    setGuardandoCostos((prev) => ({ ...prev, [key]: true }));
    try {
      const codeSiigo =
        desgloses[parentCode]?.componentes.find((c) => c.nombre === nombre)?.code_siigo || undefined;
      const res = await api.post<{ siigo?: { ok: boolean; msg: string } }>(
        "/api/rentabilidad/componentes",
        {
          nombre,
          costo_unitario: costo,
          categoria,
          iva_incluido: ivaIncluido,
          codigo: codeSiigo || undefined,
          code_siigo: codeSiigo || undefined,
        },
      );
      if (res.siigo) {
        setSiigoCostoResult((prev) => ({ ...prev, [key]: res.siigo! }));
        setTimeout(
          () => setSiigoCostoResult((prev) => { const n = { ...prev }; delete n[key]; return n; }),
          6000,
        );
      }
      const [d, nuevosCostos] = await Promise.all([
        api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${parentCode}`),
        api.get<Record<string, ResumenCosto>>("/api/rentabilidad/costos-todos").catch(() => null),
      ]);
      setDesgloses((prev) => ({ ...prev, [parentCode]: d }));
      if (nuevosCostos) setCostosTodos(nuevosCostos);
    } catch { /* ignore */ }
    finally {
      setGuardandoCostos((prev) => ({ ...prev, [key]: false }));
      setEditandoCostos((prev) => { const n = { ...prev }; delete n[key]; return n; });
      setIvaIncluidoKeys((prev) => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const escanearFaltantes = async () => {
    setAutofillLoading(true);
    setAutofillResult(null);
    try {
      const d = await api.get<typeof autofillPreview>("/api/rentabilidad/componentes-faltantes");
      setAutofillPreview(d);
    } catch (e) {
      setAutofillResult((e as Error).message);
    } finally {
      setAutofillLoading(false);
    }
  };

  const aplicarAutofill = async () => {
    setAutofillLoading(true);
    setAutofillResult(null);
    try {
      const d = await api.post<{
        asignados: number;
        sin_propuesta: number;
        detalle_asignados: Array<{ nombre: string; costo_unitario: number; combos_afectados: number }>;
      }>("/api/rentabilidad/componentes-autofill", { dry_run: false });
      setAutofillResult(
        `Asignados ${d.asignados} componentes` +
        (d.sin_propuesta > 0 ? ` · ${d.sin_propuesta} sin precio en Alegra` : "")
      );
      setAutofillPreview(null);
      const [nuevosCostos] = await Promise.allSettled([
        api.get<Record<string, ResumenCosto>>("/api/rentabilidad/costos-todos"),
        ...Array.from(expandidos).map((code) =>
          api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${code}`)
            .then((desg) => setDesgloses((prev) => ({ ...prev, [code]: desg })))
            .catch(() => {})
        ),
      ]);
      if (nuevosCostos.status === "fulfilled") setCostosTodos(nuevosCostos.value);
    } catch (e) {
      setAutofillResult((e as Error).message);
    } finally {
      setAutofillLoading(false);
    }
  };

  const rebuildCatalogo = async () => {
    setRebuilding(true);
    try {
      await api.post("/api/rentabilidad/catalogo-rebuild", {});
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const d = await api.get<CatalogoEstado>("/api/rentabilidad/catalogo-estado");
        setCatalogoEstado(d);
        if (d.existe && d.vigente) {
          const [nuevosCostos] = await Promise.allSettled([
            api.get<Record<string, ResumenCosto>>("/api/rentabilidad/costos-todos"),
            ...Array.from(expandidos).map((code) =>
              api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${code}`)
                .then((desg) => setDesgloses((prev) => ({ ...prev, [code]: desg })))
                .catch(() => {})
            ),
          ]);
          if (nuevosCostos.status === "fulfilled") setCostosTodos(nuevosCostos.value);
          break;
        }
      }
    } catch { /* ignore */ }
    finally { setRebuilding(false); }
  };

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) =>
      p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    );
  }, [productos, busqueda]);

  const combosConCostoCompleto = useMemo(
    () => Object.values(costosTodos).filter((c) => c.sin_costo === 0).length,
    [costosTodos]
  );
  const totalCostosConocidos = useMemo(
    () => Object.keys(costosTodos).length,
    [costosTodos]
  );

  return (
    <div className="space-y-4">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px]">
          <input
            type="text"
            placeholder="Buscar por nombre o código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition"
          />
        </div>
        {catalogoEstado && (
          <span
            title={catalogoEstado.actualizado ? `Actualizado: ${catalogoEstado.actualizado}` : "Sin catálogo Alegra"}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold cursor-default ${
              catalogoEstado.vigente
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
            }`}
          >
            {catalogoEstado.vigente
              ? `${catalogoEstado.con_precio_compra ?? 0} precios en Alegra`
              : "Catálogo vencido"}
          </span>
        )}
        <button
          type="button"
          onClick={() => void rebuildCatalogo()}
          disabled={rebuilding}
          title="Reconstruir índice cruzando todas las facturas de compra Alegra"
          className="shrink-0 rounded-paper border-2 border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-50 transition"
        >
          {rebuilding ? "Actualizando…" : "Actualizar catálogo"}
        </button>
        <button
          type="button"
          onClick={() => void escanearFaltantes()}
          disabled={autofillLoading}
          title="Detecta componentes de combos sin costo y asigna precio desde Alegra (lista o costo bodega)"
          className="shrink-0 rounded-paper border-2 border-accent/60 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:border-accent disabled:opacity-50 transition"
        >
          {autofillLoading && !autofillPreview ? "Escaneando…" : "Rellenar faltantes"}
        </button>
      </div>

      {autofillResult && (
        <p className="text-xs text-ink-secondary rounded-lg border border-border bg-surface-panel px-3 py-2">
          {autofillResult}
        </p>
      )}

      {autofillPreview && (
        <div className="rounded-lg border-2 border-accent/40 bg-surface-panel p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-ink">Componentes sin costo en combos</p>
              <p className="text-xs text-muted mt-0.5">
                <span className="font-bold text-ink">{autofillPreview.componentes_sin_costo}</span> únicos detectados ·{" "}
                <span className="font-bold text-green-600 dark:text-green-400">{autofillPreview.con_propuesta_autofill}</span> con precio en Alegra ·{" "}
                <span className="font-bold text-orange-600">{autofillPreview.sin_propuesta}</span> sin precio disponible
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAutofillPreview(null)}
                className="rounded-paper border border-border px-3 py-1.5 text-xs text-muted hover:text-ink"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void aplicarAutofill()}
                disabled={autofillLoading || autofillPreview.con_propuesta_autofill === 0}
                className="rounded-paper bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {autofillLoading ? "Asignando…" : `Asignar ${autofillPreview.con_propuesta_autofill} costos`}
              </button>
            </div>
          </div>
          {autofillPreview.componentes.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded border border-border text-xs">
              <table className="w-full">
                <thead className={`${THEAD_STICKY} text-[10px] font-bold uppercase text-muted`}>
                  <tr>
                    <th className="px-2 py-1.5 text-left">Componente</th>
                    <th className="px-2 py-1.5 text-right">Combos</th>
                    <th className="px-2 py-1.5 text-right">Precio propuesto</th>
                    <th className="px-2 py-1.5 text-center">Fuente</th>
                  </tr>
                </thead>
                <tbody>
                  {autofillPreview.componentes.slice(0, 30).map((c) => (
                    <tr key={c.nombre} className="border-t border-border/50">
                      <td className="px-2 py-1 truncate max-w-[220px]" title={c.nombre}>{c.nombre}</td>
                      <td className="px-2 py-1 text-right font-mono">{c.combos_afectados}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {c.propuesta_costo != null ? cop(c.propuesta_costo) : "—"}
                      </td>
                      <td className="px-2 py-1 text-center text-[10px] text-muted">
                        {c.propuesta_fuente === "siigo_lista" ? "Lista Alegra" : c.propuesta_fuente === "siigo_unit_cost" ? "Costo bodega" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {autofillPreview.componentes.length > 30 && (
                <p className="px-2 py-1 text-[10px] text-muted">…y {autofillPreview.componentes.length - 30} más</p>
              )}
            </div>
          )}
          <p className="text-[10px] text-muted">
            Los combos son productos de venta; los componentes son insumos/compras. Un costo asignado aquí aplica a todos los combos que usen ese componente.
          </p>
        </div>
      )}

      {/* Chips resumen */}
      {!loading && productos.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-border bg-surface-panel px-3 py-1 text-ink-secondary">
            <span className="font-bold text-ink">{productos.length}</span> combos en Alegra
          </span>
          {busqueda && (
            <span className="rounded-full border border-border bg-surface-panel px-3 py-1 text-ink-secondary">
              <span className="font-bold text-ink">{productosFiltrados.length}</span> resultados
            </span>
          )}
          {totalCostosConocidos > 0 && (
            <span className={`rounded-full border px-3 py-1 text-ink-secondary ${
              combosConCostoCompleto === totalCostosConocidos
                ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
                : "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20"
            }`}>
              <span className={`font-bold ${combosConCostoCompleto === totalCostosConocidos ? "text-green-700 dark:text-green-400" : "text-orange-600 dark:text-orange-400"}`}>
                {combosConCostoCompleto}
              </span>
              <span className="text-muted">/{totalCostosConocidos} con costo completo</span>
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Cargando productos Alegra…
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && productosFiltrados.length === 0 && !error && (
        <p className="py-10 text-center text-sm text-muted">
          {busqueda ? "Sin resultados para esa búsqueda." : "No hay productos combo en Alegra."}
        </p>
      )}

      {!loading && productosFiltrados.length > 0 && (
        <div className={TABLE_SCROLL}>
          <table className="w-full text-sm">
            <thead className={THEAD_STICKY}>
              <tr>
                <th className="bg-surface-hover px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted">Código</th>
                <th className="bg-surface-hover px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted">Producto</th>
                <th className="bg-surface-hover px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-muted">Precio</th>
                <th className="bg-surface-hover px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-muted">Comp.</th>
                <th className="bg-surface-hover px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-muted">Costo total</th>
                <th className="w-8 bg-surface-hover px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {productosFiltrados.map((p) => {
                const isExpanded = expandidos.has(p.code);
                const isLoadingThis = loadingDesgloses.has(p.code);
                const desglose = desgloses[p.code];
                const resumenCosto = costosTodos[p.code.toUpperCase()];
                const sinCosto = desglose?.totales.componentes_sin_costo ?? resumenCosto?.sin_costo ?? null;
                const costoTotal = desglose
                  ? desglose.totales.costo_materiales + desglose.totales.costo_envase +
                    desglose.totales.costo_etiqueta + desglose.totales.otros_costos +
                    desglose.totales.costo_nomina
                  : resumenCosto?.costo_total ?? null;
                const completo = sinCosto === 0;

                return (
                  <Fragment key={p.code}>
                    <tr
                      onClick={() => void toggleExpandir(p)}
                      className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-hover ${isExpanded ? "bg-surface-hover/60" : ""}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted">{p.code}</td>
                      <td className="px-4 py-3 font-medium text-ink">
                        <div className="truncate">{p.name}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-ink">{cop(p.precio_lista)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">
                          {p.components.length}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isLoadingThis ? (
                          <div className="flex justify-end">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                          </div>
                        ) : costoTotal != null ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-mono text-sm text-ink">{cop(costoTotal)}</span>
                            {completo ? (
                              <span
                                title="Todos los componentes tienen costo"
                                className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-[10px] font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              >✓</span>
                            ) : sinCosto != null && sinCosto > 0 ? (
                              <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                                {sinCosto} sin costo
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-center text-muted">
                        <span className={`text-sm transition-transform inline-block ${isExpanded ? "rotate-180" : ""}`}>▾</span>
                      </td>
                    </tr>

                    {isExpanded && isLoadingThis && (
                      <tr className="border-b border-border/50">
                        <td colSpan={6} className="px-4 py-3 text-center text-xs text-muted">
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                            Cargando componentes…
                          </div>
                        </td>
                      </tr>
                    )}

                    {isExpanded && desglose && (
                      <tr className="border-b border-border/50">
                        <td colSpan={6} className="px-4 pb-4 pt-2">
                          <div className="max-h-72 overflow-auto rounded-lg border border-border">
                            <table className="w-full text-xs">
                              <thead className={THEAD_STICKY_NESTED}>
                                <tr>
                                  <th className="bg-surface-hover px-3 py-2 text-left">Componente</th>
                                  <th className="bg-surface-hover px-3 py-2 text-left">Código</th>
                                  <th className="bg-surface-hover px-3 py-2 text-center">Categoría</th>
                                  <th className="bg-surface-hover px-3 py-2 text-right">Cant.</th>
                                  <th className="bg-surface-hover px-3 py-2 text-right">Costo unit.</th>
                                  <th className="bg-surface-hover px-3 py-2 text-right">Total</th>
                                  <th className="bg-surface-hover px-3 py-2 text-center">Fuente</th>
                                  <th className="w-16 bg-surface-hover px-3 py-2"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {desglose.componentes.map((c) => {
                                  const key = `${p.code}::${c.nombre}`;
                                  const editVal = editandoCostos[key];
                                  const isEditing = editVal !== undefined;
                                  return (
                                    <tr key={c.nombre} className={`border-b border-border/40 last:border-0 ${!c.costo_conocido ? "bg-orange-50/40 dark:bg-orange-900/10" : ""}`}>
                                      <td className="px-3 py-1.5 truncate text-ink-secondary" title={c.nombre}>{c.nombre}</td>
                                      <td className="px-3 py-1.5">
                                        {c.code_siigo
                                          ? <span className="font-mono text-[10px] text-muted">{c.code_siigo}</span>
                                          : <span className="text-[10px] text-border">—</span>}
                                      </td>
                                      <td className="px-3 py-1.5 text-center text-muted">{CATEGORIA_LABELS[c.categoria] ?? c.categoria}</td>
                                      <td className="px-3 py-1.5 text-right font-mono text-muted">×{c.cantidad}</td>
                                      <td className="px-3 py-1.5 text-right">
                                        {isEditing ? (
                                          <div className="flex flex-col items-end gap-1">
                                            <input
                                              type="number" min="0" step="50" value={editVal}
                                              onChange={(e) => setEditandoCostos((prev) => ({ ...prev, [key]: e.target.value }))}
                                              className="w-24 rounded border border-accent bg-surface px-1 py-0.5 text-right text-ink outline-none"
                                              autoFocus
                                            />
                                            <label className="flex cursor-pointer select-none items-center gap-1">
                                              <input
                                                type="checkbox"
                                                checked={ivaIncluidoKeys.has(key)}
                                                onChange={(e) => setIvaIncluidoKeys((prev) => {
                                                  const s = new Set(prev);
                                                  if (e.target.checked) s.add(key); else s.delete(key);
                                                  return s;
                                                })}
                                                className="h-3 w-3 accent-accent"
                                              />
                                              <span className="text-[10px] text-muted">IVA 19%</span>
                                            </label>
                                            {ivaIncluidoKeys.has(key) && parseFloat(editVal) > 0 && (
                                              <span className="text-[10px] text-muted">
                                                Neto: {cop(parseFloat(editVal) / 1.19)}
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <span className={c.costo_conocido ? "font-mono text-ink" : "text-orange-500"}>
                                            {c.costo_conocido ? cop(c.costo_unit) : "—"}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono text-ink">
                                        {c.costo_conocido ? cop(c.costo_total) : "—"}
                                      </td>
                                      <td className="px-3 py-1.5 text-center">
                                        {c.fuente === "siigo" ? (
                                          <span title={c.fecha_compra ? `Última compra: ${c.fecha_compra}` : "Facturas Alegra"}
                                            className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400 cursor-default">
                                            Alegra
                                          </span>
                                        ) : c.fuente === "excel" ? (
                                          <span title="Precio desde Excel de importaciones"
                                            className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 cursor-default">
                                            Excel
                                          </span>
                                        ) : c.fuente === "manual" ? (
                                          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 cursor-default">
                                            Manual
                                          </span>
                                        ) : c.costo_conocido ? (
                                          <span className="text-[9px] text-muted">—</span>
                                        ) : (
                                          <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 cursor-default">
                                            Sin costo
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-right">
                                        {isEditing ? (
                                          <div className="flex flex-col items-end gap-1">
                                            <div className="flex gap-1">
                                              <button
                                                type="button"
                                                onClick={() => void guardarCostoComponente(
                                                  c.nombre, c.categoria, editVal, p.code,
                                                  ivaIncluidoKeys.has(key),
                                                )}
                                                disabled={guardandoCostos[key]}
                                                className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
                                              >
                                                {guardandoCostos[key] ? "Sincronizando…" : "Sincronizar con Alegra"}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditandoCostos((prev) => { const n = { ...prev }; delete n[key]; return n; });
                                                  setIvaIncluidoKeys((prev) => { const s = new Set(prev); s.delete(key); return s; });
                                                }}
                                                className="rounded border border-border px-2 py-0.5 text-[10px] text-muted"
                                              >×</button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="flex flex-col items-end gap-1">
                                            {siigoCostoResult[key] && (
                                              <span
                                                title={siigoCostoResult[key].msg}
                                                className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                                  siigoCostoResult[key].ok
                                                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                }`}
                                              >
                                                Alegra {siigoCostoResult[key].ok ? "✓" : "✗"}
                                              </span>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => setEditandoCostos((prev) => ({ ...prev, [key]: String(c.costo_unit) }))}
                                              className="text-[10px] text-accent hover:underline"
                                            >
                                              {c.costo_conocido ? "Editar" : "Ingresar"}
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <div className="flex flex-wrap gap-4 border-t border-border bg-surface-hover px-3 py-2 text-[11px]">
                              {[
                                { label: "Materia prima", val: desglose.totales.costo_materiales },
                                { label: "Envase", val: desglose.totales.costo_envase },
                                { label: "Etiqueta", val: desglose.totales.costo_etiqueta },
                                { label: "Embalaje", val: desglose.totales.otros_costos },
                                ...(desglose.totales.costo_nomina > 0
                                  ? [{ label: "Nómina", val: desglose.totales.costo_nomina }]
                                  : []),
                              ].map((item) => (
                                <span key={item.label} className="text-muted">
                                  {item.label}: <span className="font-semibold text-ink">{cop(item.val)}</span>
                                </span>
                              ))}
                              <span className="ml-auto font-bold text-ink">
                                Total: {cop(
                                  desglose.totales.costo_materiales + desglose.totales.costo_envase +
                                  desglose.totales.costo_etiqueta + desglose.totales.otros_costos +
                                  desglose.totales.costo_nomina
                                )}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
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
  const [usuariosApp, setUsuariosApp] = useState<UsuarioApp[]>([]);
  const [usuarioId, setUsuarioId] = useState<number | null>(inicial?.usuario_id ?? null);
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [cargo, setCargo] = useState(inicial?.cargo ?? "");
  const [tipoContrato, setTipoContrato] = useState(inicial?.tipo_contrato ?? "fijo");
  const [sueldo, setSueldo] = useState(String(inicial?.sueldo_mensual ?? ""));
  const [diaPago, setDiaPago] = useState(String(inicial?.dia_pago ?? ""));
  const [telefonoWa, setTelefonoWa] = useState(inicial?.telefono_wa ?? "");
  const [notas, setNotas] = useState(inicial?.notas ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ usuarios: UsuarioApp[] }>("/api/nomina/usuarios-app")
      .then((d) => setUsuariosApp(d.usuarios ?? []))
      .catch(() => {});
  }, []);

  const seleccionarUsuario = (id: number | null) => {
    setUsuarioId(id);
    if (!id) return;
    const u = usuariosApp.find((x) => x.id === id);
    if (!u) return;
    if (!nombre.trim()) setNombre(u.nombre);
    if (!telefonoWa.trim() && u.telefono) setTelefonoWa(u.telefono);
  };

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
        usuario_id: usuarioId,
        dia_pago: diaPago ? parseInt(diaPago) : null,
        telefono_wa: telefonoWa.trim(),
        notas,
      });
    } finally {
      setSaving(false);
    }
  };

  const INPUT = "w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition";

  return (
    <div className="rounded-xl border-2 border-accent/30 bg-surface-panel p-4 space-y-4">
      {/* Vincular a usuario de la app */}
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-ink-secondary">
          Vincular a usuario del panel
          <span className="ml-1 font-normal text-muted">(opcional)</span>
        </label>
        <select
          value={usuarioId ?? ""}
          onChange={(e) => seleccionarUsuario(e.target.value ? parseInt(e.target.value) : null)}
          className={INPUT}
        >
          <option value="">— Sin vincular —</option>
          {usuariosApp.map((u) => (
            <option key={u.id} value={u.id}>{u.nombre}{u.email ? ` (${u.email})` : ""}</option>
          ))}
        </select>
        {usuarioId && usuariosApp.find((u) => u.id === usuarioId) && (
          <p className="text-[11px] text-muted">
            Vinculado a {usuariosApp.find((u) => u.id === usuarioId)!.nombre}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Nombre *</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo" className={INPUT} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Cargo</label>
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo o rol" className={INPUT} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">Tipo contrato</label>
          <select value={tipoContrato} onChange={(e) => setTipoContrato(e.target.value)} className={INPUT}>
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

        {/* Día de pago */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">
            Día de pago del mes
            <span className="ml-1 font-normal text-muted">(para recordatorio)</span>
          </label>
          <div className="flex items-center gap-2">
            <input type="number" min="1" max="31" value={diaPago} onChange={(e) => setDiaPago(e.target.value)}
              placeholder="Ej: 25"
              className="w-24 rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition" />
            <span className="text-xs text-muted">de cada mes</span>
          </div>
        </div>

        {/* WhatsApp para recordatorio */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink-secondary">
            WhatsApp para recordatorio
          </label>
          <input value={telefonoWa} onChange={(e) => setTelefonoWa(e.target.value)}
            placeholder="57300…" className={INPUT} />
          <p className="text-[11px] text-muted">Número con código de país, sin +</p>
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className="block text-xs font-semibold text-ink-secondary">Notas</label>
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional" className={INPUT} />
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
  const [enviando, setEnviando] = useState<Record<number, boolean>>({});
  const [enviado, setEnviado] = useState<Record<number, boolean>>({});

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [empData, resData] = await Promise.all([
        api.get<{ empleados: Empleado[] }>("/api/nomina/empleados"),
        api.get<ResumenNomina>("/api/nomina/resumen"),
      ]);
      setEmpleados(empData.empleados ?? []);
      setResumen(resData);
    } catch { /* ignore */ }
    finally { setLoading(false); }
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

  const enviarRecordatorio = async (id: number) => {
    setEnviando((p) => ({ ...p, [id]: true }));
    try {
      await api.post(`/api/nomina/empleados/${id}/recordatorio`, {});
      setEnviado((p) => ({ ...p, [id]: true }));
      setTimeout(() => setEnviado((p) => ({ ...p, [id]: false })), 4000);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setEnviando((p) => ({ ...p, [id]: false }));
    }
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
        <AddIconButton title="Agregar empleado" onClick={() => { setShowForm(true); setEditando(null); }} />
      </div>

      {showForm && !editando && (
        <FormEmpleado onGuardar={guardarEmpleado} onCancelar={() => setShowForm(false)} />
      )}

      {loading && <p className="text-sm text-muted">Cargando…</p>}
      {!loading && empleados.length === 0 && (
        <p className="text-sm text-muted">No hay empleados registrados.</p>
      )}

      {empleados.length > 0 && (
        <div className={TABLE_SCROLL}>
          <table className="w-full text-sm">
            <thead className={`${THEAD_STICKY} text-[11px] font-bold uppercase tracking-wide text-muted`}>
              <tr>
                <th className="bg-surface-hover px-4 py-2.5 text-left">Nombre</th>
                <th className="hidden bg-surface-hover px-4 py-2.5 text-left sm:table-cell">Cargo · Contrato</th>
                <th className="bg-surface-hover px-4 py-2.5 text-right">Sueldo</th>
                <th className="bg-surface-hover px-4 py-2.5 text-center">Pago</th>
                <th className="bg-surface-hover px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {empleados.map((e) =>
                editando?.id === e.id ? (
                  <tr key={e.id} className="border-b border-border/50">
                    <td colSpan={5} className="px-4 py-3">
                      <FormEmpleado inicial={e} onGuardar={guardarEmpleado} onCancelar={() => setEditando(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} className={`border-b border-border/50 last:border-0 ${!e.activo ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink">{e.nombre}</div>
                      {e.telefono_wa && (
                        <div className="text-[11px] text-muted font-mono">{e.telefono_wa}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <div className="text-xs text-ink-secondary">{e.cargo || "—"}</div>
                      <div className="text-[11px] text-muted">{CONTRATO_LABELS[e.tipo_contrato] ?? e.tipo_contrato}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm text-ink">{cop(e.sueldo_mensual)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {e.dia_pago ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                            día {e.dia_pago}
                          </span>
                          {Boolean(e.activo) && e.telefono_wa && (
                            <button
                              type="button"
                              onClick={() => void enviarRecordatorio(e.id)}
                              disabled={enviando[e.id]}
                              className="text-[10px] font-semibold text-green-600 hover:underline disabled:opacity-50 dark:text-green-400"
                            >
                              {enviado[e.id] ? "Enviado ✓" : enviando[e.id] ? "…" : "Recordatorio WA"}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => { setEditando(e); setShowForm(false); }}
                          className="text-xs text-accent hover:underline">Editar</button>
                        {Boolean(e.activo) && (
                          <button type="button" onClick={() => void eliminar(e.id)}
                            className="text-xs text-red-500 hover:underline">Desactivar</button>
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

export function TabServicios() {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

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

  const syncGmail = async () => {
    setSyncingGmail(true);
    setSyncMsg(null);
    try {
      const r = await api.post<{
        ok?: boolean;
        error?: string;
        email?: string;
        servicios_creados?: number;
        pagos_nuevos?: number;
        pagos_omitidos?: number;
        sin_monto?: number;
        proveedores_con_hits?: Array<{ empresa: string; encontrados: number; pagos_nuevos: number }>;
      }>("/api/servicios/sync-gmail", {});
      if (r.error) {
        setSyncMsg(r.error);
        return;
      }
      const hits = (r.proveedores_con_hits ?? [])
        .map((p) => `${p.empresa} (${p.pagos_nuevos}/${p.encontrados})`)
        .join(", ");
      setSyncMsg(
        `Gmail ${r.email ?? ""}: +${r.servicios_creados ?? 0} servicios, +${r.pagos_nuevos ?? 0} pagos`
          + (r.pagos_omitidos ? `, ${r.pagos_omitidos} ya existían` : "")
          + (r.sin_monto ? `, ${r.sin_monto} sin monto parseable` : "")
          + (hits ? `. Hits: ${hits}` : "."),
      );
      void cargar();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Error al sincronizar Gmail");
    } finally {
      setSyncingGmail(false);
    }
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Servicios públicos, suscripciones SaaS y pagos recurrentes (Gmail McKenna).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void syncGmail()}
            disabled={syncingGmail}
            className="rounded-paper border-2 border-border bg-surface px-4 py-2 text-sm font-bold text-ink hover:border-accent hover:text-accent disabled:opacity-40"
            title="Lee recibos de Starlink, Cursor, OpenAI, Google, Cloudflare, etc."
          >
            {syncingGmail ? "Escaneando Gmail…" : "↻ Sync Gmail suscripciones"}
          </button>
          <AddIconButton title="Agregar servicio" open={showForm} onClick={() => setShowForm((v) => !v)} />
        </div>
      </div>

      {syncMsg && (
        <p className="rounded-lg border border-border bg-surface-panel px-3 py-2 text-xs text-ink-secondary">
          {syncMsg}
        </p>
      )}

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
          {cargando ? "Consultando facturas Alegra…" : "Analizar período"}
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
              <div className={`min-w-0 ${TABLE_SCROLL}`}>
                <table className="w-full min-w-[500px] text-left text-sm">
                  <thead className={`${THEAD_STICKY} text-[11px] font-bold uppercase tracking-wide text-muted`}>
                    <tr>
                      <th className="bg-surface-hover px-4 py-2.5">#</th>
                      <th className="bg-surface-hover px-4 py-2.5">Producto</th>
                      <th className="bg-surface-hover px-4 py-2.5 text-right">Unid.</th>
                      <th className="bg-surface-hover px-4 py-2.5 text-right">Facturado</th>
                      {hayUtilidades && <th className="bg-surface-hover px-4 py-2.5 text-right">Utilidad*</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.top_productos.map((p, i) => (
                      <tr key={p.code} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2.5 text-xs text-muted">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="truncate font-medium text-ink">{p.name}</div>
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
            <p className="text-sm text-muted">No hay facturas de venta Alegra en ese período.</p>
          )}
        </div>
      )}
    </div>
  );
}

// Precio editable vive en TabGanancia (actualizar-precio).
// La pestaña «Cambiar precios» se eliminó.

// ─── Tab: Cobros MeLi (cargo por venta / envío) ───────────────────────────────

interface CobroMeliItem {
  sku: string;
  nombre: string;
  meli_id: string;
  precio_meli: number | null;
  cargo_venta: number | null;
  cargo_envio: number | null;
  pct_venta: number | null;
  neto_estimado: number | null;
  free_shipping?: boolean | null;
  envio_a_cargo_comprador?: boolean | null;
  fuente?: string | null;
  error?: string | null;
}

interface CobrosMeliResp {
  items: CobroMeliItem[];
  totales: { cargo_venta: number; cargo_envio: number; precio: number };
  actualizado_en?: string | null;
  total: number;
  cache_hit?: boolean;
  error?: string;
}

function TabCobrosMeli() {
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<CobrosMeliResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (opts?: { buscar?: string; refresh?: boolean }) => {
    const busqueda = opts?.buscar ?? q;
    const refresh = Boolean(opts?.refresh);
    setFetching(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (busqueda) params.set("buscar", busqueda);
      if (refresh) params.set("refresh", "1");
      const qs = params.toString();
      const resp = await api.get<CobrosMeliResp>(
        `/api/rentabilidad/cobros-meli${qs ? `?${qs}` : ""}`,
        { timeoutMs: 120_000 },
      );
      setData(resp);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, [q]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const items = data?.items ?? [];
  const totales = data?.totales;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Igual que en el panel de publicaciones de Mercado Libre:{" "}
        <strong className="text-ink">cargo por venta</strong> (“Pagarás $X por venta”) y{" "}
        <strong className="text-ink">Envíos en Mercado Libre</strong> (“pagarás $X”).
        No incluye el crédito de Envíos Flex (“recibirás hasta”). La primera carga puede tardar; luego ~1 h de caché.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setQ(buscar.trim());
              void cargar({ buscar: buscar.trim() });
            }
          }}
          placeholder="Buscar SKU, nombre o MCO…"
          className="min-w-[200px] flex-1 rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => {
            setQ(buscar.trim());
            void cargar({ buscar: buscar.trim() });
          }}
          className="rounded-paper border-2 border-border px-3 py-2 text-sm font-semibold text-ink hover:border-accent"
        >
          Buscar
        </button>
        <button
          type="button"
          disabled={fetching}
          onClick={() => void cargar({ refresh: true })}
          className="rounded-paper border-2 border-border px-3 py-2 text-sm font-semibold text-ink hover:border-accent disabled:opacity-40"
        >
          {fetching ? "Actualizando…" : "Actualizar desde MeLi"}
        </button>
      </div>

      {data?.actualizado_en && (
        <p className="text-[11px] text-muted">
          Actualizado: {data.actualizado_en}
          {data.cache_hit ? " (caché)" : ""} · {data.total ?? items.length} publicaciones
        </p>
      )}
      {(error || data?.error) && (
        <p className="text-sm text-danger">{error || data?.error}</p>
      )}

      {totales && items.length > 0 && (
        <div className="flex flex-wrap gap-4 rounded-paper border-2 border-border bg-surface-hover px-4 py-3 text-sm">
          <span className="text-muted">
            Precio listado: <span className="font-semibold text-ink">{cop(totales.precio)}</span>
          </span>
          <span className="text-muted">
            Cargo por venta: <span className="font-semibold text-ink">{cop(totales.cargo_venta)}</span>
          </span>
          <span className="text-muted">
            Envíos MeLi (pagarás): <span className="font-semibold text-ink">{cop(totales.cargo_envio)}</span>
          </span>
        </div>
      )}

      {loading && !data ? (
        <p className="animate-pulse text-sm text-muted">Consultando cobros en Mercado Libre…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No hay publicaciones con meli_id o sin resultados para la búsqueda.</p>
      ) : (
        <div className={TABLE_SCROLL_PAPER}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className={`${THEAD_STICKY} text-left text-[11px] uppercase tracking-wide text-muted`}>
              <tr>
                <th className="bg-surface-hover px-3 py-2">Producto</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Precio MeLi</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Cargo por venta</th>
                <th className="bg-surface-hover px-3 py-2 text-right">% venta</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Envíos MeLi (pagarás)</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Neto est.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.meli_id} className="border-t border-border/70">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{row.nombre}</div>
                    <div className="text-[11px] text-muted">
                      {row.sku} · {row.meli_id}
                      {row.envio_a_cargo_comprador
                        ? " · envío a cargo del comprador"
                        : row.free_shipping
                          ? " · envío gratis"
                          : ""}
                      {row.error ? ` · ${row.error}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {row.precio_meli != null ? cop(row.precio_meli) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {row.cargo_venta != null ? cop(row.cargo_venta) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {row.pct_venta != null ? `${(row.pct_venta * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {row.cargo_envio != null ? cop(row.cargo_envio) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">
                    {row.neto_estimado != null ? cop(row.neto_estimado) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Ganancia (precio − costo real − cobros MeLi) ────────────────────────

interface GananciaItem {
  sku: string;
  nombre: string;
  meli_id: string;
  precio_venta: number | null;
  costo_real: number | null;
  sin_costo?: number | null;
  cargo_venta: number | null;
  cargo_envio: number | null;
  cobros_meli: number | null;
  ganancia: number | null;
  margen_pct: number | null;
  free_shipping?: boolean | null;
}

interface GananciaResp {
  items: GananciaItem[];
  total: number;
  con_ganancia?: number;
  actualizado_en?: string | null;
  cache_hit?: boolean;
  totales: {
    precio_venta: number;
    costo_real: number;
    cobros_meli: number;
    ganancia: number;
  };
}

function TabGanancia() {
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<GananciaResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [desgloses, setDesgloses] = useState<Record<string, ComboDesglose>>({});
  const [loadingDesgloses, setLoadingDesgloses] = useState<Set<string>>(new Set());
  const [desgloseError, setDesgloseError] = useState<Record<string, string>>({});
  const [editandoCostos, setEditandoCostos] = useState<Record<string, string>>({});
  const [guardandoCostos, setGuardandoCostos] = useState<Record<string, boolean>>({});
  const [ivaIncluidoKeys, setIvaIncluidoKeys] = useState<Set<string>>(new Set());
  const [siigoCostoResult, setSiigoCostoResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [editandoPrecio, setEditandoPrecio] = useState<string | null>(null);
  const [nuevoPrecio, setNuevoPrecio] = useState("");
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);
  const [msgPrecio, setMsgPrecio] = useState<Record<string, string>>({});

  const cargar = useCallback(async (opts?: { buscar?: string; refresh?: boolean }) => {
    const busqueda = opts?.buscar ?? q;
    const refresh = Boolean(opts?.refresh);
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (busqueda) params.set("buscar", busqueda);
      if (refresh) params.set("refresh", "1");
      const qs = params.toString();
      const resp = await api.get<GananciaResp>(
        `/api/rentabilidad/ganancia${qs ? `?${qs}` : ""}`,
        { timeoutMs: refresh ? 300_000 : 120_000 },
      );
      setData(resp);
      if (refresh) {
        // Invalidar desgloses cacheados para que se recarguen con costos frescos
        setDesgloses({});
        const abiertos = Array.from(expandidos);
        if (abiertos.length > 0) {
          await Promise.all(
            abiertos.map((code) =>
              api
                .get<ComboDesglose>(`/api/rentabilidad/combo-costos/${encodeURIComponent(code)}`)
                .then((d) => setDesgloses((prev) => ({ ...prev, [code]: d })))
                .catch(() => {}),
            ),
          );
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, expandidos]);

  useEffect(() => {
    void cargar();
    // Solo carga inicial / cambio de búsqueda vía setQ — no re-fetch por expandir filas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const abrirEditorPrecio = (row: GananciaItem) => {
    const code = (row.sku || "").trim().toUpperCase();
    if (!code || row.precio_venta == null) return;
    setEditandoPrecio(code);
    setNuevoPrecio(String(row.precio_venta));
    setMsgPrecio((prev) => {
      const n = { ...prev };
      delete n[code];
      return n;
    });
  };

  const guardarPrecio = async (row: GananciaItem) => {
    const codeRaw = (row.sku || "").trim();
    const code = codeRaw.toUpperCase();
    const precio = parseFloat(nuevoPrecio);
    if (!codeRaw || isNaN(precio) || precio <= 0) return;
    setGuardandoPrecio(true);
    setError(null);
    try {
      type ActPrecioRes = {
        ok?: boolean;
        error?: string;
        meli?: { ok?: boolean; msg?: string };
        siigo?: { ok?: boolean; msg?: string };
        web?: { ok?: boolean; msg?: string };
      };
      const res = await api.post<ActPrecioRes>(
        "/api/rentabilidad/actualizar-precio",
        {
          code: codeRaw,
          nuevo_precio: precio,
          // Solo MeLi + Alegra (la web se regenera en segundo plano en el backend).
          plataformas: ["meli", "siigo"],
          nombre: row.nombre ?? "",
          meli_id: row.meli_id || "",
        },
        { timeoutMs: 60_000 },
      );

      const meliOk = Boolean(res.meli?.ok);
      const siigoOk = Boolean(res.siigo?.ok);
      const partes: string[] = [];
      if (meliOk) partes.push("MeLi");
      else partes.push(`MeLi ✗ ${res.meli?.msg || "falló"}`.trim());
      if (siigoOk) partes.push("Alegra");
      else partes.push(`Alegra ✗ ${res.siigo?.msg || "falló"}`.trim());

      if (!meliOk || !siigoOk) {
        setError(
          res.error
            || `No se pudo actualizar: ${partes.join(" · ")}`,
        );
        return;
      }

      setEditandoPrecio(null);
      setMsgPrecio((prev) => ({ ...prev, [code]: "MeLi + Alegra OK" }));
      setTimeout(
        () =>
          setMsgPrecio((prev) => {
            const n = { ...prev };
            delete n[code];
            return n;
          }),
        6000,
      );

      // Actualiza la fila en memoria al instante
      setData((prev) => {
        if (!prev?.items?.length) return prev;
        const oldPrecio = row.precio_venta;
        const items = prev.items.map((r) => {
          if ((r.sku || "").trim().toUpperCase() !== code) return r;
          let cobros = r.cobros_meli;
          let cargoVenta = r.cargo_venta;
          if (
            oldPrecio != null &&
            oldPrecio > 0 &&
            cargoVenta != null &&
            r.cargo_envio != null
          ) {
            cargoVenta = Math.round((cargoVenta * (precio / oldPrecio)) * 100) / 100;
            cobros = Math.round((cargoVenta + (r.cargo_envio || 0)) * 100) / 100;
          }
          let ganancia: number | null = null;
          let margen: number | null = null;
          if (r.costo_real != null && cobros != null) {
            ganancia = Math.round((precio - r.costo_real - cobros) * 100) / 100;
            margen = precio > 0 ? Math.round((ganancia / precio) * 10000) / 10000 : null;
          }
          return {
            ...r,
            precio_venta: precio,
            cargo_venta: cargoVenta,
            cobros_meli: cobros,
            ganancia,
            margen_pct: margen,
          };
        });
        return { ...prev, items };
      });
    } catch (e) {
      setError((e as Error).message || "No se pudo actualizar el precio en MeLi/Alegra");
    } finally {
      setGuardandoPrecio(false);
    }
  };

  const toggleDesglose = async (sku: string) => {
    const code = sku.trim().toUpperCase();
    if (!code) return;
    if (expandidos.has(code)) {
      setExpandidos((prev) => {
        const s = new Set(prev);
        s.delete(code);
        return s;
      });
      return;
    }
    setExpandidos((prev) => new Set(prev).add(code));
    if (desgloses[code]) return;
    setLoadingDesgloses((prev) => new Set(prev).add(code));
    setDesgloseError((prev) => {
      const n = { ...prev };
      delete n[code];
      return n;
    });
    try {
      const d = await api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${encodeURIComponent(code)}`);
      setDesgloses((prev) => ({ ...prev, [code]: d }));
    } catch (e) {
      setDesgloseError((prev) => ({ ...prev, [code]: (e as Error).message }));
    } finally {
      setLoadingDesgloses((prev) => {
        const s = new Set(prev);
        s.delete(code);
        return s;
      });
    }
  };

  const guardarCostoComponente = async (
    nombre: string,
    categoria: string,
    costoStr: string,
    parentCode: string,
    ivaIncluido: boolean,
  ) => {
    const costo = parseFloat(costoStr);
    if (isNaN(costo) || costo <= 0) return;
    const key = `${parentCode}::${nombre}`;
    setGuardandoCostos((prev) => ({ ...prev, [key]: true }));
    try {
      const codeSiigo =
        desgloses[parentCode]?.componentes.find((c) => c.nombre === nombre)?.code_siigo || undefined;
      const res = await api.post<{ siigo?: { ok: boolean; msg: string } }>(
        "/api/rentabilidad/componentes",
        {
          nombre,
          costo_unitario: costo,
          categoria,
          iva_incluido: ivaIncluido,
          codigo: codeSiigo || undefined,
          code_siigo: codeSiigo || undefined,
        },
      );
      if (res.siigo) {
        setSiigoCostoResult((prev) => ({ ...prev, [key]: res.siigo! }));
        setTimeout(
          () => setSiigoCostoResult((prev) => {
            const n = { ...prev };
            delete n[key];
            return n;
          }),
          6000,
        );
      }
      const d = await api.get<ComboDesglose>(
        `/api/rentabilidad/combo-costos/${encodeURIComponent(parentCode)}`,
      );
      setDesgloses((prev) => ({ ...prev, [parentCode]: d }));
      // Recalcula ganancia/costo real del listado con el nuevo costo
      await cargar();
    } catch (e) {
      setDesgloseError((prev) => ({
        ...prev,
        [parentCode]: (e as Error).message || "No se pudo guardar el costo",
      }));
    } finally {
      setGuardandoCostos((prev) => ({ ...prev, [key]: false }));
      setEditandoCostos((prev) => {
        const n = { ...prev };
        delete n[key];
        return n;
      });
      setIvaIncluidoKeys((prev) => {
        const s = new Set(prev);
        s.delete(key);
        return s;
      });
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        <strong className="text-ink">Ganancia</strong> = precio de venta − costo real del producto − cobros MeLi
        (cargo por venta + Envíos MeLi). Haz clic en el <strong className="text-ink">precio</strong> para
        editarlo (actualiza MeLi y Alegra), o en <strong className="text-ink">Costo real</strong> para ajustar
        componentes. Los productos con algún componente sin costo aparecen en{" "}
        <strong className="text-orange-700 dark:text-orange-300">naranja</strong>.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setQ(buscar.trim());
            }
          }}
          placeholder="Buscar SKU, nombre o MCO…"
          className="min-w-[200px] flex-1 rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setQ(buscar.trim())}
          className="rounded-paper border-2 border-border px-3 py-2 text-sm font-semibold text-ink hover:border-accent"
        >
          Buscar
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void cargar({ refresh: true })}
          title="Refresca precios MeLi y costos Alegra (sin caché)"
          className="rounded-paper border-2 border-border px-3 py-2 text-sm font-semibold text-ink hover:border-accent disabled:opacity-40"
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {data?.actualizado_en && (
        <p className="text-[11px] text-muted">
          Precios/cobros MeLi: {data.actualizado_en}
          {data.cache_hit ? " (caché)" : " (fresco)"} · {data.con_ganancia ?? 0}/{data.total} con ganancia completa
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {loading && !data ? (
        <p className="animate-pulse text-sm text-muted">Calculando ganancia…</p>
      ) : items.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed border-border p-6 text-sm text-muted">
          <p className="font-semibold text-ink">Sin publicaciones para mostrar</p>
          <p>
            Si antes veías el listado, pulsa <strong className="text-ink">Actualizar</strong> aquí
            o en Cobros MeLi «Actualizar desde MeLi». El catálogo no depende solo del cache web.
          </p>
        </div>
      ) : (
        <div className={TABLE_SCROLL_PAPER}>
          <table className="w-full min-w-[800px] text-sm">
            <thead className={`${THEAD_STICKY} text-left text-[11px] uppercase tracking-wide text-muted`}>
              <tr>
                <th className="bg-surface-hover px-3 py-2">Producto</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Precio venta</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Costo real</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Cobros MeLi</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Ganancia</th>
                <th className="bg-surface-hover px-3 py-2 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const code = (row.sku || "").trim().toUpperCase();
                const isExpanded = expandidos.has(code);
                const desglose = desgloses[code];
                const isLoadingThis = loadingDesgloses.has(code);
                const errDesg = desgloseError[code];
                const faltaCosto = Boolean(row.sin_costo && row.sin_costo > 0);
                return (
                  <Fragment key={row.meli_id || row.sku}>
                    <tr
                      className={`border-t border-border/70 ${
                        faltaCosto
                          ? "bg-orange-500/15 dark:bg-orange-500/20"
                          : ""
                      }`}
                      title={
                        faltaCosto
                          ? `${row.sin_costo} componente(s) sin costo — expandí «Costo real» para completarlos`
                          : undefined
                      }
                    >
                      <td className="px-3 py-2">
                        <div className={`font-semibold ${faltaCosto ? "text-orange-800 dark:text-orange-200" : "text-ink"}`}>
                          {row.nombre}
                        </div>
                        <div className={`text-[11px] ${faltaCosto ? "text-orange-700 dark:text-orange-300" : "text-muted"}`}>
                          {row.sku} · {row.meli_id}
                          {faltaCosto ? ` · ${row.sin_costo} comp. sin costo` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editandoPrecio === code ? (
                          <div className="inline-flex flex-col items-end gap-1">
                            <input
                              type="number"
                              min="0"
                              step="100"
                              value={nuevoPrecio}
                              onChange={(e) => setNuevoPrecio(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void guardarPrecio(row);
                                if (e.key === "Escape") setEditandoPrecio(null);
                              }}
                              className="w-28 rounded border border-accent bg-surface px-2 py-1 text-right text-sm tabular-nums text-ink outline-none"
                              autoFocus
                              disabled={guardandoPrecio}
                            />
                            <div className="flex gap-1">
                              <button
                                type="button"
                                disabled={guardandoPrecio || !(parseFloat(nuevoPrecio) > 0)}
                                onClick={() => void guardarPrecio(row)}
                                className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-40"
                              >
                                {guardandoPrecio ? "…" : "Guardar"}
                              </button>
                              <button
                                type="button"
                                disabled={guardandoPrecio}
                                onClick={() => setEditandoPrecio(null)}
                                className="rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:text-ink"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-end gap-0.5">
                            <button
                              type="button"
                              disabled={!code || row.precio_venta == null}
                              onClick={() => abrirEditorPrecio(row)}
                              className={`tabular-nums font-semibold transition ${
                                code && row.precio_venta != null
                                  ? "text-accent hover:underline"
                                  : "cursor-default text-muted"
                              }`}
                              title="Clic para cambiar precio (actualiza MeLi y Alegra)"
                            >
                              {row.precio_venta != null ? cop(row.precio_venta) : "—"}
                            </button>
                            {msgPrecio[code] && (
                              <span className="text-[10px] font-bold text-emerald-600">
                                {msgPrecio[code]}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={!code}
                          onClick={() => void toggleDesglose(code)}
                          className={`inline-flex items-center gap-1 tabular-nums font-semibold transition ${
                            !code
                              ? "cursor-default text-muted"
                              : faltaCosto
                                ? "text-orange-700 hover:underline dark:text-orange-300"
                                : "text-accent hover:underline"
                          }`}
                          title={
                            faltaCosto
                              ? "Faltan costos de componentes — clic para completar"
                              : "Ver desglose de costo real"
                          }
                        >
                          {row.costo_real != null ? cop(row.costo_real) : "—"}
                          {code && (
                            <span className={`text-xs transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                              ▾
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {row.cobros_meli != null ? (
                          <span title={`Venta ${row.cargo_venta ?? "—"} + Envío ${row.cargo_envio ?? "—"}`}>
                            {cop(row.cobros_meli)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-bold ${
                          row.ganancia == null
                            ? "text-muted"
                            : row.ganancia >= 0
                              ? "text-emerald-600"
                              : "text-danger"
                        }`}
                      >
                        {row.ganancia != null ? cop(row.ganancia) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {row.margen_pct != null ? `${(row.margen_pct * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>

                    {isExpanded && isLoadingThis && (
                      <tr className={`border-b border-border/50 ${faltaCosto ? "bg-orange-500/10" : "bg-surface-hover/40"}`}>
                        <td colSpan={6} className="px-4 py-3 text-center text-xs text-muted">
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                            Cargando desglose de costo real…
                          </div>
                        </td>
                      </tr>
                    )}

                    {isExpanded && errDesg && !isLoadingThis && (
                      <tr className={`border-b border-border/50 ${faltaCosto ? "bg-orange-500/10" : "bg-surface-hover/40"}`}>
                        <td colSpan={6} className="px-4 py-3 text-sm text-danger">
                          No se pudo cargar el desglose: {errDesg}
                        </td>
                      </tr>
                    )}

                    {isExpanded && desglose && !isLoadingThis && (
                      <tr className={`border-b border-border/50 ${faltaCosto ? "bg-orange-500/10" : "bg-surface-hover/30"}`}>
                        <td colSpan={6} className="px-4 pb-4 pt-2">
                          <p className={`mb-2 text-[11px] ${faltaCosto ? "text-orange-800 dark:text-orange-200" : "text-muted"}`}>
                            {faltaCosto
                              ? `Hay ${row.sin_costo} componente(s) sin costo — completa el costo unitario abajo.`
                              : "Ajusta el costo unitario de cada componente. El cambio aplica a todos los combos que lo usen y recalcula la ganancia."}
                          </p>
                          <div className="max-h-72 overflow-auto rounded-lg border border-border">
                            <table className="w-full text-xs">
                              <thead className={THEAD_STICKY_NESTED}>
                                <tr>
                                  <th className="bg-surface-hover px-3 py-2 text-left">Componente</th>
                                  <th className="bg-surface-hover px-3 py-2 text-left">Código</th>
                                  <th className="bg-surface-hover px-3 py-2 text-center">Categoría</th>
                                  <th className="bg-surface-hover px-3 py-2 text-right">Cant.</th>
                                  <th className="bg-surface-hover px-3 py-2 text-right">Costo unit.</th>
                                  <th className="bg-surface-hover px-3 py-2 text-right">Total</th>
                                  <th className="bg-surface-hover px-3 py-2 text-center">Fuente</th>
                                  <th className="w-28 bg-surface-hover px-3 py-2"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {desglose.componentes.map((c) => {
                                  const key = `${code}::${c.nombre}`;
                                  const editVal = editandoCostos[key];
                                  const isEditing = editVal !== undefined;
                                  return (
                                    <tr
                                      key={c.nombre}
                                      className={`border-b border-border/40 last:border-0 ${
                                        !c.costo_conocido ? "bg-orange-50/40 dark:bg-orange-900/10" : ""
                                      }`}
                                    >
                                      <td className="truncate px-3 py-1.5 text-ink-secondary" title={c.nombre}>
                                        {c.nombre}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        {c.code_siigo ? (
                                          <span className="font-mono text-[10px] text-muted">{c.code_siigo}</span>
                                        ) : (
                                          <span className="text-[10px] text-border">—</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-center text-muted">
                                        {CATEGORIA_LABELS[c.categoria] ?? c.categoria}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono text-muted">×{c.cantidad}</td>
                                      <td className="px-3 py-1.5 text-right">
                                        {isEditing ? (
                                          <div className="flex flex-col items-end gap-1">
                                            <input
                                              type="number"
                                              min="0"
                                              step="50"
                                              value={editVal}
                                              onChange={(e) =>
                                                setEditandoCostos((prev) => ({
                                                  ...prev,
                                                  [key]: e.target.value,
                                                }))
                                              }
                                              className="w-24 rounded border border-accent bg-surface px-1 py-0.5 text-right text-ink outline-none"
                                              autoFocus
                                            />
                                            <label className="flex cursor-pointer select-none items-center gap-1">
                                              <input
                                                type="checkbox"
                                                checked={ivaIncluidoKeys.has(key)}
                                                onChange={(e) =>
                                                  setIvaIncluidoKeys((prev) => {
                                                    const s = new Set(prev);
                                                    if (e.target.checked) s.add(key);
                                                    else s.delete(key);
                                                    return s;
                                                  })
                                                }
                                                className="h-3 w-3 accent-accent"
                                              />
                                              <span className="text-[10px] text-muted">IVA 19%</span>
                                            </label>
                                            {ivaIncluidoKeys.has(key) && parseFloat(editVal) > 0 && (
                                              <span className="text-[10px] text-muted">
                                                Neto: {cop(parseFloat(editVal) / 1.19)}
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <span className={c.costo_conocido ? "font-mono text-ink" : "text-orange-500"}>
                                            {c.costo_conocido ? cop(c.costo_unit) : "—"}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono text-ink">
                                        {c.costo_conocido ? cop(c.costo_total) : "—"}
                                      </td>
                                      <td className="px-3 py-1.5 text-center text-[10px] text-muted">
                                        {c.fuente === "siigo" ? (
                                          <span
                                            title={c.fecha_compra ? `Última compra: ${c.fecha_compra}` : "Facturas Alegra"}
                                            className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400 cursor-default"
                                          >
                                            Alegra
                                          </span>
                                        ) : c.fuente === "excel" ? (
                                          <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 cursor-default">
                                            Excel
                                          </span>
                                        ) : c.fuente === "manual" ? (
                                          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 cursor-default">
                                            Manual
                                          </span>
                                        ) : c.costo_conocido ? (
                                          "—"
                                        ) : (
                                          <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 cursor-default">
                                            Sin costo
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-right">
                                        {isEditing ? (
                                          <div className="flex gap-1 justify-end">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                void guardarCostoComponente(
                                                  c.nombre,
                                                  c.categoria,
                                                  editVal,
                                                  code,
                                                  ivaIncluidoKeys.has(key),
                                                )
                                              }
                                              disabled={guardandoCostos[key]}
                                              className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
                                            >
                                              {guardandoCostos[key] ? "Guardando…" : "Guardar en Alegra"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditandoCostos((prev) => {
                                                  const n = { ...prev };
                                                  delete n[key];
                                                  return n;
                                                });
                                                setIvaIncluidoKeys((prev) => {
                                                  const s = new Set(prev);
                                                  s.delete(key);
                                                  return s;
                                                });
                                              }}
                                              className="rounded border border-border px-2 py-0.5 text-[10px] text-muted"
                                            >
                                              ×
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex flex-col items-end gap-1">
                                            {siigoCostoResult[key] && (
                                              <span
                                                title={siigoCostoResult[key].msg}
                                                className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                                  siigoCostoResult[key].ok
                                                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                }`}
                                              >
                                                Alegra {siigoCostoResult[key].ok ? "✓" : "✗"}
                                              </span>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setEditandoCostos((prev) => ({
                                                  ...prev,
                                                  [key]: String(c.costo_unit || ""),
                                                }))
                                              }
                                              className="text-[10px] text-accent hover:underline"
                                            >
                                              {c.costo_conocido ? "Ajustar" : "Ingresar"}
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <div className="flex flex-wrap gap-4 border-t border-border bg-surface-hover px-3 py-2 text-[11px]">
                              {[
                                { label: "Materia prima", val: desglose.totales.costo_materiales },
                                { label: "Envase", val: desglose.totales.costo_envase },
                                { label: "Etiqueta", val: desglose.totales.costo_etiqueta },
                                { label: "Embalaje", val: desglose.totales.otros_costos },
                                ...(desglose.totales.costo_nomina > 0
                                  ? [{ label: "Nómina", val: desglose.totales.costo_nomina }]
                                  : []),
                              ].map((item) => (
                                <span key={item.label} className="text-muted">
                                  {item.label}: <span className="font-semibold text-ink">{cop(item.val)}</span>
                                </span>
                              ))}
                              <span className="ml-auto font-bold text-ink">
                                Total:{" "}
                                {cop(
                                  desglose.totales.costo_materiales
                                    + desglose.totales.costo_envase
                                    + desglose.totales.costo_etiqueta
                                    + desglose.totales.otros_costos
                                    + desglose.totales.costo_nomina,
                                )}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

type Tab = "combos" | "nomina" | "servicios" | "periodo" | "cobros-meli" | "ganancia";

interface ComponenteSinCosto {
  nombre: string;
  code_siigo?: string | null;
  categoria: string;
  combos_afectados: number;
  propuesta_costo: number | null;
  propuesta_fuente: string | null;
}

interface EscaneoSinCosto {
  total_combos: number;
  componentes_sin_costo: number;
  con_propuesta_autofill: number;
  sin_propuesta: number;
  componentes: ComponenteSinCosto[];
}

function PanelSinCosto() {
  const [data, setData] = useState<EscaneoSinCosto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [ivaKeys, setIvaKeys] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState<Record<string, boolean>>({});
  const [guardados, setGuardados] = useState<Set<string>>(new Set());
  const [msgOk, setMsgOk] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.get<EscaneoSinCosto>("/api/rentabilidad/componentes-faltantes", {
        timeoutMs: 120_000,
      });
      setData(d);
      const seed: Record<string, string> = {};
      for (const c of d.componentes ?? []) {
        if (c.propuesta_costo != null && c.propuesta_costo > 0) {
          seed[c.nombre] = String(c.propuesta_costo);
        }
      }
      setValores((prev) => ({ ...seed, ...prev }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const lista = useMemo(() => {
    const items = (data?.componentes ?? []).filter((c) => !guardados.has(c.nombre));
    const q = filtro.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.nombre.toLowerCase().includes(q) ||
        (c.code_siigo || "").toLowerCase().includes(q),
    );
  }, [data, filtro, guardados]);

  const guardarUno = async (c: ComponenteSinCosto) => {
    const raw = (valores[c.nombre] || "").trim();
    const costo = parseFloat(raw);
    if (isNaN(costo) || costo <= 0) return;
    setGuardando((prev) => ({ ...prev, [c.nombre]: true }));
    try {
      const res = await api.post<{ siigo?: { ok: boolean; msg: string } }>(
        "/api/rentabilidad/componentes",
        {
          nombre: c.nombre,
          costo_unitario: costo,
          categoria: c.categoria || "material",
          iva_incluido: ivaKeys.has(c.nombre),
          codigo: c.code_siigo || undefined,
          code_siigo: c.code_siigo || undefined,
        },
      );
      setGuardados((prev) => new Set(prev).add(c.nombre));
      setMsgOk((prev) => ({
        ...prev,
        [c.nombre]: res.siigo?.ok
          ? "Guardado + Alegra"
          : res.siigo
            ? `Guardado (Alegra: ${res.siigo.msg})`
            : "Guardado",
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando((prev) => ({ ...prev, [c.nombre]: false }));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-1 pb-2 text-[11px] text-muted">
        Ingresa el costo unitario y guarda. Aplica a todos los combos que usen ese componente.
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border pb-2">
        <input
          type="search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por nombre o código…"
          className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={loading}
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50"
        >
          {loading ? "Escaneando…" : "Actualizar lista"}
        </button>
        {data && (
          <span className="text-[11px] text-muted">
            {lista.length} pendientes
            {guardados.size > 0 ? ` · ${guardados.size} guardados` : ""}
            {data.con_propuesta_autofill > 0
              ? ` · ${data.con_propuesta_autofill} con sugerencia Alegra`
              : ""}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pt-3">
        {loading && !data && (
          <p className="animate-pulse py-10 text-center text-sm text-muted">
            Escaneando combos sin costo…
          </p>
        )}
        {error && (
          <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
        {!loading && data && lista.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
            <p className="text-base font-semibold text-ink">
              {guardados.size > 0 ? "Listo: ya no quedan pendientes en esta sesión" : "Sin pendientes"}
            </p>
            <p className="mt-1 text-sm text-muted">
              Todos los componentes de combo tienen costo asignado.
            </p>
          </div>
        )}
        {lista.length > 0 && (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className={THEAD_STICKY}>
                <tr className="text-[10px] uppercase tracking-wide text-muted">
                  <th className="bg-surface-hover px-3 py-2 text-left">Componente</th>
                  <th className="bg-surface-hover px-3 py-2 text-left">Código</th>
                  <th className="bg-surface-hover px-3 py-2 text-center">Categoría</th>
                  <th className="bg-surface-hover px-3 py-2 text-right">Combos</th>
                  <th className="bg-surface-hover px-3 py-2 text-right">Costo unit.</th>
                  <th className="w-36 bg-surface-hover px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const val = valores[c.nombre] ?? "";
                  const conIva = ivaKeys.has(c.nombre);
                  const num = parseFloat(val);
                  return (
                    <tr key={c.nombre} className="border-t border-border/50">
                      <td className="max-w-[240px] truncate px-3 py-2 text-ink" title={c.nombre}>
                        {c.nombre}
                        {msgOk[c.nombre] && (
                          <span className="ml-2 text-[10px] font-bold text-emerald-600">
                            {msgOk[c.nombre]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted">
                        {c.code_siigo || "—"}
                      </td>
                      <td className="px-3 py-2 text-center text-muted">
                        {CATEGORIA_LABELS[c.categoria] ?? c.categoria}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted">
                        {c.combos_afectados}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="number"
                            min="0"
                            step="50"
                            value={val}
                            onChange={(e) =>
                              setValores((prev) => ({ ...prev, [c.nombre]: e.target.value }))
                            }
                            placeholder={
                              c.propuesta_costo != null
                                ? `Sug. ${c.propuesta_costo}`
                                : "Ingresar…"
                            }
                            className="w-28 rounded border border-border bg-surface px-2 py-1 text-right text-ink outline-none focus:border-accent"
                          />
                          <label className="flex cursor-pointer select-none items-center gap-1">
                            <input
                              type="checkbox"
                              checked={conIva}
                              onChange={(e) =>
                                setIvaKeys((prev) => {
                                  const s = new Set(prev);
                                  if (e.target.checked) s.add(c.nombre);
                                  else s.delete(c.nombre);
                                  return s;
                                })
                              }
                              className="h-3 w-3 accent-accent"
                            />
                            <span className="text-[10px] text-muted">IVA 19%</span>
                          </label>
                          {conIva && num > 0 && (
                            <span className="text-[10px] text-muted">Neto: {cop(num / 1.19)}</span>
                          )}
                          {c.propuesta_costo != null && !val && (
                            <button
                              type="button"
                              className="text-[10px] text-accent hover:underline"
                              onClick={() =>
                                setValores((prev) => ({
                                  ...prev,
                                  [c.nombre]: String(c.propuesta_costo),
                                }))
                              }
                            >
                              Usar sugerencia {cop(c.propuesta_costo)}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={guardando[c.nombre] || !(num > 0)}
                          onClick={() => void guardarUno(c)}
                          className="rounded bg-accent px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40"
                        >
                          {guardando[c.nombre] ? "…" : "Guardar en Alegra"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PanelConsultarFacturas({ onAbrirPendiente }: { onAbrirPendiente: (sufijo: string) => void }) {
  return <ConsultarFacturaPorProducto compact onAbrirPendiente={onAbrirPendiente} />;
}

export function ModalHerramientasRentabilidad({
  onClose,
  foco = "ambos",
  flotante = false,
}: {
  onClose: () => void;
  /** Qué panel destacar al abrir (ambos = layout actual lado a lado). */
  foco?: "sin-costo" | "facturas" | "ambos";
  /** Sin overlay: la pestaña Contabilidad sigue usable en paralelo. */
  flotante?: boolean;
}) {
  const setPanel = useAppStore((s) => s.setPanel);
  const setFacturasBootSufijo = useAppStore((s) => s.setFacturasBootSufijo);
  const soloSinCosto = foco === "sin-costo";
  const soloFacturas = foco === "facturas";

  useEffect(() => {
    if (flotante) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, flotante]);

  const body = (
    <div
      className={`grid min-h-0 flex-1 overflow-y-auto lg:overflow-hidden ${
        foco === "ambos"
          ? "grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0"
          : "grid-cols-1"
      } ${flotante ? "h-full" : ""}`}
    >
      {!soloFacturas && (
        <section
          className={`flex flex-col overflow-hidden ${flotante ? "min-h-0 flex-1" : "min-h-[50vh] lg:min-h-0"}`}
          aria-label="Componentes sin costo"
        >
          {foco === "ambos" && (
            <div className="shrink-0 border-b border-border bg-orange-500/10 px-4 py-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-orange-700 dark:text-orange-300">
                Sin costo
              </h4>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <PanelSinCosto />
          </div>
        </section>
      )}
      {!soloSinCosto && (
        <section
          className={`flex flex-col overflow-hidden ${flotante ? "min-h-0 flex-1" : "min-h-[50vh] lg:min-h-0"}`}
          aria-label="Consultar facturas"
        >
          {foco === "ambos" && (
            <div className="shrink-0 border-b border-border bg-surface-hover px-4 py-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-ink">
                Consultar facturas
              </h4>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <PanelConsultarFacturas
              onAbrirPendiente={(sufijo) => {
                onClose();
                setFacturasBootSufijo(sufijo);
                setPanel("facturas");
              }}
            />
          </div>
        </section>
      )}
    </div>
  );

  if (flotante) {
    const title = soloFacturas ? "Consultar facturas" : soloSinCosto ? "Componentes sin costo" : "Herramientas";
    return (
      <FloatingToolWindow
        id={soloFacturas ? "facturas" : soloSinCosto ? "sin-costo" : "herramientas"}
        title={title}
        headerClassName={
          soloFacturas
            ? "border-border bg-surface-hover text-ink"
            : "border-border bg-orange-500/10 text-orange-700 dark:text-orange-300"
        }
        borderClassName={soloFacturas ? "border-ink/30" : "border-orange-500/40"}
        defaultRect={
          soloFacturas
            ? defaultFloatRect("ml", 448, 560)
            : defaultFloatRect("tl", 448, 560)
        }
        minWidth={320}
        minHeight={280}
        zIndex={soloFacturas ? 885 : 880}
        onClose={onClose}
      >
        {body}
      </FloatingToolWindow>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[700] flex items-center justify-center bg-ink/70 p-2 backdrop-blur-sm sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="rentabilidad-herramientas-title"
        className={`flex max-h-[96vh] w-full flex-col overflow-hidden rounded-paper-lg border-2 border-border bg-surface-panel shadow-paper-lg ${
          foco === "ambos" ? "max-w-[96vw] xl:max-w-7xl" : "max-w-3xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 id="rentabilidad-herramientas-title" className="text-sm font-semibold text-ink">
              {soloSinCosto
                ? "Componentes sin costo"
                : soloFacturas
                  ? "Consultar facturas"
                  : "Sin costo + Consultar facturas"}
            </h3>
            <p className="text-[11px] text-muted">
              {soloSinCosto
                ? "Insumos de combos sin costo unitario asignado."
                : soloFacturas
                  ? "Busca facturas de compra por producto."
                  : "Trabaja costos a la izquierda y consulta facturas a la derecha, en paralelo."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1 text-sm text-muted hover:bg-surface-hover hover:text-ink"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}

export default function RentabilidadPanel() {
  const [tab, setTab] = useState<Tab>("ganancia");
  const rentabilidadBootTab = useAppStore((s) => s.rentabilidadBootTab);
  const setRentabilidadBootTab = useAppStore((s) => s.setRentabilidadBootTab);

  useEffect(() => {
    if (rentabilidadBootTab) {
      // Compat: la pestaña «precios» se unificó en ganancia
      const tabBoot =
        (rentabilidadBootTab as string) === "precios" ? "ganancia" : rentabilidadBootTab;
      setTab(tabBoot);
      setRentabilidadBootTab(null);
    }
  }, [rentabilidadBootTab, setRentabilidadBootTab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "ganancia", label: "Ganancia" },
    { id: "cobros-meli", label: "Cobros MeLi" },
    { id: "combos", label: "Costo real producto" },
    { id: "nomina", label: "Nómina" },
    { id: "servicios", label: "Servicios" },
    { id: "periodo", label: "Análisis de período" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 pb-3">
        <div
          className="flex gap-1 overflow-x-auto rounded-paper border-2 border-border bg-surface-hover p-1 shadow-paper-sm"
          role="tablist"
          aria-label="Secciones de Rentabilidad"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                tab === t.id ? "bg-surface-panel text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-4">
        {tab === "combos" && <TabCombos />}
        {tab === "cobros-meli" && <TabCobrosMeli />}
        {tab === "ganancia" && <TabGanancia />}
        {tab === "nomina" && <TabNomina />}
        {tab === "servicios" && <TabServicios />}
        {tab === "periodo" && <TabPeriodo />}
      </div>
    </div>
  );
}
