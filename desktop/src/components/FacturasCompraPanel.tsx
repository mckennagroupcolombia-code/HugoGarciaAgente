import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";

// ── Types ────────────────────────────────────────────────────────────────────

interface FacturaSummary {
  sufijo: string;
  numero_factura: string;
  proveedor: string;
  nit: string;
  es_nuevo_proveedor: boolean;
  items_count: number;
  total: number;
  estado: string;
}

interface Impuesto {
  nombre: string;
  valor: number;
  porcentaje: number;
  id_dian: string;
}

interface ItemFactura {
  indice: number;
  nombre: string;
  codigo: string;
  codigo_sugerido?: string;
  codigo_manual?: boolean;
  codigo_por_referencia?: boolean;
  referencia_proveedor?: string;
  cantidad_original: number;
  unidad_original: string;
  multiplicador: number;
  cantidad_min: number;
  unidad_min: string;
  subtotal: number;
  iva: number;
  precio_unitario: number;
  precio_neto: number;
  precio_proveedor: number;
  existe_en_siigo?: boolean;
  duplicado: boolean;
  siigo_producto?: SiigoProducto | null;
  impuestos: Impuesto[];
}

interface SiigoProducto {
  codigo: string;
  nombre: string;
  unidad: string;
  activo: boolean;
}

interface CrearProductosResp {
  ok: boolean;
  parcial?: boolean;
  creados?: Array<{ indice: number; codigo?: string; siigo_producto: SiigoProducto }>;
  errores?: Array<{ indice?: number; codigo?: string; error: string }>;
  mensaje?: string;
  error?: string;
}

function lanzarSiCrearProductosFallo(res: CrearProductosResp): CrearProductosResp {
  if (res.creados?.length) return res;
  throw new Error(
    res.errores?.[0]?.error || res.error || res.mensaje || "No se pudo crear el producto en SIIGO",
  );
}

interface CompraRegistradaSiigo {
  id: string;
  name: string;
  nit: string;
  fecha?: string;
  valor?: number | null;
  provider_invoice?: { prefix?: string; number?: string };
  match?: { numero: boolean; fecha: boolean; valor: boolean };
}

interface FacturaDetalle {
  sufijo: string;
  numero_factura: string;
  proveedor: string;
  nit: string;
  es_nuevo_proveedor: boolean;
  total: number;
  estado: string;
  fecha: string;
  total_bruto: number;
  total_descuentos: number;
  total_neto: number;
  compra_registrada_siigo?: CompraRegistradaSiigo | null;
  items: ItemFactura[];
  timestamp: string;
}

interface EscanearResultado {
  ok: boolean;
  mensaje: string;
  correos_revisados: number;
  anio?: number;
  encoladas: Array<{
    sufijo: string;
    numero_factura: string;
    proveedor: string;
    total: number;
    items_count: number;
    es_nuevo_proveedor: boolean;
    fecha?: string;
  }>;
  ya_en_cola: Array<{ numero_factura: string; proveedor: string }>;
  ya_en_historial?: Array<{ numero_factura: string; proveedor: string; fecha?: string }>;
  omitidas: Array<{ numero_factura: string; proveedor: string; motivo: string }>;
  errores: Array<{ asunto: string; archivo?: string; motivo: string }>;
}

interface HistorialItemResumen {
  nombre: string;
  codigo: string;
  cantidad_min?: number;
  unidad_min?: string;
  precio_neto?: number | null;
  precio_unitario?: number | null;
  precio_proveedor?: number | null;
  precio_anterior?: number | null;
  tendencia_precio?: "nuevo" | "igual" | "subio" | "bajo" | string;
  variacion_pct?: number | null;
  existe_en_siigo?: boolean;
}

interface FacturaHistorial {
  id: string;
  sufijo?: string;
  numero_factura: string;
  proveedor: string;
  nit?: string;
  total: number;
  fecha_factura?: string;
  items_count?: number;
  accion: "inventario" | "gasto" | "omitida" | string;
  estado: "ok" | "error" | string;
  origen?: string;
  nuevos?: number;
  en_siigo?: number;
  items_resumen?: HistorialItemResumen[];
  ruta_excel?: string | null;
  ruta_xml?: string | null;
  siigo_id?: string | null;
  mensaje?: string;
  timestamp: string;
}

type VistaFacturas = "pendientes" | "historial" | "consultar";

interface CoincidenciaProducto {
  nombre: string;
  codigo: string;
  cantidad?: number | null;
  unidad?: string;
  precio_neto?: number | null;
  precio_unitario?: number | null;
  subtotal?: number | null;
}

interface FacturaConsultaResultado {
  origen: "pendiente" | "historial" | string;
  id: string;
  sufijo: string;
  numero_factura: string;
  proveedor: string;
  nit?: string;
  fecha?: string;
  total: number;
  accion?: string | null;
  estado?: string;
  timestamp?: string;
  coincidencias: CoincidenciaProducto[];
  items_count?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDec(n: number, d = 4) {
  return n.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

function cop(n: number) {
  return `$ ${fmt(n)}`;
}

const ACCION_HISTORIAL: Record<string, { label: string; cls: string }> = {
  inventario: { label: "Inventario", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  gasto: { label: "Gasto SIIGO", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  omitida: { label: "Omitida", cls: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

function fmtFecha(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
}

function copUnit(n: number, unidad?: string) {
  const u = unidad ? ` / ${unidad}` : "";
  return `$ ${n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${u}`;
}

const TENDENCIA_PRECIO: Record<string, { label: string; cls: string }> = {
  nuevo: { label: "Primera compra", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  igual: { label: "Sin cambio", cls: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  subio: { label: "Subió", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  bajo: { label: "Bajó", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
};

function BadgeTendenciaPrecio({ tendencia, variacion }: { tendencia?: string; variacion?: number | null }) {
  const cfg = TENDENCIA_PRECIO[tendencia || ""] || { label: tendencia || "—", cls: "bg-surface-hover text-muted" };
  const extra =
    variacion != null && tendencia && tendencia !== "nuevo" && tendencia !== "igual"
      ? ` ${variacion > 0 ? "+" : ""}${variacion.toFixed(1)}%`
      : "";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.cls}`}>
      {cfg.label}{extra}
    </span>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────

function FacturaCard({
  f,
  active,
  onOpen,
}: {
  f: FacturaSummary;
  active: boolean;
  onOpen: (sufijo: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(f.sufijo)}
      className={`w-full text-left rounded-xl border-2 p-4 transition space-y-2 ${
        active
          ? "border-accent bg-accent/10 shadow-sm"
          : "border-border bg-surface-panel hover:border-accent/50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-accent bg-accent/15 px-2 py-0.5 rounded">
              #{f.sufijo}
            </span>
            <span className="text-sm font-bold text-ink truncate">{f.numero_factura}</span>
          </div>
          <p className="mt-1 text-sm text-ink-secondary font-medium truncate">{f.proveedor}</p>
          {f.nit && <p className="text-[11px] text-muted font-mono">NIT {f.nit}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
          f.es_nuevo_proveedor
            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
        }`}>
          {f.es_nuevo_proveedor ? "Nuevo prov." : "Conocido"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs font-mono">
        <span className="text-muted">{f.items_count} ítem{f.items_count !== 1 ? "s" : ""}</span>
        <span className="font-semibold text-ink">{cop(f.total)}</span>
      </div>
      <p className="text-[11px] font-bold text-accent">Revisar →</p>
    </button>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────────

function DetalleFactura({
  sufijo,
  onBack,
  onDone,
  onSiguiente,
  onAnterior,
  haySiguiente,
  hayAnterior,
  posicion,
}: {
  sufijo: string;
  onBack: () => void;
  onDone: (sufijo: string) => void;
  onSiguiente?: () => void;
  onAnterior?: () => void;
  haySiguiente?: boolean;
  hayAnterior?: boolean;
  posicion?: string;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [agregarProveedor, setAgregarProveedor] = useState(false);
  const [codigosManual, setCodigosManual] = useState<Record<string, string>>({});
  const [checksCodigo, setChecksCodigo] = useState<Record<string, {
    codigo: string;
    existe_en_siigo: boolean;
    duplicado: boolean;
    siigo_producto: SiigoProducto | null;
  }>>({});
  const qc = useQueryClient();

  const { data: detalle, isLoading, error } = useQuery<FacturaDetalle>({
    queryKey: ["factura-detalle", sufijo],
    queryFn: () => api.get(`/api/facturas/${sufijo}/detalle`),
    staleTime: 30_000,
  });

  const [defaulted, setDefaulted] = useState(false);
  useEffect(() => {
    if (!detalle || defaulted) return;
    const initialCodes: Record<string, string> = {};
    detalle.items.forEach((item) => {
      initialCodes[String(item.indice)] = item.codigo;
    });
    setCodigosManual(initialCodes);
    setSelected(
      detalle.compra_registrada_siigo
        ? new Set()
        : new Set(detalle.items.map((i) => i.indice)),
    );
    setDefaulted(true);
  }, [detalle, defaulted]);

  const procesar = useMutation({
    mutationFn: () =>
      api.post(`/api/facturas/${sufijo}/procesar`, {
        indices: Array.from(selected),
        agregar_proveedor: agregarProveedor,
        codigos_manual: codigosManual,
      }),
    onSuccess: () => onDone(sufijo),
  });

  const clasificar = useMutation({
    mutationFn: (cmd: "gasto" | "skip") =>
      api.post("/api/facturas/clasificar", { cmd, sufijo }),
    onSuccess: () => onDone(sufijo),
  });

  const crearProductos = useMutation({
    mutationFn: async (indices: number[]) =>
      lanzarSiCrearProductosFallo(
        await api.post<CrearProductosResp>(`/api/facturas/${sufijo}/crear-productos`, {
          indices,
          codigos_manual: codigosManual,
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factura-detalle", sufijo] });
    },
  });

  const itemsNuevos = detalle?.items.filter(
    (i) => !(i.existe_en_siigo ?? i.duplicado),
  ) ?? [];

  const toggleItem = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (!detalle) return;
    setSelected(
      selected.size === detalle.items.length
        ? new Set()
        : new Set(detalle.items.map((i) => i.indice)),
    );
  };

  const handleCodeChange = (idx: number, codigo: string) => {
    setCodigosManual((prev) => ({ ...prev, [String(idx)]: codigo }));
    setChecksCodigo((prev) => {
      const next = { ...prev };
      delete next[String(idx)];
      return next;
    });
  };

  const handleCodeCheck = (idx: number, result: {
    codigo: string;
    existe_en_siigo: boolean;
    duplicado: boolean;
    siigo_producto: SiigoProducto | null;
  }) => {
    setChecksCodigo((prev) => ({ ...prev, [String(idx)]: result }));
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        Analizando factura y cruzando con SIIGO…
      </div>
    );
  }

  if (error || !detalle) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-sm text-red-300">No se pudo cargar el detalle de la factura.</p>
        <button type="button" onClick={onBack} className="mt-3 text-sm text-accent hover:underline">
          ← Volver al listado
        </button>
      </div>
    );
  }

  const selCount = selected.size;
  const facturaYaRegistrada = detalle.compra_registrada_siigo;
  const bloqueado = Boolean(facturaYaRegistrada);
  const nuevosCount = itemsNuevos.length;

  return (
    <div className="space-y-2">
      {/* Navegación — sticky para que siempre se vea */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-accent/40 bg-surface-panel px-3 py-2 shadow-md">
        <button
          type="button"
          onClick={hayAnterior && onAnterior ? onAnterior : onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-hover px-4 py-2 text-sm font-bold text-ink transition hover:border-accent hover:text-accent"
        >
          {hayAnterior ? "← Anterior" : "← Pendientes"}
        </button>
        {posicion ? (
          <span className="text-xs font-semibold tabular-nums text-muted">
            Revisando {posicion}
          </span>
        ) : (
          <span className="text-xs text-muted">Revisión</span>
        )}
        <button
          type="button"
          disabled={!haySiguiente}
          onClick={onSiguiente}
          title={haySiguiente ? "Ir a la siguiente pendiente" : "No hay más facturas pendientes"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Siguiente →
        </button>
      </div>

      {/* Header factura — una sola franja densa */}
      <div className="rounded-lg border border-border bg-surface-panel px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="text-base font-bold text-ink">{detalle.numero_factura}</h2>
              <span className="text-sm text-ink-secondary truncate">{detalle.proveedor}</span>
            </div>
            <p className="text-[11px] text-muted font-mono">
              {detalle.nit && <>NIT {detalle.nit} · </>}
              {detalle.fecha && <>{detalle.fecha} · </>}
              #{detalle.sufijo}
              {" · "}
              Subtotal {cop(detalle.total_bruto)}
              {" · "}
              Desc. {cop(detalle.total_descuentos)}
              {" · "}
              {detalle.items.length} ítem{detalle.items.length !== 1 ? "s" : ""}
              {" · "}
              <span className={detalle.es_nuevo_proveedor ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"}>
                {detalle.es_nuevo_proveedor ? "Proveedor nuevo" : "Proveedor conocido"}
              </span>
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[9px] uppercase tracking-wide text-muted">Total neto</p>
            <p className="text-xl font-bold text-ink leading-tight">{cop(detalle.total_neto)}</p>
          </div>
        </div>
      </div>

      {facturaYaRegistrada && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
          <p className="text-xs font-bold text-red-300">
            Ya registrada en SIIGO:{" "}
            <span className="font-mono text-ink">{facturaYaRegistrada.name || facturaYaRegistrada.id}</span>
            {facturaYaRegistrada.fecha ? ` · ${facturaYaRegistrada.fecha}` : ""}
          </p>
          <button
            type="button"
            disabled={clasificar.isPending}
            onClick={() => clasificar.mutate("skip")}
            className="mt-1.5 rounded-md bg-red-500/20 px-3 py-1 text-[11px] font-bold text-red-200 hover:bg-red-500/30 disabled:opacity-50"
          >
            Omitir de la cola
          </button>
        </div>
      )}

      {detalle.es_nuevo_proveedor && !bloqueado && (
        <label className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 cursor-pointer text-xs text-amber-900 dark:text-amber-200">
          <input
            type="checkbox"
            checked={agregarProveedor}
            onChange={(e) => setAgregarProveedor(e.target.checked)}
            className="accent-amber-500"
          />
          Agregar <strong className="mx-0.5">{detalle.proveedor}</strong> a proveedores de materias primas
        </label>
      )}

      {/* Tabla contraste proveedor ↔ McKenna */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-panel px-2.5 py-1.5">
          <input
            type="checkbox"
            checked={selCount === detalle.items.length && detalle.items.length > 0}
            onChange={toggleAll}
            disabled={bloqueado}
            className="accent-accent"
          />
          <span className="text-[11px] text-muted flex-1">
            {selCount}/{detalle.items.length} para inventariar
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wide text-muted hidden sm:inline">
            Proveedor (XML)
          </span>
          <span className="text-[9px] text-muted hidden sm:inline">→</span>
          <span className="text-[9px] font-bold uppercase tracking-wide text-accent hidden sm:inline">
            McKenna / SIIGO
          </span>
        </div>

        <div className="divide-y divide-border/60 max-h-[min(62vh,640px)] overflow-y-auto">
          {detalle.items.map((item) => (
            <ItemContrasteRow
              key={item.indice}
              sufijo={sufijo}
              item={item}
              codigo={codigosManual[String(item.indice)] ?? item.codigo}
              codigosManual={codigosManual}
              check={checksCodigo[String(item.indice)]}
              checked={selected.has(item.indice)}
              disabled={bloqueado}
              onToggle={() => toggleItem(item.indice)}
              onCodeChange={(c) => handleCodeChange(item.indice, c)}
              onCodeCheck={(r) => handleCodeCheck(item.indice, r)}
              onProductoCreado={() => qc.invalidateQueries({ queryKey: ["factura-detalle", sufijo] })}
            />
          ))}
        </div>
      </div>

      {/* Acciones humanas — botones uniformes y compactos */}
      <div className="sticky bottom-0 z-10 rounded-lg border border-border bg-surface-panel/95 backdrop-blur px-2.5 py-2 shadow-lg">
        {(crearProductos.error || crearProductos.data?.errores?.length) && (
          <p className="mb-1 text-[10px] text-red-400">
            {(crearProductos.error as Error)?.message
              || crearProductos.data?.errores?.map((e) => e.error).join(" · ")}
          </p>
        )}
        {crearProductos.data?.mensaje && crearProductos.isSuccess && (
          <p className="mb-1 text-[10px] text-emerald-600 dark:text-emerald-300">
            {crearProductos.data.mensaje}
          </p>
        )}
        <div
          className={`grid gap-1.5 ${
            nuevosCount > 0
              ? "grid-cols-3 sm:grid-cols-6"
              : "grid-cols-3 sm:grid-cols-5"
          }`}
        >
          <button
            type="button"
            onClick={hayAnterior && onAnterior ? onAnterior : onBack}
            className="h-8 rounded-md border border-border px-1.5 text-[11px] font-bold text-ink hover:border-accent hover:text-accent transition"
          >
            ← Atrás
          </button>
          {nuevosCount > 0 && (
            <button
              type="button"
              disabled={bloqueado || crearProductos.isPending}
              onClick={() => crearProductos.mutate(itemsNuevos.map((i) => i.indice))}
              className="h-8 rounded-md border border-sky-500/50 bg-sky-500/10 px-1.5 text-[11px] font-bold text-sky-800 dark:text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
            >
              {crearProductos.isPending ? "…" : `SIIGO (${nuevosCount})`}
            </button>
          )}
          <button
            type="button"
            disabled={bloqueado || selCount === 0 || procesar.isPending}
            onClick={() => procesar.mutate()}
            className="h-8 rounded-md bg-emerald-600 px-1.5 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40 transition"
          >
            {procesar.isPending ? "…" : `Inventario (${selCount})`}
          </button>
          <button
            type="button"
            disabled={bloqueado || clasificar.isPending}
            onClick={() => clasificar.mutate("gasto")}
            className="h-8 rounded-md border border-amber-500/50 bg-amber-500/10 px-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
          >
            Gasto
          </button>
          <button
            type="button"
            disabled={clasificar.isPending}
            onClick={() => clasificar.mutate("skip")}
            className="h-8 rounded-md border border-border px-1.5 text-[11px] font-semibold text-muted hover:text-ink disabled:opacity-40"
          >
            Omitir
          </button>
          <button
            type="button"
            disabled={!haySiguiente}
            onClick={onSiguiente}
            className="h-8 rounded-md border border-accent/50 bg-accent/10 px-1.5 text-[11px] font-bold text-accent hover:bg-accent/20 disabled:opacity-35 disabled:cursor-not-allowed transition"
          >
            Siguiente →
          </button>
        </div>
        {(procesar.error || clasificar.error) && (
          <p className="mt-1 text-[10px] text-red-400">{(procesar.error as Error)?.message || (clasificar.error as Error)?.message}</p>
        )}
      </div>
    </div>
  );
}

interface SiigoProducto {
  codigo: string;
  nombre: string;
  unidad: string;
  activo: boolean;
  type?: string;
}

interface SiigoBusquedaItem {
  codigo: string;
  nombre: string;
  type?: string;
}

/** Buscador compacto de productos/combos SIIGO para vincular una línea de factura. */
function SiigoBuscarPicker({
  disabled,
  seedQuery,
  onSelect,
}: {
  disabled?: boolean;
  seedQuery?: string;
  onSelect: (item: SiigoBusquedaItem) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SiigoBusquedaItem[]>([]);
  const [buscando, setBuscando] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const query = q.trim();
    if (query.length < 1) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      setBuscando(true);
      void api
        .get<{ items: SiigoBusquedaItem[] }>(
          `/api/siigo/productos/buscar?q=${encodeURIComponent(query)}&limit=40&excluir_combos=0`,
        )
        .then((data) => {
          if (!cancelled) setItems(data.items ?? []);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        })
        .finally(() => {
          if (!cancelled) setBuscando(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, abierto]);

  function abrir() {
    if (disabled) return;
    setAbierto(true);
    setQ((seedQuery || "").trim());
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }

  function elegir(item: SiigoBusquedaItem) {
    onSelect(item);
    setAbierto(false);
    setQ("");
    setItems([]);
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={abrir}
        className="rounded-md border border-violet-500/50 bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold text-violet-800 dark:text-violet-200 hover:bg-violet-500/20 disabled:opacity-40"
        title="Buscar producto o combo existente en SIIGO"
      >
        Buscar
      </button>
      {abierto && (
        <div className="absolute right-0 z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface-panel p-2 shadow-xl">
          <p className="mb-1.5 text-[10px] font-semibold text-muted">
            Buscar producto o combo en SIIGO
          </p>
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Código o nombre…"
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-accent"
          />
          <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border/60">
            {buscando && (
              <p className="px-2.5 py-2 text-[11px] text-muted">Buscando…</p>
            )}
            {!buscando && q.trim().length >= 1 && items.length === 0 && (
              <p className="px-2.5 py-2 text-[11px] text-muted">Sin coincidencias</p>
            )}
            {!buscando && q.trim().length < 1 && (
              <p className="px-2.5 py-2 text-[11px] text-muted">Escribe para buscar</p>
            )}
            {items.map((s) => {
              const esCombo = (s.type || "").toLowerCase() === "combo";
              return (
                <button
                  key={s.codigo}
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 border-b border-border/40 px-2.5 py-1.5 text-left last:border-0 hover:bg-accent/10"
                  onClick={() => elegir(s)}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] font-bold text-ink">{s.codigo}</span>
                    <span
                      className={`rounded px-1 py-px text-[8px] font-bold uppercase ${
                        esCombo
                          ? "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"
                          : "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100"
                      }`}
                    >
                      {esCombo ? "Combo" : "Producto"}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[10px] text-muted">{s.nombre}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Item contrast row ─────────────────────────────────────────────────────────

function ItemContrasteRow({
  sufijo,
  item,
  codigo,
  codigosManual,
  check,
  checked,
  disabled,
  onToggle,
  onCodeChange,
  onCodeCheck,
  onProductoCreado,
}: {
  sufijo: string;
  item: ItemFactura;
  codigo: string;
  codigosManual: Record<string, string>;
  check?: { codigo: string; existe_en_siigo: boolean; duplicado: boolean; siigo_producto: SiigoProducto | null };
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onCodeChange: (codigo: string) => void;
  onCodeCheck: (result: { codigo: string; existe_en_siigo: boolean; duplicado: boolean; siigo_producto: SiigoProducto | null }) => void;
  onProductoCreado: () => void;
}) {
  const checkCodigo = useMutation({
    mutationFn: (codigoActual: string) =>
      api.post<{ codigo: string; existe_en_siigo: boolean; duplicado: boolean; siigo_producto: SiigoProducto | null }>(
        "/api/facturas/codigo/check",
        { codigo: codigoActual },
      ),
    onSuccess: onCodeCheck,
  });
  const crearEnSiigo = useMutation({
    mutationFn: async () =>
      lanzarSiCrearProductosFallo(
        await api.post<CrearProductosResp>(`/api/facturas/${sufijo}/crear-productos`, {
          indices: [item.indice],
          codigos_manual: codigosManual,
        }),
      ),
    onSuccess: (res) => {
      if (res.creados?.[0]) {
        onProductoCreado();
        onCodeCheck({
          codigo,
          existe_en_siigo: true,
          duplicado: true,
          siigo_producto: res.creados[0].siigo_producto,
        });
      }
    },
  });
  const siigoProducto = check?.siigo_producto || item.siigo_producto || null;
  const existeEnSiigo = check?.existe_en_siigo ?? check?.duplicado ?? item.existe_en_siigo ?? item.duplicado;
  const crearError = crearEnSiigo.error as Error | undefined;

  function aplicarProductoExistente(sel: SiigoBusquedaItem) {
    onCodeChange(sel.codigo);
    onCodeCheck({
      codigo: sel.codigo,
      existe_en_siigo: true,
      duplicado: true,
      siigo_producto: {
        codigo: sel.codigo,
        nombre: sel.nombre,
        unidad: "",
        activo: true,
        type: sel.type,
      },
    });
  }

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-0 ${
      existeEnSiigo ? "bg-emerald-50/40 dark:bg-emerald-900/10" : checked ? "bg-accent/5" : ""
    }`}>
      {/* Columna proveedor */}
      <div className="flex gap-2 border-b lg:border-b-0 lg:border-r border-border/60 px-2.5 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          className="mt-0.5 shrink-0 accent-accent"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink leading-snug">{item.nombre}</p>
          <p className="mt-0.5 text-[10px] font-mono text-muted leading-relaxed">
            Cant <span className="text-ink">{item.cantidad_original} {item.unidad_original}</span>
            {" · "}P.prov <span className="text-ink">{cop(item.precio_proveedor)}</span>
            {" · "}Sub <span className="text-ink">{cop(item.subtotal)}</span>
            {item.iva > 0 && <>{" · "}IVA <span className="text-ink">{cop(item.iva)}</span></>}
            {item.referencia_proveedor && <>{" · "}Ref <span className="text-ink">{item.referencia_proveedor}</span></>}
            {item.multiplicador > 1 && (
              <span className="text-violet-600 dark:text-violet-400">{" · "}×{item.multiplicador}</span>
            )}
          </p>
        </div>
      </div>

      {/* Columna McKenna */}
      <div className="px-2.5 py-2 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {existeEnSiigo ? (
            <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-[9px] font-bold text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100">
              En SIIGO
              {(siigoProducto?.type || "").toLowerCase() === "combo" ? " · Combo" : ""}
            </span>
          ) : (
            <span className="rounded bg-sky-200 px-1.5 py-0.5 text-[9px] font-bold text-sky-900 dark:bg-sky-800 dark:text-sky-100">
              Producto nuevo
            </span>
          )}
          {item.codigo_por_referencia && (
            <span className="rounded bg-violet-200 px-1.5 py-0.5 text-[9px] font-bold text-violet-900 dark:bg-violet-800 dark:text-violet-100">
              Por ref.
            </span>
          )}
          <span className="text-[10px] font-mono text-muted">
            Sug. <span className="text-accent">{item.codigo_sugerido || item.codigo}</span>
            {" · "}{fmtDec(item.cantidad_min)} {item.unidad_min}
            {" · "}neto <span className="text-ink font-semibold">{cop(item.precio_neto)}</span>
            {" · "}venta <span className="text-ink">{cop(item.precio_unitario)}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            value={codigo}
            disabled={disabled}
            onChange={(e) => onCodeChange(e.target.value)}
            onBlur={() => { if (codigo.trim()) checkCodigo.mutate(codigo.trim()); }}
            className="min-w-[7rem] flex-1 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-accent"
            placeholder="Código SIIGO"
          />
          <button
            type="button"
            disabled={checkCodigo.isPending || !codigo.trim() || disabled}
            onClick={() => checkCodigo.mutate(codigo.trim())}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted hover:text-ink disabled:opacity-40"
          >
            {checkCodigo.isPending ? "…" : "Verificar"}
          </button>
          <SiigoBuscarPicker
            disabled={disabled}
            seedQuery={item.nombre || codigo}
            onSelect={aplicarProductoExistente}
          />
          {!existeEnSiigo && !disabled && (
            <button
              type="button"
              disabled={crearEnSiigo.isPending || !codigo.trim()}
              onClick={() => crearEnSiigo.mutate()}
              className="shrink-0 rounded-md bg-sky-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {crearEnSiigo.isPending ? "…" : "Crear SIIGO"}
            </button>
          )}
        </div>
        {siigoProducto && (
          <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-mono truncate">
            SIIGO: {siigoProducto.codigo} · {siigoProducto.nombre}
            {(siigoProducto.type || "").toLowerCase() === "combo" ? " (combo)" : ""}
          </p>
        )}
        {crearError && (
          <p className="text-[10px] text-red-400">{crearError.message}</p>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FacturasCompraPanel() {
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<EscanearResultado | null>(null);
  const [vista, setVista] = useState<VistaFacturas>("pendientes");
  const [filtroHistorial, setFiltroHistorial] = useState("");
  const [accionHistorial, setAccionHistorial] = useState("");
  const [historialAbierto, setHistorialAbierto] = useState<string | null>(null);
  const qc = useQueryClient();
  const facturasBootSufijo = useAppStore((s) => s.facturasBootSufijo);
  const setFacturasBootSufijo = useAppStore((s) => s.setFacturasBootSufijo);
  const facturasBootVista = useAppStore((s) => s.facturasBootVista);
  const setFacturasBootVista = useAppStore((s) => s.setFacturasBootVista);

  useEffect(() => {
    if (!facturasBootSufijo) return;
    setVista("pendientes");
    setDetalleAbierto(facturasBootSufijo);
    setFacturasBootSufijo(null);
  }, [facturasBootSufijo, setFacturasBootSufijo]);

  useEffect(() => {
    if (!facturasBootVista) return;
    // Consultar factura vive en el FAB del cabezote, no en este panel.
    if (facturasBootVista === "consultar") {
      setVista("pendientes");
      return;
    }
    setVista(facturasBootVista);
    setDetalleAbierto(null);
  }, [facturasBootVista]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["facturas-pendientes"],
    queryFn: () => api.get<{ pendientes: FacturaSummary[]; total: number }>("/api/facturas/pendientes"),
    refetchInterval: 15_000,
  });

  const escanear = useMutation({
    mutationFn: () => api.post<EscanearResultado>("/api/facturas/escanear", {}),
    onSuccess: (res) => {
      setScanResult(res);
      setVista("pendientes");
      qc.invalidateQueries({ queryKey: ["facturas-pendientes"] });
      if (res.encoladas?.length === 1) {
        setDetalleAbierto(res.encoladas[0].sufijo);
      }
    },
  });

  const historialQuery = useQuery({
    queryKey: ["facturas-historial", accionHistorial, filtroHistorial, new Date().getFullYear()],
    queryFn: () => {
      const anio = new Date().getFullYear();
      const params = new URLSearchParams({ limit: "100", anio: String(anio) });
      if (accionHistorial) params.set("accion", accionHistorial);
      if (filtroHistorial.trim()) params.set("q", filtroHistorial.trim());
      return api.get<{ historial: FacturaHistorial[]; total: number; mostrando: number; anio?: number }>(
        `/api/facturas/historial?${params.toString()}`,
      );
    },
    enabled: vista === "historial",
    staleTime: 30_000,
  });

  const pendientes = data?.pendientes ?? [];
  const total = data?.total ?? 0;
  const historial = historialQuery.data?.historial ?? [];
  const handleDone = useCallback(async (sufijoActual: string) => {
    setDetalleAbierto(null);
    await qc.invalidateQueries({ queryKey: ["facturas-pendientes"] });
    await qc.invalidateQueries({ queryKey: ["facturas-historial"] });
    const fresh = qc.getQueryData<{ pendientes: FacturaSummary[] }>(["facturas-pendientes"]);
    const restantes = (fresh?.pendientes ?? pendientes).filter((p) => p.sufijo !== sufijoActual);
    if (restantes.length > 0) {
      setDetalleAbierto(restantes[0].sufijo);
    }
  }, [qc, pendientes]);

  const idxDetalle = detalleAbierto
    ? pendientes.findIndex((p) => p.sufijo === detalleAbierto)
    : -1;
  const hayAnterior = idxDetalle > 0;
  const haySiguiente = idxDetalle >= 0 && idxDetalle < pendientes.length - 1;
  const posicionDetalle =
    idxDetalle >= 0 ? `${idxDetalle + 1} de ${pendientes.length}` : undefined;

  if (detalleAbierto) {
    return (
      <DetalleFactura
        key={detalleAbierto}
        sufijo={detalleAbierto}
        onBack={() => setDetalleAbierto(null)}
        onDone={(s) => void handleDone(s)}
        hayAnterior={hayAnterior}
        haySiguiente={haySiguiente}
        posicion={posicionDetalle}
        onAnterior={() => {
          if (hayAnterior) setDetalleAbierto(pendientes[idxDetalle - 1].sufijo);
        }}
        onSiguiente={() => {
          if (haySiguiente) setDetalleAbierto(pendientes[idxDetalle + 1].sufijo);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setVista("pendientes");
              setFacturasBootVista("pendientes");
            }}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              vista === "pendientes"
                ? "bg-accent text-white"
                : "border border-border bg-surface-panel text-muted hover:text-ink"
            }`}
          >
            Pendientes{total > 0 ? ` (${total})` : ""}
          </button>
          <button
            type="button"
            onClick={() => {
              setVista("historial");
              setFacturasBootVista("historial");
            }}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              vista === "historial"
                ? "bg-accent text-white"
                : "border border-border bg-surface-panel text-muted hover:text-ink"
            }`}
          >
            Historial
          </button>
        </div>

        {vista === "pendientes" && (
          <button
            type="button"
            onClick={() => escanear.mutate()}
            disabled={escanear.isPending}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {escanear.isPending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Escaneando…
              </>
            ) : (
              <>Escanear Gmail</>
            )}
          </button>
        )}
      </div>

      {vista === "historial" ? (
        <HistorialFacturas
          items={historial}
          total={historialQuery.data?.total ?? 0}
          loading={historialQuery.isLoading}
          error={historialQuery.error instanceof Error ? historialQuery.error.message : null}
          filtro={filtroHistorial}
          accion={accionHistorial}
          abierto={historialAbierto}
          onFiltroChange={setFiltroHistorial}
          onAccionChange={setAccionHistorial}
          onToggle={(id) => setHistorialAbierto((prev) => (prev === id ? null : id))}
          onRefresh={() => historialQuery.refetch()}
        />
      ) : (
        <>
          {scanResult && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                scanResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}
            >
              <p className="font-medium">{scanResult.mensaje}</p>
              <p className="mt-1 text-[11px] opacity-80">
                Correos: {scanResult.correos_revisados ?? 0}
                {" · "}nuevas: {scanResult.encoladas?.length ?? 0}
                {" · "}historial: {scanResult.ya_en_historial?.length ?? 0}
                {" · "}cola: {scanResult.ya_en_cola?.length ?? 0}
                {" · "}omitidas: {scanResult.omitidas?.length ?? 0}
              </p>
              {(scanResult.encoladas?.length > 0 || scanResult.omitidas?.length > 0) && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-xs opacity-90">
                  {scanResult.encoladas?.map((f) => (
                    <li key={f.sufijo}>
                      + {f.numero_factura} — {f.proveedor} ({cop(f.total)})
                    </li>
                  ))}
                  {scanResult.omitidas?.slice(0, 8).map((o) => (
                    <li key={o.numero_factura}>
                      ⏭ {o.numero_factura} — {o.motivo}
                    </li>
                  ))}
                  {(scanResult.omitidas?.length ?? 0) > 8 && (
                    <li>… y {(scanResult.omitidas?.length ?? 0) - 8} omitida(s) más</li>
                  )}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-ink">
                {total > 0 ? "Por revisar" : "Cola vacía"}
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {total > 0
                  ? "Abre una factura, contrasta con SIIGO y confirma inventario, gasto u omitir."
                  : "Nada se registra en SIIGO sin tu aprobación. Escanea Gmail para traer compras nuevas."}
              </p>
            </div>
            {total > 0 && (
              <button
                type="button"
                onClick={() => refetch()}
                className="shrink-0 text-xs font-semibold text-muted hover:text-accent"
              >
                Actualizar
              </button>
            )}
          </div>

          {isLoading && (
            <p className="py-12 text-center text-sm text-muted">Cargando cola…</p>
          )}

          {!isLoading && pendientes.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-surface-panel/50 px-6 py-14 text-center">
              <p className="text-base font-semibold text-ink">Sin facturas pendientes</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                Usa <span className="font-semibold text-ink">Escanear Gmail</span> para encolar
                facturas del label FACTURAS-MCKG.
              </p>
              <button
                type="button"
                onClick={() => escanear.mutate()}
                disabled={escanear.isPending}
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-bold text-accent hover:bg-accent/15 disabled:opacity-50"
              >
                {escanear.isPending ? "Escaneando…" : "Escanear ahora"}
              </button>
            </div>
          )}

          {pendientes.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {pendientes.map((f) => (
                <FacturaCard
                  key={f.sufijo}
                  f={f}
                  active={false}
                  onOpen={setDetalleAbierto}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HistorialFacturas({
  items,
  total,
  loading,
  error,
  filtro,
  accion,
  abierto,
  onFiltroChange,
  onAccionChange,
  onToggle,
  onRefresh,
}: {
  items: FacturaHistorial[];
  total: number;
  loading: boolean;
  error: string | null;
  filtro: string;
  accion: string;
  abierto: string | null;
  onFiltroChange: (v: string) => void;
  onAccionChange: (v: string) => void;
  onToggle: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Historial de facturas</h2>
            <p className="mt-1 text-sm text-muted">
              Solo {new Date().getFullYear()}: inventario, gasto u omitidas (fecha de factura).
            </p>
          </div>
          <button type="button" onClick={onRefresh} className="text-xs text-muted hover:text-accent">
            Actualizar
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type="search"
            value={filtro}
            onChange={(e) => onFiltroChange(e.target.value)}
            placeholder="Buscar factura, proveedor o producto…"
            className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <select
            value={accion}
            onChange={(e) => onAccionChange(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="">Todas las acciones</option>
            <option value="inventario">Inventario</option>
            <option value="gasto">Gasto SIIGO</option>
            <option value="omitida">Omitidas</option>
          </select>
        </div>
      </div>

      {loading && <p className="text-sm text-muted text-center py-10">Cargando historial…</p>}

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          No se pudo cargar el historial: {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
          <p className="text-base font-semibold text-ink">Sin registros en el historial</p>
          <p className="text-sm text-muted mt-2">
            Las facturas aparecerán aquí al confirmar inventario, registrar gasto u omitir.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {items.map((row) => {
          const acc = ACCION_HISTORIAL[row.accion] || { label: row.accion, cls: "bg-surface-hover text-muted" };
          const expandido = abierto === row.id;
          return (
            <div key={row.id} className="rounded-xl border border-border bg-surface-panel overflow-hidden">
              <button
                type="button"
                onClick={() => onToggle(row.id)}
                className="w-full px-4 py-3 text-left hover:bg-surface-hover/60 transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-ink">{row.numero_factura}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${acc.cls}`}>
                        {acc.label}
                      </span>
                      {row.estado === "error" && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800 dark:bg-red-900/40 dark:text-red-200">
                          Error
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-secondary truncate">{row.proveedor}</p>
                    <p className="text-[11px] text-muted font-mono mt-0.5">
                      {fmtFecha(row.timestamp)}
                      {row.fecha_factura ? ` · Factura ${row.fecha_factura}` : ""}
                      {row.origen ? ` · ${row.origen}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-ink">{cop(row.total)}</p>
                    <p className="text-[10px] text-muted">{row.items_count ?? 0} ítems</p>
                  </div>
                </div>
              </button>
              {expandido && (
                <div className="border-t border-border px-4 py-3 space-y-3 bg-surface/40">
                  {(row.nuevos ?? 0) > 0 || (row.en_siigo ?? 0) > 0 ? (
                    <p className="text-xs text-muted">
                      {row.nuevos ?? 0} producto(s) nuevo(s) · {row.en_siigo ?? 0} ya en SIIGO
                    </p>
                  ) : null}
                  {row.siigo_id && (
                    <p className="text-xs font-mono text-muted">ID SIIGO: {row.siigo_id}</p>
                  )}
                  {(row.ruta_excel || row.ruta_xml) && (
                    <div className="text-xs font-mono text-muted space-y-0.5">
                      {row.ruta_excel && <p>Excel: {row.ruta_excel}</p>}
                      {row.ruta_xml && <p>XML: {row.ruta_xml}</p>}
                    </div>
                  )}
                  {row.mensaje && <p className="text-xs text-muted">{row.mensaje}</p>}
                  {(row.items_resumen?.length ?? 0) > 0 && (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted bg-surface-hover">
                        Ítems procesados · precio unitario vs compra anterior
                      </div>
                      <div className="divide-y divide-border/60 max-h-72 overflow-y-auto">
                        {row.items_resumen!.map((it, i) => (
                          <div key={i} className="px-3 py-2.5 space-y-1.5">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold text-ink leading-snug">{it.nombre}</p>
                                <p className="text-[10px] font-mono text-muted">{it.codigo}</p>
                              </div>
                              <BadgeTendenciaPrecio
                                tendencia={it.tendencia_precio}
                                variacion={it.variacion_pct}
                              />
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[10px] font-mono">
                              {it.cantidad_min != null && (
                                <span className="text-muted">
                                  Cant: <span className="text-ink">{fmtDec(it.cantidad_min)} {it.unidad_min}</span>
                                </span>
                              )}
                              {it.precio_neto != null && it.precio_neto > 0 && (
                                <span className="text-muted">
                                  Neto: <span className="text-ink font-semibold">{copUnit(it.precio_neto, it.unidad_min)}</span>
                                </span>
                              )}
                              {it.precio_unitario != null && it.precio_unitario > 0 && (
                                <span className="text-muted">
                                  c/IVA: <span className="text-ink">{copUnit(it.precio_unitario, it.unidad_min)}</span>
                                </span>
                              )}
                              {it.precio_anterior != null && it.precio_anterior > 0 && (
                                <span className="text-muted">
                                  Ant.: <span className="text-ink">{copUnit(it.precio_anterior, it.unidad_min)}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {total > items.length && (
        <p className="text-center text-xs text-muted">
          Mostrando {items.length} de {total} registros
        </p>
      )}
    </div>
  );
}

export function ConsultarFacturaPorProducto({
  onAbrirPendiente,
  compact = false,
}: {
  onAbrirPendiente?: (sufijo: string) => void;
  /** Sin tarjeta de título (para usar dentro de un modal). */
  compact?: boolean;
}) {
  const ANIO_MIN = 2022;
  const ANIO_MAX = new Date().getFullYear();
  const ANIOS = Array.from({ length: ANIO_MAX - ANIO_MIN + 1 }, (_, i) => String(ANIO_MIN + i));

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [anio, setAnio] = useState<"todos" | string>("todos");
  const [indiceMsg, setIndiceMsg] = useState<string | null>(null);
  const [indiceLoading, setIndiceLoading] = useState(false);
  const autoIndexRef = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 320);
    return () => window.clearTimeout(t);
  }, [q]);

  const anioParam = anio === "todos" ? "" : `&anio=${anio}`;

  const consulta = useQuery({
    queryKey: ["facturas-consultar", debounced, anio],
    queryFn: () =>
      api.get<{
        ok: boolean;
        q: string;
        anio?: number | null;
        anio_min?: number;
        resultados: FacturaConsultaResultado[];
        total: number;
        mostrando: number;
        mensaje?: string;
        avisos?: string[];
        indices?: Record<string, { listo?: boolean; facturas?: number; actualizado?: string | null }>;
      }>(`/api/facturas/consultar?q=${encodeURIComponent(debounced)}&limit=50${anioParam}`, {
        timeoutMs: 180_000,
      }),
    enabled: debounced.length >= 2,
    staleTime: 20_000,
  });

  const cargarArchivo = useCallback(async () => {
    setIndiceLoading(true);
    setIndiceMsg(null);
    try {
      const body =
        anio === "todos"
          ? { rango: true, desde: ANIO_MIN, forzar: true }
          : { anio: Number(anio), forzar: true };
      const res = await api.post<{
        ok?: boolean;
        facturas?: number;
        mensaje?: string;
        error?: string;
        anios?: number[];
      }>("/api/facturas/consultar/indice", body, { timeoutMs: 600_000 });
      setIndiceMsg(
        res.mensaje
          || (anio === "todos"
            ? `Índices ${ANIO_MIN}–${ANIO_MAX}: ${res.facturas ?? 0} factura(s).`
            : `Índice ${anio}: ${res.facturas ?? 0} factura(s).`),
      );
      if (debounced.length >= 2) {
        await consulta.refetch();
      }
    } catch (e) {
      setIndiceMsg((e as Error).message || "No se pudo cargar el archivo de facturas");
    } finally {
      setIndiceLoading(false);
    }
  }, [anio, debounced.length, consulta, ANIO_MIN, ANIO_MAX]);

  // Si falta índice al buscar, indexar una sola vez en segundo plano.
  useEffect(() => {
    if (autoIndexRef.current || indiceLoading) return;
    const avisos = consulta.data?.avisos ?? [];
    const falta = avisos.some((a) => /falta indexar|aún no hay índice|falta índice/i.test(a));
    if (!falta || debounced.length < 2) return;
    autoIndexRef.current = true;
    void cargarArchivo();
  }, [consulta.data?.avisos, debounced.length, indiceLoading, cargarArchivo]);

  const resultados = consulta.data?.resultados ?? [];
  const avisos = consulta.data?.avisos ?? [];
  const indices = consulta.data?.indices ?? {};
  const indicesListos = Object.entries(indices)
    .filter(([, v]) => v?.listo)
    .map(([k, v]) => `${k}: ${v.facturas ?? 0}`)
    .join(" · ");
  const btnArchivoLabel =
    anio === "todos"
      ? `Cargar archivo ${ANIO_MIN}–${ANIO_MAX}`
      : `Cargar archivo ${anio}`;

  return (
    <div className="space-y-4">
      <div className={compact ? "space-y-3" : "rounded-xl border-2 border-border bg-surface-panel p-4"}>
        {!compact && (
          <>
            <h2 className="text-lg font-bold text-ink">Consultar factura</h2>
            <p className="mt-1 text-sm text-muted">
              Busca facturas de proveedores por nombre o código (pendientes, historial y archivo desde {ANIO_MIN}).
            </p>
          </>
        )}
        {compact && (
          <p className="text-sm text-muted">
            Busca por nombre o código en facturas de proveedores (archivo desde {ANIO_MIN}).
          </p>
        )}
        <div className={`flex flex-wrap gap-1 ${compact ? "" : "mt-3"}`}>
          {[{ id: "todos" as const, label: "Todos" }, ...ANIOS.map((y) => ({ id: y, label: y }))].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setAnio(opt.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                anio === opt.id
                  ? "bg-accent text-white"
                  : "border border-border bg-surface text-muted hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void cargarArchivo()}
            disabled={indiceLoading}
            className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-800 hover:border-orange-500 disabled:opacity-50 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200"
            title={
              anio === "todos"
                ? `Indexa facturas ${ANIO_MIN}–${ANIO_MAX} desde Gmail/local`
                : `Indexa facturas ${anio} desde Gmail/local`
            }
          >
            {indiceLoading ? "Indexando…" : btnArchivoLabel}
          </button>
        </div>
        {(indiceMsg || indicesListos) && (
          <p className="text-[11px] text-muted">
            {indiceMsg || (indicesListos ? `Archivo listo · ${indicesListos}` : null)}
          </p>
        )}
        <div className={compact ? "flex flex-wrap gap-2" : "mt-3 flex flex-wrap gap-2"}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ej. creatina, mentol, ALULOSA…"
            autoFocus
            className="min-w-[240px] flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        {debounced.length > 0 && debounced.length < 2 && (
          <p className="mt-2 text-xs text-muted">Escribe al menos 2 caracteres.</p>
        )}
      </div>

      {consulta.isFetching && (
        <p className="text-sm text-muted text-center py-8">Buscando…</p>
      )}

      {consulta.error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {consulta.error instanceof Error ? consulta.error.message : "Error al consultar"}
        </div>
      )}

      {avisos.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <p>{avisos[0]}</p>
          {/falta indexar|aún no hay índice|falta índice|cargar archivo/i.test(avisos[0]) && (
            <button
              type="button"
              onClick={() => void cargarArchivo()}
              disabled={indiceLoading}
              className="mt-2 rounded-lg border border-amber-500/50 bg-amber-100/80 px-3 py-1.5 text-[11px] font-bold text-amber-950 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/50 dark:text-amber-50"
            >
              {indiceLoading ? "Indexando archivo…" : btnArchivoLabel}
            </button>
          )}
        </div>
      )}

      {!consulta.isFetching && debounced.length >= 2 && !consulta.error && resultados.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
          <p className="text-base font-semibold text-ink">Sin coincidencias</p>
          <p className="mt-1 text-sm text-muted">
            No hay facturas{anio !== "todos" ? ` de ${anio}` : ""} con producto que coincida con «{debounced}».
            {" "}
            Si faltan años antiguos, pulsa <strong>{btnArchivoLabel}</strong>.
          </p>
        </div>
      )}

      {debounced.length < 2 && !consulta.isFetching && (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted">
            Escribe el nombre del producto para ver en qué facturas de proveedores aparece.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {resultados.map((row) => {
          const expandido = abierto === row.id;
          const origen = String(row.origen || "");
          const anioArchivo = origen.match(/(?:gmail|archivo)-(\d{4})/)?.[1];
          const acc =
            origen === "pendiente"
              ? { label: "En cola", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" }
              : origen.startsWith("gmail-") || origen.startsWith("archivo-")
                ? {
                    label: anioArchivo ? `Archivo ${anioArchivo}` : "Archivo",
                    cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
                  }
                : ACCION_HISTORIAL[row.accion || ""] || {
                    label: row.accion || "Historial",
                    cls: "bg-surface-hover text-muted",
                  };
          return (
            <div key={row.id} className="rounded-xl border border-border bg-surface-panel overflow-hidden">
              <button
                type="button"
                onClick={() => setAbierto((prev) => (prev === row.id ? null : row.id))}
                className="w-full px-4 py-3 text-left hover:bg-surface-hover/60 transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-ink">{row.numero_factura}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${acc.cls}`}>
                        {acc.label}
                      </span>
                      {row.sufijo && (
                        <span className="font-mono text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                          #{row.sufijo}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-secondary truncate">{row.proveedor}</p>
                    <p className="text-[11px] text-muted mt-0.5">
                      {row.coincidencias.length} producto(s) coincidente(s)
                      {row.fecha ? ` · ${row.fecha}` : ""}
                      {row.timestamp ? ` · ${fmtFecha(row.timestamp)}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-ink">{cop(Number(row.total) || 0)}</p>
                    <p className="text-[10px] text-muted">{row.items_count ?? 0} ítems</p>
                  </div>
                </div>
              </button>
              {expandido && (
                <div className="border-t border-border px-4 py-3 space-y-3 bg-surface/40">
                  {row.origen === "pendiente" && row.sufijo && onAbrirPendiente && (
                    <button
                      type="button"
                      onClick={() => onAbrirPendiente(row.sufijo)}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white"
                    >
                      Abrir factura pendiente
                    </button>
                  )}
                  <div className="max-h-[min(50vh,420px)] overflow-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 border-b border-border bg-surface-hover text-[10px] font-bold uppercase tracking-wide text-muted [&_th]:sticky [&_th]:top-0 [&_th]:bg-surface-hover">
                        <tr>
                          <th className="px-3 py-2 text-left">Producto</th>
                          <th className="px-3 py-2 text-left">Código</th>
                          <th className="px-3 py-2 text-right">Cant.</th>
                          <th className="px-3 py-2 text-right">Precio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {row.coincidencias.map((c, i) => (
                          <tr key={`${c.nombre}-${i}`} className="border-b border-border/50 last:border-0">
                            <td className="px-3 py-2 text-ink font-medium">{c.nombre}</td>
                            <td className="px-3 py-2 font-mono text-muted">{c.codigo || "—"}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted">
                              {c.cantidad != null
                                ? `${fmtDec(Number(c.cantidad))} ${c.unidad || ""}`.trim()
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-ink">
                              {c.precio_neto != null && Number(c.precio_neto) > 0
                                ? copUnit(Number(c.precio_neto), c.unidad)
                                : c.precio_unitario != null && Number(c.precio_unitario) > 0
                                  ? copUnit(Number(c.precio_unitario), c.unidad)
                                  : c.subtotal != null
                                    ? cop(Number(c.subtotal))
                                    : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(consulta.data?.total ?? 0) > resultados.length && (
        <p className="text-center text-xs text-muted">
          Mostrando {resultados.length} de {consulta.data?.total} facturas
        </p>
      )}
    </div>
  );
}

