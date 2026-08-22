import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { useDolarHora, type DolarPunto } from "../hooks/useDolarHora";

function fmtCop(n: number, digits = 2): string {
  return n.toLocaleString("es-CO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtFechaCorta(t: string): string {
  // t = "YYYY-MM-DD"
  const [, m, d] = t.split("-");
  return `${d}/${m}`;
}

type Periodo = "semana" | "mes";

/** Gráfico propio (sin TradingView): línea simple de la TRM BanRep diaria, con
 * selector Semana/Mes — mismo estilo de gráfico SVG que el resto del panel
 * (ver TendenciaChart en SaludNegocioPanel.tsx): sin librerías externas. */
function DolarLineChart({ serie, height = 160 }: { serie: DolarPunto[]; height?: number }) {
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const puntos = useMemo(() => {
    const dias = periodo === "semana" ? 7 : 30;
    return serie.slice(-dias);
  }, [serie, periodo]);

  const W = 480;
  const H = height;
  const padL = 44;
  const padR = 10;
  const padT = 14;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const valores = puntos.map((p) => p.v);
  const minV = puntos.length ? Math.min(...valores) : 0;
  const maxV = puntos.length ? Math.max(...valores) : 1;
  const rango = Math.max(1, maxV - minV);
  // Margen del 8% arriba/abajo para que la línea no toque los bordes
  const yMin = minV - rango * 0.08;
  const yMax = maxV + rango * 0.08;

  function x(i: number): number {
    return puntos.length > 1 ? padL + (plotW * i) / (puntos.length - 1) : padL + plotW / 2;
  }
  function y(v: number): number {
    return padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  }

  const tickCount = 3;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
          TRM BanRep · últimos {puntos.length} días
        </p>
        <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-surface-hover p-0.5">
          {(["semana", "mes"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriodo(p)}
              className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
                periodo === p ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {p === "semana" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
      </div>

      {puntos.length < 2 ? (
        <p className="py-6 text-center text-xs text-muted">Sin suficientes datos históricos todavía.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="TRM BanRep histórica">
          {Array.from({ length: tickCount + 1 }, (_, i) => {
            const v = yMin + ((yMax - yMin) / tickCount) * i;
            const yy = y(v);
            return (
              <g key={i}>
                <line x1={padL} x2={W - padR} y1={yy} y2={yy} className="stroke-border" strokeWidth={1} />
                <text x={0} y={yy + 3} className="fill-muted" fontSize={9}>
                  {fmtCop(v, 0)}
                </text>
              </g>
            );
          })}

          <polyline
            points={puntos.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {puntos.map((p, i) => {
            const isLast = i === puntos.length - 1;
            const isFirst = i === 0;
            if (!isLast && !isFirst && puntos.length > 10) return null;
            return (
              <g key={p.t}>
                <circle cx={x(i)} cy={y(p.v)} r={isLast ? 3.5 : 2.5} className="fill-accent stroke-surface-panel" strokeWidth={1.5}>
                  <title>{`${fmtFechaCorta(p.t)}: $${fmtCop(p.v)}`}</title>
                </circle>
                <text x={x(i)} y={H - padB + 12} textAnchor={isFirst ? "start" : isLast ? "end" : "middle"} className="fill-muted" fontSize={8}>
                  {fmtFechaCorta(p.t)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export default function DolarHoraGadget() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDolarHora();
  const [ampliado, setAmpliado] = useState(false);

  useEffect(() => {
    if (!ampliado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAmpliado(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ampliado]);

  const up = (data?.cambio_pct ?? 0) >= 0;
  const serie = data?.serie_dia ?? [];

  return (
    <>
      <div className="mck-card flex w-full flex-col overflow-hidden">
        <div className="mck-card-interactive mck-press flex w-full items-center gap-3 px-3 py-3 text-left hover:border-accent/50">
          <button
            type="button"
            onClick={() => setAmpliado(true)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            title="Clic para ampliar el gráfico"
            aria-expanded={ampliado}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Icon name="chartBar" size={20} weight="duotone" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Dólar hoy · COP</p>
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
                {data?.fuente_label ?? "TRM BanRep"} · clic para ampliar
              </p>
            </div>
            <Icon name="expand" size={16} className="shrink-0 text-muted" />
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink"
            title="Actualizar TRM"
          >
            {isFetching ? "…" : "↻"}
          </button>
        </div>
      </div>

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
              className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-paper-lg border-2 border-border bg-surface-panel shadow-paper-lg"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <div>
                  <p className="text-[12px] font-extrabold uppercase tracking-wide text-ink">
                    Dólar USD / COP
                  </p>
                  {data && (
                    <p className="text-[11px] text-muted">
                      TRM BanRep ${fmtCop(data.valor)}
                      {data.trm_fecha ? ` · ${data.trm_fecha}` : ""}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAmpliado(false)}
                  className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {serie.length >= 2 ? (
                  <DolarLineChart serie={serie} height={280} />
                ) : (
                  <p className="py-10 text-center text-sm text-muted">Sin suficientes datos históricos todavía.</p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
