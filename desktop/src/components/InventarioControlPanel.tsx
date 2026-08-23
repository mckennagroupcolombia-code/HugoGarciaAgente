import { useMemo, useState } from "react";
import {
  useAjustarStockInventario,
  useFlagEliminarInventario,
  useGuardarProveedorInventario,
  useInventarioControlResumen,
  useMarcarRevisadoInventario,
  useSolicitarCompraInventario,
  type EstadoInventario,
  type ItemInventarioControl,
} from "../hooks/useInventarioControl";

type Filtro = "urgentes" | "bajo" | "divergencias" | "sin_revisar" | "todo";

const ESTADO_META: Record<
  EstadoInventario,
  { label: string; emoji: string; rowClass: string; badgeClass: string; stockClass: string }
> = {
  agotado: {
    label: "Agotado",
    emoji: "🚫",
    rowClass: "border-danger bg-danger/10",
    badgeClass: "bg-danger/20 text-danger",
    stockClass: "text-danger",
  },
  critico: {
    label: "Última unidad",
    emoji: "⚠️",
    rowClass: "border-amber-500 bg-amber-500/15",
    badgeClass: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
    stockClass: "text-amber-700 dark:text-amber-300",
  },
  bajo: {
    label: "Stock bajo",
    emoji: "🟡",
    rowClass: "border-orange-400 bg-orange-500/10",
    badgeClass: "bg-orange-500/20 text-orange-800 dark:text-orange-300",
    stockClass: "text-orange-700 dark:text-orange-300",
  },
  ok: {
    label: "OK",
    emoji: "✅",
    rowClass: "border-emerald-500/50 bg-emerald-500/[0.06]",
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    stockClass: "text-emerald-700 dark:text-emerald-400",
  },
};

const ROTACION_LABEL: Record<string, string> = {
  alta: "🔥 Alta rotación",
  media: "🔸 Media rotación",
  baja: "🔹 Baja rotación",
  sin_ventas: "🗑️ Sin ventas este año",
};

function diasSinRevisarTexto(dias: number | null): string {
  if (dias === null) return "Nunca revisada";
  if (dias === 0) return "Revisada hoy";
  if (dias === 1) return "Revisada ayer";
  return `Sin revisar hace ${dias} días`;
}

function coincideFiltro(item: ItemInventarioControl, filtro: Filtro): boolean {
  switch (filtro) {
    case "urgentes":
      return item.estado === "agotado" || item.estado === "critico";
    case "bajo":
      return item.estado === "bajo";
    case "divergencias":
      return item.divergencia;
    case "sin_revisar":
      return item.dias_sin_revisar === null || item.dias_sin_revisar >= 7;
    case "todo":
      return true;
  }
}

function ActionButton({
  onClick,
  active,
  children,
  disabled,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 flex-1 rounded-paper border-2 px-3 py-2.5 text-sm font-bold transition disabled:opacity-40 ${
        active
          ? "border-accent bg-accent text-white shadow-[0_2px_0_#045159]"
          : "border-border bg-surface-panel text-ink hover:border-accent"
      }`}
    >
      {children}
    </button>
  );
}

function InventarioCard({ item }: { item: ItemInventarioControl }) {
  const meta = ESTADO_META[item.estado];
  const [expandido, setExpandido] = useState<"add" | "compra" | "proveedor" | "eliminar" | null>(null);
  const [cantidadAgregar, setCantidadAgregar] = useState("1");
  const [cantidadCompra, setCantidadCompra] = useState("");
  const [proveedorCompra, setProveedorCompra] = useState(item.proveedor);
  const [motivoCompra, setMotivoCompra] = useState("");
  const [proveedorDraft, setProveedorDraft] = useState(item.proveedor);
  const [motivoEliminar, setMotivoEliminar] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const ajustar = useAjustarStockInventario();
  const revisar = useMarcarRevisadoInventario();
  const guardarProveedor = useGuardarProveedorInventario();
  const solicitarCompra = useSolicitarCompraInventario();
  const flagEliminar = useFlagEliminarInventario();

  const cerrar = () => setExpandido(null);
  const puedeEliminar = item.rotacion === "sin_ventas" && item.estado !== "ok";

  async function confirmarAgregar() {
    const n = parseInt(cantidadAgregar, 10);
    if (!n || n <= 0) return;
    await ajustar.mutateAsync({ sku: item.sku || item.meli_id, meliId: item.meli_id, delta: n });
    setAviso(`+${n} unidad(es) agregadas.`);
    cerrar();
  }

  async function confirmarRevisado() {
    await revisar.mutateAsync({ meliId: item.meli_id });
    setAviso("Marcado como revisado.");
  }

  async function confirmarProveedor() {
    await guardarProveedor.mutateAsync({ sku: item.sku, proveedor: proveedorDraft });
    setAviso("Proveedor actualizado.");
    cerrar();
  }

  async function confirmarCompra() {
    const r = await solicitarCompra.mutateAsync({
      sku: item.sku,
      meliId: item.meli_id,
      nombre: item.nombre,
      cantidadSugerida: cantidadCompra ? parseInt(cantidadCompra, 10) : undefined,
      proveedor: proveedorCompra || undefined,
      motivo: motivoCompra || undefined,
      prioridadAlta: item.estado === "agotado",
    });
    setAviso(r.mensaje);
    cerrar();
  }

  async function confirmarEliminar() {
    const r = await flagEliminar.mutateAsync({
      sku: item.sku,
      meliId: item.meli_id,
      nombre: item.nombre,
      motivo: motivoEliminar || undefined,
    });
    setAviso(r.mensaje);
    cerrar();
  }

  return (
    <div className={`rounded-paper border-2 ${meta.rowClass} p-4 shadow-paper space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${meta.badgeClass}`}>
          {meta.emoji} {meta.label}
        </span>
        {item.divergencia && (
          <span className="rounded-full bg-sky-500/20 px-2.5 py-1 text-xs font-extrabold text-sky-800 dark:text-sky-300">
            🔀 Diferencia con bodega
          </span>
        )}
        <span className="text-xs font-semibold text-muted">{ROTACION_LABEL[item.rotacion] ?? item.rotacion}</span>
      </div>

      <div>
        <p className="text-base font-extrabold leading-snug text-ink break-words">{item.nombre}</p>
        <p className="text-xs text-muted">SKU: {item.sku || "—"}</p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Stock MeLi</p>
          <p className={`text-2xl font-extrabold tabular-nums ${meta.stockClass}`}>{item.stock_meli}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Bodega (Siigo)</p>
          <p className="text-lg font-bold tabular-nums text-muted">
            {item.stock_siigo === null ? "—" : item.stock_siigo}
          </p>
        </div>
      </div>
      {item.divergencia && (
        <p className="rounded-paper bg-sky-500/10 px-2.5 py-1.5 text-xs font-semibold text-sky-800 dark:text-sky-300">
          Bodega muestra {item.stock_siigo} — MeLi no se actualizó, revisar sincronización.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{diasSinRevisarTexto(item.dias_sin_revisar)}</span>
        {expandido === "proveedor" ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={proveedorDraft}
              onChange={(e) => setProveedorDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void confirmarProveedor()}
              placeholder="Nombre del proveedor"
              className="w-32 rounded-paper border border-border bg-surface-input px-2 py-1 text-xs outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void confirmarProveedor()}
              className="rounded-paper border border-accent bg-accent px-2 py-1 text-[10px] font-bold text-white"
            >
              Guardar
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setProveedorDraft(item.proveedor);
              setExpandido("proveedor");
            }}
            className="font-semibold text-ink underline decoration-dotted underline-offset-2"
          >
            Proveedor: {item.proveedor || "— (editar)"}
          </button>
        )}
      </div>

      {aviso && <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{aviso}</p>}

      <div className="flex flex-wrap gap-2">
        <ActionButton onClick={() => setExpandido(expandido === "add" ? null : "add")} active={expandido === "add"}>
          ➕ Unidades
        </ActionButton>
        <ActionButton
          onClick={() => setExpandido(expandido === "compra" ? null : "compra")}
          active={expandido === "compra"}
        >
          🛒 Solicitar compra
        </ActionButton>
        <ActionButton onClick={() => void confirmarRevisado()} disabled={revisar.isPending}>
          ✅ Marcar revisado
        </ActionButton>
        {puedeEliminar && (
          <ActionButton
            onClick={() => setExpandido(expandido === "eliminar" ? null : "eliminar")}
            active={expandido === "eliminar"}
          >
            🗑️ Eliminar publicación
          </ActionButton>
        )}
      </div>

      {expandido === "add" && (
        <div className="flex items-center gap-2 rounded-paper border border-border bg-surface-hover/50 p-3">
          <input
            type="number"
            min={1}
            value={cantidadAgregar}
            onChange={(e) => setCantidadAgregar(e.target.value)}
            className="w-20 rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <span className="text-xs text-muted">unidades a sumar al stock real en MeLi</span>
          <button
            type="button"
            onClick={() => void confirmarAgregar()}
            disabled={ajustar.isPending}
            className="ml-auto rounded-paper border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            {ajustar.isPending ? "Guardando…" : "Confirmar"}
          </button>
        </div>
      )}

      {expandido === "compra" && (
        <div className="space-y-2 rounded-paper border border-border bg-surface-hover/50 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="number"
              min={1}
              placeholder="Cantidad sugerida"
              value={cantidadCompra}
              onChange={(e) => setCantidadCompra(e.target.value)}
              className="w-36 rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <input
              placeholder="Proveedor"
              value={proveedorCompra}
              onChange={(e) => setProveedorCompra(e.target.value)}
              className="flex-1 min-w-[8rem] rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <input
            placeholder="Motivo / notas (opcional)"
            value={motivoCompra}
            onChange={(e) => setMotivoCompra(e.target.value)}
            className="w-full rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void confirmarCompra()}
            disabled={solicitarCompra.isPending}
            className="w-full rounded-paper border-2 border-accent bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {solicitarCompra.isPending ? "Enviando…" : "Enviar solicitud de compra"}
          </button>
        </div>
      )}

      {expandido === "eliminar" && (
        <div className="space-y-2 rounded-paper border border-danger/40 bg-danger/5 p-3">
          <p className="text-xs text-muted">
            Se crea un ticket para que un humano confirme y elimine la publicación en MeLi — no se borra nada
            automáticamente.
          </p>
          <input
            placeholder="Motivo (opcional)"
            value={motivoEliminar}
            onChange={(e) => setMotivoEliminar(e.target.value)}
            className="w-full rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void confirmarEliminar()}
            disabled={flagEliminar.isPending}
            className="w-full rounded-paper border-2 border-danger bg-danger px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {flagEliminar.isPending ? "Enviando…" : "Confirmar y crear ticket"}
          </button>
        </div>
      )}
    </div>
  );
}

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "urgentes", label: "Urgentes" },
  { id: "bajo", label: "Bajo stock" },
  { id: "divergencias", label: "Diferencia con bodega" },
  { id: "sin_revisar", label: "Sin revisar +7 días" },
  { id: "todo", label: "Todo" },
];

export default function InventarioControlPanel() {
  const [filtro, setFiltro] = useState<Filtro>("urgentes");
  const { data, isLoading, isFetching, error, refetch } = useInventarioControlResumen();

  const items = data?.items ?? [];
  const conteos = useMemo(() => {
    const c: Record<Filtro, number> = { urgentes: 0, bajo: 0, divergencias: 0, sin_revisar: 0, todo: items.length };
    for (const it of items) {
      if (coincideFiltro(it, "urgentes")) c.urgentes += 1;
      if (coincideFiltro(it, "bajo")) c.bajo += 1;
      if (coincideFiltro(it, "divergencias")) c.divergencias += 1;
      if (coincideFiltro(it, "sin_revisar")) c.sin_revisar += 1;
    }
    return c;
  }, [items]);

  const filtrados = useMemo(() => items.filter((it) => coincideFiltro(it, filtro)), [items, filtro]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2 sm:gap-2.5 sm:p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-bold text-ink dark:text-white">📋 Control de Inventario</h1>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-8 rounded-paper border border-accent bg-accent px-2.5 py-1 text-xs font-semibold text-white"
        >
          {isFetching ? "Actualizando…" : "Actualizar"}
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={`min-h-10 rounded-paper border-2 px-3 py-2 text-sm font-bold transition ${
              filtro === f.id
                ? "border-accent bg-accent text-white"
                : "border-border bg-surface-panel text-ink hover:border-accent"
            }`}
          >
            {f.label} {conteos[f.id] > 0 && <span className="tabular-nums">({conteos[f.id]})</span>}
          </button>
        ))}
      </div>

      {isLoading && <p className="py-8 text-center text-sm text-muted">Cargando inventario…</p>}
      {error && (
        <p className="rounded-paper border-2 border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">
          {error instanceof Error ? error.message : "No se pudo cargar el inventario."}
        </p>
      )}
      {data?.error && (
        <p className="rounded-paper border-2 border-amber-500/40 bg-amber-500/10 p-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
          {data.error}
        </p>
      )}

      {!isLoading && filtrados.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">
          {filtro === "urgentes" ? "✅ Nada urgente por ahora." : "Sin productos en este filtro."}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtrados.map((it) => (
          <InventarioCard key={it.meli_id} item={it} />
        ))}
      </div>
    </div>
  );
}
