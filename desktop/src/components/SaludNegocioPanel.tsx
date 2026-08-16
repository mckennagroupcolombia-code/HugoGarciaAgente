import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createChart, CrosshairMode, type IChartApi, type UTCTimestamp } from "lightweight-charts";
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

// ── Indicadores técnicos (EMA / MACD / Squeeze) sobre el margen % ───────────
// Mismo tratamiento que un gráfico de trading (línea de precio = margen neto
// %), para leer tendencia/rango de un vistazo. Necesitan bastantes puntos
// para "calentar" — con pocos períodos (semanal/mensual) puede no haber
// suficientes datos para la EMA larga; en ese caso simplemente no se dibuja
// esa línea.

/** EMA de `periodo` sobre `valores`. Semilla = SMA de los primeros `periodo` puntos. */
function calcularEMA(valores: number[], periodo: number): (number | null)[] {
  const out: (number | null)[] = new Array(valores.length).fill(null);
  if (valores.length < periodo) return out;
  const k = 2 / (periodo + 1);
  let sma = 0;
  for (let i = 0; i < periodo; i++) sma += valores[i];
  sma /= periodo;
  out[periodo - 1] = sma;
  let prev = sma;
  for (let i = periodo; i < valores.length; i++) {
    prev = valores[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** MACD estándar (12/26/9) sobre `valores`. */
function calcularMACD(valores: number[], rapida = 12, lenta = 26, señal = 9) {
  const emaRapida = calcularEMA(valores, rapida);
  const emaLenta = calcularEMA(valores, lenta);
  const macdLine: (number | null)[] = valores.map((_, i) =>
    emaRapida[i] != null && emaLenta[i] != null ? (emaRapida[i] as number) - (emaLenta[i] as number) : null,
  );
  const compactos: number[] = [];
  const indices: number[] = [];
  macdLine.forEach((v, i) => {
    if (v != null) {
      compactos.push(v);
      indices.push(i);
    }
  });
  const señalCompacta = calcularEMA(compactos, señal);
  const signalLine: (number | null)[] = new Array(valores.length).fill(null);
  señalCompacta.forEach((v, idx) => {
    if (v != null) signalLine[indices[idx]] = v;
  });
  const histograma: (number | null)[] = valores.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? (macdLine[i] as number) - (signalLine[i] as number) : null,
  );
  return { macdLine, signalLine, histograma };
}

type Regimen = "alcista" | "bajista" | "lateral" | "sin_datos";

const REGIMEN_INFO: Record<Regimen, { label: string; className: string }> = {
  alcista: { label: "Tendencia alcista", className: "bg-success/15 text-success" },
  bajista: { label: "Tendencia bajista", className: "bg-danger/15 text-danger" },
  lateral: { label: "Lateral / rango", className: "bg-warning/15 text-warning" },
  sin_datos: { label: "Sin datos suficientes (min. 55 períodos)", className: "bg-muted/20 text-muted" },
};

/** EMA rápida vs. lenta + pendiente reciente de la rápida — mismo criterio que un cruce de medias. */
function detectarRegimen(ema10: (number | null)[], ema55: (number | null)[]): Regimen {
  const n = ema10.length;
  const actual10 = ema10[n - 1];
  const actual55 = ema55[n - 1];
  if (actual10 == null || actual55 == null) return "sin_datos";
  const previo10 = ema10[Math.max(0, n - 6)];
  const pendiente = previo10 != null ? actual10 - previo10 : 0;
  const brecha = actual10 - actual55;
  const UMBRAL_BRECHA_PP = 1.5;
  if (brecha > UMBRAL_BRECHA_PP && pendiente > 0) return "alcista";
  if (brecha < -UMBRAL_BRECHA_PP && pendiente < 0) return "bajista";
  return "lateral";
}

// ── Squeeze Momentum (John Carter / LazyBear) sobre el margen % ────────────
// Bandas de Bollinger (SMA ± 2 desv. estándar) vs. Canal de Keltner
// (SMA ± 1.5 rango medio) — "squeeze" = Bollinger adentro de Keltner
// (volatilidad comprimida, "coiling"), rotura = Bollinger sale de Keltner.
// No tenemos máximo/mínimo intra-período (solo el margen % agregado del
// bucket), así que el "rango verdadero" se aproxima con la variación
// absoluta entre períodos consecutivos — desviación estándar, no ATR real.
// El histograma de momentum también se simplifica: valor directo (cierre −
// promedio de máximo/mínimo/SMA del período), sin el suavizado por regresión
// lineal del indicador original — buscamos la misma lectura de "¿se está
// comprimiendo o expandiendo la volatilidad del margen?", no una réplica
// exacta de TradingView.

function sma(valores: number[], periodo: number): (number | null)[] {
  return valores.map((_, i) => {
    if (i < periodo - 1) return null;
    let s = 0;
    for (let j = i - periodo + 1; j <= i; j++) s += valores[j];
    return s / periodo;
  });
}

function rollingStdDev(valores: number[], periodo: number, medias: (number | null)[]): (number | null)[] {
  return valores.map((_, i) => {
    const m = medias[i];
    if (i < periodo - 1 || m == null) return null;
    let s = 0;
    for (let j = i - periodo + 1; j <= i; j++) s += (valores[j] - m) ** 2;
    return Math.sqrt(s / periodo);
  });
}

function rollingMax(valores: number[], periodo: number): (number | null)[] {
  return valores.map((_, i) => (i < periodo - 1 ? null : Math.max(...valores.slice(i - periodo + 1, i + 1))));
}

function rollingMin(valores: number[], periodo: number): (number | null)[] {
  return valores.map((_, i) => (i < periodo - 1 ? null : Math.min(...valores.slice(i - periodo + 1, i + 1))));
}

interface SqueezeMomentum {
  momentum: (number | null)[];
  squeezeOn: (boolean | null)[];
}

function calcularSqueezeMomentum(valores: number[], periodo = 20, multBB = 2, multKC = 1.5): SqueezeMomentum {
  const mediaSma = sma(valores, periodo);
  const desv = rollingStdDev(valores, periodo, mediaSma);
  const cambios = valores.map((v, i) => (i === 0 ? 0 : Math.abs(v - valores[i - 1])));
  const rangoMedio = sma(cambios, periodo);
  const maxN = rollingMax(valores, periodo);
  const minN = rollingMin(valores, periodo);

  const momentum: (number | null)[] = valores.map((v, i) => {
    const m = mediaSma[i];
    const hi = maxN[i];
    const lo = minN[i];
    if (m == null || hi == null || lo == null) return null;
    const promedioHL = (hi + lo) / 2;
    const base = (promedioHL + m) / 2;
    return v - base;
  });

  const squeezeOn: (boolean | null)[] = valores.map((_, i) => {
    const m = mediaSma[i];
    const d = desv[i];
    const r = rangoMedio[i];
    if (m == null || d == null || r == null) return null;
    const upperBB = m + multBB * d;
    const lowerBB = m - multBB * d;
    const upperKC = m + multKC * r;
    const lowerKC = m - multKC * r;
    return lowerBB > lowerKC && upperBB < upperKC;
  });

  return { momentum, squeezeOn };
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

// ── Gráfico técnico: margen % (línea "precio") + EMA10/EMA55, volumen ──────
// (unidades vendidas) y MACD — mismo lenguaje visual que un gráfico de
// trading, aplicado al margen neto en vez de al precio de un activo. Los
// 3 paneles comparten el mismo eje X (misma función `cx`) para que quede
// todo alineado verticalmente, como en cualquier plataforma de velas.

// Paleta fija estilo TradingView (no sigue el tema claro/oscuro de McKenna a
// propósito — el objetivo es que se vea igual al bot de trading de
// referencia, no que se adapte al resto del panel).
const TV = {
  bg: "#131722",
  text: "#787b86",
  grid: "#1e222d",
  border: "#2a2e39",
  up: "#26a69a",
  down: "#ef5350",
  ema10: "#2196f3",
  ema55: "#ffca28",
  sqzBrightPos: "#26a69a",
  sqzDarkPos: "#1b5e20",
  sqzBrightNeg: "#ef5350",
  sqzDarkNeg: "#880e4f",
  sqzNeutral: "#787b86",
};

// Altura de cada panel en px — generosa a propósito: con paneles chicos las
// velas y los indicadores se ven aplastados e ilegibles. El ancho sí es 100%
// responsive (ver ResizeObserver más abajo); el alto queda fijo porque
// lightweight-charts necesita un valor concreto, no puede ser "auto".
const PANEL_H = { main: 340, vol: 100, sqz: 130, macd: 140 };

function toUnixTime(fechaISO: string): UTCTimestamp {
  return Math.floor(new Date(`${fechaISO}T00:00:00Z`).getTime() / 1000) as UTCTimestamp;
}

function sqzColor(hist: number | null, slope: number | null): string {
  if (hist == null || slope == null) return TV.sqzNeutral;
  if (hist > 0 && slope > 0) return TV.sqzBrightPos;
  if (hist > 0 && slope < 0) return TV.sqzDarkPos;
  if (hist < 0 && slope < 0) return TV.sqzBrightNeg;
  if (hist < 0 && slope > 0) return TV.sqzDarkNeg;
  return TV.sqzNeutral;
}

/** Mismos cortes que colorNota (85/70/50) en hex, para el borde de la última vela. */
function notaHex(score: number): string {
  if (score >= 85) return "#34d399";
  if (score >= 70) return "#38bdf8";
  if (score >= 50) return "#fbbf24";
  return "#f87171";
}

interface ChartRefs {
  main: IChartApi | null;
  vol: IChartApi | null;
  sqz: IChartApi | null;
  macd: IChartApi | null;
}

// ── Gráfico técnico estilo TradingView (lightweight-charts, la misma
// librería que usa nuestro bot de trading de referencia) — velas japonesas
// de margen % + EMA 10/55, volumen, Squeeze Momentum y MACD en paneles
// sincronizados. Vela = open (cierre del período anterior) → close (margen
// de este período); no hay máximo/mínimo intra-período real (el margen es
// un agregado, no un precio cotizado tick a tick), así que no se inventan
// mechas — cuerpo puro. Convención clásica: llena/roja = baja, hueca/verde =
// sube (igual que el bot, no la convención japonesa histórica negro/blanco).

function AnalisisTecnicoChart({ buckets }: { buckets: SaludBucket[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const sqzRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<ChartRefs>({ main: null, vol: null, sqz: null, macd: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<Record<string, any>>({});

  const valores = buckets.map((b) => b.margen_pct);
  const ema10 = calcularEMA(valores, 10);
  const ema55 = calcularEMA(valores, 55);
  const { macdLine, signalLine, histograma } = calcularMACD(valores);
  const { momentum } = calcularSqueezeMomentum(valores);
  const regimen = detectarRegimen(ema10, ema55);
  const hayEma55 = ema55.some((v) => v != null);
  const hayMacd = macdLine.some((v) => v != null);
  const haySqueeze = momentum.some((v) => v != null);

  // Crea las 4 instancias de chart UNA vez por montaje (no en cada refresh de
  // datos) — recrearlas perdería el zoom/pan del usuario en cada polling.
  useEffect(() => {
    if (!mainRef.current || !volRef.current || !sqzRef.current || !macdRef.current) return;

    const common = {
      layout: { background: { color: TV.bg }, textColor: TV.text, fontSize: 11 },
      grid: { vertLines: { color: TV.grid }, horzLines: { color: TV.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: TV.border, timeVisible: false, secondsVisible: false, rightBarStaysOnScroll: false },
      rightPriceScale: { borderColor: TV.border },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    };

    const mainChart = createChart(mainRef.current, { ...common, width: mainRef.current.clientWidth, height: PANEL_H.main });
    const volChart = createChart(volRef.current, { ...common, width: volRef.current.clientWidth, height: PANEL_H.vol });
    const sqzChart = createChart(sqzRef.current, { ...common, width: sqzRef.current.clientWidth, height: PANEL_H.sqz });
    const macdChart = createChart(macdRef.current, { ...common, width: macdRef.current.clientWidth, height: PANEL_H.macd });
    chartsRef.current = { main: mainChart, vol: volChart, sqz: sqzChart, macd: macdChart };

    const candleSeries = mainChart.addCandlestickSeries({
      upColor: TV.up, downColor: TV.down, borderUpColor: TV.up, borderDownColor: TV.down,
      wickUpColor: TV.up, wickDownColor: TV.down,
    });
    const ema10Series = mainChart.addLineSeries({ color: TV.ema10, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const ema55Series = mainChart.addLineSeries({ color: TV.ema55, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    const volSeries = volChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    const sqzSeries = sqzChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    const macdHistSeries = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    const macdLineSeries = macdChart.addLineSeries({ color: TV.ema10, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const macdSignalSeries = macdChart.addLineSeries({ color: TV.ema55, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    seriesRef.current = { candleSeries, ema10Series, ema55Series, volSeries, sqzSeries, macdHistSeries, macdLineSeries, macdSignalSeries };

    // Sincroniza el paneo/zoom entre los 4 paneles (mismo patrón que el bot).
    const charts = [mainChart, volChart, sqzChart, macdChart];
    let syncing = false;
    const handlers = charts.map((c) => {
      const handler = (range: { from: number; to: number } | null) => {
        if (syncing || !range) return;
        syncing = true;
        charts.forEach((other) => {
          if (other !== c) {
            try {
              other.timeScale().setVisibleLogicalRange(range);
            } catch {
              /* ignore */
            }
          }
        });
        syncing = false;
      };
      c.timeScale().subscribeVisibleLogicalRangeChange(handler);
      return { chart: c, handler };
    });

    // ResizeObserver en vez de (o además de) window.resize: el ancho del
    // panel cambia por cosas que NO disparan un resize de ventana —
    // colapsar el sidebar, cambiar de pestaña, el propio layout flex del
    // panel — y sin esto los charts se quedaban con el ancho de cuando se
    // montaron, se veían "aplastados" o cortados hasta refrescar la página.
    const aplicarAncho = () => {
      if (mainRef.current) mainChart.applyOptions({ width: mainRef.current.clientWidth });
      if (volRef.current) volChart.applyOptions({ width: volRef.current.clientWidth });
      if (sqzRef.current) sqzChart.applyOptions({ width: sqzRef.current.clientWidth });
      if (macdRef.current) macdChart.applyOptions({ width: macdRef.current.clientWidth });
    };
    window.addEventListener("resize", aplicarAncho);
    const observer = new ResizeObserver(() => aplicarAncho());
    if (wrapRef.current) observer.observe(wrapRef.current);

    return () => {
      window.removeEventListener("resize", aplicarAncho);
      observer.disconnect();
      handlers.forEach(({ chart, handler }) => {
        try {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
        } catch {
          /* ignore */
        }
      });
      charts.forEach((c) => {
        try {
          c.remove();
        } catch {
          /* ignore */
        }
      });
      chartsRef.current = { main: null, vol: null, sqz: null, macd: null };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carga/actualiza los datos sin recrear los charts.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candleSeries || buckets.length === 0) return;

    const times = buckets.map((b) => toUnixTime(b.inicio));
    const opens = valores.map((c, i) => (i === 0 ? c : valores[i - 1]));

    s.candleSeries.setData(
      buckets.map((_b, i) => {
        const isLast = i === buckets.length - 1;
        const base: Record<string, unknown> = {
          time: times[i],
          open: opens[i],
          high: Math.max(opens[i], valores[i]),
          low: Math.min(opens[i], valores[i]),
          close: valores[i],
        };
        if (isLast) {
          const color = notaHex(buckets[i].score);
          base.borderColor = color;
          base.wickColor = color;
        }
        return base;
      }),
    );
    s.ema10Series.setData(
      ema10.map((v, i) => (v == null ? null : { time: times[i], value: v })).filter((v): v is { time: UTCTimestamp; value: number } => v != null),
    );
    s.ema55Series.setData(
      ema55.map((v, i) => (v == null ? null : { time: times[i], value: v })).filter((v): v is { time: UTCTimestamp; value: number } => v != null),
    );

    s.volSeries.setData(
      buckets.map((b, i) => ({
        time: times[i],
        value: b.unidades_vendidas,
        color: i === 0 || valores[i] >= valores[i - 1] ? `${TV.up}99` : `${TV.down}99`,
      })),
    );

    if (haySqueeze) {
      s.sqzSeries.setData(
        momentum
          .map((v, i) => {
            if (v == null) return null;
            const anterior = i > 0 ? momentum[i - 1] : null;
            const slope = anterior != null ? v - anterior : null;
            return { time: times[i], value: v, color: sqzColor(v, slope) };
          })
          .filter((v): v is { time: UTCTimestamp; value: number; color: string } => v != null),
      );
    }

    if (hayMacd) {
      s.macdHistSeries.setData(
        histograma
          .map((v, i) => (v == null ? null : { time: times[i], value: v, color: v >= 0 ? TV.up : TV.down }))
          .filter((v): v is { time: UTCTimestamp; value: number; color: string } => v != null),
      );
      s.macdLineSeries.setData(
        macdLine.map((v, i) => (v == null ? null : { time: times[i], value: v })).filter((v): v is { time: UTCTimestamp; value: number } => v != null),
      );
      s.macdSignalSeries.setData(
        signalLine.map((v, i) => (v == null ? null : { time: times[i], value: v })).filter((v): v is { time: UTCTimestamp; value: number } => v != null),
      );
    }

    const { main, vol, sqz, macd } = chartsRef.current;
    main?.timeScale().fitContent();
    vol?.timeScale().fitContent();
    sqz?.timeScale().fitContent();
    macd?.timeScale().fitContent();
  }, [buckets, valores, ema10, ema55, macdLine, signalLine, histograma, momentum, hayMacd, haySqueeze]);

  return (
    <div ref={wrapRef} style={{ background: TV.bg, borderRadius: 10, overflow: "hidden", border: `1px solid ${TV.border}`, width: "100%" }}>
      {/* leyenda + régimen */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2" style={{ background: "#1e222d", borderBottom: `1px solid ${TV.border}` }}>
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: TV.up }}>
          <span style={{ width: 10, height: 10, background: "transparent", border: `2px solid ${TV.up}`, display: "inline-block" }} />
          Sube
        </span>
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: TV.down }}>
          <span style={{ width: 10, height: 10, background: TV.down, display: "inline-block" }} />
          Baja
        </span>
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: TV.ema10 }}>
          <span style={{ width: 14, height: 2, background: TV.ema10, display: "inline-block" }} />
          EMA 10
        </span>
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: TV.ema55 }}>
          <span style={{ width: 14, height: 2, background: TV.ema55, display: "inline-block" }} />
          EMA 55{!hayEma55 && " (faltan períodos)"}
        </span>
        <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${REGIMEN_INFO[regimen].className}`}>
          {REGIMEN_INFO[regimen].label}
        </span>
      </div>

      <div ref={mainRef} style={{ height: PANEL_H.main, width: "100%" }} />
      <div className="px-3 py-1 text-[9px]" style={{ color: TV.text, background: TV.bg }}>
        Volumen (unidades vendidas)
      </div>
      <div ref={volRef} style={{ height: PANEL_H.vol, width: "100%" }} />

      <div className="px-3 py-1 text-[9px] flex items-center justify-between" style={{ color: TV.text, background: TV.bg }}>
        <span>Squeeze Momentum (Bollinger vs. Keltner sobre el margen %)</span>
        {!haySqueeze && <span className="italic">necesita ≥20 períodos — probá vista diaria</span>}
      </div>
      <div ref={sqzRef} style={{ height: PANEL_H.sqz, width: "100%" }} />

      <div className="px-3 py-1 text-[9px] flex items-center justify-between" style={{ color: TV.text, background: TV.bg }}>
        <span>MACD (12/26/9)</span>
        {!hayMacd && <span className="italic">necesita ≥26 períodos — probá vista diaria</span>}
      </div>
      <div ref={macdRef} style={{ height: PANEL_H.macd, width: "100%" }} />
    </div>
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

      {!bucket.ads_disponible && (
        <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning font-semibold">
          Gasto en ads no disponible para este período — MeLi solo retiene métricas de campaña de los
          últimos 90 días, ni siquiera desde el propio panel de Mercado Ads (confirmado ago-2026). No es un
          dato pendiente de conseguir: es irrecuperable. Si hubo pauta activa en esta fecha, la utilidad
          neta mostrada NO la descuenta y está sobreestimada.
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
  const [expandido, setExpandido] = useState<string | null>(null);

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
                    Últimas {opt} {periodicidad === "semana" ? "semanas" : "meses"}
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
                facturas Siigo que no calzan con el patrón de MeLi ni con la referencia web MCKG- —
                principalmente venta directa por WhatsApp, aproximada por descarte: {actual.otros_canales_facturas}{" "}
                factura{actual.otros_canales_facturas === 1 ? "" : "s"}
                {actual.otros_canales_con_marcador_wa > 0
                  ? `, ${actual.otros_canales_con_marcador_wa} marcada${actual.otros_canales_con_marcador_wa === 1 ? "" : "s"} explícitamente como WhatsApp`
                  : ""}
                . Puede incluir correcciones o ventas de mostrador ajenas a WhatsApp.
              </div>
            )}

            <Explicacion>
              El <strong className="text-ink">score</strong> pondera margen neto (60%), eficiencia de ads
              por ACOS de campaña (20%) y tendencia frente al período anterior (20%). Cortes:{" "}
              <strong className="text-emerald-400">≥85 excelente</strong>,{" "}
              <strong className="text-sky-400">≥70 bueno</strong>,{" "}
              <strong className="text-amber-400">≥50 regular</strong>,{" "}
              <strong className="text-red-400">&lt;50 riesgo</strong>. La comisión/envío de MeLi usa la
              tarifa <em>actual</em> aplicada a las unidades del período (MeLi no expone el cobro histórico
              real por orden); la nómina ({cop(data.nomina_mensual)}/mes,{" "}
              {data.fuente_nomina === "rrhh_compensaciones" ? "tomada de RRHH → Compensaciones" : data.fuente_nomina === "contabilidad_empleados" ? "tomada de Contabilidad → Operativos → Nómina" : "sin fuente"}
              ) se prorratea por días sobre ese total mensual (costo devengado, no pago real); los servicios
              fijos sí son pagos reales con fecha. No se descuenta comisión de pasarela de pago en ventas
              web — la utilidad web está levemente sobreestimada.{" "}
              <strong className="text-warning">
                MeLi solo retiene gasto en ads de los últimos 90 días — límite duro y permanente de la
                plataforma, confirmado también desde el propio panel de Mercado Ads (no es un dato pendiente
                de exportar). Para períodos más viejos (marcados con ⚠ / ?) esa columna no tiene ni tendrá
                dato real — no es que el gasto haya sido cero.
              </strong>
            </Explicacion>
          </div>

          {/* ── Tendencia ── */}
          {bucketsCerrados.length > 0 && (
            <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
              <h3 className="text-sm font-bold text-ink mb-1">Ingresos vs. costos por período</h3>
              <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
                Barras: de qué se compone el costo total de cada período. Línea: ingresos totales (MeLi + web)
                del mismo período — misma unidad (COP), un solo eje. No incluye el período en curso ({actual.label}),
                que todavía no cerró.
                {bucketsOcultos > 0 &&
                  ` Se ocultan además ${bucketsOcultos} período${bucketsOcultos === 1 ? "" : "s"} sin dato de ads para no mezclar "sin datos" con "$0 real".`}
              </p>
              <TendenciaChart buckets={bucketsCerrados} />
            </div>
          )}

          {/* ── Margen + análisis técnico ── */}
          {bucketsCerrados.length > 0 ? (
            <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
              <h3 className="text-sm font-bold text-ink mb-1">Margen neto — análisis técnico</h3>
              <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
                Margen neto tratado como "precio", en velas (llena/roja = bajó, hueca/verde = subió; sin
                mechas — el margen es un agregado del período, no hay máximo/mínimo intra-período real) +
                EMA 10 (azul) y EMA 55 (amarilla), volumen (unidades vendidas), Squeeze Momentum y MACD.{" "}
                <strong className="text-ink">No incluye el período en curso ({actual.label})</strong> — se
                agrega recién cuando cierre, para no mostrar una vela gigante armada con solo unas horas de
                venta contra un día completo de costos fijos. En vista diaria hay más puntos y los
                indicadores largos se ven mejor; en semanal/mensual puede faltar historial para la EMA 55,
                el Squeeze o el MACD (necesitan 55/20/26 períodos).
              </p>
              <AnalisisTecnicoChart buckets={bucketsCerrados} />
            </div>
          ) : (
            <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
              <h3 className="text-sm font-bold text-ink mb-1">Margen neto — análisis técnico</h3>
              <p className="text-xs text-ink-secondary">
                Todavía no hay ningún período cerrado en este rango para graficar — el único disponible
                ({actual.label}) sigue en curso. Esperá a que cierre o elegí un rango más amplio.
              </p>
            </div>
          )}

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
            <TablaPeriodos buckets={data.buckets} actual={actual} />
          </div>
        </>
      )}
    </div>
  );
}
