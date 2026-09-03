import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAjustarStockInventario,
  useFlagEliminarInventario,
  useGuardarProveedorInventario,
  useInventarioControlResumen,
  useMarcarRevisadoInventario,
  useRefrescarInventarioControl,
  useSolicitarCompraInventario,
  type EstadoInventario,
  type ItemInventarioControl,
} from "../hooks/useInventarioControl";
import { Icon } from "../icons";
import type { UiIconName } from "../icons";

type Filtro = "urgentes" | "bajo" | "divergencias" | "sin_revisar" | "todo";

const ESTADO_META: Record<
  EstadoInventario,
  { label: string; icon: UiIconName; rowClass: string; badgeClass: string; stockClass: string }
> = {
  agotado: {
    label: "Agotado",
    icon: "xCircle",
    rowClass: "border-danger bg-danger/10",
    badgeClass: "bg-danger/20 text-danger",
    stockClass: "text-danger",
  },
  critico: {
    label: "Última unidad",
    icon: "warning",
    rowClass: "border-amber-500 bg-amber-500/15",
    badgeClass: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
    stockClass: "text-amber-700 dark:text-amber-300",
  },
  bajo: {
    label: "Stock bajo",
    icon: "circle",
    rowClass: "border-orange-400 bg-orange-500/10",
    badgeClass: "bg-orange-500/20 text-orange-800 dark:text-orange-300",
    stockClass: "text-orange-700 dark:text-orange-300",
  },
  ok: {
    label: "OK",
    icon: "check",
    rowClass: "border-emerald-500/50 bg-emerald-500/[0.06]",
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    stockClass: "text-emerald-700 dark:text-emerald-400",
  },
};

const ROTACION_META: Record<string, { label: string; icon: UiIconName }> = {
  alta: { label: "Alta rotación", icon: "lightning" },
  media: { label: "Media rotación", icon: "chartBar" },
  baja: { label: "Baja rotación", icon: "circle" },
  sin_ventas: { label: "Sin ventas este año", icon: "trash" },
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
  icon,
  label,
  disabled,
}: {
  onClick: () => void;
  active?: boolean;
  icon: UiIconName;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-paper border transition disabled:opacity-40 ${
        active
          ? "border-accent bg-accent text-white"
          : "border-border bg-surface-panel text-ink hover:border-accent"
      }`}
    >
      <Icon name={icon} size={16} weight="bold" className="shrink-0" />
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

  const rotacion = ROTACION_META[item.rotacion] ?? {
    label: item.rotacion,
    icon: "package" as UiIconName,
  };

  return (
    <div className={`rounded-paper border ${meta.rowClass} p-2.5 shadow-paper space-y-1.5`}>
      <div className="flex flex-wrap items-center gap-1">
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${meta.badgeClass}`}
        >
          <Icon name={meta.icon} size={12} weight="bold" className="shrink-0" />
          {meta.label}
        </span>
        {item.divergencia && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-sky-800 dark:text-sky-300">
            <Icon name="refresh" size={12} weight="bold" className="shrink-0" />
            Bodega
          </span>
        )}
        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-muted">
          <Icon name={rotacion.icon} size={12} weight="regular" className="shrink-0" />
          {rotacion.label}
        </span>
      </div>

      <div className="min-w-0">
        <p className="text-sm font-extrabold leading-snug text-ink break-words line-clamp-2">{item.nombre}</p>
        <p className="text-[11px] text-muted">SKU: {item.sku || "—"}</p>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="flex items-end gap-x-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wide text-muted">MeLi</p>
            <p className={`text-xl font-extrabold tabular-nums leading-none ${meta.stockClass}`}>{item.stock_meli}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wide text-muted">Siigo</p>
            <p className="text-base font-bold tabular-nums leading-none text-muted">
              {item.stock_siigo === null ? "—" : item.stock_siigo}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <ActionButton
            icon="plus"
            label="Unidades"
            onClick={() => setExpandido(expandido === "add" ? null : "add")}
            active={expandido === "add"}
          />
          <ActionButton
            icon="cart"
            label="Solicitar compra"
            onClick={() => setExpandido(expandido === "compra" ? null : "compra")}
            active={expandido === "compra"}
          />
          <ActionButton
            icon="check"
            label="Marcar revisado"
            onClick={() => void confirmarRevisado()}
            disabled={revisar.isPending}
          />
          {puedeEliminar && (
            <ActionButton
              icon="trash"
              label="Eliminar publicación"
              onClick={() => setExpandido(expandido === "eliminar" ? null : "eliminar")}
              active={expandido === "eliminar"}
            />
          )}
        </div>
      </div>

      {item.divergencia && (
        <p className="rounded-paper bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-800 dark:text-sky-300">
          Bodega {item.stock_siigo} ≠ MeLi — revisar sync.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{diasSinRevisarTexto(item.dias_sin_revisar)}</span>
        {expandido === "proveedor" ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={proveedorDraft}
              onChange={(e) => setProveedorDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void confirmarProveedor()}
              placeholder="Proveedor"
              className="w-28 rounded-paper border border-border bg-surface-input px-1.5 py-0.5 text-[11px] outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void confirmarProveedor()}
              className="rounded-paper border border-accent bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white"
            >
              OK
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
            {item.proveedor || "Proveedor…"}
          </button>
        )}
      </div>

      {aviso && <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{aviso}</p>}

      {expandido === "add" && (
        <div className="flex items-center gap-1.5 rounded-paper border border-border bg-surface-hover/50 p-2">
          <input
            type="number"
            min={1}
            value={cantidadAgregar}
            onChange={(e) => setCantidadAgregar(e.target.value)}
            className="w-16 rounded-paper border border-border bg-surface-input px-1.5 py-1 text-sm outline-none focus:border-accent"
          />
          <span className="text-[11px] text-muted">a MeLi</span>
          <button
            type="button"
            onClick={() => void confirmarAgregar()}
            disabled={ajustar.isPending}
            className="ml-auto rounded-paper border border-accent bg-accent px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
          >
            {ajustar.isPending ? "…" : "OK"}
          </button>
        </div>
      )}

      {expandido === "compra" && (
        <div className="space-y-1.5 rounded-paper border border-border bg-surface-hover/50 p-2">
          <div className="flex flex-wrap gap-1.5">
            <input
              type="number"
              min={1}
              placeholder="Cantidad"
              value={cantidadCompra}
              onChange={(e) => setCantidadCompra(e.target.value)}
              className="w-24 rounded-paper border border-border bg-surface-input px-1.5 py-1 text-sm outline-none focus:border-accent"
            />
            <input
              placeholder="Proveedor"
              value={proveedorCompra}
              onChange={(e) => setProveedorCompra(e.target.value)}
              className="min-w-0 flex-1 rounded-paper border border-border bg-surface-input px-1.5 py-1 text-sm outline-none focus:border-accent"
            />
          </div>
          <input
            placeholder="Motivo (opcional)"
            value={motivoCompra}
            onChange={(e) => setMotivoCompra(e.target.value)}
            className="w-full rounded-paper border border-border bg-surface-input px-1.5 py-1 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void confirmarCompra()}
            disabled={solicitarCompra.isPending}
            className="w-full rounded-paper border border-accent bg-accent px-2 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
          >
            {solicitarCompra.isPending ? "Enviando…" : "Solicitar compra"}
          </button>
        </div>
      )}

      {expandido === "eliminar" && (
        <div className="space-y-1.5 rounded-paper border border-danger/40 bg-danger/5 p-2">
          <p className="text-[11px] text-muted">Crea ticket para borrar en MeLi (no automático).</p>
          <input
            placeholder="Motivo (opcional)"
            value={motivoEliminar}
            onChange={(e) => setMotivoEliminar(e.target.value)}
            className="w-full rounded-paper border border-border bg-surface-input px-1.5 py-1 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void confirmarEliminar()}
            disabled={flagEliminar.isPending}
            className="w-full rounded-paper border border-danger bg-danger px-2 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
          >
            {flagEliminar.isPending ? "Enviando…" : "Crear ticket"}
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

function coincideBusqueda(item: ItemInventarioControl, q: string): boolean {
  if (!q) return true;
  const haystack = `${item.nombre} ${item.sku} ${item.meli_id} ${item.proveedor}`.toLowerCase();
  return haystack.includes(q);
}

export default function InventarioControlPanel() {
  const [filtro, setFiltro] = useState<Filtro>("urgentes");
  const [buscar, setBuscar] = useState("");
  const [buscarAbierto, setBuscarAbierto] = useState(false);
  const buscarInputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, isFetching, error } = useInventarioControlResumen();
  const refrescar = useRefrescarInventarioControl();
  const actualizando = isFetching || refrescar.isPending || Boolean(data?.cargando);

  const items = data?.items ?? [];
  const q = buscar.trim().toLowerCase();

  useEffect(() => {
    if (buscarAbierto) buscarInputRef.current?.focus();
  }, [buscarAbierto]);

  const conteos = useMemo(() => {
    const base = q ? items.filter((it) => coincideBusqueda(it, q)) : items;
    const c: Record<Filtro, number> = { urgentes: 0, bajo: 0, divergencias: 0, sin_revisar: 0, todo: base.length };
    for (const it of base) {
      if (coincideFiltro(it, "urgentes")) c.urgentes += 1;
      if (coincideFiltro(it, "bajo")) c.bajo += 1;
      if (coincideFiltro(it, "divergencias")) c.divergencias += 1;
      if (coincideFiltro(it, "sin_revisar")) c.sin_revisar += 1;
    }
    return c;
  }, [items, q]);

  const filtrados = useMemo(
    () => items.filter((it) => coincideFiltro(it, filtro) && coincideBusqueda(it, q)),
    [items, filtro, q],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto p-1.5 sm:p-2">
      <header className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <h1 className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-ink dark:text-white">
            <Icon name="listChecks" size={16} weight="duotone" className="shrink-0 text-accent" />
            Control de Inventario
          </h1>
          {buscarAbierto || q ? (
            <div className="flex min-w-0 max-w-xs flex-1 items-center gap-1 rounded-paper border border-border bg-surface-input px-1.5 py-0.5">
              <Icon name="search" size={12} weight="bold" className="shrink-0 text-muted" />
              <input
                ref={buscarInputRef}
                type="search"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                onBlur={() => {
                  if (!buscar.trim()) setBuscarAbierto(false);
                }}
                placeholder="Nombre, SKU, MCO…"
                className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted/50"
                aria-label="Buscar en inventario"
              />
              <button
                type="button"
                title="Cerrar búsqueda"
                onClick={() => {
                  setBuscar("");
                  setBuscarAbierto(false);
                }}
                className="rounded p-0.5 text-muted hover:text-ink"
              >
                <Icon name="close" size={11} weight="bold" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              title="Buscar"
              onClick={() => setBuscarAbierto(true)}
              className="inline-flex shrink-0 items-center justify-center rounded-paper p-1 text-muted transition hover:bg-surface-hover hover:text-ink"
            >
              <Icon name="search" size={16} weight="bold" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => refrescar.mutate()}
          disabled={refrescar.isPending}
          title={actualizando ? "Actualizando…" : "Actualizar"}
          aria-label={actualizando ? "Actualizando…" : "Actualizar"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-paper border border-accent bg-accent text-white"
        >
          <Icon name="refresh" size={14} weight="bold" className={actualizando ? "animate-spin" : undefined} />
        </button>
      </header>

      <div className="flex flex-wrap gap-1">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={`min-h-8 rounded-paper border px-2 py-1 text-xs font-bold transition ${
              filtro === f.id
                ? "border-accent bg-accent text-white"
                : "border-border bg-surface-panel text-ink hover:border-accent"
            }`}
          >
            {f.label} {conteos[f.id] > 0 && <span className="tabular-nums">({conteos[f.id]})</span>}
          </button>
        ))}
      </div>

      {(isLoading || data?.cargando) && (
        <p className="py-4 text-center text-xs text-muted">Cargando inventario…</p>
      )}
      {error && (
        <p className="rounded-paper border border-danger/40 bg-danger/10 p-2 text-xs font-semibold text-danger">
          {error instanceof Error ? error.message : "No se pudo cargar el inventario."}
        </p>
      )}
      {data?.error && (
        <p className="rounded-paper border border-amber-500/40 bg-amber-500/10 p-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
          {data.error}
        </p>
      )}

      {!isLoading && !data?.cargando && filtrados.length === 0 && (
        <p className="flex items-center justify-center gap-1 py-4 text-center text-xs text-muted">
          {q ? (
            <>
              <Icon name="search" size={14} weight="bold" className="shrink-0" />
              Sin resultados para “{buscar.trim()}”.
            </>
          ) : filtro === "urgentes" ? (
            <>
              <Icon name="check" size={14} weight="bold" className="shrink-0 text-emerald-600" />
              Nada urgente por ahora.
            </>
          ) : (
            "Sin productos en este filtro."
          )}
        </p>
      )}

      <div className="grid grid-cols-1 gap-1.5 pb-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtrados.map((it) => (
          <InventarioCard key={it.meli_id} item={it} />
        ))}
      </div>
    </div>
  );
}
