import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
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
  fuente?: "siigo" | "manual" | null;
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

// ─── Tab: Productos Combo Siigo ───────────────────────────────────────────────

function TabCombos() {
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [desgloses, setDesgloses] = useState<Record<string, ComboDesglose>>({});
  const [loadingDesgloses, setLoadingDesgloses] = useState<Set<string>>(new Set());
  const [editandoCostos, setEditandoCostos] = useState<Record<string, string>>({});
  const [guardandoCostos, setGuardandoCostos] = useState<Record<string, boolean>>({});
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

  const guardarCostoComponente = async (nombre: string, categoria: string, costoStr: string, parentCode: string) => {
    const costo = parseFloat(costoStr);
    if (isNaN(costo)) return;
    const key = `${parentCode}::${nombre}`;
    setGuardandoCostos((prev) => ({ ...prev, [key]: true }));
    try {
      await api.post("/api/rentabilidad/componentes", { nombre, costo_unitario: costo, categoria });
      const d = await api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${parentCode}`);
      setDesgloses((prev) => ({ ...prev, [parentCode]: d }));
    } catch { /* ignore */ }
    finally {
      setGuardandoCostos((prev) => ({ ...prev, [key]: false }));
      setEditandoCostos((prev) => { const n = { ...prev }; delete n[key]; return n; });
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
        (d.sin_propuesta > 0 ? ` · ${d.sin_propuesta} sin precio en Siigo` : "")
      );
      setAutofillPreview(null);
      for (const code of Array.from(expandidos)) {
        try {
          const desg = await api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${code}`);
          setDesgloses((prev) => ({ ...prev, [code]: desg }));
        } catch { /* ignore */ }
      }
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
          for (const code of Array.from(expandidos)) {
            try {
              const desg = await api.get<ComboDesglose>(`/api/rentabilidad/combo-costos/${code}`);
              setDesgloses((prev) => ({ ...prev, [code]: desg }));
            } catch { /* ignore */ }
          }
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
    () => Object.values(desgloses).filter((d) => d.totales.componentes_sin_costo === 0).length,
    [desgloses]
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
            title={catalogoEstado.actualizado ? `Actualizado: ${catalogoEstado.actualizado}` : "Sin catálogo Siigo"}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold cursor-default ${
              catalogoEstado.vigente
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
            }`}
          >
            {catalogoEstado.vigente
              ? `${catalogoEstado.con_precio_compra ?? 0} precios en Siigo`
              : "Catálogo vencido"}
          </span>
        )}
        <button
          type="button"
          onClick={() => void rebuildCatalogo()}
          disabled={rebuilding}
          title="Reconstruir índice cruzando todas las facturas de compra Siigo"
          className="shrink-0 rounded-paper border-2 border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-50 transition"
        >
          {rebuilding ? "Actualizando…" : "Actualizar catálogo"}
        </button>
        <button
          type="button"
          onClick={() => void escanearFaltantes()}
          disabled={autofillLoading}
          title="Detecta componentes de combos sin costo y asigna precio desde Siigo (lista o costo bodega)"
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
                <span className="font-bold text-green-600 dark:text-green-400">{autofillPreview.con_propuesta_autofill}</span> con precio en Siigo ·{" "}
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
                <thead className="sticky top-0 bg-surface-hover text-[10px] font-bold uppercase text-muted">
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
                        {c.propuesta_fuente === "siigo_lista" ? "Lista Siigo" : c.propuesta_fuente === "siigo_unit_cost" ? "Costo bodega" : "—"}
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
            <span className="font-bold text-ink">{productos.length}</span> combos en Siigo
          </span>
          {busqueda && (
            <span className="rounded-full border border-border bg-surface-panel px-3 py-1 text-ink-secondary">
              <span className="font-bold text-ink">{productosFiltrados.length}</span> resultados
            </span>
          )}
          {Object.keys(desgloses).length > 0 && (
            <span className="rounded-full border border-border bg-surface-panel px-3 py-1 text-ink-secondary">
              <span className="font-bold text-green-600 dark:text-green-400">{combosConCostoCompleto}</span>
              /{Object.keys(desgloses).length} con costo completo
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Cargando productos Siigo…
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && productosFiltrados.length === 0 && !error && (
        <p className="py-10 text-center text-sm text-muted">
          {busqueda ? "Sin resultados para esa búsqueda." : "No hay productos combo en Siigo."}
        </p>
      )}

      {!loading && productosFiltrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-panel">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-hover">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted">Código</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted">Producto</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-muted">Precio</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-muted">Comp.</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-muted">Costo total</th>
                <th className="w-8 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {productosFiltrados.map((p) => {
                const isExpanded = expandidos.has(p.code);
                const isLoadingThis = loadingDesgloses.has(p.code);
                const desglose = desgloses[p.code];
                const sinCosto = desglose?.totales.componentes_sin_costo ?? null;
                const costoTotal = desglose
                  ? desglose.totales.costo_materiales + desglose.totales.costo_envase +
                    desglose.totales.costo_etiqueta + desglose.totales.otros_costos
                  : null;

                return (
                  <Fragment key={p.code}>
                    <tr
                      onClick={() => void toggleExpandir(p)}
                      className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-hover ${isExpanded ? "bg-surface-hover/60" : ""}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted">{p.code}</td>
                      <td className="px-4 py-3 font-medium text-ink">
                        <div className="max-w-[260px] truncate">{p.name}</div>
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
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="font-mono text-ink">{cop(costoTotal)}</span>
                            {sinCosto != null && sinCosto > 0 && (
                              <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                                {sinCosto} sin costo
                              </span>
                            )}
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
                          <div className="overflow-hidden rounded-lg border border-border">
                            <table className="w-full text-xs">
                              <thead className="border-b border-border bg-surface-hover text-[10px] font-bold uppercase tracking-wide text-muted">
                                <tr>
                                  <th className="px-3 py-2 text-left">Componente</th>
                                  <th className="px-3 py-2 text-center">Categoría</th>
                                  <th className="px-3 py-2 text-right">Cant.</th>
                                  <th className="px-3 py-2 text-right">Costo unit.</th>
                                  <th className="px-3 py-2 text-right">Total</th>
                                  <th className="px-3 py-2 text-center">Fuente</th>
                                  <th className="px-3 py-2 w-16"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {desglose.componentes.map((c) => {
                                  const key = `${p.code}::${c.nombre}`;
                                  const editVal = editandoCostos[key];
                                  const isEditing = editVal !== undefined;
                                  return (
                                    <tr key={c.nombre} className={`border-b border-border/40 last:border-0 ${!c.costo_conocido ? "bg-orange-50/40 dark:bg-orange-900/10" : ""}`}>
                                      <td className="px-3 py-1.5 max-w-[200px] truncate text-ink-secondary" title={c.nombre}>{c.nombre}</td>
                                      <td className="px-3 py-1.5 text-center text-muted">{CATEGORIA_LABELS[c.categoria] ?? c.categoria}</td>
                                      <td className="px-3 py-1.5 text-right font-mono text-muted">×{c.cantidad}</td>
                                      <td className="px-3 py-1.5 text-right">
                                        {isEditing ? (
                                          <input type="number" min="0" step="50" value={editVal}
                                            onChange={(e) => setEditandoCostos((prev) => ({ ...prev, [key]: e.target.value }))}
                                            className="w-20 rounded border border-accent bg-surface px-1 py-0.5 text-right text-ink outline-none"
                                            autoFocus />
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
                                          <span title={c.fecha_compra ? `Última compra: ${c.fecha_compra}` : "Facturas Siigo"}
                                            className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400 cursor-default">
                                            Siigo
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
                                          <div className="flex justify-end gap-1">
                                            <button type="button"
                                              onClick={() => void guardarCostoComponente(c.nombre, c.categoria, editVal, p.code)}
                                              disabled={guardandoCostos[key]}
                                              className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50">
                                              {guardandoCostos[key] ? "…" : "OK"}
                                            </button>
                                            <button type="button"
                                              onClick={() => setEditandoCostos((prev) => { const n = { ...prev }; delete n[key]; return n; })}
                                              className="rounded border border-border px-2 py-0.5 text-[10px] text-muted">×</button>
                                          </div>
                                        ) : (
                                          <button type="button"
                                            onClick={() => setEditandoCostos((prev) => ({ ...prev, [key]: String(c.costo_unit) }))}
                                            className="text-[10px] text-accent hover:underline">
                                            {c.costo_conocido ? "Editar" : "Ingresar"}
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <div className="flex flex-wrap gap-4 border-t border-border bg-surface-hover px-3 py-2 text-[11px]">
                              {[
                                { label: "Materias primas", val: desglose.totales.costo_materiales },
                                { label: "Envase", val: desglose.totales.costo_envase },
                                { label: "Etiqueta", val: desglose.totales.costo_etiqueta },
                                { label: "Otros", val: desglose.totales.otros_costos },
                              ].map((item) => (
                                <span key={item.label} className="text-muted">
                                  {item.label}: <span className="font-semibold text-ink">{cop(item.val)}</span>
                                </span>
                              ))}
                              <span className="ml-auto font-bold text-ink">
                                Total: {cop(
                                  desglose.totales.costo_materiales + desglose.totales.costo_envase +
                                  desglose.totales.costo_etiqueta + desglose.totales.otros_costos
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
        <button type="button" onClick={() => { setShowForm(true); setEditando(null); }}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white">
          + Agregar
        </button>
      </div>

      {showForm && !editando && (
        <FormEmpleado onGuardar={guardarEmpleado} onCancelar={() => setShowForm(false)} />
      )}

      {loading && <p className="text-sm text-muted">Cargando…</p>}
      {!loading && empleados.length === 0 && (
        <p className="text-sm text-muted">No hay empleados registrados.</p>
      )}

      {empleados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-panel">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-hover text-[11px] font-bold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 text-left">Nombre</th>
                <th className="px-4 py-2.5 text-left hidden sm:table-cell">Cargo · Contrato</th>
                <th className="px-4 py-2.5 text-right">Sueldo</th>
                <th className="px-4 py-2.5 text-center">Pago</th>
                <th className="px-4 py-2.5"></th>
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

// ─── Tab: Actualizar precios ──────────────────────────────────────────────────

interface ResultadoPlataforma {
  ok: boolean;
  msg: string;
  items?: Array<{ item_id: string; ok: boolean; status: number }>;
}

interface CanalPrecioPreview {
  prioridad?: number;
  precio?: number;
  precio_producto?: number;
  rol?: string;
  regla?: string;
  nota?: string;
  envio_gratis?: boolean;
  envio_apartado?: boolean;
  envio_estimado_referencia?: number;
  ahorro_vs_meli_producto?: number;
  descuento_pct?: number;
}

interface PreciosMulticanal {
  precio_meli_referencia?: number;
  precio_publico?: number;
  lista: number;
  meli: number;
  web: number;
  envio_referencia?: number;
  envio_web_apartado?: boolean;
  ahorro_web_vs_meli?: number;
  desglose: string;
  documentacion?: {
    titulo: string;
    resumen: string;
    prioridad: Array<{
      orden: number;
      canal: string;
      clave: string;
      rol: string;
      descripcion: string;
    }>;
    entrada_panel: string;
    comision_meli_pct: number;
  };
  canales?: {
    meli?: CanalPrecioPreview;
    siigo?: CanalPrecioPreview;
    web?: CanalPrecioPreview;
  };
  reglas?: Record<string, string>;
}

interface ResultadoActualizacion {
  precios?: PreciosMulticanal;
  siigo?: ResultadoPlataforma;
  meli?: ResultadoPlataforma;
  web?: ResultadoPlataforma;
}

function LogicaPreciosPanel() {
  const [doc, setDoc] = useState<PreciosMulticanal["documentacion"] | null>(null);

  useEffect(() => {
    void api
      .get<PreciosMulticanal["documentacion"]>("/api/rentabilidad/logica-precios")
      .then(setDoc)
      .catch(() => setDoc(null));
  }, []);

  if (!doc) return null;

  const pct = Math.round((doc.comision_meli_pct ?? 0.165) * 100);

  return (
    <div className="rounded-xl border border-border bg-surface-panel px-4 py-4 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-ink">{doc.titulo}</h3>
        <p className="mt-1 text-sm text-muted leading-relaxed">{doc.resumen}</p>
      </div>
      <ol className="space-y-3">
        {doc.prioridad.map((p) => (
          <li key={p.clave} className="flex gap-3 text-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
              {p.orden}°
            </span>
            <div>
              <p className="font-semibold text-ink">
                {p.canal}
                <span className="ml-2 text-xs font-normal text-muted">— {p.rol}</span>
              </p>
              <p className="mt-0.5 text-muted leading-relaxed">{p.descripcion}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted border-t border-border/60 pt-3 leading-relaxed">
        {doc.entrada_panel} Descuento web automático: ~{pct}% (comisión MeLi que el cliente no paga al comprar directo).
      </p>
    </div>
  );
}

function TabPrecios() {
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editando, setEditando] = useState<string | null>(null);
  const [nuevoPrecio, setNuevoPrecio] = useState("");
  const [plataformas, setPlataformas] = useState<Record<string, boolean>>({
    siigo: true,
    meli: true,
    web: true,
  });
  const [previewPrecios, setPreviewPrecios] = useState<PreciosMulticanal | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [resultados, setResultados] = useState<Record<string, ResultadoActualizacion>>({});

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ productos: Producto[] }>("/api/rentabilidad/productos");
      setProductos(data.productos ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    if (!editando) {
      setPreviewPrecios(null);
      return;
    }
    const precio = parseFloat(nuevoPrecio);
    if (isNaN(precio) || precio <= 0) {
      setPreviewPrecios(null);
      return;
    }
    const prod = productos.find((p) => p.code === editando);
    const t = window.setTimeout(() => {
      void api
        .get<PreciosMulticanal>(
          `/api/rentabilidad/preview-precios?code=${encodeURIComponent(editando)}&precio=${precio}${prod?.name ? `&nombre=${encodeURIComponent(prod.name)}` : ""}`
        )
        .then(setPreviewPrecios)
        .catch(() => setPreviewPrecios(null));
    }, 350);
    return () => window.clearTimeout(t);
  }, [editando, nuevoPrecio, productos]);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) =>
      p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    );
  }, [productos, busqueda]);

  const abrirEditor = (p: Producto) => {
    setEditando(p.code);
    setNuevoPrecio(String(p.precio_lista));
    setResultados((prev) => { const n = { ...prev }; delete n[p.code]; return n; });
  };

  const cerrarEditor = () => {
    setEditando(null);
    setNuevoPrecio("");
  };

  const togglePlataforma = (key: string) =>
    setPlataformas((prev) => ({ ...prev, [key]: !prev[key] }));

  const aplicarCambio = async (code: string) => {
    const precio = parseFloat(nuevoPrecio);
    if (isNaN(precio) || precio <= 0) return;
    const plats = Object.entries(plataformas).filter(([, v]) => v).map(([k]) => k);
    if (plats.length === 0) return;
    const prod = productos.find((p) => p.code === code);

    setGuardando(true);
    try {
      const data = await api.post<ResultadoActualizacion>("/api/rentabilidad/actualizar-precio", {
        code,
        nuevo_precio: precio,
        plataformas: plats,
        nombre: prod?.name ?? "",
      });
      setResultados((prev) => ({ ...prev, [code]: data }));
      setProductos((prev) =>
        prev.map((p) => (p.code === code ? { ...p, precio_lista: precio } : p))
      );
      setEditando(null);
    } catch (e) {
      setResultados((prev) => ({
        ...prev,
        [code]: { siigo: { ok: false, msg: (e as Error).message } },
      }));
    } finally {
      setGuardando(false);
    }
  };

  const PLAT_LABELS: Record<string, string> = {
    siigo: "Siigo",
    meli: "MercadoLibre",
    web: "Página web",
  };

  return (
    <div className="space-y-4">
      <LogicaPreciosPanel />

      <div>
        <input
          type="text"
          placeholder="Buscar por nombre o código…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent transition"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Cargando productos Siigo…
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && productosFiltrados.length === 0 && !error && (
        <p className="py-10 text-center text-sm text-muted">
          {busqueda ? "Sin resultados para esa búsqueda." : "No hay productos combo en Siigo."}
        </p>
      )}

      {!loading && productosFiltrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-panel">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-hover">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted">Código</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted">Producto</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-muted">Precio Siigo (≈ MeLi)</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-muted"></th>
              </tr>
            </thead>
            <tbody>
              {productosFiltrados.map((p) => {
                const isEditing = editando === p.code;
                const resultado = resultados[p.code];

                return (
                  <Fragment key={p.code}>
                    <tr className={`border-b border-border/50 transition-colors ${isEditing ? "bg-surface-hover/60" : "hover:bg-surface-hover/30"}`}>
                      <td className="px-4 py-3 font-mono text-xs text-muted">{p.code}</td>
                      <td className="px-4 py-3 font-medium text-ink">
                        <div className="max-w-[260px] truncate">{p.name}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-ink">{cop(p.precio_lista)}</td>
                      <td className="px-4 py-3 text-right">
                        {resultado && !isEditing && (
                          <div className="mb-1 space-y-1 text-right">
                            <div className="flex flex-wrap gap-1 justify-end">
                              {Object.entries(resultado)
                                .filter(([plat]) => plat !== "precios" && ["siigo", "meli", "web"].includes(plat))
                                .map(([plat, res]) => (
                                <span
                                  key={plat}
                                  title={"msg" in res ? res.msg : ""}
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold cursor-default ${
                                    "ok" in res && res.ok
                                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                      : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                                  }`}
                                >
                                  {"ok" in res && res.ok ? "✓" : "✗"} {PLAT_LABELS[plat] ?? plat}
                                </span>
                              ))}
                            </div>
                            {Object.entries(resultado)
                              .filter(([plat, res]) => ["siigo", "meli", "web"].includes(plat) && "ok" in res && !res.ok && res.msg)
                              .map(([plat, res]) => (
                                <p key={plat} className="text-[10px] text-red-600 dark:text-red-400 leading-snug max-w-[220px] ml-auto">
                                  {PLAT_LABELS[plat]}: {res.msg}
                                </p>
                              ))}
                          </div>
                        )}
                        {isEditing ? (
                          <button
                            type="button"
                            onClick={cerrarEditor}
                            className="text-xs text-muted hover:text-ink"
                          >
                            Cancelar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => abrirEditor(p)}
                            className="rounded-lg border border-accent/60 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent hover:border-accent transition"
                          >
                            Cambiar precio
                          </button>
                        )}
                      </td>
                    </tr>

                    {isEditing && (
                      <tr className="border-b border-border/50">
                        <td colSpan={4} className="px-4 pb-4 pt-2">
                          <div className="rounded-xl border-2 border-accent/30 bg-surface p-4 space-y-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                              <div className="space-y-1">
                                <label className="block text-xs font-semibold text-ink-secondary">
                                  Precio actual
                                </label>
                                <div className="rounded-paper border-2 border-border bg-surface-hover px-3 py-2 font-mono text-sm text-ink">
                                  {cop(p.precio_lista)}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <label className="block text-xs font-semibold text-ink-secondary">
                                  Precio publicado en MeLi (referencia maestra) *
                                </label>
                                <p className="text-[11px] text-muted leading-snug">
                                  Cada producto con su valor. Siigo tomará el mismo monto; la web mostrará descuento + envío aparte.
                                </p>
                                <div className="flex items-center rounded-paper border-2 border-accent bg-surface focus-within:border-accent transition">
                                  <span className="px-2 text-xs text-muted">$</span>
                                  <input
                                    type="number"
                                    min="1"
                                    step="1000"
                                    value={nuevoPrecio}
                                    onChange={(e) => setNuevoPrecio(e.target.value)}
                                    placeholder="0"
                                    autoFocus
                                    className="flex-1 bg-transparent py-2 pr-2 text-sm text-ink outline-none"
                                  />
                                </div>
                              </div>
                            </div>

                            {previewPrecios && (
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-ink-secondary">
                                  Vista previa por canal (según prioridad)
                                </p>
                                <div className="grid gap-2 sm:grid-cols-3 text-xs">
                                  {(
                                    [
                                      { key: "meli" as const, titulo: "1° MercadoLibre" },
                                      { key: "siigo" as const, titulo: "2° Siigo" },
                                      { key: "web" as const, titulo: "3° Página web" },
                                    ] as const
                                  ).map(({ key, titulo }) => {
                                    const c = previewPrecios.canales?.[key];
                                    if (!c) return null;
                                    const precio =
                                      key === "web"
                                        ? c.precio_producto ?? c.precio ?? 0
                                        : c.precio ?? 0;
                                    return (
                                      <div
                                        key={key}
                                        className="rounded-lg border border-border/70 bg-surface-hover/50 px-3 py-2 space-y-1.5"
                                      >
                                        <p className="font-bold text-ink">{titulo}</p>
                                        {c.rol && (
                                          <p className="text-[10px] uppercase tracking-wide text-accent font-semibold">
                                            {c.rol}
                                          </p>
                                        )}
                                        <p className="font-mono text-sm text-ink">
                                          {cop(precio)}
                                          {key === "web" && (
                                            <span className="text-muted font-sans text-[11px]"> + envío apartado</span>
                                          )}
                                        </p>
                                        <p className="text-muted leading-snug">{c.nota}</p>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {previewPrecios?.desglose && (
                              <p className="text-xs text-muted">{previewPrecios.desglose}</p>
                            )}

                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-ink-secondary">Actualizar en:</p>
                              <div className="flex flex-wrap gap-3">
                                {(["siigo", "meli", "web"] as const).map((key) => (
                                  <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={plataformas[key]}
                                      onChange={() => togglePlataforma(key)}
                                      className="h-4 w-4 rounded accent-accent"
                                    />
                                    <span className="text-sm text-ink">{PLAT_LABELS[key]}</span>
                                  </label>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 border-t border-border/50 pt-3">
                              <button
                                type="button"
                                onClick={() => void aplicarCambio(p.code)}
                                disabled={
                                  guardando ||
                                  !nuevoPrecio ||
                                  parseFloat(nuevoPrecio) <= 0 ||
                                  !Object.values(plataformas).some(Boolean)
                                }
                                className="rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-40 transition"
                              >
                                {guardando ? "Actualizando…" : "Aplicar cambio"}
                              </button>
                              <button
                                type="button"
                                onClick={cerrarEditor}
                                className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent transition"
                              >
                                Cancelar
                              </button>
                              {nuevoPrecio && parseFloat(nuevoPrecio) > 0 && parseFloat(nuevoPrecio) !== p.precio_lista && (
                                <span className="text-xs text-muted">
                                  Cambio:{" "}
                                  <span className={parseFloat(nuevoPrecio) > p.precio_lista ? "text-green-600 dark:text-green-400 font-semibold" : "text-red-500 font-semibold"}>
                                    {parseFloat(nuevoPrecio) > p.precio_lista ? "+" : ""}
                                    {cop(parseFloat(nuevoPrecio) - p.precio_lista)}
                                  </span>
                                </span>
                              )}
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

type Tab = "combos" | "nomina" | "servicios" | "periodo" | "precios";

export default function RentabilidadPanel() {
  const [tab, setTab] = useState<Tab>("combos");

  const tabs: { id: Tab; label: string }[] = [
    { id: "combos", label: "Combos Siigo" },
    { id: "precios", label: "Cambiar precios" },
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

      {tab === "combos" && <TabCombos />}
      {tab === "precios" && <TabPrecios />}
      {tab === "nomina" && <TabNomina />}
      {tab === "servicios" && <TabServicios />}
      {tab === "periodo" && <TabPeriodo />}
    </div>
  );
}
