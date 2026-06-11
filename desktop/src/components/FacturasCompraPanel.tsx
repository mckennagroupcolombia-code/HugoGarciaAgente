import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

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
        : new Set(detalle.items.filter((i) => !i.duplicado).map((i) => i.indice)),
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
    duplicado: boolean;
    siigo_producto: SiigoProducto | null;
  }) => {
    setChecksCodigo((prev) => ({ ...prev, [String(idx)]: result }));
    if (result.duplicado) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
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
              item={item}
              codigo={codigosManual[String(item.indice)] ?? item.codigo}
              check={checksCodigo[String(item.indice)]}
              checked={selected.has(item.indice)}
              disabled={bloqueado}
              onToggle={() => toggleItem(item.indice)}
              onCodeChange={(c) => handleCodeChange(item.indice, c)}
              onCodeCheck={(r) => handleCodeCheck(item.indice, r)}
            />
          ))}
        </div>
      </div>

      {/* Acciones humanas */}
      <div className="sticky bottom-0 z-10 rounded-xl border-2 border-border bg-surface-panel/95 backdrop-blur p-4 shadow-lg">
        <p className="mb-3 text-xs text-muted">
          Revisa línea a línea antes de confirmar. <strong className="text-ink">Inventario</strong> genera Excel + XML para SIIGO.
          <strong className="text-ink"> Gasto</strong> registra la factura completa como costo. <strong className="text-ink">Omitir</strong> descarta sin registrar.
        </p>
        <div className="flex flex-wrap gap-2">
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
  item,
  codigo,
  check,
  checked,
  disabled,
  onToggle,
  onCodeChange,
  onCodeCheck,
}: {
  item: ItemFactura;
  codigo: string;
  check?: { codigo: string; duplicado: boolean; siigo_producto: SiigoProducto | null };
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onCodeChange: (codigo: string) => void;
  onCodeCheck: (result: { codigo: string; duplicado: boolean; siigo_producto: SiigoProducto | null }) => void;
}) {
  const checkCodigo = useMutation({
    mutationFn: (codigoActual: string) =>
      api.post<{ codigo: string; duplicado: boolean; siigo_producto: SiigoProducto | null }>(
        "/api/facturas/codigo/check",
        { codigo: codigoActual },
      ),
    onSuccess: onCodeCheck,
  });
  const siigoProducto = check?.siigo_producto || item.siigo_producto || null;
  const duplicado = check?.duplicado ?? item.duplicado;

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-0 ${
      duplicado ? "bg-amber-50/50 dark:bg-amber-900/10" : checked ? "bg-accent/5" : ""
    }`}>
      {/* Columna proveedor */}
      <div className="flex gap-3 border-b lg:border-b-0 lg:border-r border-border/60 p-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled || duplicado}
          className="mt-1 shrink-0 accent-accent"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-ink leading-snug">{item.nombre}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-mono text-muted">
            <span>Cant: <span className="text-ink">{item.cantidad_original} {item.unidad_original}</span></span>
            <span>Subtotal: <span className="text-ink">{cop(item.subtotal)}</span></span>
            <span>P. proveedor: <span className="text-ink">{cop(item.precio_proveedor)}</span></span>
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
          {duplicado ? (
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-800 dark:text-amber-100">
              Ya en SIIGO
            </span>
          ) : check && !check.duplicado ? (
            <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100">
              Código libre
            </span>
          ) : null}
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
          <p className="text-[11px] text-amber-700 dark:text-amber-300 font-mono truncate">
            SIIGO: {siigoProducto.codigo} · {siigoProducto.nombre}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FacturasCompraPanel() {
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<EscanearResultado | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["facturas-pendientes"],
    queryFn: () => api.get<{ pendientes: FacturaSummary[]; total: number }>("/api/facturas/pendientes"),
    refetchInterval: 15_000,
  });

  const escanear = useMutation({
    mutationFn: () => api.post<EscanearResultado>("/api/facturas/escanear", {}),
    onSuccess: (res) => {
      setScanResult(res);
      qc.invalidateQueries({ queryKey: ["facturas-pendientes"] });
      if (res.encoladas?.length === 1) {
        setDetalleAbierto(res.encoladas[0].sufijo);
      }
    },
  });

  const pendientes = data?.pendientes ?? [];
  const total = data?.total ?? 0;
  const pasoActual = detalleAbierto ? 2 : total > 0 ? 2 : 1;

  const handleDone = useCallback(async (sufijoActual: string) => {
    setDetalleAbierto(null);
    await qc.invalidateQueries({ queryKey: ["facturas-pendientes"] });
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
