import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { useDolarHora, type DolarPunto } from "../hooks/useDolarHora";

function fmtCop(n: number, digits = 2): string {
  return n.toLocaleString("es-CO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

function fmtFechaCorta(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

function Sparkline({
  puntos,
  up,
  w = 88,
  h = 28,
}: {
  puntos: DolarPunto[];
  up: boolean;
  w?: number;
  h?: number;
}) {
  const path = useMemo(() => {
    if (puntos.length < 2) return "";
    const vals = puntos.map((p) => p.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const rango = max - min || 1;
    const pad = 1;
    return puntos
      .map((p, i) => {
        const x = pad + ((w - pad * 2) * i) / (puntos.length - 1);
        const y = pad + (h - pad * 2) * (1 - (p.v - min) / rango);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [puntos, w, h]);

  if (!path) return null;
  const stroke = up ? "rgb(var(--mck-success))" : "rgb(var(--mck-danger))";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function AreaChart({
  puntos,
  modo,
  up,
}: {
  puntos: DolarPunto[];
  modo: "hora" | "dia";
  up: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const W = 720;
  const H = 280;
  const padL = 52;
  const padR = 16;
  const padT = 18;
  const padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const layout = useMemo(() => {
    if (puntos.length === 0) return null;
    const vals = puntos.map((p) => p.v);
    const minRaw = Math.min(...vals);
    const maxRaw = Math.max(...vals);
    const pad = (maxRaw - minRaw) * 0.08 || maxRaw * 0.004 || 1;
    const min = minRaw - pad;
    const max = maxRaw + pad;
    const rango = max - min || 1;
    const x = (i: number) =>
      puntos.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (puntos.length - 1);
    const y = (v: number) => padT + plotH - ((v - min) / rango) * plotH;
    const line = puntos.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    const area = `${padL},${padT + plotH} ${line} ${padL + plotW},${padT + plotH}`;
    const ticks = 4;
    const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + (rango * i) / ticks);
    const xLabels: { i: number; label: string }[] = [];
    const step = Math.max(1, Math.floor((puntos.length - 1) / 5));
    for (let i = 0; i < puntos.length; i += step) {
      xLabels.push({
        i,
        label: modo === "hora" ? fmtHora(puntos[i].t) : fmtFechaCorta(puntos[i].t),
      });
    }
    const last = puntos.length - 1;
    if (xLabels[xLabels.length - 1]?.i !== last) {
      xLabels.push({
        i: last,
        label: modo === "hora" ? fmtHora(puntos[last].t) : fmtFechaCorta(puntos[last].t),
      });
    }
    return { min, max, x, y, line, area, yTicks, xLabels };
  }, [puntos, modo, padL, padR, padT, padB, plotW, plotH]);

  if (!layout) {
    return <p className="py-10 text-center text-sm text-muted">Sin datos para graficar.</p>;
  }

  const stroke = up ? "rgb(var(--mck-success))" : "rgb(var(--mck-danger))";
  const hi = hover != null ? puntos[hover] : null;

  return (
    <div
      className="relative"
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={modo === "hora" ? "Precio USD/COP por hora" : "TRM diaria USD/COP"}
      >
        <defs>
          <linearGradient id={`dolar-fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {layout.yTicks.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={layout.y(v)}
              y2={layout.y(v)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text x={4} y={layout.y(v) - 3} className="fill-muted" fontSize={9}>
              {fmtCop(v, 0)}
            </text>
          </g>
        ))}
        <polygon points={layout.area} fill={`url(#dolar-fill-${gid})`} />
        <polyline
          points={layout.line}
          fill="none"
          stroke={stroke}
          strokeWidth={2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {layout.xLabels.map((l) => (
          <text
            key={`${l.i}-${l.label}`}
            x={layout.x(l.i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted"
            fontSize={9}
          >
            {l.label}
          </text>
        ))}
        {hi && hover != null && (
          <>
            <line
              x1={layout.x(hover)}
              x2={layout.x(hover)}
              y1={padT}
              y2={padT + plotH}
              stroke={stroke}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <circle cx={layout.x(hover)} cy={layout.y(hi.v)} r={4.5} fill={stroke} className="stroke-surface-panel" strokeWidth={2} />
          </>
        )}
        {puntos.map((_, i) => (
          <rect
            key={i}
            x={i === 0 ? padL : (layout.x(i) + layout.x(i - 1)) / 2}
            y={padT}
            width={
              i === 0
                ? Math.max(8, (layout.x(1) - layout.x(0)) / 2)
                : i === puntos.length - 1
                  ? Math.max(8, (layout.x(i) - layout.x(i - 1)) / 2 + padR)
                  : Math.max(8, (layout.x(i + 1) - layout.x(i - 1)) / 2)
            }
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hi && (
        <div className="pointer-events-none absolute right-2 top-1 rounded-lg border border-border bg-surface-panel/95 px-2.5 py-1.5 text-[11px] shadow-paper-sm">
          <p className="font-semibold text-ink">${fmtCop(hi.v)}</p>
          <p className="text-muted">{modo === "hora" ? `${fmtFechaCorta(hi.t)} ${fmtHora(hi.t)}` : fmtFechaCorta(hi.t)}</p>
        </div>
      )}
    </div>
  );
}

export default function DolarHoraGadget() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDolarHora();
  const [ampliado, setAmpliado] = useState(false);
  const [modo, setModo] = useState<"hora" | "dia">("hora");

  useEffect(() => {
    if (!ampliado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAmpliado(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ampliado]);

  const up = (data?.cambio_pct ?? 0) >= 0;
  const serieHora = data?.serie_hora ?? [];
  const serieDia = data?.serie_dia ?? [];
  const serieGrafico = modo === "hora" && serieHora.length >= 2 ? serieHora : serieDia;
  const modoEfectivo: "hora" | "dia" = modo === "hora" && serieHora.length >= 2 ? "hora" : "dia";

  const chart = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">USD → COP</p>
          <p className={`text-3xl font-black tabular-nums tracking-tight ${up ? "text-success" : "text-danger"}`}>
            ${data ? fmtCop(data.valor) : "—"}
          </p>
          {data && (
            <p className={`text-sm font-semibold ${up ? "text-success" : "text-danger"}`}>
              {up ? "▲" : "▼"} {up ? "+" : ""}
              {fmtCop(data.cambio_abs)} ({up ? "+" : ""}
              {data.cambio_pct.toLocaleString("es-CO", { maximumFractionDigits: 2 })}%)
            </p>
          )}
        </div>
        <div className="text-right text-[11px] text-muted">
          <p>{data?.fuente_label ?? "Dólar"}</p>
          {data?.trm_oficial != null && (
            <p>
              TRM oficial ${fmtCop(data.trm_oficial)}
              {data.trm_fecha ? ` · ${data.trm_fecha}` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setModo("hora")}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
            modo === "hora" ? "bg-accent text-white" : "bg-surface-hover text-ink"
          }`}
        >
          Hora
        </button>
        <button
          type="button"
          onClick={() => setModo("dia")}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
            modo === "dia" ? "bg-accent text-white" : "bg-surface-hover text-ink"
          }`}
        >
          Día
        </button>
        <button
          type="button"
          onClick={() => void refetch()}
          className="ml-auto rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink"
          title="Actualizar"
        >
          {isFetching ? "…" : "↻"}
        </button>
      </div>
      <AreaChart puntos={serieGrafico} modo={modoEfectivo} up={up} />
      {modo === "hora" && serieHora.length < 2 && (
        <p className="text-[11px] text-muted">Sin serie horaria ahora; se muestra la TRM diaria BanRep.</p>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setAmpliado(true)}
        className="mck-card mck-card-interactive mck-press flex w-full items-center gap-3 px-3 py-3 text-left hover:border-accent/50"
        title="Clic para ampliar el gráfico"
        aria-expanded={ampliado}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon name="chartBar" size={20} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Dólar hora · COP</p>
          {isLoading ? (
            <p className="text-lg font-extrabold text-muted">Cargando…</p>
          ) : isError ? (
            <p className="truncate text-sm font-semibold text-danger">
              {error instanceof Error ? error.message : "No se pudo cargar"}
            </p>
          ) : (
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-black tabular-nums tracking-tight text-ink">
                ${data ? fmtCop(data.valor) : "—"}
              </p>
              {data && (
                <span className={`text-xs font-bold ${up ? "text-success" : "text-danger"}`}>
                  {up ? "▲" : "▼"} {up ? "+" : ""}
                  {data.cambio_pct.toLocaleString("es-CO", { maximumFractionDigits: 2 })}%
                </span>
              )}
            </div>
          )}
          <p className="text-[10px] text-muted">
            {data?.fuente_label ?? "USD/COP"} · clic para ampliar
          </p>
        </div>
        {serieHora.length >= 2 ? (
          <Sparkline puntos={serieHora.slice(-24)} up={up} />
        ) : serieDia.length >= 2 ? (
          <Sparkline puntos={serieDia.slice(-14)} up={up} />
        ) : (
          <Icon name="expand" size={16} className="shrink-0 text-muted" />
        )}
      </button>

      {ampliado &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[920] flex items-center justify-center p-3 sm:p-6">
            <button
              type="button"
              className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
              aria-label="Cerrar gráfico"
              onClick={() => setAmpliado(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Gráfico dólar USD/COP"
              className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-paper-lg border-2 border-border bg-surface-panel shadow-paper-lg"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <p className="text-[12px] font-extrabold uppercase tracking-wide text-ink">Dólar USD / COP</p>
                <button
                  type="button"
                  onClick={() => setAmpliado(false)}
                  className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">{chart}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
