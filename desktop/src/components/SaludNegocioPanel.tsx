import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  useSaludNegocioResumen,
  useRefrescarSaludNegocio,
  type SaludAdsRecomendaciones,
  type SaludBancario,
  type SaludBucket,
  type SaludPeriodicidad,
} from "../hooks/useSaludNegocio";
import { ScoreRing, colorNota } from "./ui/ScoreRing";
import { useAppStore } from "../stores/app";

// ── Helpers ──────────────────────────────────────────────────────────────────

function cop(n: number | null | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString("es-CO")}`;
}

function copCompacto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toLocaleString("es-CO", { maximumFractionDigits: 0 })}K`;
  return cop(n);
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${n.toLocaleString("es-CO", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

// Diario: 90 días primero — todo el ancho de la ventana de ads de MeLi, y
// suficiente para que las medias móviles de 55 períodos ya estén "calientes".
// Semanal: 12 semanas primero — son las que caben en esos mismos 90 días.
// Mensual solo ofrece el año completo (12 meses); no tiene sentido
// fragmentarla en 3/6/12 como en semanal.
const N_OPCIONES: Record<SaludPeriodicidad, number[]> = {
  dia: [90, 60, 30],
  semana: [12, 8, 26],
  mes: [12],
};

const UNIDAD_N: Record<SaludPeriodicidad, string> = {
  dia: "días",
  semana: "semanas",
  mes: "meses",
};

// ── Series de costo (orden fijo, mismo criterio categórico en todo el panel) ──

type CostKey = "costo_producto" | "comisiones_meli" | "gasto_ads" | "costos_admin";

const COST_SERIES: { key: CostKey; label: string; swatch: string; fillClass: string }[] = [
  { key: "costo_producto", label: "Costo de producto", swatch: "bg-accent-sky", fillClass: "fill-accent-sky" },
  { key: "comisiones_meli", label: "Comisión/envío MeLi", swatch: "bg-accent-plum", fillClass: "fill-accent-plum" },
  { key: "gasto_ads", label: "Gasto en ads", swatch: "bg-accent-sun", fillClass: "fill-accent-sun" },
  { key: "costos_admin", label: "Costos admin (nómina + servicios)", swatch: "bg-muted/50", fillClass: "fill-muted" },
];

function valorSerie(b: SaludBucket, key: CostKey): number {
  return key === "costos_admin" ? b.costos_admin.total : b[key];
}

// ── Sub-componentes compartidos ────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  subClass,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5" title={title}>
      <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-ink font-mono tabular-nums">{value}</p>
      {sub && <p className={`text-[11px] mt-0.5 ${subClass ?? "text-ink-secondary"}`}>{sub}</p>}
    </div>
  );
}

function Explicacion({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary bg-surface/60 border border-border rounded-lg px-3 py-2">
      {children}
    </p>
  );
}

// ── Gráfico de tendencia: costos apilados (COP) + línea de ingresos (COP) ──
// Un solo eje: ingresos y costos son la misma unidad (COP), así que superponer
// la línea de ingresos sobre las barras de costo NO es un gráfico de doble eje.
// El margen % (unidad distinta) va en su propio gráfico más abajo.

function TendenciaChart({ buckets }: { buckets: SaludBucket[] }) {
  const W = 640;
  const H = 230;
  const padL = 34;
  const padR = 8;
  const padT = 16;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxIngreso = Math.max(1, ...buckets.map((b) => b.ingresos_total));
  const maxCosto = Math.max(
    1,
    ...buckets.map((b) => b.costo_producto + b.comisiones_meli + b.gasto_ads + b.costos_admin.total),
  );
  const maxY = Math.max(maxIngreso, maxCosto);
  const tickCount = 4;
  const rawStep = maxY / tickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const step = Math.ceil(rawStep / magnitude) * magnitude || 1;
  const niceMax = step * tickCount;

  const n = buckets.length;
  const slot = plotW / n;
  const barW = Math.min(24, slot * 0.55);
  const gapPx = 2;

  function y(v: number): number {
    return padT + plotH - (v / niceMax) * plotH;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2 text-[11px] text-ink-secondary">
        {COST_SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm shrink-0 ${s.swatch}`} />
            {s.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-accent shrink-0" />
          Ingresos totales
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Tendencia de ingresos y costos por período">
        {Array.from({ length: tickCount + 1 }, (_, i) => {
          const v = (niceMax / tickCount) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} className="stroke-border" strokeWidth={1} />
              <text x={0} y={yy - 2} className="fill-muted" fontSize={8}>
                {copCompacto(v)}
              </text>
            </g>
          );
        })}

        {/* franja del período actual — el punto de comparación de todos los demás */}
        <rect
          x={padL + slot * (n - 1)}
          y={padT}
          width={slot}
          height={plotH}
          className="fill-accent"
          opacity={0.06}
        />

        {buckets.map((b, i) => {
          const cx = padL + slot * i + slot / 2;
          let acc = 0;
          const segs = COST_SERIES.map((s) => {
            const v = valorSerie(b, s.key);
            const y0 = y(acc);
            acc += v;
            const y1 = y(acc);
            return { ...s, v, y0, y1 };
          });
          return (
            <g key={b.label}>
              {segs.map((s, si) => {
                const top = Math.min(s.y0, s.y1);
                const rawH = Math.abs(s.y1 - s.y0);
                const h = Math.max(0, rawH - (si < segs.length - 1 ? gapPx : 0));
                if (h <= 0) return null;
                return (
                  <rect
                    key={s.key}
                    x={cx - barW / 2}
                    y={top}
                    width={barW}
                    height={h}
                    rx={si === segs.length - 1 ? 2 : 0}
                    className={`${s.fillClass} opacity-90 hover:opacity-100`}
                  >
                    <title>{`${s.label} · ${b.label}: ${cop(s.v)}`}</title>
                  </rect>
                );
              })}
              <text
                x={cx}
                y={H - padB + 12}
                textAnchor="middle"
                className={i === n - 1 ? "fill-accent font-semibold" : "fill-muted"}
                fontSize={8}
              >
                {b.label}
              </text>
            </g>
          );
        })}

        <polyline
          points={buckets.map((b, i) => `${padL + slot * i + slot / 2},${y(b.ingresos_total)}`).join(" ")}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {buckets.map((b, i) => {
          const cx = padL + slot * i + slot / 2;
          const cy = y(b.ingresos_total);
          const isLast = i === buckets.length - 1;
          return (
            <g key={`dot-${b.label}`}>
              <circle cx={cx} cy={cy} r={4} className="fill-accent stroke-surface-panel" strokeWidth={2}>
                <title>{`Ingresos totales · ${b.label}: ${cop(b.ingresos_total)}`}</title>
              </circle>
              {isLast && (
                <text x={cx} y={cy - 8} textAnchor="middle" className="fill-accent font-semibold" fontSize={9}>
                  {copCompacto(b.ingresos_total)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Sparkline compacto de margen neto % por período ─────────────────────────
// Reemplaza al gráfico técnico anterior (velas + EMA10/EMA55 + Squeeze +
// MACD, vía lightweight-charts) — mismo SVG a mano que el resto del panel,
// una sola línea, sin ejes ni indicadores: para un negocio de este tamaño la
// pregunta es "¿el margen viene subiendo o bajando?", no un análisis técnico
// completo. El punto final se resalta con el color de la calificación.

function notaHex(score: number): string {
  if (score >= 85) return "#34d399";
  if (score >= 70) return "#38bdf8";
  if (score >= 50) return "#fbbf24";
  return "#f87171";
}

function MargenSparkline({ buckets }: { buckets: SaludBucket[] }) {
  const W = 640;
  const H = 90;
  const padX = 8;
  const padY = 14;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  const valores = buckets.map((b) => b.margen_pct);
  const min = Math.min(...valores, 0);
  const max = Math.max(...valores, 0);
  const rango = max - min || 1;
  const n = buckets.length;

  function x(i: number): number {
    return n <= 1 ? padX + plotW / 2 : padX + (plotW * i) / (n - 1);
  }
  function y(v: number): number {
    return padY + plotH - ((v - min) / rango) * plotH;
  }

  const puntos = buckets.map((b, i) => `${x(i)},${y(b.margen_pct)}`).join(" ");
  const ultimo = buckets[n - 1];
  const colorUltimo = notaHex(ultimo.score);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Tendencia de margen neto por período">
      {min < 0 && max > 0 && (
        <line x1={padX} x2={W - padX} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />
      )}
      <polyline points={puntos} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {buckets.map((b, i) => (
        <circle key={b.label + b.inicio} cx={x(i)} cy={y(b.margen_pct)} r={i === n - 1 ? 4 : 2.5} fill={i === n - 1 ? colorUltimo : "currentColor"} className={i === n - 1 ? "" : "text-accent"}>
          <title>{`${b.label}: ${b.margen_pct.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%`}</title>
        </circle>
      ))}
      <text x={padX} y={12} className="fill-muted" fontSize={9}>
        {buckets[0].label}: {valores[0].toLocaleString("es-CO", { maximumFractionDigits: 1 })}%
      </text>
      <text x={W - padX} y={12} textAnchor="end" fontSize={9} fill={colorUltimo} fontWeight={700}>
        {ultimo.label}: {valores[n - 1].toLocaleString("es-CO", { maximumFractionDigits: 1 })}%
      </text>
    </svg>
  );
}

// ── Desglose (waterfall horizontal) del período seleccionado ──────────────

function DesgloseBar({ bucket }: { bucket: SaludBucket }) {
  const totalCostos = bucket.costo_producto + bucket.comisiones_meli + bucket.gasto_ads + bucket.costos_admin.total;
  const esPerdida = bucket.utilidad_neta < 0;
  const base = esPerdida ? totalCostos || 1 : bucket.ingresos_total || totalCostos || 1;

  const segs = [
    { label: "Costo de producto", value: bucket.costo_producto, className: "bg-accent-sky" },
    { label: "Comisión/envío MeLi", value: bucket.comisiones_meli, className: "bg-accent-plum" },
    {
      label: "Gasto en ads",
      value: bucket.gasto_ads,
      className: bucket.ads_disponible ? "bg-accent-sun" : "bg-transparent border-2 border-dashed border-accent-sun",
      sinDatos: !bucket.ads_disponible,
    },
    { label: "Costos admin", value: bucket.costos_admin.total, className: "bg-muted/50" },
    ...(esPerdida ? [] : [{ label: "Utilidad neta", value: bucket.utilidad_neta, className: "bg-success" }]),
  ];

  return (
    <div>
      <div className="flex h-8 rounded-lg overflow-hidden border border-border">
        {segs.map((s, i) => (
          <div
            key={i}
            style={{ width: `${Math.max(0, (s.value / base) * 100)}%` }}
            className={s.className}
            title={"sinDatos" in s && s.sinDatos ? "Gasto en ads: sin datos (MeLi no expone métricas de más de 90 días)" : `${s.label}: ${cop(s.value)}`}
          />
        ))}
      </div>

      {esPerdida && (
        <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger font-semibold">
          Pérdida en el período: {cop(bucket.utilidad_neta)} — los costos superaron los ingresos totales.
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {segs.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`mt-1 h-2.5 w-2.5 rounded-sm shrink-0 ${s.className}`} />
            <div>
              <p className="text-xs font-bold text-ink">{s.label}</p>
              <p className={`text-[11px] font-mono ${"sinDatos" in s && s.sinDatos ? "text-warning italic" : "text-muted"}`}>
                {"sinDatos" in s && s.sinDatos ? "Sin datos (>90 días)" : cop(s.value)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Diferencia en puntos porcentuales de margen vs. el período actual, con signo. */
function deltaMargenTexto(b: SaludBucket, actual: SaludBucket): string {
  if (b.label === actual.label && b.inicio === actual.inicio) return "—";
  const d = b.margen_pct - actual.margen_pct;
  const signo = d > 0 ? "+" : "";
  return `${signo}${d.toLocaleString("es-CO", { maximumFractionDigits: 1 })} pp`;
}

// ── Tabla de detalle por período ────────────────────────────────────────────
// Compacta a propósito (5 columnas) para que quepa entera en pantalla sin
// scroll horizontal — la utilidad neta es la columna más grande/visible. El
// desglose de costos (que antes eran 5 columnas más) se ve por fila al
// expandirla, reutilizando el mismo DesgloseBar del período actual de arriba.

function TablaPeriodos({ buckets, actual }: { buckets: SaludBucket[]; actual: SaludBucket }) {
  // Arranca con la fila "actual" ya expandida — reemplaza a la card
  // standalone de desglose que había antes arriba de la tabla (mismo
  // DesgloseBar, un solo lugar en vez de dos).
  const [expandido, setExpandido] = useState<string | null>(actual.label + actual.inicio);

  return (
    <div className="rounded-xl border-2 border-border overflow-hidden">
      <div className="max-h-[480px] overflow-y-auto">
        <table className="w-full text-left table-fixed">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[20%]" />
            <col className="w-[24%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface-hover border-b-2 border-border text-[10px] font-bold uppercase tracking-wide text-muted">
              <th className="px-3 py-2.5">Período</th>
              <th className="px-3 py-2.5 text-right">Ingresos</th>
              <th className="px-3 py-2.5 text-right">Utilidad neta</th>
              <th className="px-3 py-2.5 text-right">Margen</th>
              <th className="px-3 py-2.5 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {[...buckets].reverse().map((b) => {
              const clave = b.label + b.inicio;
              const esActual = b.label === actual.label && b.inicio === actual.inicio;
              const delta = deltaMargenTexto(b, actual);
              const abierto = expandido === clave;
              return (
                <Fragment key={clave}>
                  <tr
                    onClick={() => setExpandido(abierto ? null : clave)}
                    className={`border-b border-border cursor-pointer hover:bg-surface-hover ${
                      esActual ? "bg-accent/10" : ""
                    } ${abierto ? "border-b-0" : ""}`}
                  >
                    <td className="px-3 py-2.5 text-sm font-semibold text-ink">
                      <span className={`inline-block mr-1 text-muted transition-transform ${abierto ? "rotate-90" : ""}`}>
                        ›
                      </span>
                      {b.label}
                      {esActual && (
                        <span
                          className="ml-1.5 rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent align-middle"
                          title={b.cerrado ? undefined : "Período todavía en curso — no incluido en los gráficos hasta que cierre"}
                        >
                          {b.cerrado ? "Actual" : "En curso"}
                        </span>
                      )}
                      {!b.ads_disponible && (
                        <span
                          className="ml-1.5 text-warning font-bold align-middle"
                          title="Gasto en ads sin datos (MeLi no expone métricas de más de 90 días) — utilidad probablemente sobreestimada"
                        >
                          ⚠
                        </span>
                      )}
                      <span className="block text-[10px] text-muted font-normal truncate">
                        {b.inicio} → {b.fin}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-sm text-ink-secondary">{copCompacto(b.ingresos_total)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={`inline-block rounded-lg px-2 py-1 font-mono tabular-nums text-base font-bold ${
                          b.utilidad_neta >= 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
                        }`}
                      >
                        {copCompacto(b.utilidad_neta)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-mono tabular-nums text-sm text-ink">{pct(b.margen_pct)}</span>
                      <span
                        className={`block text-[10px] ${
                          delta === "—" ? "text-muted" : delta.startsWith("+") ? "text-success" : "text-danger"
                        }`}
                        title="Diferencia de margen vs. el período actual, en puntos porcentuales"
                      >
                        {delta === "—" ? "—" : `${delta} vs. actual`}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono tabular-nums text-sm font-semibold ${colorNota(b.score)}`}>
                      {b.score}
                    </td>
                  </tr>
                  {abierto && (
                    <tr className="border-b border-border bg-surface/60">
                      <td colSpan={5} className="px-3 py-3">
                        <DesgloseBar bucket={b} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Franja "Estado ahora": publicidad a pausar/revisar + saldo bancario ─────
// Son snapshots del momento (no series históricas), por eso van aparte de los
// buckets semanales/mensuales — dos tiles chicos, no una card llena, para no
// sumarle peso visual al panel.

function EstadoAhoraTiles({ ads, saldo }: { ads: SaludAdsRecomendaciones | null; saldo: SaludBancario | null }) {
  const setPanel = useAppStore((s) => s.setPanel);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {ads && (
        <button
          type="button"
          onClick={() => setPanel("publicidad")}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:border-accent transition"
        >
          <p className="text-[10px] text-muted uppercase tracking-wide">Publicidad MeLi</p>
          {ads.pausar === 0 && ads.revisar === 0 ? (
            <p className="text-sm font-semibold text-success mt-0.5">Todo dentro de objetivo</p>
          ) : (
            <p className="text-sm font-semibold text-ink mt-0.5">
              {ads.pausar > 0 && <span className="text-danger">Pausar {ads.pausar} ({copCompacto(ads.costo_pausar)})</span>}
              {ads.pausar > 0 && ads.revisar > 0 && " · "}
              {ads.revisar > 0 && <span className="text-warning">Revisar {ads.revisar} ({copCompacto(ads.costo_revisar)})</span>}
            </p>
          )}
        </button>
      )}
      <button
        type="button"
        onClick={() => setPanel("ingresos-egresos")}
        className="rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:border-accent transition"
      >
        <p className="text-[10px] text-muted uppercase tracking-wide">Saldo bancario</p>
        {saldo ? (
          <>
            <p className="text-sm font-semibold text-ink mt-0.5">{cop(saldo.saldo)}</p>
            <p className="text-[10px] text-muted mt-0.5">
              Extracto {saldo.fecha} — puede no reflejar movimientos posteriores
            </p>
          </>
        ) : (
          <p className="text-sm font-semibold text-muted mt-0.5">Sin extracto bancario cargado</p>
        )}
      </button>
    </div>
  );
}

// ── Panel principal ──────────────────────────────────────────────────────────

export default function SaludNegocioPanel() {
  // Por defecto: últimas 12 semanas (semanal, no mensual) — 12 semanas = 84
  // días, dentro de la ventana de 90 días que MeLi retiene el gasto en ads
  // (límite permanente de la plataforma, confirmado ago-2026 incluso desde
  // su propio panel de Mercado Ads). Con 12 meses en cambio, 9 de 12 quedan
  // sin ese dato para siempre — con semanas, ninguna.
  const [periodicidad, setPeriodicidad] = useState<SaludPeriodicidad>("semana");
  const [n, setN] = useState<number>(12);
  const { data, isLoading, error, isFetching } = useSaludNegocioResumen(periodicidad, n);
  const refrescar = useRefrescarSaludNegocio(periodicidad, n);
  const [refrescando, setRefrescando] = useState(false);

  async function onRefrescar() {
    setRefrescando(true);
    try {
      await refrescar();
    } finally {
      setRefrescando(false);
    }
  }

  function onPeriodicidad(p: SaludPeriodicidad) {
    setPeriodicidad(p);
    setN(N_OPCIONES[p][0]);
  }

  const actual = data?.actual ?? null;
  const tendenciaTexto = useMemo(() => {
    if (data?.tendencia_margen_pp == null) return null;
    const v = data.tendencia_margen_pp;
    const signo = v > 0 ? "+" : "";
    return `${signo}${v.toLocaleString("es-CO", { maximumFractionDigits: 1 })} pp vs. período anterior`;
  }, [data]);

  // Los gráficos solo muestran períodos con gasto en ads confirmado — mezclar
  // "sin dato" con "$0 real" en la misma línea/barra es justo lo que causó el
  // diagnóstico erróneo la primera vez que se armó este panel. La tabla de
  // abajo sí lista todos los períodos, con el ⚠ correspondiente.
  const bucketsConfiables = useMemo(() => (data?.buckets ?? []).filter((b) => b.ads_disponible), [data]);
  const bucketsOcultos = (data?.buckets.length ?? 0) - bucketsConfiables.length;
  // El último período (hoy / esta semana / este mes) sigue en curso — todavía
  // no "cerró". Graficarlo junto a los cerrados arma una vela/barra gigante
  // y engañosa (poquitas horas de venta contra un día completo de costos
  // fijos) que se lee como un desplome real cuando en realidad el período
  // simplemente no terminó. Se sigue mostrando arriba (ScoreRing, StatTiles,
  // tabla) con badge "En curso" — solo se saca de los gráficos.
  const bucketsCerrados = useMemo(() => bucketsConfiables.filter((b) => b.cerrado), [bucketsConfiables]);

  return (
    <div className="space-y-5 p-4">
      {/* ── Header ── */}
      <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">Salud del negocio</h2>
            <p className="text-xs text-muted mt-0.5 max-w-2xl leading-relaxed">
              Rentabilidad neta real: ingresos de MeLi y la web, menos costo de producto, comisiones y envío
              de MeLi, gasto en publicidad y costos administrativos/fijos — por semana o por mes, con una
              calificación de 0 a 100.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border-2 border-border overflow-hidden">
              {(["dia", "semana", "mes"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPeriodicidad(p)}
                  className={`px-3 py-2 text-sm font-semibold transition ${
                    periodicidad === p ? "bg-accent text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {p === "dia" ? "Diario" : p === "semana" ? "Semanal" : "Mensual"}
                </button>
              ))}
            </div>
            {N_OPCIONES[periodicidad].length > 1 ? (
              <select
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="rounded-xl border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent cursor-pointer"
              >
                {N_OPCIONES[periodicidad].map((opt) => (
                  <option key={opt} value={opt}>
                    Últimas {opt} {UNIDAD_N[periodicidad]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-xl border-2 border-border bg-surface px-3 py-2 text-sm text-muted whitespace-nowrap">
                Último año (12 meses)
              </span>
            )}
            <button
              type="button"
              onClick={() => void onRefrescar()}
              disabled={refrescando || isFetching}
              className="shrink-0 rounded-xl border-2 border-border px-4 py-2 text-sm font-semibold text-muted hover:text-ink hover:border-accent disabled:opacity-50 flex items-center gap-2 transition"
            >
              {refrescando || isFetching ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              ) : (
                <span className="text-base">↻</span>
              )}
              Actualizar
            </button>
          </div>
        </div>

        {data && (
          <p className="mt-2 text-[11px] text-muted">
            Generado {new Date(data.generado_en).toLocaleString("es-CO", { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>

      {data && <EstadoAhoraTiles ads={data.ads_recomendaciones} saldo={data.saldo_bancario} />}

      {/* ── Estados de carga / error ── */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted">
          <div className="flex items-center gap-3">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Cruzando ventas, costos, ads y gastos fijos…
          </div>
          <p className="text-xs text-muted/80 max-w-md text-center">
            La primera carga del período en curso consulta MeLi y puede tardar hasta un minuto.
            Las semanas ya cerradas salen de caché.
          </p>
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-8 text-center">
          <p className="text-2xl mb-2">⚠️</p>
          <p className="text-sm font-semibold text-danger">No se pudo calcular la salud del negocio</p>
          <p className="text-xs text-muted mt-1">{(error as Error).message}</p>
        </div>
      )}

      {!isLoading && !error && data && actual && (
        <>
          {/* ── Score + utilidad neta (los 2 números que más importan) + stats ── */}
          <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
            <div className="flex flex-col md:flex-row gap-4 items-stretch">
              <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
                <ScoreRing
                  nota={actual.score}
                  label={actual.label}
                  sub={actual.cerrado ? `Calificación: ${actual.calificacion}` : "En curso — datos parciales"}
                />
                <div
                  className={`rounded-xl border-2 px-5 py-4 text-center sm:text-left min-w-[220px] ${
                    actual.utilidad_neta >= 0 ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"
                  }`}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    Utilidad neta · {actual.label}
                    {!actual.cerrado && <span className="ml-1.5 normal-case text-warning">(en curso, parcial)</span>}
                  </p>
                  <p className={`text-3xl font-bold font-mono tabular-nums ${actual.utilidad_neta >= 0 ? "text-success" : "text-danger"}`}>
                    {cop(actual.utilidad_neta)}
                  </p>
                  <p className="text-xs text-ink-secondary mt-1">
                    Margen {pct(actual.margen_pct)} · Ingresos {cop(actual.ingresos_total)}
                  </p>
                  {tendenciaTexto && (
                    <p className={`text-[11px] mt-1 font-semibold ${data.tendencia_margen_pp! >= 0 ? "text-success" : "text-danger"}`}>
                      {tendenciaTexto}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2 content-start">
                <StatTile
                  label="Ingresos totales"
                  value={cop(actual.ingresos_total)}
                  sub={`MeLi ${cop(actual.ingresos_meli)} · Web ${cop(actual.ingresos_web)} · Otros ${cop(actual.ingresos_otros_canales)}`}
                />
                <StatTile label="Costo de producto" value={cop(actual.costo_producto)} />
                <StatTile label="Comisión/envío MeLi" value={cop(actual.comisiones_meli)} />
                <StatTile
                  label="Gasto en ads"
                  value={actual.ads_disponible ? cop(actual.gasto_ads) : "Sin datos"}
                  sub={actual.ads_disponible ? (actual.acos_ads != null ? `ACOS ${pct(actual.acos_ads)}` : undefined) : "MeLi no expone datos de >90 días"}
                  subClass={actual.ads_disponible ? undefined : "text-warning"}
                />
                <StatTile
                  label="Costos admin"
                  value={cop(actual.costos_admin.total)}
                  sub={`Nómina ${cop(actual.costos_admin.nomina)} · Servicios ${cop(actual.costos_admin.servicios)}`}
                  subClass={data.fuente_nomina === "sin_datos" ? "text-danger font-semibold" : undefined}
                />
                <StatTile label="Margen neto" value={pct(actual.margen_pct)} />
              </div>
            </div>

            {data.fuente_nomina === "sin_datos" && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger font-semibold">
                No hay nómina registrada en ninguna fuente (ni RRHH → Compensaciones ni Contabilidad →
                Operativos → Nómina) — la utilidad neta de este período NO incluye sueldos y está inflada.
              </div>
            )}

            {!actual.ads_disponible && (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning font-semibold">
                Gasto en ads no disponible para este período — límite permanente de MeLi (90 días), no
                recuperable ni desde el panel de Mercado Ads. Si hubo pauta activa, la utilidad neta
                mostrada NO la descuenta y está sobreestimada.
              </div>
            )}

            {actual.otros_canales_facturas > 0 && (
              <div className="mt-3 rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs text-ink-secondary">
                <strong className="text-ink">Otros canales</strong> ({cop(actual.ingresos_otros_canales)}) son
                facturas Alegra que no calzan con el patrón de MeLi ni con la referencia web MCKG- —
                principalmente venta directa por WhatsApp, aproximada por descarte: {actual.otros_canales_facturas}{" "}
                factura{actual.otros_canales_facturas === 1 ? "" : "s"}
                {actual.otros_canales_con_marcador_wa > 0
                  ? `, ${actual.otros_canales_con_marcador_wa} marcada${actual.otros_canales_con_marcador_wa === 1 ? "" : "s"} explícitamente como WhatsApp`
                  : ""}
                . Puede incluir correcciones o ventas de mostrador ajenas a WhatsApp.
              </div>
            )}

            <Explicacion>
              Score: margen neto (60%) + eficiencia de ads por ACOS (20%) + tendencia vs. período anterior
              (20%). <strong className="text-emerald-400">≥85 excelente</strong> ·{" "}
              <strong className="text-sky-400">≥70 bueno</strong> ·{" "}
              <strong className="text-amber-400">≥50 regular</strong> ·{" "}
              <strong className="text-red-400">&lt;50 riesgo</strong>. Nómina: {cop(data.nomina_mensual)}/mes
              (
              {data.fuente_nomina === "rrhh_compensaciones" ? "RRHH → Compensaciones" : data.fuente_nomina === "contabilidad_empleados" ? "Contabilidad → Operativos → Nómina" : "sin fuente"}
              ) prorrateada por días.
            </Explicacion>
          </div>

          {/* ── Tendencia ── */}
          {bucketsCerrados.length > 0 && (
            <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
              <h3 className="text-sm font-bold text-ink mb-1">Ingresos vs. costos por período</h3>
              <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
                Barras: de qué se compone el costo total de cada período. Línea: ingresos totales del mismo
                período. No incluye el período en curso ({actual.label}), que todavía no cerró.
                {bucketsOcultos > 0 &&
                  ` Se ocultan además ${bucketsOcultos} período${bucketsOcultos === 1 ? "" : "s"} sin dato de ads.`}
              </p>
              <TendenciaChart buckets={bucketsCerrados} />
              <h4 className="text-xs font-bold text-ink mt-4 mb-1">Margen neto</h4>
              <MargenSparkline buckets={bucketsCerrados} />
            </div>
          )}

          {/* ── Tabla ── */}
          <div>
            <h3 className="text-sm font-bold text-ink mb-2">Detalle por período</h3>
            <TablaPeriodos buckets={data.buckets} actual={actual} />
          </div>
        </>
      )}
    </div>
  );
}
