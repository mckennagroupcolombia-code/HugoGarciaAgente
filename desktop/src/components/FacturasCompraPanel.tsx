import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import TerminalLog from "./TerminalLog";
import { usePanelLogs, useClearPanelLogs } from "../hooks/usePanelLogs";

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDec(n: number, d = 4) {
  return n.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

// ── Summary card (list view) ─────────────────────────────────────────────────

function FacturaCard({
  f,
  onOpen,
}: {
  f: FacturaSummary;
  onOpen: (sufijo: string) => void;
}) {
  const qc = useQueryClient();
  const clasificar = useMutation({
    mutationFn: (cmd: "gasto" | "skip") =>
      api.post("/api/facturas/clasificar", { cmd, sufijo: f.sufijo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["facturas-pendientes"] }),
  });

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded">
              #{f.sufijo}
            </span>
            <span className="text-sm font-semibold text-ink">{f.numero_factura}</span>
          </div>
          <p className="mt-1 text-sm text-ink-secondary font-medium">{f.proveedor}</p>
          {f.nit && <p className="text-[11px] text-muted font-mono">NIT: {f.nit}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
          f.es_nuevo_proveedor
            ? "bg-yellow-500/15 text-yellow-400"
            : "bg-emerald-500/15 text-emerald-400"
        }`}>
          {f.es_nuevo_proveedor ? "Nuevo" : "Conocido"}
        </span>
      </div>

      <div className="flex gap-4 text-xs text-muted font-mono">
        <span>📦 {f.items_count} ítem(s)</span>
        <span>💰 ${fmt(f.total)} COP</span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onOpen(f.sufijo)}
          className="flex-1 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/30 transition"
        >
          🔍 Revisar ítems
        </button>
        <button
          disabled={clasificar.isPending}
          onClick={() => clasificar.mutate("gasto")}
          className="rounded-lg bg-yellow-500/15 px-3 py-1.5 text-xs font-bold text-yellow-400 hover:bg-yellow-500/30 transition disabled:opacity-40"
        >
          🧾 Gasto
        </button>
        <button
          disabled={clasificar.isPending}
          onClick={() => clasificar.mutate("skip")}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink transition disabled:opacity-40"
        >
          Omitir
        </button>
      </div>
    </div>
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
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [agregarProveedor, setAgregarProveedor] = useState(false);
  const [codigosManual, setCodigosManual] = useState<Record<string, string>>({});
  const [checksCodigo, setChecksCodigo] = useState<Record<string, {
    codigo: string;
    duplicado: boolean;
    siigo_producto: SiigoProducto | null;
  }>>({});
  const { data: logData } = usePanelLogs(true);
  const clearLogs = useClearPanelLogs();
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
        : new Set(detalle.items.filter(i => !i.duplicado).map(i => i.indice)),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["facturas-pendientes"] });
      onDone();
    },
  });

  const omitirDuplicada = useMutation({
    mutationFn: () => api.post("/api/facturas/clasificar", { cmd: "skip", sufijo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["facturas-pendientes"] });
      onDone();
    },
  });

  const toggleItem = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (!detalle) return;
    if (selected.size === detalle.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(detalle.items.map(i => i.indice)));
    }
  };

  const lines = logData?.lines ?? [];

  const handleCodeChange = (idx: number, codigo: string) => {
    setCodigosManual(prev => ({ ...prev, [String(idx)]: codigo }));
    setChecksCodigo(prev => {
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
    setChecksCodigo(prev => ({ ...prev, [String(idx)]: result }));
    if (result.duplicado) {
      setSelected(prev => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="text-sm text-muted hover:text-ink flex items-center gap-1">
          ← Volver
        </button>
        <div className="text-sm text-muted py-12 text-center">
          Analizando factura con SIIGO… esto puede tomar 10–20 s
          <span className="ml-2 inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !detalle) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="text-sm text-muted hover:text-ink">← Volver</button>
        <p className="text-danger text-sm">Error cargando el detalle de la factura.</p>
      </div>
    );
  }

  const nuevos = detalle.items.filter(i => !i.duplicado).length;
  const duplicados = detalle.items.filter(i => i.duplicado).length;
  const selCount = selected.size;
  const productosExistentes = detalle.items.filter(i => {
    const check = checksCodigo[String(i.indice)];
    return i.siigo_producto || check?.siigo_producto;
  });
  const facturaYaRegistrada = detalle.compra_registrada_siigo;

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <button onClick={onBack} className="text-sm text-muted hover:text-ink transition flex items-center gap-1">
          ← Volver
        </button>
        <span className="text-muted">|</span>
        <h2 className="text-base font-bold text-ink">{detalle.numero_factura}</h2>
        <span className="text-sm text-muted">{detalle.proveedor}</span>
        {detalle.nit && <span className="text-xs text-muted font-mono">NIT: {detalle.nit}</span>}
        {detalle.fecha && <span className="text-xs text-muted">{detalle.fecha}</span>}
      </div>

      {/* Invoice totals */}
      <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Subtotal", val: `$${fmt(detalle.total_bruto)} COP` },
          { label: "Descuentos", val: `$${fmt(detalle.total_descuentos)} COP` },
          { label: "Total neto", val: `$${fmt(detalle.total_neto)} COP` },
          { label: "Ítems", val: `${nuevos} nuevo(s) · ${duplicados} dup.` },
        ].map(({ label, val }) => (
          <div key={label} className="rounded-lg border border-border bg-surface-panel px-3 py-2">
            <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
            <p className="text-sm font-bold text-ink">{val}</p>
          </div>
        ))}
      </div>

      {facturaYaRegistrada && (
        <div className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm font-bold text-red-300">
            Esta factura ya aparece registrada en SIIGO
          </p>
          <p className="mt-1 text-xs text-muted">
            Documento SIIGO: <span className="font-mono text-ink">{facturaYaRegistrada.name || facturaYaRegistrada.id}</span>
            {facturaYaRegistrada.fecha ? ` · Fecha ${facturaYaRegistrada.fecha}` : ""}
            {facturaYaRegistrada.valor ? ` · Valor $${fmt(facturaYaRegistrada.valor)}` : ""}
          </p>
          <p className="mt-1 text-xs text-red-200">
            Se bloquea inventariar para evitar duplicar la compra. Puedes omitirla de la cola.
          </p>
          <button
            disabled={omitirDuplicada.isPending}
            onClick={() => omitirDuplicada.mutate()}
            className="mt-3 rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/25 transition disabled:opacity-40"
          >
            Omitir de pendientes
          </button>
        </div>
      )}

      {productosExistentes.length > 0 && (
        <div className="shrink-0 rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-3">
          <p className="text-xs font-bold text-yellow-300">
            Productos ya creados en SIIGO para {detalle.proveedor}
          </p>
          <div className="mt-2 grid gap-1 text-[11px] font-mono text-muted">
            {productosExistentes.map(item => (
              <div key={item.indice} className="grid gap-1 sm:grid-cols-[120px_1fr]">
                <span className="text-yellow-300">
                  {checksCodigo[String(item.indice)]?.siigo_producto?.codigo || item.siigo_producto?.codigo}
                </span>
                <span className="truncate">
                  {checksCodigo[String(item.indice)]?.siigo_producto?.nombre || item.siigo_producto?.nombre || item.nombre}
                  {(checksCodigo[String(item.indice)]?.siigo_producto?.unidad || item.siigo_producto?.unidad)
                    ? ` · ${checksCodigo[String(item.indice)]?.siigo_producto?.unidad || item.siigo_producto?.unidad}`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 min-h-0 flex-1">
        {/* Items table */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">

          {/* Proveedor nuevo → opción de agregar */}
          {detalle.es_nuevo_proveedor && (
            <label className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={agregarProveedor}
                onChange={e => setAgregarProveedor(e.target.checked)}
                className="accent-yellow-400"
              />
              Agregar <strong>{detalle.proveedor}</strong> a la lista de proveedores de materias primas
            </label>
          )}

          {/* Table header */}
          <div className="shrink-0 flex items-center justify-between gap-2 pb-1 border-b border-border">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selCount === detalle.items.length}
                onChange={toggleAll}
                className="accent-accent"
              />
              <span className="text-xs text-muted">
                {selCount} de {detalle.items.length} ítems seleccionados para inventariar
              </span>
            </div>
          </div>

          {/* Items */}
          <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 460px)" }}>
            {detalle.items.map(item => (
              <ItemRow
                key={item.indice}
                item={item}
                codigo={codigosManual[String(item.indice)] ?? item.codigo}
                check={checksCodigo[String(item.indice)]}
                checked={selected.has(item.indice)}
                onToggle={() => toggleItem(item.indice)}
                onCodeChange={(codigo) => handleCodeChange(item.indice, codigo)}
                onCodeCheck={(result) => handleCodeCheck(item.indice, result)}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="shrink-0 flex gap-3 pt-2 border-t border-border flex-wrap">
            <button
              disabled={Boolean(facturaYaRegistrada) || selCount === 0 || procesar.isPending}
              onClick={() => procesar.mutate()}
              className="flex-1 rounded-xl bg-emerald-500/15 px-4 py-2.5 text-sm font-bold text-emerald-400 hover:bg-emerald-500/30 transition disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {procesar.isPending ? (
                <><span className="inline-block w-4 h-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" /> Procesando…</>
              ) : (
                <>📦 Procesar como Inventario ({selCount} ítem{selCount !== 1 ? "s" : ""})</>
              )}
            </button>
            <button
              onClick={onBack}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted hover:text-ink transition"
            >
              Cancelar
            </button>
          </div>
        </div>

        {/* Terminal */}
        <div className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col gap-2">
          <TerminalLog
            lines={lines}
            isRunning={procesar.isPending}
            onClear={() => clearLogs.mutate()}
            className="h-64 lg:h-full"
          />
        </div>
      </div>
    </div>
  );
}

// ── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  codigo,
  check,
  checked,
  onToggle,
  onCodeChange,
  onCodeCheck,
}: {
  item: ItemFactura;
  codigo: string;
  check?: { codigo: string; duplicado: boolean; siigo_producto: SiigoProducto | null };
  checked: boolean;
  onToggle: () => void;
  onCodeChange: (codigo: string) => void;
  onCodeCheck: (result: { codigo: string; duplicado: boolean; siigo_producto: SiigoProducto | null }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasImpuestos = item.impuestos.length > 0;
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
    <div className={`rounded-xl border transition ${
      duplicado
        ? "border-yellow-500/30 bg-yellow-500/5"
        : checked
          ? "border-accent/40 bg-accent/5"
          : "border-border bg-surface-panel"
    }`}>
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 shrink-0 accent-accent"
        />
        <div className="min-w-0 flex-1 space-y-1">
          {/* Name + duplicate badge */}
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink leading-tight">{item.nombre}</span>
            {duplicado && (
              <span className="shrink-0 rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] font-bold text-yellow-400">
                Ya en SIIGO
              </span>
            )}
            {check && !check.duplicado && (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                Código libre
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
            <label className="flex-1 text-[10px] uppercase tracking-wide text-muted">
              Código SIIGO editable
              <input
                type="text"
                value={codigo}
                onChange={(e) => onCodeChange(e.target.value)}
                onBlur={() => {
                  if (codigo.trim()) checkCodigo.mutate(codigo.trim());
                }}
                className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              disabled={checkCodigo.isPending || !codigo.trim()}
              onClick={() => checkCodigo.mutate(codigo.trim())}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink transition disabled:opacity-40 sm:mt-4"
            >
              {checkCodigo.isPending ? "Verificando…" : "Verificar"}
            </button>
          </div>

          {/* Computed fields grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-[11px] font-mono text-muted">
            <span><span className="text-ink-secondary">Sugerido:</span> {item.codigo_sugerido || item.codigo}</span>
            <span><span className="text-ink-secondary">Proveedor:</span> {item.cantidad_original} {item.unidad_original}</span>
            <span><span className="text-ink-secondary">Unitario min:</span> {fmtDec(item.cantidad_min)} {item.unidad_min}</span>
            <span><span className="text-ink-secondary">P. venta:</span> ${fmtDec(item.precio_unitario, 2)}/{item.unidad_min}</span>
            <span><span className="text-ink-secondary">P. neto:</span> ${fmtDec(item.precio_neto, 4)}/{item.unidad_min}</span>
            <span><span className="text-ink-secondary">Subtotal:</span> ${fmt(item.subtotal)}</span>
            {siigoProducto && (
              <span className="col-span-2 text-yellow-300">
                SIIGO: {siigoProducto.codigo} · {siigoProducto.nombre || "Producto existente"}
              </span>
            )}
            {item.iva > 0 && (
              <span><span className="text-ink-secondary">IVA:</span> ${fmt(item.iva)}</span>
            )}
            {item.multiplicador > 1 && (
              <span className="col-span-2 text-violet-300">× {item.multiplicador} unidades por empaque</span>
            )}
          </div>

          {/* Expand impuestos */}
          {hasImpuestos && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-[10px] text-muted hover:text-ink transition"
            >
              {expanded ? "▲ ocultar impuestos" : "▼ ver impuestos"}
            </button>
          )}
          {expanded && (
            <div className="mt-1 space-y-0.5">
              {item.impuestos.map((imp, i) => (
                <div key={i} className="text-[11px] font-mono text-muted">
                  {imp.nombre}: ${fmt(imp.valor)} ({imp.porcentaje}%)
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FacturasCompraPanel() {
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null);
  const clearLogs = useClearPanelLogs();
  const qc = useQueryClient();
  const { data: logData } = usePanelLogs(true);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["facturas-pendientes"],
    queryFn: () => api.get<{ pendientes: FacturaSummary[]; total: number }>("/api/facturas/pendientes"),
    refetchInterval: 10_000,
  });

  const pendientes = data?.pendientes ?? [];
  const total = data?.total ?? 0;

  const handleDone = useCallback(() => {
    setDetalleAbierto(null);
    qc.invalidateQueries({ queryKey: ["facturas-pendientes"] });
  }, [qc]);

  if (detalleAbierto) {
    return (
      <DetalleFactura
        sufijo={detalleAbierto}
        onBack={() => setDetalleAbierto(null)}
        onDone={handleDone}
      />
    );
  }

  const lines = logData?.lines ?? [];

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <h2 className="text-lg font-semibold text-ink">Facturas de Compra</h2>
        {total > 0 && (
          <span className="rounded-full bg-yellow-500/20 px-2.5 py-0.5 text-xs font-bold text-yellow-400">
            {total} pendiente{total !== 1 ? "s" : ""}
          </span>
        )}
        <button onClick={() => refetch()} className="ml-auto text-xs text-muted hover:text-ink transition">
          ↻ Actualizar
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: 0 }}>
        {/* Left: factura list */}
        <div className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col gap-3 overflow-y-auto">
          {isLoading && (
            <p className="text-sm text-muted text-center py-8">Cargando…</p>
          )}
          {!isLoading && pendientes.length === 0 && (
            <div className="rounded-xl border border-border bg-surface-panel p-6 text-center">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-sm font-semibold text-ink">Sin facturas pendientes</p>
              <p className="text-xs text-muted mt-1">
                Ejecuta "Facturas Gmail" en Sincronización para escanear.
              </p>
            </div>
          )}
          {pendientes.map(f => (
            <FacturaCard key={f.sufijo} f={f} onOpen={setDetalleAbierto} />
          ))}
        </div>

        {/* Right: terminal */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <TerminalLog
            lines={lines}
            isRunning={false}
            onClear={() => clearLogs.mutate()}
            className="h-[500px] lg:h-[600px]"
          />
          <p className="text-[11px] text-muted px-1">
            💡 <strong>Revisar ítems</strong>: ver los datos extraídos del XML, seleccionar producto a producto y generar archivos SIIGO.&nbsp;
            <strong>Gasto</strong>: registra directo en SIIGO sin generar inventario.&nbsp;
            <strong>Omitir</strong>: descarta la factura.
          </p>
        </div>
      </div>
    </div>
  );
}
