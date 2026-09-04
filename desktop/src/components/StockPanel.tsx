import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { esVistaStockSimplificada } from "../lib/stockAccess";
import { nombreProductoFila } from "../lib/stockNombreProducto";
import StockPanelSimple from "./StockPanelSimple";
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

type FiltroPublicacion = "todos" | "activas" | "pausadas";

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
const FILTRO_PUB_OK = new Set<FiltroPublicacion>(["todos", "activas", "pausadas"]);

function leerFiltrosStock(): StockFiltrosPersistidos {
  try {
    const raw = localStorage.getItem(STOCK_FILTROS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let pub = typeof parsed.filtroPublicacion === "string" ? parsed.filtroPublicacion : "";
    // Migrar filtro legado "inactivas" → pausadas
    if (pub === "inactivas") pub = "pausadas";
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
      filtroPublicacion: FILTRO_PUB_OK.has(pub as FiltroPublicacion)
        ? (pub as FiltroPublicacion)
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

function esPublicacionPausada(estado?: string): boolean {
  return (estado || "").toLowerCase() === "paused";
}

const SELECT_FILTRO =
  "min-w-0 rounded-lg border border-border bg-surface-input px-2 py-1.5 text-xs font-semibold text-ink outline-none focus:border-accent md:min-w-[8.5rem] md:max-w-[11rem] md:py-2";

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
    label: "Sin Alegra",
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

function normalizeSearchToken(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function filaCoincideBusqueda(f: FilaUnificada, q: string): boolean {
  if (!q) return true;
  const fields = [f.nombre, f.sku, f.codigo_siigo, f.meli_id, f.nombre_siigo];
  const qLow = q.toLowerCase();
  if (fields.some((x) => (x || "").toLowerCase().includes(qLow))) return true;
  const qCompact = normalizeSearchToken(q);
  if (!qCompact) return false;
  return fields.some((x) => normalizeSearchToken(x).includes(qCompact));
}

function tienePrefijoC(sku: string, codigoSiigo: string): boolean {
  const compact = (s: string) => (s || "").replace(/\s+/g, "").toUpperCase();
  return compact(sku).startsWith("C-") || compact(codigoSiigo).startsWith("C-");
}

function CanalResultMini({ resultado }: { resultado: SincronizarResultado }) {
  const reactivada = /reactivada/i.test(resultado.meli?.mensaje || "");
  const detalle = `MeLi ${resultado.meli.ok ? "✓" : "✗"} · Web ${resultado.web.ok ? "✓" : "✗"} · Alegra ref.`;
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
      {reactivada && (
        <span className="font-semibold text-emerald-700 dark:text-emerald-400"> · publicada</span>
      )}
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

interface PromoItem {
  id?: string | null;
  type: string;
  status: string;
  name?: string | null;
  price?: number | null;
  original_price?: number | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
  descuento_pct?: number | null;
  ref_id?: string | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  precio_sugerido?: number | null;
  stock?: number | null;
  modo_optin?: "offer_id" | "deal_price" | string;
  start_date?: string | null;
  finish_date?: string | null;
  deadline_date?: string | null;
}

interface PromoItemResp {
  meli_id: string;
  candidatas: PromoItem[];
  activas: PromoItem[];
  total_candidatas: number;
  total_activas: number;
  error?: string;
}

function labelTipoPromo(tipo: string): string {
  const map: Record<string, string> = {
    SMART: "Smart",
    DEAL: "Deal",
    MARKETPLACE_CAMPAIGN: "Co-fondeada",
    PRICE_MATCHING: "Precio competitivo",
    LIGHTNING: "Relámpago",
    DOD: "Oferta del día",
    VOLUME: "Volumen",
    PRE_NEGOTIATED: "Pre-acordada",
    UNHEALTHY_STOCK: "Liquidación Full",
    SELLER_CAMPAIGN: "Campaña vendedor",
    PRICE_DISCOUNT: "Descuento individual",
  };
  return map[tipo] || tipo;
}

function formatFechaPromo(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function textoVigenciaPromo(p: PromoItem): string {
  if (p.type === "PRICE_DISCOUNT" && !p.start_date && !p.finish_date) {
    return "Tú defines las fechas (máx. 14 días)";
  }
  const ini = formatFechaPromo(p.start_date);
  const fin = formatFechaPromo(p.finish_date);
  if (ini && fin) return `${ini} → ${fin}`;
  if (fin) return `Hasta ${fin}`;
  if (ini) return `Desde ${ini}`;
  return "Sin fechas de vigencia";
}

function pctDesdePrecios(original?: number | null, promo?: number | null): number | null {
  if (original == null || promo == null) return null;
  const o = Number(original);
  const pr = Number(promo);
  if (!(o > 0) || !(pr > 0) || pr >= o) return null;
  return Math.round((1 - pr / o) * 1000) / 10;
}

function textoDescuentoPromo(p: PromoItem, moneda: string, precioOverride?: number | null): string {
  const partes: string[] = [];
  const sugerido =
    precioOverride ??
    p.precio_sugerido ??
    (p.price && p.price > 0 ? p.price : null);
  const pctLive = pctDesdePrecios(p.original_price, sugerido);
  const pct = pctLive ?? p.descuento_pct;
  if (pct != null) {
    partes.push(`−${pct}%`);
  }
  if (p.meli_percentage != null || p.seller_percentage != null) {
    partes.push(
      `MeLi ${p.meli_percentage ?? 0}% / tú ${p.seller_percentage ?? 0}%`,
    );
  }
  if (sugerido != null && p.original_price != null) {
    partes.push(
      `${formatPrecioVenta(sugerido, moneda)} (lista ${formatPrecioVenta(p.original_price, moneda)})`,
    );
  } else if (sugerido != null) {
    partes.push(`sugerido ${formatPrecioVenta(sugerido, moneda)}`);
  }
  return partes.join(" · ") || "Sin % de descuento";
}

type ReporteTipo = "rotacion" | "estadistica" | "inventario";
type ReportePeriodo = "semanal" | "quincenal" | "mensual";

const REPORTE_TIPOS: { id: ReporteTipo; label: string; detalle: string }[] = [
  {
    id: "rotacion",
    label: "Baja rotación / sin ventas",
    detalle: "Publicaciones sin movimiento o con ≤2 uds en el periodo",
  },
  {
    id: "estadistica",
    label: "Estadística de ventas",
    detalle: "Totales, publicaciones con/sin venta y top ventas",
  },
  {
    id: "inventario",
    label: "Sin inventario / pronto a agotar",
    detalle: "Agotados, última unidad, stock bajo y cobertura por ritmo",
  },
];

const REPORTE_PERIODOS: { id: ReportePeriodo; label: string }[] = [
  { id: "semanal", label: "Semanal" },
  { id: "quincenal", label: "Quincenal" },
  { id: "mensual", label: "Mensual" },
];

function MenuReportesStock() {
  const [abierto, setAbierto] = useState(false);
  const [periodo, setPeriodo] = useState<ReportePeriodo>("mensual");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mut = useMutation({
    mutationFn: (body: { tipo: ReporteTipo; periodo: ReportePeriodo }) =>
      api.post<{ ok?: boolean; mensaje?: string; error?: string; status?: string }>(
        "/api/stock/reportes",
        body,
        { timeoutMs: 30_000 },
      ),
    onSuccess: (res) => {
      setMsg({
        ok: true,
        text: res.mensaje || "Reporte iniciado. Revisa Actividad / WhatsApp Inventario.",
      });
      setAbierto(false);
    },
    onError: (e) => {
      setMsg({
        ok: false,
        text: (e as Error).message || "No se pudo iniciar el reporte",
      });
    },
  });

  return (
    <div className="relative w-auto">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={mut.isPending}
          onClick={() => {
            setMsg(null);
            setAbierto((v) => !v);
          }}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-accent-hover disabled:opacity-40"
        >
          {mut.isPending ? "Generando…" : abierto ? "Cerrar ▴" : "Generar reporte ▾"}
        </button>
        {msg && (
          <span
            className={`max-w-[14rem] truncate text-[10px] font-semibold ${
              msg.ok ? "text-emerald-600" : "text-danger"
            }`}
            title={msg.text}
          >
            {msg.text}
          </span>
        )}
      </div>

      {abierto && (
        <div
          className="absolute bottom-full left-0 z-40 mb-1 w-[min(100vw-2rem,22rem)] rounded-xl border border-border bg-surface p-3 shadow-lg"
          role="menu"
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Periodo</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {REPORTE_PERIODOS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriodo(p.id)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
                  periodo === p.id
                    ? "bg-accent text-white"
                    : "border border-border text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            Tipo de reporte
          </p>
          <ul className="mt-1.5 grid gap-1.5">
            {REPORTE_TIPOS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={mut.isPending}
                  onClick={() => mut.mutate({ tipo: t.id, periodo })}
                  className="h-full w-full rounded-lg border border-border bg-surface-panel px-3 py-2 text-left transition hover:border-accent/50 hover:bg-surface-hover disabled:opacity-40"
                >
                  <span className="block text-xs font-bold text-ink">{t.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                    {t.detalle}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
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
  const [dealDraft, setDealDraft] = useState<Record<string, string>>({});
  const [promoFechas, setPromoFechas] = useState<
    Record<string, { start: string; finish: string }>
  >({});
  const [promoBusy, setPromoBusy] = useState<string | null>(null);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  const promosQ = useQuery<PromoItemResp>({
    queryKey: ["stock-promociones-item", fila.meli_id],
    queryFn: () =>
      api.get<PromoItemResp>(
        `/api/stock/promociones/item?meli_id=${encodeURIComponent(fila.meli_id)}`,
        { timeoutMs: 60_000 },
      ),
    enabled: Boolean(fila.meli_id),
    staleTime: 30_000,
  });

  const promoKey = (p: PromoItem) => `${p.type}:${p.id || "nod"}:${p.ref_id || ""}`;

  const agregarPromo = async (p: PromoItem) => {
    if (!fila.meli_id) return;
    if (!p.id && p.type !== "PRICE_DISCOUNT") return;
    const key = promoKey(p);
    setPromoBusy(key);
    setPromoMsg(null);
    try {
      const body: Record<string, unknown> = {
        meli_id: fila.meli_id,
        promotion_id: p.id || "",
        promotion_type: p.type,
      };
      if (p.ref_id) body.offer_id = p.ref_id;
      if (p.stock != null && Number(p.stock) > 0) body.stock = Number(p.stock);
      if (p.type === "SMART") {
        if (p.start_date) body.start_date = p.start_date;
        if (p.finish_date) body.finish_date = p.finish_date;
      }
      if (p.modo_optin === "deal_price") {
        const raw =
          dealDraft[key] ??
          (p.precio_sugerido != null ? String(Math.round(Number(p.precio_sugerido))) : "");
        const precio = parseFloat(raw);
        if (!(precio > 0)) {
          setPromoMsg({ ok: false, text: "Ingresa un precio promocional > 0" });
          return;
        }
        body.deal_price = precio;
        if (p.type === "PRICE_DISCOUNT") {
          const hoy = new Date();
          const hoyStr = hoy.toISOString().slice(0, 10);
          const en14 = new Date(hoy.getTime() + 13 * 86400000)
            .toISOString()
            .slice(0, 10);
          const fechas = promoFechas[key] ?? { start: hoyStr, finish: en14 };
          if (!fechas.start || !fechas.finish) {
            setPromoMsg({
              ok: false,
              text: "Define fecha inicio y fin (máx. 14 días)",
            });
            return;
          }
          body.start_date = `${fechas.start}T00:00:00`;
          body.finish_date = `${fechas.finish}T23:59:59`;
        }
      }
      await api.post("/api/stock/promociones/agregar", body, { timeoutMs: 60_000 });
      setPromoMsg({
        ok: true,
        text: `Agregada a «${p.name || labelTipoPromo(p.type)}»`,
      });
      void queryClient.invalidateQueries({ queryKey: ["stock-promociones-item", fila.meli_id] });
    } catch (e) {
      setPromoMsg({
        ok: false,
        text: (e as Error).message || "No se pudo agregar a la promoción",
      });
    } finally {
      setPromoBusy(null);
    }
  };

  const quitarPromo = async (p: PromoItem) => {
    if (!fila.meli_id || !p.id) return;
    const key = promoKey(p);
    setPromoBusy(key);
    setPromoMsg(null);
    try {
      await api.post(
        "/api/stock/promociones/quitar",
        {
          meli_id: fila.meli_id,
          promotion_id: p.id,
          promotion_type: p.type,
          offer_id: p.ref_id || undefined,
        },
        { timeoutMs: 60_000 },
      );
      setPromoMsg({ ok: true, text: `Quitada de «${p.name || p.id}»` });
      void queryClient.invalidateQueries({ queryKey: ["stock-promociones-item", fila.meli_id] });
    } catch (e) {
      setPromoMsg({
        ok: false,
        text: (e as Error).message || "No se pudo quitar de la promoción",
      });
    } finally {
      setPromoBusy(null);
    }
  };

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
        partes.push(siigoOk ? "Alegra" : `Alegra ✗ ${res.siigo?.msg || "falló"}`);
        setMsgErr(res.error || `No se pudo actualizar: ${partes.join(" · ")}`);
        return;
      }
      setPrecioLocal(precio);
      setEditando(false);
      setMsgOk("MeLi + Alegra OK");
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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-border bg-surface-panel shadow-xl"
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
                <p className="text-[11px] text-muted">{moneda} · actualiza MeLi y Alegra</p>
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
                      ? "Clic para editar precio (MeLi + Alegra)"
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
              <dt className="text-[10px] font-bold uppercase text-muted">Código Alegra</dt>
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

          <div className="rounded-xl border border-border bg-surface px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                Promociones MeLi
              </p>
              <button
                type="button"
                disabled={promosQ.isFetching}
                onClick={() => void promosQ.refetch()}
                className="text-[10px] font-semibold text-accent hover:underline disabled:opacity-40"
              >
                {promosQ.isFetching ? "Actualizando…" : "Actualizar"}
              </button>
            </div>

            {promoMsg && (
              <p
                className={`mt-2 text-[11px] font-semibold ${
                  promoMsg.ok ? "text-emerald-600" : "text-danger"
                }`}
              >
                {promoMsg.text}
              </p>
            )}

            {promosQ.isLoading ? (
              <p className="mt-2 text-xs text-muted">Cargando campañas…</p>
            ) : promosQ.isError ? (
              <p className="mt-2 text-xs text-danger">
                {promosQ.error instanceof Error
                  ? promosQ.error.message
                  : "No se pudieron cargar promociones"}
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                {(promosQ.data?.activas?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase text-muted">
                      Ya participa ({promosQ.data!.activas.length})
                    </p>
                    <ul className="space-y-1.5">
                      {promosQ.data!.activas.map((p) => {
                        const key = promoKey(p);
                        return (
                          <li
                            key={`act-${key}`}
                            className="flex items-start justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-ink">
                                {p.name || p.id}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted">
                                {labelTipoPromo(p.type)}
                                {p.status ? ` · ${p.status}` : ""}
                              </p>
                              <p className="mt-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                {textoDescuentoPromo(p, moneda)}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted">
                                Vigencia: {textoVigenciaPromo(p)}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={promoBusy === key}
                              onClick={() => void quitarPromo(p)}
                              className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-bold text-muted hover:border-danger/40 hover:text-danger disabled:opacity-40"
                            >
                              {promoBusy === key ? "…" : "Quitar"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {(promosQ.data?.candidatas?.length ?? 0) > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase text-muted">
                      Candidatas ({promosQ.data!.candidatas.length})
                    </p>
                    <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                      {promosQ.data!.candidatas.map((p) => {
                        const key = promoKey(p);
                        const needsDeal = p.modo_optin === "deal_price";
                        const sugerido =
                          p.precio_sugerido != null
                            ? Math.round(Number(p.precio_sugerido))
                            : null;
                        const precioDraftRaw =
                          dealDraft[key] ?? (sugerido != null ? String(sugerido) : "");
                        const precioDraftNum = parseFloat(precioDraftRaw);
                        const precioParaPct =
                          needsDeal && precioDraftNum > 0 ? precioDraftNum : null;
                        const hoy = new Date();
                        const hoyStr = hoy.toISOString().slice(0, 10);
                        const en14 = new Date(hoy.getTime() + 13 * 86400000)
                          .toISOString()
                          .slice(0, 10);
                        const fechas =
                          promoFechas[key] ?? { start: hoyStr, finish: en14 };
                        return (
                          <li
                            key={`cand-${key}`}
                            className="rounded-lg border border-border/80 bg-surface-panel px-2.5 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-ink">
                                  {p.name || labelTipoPromo(p.type)}
                                </p>
                                <p className="mt-0.5 text-[10px] text-muted">
                                  {labelTipoPromo(p.type)}
                                </p>
                                <p className="mt-0.5 text-[10px] font-semibold text-accent">
                                  {textoDescuentoPromo(p, moneda, precioParaPct)}
                                </p>
                                <p className="mt-0.5 text-[10px] text-muted">
                                  Vigencia:{" "}
                                  {p.type === "PRICE_DISCOUNT"
                                    ? `${formatFechaPromo(fechas.start + "T00:00:00") || fechas.start} → ${formatFechaPromo(fechas.finish + "T00:00:00") || fechas.finish}`
                                    : textoVigenciaPromo(p)}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={
                                  promoBusy === key ||
                                  (needsDeal && !p.id && p.type !== "PRICE_DISCOUNT") ||
                                  (!needsDeal && !p.ref_id && !p.id)
                                }
                                onClick={() => void agregarPromo(p)}
                                className="shrink-0 rounded-md bg-accent px-2 py-1 text-[10px] font-bold text-white hover:bg-accent-hover disabled:opacity-40"
                              >
                                {promoBusy === key ? "…" : "Agregar"}
                              </button>
                            </div>
                            {needsDeal && (
                              <div className="mt-1.5 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="text-[10px] text-muted">Precio promo</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="100"
                                    disabled={promoBusy === key}
                                    value={precioDraftRaw}
                                    onChange={(e) =>
                                      setDealDraft((prev) => ({
                                        ...prev,
                                        [key]: e.target.value,
                                      }))
                                    }
                                    className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-xs font-bold tabular-nums text-ink outline-none focus:border-accent"
                                    placeholder="COP"
                                  />
                                  {(p.min_discounted_price != null ||
                                    p.max_discounted_price != null) && (
                                    <span className="text-[9px] text-muted">
                                      {p.min_discounted_price != null
                                        ? `min ${formatPrecioVenta(p.min_discounted_price, moneda)}`
                                        : ""}
                                      {p.max_discounted_price != null
                                        ? ` · max ${formatPrecioVenta(p.max_discounted_price, moneda)}`
                                        : ""}
                                    </span>
                                  )}
                                </div>
                                {p.type === "PRICE_DISCOUNT" && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="text-[10px] text-muted">Desde</label>
                                    <input
                                      type="date"
                                      disabled={promoBusy === key}
                                      value={fechas.start}
                                      onChange={(e) =>
                                        setPromoFechas((prev) => ({
                                          ...prev,
                                          [key]: { ...fechas, start: e.target.value },
                                        }))
                                      }
                                      className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
                                    />
                                    <label className="text-[10px] text-muted">Hasta</label>
                                    <input
                                      type="date"
                                      disabled={promoBusy === key}
                                      value={fechas.finish}
                                      onChange={(e) =>
                                        setPromoFechas((prev) => ({
                                          ...prev,
                                          [key]: { ...fechas, finish: e.target.value },
                                        }))
                                      }
                                      className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  !promosQ.isLoading && (
                    <p className="text-xs text-muted">
                      {(promosQ.data?.activas?.length ?? 0) > 0
                        ? "No hay más campañas candidatas para esta publicación."
                        : "Esta publicación no tiene campañas candidatas ahora."}
                    </p>
                  )
                )}
              </div>
            )}
          </div>

          {permalink && (
            <a
              href={permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center rounded-xl border border-border px-3 py-2.5 text-xs font-bold text-ink transition hover:bg-surface-hover"
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

function StockPanelCompleto() {
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
  /** En móvil los 4 selects ocupan casi toda la pantalla; colapsados por defecto. */
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [detalleProducto, setDetalleProducto] = useState<FilaUnificada | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rowResult, setRowResult] = useState<Record<string, SincronizarResultado>>({});
  const [skuMsg, setSkuMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [editMeli, setEditMeli] = useState<string | null>(null);
  const [skuDraft, setSkuDraft] = useState("");
  const [codigoDraft, setCodigoDraft] = useState("");
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const forceRefreshRelacionRef = useRef(false);
  const forceRefreshVentasRef = useRef(false);
  const tablaScrollRef = useRef<HTMLDivElement>(null);
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

  // Tras filtrar, el scrollTop viejo puede dejar la tabla en blanco (contenido más corto).
  useEffect(() => {
    const el = tablaScrollRef.current;
    if (el) el.scrollTop = 0;
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
          nombre: nombreProductoFila(prev.nombre, r.titulo, r.nombre_siigo),
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
          nombre: nombreProductoFila("", r.titulo, r.nombre_siigo),
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

  const ventaDeFila = (
    f: FilaUnificada,
    rawVentas: Record<string, VentaItem30d>,
  ): VentaItem30d | undefined => {
    const mid = (f.meli_id || "").toUpperCase();
    return rawVentas[mid] ?? rawVentas[f.meli_id];
  };

  /** Base filtrada por búsqueda + todos los filtros salvo `omit` (para conteos facetados). */
  const baseParaConteo = (
    omit: "stock" | "codigo" | "rotacion" | "publicacion" | null,
    rawVentas: Record<string, VentaItem30d>,
  ): FilaUnificada[] => {
    const q = search.trim().toLowerCase();
    let list = filas;
    if (q) {
      list = list.filter((f) => filaCoincideBusqueda(f, q));
    }
    if (omit !== "stock" && filtroStock !== "todos") {
      list = list.filter((f) => nivelStock(f.stock).key === filtroStock);
    }
    if (omit !== "codigo" && filtroCodigo !== "todos") {
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
    }
    if (omit !== "rotacion" && filtroRotacion !== "todos") {
      list = list.filter(
        (f) => nivelRotacion(ventaDeFila(f, rawVentas)) === filtroRotacion,
      );
    }
    if (omit !== "publicacion" && filtroPublicacion !== "todos") {
      if (filtroPublicacion === "activas") {
        list = list.filter((f) => esPublicacionActiva(f.estado_meli, f.sync_bloqueado));
      } else if (filtroPublicacion === "pausadas") {
        list = list.filter((f) => esPublicacionPausada(f.estado_meli));
      }
    }
    return list;
  };

  const counts = useMemo(() => {
    const rawVentas = ventasQ.data?.por_item ?? {};
    // Cada dimensión se cuenta sobre el resto de filtros (números = lo que verías al elegir esa opción).
    const porStock = baseParaConteo("stock", rawVentas);
    const porCodigo = baseParaConteo("codigo", rawVentas);
    const porRot = baseParaConteo("rotacion", rawVentas);
    const porPub = baseParaConteo("publicacion", rawVentas);

    let agotados = 0;
    let criticos = 0;
    let bajos = 0;
    let ok = 0;
    let sinDato = 0;
    for (const f of porStock) {
      const n = nivelStock(f.stock);
      if (n.key === "agotados") agotados += 1;
      else if (n.key === "criticos") criticos += 1;
      else if (n.key === "bajos") bajos += 1;
      else if (n.key === "ok") ok += 1;
      else sinDato += 1;
    }

    let sinC = 0;
    let vinculados = 0;
    let sinSiigo = 0;
    let divergentes = 0;
    let sinCodigo = 0;
    for (const f of porCodigo) {
      if (!tienePrefijoC(f.sku, f.codigo_siigo)) sinC += 1;
      if (f.estado_vinculo === "vinculado") vinculados += 1;
      else if (f.estado_vinculo === "sin_siigo") sinSiigo += 1;
      else if (f.estado_vinculo === "sku_divergente") divergentes += 1;
      else if (f.estado_vinculo === "sin_codigo") sinCodigo += 1;
    }

    let sinVentas = 0;
    let rotBaja = 0;
    let rotMedia = 0;
    let rotAlta = 0;
    for (const f of porRot) {
      const rot = nivelRotacion(ventaDeFila(f, rawVentas));
      if (rot === "sin_ventas") sinVentas += 1;
      else if (rot === "baja") rotBaja += 1;
      else if (rot === "media") rotMedia += 1;
      else rotAlta += 1;
    }

    let activas = 0;
    let pausadas = 0;
    for (const f of porPub) {
      if (esPublicacionActiva(f.estado_meli, f.sync_bloqueado)) activas += 1;
      else if (esPublicacionPausada(f.estado_meli)) pausadas += 1;
    }

    return {
      total: filas.length,
      totalStock: porStock.length,
      totalCodigo: porCodigo.length,
      totalRotacion: porRot.length,
      totalPublicacion: porPub.length,
      agotados,
      criticos,
      bajos,
      ok,
      sinDato,
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
      pausadas,
    };
  }, [
    filas,
    search,
    filtroStock,
    filtroCodigo,
    filtroRotacion,
    filtroPublicacion,
    ventasQ.data,
  ]);

  const items = useMemo(() => {
    const rawVentas = ventasQ.data?.por_item ?? {};
    const list = baseParaConteo(null, rawVentas);
    return [...list].sort((a, b) => {
      const va = ventaDeFila(a, rawVentas)?.unidades ?? 0;
      const vb = ventaDeFila(b, rawVentas)?.unidades ?? 0;
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

  const aplicarStockEnCache = (
    meli_id: string,
    res: SincronizarResultado,
    stockAntes: number | null | undefined,
  ) => {
    const reactivada = /reactivada/i.test(res.meli?.mensaje || "");
    const objetivo =
      typeof res.stock_objetivo === "number" ? res.stock_objetivo : undefined;
    const meliOk = Boolean(res.meli?.ok);
    const saliaDeCero = (stockAntes ?? 0) <= 0 && objetivo != null && objetivo > 0;
    queryClient.setQueryData<StockResumen>(["stock-resumen"], (old) => {
      if (!old?.items) return old;
      return {
        ...old,
        items: old.items.map((it) => {
          if (it.meli_id !== meli_id) return it;
          let nextEstado = it.estado_meli;
          if (objetivo === 0) nextEstado = "paused";
          else if (objetivo != null && objetivo > 0 && meliOk && (reactivada || saliaDeCero)) {
            nextEstado = "active";
          }
          return {
            ...it,
            stock: objetivo ?? it.stock,
            estado_meli: nextEstado,
            sync_bloqueado: nextEstado !== "active",
          };
        }),
      };
    });
    queryClient.setQueriesData<RelacionResp>({ queryKey: ["relacion-codigos"] }, (old) => {
      if (!old?.items) return old;
      return {
        ...old,
        items: old.items.map((it) => {
          if (it.meli_id !== meli_id) return it;
          if (!(objetivo != null && objetivo > 0 && meliOk && (reactivada || saliaDeCero))) {
            return it;
          }
          return { ...it, estado_meli: "active" };
        }),
      };
    });
  };


  const sincronizarUnoMut = useMutation({
    mutationFn: ({
      sku,
      stock,
      meli_id,
    }: {
      sku: string;
      stock: number;
      meli_id: string;
      stockAntes?: number | null;
    }) =>
      api.post<SincronizarResultado>(
        "/api/stock/sincronizar",
        { sku: sku || meli_id, stock, meli_id },
        { timeoutMs: 90_000 },
      ),
    onMutate: ({ meli_id }) => setBusyKey(meli_id),
    onSuccess: (res, { meli_id, stockAntes }) => {
      setRowResult((prev) => ({ ...prev, [meli_id]: res }));
      setStockDraft((prev) => {
        const next = { ...prev };
        delete next[meli_id];
        return next;
      });
      aplicarStockEnCache(meli_id, res, stockAntes);
      void queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
    },
    onError: (err, { sku, meli_id }) =>
      setRowResult((prev) => ({ ...prev, [meli_id]: errorResultado(sku, err.message) })),
    onSettled: () => setBusyKey(null),
  });

  const guardarStockAbsoluto = (it: FilaUnificada) => {
    const raw = stockDraft[it.meli_id];
    const valor =
      raw !== undefined && raw !== ""
        ? Math.max(0, parseInt(raw, 10) || 0)
        : it.stock;
    if (valor == null || Number.isNaN(valor)) return;
    const sku = (it.sku || "").trim() || it.meli_id;
    setRowResult((prev) => {
      const next = { ...prev };
      delete next[it.meli_id];
      return next;
    });
    sincronizarUnoMut.mutate({
      sku,
      stock: valor,
      meli_id: it.meli_id,
      stockAntes: it.stock,
    });
  };

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
          `vínculo Alegra «${codigo}»${
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
        ? ` · encontrado en Alegra${res.nombre_siigo ? `: ${res.nombre_siigo}` : ""}`
        : " · aún no está en Alegra (vínculo local guardado)";
      setSkuMsg((prev) => ({
        ...prev,
        [meli_id]: {
          ok: true,
          text: `Vinculado a Alegra «${res?.codigo_siigo || codigo_siigo}»${enSiigo}`,
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
          text: err instanceof Error ? err.message : "No se pudo vincular a Alegra",
        },
      }));
    },
    onSettled: () => setBusyKey(null),
  });

  const sincronizarTodoMut = useMutation({
    mutationFn: () => api.post("/api/stock/sincronizar-todo"),
  });

  const isLoading = stockQ.isLoading || relacionQ.isLoading;
  const isFetching = stockQ.isFetching || relacionQ.isFetching || ventasQ.isFetching;
  const puedeGuardarSku = Boolean(skuDraft.trim() || codigoDraft.trim());
  const mutPendiente = editarMut.isPending || vincularMut.isPending;
  const nDimsFiltro = [
    filtroStock !== "todos",
    filtroCodigo !== "todos",
    filtroRotacion !== "todos",
    filtroPublicacion !== "todos",
  ].filter(Boolean).length;
  const hayFiltrosActivos = nDimsFiltro > 0 || search.trim() !== "";
  const limpiarFiltros = () => {
    setSearch("");
    setFiltroStock("todos");
    setFiltroCodigo("todos");
    setFiltroRotacion("todos");
    setFiltroPublicacion("todos");
  };

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
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-1.5 sm:gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        <button
          onClick={() => {
            forceRefreshRelacionRef.current = true;
            forceRefreshVentasRef.current = true;
            void stockQ.refetch();
            void relacionQ.refetch();
            void ventasQ.refetch();
          }}
          disabled={isFetching}
          className="rounded-lg border border-border bg-surface-panel px-2.5 py-1.5 text-[11px] font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40 sm:px-3 sm:py-2 sm:text-xs"
        >
          {isFetching ? "Actualizando..." : (
            <>
              <span className="sm:hidden">🔄 Actualizar</span>
              <span className="hidden sm:inline">🔄 Actualizar MeLi + Alegra + ventas</span>
            </>
          )}
        </button>
        <button
          onClick={() => sincronizarTodoMut.mutate()}
          disabled={sincronizarTodoMut.isPending || !filas.length}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40 sm:px-3 sm:py-2 sm:text-xs"
        >
          {sincronizarTodoMut.isPending ? "Sincronizando..." : (
            <>
              <span className="sm:hidden">⇄ Reenviar</span>
              <span className="hidden sm:inline">⇄ Reenviar stock a canales</span>
            </>
          )}
        </button>
      </div>

      {/* Buscador siempre visible; filtros colapsables en móvil */}
      <div className="relative z-20 shrink-0 rounded-xl border border-border bg-surface-panel p-2 sm:p-3">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre, MCO, SKU o Alegra…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent sm:px-3 sm:py-2"
          />
          {search.trim() && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold text-muted hover:text-ink sm:px-2.5 sm:py-2"
            >
              Limpiar
            </button>
          )}
        </form>

        <div className="mt-1.5 flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={() => setFiltrosAbiertos((v) => !v)}
            aria-expanded={filtrosAbiertos}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${
              nDimsFiltro > 0 || filtrosAbiertos
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-ink hover:bg-surface-hover"
            }`}
          >
            Filtros
            {nDimsFiltro > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-extrabold text-white">
                {nDimsFiltro}
              </span>
            )}
            <span className="text-muted" aria-hidden>
              {filtrosAbiertos ? "▴" : "▾"}
            </span>
          </button>
          <p className="min-w-0 flex-1 truncate text-[11px] text-muted">
            <span className="font-bold text-ink">{items.length}</span>
            <span className="text-muted"> / {filas.length}</span>
            {hayFiltrosActivos ? " · activos" : ""}
          </p>
          {hayFiltrosActivos && (
            <button
              type="button"
              onClick={limpiarFiltros}
              className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold text-muted hover:text-ink"
            >
              Quitar
            </button>
          )}
        </div>

        <div
          className={`${
            filtrosAbiertos ? "mt-2 grid" : "hidden"
          } grid-cols-2 gap-2 md:mt-2 md:flex md:flex-wrap md:items-end xl:flex-nowrap`}
        >
          <label className="flex min-w-0 flex-col gap-0.5 md:shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Unidades</span>
            <select
              value={filtroStock}
              onChange={(e) => setFiltroStock(e.target.value as FiltroStock)}
              title="Agotado=0 · Última=1 · Bajo=2–5 · OK≥6"
              className={`${SELECT_FILTRO} w-full max-w-none md:w-auto`}
            >
              <option value="todos">Todos ({counts.totalStock})</option>
              <option value="agotados">Sin unidades ({counts.agotados})</option>
              <option value="criticos">Última ud. ({counts.criticos})</option>
              <option value="bajos">Bajos 2–5 ({counts.bajos})</option>
              <option value="ok">OK ≥ 6 ({counts.ok})</option>
              <option value="sin_dato">Sin dato ({counts.sinDato})</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-0.5 md:shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Códigos</span>
            <select
              value={filtroCodigo}
              onChange={(e) => setFiltroCodigo(e.target.value as FiltroCodigo)}
              className={`${SELECT_FILTRO} w-full max-w-none md:w-auto`}
            >
              <option value="todos">Todos ({counts.totalCodigo})</option>
              <option value="sin_c">Sin C- ({counts.sinC})</option>
              <option value="vinculados">Vinculados ({counts.vinculados})</option>
              <option value="sin_siigo">Sin Alegra ({counts.sinSiigo})</option>
              <option value="divergentes">SKU distinto ({counts.divergentes})</option>
              <option value="sin_codigo">Sin código ({counts.sinCodigo})</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-0.5 md:shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Publicación</span>
            <select
              value={filtroPublicacion}
              onChange={(e) => setFiltroPublicacion(e.target.value as FiltroPublicacion)}
              className={`${SELECT_FILTRO} w-full max-w-none md:w-auto`}
              title="Activa = publicada en MeLi · Pausada = pausada en MeLi"
            >
              <option value="todos">Todas ({counts.totalPublicacion})</option>
              <option value="activas">Activas ({counts.activas})</option>
              <option value="pausadas">Pausadas ({counts.pausadas})</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-0.5 md:shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Rotación 30 d</span>
            <select
              value={filtroRotacion}
              onChange={(e) => setFiltroRotacion(e.target.value as FiltroRotacion)}
              className={`${SELECT_FILTRO} w-full max-w-none md:w-auto`}
              disabled={ventasQ.isLoading && !ventasQ.data}
            >
              <option value="todos">Todas ({counts.totalRotacion})</option>
              <option value="sin_ventas">Sin ventas ({counts.sinVentas})</option>
              <option value="baja">Baja rotación ({counts.rotBaja})</option>
              <option value="media">Media ({counts.rotMedia})</option>
              <option value="alta">Alta ({counts.rotAlta})</option>
            </select>
          </label>

          {hayFiltrosActivos && (
            <button
              type="button"
              onClick={limpiarFiltros}
              className="hidden shrink-0 rounded-lg border border-border px-2.5 py-2 text-[11px] font-semibold text-muted transition hover:border-accent/40 hover:text-ink md:inline-flex"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <p className="mt-2 hidden text-[11px] text-muted md:block">
          Mostrando <span className="font-bold text-ink">{items.length}</span> de{" "}
          <span className="font-bold text-ink">{filas.length}</span> publicaciones
          {hayFiltrosActivos ? " (filtros activos)" : ""}
        </p>
      </div>

      <div className="shrink-0 space-y-1.5 sm:space-y-2">
      {filtroCodigo === "sin_c" && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Sin prefijo <span className="font-mono font-bold">C-</span>: edita el SKU, cárgalo a MeLi y
          registra el combo en Alegra / catálogo.
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
        <p className="hidden text-[11px] text-muted sm:block">
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
          Alegra + ventas».
        </p>
      )}
      {!ventasQ.isLoading && !ventasQ.isError && ventasQ.data && Object.keys(ventasMap).length === 0 && (
        <p className="hidden text-xs text-amber-600 dark:text-amber-400 sm:block">
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
      </div>

      <div
        ref={tablaScrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-border"
      >
        <table className="min-w-full text-left text-[11px]">
          <thead className="sticky top-0 z-10 border-b border-border bg-surface text-[9px] uppercase tracking-wide text-muted shadow-sm [&_th]:bg-surface">
            <tr>
              <th className="px-2 py-1.5 font-bold">Producto</th>
              <th className="px-2 py-1.5 font-bold">Pub.</th>
              <th className="px-2 py-1.5 font-bold" title="Edita el stock y pulsa Guardar (Enter)">
                Stock
              </th>
              <th className="px-2 py-1.5 font-bold">Ventas 30d</th>
              <th className="px-2 py-1.5 font-bold">SKU</th>
              <th className="px-2 py-1.5 font-bold">Alegra</th>
              <th className="px-2 py-1.5 font-bold">Vínculo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const nivel = nivelStock(it.stock);
              const est = ESTADO_RELACION[it.estado_vinculo] ?? ESTADO_RELACION.sin_codigo;
              const editing = editMeli === it.meli_id;
              const busy = busyKey === it.meli_id;
              const skuListo = Boolean(it.sku.trim());
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
                        title={it.nombre_siigo && it.nombre_siigo !== it.nombre
                          ? `${it.nombre} · Alegra: ${it.nombre_siigo}`
                          : "Ver precio de venta"}
                      >
                        {it.nombre || it.nombre_siigo || "—"}
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
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={
                            stockDraft[it.meli_id] !== undefined
                              ? stockDraft[it.meli_id]
                              : it.stock == null
                                ? ""
                                : String(it.stock)
                          }
                          onChange={(e) =>
                            setStockDraft((prev) => ({
                              ...prev,
                              [it.meli_id]: e.target.value,
                            }))
                          }
                          onFocus={() => {
                            if (stockDraft[it.meli_id] === undefined && it.stock != null) {
                              setStockDraft((prev) => ({
                                ...prev,
                                [it.meli_id]: String(it.stock),
                              }));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              guardarStockAbsoluto(it);
                            }
                            if (e.key === "Escape") {
                              setStockDraft((prev) => {
                                const next = { ...prev };
                                delete next[it.meli_id];
                                return next;
                              });
                            }
                          }}
                          disabled={busy}
                          title="Escribe el stock final y Guardar / Enter. Si estaba en 0, se reactiva en MeLi."
                          className={`w-14 rounded border border-border bg-surface-input px-1 py-0.5 text-[11px] tabular-nums outline-none focus:border-accent disabled:opacity-40 ${nivel.stockClass}`}
                        />
                        <button
                          type="button"
                          disabled={busy}
                          title="Guardar stock en MeLi y web"
                          onClick={() => guardarStockAbsoluto(it)}
                          className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent disabled:opacity-40"
                        >
                          {busy && sincronizarUnoMut.isPending ? "…" : "Guardar"}
                        </button>
                        <span className={`rounded-full px-1.5 py-px text-[9px] font-bold ${nivel.badgeClass}`}>
                          {nivel.label}
                        </span>
                      </div>
                      {resultado && <CanalResultMini resultado={resultado} />}
                      {resultado && /reactivada/i.test(resultado.meli?.mensaje || "") && (
                        <p className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400">
                          Publicación activada en MeLi
                        </p>
                      )}
                      {resultado && resultado.meli && resultado.meli.ok === false && (
                        <p
                          className="max-w-[14rem] truncate text-[9px] text-danger"
                          title={resultado.meli.mensaje}
                        >
                          {resultado.meli.mensaje}
                        </p>
                      )}
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
                        placeholder="Código Alegra"
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
                            title="Guarda SKU en MeLi + vínculo Alegra (Enter)"
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
                                : "Primero asigna un código Alegra"
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

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border bg-surface-panel/80 px-1 py-1.5">
        <span
          className="text-[10px] font-bold uppercase tracking-wide text-muted"
          title="Se envía una imagen (KPIs + barras + top) al grupo Inventario"
        >
          Reportes WA
        </span>
        <MenuReportesStock />
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

export default function StockPanel() {
  const user = useTicketsAuth((s) => s.user);
  if (esVistaStockSimplificada(user)) return <StockPanelSimple />;
  return <StockPanelCompleto />;
}
