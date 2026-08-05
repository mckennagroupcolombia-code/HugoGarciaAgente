import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
interface StockItem {
  meli_id: string;
  sku: string;
  nombre: string;
  stock: number;
  fila?: number | null;
  estado_meli?: string;
  es_full?: boolean;
  sync_bloqueado?: boolean;
  permalink?: string;
  precio?: number | null;
  moneda?: string;
}

interface StockResumen {
  items: StockItem[];
  total: number;
}

interface CanalResultado {
  ok?: boolean;
  mensaje: string;
  stock?: number | null;
  numerico?: boolean;
  no_aplica?: boolean;
}

interface SincronizarResultado {
  sku: string;
  stock_objetivo: number;
  stock_anterior?: number;
  delta?: number;
  meli: CanalResultado;
  web: CanalResultado;
  siigo: CanalResultado;
}

type FiltroCodigo =
  | "todos"
  | "vinculados"
  | "sin_siigo"
  | "divergentes"
  | "sin_codigo"
  | "sin_c";

type FiltroStock = "todos" | "agotados" | "criticos" | "bajos" | "ok" | "sin_dato";

type FiltroRotacion = "todos" | "sin_ventas" | "baja" | "media" | "alta";

type FiltroPublicacion = "todos" | "activas" | "inactivas";

const STOCK_FILTROS_KEY = "mckenna-stock-filtros";

interface StockFiltrosPersistidos {
  search?: string;
  filtroStock?: FiltroStock;
  filtroCodigo?: FiltroCodigo;
  filtroRotacion?: FiltroRotacion;
  filtroPublicacion?: FiltroPublicacion;
}

const FILTRO_STOCK_OK = new Set<FiltroStock>(["todos", "agotados", "criticos", "bajos", "ok", "sin_dato"]);
const FILTRO_CODIGO_OK = new Set<FiltroCodigo>([
  "todos",
  "vinculados",
  "sin_siigo",
  "divergentes",
  "sin_codigo",
  "sin_c",
]);
const FILTRO_ROTACION_OK = new Set<FiltroRotacion>(["todos", "sin_ventas", "baja", "media", "alta"]);
const FILTRO_PUB_OK = new Set<FiltroPublicacion>(["todos", "activas", "inactivas"]);

function leerFiltrosStock(): StockFiltrosPersistidos {
  try {
    const raw = localStorage.getItem(STOCK_FILTROS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StockFiltrosPersistidos;
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      filtroStock: FILTRO_STOCK_OK.has(parsed.filtroStock as FiltroStock)
        ? (parsed.filtroStock as FiltroStock)
        : "todos",
      filtroCodigo: FILTRO_CODIGO_OK.has(parsed.filtroCodigo as FiltroCodigo)
        ? (parsed.filtroCodigo as FiltroCodigo)
        : "todos",
      filtroRotacion: FILTRO_ROTACION_OK.has(parsed.filtroRotacion as FiltroRotacion)
        ? (parsed.filtroRotacion as FiltroRotacion)
        : "todos",
      filtroPublicacion: FILTRO_PUB_OK.has(parsed.filtroPublicacion as FiltroPublicacion)
        ? (parsed.filtroPublicacion as FiltroPublicacion)
        : "todos",
    };
  } catch {
    return {};
  }
}

function guardarFiltrosStock(f: StockFiltrosPersistidos): void {
  try {
    localStorage.setItem(STOCK_FILTROS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

function nivelRotacion(venta: VentaItem30d | undefined): Exclude<FiltroRotacion, "todos"> {
  const uds = venta?.unidades ?? 0;
  if (!venta || uds <= 0) return "sin_ventas";
  if (venta.nivel === "alta" || uds > 10) return "alta";
  if (venta.nivel === "media" || uds > 2) return "media";
  return "baja";
}

function esPublicacionActiva(estado?: string, syncBloqueado?: boolean): boolean {
  const e = (estado || "").toLowerCase();
  if (e === "active") return true;
  if (!e && !syncBloqueado) return true;
  return false;
}

const SELECT_FILTRO =
  "min-w-[10.5rem] rounded-lg border border-border bg-surface-input px-2.5 py-2 text-xs font-semibold text-ink outline-none focus:border-accent";

interface RelacionItem {
  meli_id: string;
  titulo: string;
  sku_meli: string;
  codigo_siigo: string;
  nombre_siigo: string;
  en_siigo: boolean;
  sku_coincide: boolean;
  estado: string;
  permalink?: string;
  tiene_override?: boolean;
  estado_meli?: string;
}

interface RelacionResp {
  items: RelacionItem[];
  totales: {
    total: number;
    vinculados: number;
    sin_siigo: number;
    divergentes: number;
    sin_codigo: number;
    sin_c: number;
    filtrados: number;
  };
  actualizado_en?: string | null;
  fuente?: string;
  error?: string | null;
}

interface FilaUnificada {
  meli_id: string;
  nombre: string;
  stock: number | null;
  sku: string;
  codigo_siigo: string;
  nombre_siigo: string;
  estado_vinculo: string;
  en_siigo: boolean;
  permalink?: string;
  sync_bloqueado?: boolean;
  estado_meli?: string;
  es_full?: boolean;
  precio?: number | null;
  moneda?: string;
}

interface VentaItem30d {
  unidades: number;
  ordenes: number;
  monto: number;
  ritmo_diario: number;
  nivel: "sin_ventas" | "baja" | "media" | "alta" | string;
}

interface Ventas30dResp {
  dias: number;
  actualizado_en?: string | null;
  fuente?: string;
  ordenes?: number;
  por_item: Record<string, VentaItem30d>;
  error?: string;
}

function analisisVentas(
  venta: VentaItem30d | undefined,
  stock: number | null,
): { label: string; detail: string; className: string; uds: number } {
  const uds = venta?.unidades ?? 0;
  const ordenes = venta?.ordenes ?? 0;
  const ritmo = venta?.ritmo_diario ?? 0;
  if (!venta || uds <= 0) {
    const estancado = stock != null && stock > 5;
    return {
      label: estancado ? "Sin rotación" : "Sin ventas",
      detail: "0 uds · 30 d",
      className: estancado
        ? "bg-danger/15 text-danger"
        : "bg-muted/20 text-muted",
      uds: 0,
    };
  }
  let cobertura = "";
  if (stock != null && ritmo > 0) {
    const dias = Math.round(stock / ritmo);
    cobertura = ` · ~${dias} d stock`;
  }
  const detail = `${uds} uds · ${ordenes} ped.${cobertura}`;
  if (venta.nivel === "alta" || uds > 10) {
    return {
      label: stock != null && stock <= 5 ? "Agotar pronto" : "Alta rotación",
      detail,
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      uds,
    };
  }
  if (venta.nivel === "media" || uds > 2) {
    return {
      label: "Rotación media",
      detail,
      className: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
      uds,
    };
  }
  return {
    label: "Baja rotación",
    detail,
    className: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    uds,
  };
}

function formatCopCorto(n: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function formatPrecioVenta(precio: number | null | undefined, moneda = "COP"): string {
  if (precio == null || Number.isNaN(Number(precio))) return "Sin precio";
  const n = Number(precio);
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: moneda || "COP",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString("es-CO")} ${moneda || "COP"}`;
  }
}

const ESTADO_MELI_LABELS: Record<string, string> = {
  active: "Activa",
  paused: "Pausada",
  closed: "Cerrada",
  inactive: "Inactiva",
  under_review: "En revisión",
};

function badgePublicacion(
  estado?: string,
  syncBloqueado?: boolean,
): { label: string; className: string } {
  const e = (estado || "").toLowerCase();
  if (e === "active" || (!e && !syncBloqueado)) {
    return {
      label: "Activa",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    };
  }
  if (e === "paused") {
    return {
      label: "Pausada",
      className: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    };
  }
  if (e === "under_review") {
    return {
      label: "En revisión",
      className: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
    };
  }
  if (e === "closed" || e === "inactive") {
    return {
      label: ESTADO_MELI_LABELS[e] ?? "No activa",
      className: "bg-muted/25 text-muted",
    };
  }
  return {
    label: ESTADO_MELI_LABELS[e] || (syncBloqueado ? "No activa" : estado || "—"),
    className: syncBloqueado
      ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
      : "bg-muted/25 text-muted",
  };
}

const ESTADO_RELACION: Record<string, { label: string; className: string }> = {
  vinculado: {
    label: "Vinculado",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  sin_siigo: {
    label: "Sin Siigo",
    className: "bg-danger/15 text-danger",
  },
  sku_divergente: {
    label: "SKU distinto",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  sin_codigo: {
    label: "Sin código",
    className: "bg-muted/20 text-muted",
  },
};

function nivelStock(stock: number | null | undefined): {
  key: FiltroStock | "ok";
  label: string;
  rowClass: string;
  badgeClass: string;
  stockClass: string;
} {
  if (stock == null || Number.isNaN(stock)) {
    return {
      key: "sin_dato",
      label: "Sin dato",
      rowClass: "bg-surface-panel/40 border-l-4 border-muted/40",
      badgeClass: "bg-muted/20 text-muted",
      stockClass: "text-muted",
    };
  }
  if (stock <= 0) {
    return {
      key: "agotados",
      label: "Agotado",
      rowClass: "bg-danger/10 border-l-4 border-danger",
      badgeClass: "bg-danger/20 text-danger",
      stockClass: "text-danger font-extrabold",
    };
  }
  if (stock === 1) {
    return {
      key: "criticos",
      label: "Última ud.",
      rowClass: "bg-amber-500/15 border-l-4 border-amber-500",
      badgeClass: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
      stockClass: "text-amber-700 dark:text-amber-300 font-extrabold",
    };
  }
  if (stock <= 5) {
    return {
      key: "bajos",
      label: "Bajo",
      rowClass: "bg-orange-500/10 border-l-4 border-orange-400",
      badgeClass: "bg-orange-500/20 text-orange-800 dark:text-orange-300",
      stockClass: "text-orange-700 dark:text-orange-300 font-bold",
    };
  }
  return {
    key: "ok",
    label: "OK",
    rowClass: "bg-emerald-500/[0.06] border-l-4 border-emerald-500/50",
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    stockClass: "text-emerald-700 dark:text-emerald-400 font-bold",
  };
}

function tienePrefijoC(sku: string, codigoSiigo: string): boolean {
  const compact = (s: string) => (s || "").replace(/\s+/g, "").toUpperCase();
  return compact(sku).startsWith("C-") || compact(codigoSiigo).startsWith("C-");
}

function CanalResultMini({ resultado }: { resultado: SincronizarResultado }) {
  const detalle = `MeLi ${resultado.meli.ok ? "✓" : "✗"} · Web ${resultado.web.ok ? "✓" : "✗"} · Siigo ref.`;
  return (
    <div className="mt-0.5 truncate text-[9px] leading-tight text-muted" title={detalle}>
      {typeof resultado.stock_anterior === "number" && (
        <span>
          {resultado.stock_anterior}→
          <span className="font-bold text-ink">{resultado.stock_objetivo}</span>
          {typeof resultado.delta === "number" && (
            <span>
              {" "}
              ({resultado.delta >= 0 ? "+" : ""}
              {resultado.delta})
            </span>
          )}
          {" · "}
        </span>
      )}
      <span>{detalle}</span>
    </div>
  );
}

interface DetalleProductoResp {
  meli_id?: string | null;
  sku?: string | null;
  nombre?: string | null;
  permalink?: string | null;
  estado_meli?: string | null;
  stock?: number | null;
  precio?: number | null;
  moneda?: string;
  error_meli?: string | null;
  rentabilidad?: {
    sku?: string;
    precio_venta?: number | null;
    costo_real?: number | null;
    sin_costo?: number | null;
    cargo_venta?: number | null;
    cargo_envio?: number | null;
    cobros_meli?: number | null;
    ganancia?: number | null;
    margen_pct?: number | null;
    free_shipping?: boolean | null;
    error?: string;
  } | null;
}

function DialogPrecioVenta({
  fila,
  analisis,
  onClose,
  onPrecioActualizado,
}: {
  fila: FilaUnificada;
  analisis: { label: string; detail: string; className: string; uds: number };
  onClose: () => void;
  onPrecioActualizado?: (precio: number) => void;
}) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [nuevoPrecio, setNuevoPrecio] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msgOk, setMsgOk] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState<string | null>(null);
  const [precioLocal, setPrecioLocal] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editando && !guardando) {
          setEditando(false);
          setMsgErr(null);
          return;
        }
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, editando, guardando]);

  const detalleQ = useQuery<DetalleProductoResp>({
    queryKey: ["stock-detalle-producto", fila.meli_id, fila.sku],
    queryFn: () => {
      const params = new URLSearchParams();
      if (fila.meli_id) params.set("meli_id", fila.meli_id);
      if (fila.sku) params.set("sku", fila.sku);
      return api.get<DetalleProductoResp>(`/api/stock/detalle-producto?${params}`, {
        timeoutMs: 90_000,
      });
    },
    staleTime: 60_000,
  });

  const d = detalleQ.data;
  const rent = d?.rentabilidad && !d.rentabilidad.error ? d.rentabilidad : null;
  const precioBase =
    precioLocal ?? d?.precio ?? rent?.precio_venta ?? fila.precio ?? null;
  const moneda = d?.moneda || fila.moneda || "COP";
  const pub = badgePublicacion(d?.estado_meli || fila.estado_meli, fila.sync_bloqueado);
  const stock = d?.stock ?? fila.stock;
  const nivel = nivelStock(stock);
  const permalink = d?.permalink || fila.permalink;
  const codePrecio = (fila.sku || fila.codigo_siigo || "").trim();

  // Recalcular ganancia/margen en vivo si el usuario acaba de cambiar el precio
  let gananciaShow = rent?.ganancia ?? null;
  let margenPct =
    rent?.margen_pct != null ? Math.round(Number(rent.margen_pct) * 10000) / 100 : null;
  if (
    precioLocal != null &&
    rent?.costo_real != null &&
    rent?.cobros_meli != null &&
    precioBase != null &&
    precioBase > 0
  ) {
    const oldPv = rent.precio_venta ?? d?.precio ?? fila.precio;
    let cobros = rent.cobros_meli;
    if (
      oldPv != null &&
      oldPv > 0 &&
      rent.cargo_venta != null &&
      rent.cargo_envio != null
    ) {
      const cargoVenta =
        Math.round((rent.cargo_venta * (precioLocal / oldPv)) * 100) / 100;
      cobros = Math.round((cargoVenta + (rent.cargo_envio || 0)) * 100) / 100;
    }
    gananciaShow = Math.round((precioLocal - rent.costo_real - cobros) * 100) / 100;
    margenPct = Math.round((gananciaShow / precioLocal) * 10000) / 100;
  }

  const abrirEditor = () => {
    if (precioBase == null || !codePrecio) return;
    setNuevoPrecio(String(Math.round(Number(precioBase))));
    setEditando(true);
    setMsgOk(null);
    setMsgErr(null);
  };

  const guardarPrecio = async () => {
    const precio = parseFloat(nuevoPrecio);
    if (!codePrecio || Number.isNaN(precio) || precio <= 0) {
      setMsgErr("Ingresa un precio mayor que 0");
      return;
    }
    setGuardando(true);
    setMsgErr(null);
    setMsgOk(null);
    try {
      type ActPrecioRes = {
        ok?: boolean;
        error?: string;
        meli?: { ok?: boolean; msg?: string };
        siigo?: { ok?: boolean; msg?: string };
      };
      const res = await api.post<ActPrecioRes>(
        "/api/rentabilidad/actualizar-precio",
        {
          code: codePrecio,
          nuevo_precio: precio,
          plataformas: ["meli", "siigo"],
          nombre: d?.nombre || fila.nombre || "",
          meli_id: fila.meli_id || "",
        },
        { timeoutMs: 60_000 },
      );
      const meliOk = Boolean(res.meli?.ok);
      const siigoOk = Boolean(res.siigo?.ok);
      if (!meliOk || !siigoOk) {
        const partes: string[] = [];
        partes.push(meliOk ? "MeLi" : `MeLi ✗ ${res.meli?.msg || "falló"}`);
        partes.push(siigoOk ? "Siigo" : `Siigo ✗ ${res.siigo?.msg || "falló"}`);
        setMsgErr(res.error || `No se pudo actualizar: ${partes.join(" · ")}`);
        return;
      }
      setPrecioLocal(precio);
      setEditando(false);
      setMsgOk("MeLi + Siigo OK");
      onPrecioActualizado?.(precio);
      void queryClient.invalidateQueries({ queryKey: ["stock-detalle-producto", fila.meli_id, fila.sku] });
      void queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
    } catch (e) {
      setMsgErr((e as Error).message || "No se pudo actualizar el precio");
    } finally {
      setGuardando(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[700] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-precio-titulo"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto overflow-x-hidden rounded-2xl border border-border bg-surface-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface-panel px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Precio de venta</p>
            <h3 id="dialog-precio-titulo" className="mt-0.5 text-sm font-bold leading-snug text-ink">
              {d?.nombre || fila.nombre || "Producto"}
            </h3>
            <p className="mt-0.5 font-mono text-[10px] text-muted">{fila.meli_id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-muted hover:bg-surface-hover hover:text-ink"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="rounded-xl border border-accent/25 bg-accent/10 px-4 py-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wide text-accent">MeLi · lista</p>
            {detalleQ.isLoading && !editando ? (
              <p className="mt-2 text-sm text-muted">Cargando precio…</p>
            ) : editando ? (
              <div className="mt-2 space-y-2">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={nuevoPrecio}
                  onChange={(e) => setNuevoPrecio(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void guardarPrecio();
                    if (e.key === "Escape" && !guardando) {
                      setEditando(false);
                      setMsgErr(null);
                    }
                  }}
                  className="mx-auto w-40 rounded-lg border border-accent bg-surface px-3 py-2 text-center text-xl font-extrabold tabular-nums text-ink outline-none"
                  autoFocus
                  disabled={guardando}
                />
                <p className="text-[11px] text-muted">{moneda} · actualiza MeLi y Siigo</p>
                <div className="flex justify-center gap-2">
                  <button
                    type="button"
                    disabled={guardando || !(parseFloat(nuevoPrecio) > 0)}
                    onClick={() => void guardarPrecio()}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                  >
                    {guardando ? "Guardando…" : "Guardar"}
                  </button>
                  <button
                    type="button"
                    disabled={guardando}
                    onClick={() => {
                      setEditando(false);
                      setMsgErr(null);
                    }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={precioBase == null || !codePrecio}
                  onClick={abrirEditor}
                  className={`mt-1 text-2xl font-extrabold tabular-nums transition ${
                    precioBase != null && codePrecio
                      ? "text-accent hover:underline"
                      : "cursor-default text-ink"
                  }`}
                  title={
                    precioBase != null && codePrecio
                      ? "Clic para editar precio (MeLi + Siigo)"
                      : "Sin SKU o precio para editar"
                  }
                >
                  {formatPrecioVenta(precioBase, moneda)}
                </button>
                {precioBase != null && (
                  <p className="mt-0.5 text-[11px] text-muted">
                    {moneda}
                    {codePrecio ? " · clic para editar" : ""}
                  </p>
                )}
                {d?.error_meli && precioBase == null && (
                  <p className="mt-1 text-[11px] text-danger">{d.error_meli}</p>
                )}
              </>
            )}
            {msgOk && (
              <p className="mt-2 text-[11px] font-bold text-emerald-600">{msgOk}</p>
            )}
            {msgErr && (
              <p className="mt-2 text-[11px] font-semibold text-danger">{msgErr}</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
              Rentabilidad general
            </p>
            {detalleQ.isLoading ? (
              <p className="mt-2 text-xs text-muted">Calculando margen…</p>
            ) : d?.rentabilidad?.error ? (
              <p className="mt-2 text-xs text-danger">{d.rentabilidad.error}</p>
            ) : !rent ? (
              <p className="mt-2 text-xs text-muted">
                Sin datos de rentabilidad para este SKU. Revisa la pestaña Rentabilidad.
              </p>
            ) : (
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-border/70 bg-surface-panel px-2.5 py-2">
                  <dt className="text-[9px] font-bold uppercase text-muted">Costo real</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-ink">
                    {formatPrecioVenta(rent.costo_real, "COP")}
                    {rent.sin_costo != null && rent.sin_costo > 0 && (
                      <span className="ml-1 text-[9px] font-semibold text-amber-600">
                        · {rent.sin_costo} sin costo
                      </span>
                    )}
                  </dd>
                </div>
                <div className="rounded-lg border border-border/70 bg-surface-panel px-2.5 py-2">
                  <dt className="text-[9px] font-bold uppercase text-muted">Cobros MeLi</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-ink">
                    {formatPrecioVenta(rent.cobros_meli, "COP")}
                  </dd>
                  {(rent.cargo_venta != null || rent.cargo_envio != null) && (
                    <p className="mt-0.5 text-[9px] text-muted">
                      venta {formatPrecioVenta(rent.cargo_venta, "COP")}
                      {rent.free_shipping ? " · envío gratis" : ""}
                      {rent.cargo_envio != null ? ` · envío ${formatPrecioVenta(rent.cargo_envio, "COP")}` : ""}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-border/70 bg-surface-panel px-2.5 py-2">
                  <dt className="text-[9px] font-bold uppercase text-muted">Ganancia</dt>
                  <dd
                    className={`mt-0.5 text-base font-extrabold tabular-nums ${
                      gananciaShow == null
                        ? "text-muted"
                        : gananciaShow >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-danger"
                    }`}
                  >
                    {formatPrecioVenta(gananciaShow, "COP")}
                  </dd>
                </div>
                <div className="rounded-lg border border-border/70 bg-surface-panel px-2.5 py-2">
                  <dt className="text-[9px] font-bold uppercase text-muted">Margen</dt>
                  <dd
                    className={`mt-0.5 text-base font-extrabold tabular-nums ${
                      margenPct == null
                        ? "text-muted"
                        : margenPct >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-danger"
                    }`}
                  >
                    {margenPct == null ? "—" : `${margenPct.toFixed(1)}%`}
                  </dd>
                </div>
              </dl>
            )}
            <p className="mt-2 text-[9px] leading-snug text-muted">
              Ganancia = precio de venta − costo real − cobros MeLi (venta + envío).
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-[10px] font-bold uppercase text-muted">Publicación</dt>
              <dd className="mt-0.5">
                <span className={`inline-block rounded-full px-1.5 py-px text-[10px] font-bold ${pub.className}`}>
                  {pub.label}
                </span>
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-[10px] font-bold uppercase text-muted">Stock</dt>
              <dd className={`mt-0.5 font-bold tabular-nums ${nivel.stockClass}`}>
                {stock == null ? "—" : stock}{" "}
                <span className={`rounded-full px-1.5 py-px text-[9px] font-bold ${nivel.badgeClass}`}>
                  {nivel.label}
                </span>
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-[10px] font-bold uppercase text-muted">SKU MeLi</dt>
              <dd className="mt-0.5 truncate font-mono text-ink">{fila.sku || "—"}</dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-[10px] font-bold uppercase text-muted">Código Siigo</dt>
              <dd className="mt-0.5 truncate font-mono text-ink">{fila.codigo_siigo || "—"}</dd>
            </div>
            <div className="col-span-2 rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-[10px] font-bold uppercase text-muted">Ventas 30 d</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${analisis.className}`}>
                  {analisis.label}
                </span>
                <span className="text-muted">{analisis.detail}</span>
              </dd>
            </div>
          </dl>

          {detalleQ.isError && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {detalleQ.error instanceof Error
                ? detalleQ.error.message
                : "No se pudo cargar el detalle"}
            </p>
          )}

          {permalink && (
            <a
              href={permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center rounded-xl bg-accent px-3 py-2.5 text-xs font-bold text-white transition hover:bg-accent-hover"
            >
              Abrir publicación en MeLi ↗
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function StockPanel() {
  const filtrosIniciales = useMemo(() => leerFiltrosStock(), []);
  const [search, setSearch] = useState(filtrosIniciales.search ?? "");
  const [filtroStock, setFiltroStock] = useState<FiltroStock>(filtrosIniciales.filtroStock ?? "todos");
  const [filtroCodigo, setFiltroCodigo] = useState<FiltroCodigo>(filtrosIniciales.filtroCodigo ?? "todos");
  const [filtroRotacion, setFiltroRotacion] = useState<FiltroRotacion>(
    filtrosIniciales.filtroRotacion ?? "todos",
  );
  const [filtroPublicacion, setFiltroPublicacion] = useState<FiltroPublicacion>(
    filtrosIniciales.filtroPublicacion ?? "todos",
  );
  const [detalleProducto, setDetalleProducto] = useState<FilaUnificada | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rowResult, setRowResult] = useState<Record<string, SincronizarResultado>>({});
  const [skuMsg, setSkuMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [editMeli, setEditMeli] = useState<string | null>(null);
  const [skuDraft, setSkuDraft] = useState("");
  const [codigoDraft, setCodigoDraft] = useState("");
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const forceRefreshRelacionRef = useRef(false);
  const forceRefreshVentasRef = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    guardarFiltrosStock({
      search,
      filtroStock,
      filtroCodigo,
      filtroRotacion,
      filtroPublicacion,
    });
  }, [search, filtroStock, filtroCodigo, filtroRotacion, filtroPublicacion]);

  const stockQ = useQuery<StockResumen>({
    queryKey: ["stock-resumen"],
    queryFn: () => api.get<StockResumen>("/api/stock/resumen"),
    staleTime: 60_000,
  });

  const relacionQ = useQuery<RelacionResp>({
    queryKey: ["relacion-codigos", "unificado"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (forceRefreshRelacionRef.current) {
        params.set("refresh", "1");
        forceRefreshRelacionRef.current = false;
      }
      const qs = params.toString();
      return api.get<RelacionResp>(`/api/stock/relacion-codigos${qs ? `?${qs}` : ""}`, {
        timeoutMs: 180_000,
      });
    },
    staleTime: 60_000,
  });

  const ventasQ = useQuery<Ventas30dResp>({
    queryKey: ["stock-ventas-30d"],
    queryFn: async () => {
      const params = new URLSearchParams({ dias: "30" });
      if (forceRefreshVentasRef.current) {
        params.set("refresh", "1");
        forceRefreshVentasRef.current = false;
      }
      return api.get<Ventas30dResp>(`/api/stock/ventas-30d?${params}`, {
        timeoutMs: 180_000,
      });
    },
    staleTime: 5 * 60_000,
  });

  const filas = useMemo(() => {
    const byId = new Map<string, FilaUnificada>();
    const noOperable = (estado?: string) => {
      const e = (estado || "").toLowerCase();
      return e === "closed" || e === "inactive";
    };

    for (const s of stockQ.data?.items ?? []) {
      if (noOperable(s.estado_meli)) continue;
      byId.set(s.meli_id, {
        meli_id: s.meli_id,
        nombre: s.nombre,
        stock: s.stock,
        sku: s.sku || "",
        codigo_siigo: s.sku || "",
        nombre_siigo: "",
        estado_vinculo: s.sku ? "sin_siigo" : "sin_codigo",
        en_siigo: false,
        permalink: s.permalink,
        sync_bloqueado: s.sync_bloqueado,
        estado_meli: s.estado_meli,
        es_full: s.es_full,
        precio: s.precio ?? null,
        moneda: s.moneda || "COP",
      });
    }

    for (const r of relacionQ.data?.items ?? []) {
      const estadoMeli = r.estado_meli;
      if (noOperable(estadoMeli)) continue;
      const prev = byId.get(r.meli_id);
      if (prev) {
        byId.set(r.meli_id, {
          ...prev,
          nombre: prev.nombre || r.titulo,
          sku: r.sku_meli || prev.sku,
          codigo_siigo: r.codigo_siigo || prev.codigo_siigo,
          nombre_siigo: r.nombre_siigo || "",
          estado_vinculo: r.estado,
          en_siigo: r.en_siigo,
          permalink: prev.permalink || r.permalink,
          estado_meli: prev.estado_meli || estadoMeli,
        });
      } else {
        byId.set(r.meli_id, {
          meli_id: r.meli_id,
          nombre: r.titulo,
          stock: null,
          sku: r.sku_meli || "",
          codigo_siigo: r.codigo_siigo || "",
          nombre_siigo: r.nombre_siigo || "",
          estado_vinculo: r.estado,
          en_siigo: r.en_siigo,
          permalink: r.permalink,
          estado_meli: estadoMeli,
          sync_bloqueado: Boolean(estadoMeli && estadoMeli.toLowerCase() !== "active"),
        });
      }
    }

    return Array.from(byId.values());
  }, [stockQ.data, relacionQ.data]);

  const counts = useMemo(() => {
    let agotados = 0;
    let criticos = 0;
    let bajos = 0;
    let ok = 0;
    let sinDato = 0;
    let sinSku = 0;
    let sinC = 0;
    let vinculados = 0;
    let sinSiigo = 0;
    let divergentes = 0;
    let sinCodigo = 0;
    let sinVentas = 0;
    let rotBaja = 0;
    let rotMedia = 0;
    let rotAlta = 0;
    let activas = 0;
    let inactivas = 0;
    const rawVentas = ventasQ.data?.por_item ?? {};
    for (const f of filas) {
      const n = nivelStock(f.stock);
      if (n.key === "agotados") agotados += 1;
      else if (n.key === "criticos") criticos += 1;
      else if (n.key === "bajos") bajos += 1;
      else if (n.key === "ok") ok += 1;
      else sinDato += 1;
      if (!f.sku.trim()) sinSku += 1;
      if (!tienePrefijoC(f.sku, f.codigo_siigo)) sinC += 1;
      if (f.estado_vinculo === "vinculado") vinculados += 1;
      else if (f.estado_vinculo === "sin_siigo") sinSiigo += 1;
      else if (f.estado_vinculo === "sku_divergente") divergentes += 1;
      else if (f.estado_vinculo === "sin_codigo") sinCodigo += 1;
      if (esPublicacionActiva(f.estado_meli, f.sync_bloqueado)) activas += 1;
      else inactivas += 1;
      const mid = (f.meli_id || "").toUpperCase();
      const venta = rawVentas[mid] ?? rawVentas[f.meli_id];
      const rot = nivelRotacion(venta);
      if (rot === "sin_ventas") sinVentas += 1;
      else if (rot === "baja") rotBaja += 1;
      else if (rot === "media") rotMedia += 1;
      else rotAlta += 1;
    }
    return {
      total: filas.length,
      agotados,
      criticos,
      bajos,
      ok,
      sinDato,
      sinSku,
      sinC,
      vinculados,
      sinSiigo,
      divergentes,
      sinCodigo,
      sinVentas,
      rotBaja,
      rotMedia,
      rotAlta,
      activas,
      inactivas,
    };
  }, [filas, ventasQ.data]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = filas;
    if (q) {
      list = list.filter(
        (f) =>
          f.nombre.toLowerCase().includes(q) ||
          f.sku.toLowerCase().includes(q) ||
          f.codigo_siigo.toLowerCase().includes(q) ||
          f.meli_id.toLowerCase().includes(q) ||
          f.nombre_siigo.toLowerCase().includes(q),
      );
    }
    if (filtroStock !== "todos") {
      list = list.filter((f) => nivelStock(f.stock).key === filtroStock);
    }
    if (filtroCodigo === "vinculados") {
      list = list.filter((f) => f.estado_vinculo === "vinculado");
    } else if (filtroCodigo === "sin_siigo") {
      list = list.filter((f) => f.estado_vinculo === "sin_siigo");
    } else if (filtroCodigo === "divergentes") {
      list = list.filter((f) => f.estado_vinculo === "sku_divergente");
    } else if (filtroCodigo === "sin_codigo") {
      list = list.filter((f) => f.estado_vinculo === "sin_codigo");
    } else if (filtroCodigo === "sin_c") {
      list = list.filter((f) => !tienePrefijoC(f.sku, f.codigo_siigo));
    }
    const rawVentas = ventasQ.data?.por_item ?? {};
    if (filtroRotacion !== "todos") {
      list = list.filter((f) => {
        const mid = (f.meli_id || "").toUpperCase();
        const venta = rawVentas[mid] ?? rawVentas[f.meli_id];
        return nivelRotacion(venta) === filtroRotacion;
      });
    }
    if (filtroPublicacion === "activas") {
      list = list.filter((f) => esPublicacionActiva(f.estado_meli, f.sync_bloqueado));
    } else if (filtroPublicacion === "inactivas") {
      list = list.filter((f) => !esPublicacionActiva(f.estado_meli, f.sync_bloqueado));
    }
    return [...list].sort((a, b) => {
      // Priorizar sin ventas con stock, luego menos stock
      const ka = (a.meli_id || "").toUpperCase();
      const kb = (b.meli_id || "").toUpperCase();
      const va = (rawVentas[ka] ?? rawVentas[a.meli_id])?.unidades ?? 0;
      const vb = (rawVentas[kb] ?? rawVentas[b.meli_id])?.unidades ?? 0;
      if (va === 0 && vb > 0) return -1;
      if (vb === 0 && va > 0) return 1;
      const sa = a.stock ?? 999999;
      const sb = b.stock ?? 999999;
      if (sa !== sb) return sa - sb;
      return vb - va;
    });
  }, [filas, search, filtroStock, filtroCodigo, filtroRotacion, filtroPublicacion, ventasQ.data]);

  const errorResultado = (sku: string, message: string): SincronizarResultado => ({
    sku,
    stock_objetivo: 0,
    meli: { ok: false, mensaje: `Error: ${message}` },
    web: { ok: false, mensaje: "—" },
    siigo: { stock: null, mensaje: "—" },
  });

  const ajustarMut = useMutation({
    mutationFn: ({ sku, meli_id, delta }: { sku: string; meli_id: string; delta: number }) =>
      api.post<SincronizarResultado>("/api/stock/ajustar", { sku, meli_id, delta }),
    onMutate: ({ meli_id }) => setBusyKey(meli_id),
    onSuccess: (res, { meli_id }) => {
      setRowResult((prev) => ({ ...prev, [meli_id]: res }));
      queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
    },
    onError: (err, { sku, meli_id }) =>
      setRowResult((prev) => ({ ...prev, [meli_id]: errorResultado(sku, err.message) })),
    onSettled: () => setBusyKey(null),
  });

  const sincronizarUnoMut = useMutation({
    mutationFn: ({ sku, stock, meli_id }: { sku: string; stock: number; meli_id: string }) =>
      api.post<SincronizarResultado>("/api/stock/sincronizar", { sku, stock, meli_id }),
    onMutate: ({ meli_id }) => setBusyKey(meli_id),
    onSuccess: (res, { meli_id }) => setRowResult((prev) => ({ ...prev, [meli_id]: res })),
    onError: (err, { sku, meli_id }) =>
      setRowResult((prev) => ({ ...prev, [meli_id]: errorResultado(sku, err.message) })),
    onSettled: () => setBusyKey(null),
  });

  const editarMut = useMutation({
    mutationFn: ({
      meli_id,
      sku_meli,
      codigo_siigo,
    }: {
      meli_id: string;
      sku_meli: string;
      codigo_siigo: string;
    }) =>
      api.post<{
        ok?: boolean;
        aviso?: string;
        meli?: {
          sku_meli?: string;
          cargado_en_meli?: boolean;
          error?: string;
          sheets?: { ok?: boolean; mensaje?: string };
        };
        vinculo?: { codigo_siigo?: string; en_siigo?: boolean; nombre_siigo?: string };
      }>(
        "/api/stock/relacion-codigos/editar",
        {
          meli_id,
          sku_meli,
          codigo_siigo: codigo_siigo || sku_meli,
          vincular_si_sku: true,
        },
        { timeoutMs: 90_000 },
      ),
    onMutate: ({ meli_id }) => {
      setBusyKey(meli_id);
      setSkuMsg((prev) => {
        const next = { ...prev };
        delete next[meli_id];
        return next;
      });
    },
    onSuccess: (res, { meli_id, sku_meli, codigo_siigo }) => {
      const escrito = res?.meli?.sku_meli || sku_meli;
      const codigo = res?.vinculo?.codigo_siigo || codigo_siigo || sku_meli;
      const meliOk = res?.meli?.cargado_en_meli !== false && !res?.meli?.error;
      const sheets = res?.meli?.sheets;
      const partes: string[] = [];
      if (meliOk) partes.push(`MeLi «${escrito}»`);
      else if (res?.meli?.error || res?.aviso)
        partes.push(`MeLi no actualizó (${res?.meli?.error || res?.aviso})`);
      if (res?.vinculo) {
        partes.push(
          `vínculo Siigo «${codigo}»${
            res.vinculo.en_siigo ? " OK" : " (local)"
          }`,
        );
      }
      if (sheets?.ok) partes.push("Sheets OK");
      else if (sheets?.ok === false) partes.push(`Sheets: ${sheets.mensaje || "no"}`);
      setSkuMsg((prev) => ({
        ...prev,
        [meli_id]: {
          ok: Boolean(res?.ok !== false && (meliOk || res?.vinculo)),
          text: partes.join(" · ") || "Guardado",
        },
      }));
      setEditMeli(null);
      setSkuDraft("");
      setCodigoDraft("");
      queryClient.setQueryData<StockResumen>(["stock-resumen"], (old) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((it) =>
            it.meli_id === meli_id ? { ...it, sku: escrito } : it,
          ),
        };
      });
      queryClient.setQueriesData<RelacionResp>({ queryKey: ["relacion-codigos"] }, (old) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((it) =>
            it.meli_id === meli_id
              ? {
                  ...it,
                  sku_meli: escrito,
                  codigo_siigo: codigo,
                  en_siigo: res?.vinculo?.en_siigo ?? it.en_siigo,
                  nombre_siigo: res?.vinculo?.nombre_siigo || it.nombre_siigo,
                }
              : it,
          ),
        };
      });
      forceRefreshRelacionRef.current = true;
      void queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
      void queryClient.invalidateQueries({ queryKey: ["relacion-codigos"] });
    },
    onError: (err, { meli_id }) => {
      setSkuMsg((prev) => ({
        ...prev,
        [meli_id]: {
          ok: false,
          text: err instanceof Error ? err.message : "No se pudo guardar el SKU",
        },
      }));
    },
    onSettled: () => setBusyKey(null),
  });

  const vincularMut = useMutation({
    mutationFn: ({ codigo_siigo, meli_id }: { codigo_siigo: string; meli_id: string }) =>
      api.post<{ ok?: boolean; en_siigo?: boolean; nombre_siigo?: string; codigo_siigo?: string }>(
        "/api/stock/relacion-codigos/vincular",
        { codigo_siigo, meli_id },
      ),
    onMutate: ({ meli_id }) => {
      setBusyKey(meli_id);
      setSkuMsg((prev) => {
        const next = { ...prev };
        delete next[meli_id];
        return next;
      });
    },
    onSuccess: (res, { meli_id, codigo_siigo }) => {
      const enSiigo = res?.en_siigo
        ? ` · encontrado en Siigo${res.nombre_siigo ? `: ${res.nombre_siigo}` : ""}`
        : " · aún no está en Siigo (vínculo local guardado)";
      setSkuMsg((prev) => ({
        ...prev,
        [meli_id]: {
          ok: true,
          text: `Vinculado a Siigo «${res?.codigo_siigo || codigo_siigo}»${enSiigo}`,
        },
      }));
      setEditMeli(null);
      setSkuDraft("");
      setCodigoDraft("");
      forceRefreshRelacionRef.current = true;
      void queryClient.invalidateQueries({ queryKey: ["relacion-codigos"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
    },
    onError: (err, { meli_id }) => {
      setSkuMsg((prev) => ({
        ...prev,
        [meli_id]: {
          ok: false,
          text: err instanceof Error ? err.message : "No se pudo vincular a Siigo",
        },
      }));
    },
    onSettled: () => setBusyKey(null),
  });

  const sincronizarTodoMut = useMutation({
    mutationFn: () => api.post("/api/stock/sincronizar-todo"),
  });

  const reporteMut = useMutation({
    mutationFn: () => api.post<{ mensaje?: string }>("/api/sync/stock"),
  });

  const isLoading = stockQ.isLoading || relacionQ.isLoading;
  const isFetching = stockQ.isFetching || relacionQ.isFetching || ventasQ.isFetching;
  const puedeGuardarSku = Boolean(skuDraft.trim() || codigoDraft.trim());
  const mutPendiente = editarMut.isPending || vincularMut.isPending;

  const guardarEdicionSku = (meliId: string, syncBloqueado?: boolean) => {
    const sku = skuDraft.trim();
    const codigo = codigoDraft.trim() || sku;
    if (!sku && !codigo) return;
    // Publicación bloqueada: igual guarda vínculo local (codigo/sku → meli_id).
    if (syncBloqueado && !sku) {
      vincularMut.mutate({ meli_id: meliId, codigo_siigo: codigo });
      return;
    }
    editarMut.mutate({
      meli_id: meliId,
      sku_meli: sku || codigo,
      codigo_siigo: codigo,
    });
  };
  const ventasMap = useMemo(() => {
    const raw = ventasQ.data?.por_item ?? {};
    const out: Record<string, VentaItem30d> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k.toUpperCase()] = v;
    }
    return out;
  }, [ventasQ.data]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => {
            forceRefreshRelacionRef.current = true;
            forceRefreshVentasRef.current = true;
            void stockQ.refetch();
            void relacionQ.refetch();
            void ventasQ.refetch();
          }}
          disabled={isFetching}
          className="rounded-lg border border-border bg-surface-panel px-3 py-2 text-xs font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40"
        >
          {isFetching ? "Actualizando..." : "🔄 Actualizar MeLi + Siigo + ventas"}
        </button>
        <button
          onClick={() => sincronizarTodoMut.mutate()}
          disabled={sincronizarTodoMut.isPending || !filas.length}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
        >
          {sincronizarTodoMut.isPending ? "Sincronizando..." : "⇄ Reenviar stock a canales"}
        </button>
      </div>

      {/* Filtros compactos por categoría */}
      <div className="relative z-20 space-y-2 rounded-xl border border-border bg-surface-panel p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por nombre, MCO, SKU o código Siigo..."
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
          />
          {search.trim() && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="rounded-lg border border-border px-2.5 py-2 text-[11px] font-semibold text-muted hover:text-ink"
            >
              Limpiar texto
            </button>
          )}
        </form>

        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Unidades</span>
          <select
            value={filtroStock}
            onChange={(e) => setFiltroStock(e.target.value as FiltroStock)}
            title="Agotado=0 · Última=1 · Bajo=2–5 · OK≥6"
            className={SELECT_FILTRO}
          >
            <option value="todos">Todos ({counts.total})</option>
            <option value="agotados">Sin unidades ({counts.agotados})</option>
            <option value="criticos">Última ud. ({counts.criticos})</option>
            <option value="bajos">Bajos 2–5 ({counts.bajos})</option>
            <option value="ok">OK ≥ 6 ({counts.ok})</option>
            <option value="sin_dato">Sin dato ({counts.sinDato})</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Códigos</span>
          <select
            value={filtroCodigo}
            onChange={(e) => setFiltroCodigo(e.target.value as FiltroCodigo)}
            className={SELECT_FILTRO}
          >
            <option value="todos">Todos</option>
            <option value="sin_c">Sin C- ({counts.sinC})</option>
            <option value="vinculados">Vinculados ({counts.vinculados})</option>
            <option value="sin_siigo">Sin Siigo ({counts.sinSiigo})</option>
            <option value="divergentes">SKU distinto ({counts.divergentes})</option>
            <option value="sin_codigo">Sin código ({counts.sinCodigo})</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Publicación</span>
          <select
            value={filtroPublicacion}
            onChange={(e) => setFiltroPublicacion(e.target.value as FiltroPublicacion)}
            className={SELECT_FILTRO}
            title="Activa = publicada en MeLi · Inactiva = pausada, cerrada u otra"
          >
            <option value="todos">Todas</option>
            <option value="activas">Activas ({counts.activas})</option>
            <option value="inactivas">Inactivas ({counts.inactivas})</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Rotación 30 d</span>
          <select
            value={filtroRotacion}
            onChange={(e) => setFiltroRotacion(e.target.value as FiltroRotacion)}
            className={SELECT_FILTRO}
            disabled={ventasQ.isLoading && !ventasQ.data}
          >
            <option value="todos">Todas</option>
            <option value="sin_ventas">Sin ventas ({counts.sinVentas})</option>
            <option value="baja">Baja rotación ({counts.rotBaja})</option>
            <option value="media">Media ({counts.rotMedia})</option>
            <option value="alta">Alta ({counts.rotAlta})</option>
          </select>
        </label>

        {(filtroStock !== "todos"
          || filtroCodigo !== "todos"
          || filtroRotacion !== "todos"
          || filtroPublicacion !== "todos"
          || search.trim() !== "") && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setFiltroStock("todos");
              setFiltroCodigo("todos");
              setFiltroRotacion("todos");
              setFiltroPublicacion("todos");
            }}
            className="rounded-lg border border-border px-2.5 py-2 text-[11px] font-semibold text-muted transition hover:border-accent/40 hover:text-ink"
          >
            Limpiar filtros
          </button>
        )}
        </div>

        <p className="text-[11px] text-muted">
          Mostrando <span className="font-bold text-ink">{items.length}</span> de{" "}
          <span className="font-bold text-ink">{filas.length}</span> publicaciones
          {search.trim() || filtroStock !== "todos" || filtroCodigo !== "todos"
            || filtroRotacion !== "todos" || filtroPublicacion !== "todos"
            ? " (filtros activos)"
            : ""}
        </p>
      </div>

      {filtroCodigo === "sin_c" && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Sin prefijo <span className="font-mono font-bold">C-</span>: edita el SKU, cárgalo a MeLi y
          registra el combo en Siigo / catálogo.
        </p>
      )}

      {sincronizarTodoMut.isSuccess && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Sincronización masiva iniciada. Revisa Sincronización → Actividad.
        </p>
      )}
      {sincronizarTodoMut.isError && (
        <p className="text-xs text-danger">{sincronizarTodoMut.error.message}</p>
      )}
      {ventasQ.data?.actualizado_en && (
        <p className="text-[11px] text-muted -mt-2">
          Ventas 30 d: {ventasQ.data.actualizado_en}
          {ventasQ.data.fuente === "cache" ? " (caché)" : ""} ·{" "}
          {ventasQ.data.ordenes ?? 0} órdenes analizadas ·{" "}
          {Object.keys(ventasMap).length} productos con venta
        </p>
      )}
      {ventasQ.isError && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          No se pudo cargar ventas 30 d:{" "}
          {ventasQ.error instanceof Error ? ventasQ.error.message : "error"}. Pulsa «Actualizar MeLi +
          Siigo + ventas».
        </p>
      )}
      {!ventasQ.isLoading && !ventasQ.isError && ventasQ.data && Object.keys(ventasMap).length === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Ventas 30 d cargaron vacías (0 productos). Reintenta con actualizar forzado.
        </p>
      )}

      {isLoading && <p className="text-sm text-muted">Cargando inventario y códigos...</p>}
      {(stockQ.isError || relacionQ.isError) && (
        <p className="text-sm text-danger">
          {stockQ.error instanceof Error
            ? stockQ.error.message
            : relacionQ.error instanceof Error
              ? relacionQ.error.message
              : "No se pudo cargar el panel"}
        </p>
      )}
      {editarMut.isError && <p className="text-xs text-danger">{editarMut.error.message}</p>}
      {vincularMut.isError && <p className="text-xs text-danger">{vincularMut.error.message}</p>}

      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted">No hay filas para este filtro.</p>
      )}

      <div className="max-h-[min(72vh,46rem)] overflow-auto rounded-xl border border-border">
        <table className="min-w-full text-left text-[11px]">
          <thead className="sticky top-0 z-10 border-b border-border bg-surface text-[9px] uppercase tracking-wide text-muted shadow-sm [&_th]:bg-surface">
            <tr>
              <th className="px-2 py-1.5 font-bold">Producto</th>
              <th className="px-2 py-1.5 font-bold">Pub.</th>
              <th className="px-2 py-1.5 font-bold">Stock</th>
              <th className="px-2 py-1.5 font-bold">Ventas 30d</th>
              <th className="px-2 py-1.5 font-bold">SKU</th>
              <th className="px-2 py-1.5 font-bold">Siigo</th>
              <th className="px-2 py-1.5 font-bold">Vínculo</th>
              <th className="px-2 py-1.5 font-bold" title="Sumar o restar unidades y enviar a MeLi / web">
                ± Sync
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const nivel = nivelStock(it.stock);
              const est = ESTADO_RELACION[it.estado_vinculo] ?? ESTADO_RELACION.sin_codigo;
              const editing = editMeli === it.meli_id;
              const busy = busyKey === it.meli_id;
              const skuListo = Boolean(it.sku.trim());
              const qty = Math.max(0, parseInt(qtyDraft[it.meli_id] || "", 10) || 0);
              const resultado = rowResult[it.meli_id];
              const msg = skuMsg[it.meli_id];
              const venta = ventasMap[(it.meli_id || "").toUpperCase()];
              const analisis = analisisVentas(venta, it.stock);
              const pub = badgePublicacion(it.estado_meli, it.sync_bloqueado);

              return (
                <tr key={it.meli_id} className={`border-t border-border/50 align-middle ${nivel.rowClass}`}>
                  <td className="px-2 py-1">
                    <div className="flex min-w-[10rem] max-w-[16rem] items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDetalleProducto(it)}
                        className="min-w-0 flex-1 truncate text-left font-medium text-ink underline-offset-2 transition hover:text-accent hover:underline"
                        title="Ver precio de venta"
                      >
                        {it.nombre || "—"}
                      </button>
                      {it.es_full && (
                        <span className="shrink-0 rounded bg-muted/25 px-1 text-[9px] font-semibold text-muted">
                          Full
                        </span>
                      )}
                      {it.permalink && (
                        <a
                          href={it.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-[10px] font-semibold text-accent"
                          title="Abrir en MeLi"
                          onClick={(e) => e.stopPropagation()}
                        >
                          ↗
                        </a>
                      )}
                    </div>
                    <p className="truncate font-mono text-[9px] text-muted">{it.meli_id}</p>
                    {it.precio != null && (
                      <p className="truncate text-[9px] font-semibold tabular-nums text-accent/90">
                        {formatPrecioVenta(it.precio, it.moneda)}
                      </p>
                    )}
                  </td>

                  <td className="px-2 py-1 whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full px-1.5 py-px text-[9px] font-bold ${pub.className}`}
                      title={it.estado_meli || pub.label}
                    >
                      {pub.label}
                    </span>
                  </td>

                  <td className="px-2 py-1 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <span className={`tabular-nums ${nivel.stockClass}`}>
                        {it.stock == null ? "—" : it.stock}
                      </span>
                      <span className={`rounded-full px-1.5 py-px text-[9px] font-bold ${nivel.badgeClass}`}>
                        {nivel.label}
                      </span>
                    </div>
                  </td>

                  <td className="px-2 py-1 whitespace-nowrap">
                    {ventasQ.isLoading && !ventasQ.data ? (
                      <span className="text-muted">…</span>
                    ) : (
                      <div className="flex items-center gap-1" title={[analisis.detail, venta?.monto ? formatCopCorto(venta.monto) : ""].filter(Boolean).join(" · ")}>
                        <span className="font-bold tabular-nums text-ink">
                          {analisis.uds > 0 ? analisis.uds : "0"}
                        </span>
                        <span className={`rounded-full px-1.5 py-px text-[9px] font-bold ${analisis.className}`}>
                          {analisis.label}
                        </span>
                      </div>
                    )}
                  </td>

                  <td className="px-2 py-1">
                    {editing ? (
                      <input
                        autoFocus
                        value={skuDraft}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSkuDraft(v);
                          if (
                            !codigoDraft.trim() ||
                            codigoDraft.trim() === (it.sku || it.codigo_siigo || "").trim()
                          ) {
                            setCodigoDraft(v);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            guardarEdicionSku(it.meli_id, it.sync_bloqueado);
                          }
                          if (e.key === "Escape") {
                            setEditMeli(null);
                            setSkuDraft("");
                            setCodigoDraft("");
                          }
                        }}
                        placeholder="C-…"
                        className="w-full min-w-[6.5rem] rounded border border-border bg-surface-input px-1.5 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-accent"
                      />
                    ) : (
                      <p
                        className={`truncate font-mono text-[11px] ${skuListo ? "text-ink" : "text-danger"}`}
                        title={skuListo ? it.sku : "Sin SKU"}
                      >
                        {skuListo ? it.sku : "Sin SKU"}
                      </p>
                    )}
                  </td>

                  <td className="px-2 py-1">
                    {editing ? (
                      <input
                        value={codigoDraft}
                        onChange={(e) => setCodigoDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            guardarEdicionSku(it.meli_id, it.sync_bloqueado);
                          }
                          if (e.key === "Escape") {
                            setEditMeli(null);
                            setSkuDraft("");
                            setCodigoDraft("");
                          }
                        }}
                        placeholder="Código Siigo"
                        className="w-full min-w-[6.5rem] rounded border border-border bg-surface-input px-1.5 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-accent"
                      />
                    ) : (
                      <p
                        className="max-w-[9rem] truncate font-mono text-[11px] text-ink"
                        title={it.nombre_siigo ? `${it.codigo_siigo || "—"} · ${it.nombre_siigo}` : it.codigo_siigo || undefined}
                      >
                        {it.codigo_siigo || "—"}
                      </p>
                    )}
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`rounded-full px-1.5 py-px text-[9px] font-bold ${est.className}`}>
                        {est.label}
                      </span>
                      {editing ? (
                        <>
                          <button
                            disabled={!puedeGuardarSku || busy || mutPendiente}
                            title="Guarda SKU en MeLi + vínculo Siigo (Enter)"
                            onClick={() => guardarEdicionSku(it.meli_id, it.sync_bloqueado)}
                            className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-40"
                          >
                            {editarMut.isPending && busy ? "…" : "Guardar"}
                          </button>
                          <button
                            onClick={() => {
                              setEditMeli(null);
                              setSkuDraft("");
                              setCodigoDraft("");
                            }}
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditMeli(it.meli_id);
                              setSkuDraft(it.sku || "");
                              setCodigoDraft(it.codigo_siigo || it.sku || "");
                            }}
                            disabled={busy}
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted hover:border-accent/50 hover:text-accent disabled:opacity-40"
                          >
                            Editar
                          </button>
                          <button
                            disabled={busy || mutPendiente || !(it.codigo_siigo || it.sku).trim()}
                            title={
                              (it.codigo_siigo || it.sku).trim()
                                ? `Vincular ${it.codigo_siigo || it.sku} ↔ ${it.meli_id}`
                                : "Primero asigna un código Siigo"
                            }
                            onClick={() => {
                              const codigo = (it.codigo_siigo || it.sku).trim();
                              if (!codigo) {
                                setEditMeli(it.meli_id);
                                setSkuDraft(it.sku || "");
                                setCodigoDraft("");
                                return;
                              }
                              vincularMut.mutate({ meli_id: it.meli_id, codigo_siigo: codigo });
                            }}
                            className="rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
                          >
                            {vincularMut.isPending && busy ? "…" : "Vincular"}
                          </button>
                        </>
                      )}
                    </div>
                    {msg && (
                      <p
                        className={`mt-0.5 truncate text-[9px] ${
                          msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-danger"
                        }`}
                        title={msg.text}
                      >
                        {msg.text}
                      </p>
                    )}
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex items-center gap-0.5">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={qtyDraft[it.meli_id] || ""}
                        onChange={(e) =>
                          setQtyDraft((prev) => ({ ...prev, [it.meli_id]: e.target.value }))
                        }
                        placeholder="N"
                        title="Cantidad a sumar o restar"
                        disabled={!skuListo || busy || it.stock == null}
                        className="w-12 rounded border border-border bg-surface-input px-1 py-0.5 text-[11px] text-ink outline-none focus:border-accent disabled:opacity-40"
                      />
                      <button
                        disabled={!skuListo || busy || !qty || it.stock == null}
                        title={`Sumar ${qty || "N"} uds`}
                        onClick={() => {
                          setRowResult((prev) => {
                            const next = { ...prev };
                            delete next[it.meli_id];
                            return next;
                          });
                          ajustarMut.mutate({ sku: it.sku, meli_id: it.meli_id, delta: qty });
                          setQtyDraft((prev) => ({ ...prev, [it.meli_id]: "" }));
                        }}
                        className="rounded bg-emerald-600/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 disabled:opacity-40"
                      >
                        +
                      </button>
                      <button
                        disabled={!skuListo || busy || !qty || it.stock == null}
                        title={`Restar ${qty || "N"} uds`}
                        onClick={() => {
                          setRowResult((prev) => {
                            const next = { ...prev };
                            delete next[it.meli_id];
                            return next;
                          });
                          ajustarMut.mutate({ sku: it.sku, meli_id: it.meli_id, delta: -qty });
                          setQtyDraft((prev) => ({ ...prev, [it.meli_id]: "" }));
                        }}
                        className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger disabled:opacity-40"
                      >
                        −
                      </button>
                      <button
                        disabled={!skuListo || busy || it.stock == null}
                        title="Reenviar stock actual a MeLi y web"
                        onClick={() => {
                          if (it.stock == null) return;
                          setRowResult((prev) => {
                            const next = { ...prev };
                            delete next[it.meli_id];
                            return next;
                          });
                          sincronizarUnoMut.mutate({
                            sku: it.sku,
                            stock: it.stock,
                            meli_id: it.meli_id,
                          });
                        }}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted hover:border-accent/50 hover:text-accent disabled:opacity-40"
                      >
                        Sync
                      </button>
                    </div>
                    {resultado && <CanalResultMini resultado={resultado} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="rounded-xl border border-border bg-surface-panel p-5">
        <p className="text-sm font-medium text-ink">Reporte de Stock por WhatsApp</p>
        <p className="mt-1 text-xs text-muted">
          {reporteMut.isPending
            ? "Generando..."
            : reporteMut.isSuccess
              ? "Reporte enviado al grupo de Inventario"
              : "Envía el resumen de agotados y últimas unidades al grupo de Inventario"}
        </p>
        {reporteMut.isError && <p className="mt-1 text-xs text-danger">{reporteMut.error.message}</p>}
        <button
          onClick={() => {
            reporteMut.mutate();
            queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
          }}
          disabled={reporteMut.isPending}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40"
        >
          Generar reporte
        </button>
      </section>

      {detalleProducto && (
        <DialogPrecioVenta
          fila={detalleProducto}
          analisis={analisisVentas(
            ventasMap[(detalleProducto.meli_id || "").toUpperCase()],
            detalleProducto.stock,
          )}
          onClose={() => setDetalleProducto(null)}
          onPrecioActualizado={(precio) => {
            setDetalleProducto((prev) => (prev ? { ...prev, precio } : prev));
            queryClient.setQueriesData<StockResumen>(
              { queryKey: ["stock-resumen"] },
              (old) => {
                if (!old?.items) return old;
                const mid = (detalleProducto.meli_id || "").toUpperCase();
                return {
                  ...old,
                  items: old.items.map((it) =>
                    (it.meli_id || "").toUpperCase() === mid ? { ...it, precio } : it,
                  ),
                };
              },
            );
          }}
        />
      )}
    </div>
  );
}
