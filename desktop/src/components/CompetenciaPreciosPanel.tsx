import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAnalizarCompetenciaPrecios,
  useActualizarPrecioBaseCompetencia,
  useActualizarPresentacionCompetencia,
  useReporteCapturaCompetencia,
  useUltimoAnalisisCompetencia,
  type ListadoCaptura,
  type PalabrasClaveMeli,
  type ProductoCompetencia,
  type ReporteCaptura,
  type VeredictoCompetencia,
} from "../hooks/useCompetenciaPrecios";
import { imagenDesdePortapapeles } from "../lib/clipboardImage";
import {
  capturarPestanaComoJpeg,
  esCancelacionCaptura,
  mensajeErrorCaptura,
  puedeCapturarPestana,
} from "../lib/capturaCompetenciaMeli";
import MeliPromocionesItem from "./MeliPromocionesItem";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";

/** Token para abrir evidencias (Bearer en fetch). */
function tokenPanelImagen(): string | null {
  const tickets = useTicketsAuth.getState();
  return (
    tickets.apiToken ||
    tickets.token ||
    useAuthStore.getState().token ||
    null
  );
}

async function abrirEvidenciaCompetencia(itemId: string, download = false): Promise<void> {
  const token = tokenPanelImagen();
  const path = `/api/meli/competencia-precios/evidencia/${encodeURIComponent(itemId)}${
    download ? "?download=1" : ""
  }`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}${path}`;
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error || `No se pudo abrir la evidencia (${res.status})`,
      );
    }
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    if (download) {
      const a = document.createElement("a");
      a.href = obj;
      a.download = `evidencia-${itemId}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(obj, "_blank", "noopener,noreferrer");
    }
    window.setTimeout(() => URL.revokeObjectURL(obj), 60_000);
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "No se pudo abrir la evidencia");
  }
}

function cop(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Math.round(Number(n)).toLocaleString("es-CO")}`;
}

/** Producto activo para Ctrl+V del pantallazo. */
let filaCapturaActiva: string | null = null;

type TabDetalle = "analisis" | "promos";

const VEREDICTO: Record<
  VeredictoCompetencia,
  { label: string; corto: string; className: string; dot: string }
> = {
  mas_caro: {
    label: "Nosotros más caros",
    corto: "Revisar",
    className: "bg-red-50 text-red-800 border-red-200",
    dot: "bg-red-500",
  },
  similar: {
    label: "Precio similar",
    corto: "Similar",
    className: "bg-amber-50 text-amber-900 border-amber-200",
    dot: "bg-amber-500",
  },
  mas_barato: {
    label: "Nosotros más baratos",
    corto: "Barato",
    className: "bg-green-50 text-green-800 border-green-200",
    dot: "bg-green-600",
  },
  sin_competencia: {
    label: "Sin anotar",
    corto: "Sin dato",
    className: "bg-gray-50 text-gray-600 border-gray-200",
    dot: "bg-gray-400",
  },
};

function BadgeVeredicto({ v }: { v: VeredictoCompetencia }) {
  const meta = VEREDICTO[v] ?? VEREDICTO.sin_competencia;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[9px] font-bold ${meta.className}`}
      title={meta.label}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      {meta.corto}
    </span>
  );
}

function cantidadDeTitulo(titulo: string): string {
  const t = titulo || "";
  const hasta = t.match(
    /\bhasta\s+(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?)\b/i,
  );
  if (hasta) {
    const n = Number(String(hasta[1]).replace(",", "."));
    const u = hasta[2].toLowerCase();
    let base =
      u.startsWith("kg") || u.startsWith("kilo")
        ? `${n} kg`
        : `${Math.round(n)} g`;
    const prec = t.match(/\b(0[.,]\d+)\s*(g|grs?|gramos?|mg)\b/i);
    if (prec) {
      const pu = prec[2].toLowerCase() === "mg" ? "mg" : "g";
      base = `${base} · prec. ${String(prec[1]).replace(",", ".")} ${pu}`;
    }
    return base;
  }
  const nx = t.match(
    /\b(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b/i,
  );
  if (nx) {
    const pack = Number(nx[1]);
    const unit = Number(String(nx[2]).replace(",", "."));
    const u = nx[3].toLowerCase();
    if (pack >= 2 && pack <= 20 && unit > 0) {
      const label = u.startsWith("kg") || u.startsWith("kilo")
        ? "kg"
        : u.startsWith("ml") || u === "cc"
          ? "ml"
          : u === "l" || u.startsWith("lt") || u.startsWith("litro")
            ? "L"
            : "g";
      const nShow = label === "kg" || label === "L" ? unit : Math.round(unit);
      return `${pack}×${nShow} ${label}`;
    }
  }
  const suma = t.match(
    /\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\s*[+]\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b/i,
  );
  if (suma) {
    const a = parsePresentacion(`${suma[1]} ${suma[2]}`);
    const b = parsePresentacion(`${suma[3]} ${suma[4]}`);
    if (a && b && a.u === b.u) {
      return a.u === "ml" ? `${Math.round(a.n + b.n)} ml` : `${Math.round(a.n + b.n)} g`;
    }
  }
  const cu = t.match(
    /\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\s*(?:c\s*\/\s*u\.?|c\/?u\.?|cada\s+un[oa])\b/i,
  );
  if (cu) {
    const head = t.slice(0, cu.index ?? 0);
    let mult = 1;
    const und = head.match(
      /\b(\d+)\s*(?:und|unidades?|pcs?|piezas?|frascos?|potes?|sobres?|botellas?)\b/i,
    );
    if (und) {
      const n = Number(und[1]);
      if (n >= 2 && n <= 20) mult = n;
    } else if (/\b(?:duo|par|pareja|kit\s*(?:de\s*)?2|pack\s*(?:de\s*)?2)\b/i.test(head)) {
      mult = 2;
    } else {
      const partes = head
        .split(/\s*\+\s*/)
        .map((p) => p.trim())
        .filter((p) => p && !/^env[ií]o\b/i.test(p));
      if (partes.length >= 2) mult = Math.min(partes.length, 6);
    }
    const unit = Number(String(cu[1]).replace(",", "."));
    const u = cu[2].toLowerCase();
    const label = u.startsWith("kg") || u.startsWith("kilo")
      ? "kg"
      : u.startsWith("ml") || u === "cc"
        ? "ml"
        : u === "l" || u.startsWith("lt") || u.startsWith("litro")
          ? "L"
          : "g";
    const nShow = label === "kg" || label === "L" ? unit : Math.round(unit);
    if (mult > 1) return `${mult}×${nShow} ${label}`;
    return `${nShow} ${label}`;
  }
  const m = t.match(
    /\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b/i,
  );
  if (!m) return "—";
  const n = Number(m[1].replace(",", "."));
  // 0.001 g = precisión de gramera, no cantidad
  if (n > 0 && n < 1) {
    const rest = t.slice((m.index ?? 0) + m[0].length);
    const next = rest.match(
      /\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b/i,
    );
    if (next) {
      return cantidadDeTitulo(`${next[1]} ${next[2]}`);
    }
    return "—";
  }
  const u = m[2].toLowerCase();
  if (u.startsWith("kg") || u.startsWith("kilo")) return `${n} kg`;
  if (u.startsWith("ml") || u === "cc") return `${Math.round(n)} ml`;
  if (u === "l" || u.startsWith("lt") || u.startsWith("litro")) return `${n} L`;
  return `${Math.round(n)} g`;
}

function parsePresentacion(txt: string): { n: number; u: "g" | "ml" } | null {
  const t = txt || "";
  const kit = t.match(
    /\b(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b/i,
  );
  if (kit) {
    const pack = Number(kit[1]);
    const unit = Number(String(kit[2]).replace(",", "."));
    if (pack >= 1 && pack <= 20 && unit > 0) {
      const one = parsePresentacion(`${unit} ${kit[3]}`);
      if (one) return { n: one.n * pack, u: one.u };
    }
  }
  const m = t.match(
    /\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b/i,
  );
  if (!m) return null;
  const n = Number(String(m[1]).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2].toLowerCase();
  if (u.startsWith("kg") || u.startsWith("kilo")) return { n: n * 1000, u: "g" };
  if (u === "l" || u.startsWith("lt") || u.startsWith("litro")) return { n: n * 1000, u: "ml" };
  if (u.startsWith("ml") || u === "cc") return { n, u: "ml" };
  return { n, u: "g" };
}

function precioPorUnidad(
  total: number | null | undefined,
  cant: string,
  c: ListadoCaptura,
): number | null {
  const p = parsePresentacion(cant);
  if (p && total != null && Number(total) > 0) {
    return Number(total) / p.n;
  }
  if (c.precio_por_unidad != null && Number(c.precio_por_unidad) > 0) {
    return Number(c.precio_por_unidad);
  }
  if (c.precio_por_100 != null && Number(c.precio_por_100) > 0) {
    return Number(c.precio_por_100) / 100;
  }
  return null;
}

function sufijoUnidad(cant: string, canonica?: string | null, backend?: string | null): string {
  const raw = (backend || "").toLowerCase();
  if (raw.includes("ml") || canonica === "ml" || /\bml\b|\bL\b|litro/i.test(cant)) {
    return "/ ml";
  }
  return "/ g";
}

function esInstrumentoPesaje(titulo: string): boolean {
  return /gramera|balanza|b[aá]scula|pesa digital|pesa gramera/i.test(titulo || "");
}

function splitCantidadEfectiva(txt: string | null | undefined): {
  n: string;
  u: "g" | "ml";
} {
  const m = (txt || "").match(
    /(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b/i,
  );
  if (!m) return { n: "", u: "g" };
  let n = Number(String(m[1]).replace(",", "."));
  const u = m[2].toLowerCase();
  if (u.startsWith("kg") || u.startsWith("kilo")) {
    n = n * 1000;
    return { n: String(Math.round(n)), u: "g" };
  }
  if (u === "l" || u.startsWith("lt") || u.startsWith("litro")) {
    n = n * 1000;
    return { n: String(Math.round(n)), u: "ml" };
  }
  if (u.startsWith("ml") || u === "cc") return { n: String(Math.round(n)), u: "ml" };
  return { n: String(Math.round(n)), u: "g" };
}

function BloqueReporte({
  r,
  nuestroNombre,
  nuestroPrecio,
  cantidadNuestra,
}: {
  r: ReporteCaptura;
  nuestroNombre: string;
  nuestroPrecio: number;
  /** Cantidad efectiva (manual o del título), p. ej. «100 g». */
  cantidadNuestra?: string;
}) {
  const token = useAuthStore((s) => s.token);
  const ticketsToken = useTicketsAuth((s) => s.token);
  const apiToken = useTicketsAuth((s) => s.apiToken);
  const itemId = r.item_id || "";
  const tieneEvidencia = Boolean(
    itemId && (r.evidencia_png || r.tabla?.length || r.listados?.length),
  );
  const hayAuth = Boolean(apiToken || ticketsToken || token);
  const listados = r.listados ?? [];
  const instrumento =
    Boolean(r.instrumento_pesaje) || esInstrumentoPesaje(nuestroNombre);
  const filas: ListadoCaptura[] =
    (r.tabla && r.tabla.length > 0
      ? r.tabla
      : [
          {
            titulo: nuestroNombre,
            nombre: nuestroNombre,
            precio: nuestroPrecio,
            cantidad: cantidadDeTitulo(nuestroNombre),
            valor_total: nuestroPrecio,
            es_nuestra: true,
            vendedor: "Nosotros",
          },
          ...listados.map((c) => ({
            ...c,
            nombre: c.nombre || c.titulo,
            cantidad: c.cantidad || cantidadDeTitulo(c.titulo),
            valor_total: c.valor_total ?? c.precio,
            es_nuestra: false,
          })),
        ]) as ListadoCaptura[];

  const chart = filas.map((c, i) => {
    const nombre = c.nombre || c.titulo || "—";
    const cant = c.es_nuestra
      ? (cantidadNuestra && cantidadNuestra !== "—"
          ? cantidadNuestra
          : cantidadDeTitulo(nuestroNombre))
      : c.cantidad || cantidadDeTitulo(nombre);
    const total = c.valor_total ?? c.precio;
    const pu = instrumento
      ? null
      : precioPorUnidad(total, cant, c.es_nuestra ? { ...c, precio_por_unidad: null } : c);
    return { c, i, nombre, cant, total, pu };
  });
  const conUnidad = chart.filter((f) => f.pu != null && f.pu > 0);
  const usanUnidad = !instrumento && conUnidad.length > 0;
  const metricas = usanUnidad ? conUnidad.map((f) => f.pu as number) : chart.map((f) => Number(f.total) || 0);
  const maxM = Math.max(0, ...metricas);
  const minM = metricas.length ? Math.min(...metricas.filter((n) => n > 0)) : null;
  const sufijo = sufijoUnidad(
    chart.find((f) => f.c.es_nuestra)?.cant || r.nuestra_cantidad || "",
    chart.find((f) => f.c.es_nuestra)?.c.unidad_canonica,
    r.unidad_comparacion,
  );
  const ours = chart.find((f) => f.c.es_nuestra);
  const oursM = usanUnidad ? ours?.pu : ours?.total;
  const sorted = [...chart].sort((a, b) => {
    const av = (usanUnidad ? a.pu : a.total) ?? 1e18;
    const bv = (usanUnidad ? b.pu : b.total) ?? 1e18;
    return av - bv;
  });
  let pctVsMin: number | null = null;
  if (oursM != null && minM != null && oursM > 0) {
    pctVsMin = ((oursM - minM) * 100) / oursM;
  }

  return (
    <div className="space-y-1.5">
      {oursM != null && minM != null ? (
        <p className="text-[11px] font-semibold leading-snug text-ink">
          {r.veredicto === "mas_caro"
            ? `Estamos ${Math.abs(pctVsMin ?? 0).toFixed(0)}% más caros por unidad`
            : r.veredicto === "mas_barato"
              ? "Somos los más baratos por unidad"
              : r.veredicto === "similar"
                ? "Andamos parecidos por unidad"
                : r.resumen || "Comparación por unidad"}
          <span className="text-muted">
            {" "}
            · nosotros {cop(oursM)}
            {usanUnidad ? ` ${sufijo}` : ""} · más barato {cop(minM)}
            {usanUnidad ? ` ${sufijo}` : ""}
          </span>
        </p>
      ) : r.resumen ? (
        <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-ink" title={r.resumen}>
          {r.resumen}
        </p>
      ) : null}
      <div className="space-y-1 rounded border border-border bg-surface px-1.5 py-1.5">
        <p className="text-[9px] font-bold uppercase tracking-wide text-muted">
          {usanUnidad
            ? `Precio ${sufijo.trim()} · barra más larga = más caro`
            : "Precio total · barra más larga = más caro"}
        </p>
        {sorted.map((f) => {
          const m = (usanUnidad ? f.pu : f.total) ?? 0;
          const pct = maxM > 0 ? Math.max(6, (m / maxM) * 100) : 0;
          const esMin = minM != null && m > 0 && Math.abs(m - minM) < 0.5;
          const barCls = f.c.es_nuestra
            ? "bg-accent"
            : esMin
              ? "bg-emerald-500"
              : "bg-violet-300";
          return (
            <div key={`${f.nombre}-${f.i}`} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-[7.2rem] shrink-0 truncate text-[10px] font-semibold ${
                    f.c.es_nuestra ? "text-accent" : "text-ink"
                  }`}
                  title={f.nombre}
                >
                  {f.c.es_nuestra ? "★ Nosotros" : f.nombre}
                </span>
                <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-panel">
                  <div
                    className={`h-full rounded-full ${barCls}`}
                    style={{ width: `${pct}%` }}
                    title={`${cop(m)}${usanUnidad ? ` ${sufijo}` : ""}`}
                  />
                </div>
                <span className="w-[5.8rem] shrink-0 text-right text-[10px] font-black tabular-nums text-ink">
                  {cop(m)}
                  {usanUnidad ? (
                    <span className="font-semibold text-muted">{sufijo.replace(" ", "")}</span>
                  ) : null}
                </span>
                {f.c.permalink ? (
                  <a
                    href={f.c.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[10px] font-semibold text-accent hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Ver
                  </a>
                ) : (
                  <span className="w-5 shrink-0" />
                )}
              </div>
              <p className="pl-[7.2rem] text-[9px] leading-tight text-muted">
                {f.cant}
                {f.total != null ? ` · total ${cop(f.total)}` : ""}
              </p>
            </div>
          );
        })}
      </div>
      {tieneEvidencia && itemId && hayAuth ? (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => void abrirEvidenciaCompetencia(itemId, true)}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-ink"
          >
            PNG
          </button>
          <button
            type="button"
            onClick={() => void abrirEvidenciaCompetencia(itemId, false)}
            className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white"
          >
            Ver
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ItemLista({
  p,
  selected,
  onSelect,
}: {
  p: ProductoCompetencia;
  selected: boolean;
  onSelect: () => void;
}) {
  const delta = p.delta_pct_vs_min;
  const mostrarDelta = delta != null && p.veredicto !== "sin_competencia";

  return (
    <button
      type="button"
      onClick={onSelect}
      title={p.titulo}
      className={`flex w-full items-center gap-1.5 px-1.5 py-1 text-left transition-colors ${
        selected
          ? "bg-accent/10 ring-1 ring-inset ring-accent/40"
          : "hover:bg-surface-panel"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${VEREDICTO[p.veredicto]?.dot ?? "bg-gray-400"}`}
        title={VEREDICTO[p.veredicto]?.label}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold leading-tight text-ink">
          {p.titulo}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11px] font-bold leading-none tabular-nums text-ink">{cop(p.precio)}</p>
        {mostrarDelta ? (
          <p
            className={`text-[10px] font-semibold tabular-nums ${
              delta! > 0 ? "text-red-600" : delta! < 0 ? "text-green-700" : "text-muted"
            }`}
          >
            {delta! > 0 ? "+" : ""}
            {delta}%
          </p>
        ) : null}
      </div>
    </button>
  );
}

function ChipsPalabrasClaveMeli({ kw, query }: { kw?: PalabrasClaveMeli; query: string }) {
  const nombre = kw?.nombre?.filter(Boolean) ?? [];
  const cantidad = kw?.cantidad?.trim() || "";
  const porcentajes = kw?.porcentajes?.filter(Boolean) ?? [];
  const tiene = nombre.length > 0 || cantidad || porcentajes.length > 0;
  if (!tiene && !query) return null;

  return (
    <div
      className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
      title={query ? `Búsqueda MeLi: ${query}` : undefined}
    >
      {nombre.map((w) => (
        <span
          key={`n-${w}`}
          className="rounded border border-border bg-surface-panel px-1 py-px text-[9px] font-medium text-ink"
        >
          {w}
        </span>
      ))}
      {cantidad ? (
        <span className="rounded border border-accent/30 bg-accent/10 px-1 py-px text-[9px] font-semibold text-accent">
          {cantidad}
        </span>
      ) : null}
      {porcentajes.map((pct) => (
        <span
          key={`p-${pct}`}
          className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] font-semibold text-amber-800 dark:text-amber-200"
        >
          {pct}
        </span>
      ))}
      {!tiene && query ? (
        <span className="truncate text-[9px] text-muted">{query}</span>
      ) : null}
    </div>
  );
}

function PanelDetalle({ p }: { p: ProductoCompetencia }) {
  const [tab, setTab] = useState<TabDetalle>("analisis");
  const [precioBase, setPrecioBase] = useState(String(Math.round(p.precio)));
  const [msgPrecio, setMsgPrecio] = useState<string | null>(null);
  const [msgCant, setMsgCant] = useState<string | null>(null);
  const initCant = splitCantidadEfectiva(
    p.presentacion_manual || p.cantidad_efectiva || cantidadDeTitulo(p.titulo),
  );
  const [cantNum, setCantNum] = useState(initCant.n);
  const [cantUnidad, setCantUnidad] = useState<"g" | "ml">(initCant.u);
  const [hint, setHint] = useState<string | null>(null);
  const [errorCaptura, setErrorCaptura] = useState<string | null>(null);
  const zonaRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const enviandoRef = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const reporteMut = useReporteCapturaCompetencia();
  const precioMut = useActualizarPrecioBaseCompetencia();
  const cantMut = useActualizarPresentacionCompetencia();
  const busqueda = p.url_busqueda_meli;
  const queryMeli = p.query?.trim() || "";
  const reporte = reporteMut.data?.reporte ?? p.reporte_captura;
  const pres =
    p.cantidad_efectiva ||
    p.presentacion_manual ||
    cantidadDeTitulo(p.titulo);

  async function enviarImagen(blob: Blob) {
    setErrorCaptura(null);
    reporteMut.reset();
    setHint("Subiendo captura…");
    setTab("analisis");
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    await reporteMut.mutateAsync({
      item_id: p.item_id,
      titulo: p.titulo,
      precio: Number(precioBase) || p.precio,
      imagen: blob,
      onProgreso: (msg) => setHint(msg || "Analizando…"),
    });
    setHint(null);
  }

  function tomarArchivo(file: File | Blob | null | undefined) {
    if (!file || enviandoRef.current || reporteMut.isPending) return;
    enviandoRef.current = true;
    void enviarImagen(file)
      .catch(() => {})
      .finally(() => {
        enviandoRef.current = false;
      });
  }

  const mensajeErrorAnalisis =
    errorCaptura ??
    (reporteMut.isError
      ? reporteMut.error instanceof Error
        ? reporteMut.error.message
        : "No se pudo armar el reporte"
      : null);

  function abrirListadoMeli() {
    if (busqueda) {
      window.open(busqueda, "_blank", "noopener,noreferrer");
    }
    setHint("Pegá el pantallazo acá");
    setErrorCaptura(null);
    zonaRef.current?.focus();
  }

  async function onCapturarPestana() {
    let blob: Blob;
    try {
      blob = await capturarPestanaComoJpeg();
    } catch (e) {
      if (esCancelacionCaptura(e)) {
        setHint("Cancelaste — pegá o subí la imagen");
        return;
      }
      setErrorCaptura(mensajeErrorCaptura(e));
      return;
    }
    try {
      await enviarImagen(blob);
    } catch {
      /* reporteMut.isError */
    }
  }

  useEffect(() => {
    filaCapturaActiva = p.item_id;
    const t = window.setTimeout(() => zonaRef.current?.focus(), 100);
    return () => {
      window.clearTimeout(t);
      if (filaCapturaActiva === p.item_id) filaCapturaActiva = null;
    };
  }, [p.item_id]);

  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      if (filaCapturaActiva !== p.item_id) return;
      const activo = document.activeElement;
      if (activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement) {
        return;
      }
      const file = imagenDesdePortapapeles(ev.clipboardData);
      if (!file) return;
      ev.preventDefault();
      ev.stopPropagation();
      tomarArchivo(file);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [p.item_id]);

  useEffect(() => {
    setPrecioBase(String(Math.round(Number(p.precio) || 0)));
    const c = splitCantidadEfectiva(
      p.presentacion_manual || p.cantidad_efectiva || cantidadDeTitulo(p.titulo),
    );
    setCantNum(c.n);
    setCantUnidad(c.u);
    setTab("analisis");
    setHint(null);
    setErrorCaptura(null);
    setMsgPrecio(null);
    setMsgCant(null);
  }, [p.item_id, p.precio, p.presentacion_manual, p.cantidad_efectiva, p.titulo]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function guardarPrecioBase() {
    const n = Number(precioBase);
    if (!(n > 0)) {
      setMsgPrecio("El precio base debe ser mayor que 0");
      return;
    }
    setMsgPrecio(null);
    precioMut.mutate(
      { item_id: p.item_id, precio: n, sku: p.sku },
      {
        onSuccess: (data) => {
          setMsgPrecio(data.aviso_meli || "Precio publicado en MeLi");
        },
        onError: (e) => {
          setMsgPrecio(e instanceof Error ? e.message : "No se pudo guardar el precio");
        },
      },
    );
  }

  function guardarCantidad() {
    const raw = cantNum.trim();
    if (!raw) {
      setMsgCant(null);
      cantMut.mutate(
        { item_id: p.item_id, cantidad: "borrar", unidad: cantUnidad },
        {
          onSuccess: () => setMsgCant("Cantidad del título (sin override)"),
          onError: (e) =>
            setMsgCant(e instanceof Error ? e.message : "No se pudo limpiar"),
        },
      );
      return;
    }
    if (!(Number(raw.replace(",", ".")) > 0)) {
      setMsgCant("Ingresá un número > 0 (ej. 100)");
      return;
    }
    setMsgCant(null);
    cantMut.mutate(
      { item_id: p.item_id, cantidad: raw, unidad: cantUnidad },
      {
        onSuccess: (data) => {
          setMsgCant(
            data.presentacion_manual
              ? `Cantidad ${data.presentacion_manual} guardada`
              : "Cantidad guardada",
          );
        },
        onError: (e) => {
          setMsgCant(e instanceof Error ? e.message : "No se pudo guardar la cantidad");
        },
      },
    );
  }

  const tabs: { id: TabDetalle; label: string }[] = [
    { id: "analisis", label: "Comparación" },
    { id: "promos", label: "Promociones" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 space-y-1 border-b border-border px-1.5 py-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink" title={p.titulo}>
            {p.titulo}
          </h3>
          <BadgeVeredicto v={p.veredicto} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <label className="flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5">
            <span className="text-[9px] font-bold uppercase text-muted">$</span>
            <input
              type="number"
              min={1}
              value={precioBase}
              onChange={(e) => setPrecioBase(e.target.value)}
              className="w-20 bg-transparent text-[11px] font-bold tabular-nums text-ink outline-none"
            />
          </label>
          <button
            type="button"
            disabled={precioMut.isPending}
            onClick={guardarPrecioBase}
            className="mck-chip-compact rounded bg-accent px-1.5 font-bold text-white disabled:opacity-60"
          >
            {precioMut.isPending ? "…" : "Publicar"}
          </button>
          <label
            className="flex items-center gap-0.5 rounded border border-border bg-surface px-1.5 py-0.5"
            title="Cantidad del empaque cuando el título no la trae (ej. 100 g)"
          >
            <span className="text-[9px] font-bold uppercase text-muted">Cant.</span>
            <input
              type="number"
              min={0}
              step="any"
              placeholder="100"
              value={cantNum}
              onChange={(e) => setCantNum(e.target.value)}
              className="w-14 bg-transparent text-[11px] font-bold tabular-nums text-ink outline-none"
            />
            <select
              value={cantUnidad}
              onChange={(e) => setCantUnidad(e.target.value === "ml" ? "ml" : "g")}
              className="bg-transparent text-[10px] font-bold text-ink outline-none"
            >
              <option value="g">g</option>
              <option value="ml">ml</option>
            </select>
          </label>
          <button
            type="button"
            disabled={cantMut.isPending}
            onClick={guardarCantidad}
            className="mck-chip-compact rounded border border-border px-1.5 font-semibold text-ink disabled:opacity-60"
          >
            {cantMut.isPending ? "…" : "Guardar"}
          </button>
          {p.permalink ? (
            <a
              href={p.permalink}
              target="_blank"
              rel="noreferrer"
              className="mck-chip-compact inline-flex items-center rounded border border-border px-1.5 font-semibold text-ink"
            >
              MeLi ↗
            </a>
          ) : null}
        </div>
        {msgPrecio ? <p className="text-[10px] text-muted">{msgPrecio}</p> : null}
        {msgCant ? <p className="text-[10px] text-muted">{msgCant}</p> : null}
        {pres === "—" ? (
          <p className="text-[10px] text-amber-700">
            El título no trae gramos/ml — ingresá la cantidad y tocá «Guardar»
          </p>
        ) : p.presentacion_es_manual ? (
          <p className="text-[10px] text-muted">Cantidad manual: {pres}</p>
        ) : null}
        {precioMut.isError ? (
          <p className="text-[10px] text-danger">
            {precioMut.error instanceof Error
              ? precioMut.error.message
              : "No se pudo guardar el precio"}
          </p>
        ) : null}
        {cantMut.isError ? (
          <p className="text-[10px] text-danger">
            {cantMut.error instanceof Error
              ? cantMut.error.message
              : "No se pudo guardar la cantidad"}
          </p>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-border px-1.5 py-1">
        <div className="flex flex-wrap items-center gap-1">
          {busqueda ? (
            <button
              type="button"
              onClick={abrirListadoMeli}
              disabled={reporteMut.isPending}
              title={
                queryMeli
                  ? `Buscar en MeLi: ${queryMeli}`
                  : "Abrir listado de MeLi con palabras clave del producto"
              }
              className="mck-chip-compact shrink-0 rounded bg-accent px-1.5 font-bold text-white disabled:opacity-60"
            >
              Buscar MeLi
            </button>
          ) : null}
          <ChipsPalabrasClaveMeli kw={p.palabras_clave_meli} query={queryMeli} />
          <div
            ref={zonaRef}
            tabIndex={0}
            title={
              pres !== "—"
                ? `Pegá pantallazo (Ctrl+V). Solo ${pres}.`
                : "Pegá pantallazo (Ctrl+V)"
            }
            onFocus={() => {
              filaCapturaActiva = p.item_id;
            }}
            onPaste={(e) => {
              const file = imagenDesdePortapapeles(e.clipboardData);
              if (!file) return;
              e.preventDefault();
              e.stopPropagation();
              tomarArchivo(file);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"));
              tomarArchivo(f);
            }}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded border border-dashed px-1.5 py-0.5 outline-none ${
              reporteMut.isPending
                ? "border-accent bg-accent/10"
                : "border-accent/50 bg-surface focus:border-accent"
            }`}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className="h-6 w-6 shrink-0 rounded object-cover"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted">
              {reporteMut.isPending
                ? "Analizando…"
                : hint || (pres !== "—" ? `Pegá captura (${pres})` : "Pegá captura")}
            </span>
            {puedeCapturarPestana() ? (
              <button
                type="button"
                onClick={() => void onCapturarPestana()}
                disabled={reporteMut.isPending}
                className="mck-chip-compact shrink-0 rounded bg-accent px-1.5 font-bold text-white disabled:opacity-60"
              >
                Capturar
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={reporteMut.isPending}
              className="mck-chip-compact shrink-0 rounded border border-border px-1.5 font-semibold disabled:opacity-60"
            >
              Subir
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                tomarArchivo(f);
              }}
            />
          </div>
        </div>
        {mensajeErrorAnalisis ? (
          <p className="mt-1 text-[10px] text-danger">{mensajeErrorAnalisis}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-0 border-b border-border px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative px-2 py-1 text-[10px] font-bold transition-colors ${
              tab === t.id
                ? "text-accent after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {tab === "analisis" ? (
          reporte ? (
            <BloqueReporte
              r={reporte}
              nuestroNombre={p.titulo}
              nuestroPrecio={Number(precioBase) || p.precio}
              cantidadNuestra={pres}
            />
          ) : (
            <p className="py-4 text-center text-[11px] text-muted">
              Sin comparación — buscá en MeLi y pegá el pantallazo
              {pres !== "—" ? ` (${pres})` : ""}.
            </p>
          )
        ) : null}

        {tab === "promos" ? (
          <MeliPromocionesItem meliId={p.item_id} enabled={tab === "promos"} embedded />
        ) : null}
      </div>
    </div>
  );
}

export default function CompetenciaPreciosPanel() {
  const ultimo = useUltimoAnalisisCompetencia();
  const mut = useAnalizarCompetenciaPrecios();
  const [topN, setTopN] = useState(12);
  const [dias, setDias] = useState(30);
  const [consulta, setConsulta] = useState("");
  const [filtro, setFiltro] = useState<VeredictoCompetencia | "todos">("todos");
  const [busquedaLista, setBusquedaLista] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = mut.data ?? ultimo.data;
  const productos = data?.productos ?? [];
  const visibles = useMemo(
    () =>
      filtro === "todos" ? productos : productos.filter((p) => p.veredicto === filtro),
    [filtro, productos],
  );
  const visiblesFiltrados = useMemo(() => {
    const q = busquedaLista.trim().toLowerCase();
    if (!q) return visibles;
    return visibles.filter(
      (p) =>
        p.titulo.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        p.item_id.toLowerCase().includes(q),
    );
  }, [visibles, busquedaLista]);

  const selected = useMemo(
    () => visiblesFiltrados.find((p) => p.item_id === selectedId) ?? null,
    [selectedId, visiblesFiltrados],
  );

  useEffect(() => {
    if (!visiblesFiltrados.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visiblesFiltrados.some((p) => p.item_id === selectedId)) {
      const prefer =
        visiblesFiltrados.find((p) => p.veredicto === "mas_caro") ?? visiblesFiltrados[0];
      setSelectedId(prefer.item_id);
    }
  }, [visiblesFiltrados, selectedId]);

  const r = data?.resumen;
  const cargando = mut.isPending;
  const error = mut.error
    ? mut.error instanceof Error
      ? mut.error.message
      : String(mut.error)
    : data && data.ok === false
      ? (data.error ?? "El análisis falló.")
      : ultimo.error instanceof Error
        ? ultimo.error.message
        : null;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-1 overflow-hidden rounded-xl border border-border bg-surface-panel p-1"
      style={{ ["--mck-field-h" as string]: "1.2rem", ["--mck-field-fs" as string]: "0.65rem" }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h2 className="text-[11px] font-black leading-none text-ink">Competencia</h2>
        {r ? (
          <div className="flex flex-wrap items-center gap-0.5">
            {(
              [
                ["todos", r.productos, "Todos", ""],
                ["mas_caro", r.nosotros_mas_caros, "Revisar", "border-red-300 bg-red-50/80"],
                ["mas_barato", r.nosotros_mas_baratos, "Baratos", "border-green-300 bg-green-50/80"],
                ["sin_competencia", r.sin_match, "Sin dato", ""],
              ] as const
            ).map(([id, n, label, extra]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFiltro(id)}
                className={`mck-chip-compact inline-flex items-center gap-1 rounded border px-1.5 ${
                  filtro === id ? "border-accent bg-accent/10" : extra || "border-border bg-surface"
                }`}
              >
                <span className="font-black tabular-nums text-ink">{n}</span>
                <span className="text-muted">{label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-0.5">
          <input
            type="number"
            min={1}
            max={25}
            value={topN}
            title="Top"
            onChange={(e) => setTopN(Number(e.target.value) || 12)}
            className="w-8 rounded border border-border bg-surface px-0.5 text-center text-[10px] text-ink"
          />
          <input
            type="number"
            min={7}
            max={90}
            value={dias}
            title="Días"
            onChange={(e) => setDias(Number(e.target.value) || 30)}
            className="w-8 rounded border border-border bg-surface px-0.5 text-center text-[10px] text-ink"
          />
          <input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Filtrar…"
            className="w-20 rounded border border-border bg-surface px-1 text-[10px] text-ink"
          />
          <button
            type="button"
            disabled={cargando}
            onClick={() =>
              mut.mutate({
                top_n: topN,
                dias,
                consulta: consulta.trim() || undefined,
              })
            }
            className="mck-chip-compact rounded bg-accent px-1.5 font-bold text-white disabled:opacity-60"
          >
            {cargando ? "…" : "Actualizar"}
          </button>
        </div>
      </div>

      {error ? <p className="shrink-0 text-[10px] leading-none text-danger">{error}</p> : null}

      <div className="flex min-h-0 flex-1 flex-col gap-1 lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-1 lg:w-72 xl:w-80">
          <input
            type="search"
            value={busquedaLista}
            onChange={(e) => setBusquedaLista(e.target.value)}
            placeholder="Buscar…"
            className="w-full rounded border border-border bg-surface px-1.5 text-[10px] text-ink"
          />
          <div className="min-h-[8rem] flex-1 divide-y divide-border/70 overflow-y-auto rounded-lg border border-border bg-surface lg:min-h-0">
            {visiblesFiltrados.length === 0 ? (
              <p className="px-2 py-2 text-center text-[10px] text-muted">Sin productos.</p>
            ) : (
              visiblesFiltrados.map((p) => (
                <ItemLista
                  key={p.item_id}
                  p={p}
                  selected={p.item_id === selectedId}
                  onSelect={() => setSelectedId(p.item_id)}
                />
              ))
            )}
          </div>
        </aside>

        <main className="min-h-[14rem] flex-1 overflow-hidden rounded border border-border bg-surface lg:min-h-0">
          {selected ? (
            <PanelDetalle key={selected.item_id} p={selected} />
          ) : (
            <p className="p-4 text-center text-[11px] text-muted">Elegí un producto</p>
          )}
        </main>
      </div>
    </div>
  );
}
