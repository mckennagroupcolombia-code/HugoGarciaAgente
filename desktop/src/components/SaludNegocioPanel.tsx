import { useMemo, useState, type ReactNode } from "react";
import {
  useSaludNegocioResumen,
  useRefrescarSaludNegocio,
  type SaludBucket,
  type SaludPeriodicidad,
} from "../hooks/useSaludNegocio";
import { ScoreRing, colorNota } from "./ui/ScoreRing";

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

/** Mismos cortes que colorNota (85/70/50) pero como clase `fill-*` para marcas SVG. */
function fillNota(n: number): string {
  if (n >= 85) return "fill-emerald-400";
  if (n >= 70) return "fill-sky-400";
  if (n >= 50) return "fill-amber-400";
  return "fill-red-400";
}

const N_OPCIONES: Record<SaludPeriodicidad, number[]> = {
  semana: [8, 12, 26],
  mes: [3, 6, 12],
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
              <text x={cx} y={H - padB + 12} textAnchor="middle" className="fill-muted" fontSize={8}>
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

// ── Gráfico de margen % (eje propio, no comparte escala con el de arriba) ──

function MargenChart({ buckets }: { buckets: SaludBucket[] }) {
  const W = 640;
  const H = 130;
  const padL = 30;
  const padR = 8;
  const padT = 14;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const vals = buckets.map((b) => b.margen_pct);
  const minVal = Math.min(0, ...vals);
  const maxVal = Math.max(0, ...vals);
  const span = maxVal - minVal || 10;
  const domainMin = minVal - span * 0.15;
  const domainMax = maxVal + span * 0.15;

  function y(v: number): number {
    return padT + plotH - ((v - domainMin) / (domainMax - domainMin)) * plotH;
  }

  const n = buckets.length;
  const slot = plotW / n;
  const zeroY = y(0);
  const ultimo = buckets[buckets.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Tendencia de margen neto porcentual">
      <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} className="stroke-border-strong" strokeWidth={1} />
      <text x={0} y={zeroY - 2} className="fill-muted" fontSize={8}>
        0%
      </text>

      <polyline
        points={buckets.map((b, i) => `${padL + slot * i + slot / 2},${y(b.margen_pct)}`).join(" ")}
        fill="none"
        className="stroke-accent"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {buckets.map((b, i) => {
        const cx = padL + slot * i + slot / 2;
        const cy = y(b.margen_pct);
        const isLast = i === buckets.length - 1;
        return (
          <g key={b.label}>
            <circle
              cx={cx}
              cy={cy}
              r={isLast ? 5 : 3.5}
              className={`${isLast ? fillNota(b.score) : "fill-accent"} stroke-surface-panel`}
              strokeWidth={2}
            >
              <title>{`Margen neto · ${b.label}: ${pct(b.margen_pct)} (score ${b.score}/100, ${b.calificacion})`}</title>
            </circle>
            <text x={cx} y={H - padB + 12} textAnchor="middle" className="fill-muted" fontSize={8}>
              {b.label}
            </text>
          </g>
        );
      })}

      {ultimo && (
        <text
          x={padL + slot * (n - 1) + slot / 2}
          y={y(ultimo.margen_pct) - 10}
          textAnchor="middle"
          className={`font-semibold ${colorNota(ultimo.score).replace("text-", "fill-")}`}
          fontSize={9}
        >
          {pct(ultimo.margen_pct)}
        </text>
      )}
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
    { label: "Gasto en ads", value: bucket.gasto_ads, className: "bg-accent-sun" },
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
            title={`${s.label}: ${cop(s.value)}`}
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
              <p className="text-[11px] text-muted font-mono">{cop(s.value)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tabla de detalle por período (vista de tabla del mismo dato de los gráficos) ──

function TablaPeriodos({ buckets }: { buckets: SaludBucket[] }) {
  return (
    <div className="rounded-xl border-2 border-border overflow-hidden">
      <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface-hover border-b-2 border-border text-[10px] font-bold uppercase tracking-wide text-muted">
              <th className="px-3 py-2.5">Período</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Ingresos</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Costo producto</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Comisión MeLi</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Ads</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Admin</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Utilidad neta</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Margen</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Score</th>
            </tr>
          </thead>
          <tbody>
            {[...buckets].reverse().map((b) => (
              <tr key={b.label + b.inicio} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                <td className="px-3 py-2 text-sm font-semibold text-ink whitespace-nowrap">
                  {b.label}
                  <span className="block text-[10px] text-muted font-normal">
                    {b.inicio} → {b.fin}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink whitespace-nowrap">{cop(b.ingresos_total)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink-secondary whitespace-nowrap">{cop(b.costo_producto)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink-secondary whitespace-nowrap">{cop(b.comisiones_meli)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink-secondary whitespace-nowrap">{cop(b.gasto_ads)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink-secondary whitespace-nowrap">{cop(b.costos_admin.total)}</td>
                <td
                  className={`px-3 py-2 text-right font-mono tabular-nums text-sm font-semibold whitespace-nowrap ${
                    b.utilidad_neta >= 0 ? "text-success" : "text-danger"
                  }`}
                >
                  {cop(b.utilidad_neta)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink whitespace-nowrap">{pct(b.margen_pct)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums text-sm font-semibold whitespace-nowrap ${colorNota(b.score)}`}>
                  {b.score}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Panel principal ──────────────────────────────────────────────────────────

export default function SaludNegocioPanel() {
  const [periodicidad, setPeriodicidad] = useState<SaludPeriodicidad>("semana");
  const [n, setN] = useState<number>(8);
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
              {(["semana", "mes"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPeriodicidad(p)}
                  className={`px-3 py-2 text-sm font-semibold transition ${
                    periodicidad === p ? "bg-accent text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {p === "semana" ? "Semanal" : "Mensual"}
                </button>
              ))}
            </div>
            <select
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              className="rounded-xl border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent cursor-pointer"
            >
              {N_OPCIONES[periodicidad].map((opt) => (
                <option key={opt} value={opt}>
                  Últimas {opt} {periodicidad === "semana" ? "semanas" : "meses"}
                </option>
              ))}
            </select>
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
            {tendenciaTexto && ` · ${tendenciaTexto}`}
          </p>
        )}
      </div>

      {/* ── Estados de carga / error ── */}
      {isLoading && (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Cruzando ventas, costos, ads y gastos fijos…
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
          {/* ── Score + stats del período actual ── */}
          <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
            <div className="flex flex-col lg:flex-row gap-4 items-center lg:items-start">
              <ScoreRing nota={actual.score} label={actual.label} sub={`Calificación: ${actual.calificacion}`} />
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 w-full">
                <StatTile label="Ingresos totales" value={cop(actual.ingresos_total)} sub={`MeLi ${cop(actual.ingresos_meli)} · Web ${cop(actual.ingresos_web)}`} />
                <StatTile label="Costo de producto" value={cop(actual.costo_producto)} />
                <StatTile label="Comisión/envío MeLi" value={cop(actual.comisiones_meli)} />
                <StatTile label="Gasto en ads" value={cop(actual.gasto_ads)} sub={actual.acos_ads != null ? `ACOS ${pct(actual.acos_ads)}` : undefined} />
                <StatTile label="Costos admin" value={cop(actual.costos_admin.total)} sub={`Nómina ${cop(actual.costos_admin.nomina)} · Servicios ${cop(actual.costos_admin.servicios)}`} />
                <StatTile
                  label="Utilidad neta"
                  value={cop(actual.utilidad_neta)}
                  subClass={actual.utilidad_neta >= 0 ? "text-success font-semibold" : "text-danger font-semibold"}
                  sub={actual.utilidad_neta >= 0 ? "Positiva" : "Negativa"}
                />
                <StatTile label="Margen neto" value={pct(actual.margen_pct)} />
              </div>
            </div>
            <Explicacion>
              El <strong className="text-ink">score</strong> pondera margen neto (60%), eficiencia de ads
              por ACOS de campaña (20%) y tendencia frente al período anterior (20%). Cortes:{" "}
              <strong className="text-emerald-400">≥85 excelente</strong>,{" "}
              <strong className="text-sky-400">≥70 bueno</strong>,{" "}
              <strong className="text-amber-400">≥50 regular</strong>,{" "}
              <strong className="text-red-400">&lt;50 riesgo</strong>. La comisión/envío de MeLi usa la
              tarifa <em>actual</em> aplicada a las unidades del período (MeLi no expone el cobro histórico
              real por orden); la nómina se prorratea por días sobre el total mensual vigente (costo
              devengado, no pago real); los servicios fijos sí son pagos reales con fecha. No se descuenta
              comisión de pasarela de pago en ventas web — la utilidad web está levemente sobreestimada.
            </Explicacion>
          </div>

          {/* ── Tendencia ── */}
          <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink mb-1">Ingresos vs. costos por período</h3>
            <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
              Barras: de qué se compone el costo total de cada período. Línea: ingresos totales (MeLi + web)
              del mismo período — misma unidad (COP), un solo eje.
            </p>
            <TendenciaChart buckets={data.buckets} />
          </div>

          {/* ── Margen ── */}
          <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink mb-1">Margen neto (%)</h3>
            <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
              Utilidad neta ÷ ingresos totales × 100, por período. El último punto se colorea según la
              misma calificación del score.
            </p>
            <MargenChart buckets={data.buckets} />
          </div>

          {/* ── Desglose del período actual ── */}
          <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink mb-1">Desglose del período actual ({actual.label})</h3>
            <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
              De cada 100 pesos de ingreso en este período, cuánto se fue en cada costo y cuánto quedó de
              utilidad neta.
            </p>
            <DesgloseBar bucket={actual} />
          </div>

          {/* ── Tabla ── */}
          <div>
            <h3 className="text-sm font-bold text-ink mb-2">Detalle por período</h3>
            <TablaPeriodos buckets={data.buckets} />
          </div>
        </>
      )}
    </div>
  );
}
