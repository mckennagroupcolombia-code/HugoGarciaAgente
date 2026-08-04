import { useState, useCallback, useEffect } from "react";
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
  encoladas: Array<{
    sufijo: string;
    numero_factura: string;
    proveedor: string;
    total: number;
    items_count: number;
    es_nuevo_proveedor: boolean;
  }>;
  ya_en_cola: Array<{ numero_factura: string; proveedor: string }>;
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

const STEPS = [
  { n: 1, label: "Escanear Gmail", hint: "Traer facturas nuevas del correo" },
  { n: 2, label: "Revisar factura", hint: "Contrastar datos proveedor vs McKenna" },
  { n: 3, label: "Confirmar", hint: "Inventario, gasto u omitir" },
];

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
      <div className="flex gap-4 text-xs text-muted font-mono">
        <span>{f.items_count} ítem{f.items_count !== 1 ? "s" : ""}</span>
        <span className="text-ink font-semibold">{cop(f.total)}</span>
      </div>
    </button>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────────

function DetalleFactura({
  sufijo,
  onBack,
  onDone,
}: {
  sufijo: string;
  onBack: () => void;
  onDone: (sufijo: string) => void;
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
    <div className="space-y-4">
      {/* Header factura */}
      <div className="rounded-xl border-2 border-border bg-surface-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button type="button" onClick={onBack} className="mb-2 text-xs text-muted hover:text-accent">
              ← Todas las pendientes
            </button>
            <h2 className="text-lg font-bold text-ink">{detalle.numero_factura}</h2>
            <p className="text-sm font-medium text-ink-secondary">{detalle.proveedor}</p>
            <p className="mt-1 text-xs text-muted font-mono">
              {detalle.nit && <>NIT {detalle.nit} · </>}
              {detalle.fecha && <>Fecha {detalle.fecha} · </>}
              Código #{detalle.sufijo}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-muted">Total neto factura</p>
            <p className="text-2xl font-bold text-ink">{cop(detalle.total_neto)}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Subtotal", val: cop(detalle.total_bruto) },
            { label: "Descuentos", val: cop(detalle.total_descuentos) },
            { label: "Ítems", val: String(detalle.items.length) },
            { label: "Estado", val: detalle.es_nuevo_proveedor ? "Proveedor nuevo" : "Proveedor conocido" },
          ].map(({ label, val }) => (
            <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-[10px] text-muted uppercase">{label}</p>
              <p className="text-sm font-semibold text-ink">{val}</p>
            </div>
          ))}
        </div>
      </div>

      {facturaYaRegistrada && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm font-bold text-red-300">Ya registrada en SIIGO</p>
          <p className="mt-1 text-xs text-muted">
            Documento: <span className="font-mono text-ink">{facturaYaRegistrada.name || facturaYaRegistrada.id}</span>
            {facturaYaRegistrada.fecha ? ` · ${facturaYaRegistrada.fecha}` : ""}
          </p>
          <button
            type="button"
            disabled={clasificar.isPending}
            onClick={() => clasificar.mutate("skip")}
            className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-xs font-bold text-red-200 hover:bg-red-500/30 disabled:opacity-50"
          >
            Omitir de la cola
          </button>
        </div>
      )}

      {detalle.es_nuevo_proveedor && !bloqueado && (
        <label className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 cursor-pointer text-sm text-amber-900 dark:text-amber-200">
          <input
            type="checkbox"
            checked={agregarProveedor}
            onChange={(e) => setAgregarProveedor(e.target.checked)}
            className="accent-amber-500"
          />
          Agregar <strong>{detalle.proveedor}</strong> a proveedores de materias primas
        </label>
      )}

      {/* Tabla contraste proveedor ↔ McKenna */}
      <div className="rounded-xl border-2 border-border overflow-hidden">
        <div className="grid grid-cols-2 border-b border-border bg-surface-hover text-[10px] font-bold uppercase tracking-wide">
          <div className="px-4 py-2 text-muted border-r border-border">Datos del proveedor (XML)</div>
          <div className="px-4 py-2 text-accent">Propuesta McKenna → SIIGO</div>
        </div>

        <div className="flex items-center gap-3 border-b border-border bg-surface-panel px-4 py-2">
          <input
            type="checkbox"
            checked={selCount === detalle.items.length && detalle.items.length > 0}
            onChange={toggleAll}
            disabled={bloqueado}
            className="accent-accent"
          />
          <span className="text-xs text-muted">
            {selCount} de {detalle.items.length} ítems seleccionados para inventariar
          </span>
        </div>

        <div className="divide-y divide-border/60 max-h-[min(58vh,520px)] overflow-y-auto">
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

      {/* Acciones humanas */}
      <div className="sticky bottom-0 z-10 rounded-xl border-2 border-border bg-surface-panel/95 backdrop-blur p-4 shadow-lg">
        <p className="mb-3 text-xs text-muted">
          Revisa línea a línea antes de confirmar. Los <strong className="text-ink">productos nuevos</strong> puedes crearlos en SIIGO desde cada línea o en lote.
          <strong className="text-ink"> Inventario</strong> genera XML de compra (y Excel solo si quedan productos sin crear).
          <strong className="text-ink"> Gasto</strong> registra la factura completa como costo. <strong className="text-ink">Omitir</strong> descarta sin registrar.
        </p>
        {(crearProductos.error || crearProductos.data?.errores?.length) && (
          <p className="mb-2 text-xs text-red-400">
            {(crearProductos.error as Error)?.message
              || crearProductos.data?.errores?.map((e) => e.error).join(" · ")}
          </p>
        )}
        {crearProductos.data?.mensaje && crearProductos.isSuccess && (
          <p className="mb-2 text-xs text-emerald-600 dark:text-emerald-300">
            {crearProductos.data.mensaje}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {nuevosCount > 0 && (
            <button
              type="button"
              disabled={bloqueado || crearProductos.isPending}
              onClick={() => crearProductos.mutate(itemsNuevos.map((i) => i.indice))}
              className="rounded-xl border-2 border-sky-500/50 bg-sky-500/10 px-4 py-3 text-sm font-bold text-sky-800 dark:text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
            >
              {crearProductos.isPending
                ? "Creando en SIIGO…"
                : `Crear ${nuevosCount} producto${nuevosCount !== 1 ? "s" : ""} nuevo${nuevosCount !== 1 ? "s" : ""} en SIIGO`}
            </button>
          )}
          <button
            type="button"
            disabled={bloqueado || selCount === 0 || procesar.isPending}
            onClick={() => procesar.mutate()}
            className="flex-1 min-w-[200px] rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40 transition"
          >
            {procesar.isPending
              ? "Generando archivos…"
              : `Confirmar inventario (${selCount} ítem${selCount !== 1 ? "s" : ""})`}
          </button>
          <button
            type="button"
            disabled={bloqueado || clasificar.isPending}
            onClick={() => clasificar.mutate("gasto")}
            className="rounded-xl border-2 border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
          >
            Registrar como gasto
          </button>
          <button
            type="button"
            disabled={clasificar.isPending}
            onClick={() => clasificar.mutate("skip")}
            className="rounded-xl border-2 border-border px-4 py-3 text-sm font-semibold text-muted hover:text-ink disabled:opacity-40"
          >
            Omitir factura
          </button>
        </div>
        {(procesar.error || clasificar.error) && (
          <p className="mt-2 text-xs text-red-400">{(procesar.error as Error)?.message || (clasificar.error as Error)?.message}</p>
        )}
      </div>
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

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-0 ${
      existeEnSiigo ? "bg-emerald-50/40 dark:bg-emerald-900/10" : checked ? "bg-accent/5" : ""
    }`}>
      {/* Columna proveedor */}
      <div className="flex gap-3 border-b lg:border-b-0 lg:border-r border-border/60 p-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          className="mt-1 shrink-0 accent-accent"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-ink leading-snug">{item.nombre}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-mono text-muted">
            <span>Cant: <span className="text-ink">{item.cantidad_original} {item.unidad_original}</span></span>
            <span>Subtotal: <span className="text-ink">{cop(item.subtotal)}</span></span>
            <span>P. proveedor: <span className="text-ink">{cop(item.precio_proveedor)}</span></span>
            {item.referencia_proveedor && (
              <span className="col-span-2">Ref. proveedor: <span className="text-ink">{item.referencia_proveedor}</span></span>
            )}
            {item.iva > 0 && <span>IVA: <span className="text-ink">{cop(item.iva)}</span></span>}
            {item.multiplicador > 1 && (
              <span className="col-span-2 text-violet-600 dark:text-violet-400">× {item.multiplicador} por empaque</span>
            )}
          </div>
        </div>
      </div>

      {/* Columna McKenna */}
      <div className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {existeEnSiigo ? (
            <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100">
              En SIIGO — suma inventario
            </span>
          ) : (
            <span className="rounded-full bg-sky-200 px-2 py-0.5 text-[10px] font-bold text-sky-900 dark:bg-sky-800 dark:text-sky-100">
              Producto nuevo
            </span>
          )}
          {item.codigo_por_referencia && (
            <span className="rounded-full bg-violet-200 px-2 py-0.5 text-[10px] font-bold text-violet-900 dark:bg-violet-800 dark:text-violet-100">
              Código por referencia
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={codigo}
            disabled={disabled}
            onChange={(e) => onCodeChange(e.target.value)}
            onBlur={() => { if (codigo.trim()) checkCodigo.mutate(codigo.trim()); }}
            className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
            placeholder="Código SIIGO"
          />
          <button
            type="button"
            disabled={checkCodigo.isPending || !codigo.trim() || disabled}
            onClick={() => checkCodigo.mutate(codigo.trim())}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-semibold text-muted hover:text-ink disabled:opacity-40"
          >
            {checkCodigo.isPending ? "…" : "Verificar"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-mono text-muted">
          <span>Sugerido: <span className="text-accent">{item.codigo_sugerido || item.codigo}</span></span>
          <span>Unidad min: <span className="text-ink">{fmtDec(item.cantidad_min)} {item.unidad_min}</span></span>
          <span>P. neto: <span className="text-ink font-semibold">{cop(item.precio_neto)}</span></span>
          <span>P. venta: <span className="text-ink">{cop(item.precio_unitario)}</span></span>
        </div>
        {siigoProducto && (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono truncate">
            SIIGO: {siigoProducto.codigo} · {siigoProducto.nombre}
          </p>
        )}
        {!existeEnSiigo && !disabled && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={crearEnSiigo.isPending || !codigo.trim()}
              onClick={() => crearEnSiigo.mutate()}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {crearEnSiigo.isPending ? "Creando…" : "Crear en SIIGO"}
            </button>
            <span className="text-[10px] text-muted">
              Precio venta estimado: {cop(Math.round(item.precio_unitario * 1.3))}
            </span>
          </div>
        )}
        {crearError && (
          <p className="text-[11px] text-red-400">{crearError.message}</p>
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
    queryKey: ["facturas-historial", accionHistorial, filtroHistorial],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (accionHistorial) params.set("accion", accionHistorial);
      if (filtroHistorial.trim()) params.set("q", filtroHistorial.trim());
      return api.get<{ historial: FacturaHistorial[]; total: number; mostrando: number }>(
        `/api/facturas/historial?${params.toString()}`,
      );
    },
    enabled: vista === "historial",
    staleTime: 30_000,
  });

  const pendientes = data?.pendientes ?? [];
  const total = data?.total ?? 0;
  const historial = historialQuery.data?.historial ?? [];
  const pasoActual = detalleAbierto ? 2 : total > 0 ? 2 : 1;

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

  if (detalleAbierto) {
    return (
      <div className="space-y-4">
        <Stepper paso={3} />
        <DetalleFactura
          sufijo={detalleAbierto}
          onBack={() => setDetalleAbierto(null)}
          onDone={(s) => void handleDone(s)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
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
      <Stepper paso={pasoActual} />

      <div className="rounded-xl border-2 border-border bg-surface-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Facturas de compra</h2>
            <p className="mt-1 text-sm text-muted max-w-xl">
              Escanea Gmail, revisa cada factura contrastando los datos del proveedor con la propuesta McKenna,
              y confirma una a una. No se registra nada en SIIGO sin tu aprobación.
            </p>
          </div>
          <button
            type="button"
            onClick={() => escanear.mutate()}
            disabled={escanear.isPending}
            className="shrink-0 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {escanear.isPending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Escaneando Gmail…
              </>
            ) : (
              <>Escanear facturas en Gmail</>
            )}
          </button>
        </div>

        {scanResult && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            scanResult.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}>
            <p className="font-medium">{scanResult.mensaje}</p>
            {(scanResult.encoladas?.length > 0 || scanResult.omitidas?.length > 0) && (
              <ul className="mt-2 space-y-1 text-xs font-mono opacity-90">
                {scanResult.encoladas?.map((f) => (
                  <li key={f.sufijo}>+ {f.numero_factura} — {f.proveedor} ({cop(f.total)})</li>
                ))}
                {scanResult.omitidas?.slice(0, 5).map((o) => (
                  <li key={o.numero_factura}>⏭ {o.numero_factura} — {o.motivo}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">
          Pendientes de revisión
          {total > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
              {total}
            </span>
          )}
        </h3>
        <button type="button" onClick={() => refetch()} className="text-xs text-muted hover:text-accent">
          Actualizar listado
        </button>
      </div>

      {isLoading && (
        <p className="text-sm text-muted text-center py-12">Cargando cola…</p>
      )}

      {!isLoading && pendientes.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
          <p className="text-4xl mb-3">📬</p>
          <p className="text-base font-semibold text-ink">Sin facturas pendientes</p>
          <p className="text-sm text-muted mt-2 max-w-md mx-auto">
            Pulsa <strong>Escanear facturas en Gmail</strong> para traer compras nuevas del label FACTURAS-MCKG.
          </p>
        </div>
      )}

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
              Facturas procesadas desde el panel o WhatsApp: inventario, gasto u omitidas.
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
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [anio, setAnio] = useState<"todos" | "2025" | "2026">("todos");
  const [indiceMsg, setIndiceMsg] = useState<string | null>(null);
  const [indiceLoading, setIndiceLoading] = useState(false);

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

  const cargarIndice2025 = async () => {
    setIndiceLoading(true);
    setIndiceMsg(null);
    try {
      const res = await api.post<{
        ok?: boolean;
        facturas?: number;
        mensaje?: string;
        error?: string;
      }>("/api/facturas/consultar/indice", { anio: 2025, forzar: true }, { timeoutMs: 300_000 });
      setIndiceMsg(res.mensaje || `Índice 2025: ${res.facturas ?? 0} factura(s).`);
      if (debounced.length >= 2) {
        await consulta.refetch();
      }
    } catch (e) {
      setIndiceMsg((e as Error).message || "No se pudo cargar el índice 2025");
    } finally {
      setIndiceLoading(false);
    }
  };

  const resultados = consulta.data?.resultados ?? [];
  const avisos = consulta.data?.avisos ?? [];
  const idx2025 = consulta.data?.indices?.["2025"];

  return (
    <div className="space-y-4">
      <div className={compact ? "space-y-3" : "rounded-xl border-2 border-border bg-surface-panel p-4"}>
        {!compact && (
          <>
            <h2 className="text-lg font-bold text-ink">Consultar factura</h2>
            <p className="mt-1 text-sm text-muted">
              Busca facturas de proveedores por nombre o código (pendientes, historial y archivo 2025).
            </p>
          </>
        )}
        {compact && (
          <p className="text-sm text-muted">
            Busca por nombre o código en facturas de proveedores (incluye archivo 2025).
          </p>
        )}
        <div className={`flex flex-wrap gap-1 ${compact ? "" : "mt-3"}`}>
          {([
            { id: "todos" as const, label: "Todos" },
            { id: "2025" as const, label: "2025" },
            { id: "2026" as const, label: "2026" },
          ]).map((opt) => (
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
            onClick={() => void cargarIndice2025()}
            disabled={indiceLoading}
            className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-800 hover:border-orange-500 disabled:opacity-50 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200"
            title="Indexa facturas 2025 desde Gmail/local para poder consultarlas"
          >
            {indiceLoading ? "Indexando 2025…" : "Cargar archivo 2025"}
          </button>
        </div>
        {(indiceMsg || idx2025?.listo) && (
          <p className="text-[11px] text-muted">
            {indiceMsg
              || (idx2025?.listo
                ? `Archivo 2025 listo: ${idx2025.facturas ?? 0} factura(s)${idx2025.actualizado ? ` · ${idx2025.actualizado.slice(0, 16)}` : ""}`
                : null)}
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
          {avisos[0]}
        </div>
      )}

      {!consulta.isFetching && debounced.length >= 2 && !consulta.error && resultados.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
          <p className="text-base font-semibold text-ink">Sin coincidencias</p>
          <p className="mt-1 text-sm text-muted">
            No hay facturas{anio !== "todos" ? ` de ${anio}` : ""} con producto que coincida con «{debounced}».
            {anio !== "2026" && (
              <>
                {" "}
                Si faltan las de 2025, pulsa <strong>Cargar archivo 2025</strong>.
              </>
            )}
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
          const acc =
            origen === "pendiente"
              ? { label: "En cola", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" }
              : origen.startsWith("gmail-") || origen.startsWith("archivo-")
                ? {
                    label: origen.includes("2025") ? "Archivo 2025" : "Archivo",
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

function Stepper({ paso }: { paso: number }) {
  return (
    <div className="flex flex-wrap gap-2 sm:gap-0 sm:divide-x sm:divide-border rounded-xl border border-border bg-surface-panel overflow-hidden">
      {STEPS.map((s) => (
        <div
          key={s.n}
          className={`flex-1 min-w-[140px] px-4 py-3 ${
            paso === s.n ? "bg-accent/10 border-b-2 sm:border-b-0 border-accent" : "opacity-60"
          }`}
        >
          <p className={`text-[10px] font-bold uppercase tracking-wide ${paso === s.n ? "text-accent" : "text-muted"}`}>
            Paso {s.n}
          </p>
          <p className="text-sm font-semibold text-ink">{s.label}</p>
          <p className="text-[10px] text-muted hidden sm:block">{s.hint}</p>
        </div>
      ))}
    </div>
  );
}
