import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { useDolarHora } from "../hooks/useDolarHora";

const TV_SYMBOL = "FX_IDC:USDCOP";
const TV_SYMBOL_FALLBACK = "FX:USDCOP";

function fmtCop(n: number, digits = 2): string {
  return n.toLocaleString("es-CO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function panelIsDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function TradingViewEmbed({
  kind,
  height,
  symbol = TV_SYMBOL,
}: {
  kind: "mini" | "advanced";
  height: number;
  symbol?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const [theme, setTheme] = useState<"light" | "dark">(() => (panelIsDark() ? "dark" : "light"));

  useEffect(() => {
    const sync = () => setTheme(panelIsDark() ? "dark" : "light");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    host.appendChild(widget);

    const script = document.createElement("script");
    script.async = true;
    script.type = "text/javascript";

    if (kind === "mini") {
      script.src =
        "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
      script.textContent = JSON.stringify({
        symbol,
        width: "100%",
        height,
        locale: "es",
        dateRange: "1D",
        colorTheme: theme,
        isTransparent: true,
        autosize: false,
        largeChartUrl: "",
      });
    } else {
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.textContent = JSON.stringify({
        autosize: true,
        symbol,
        interval: "60",
        timezone: "America/Bogota",
        theme,
        style: "1",
        locale: "es",
        allow_symbol_change: false,
        calendar: false,
        support_host: "https://www.tradingview.com",
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
      });
    }
    host.appendChild(script);

    return () => {
      host.innerHTML = "";
    };
  }, [kind, height, symbol, theme, uid]);

  return (
    <div
      ref={hostRef}
      className="tradingview-widget-container h-full w-full overflow-hidden"
      data-tv-id={uid}
      style={{ height }}
    />
  );
}

export default function DolarHoraGadget() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDolarHora();
  const [ampliado, setAmpliado] = useState(false);
  const [tvSymbol, setTvSymbol] = useState(TV_SYMBOL);

  useEffect(() => {
    if (!ampliado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAmpliado(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ampliado]);

  const up = (data?.cambio_pct ?? 0) >= 0;

  return (
    <>
      <div className="mck-card flex w-full flex-col overflow-hidden">
        <div className="mck-card-interactive mck-press flex w-full items-center gap-3 px-3 py-3 text-left hover:border-accent/50">
          <button
            type="button"
            onClick={() => setAmpliado(true)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            title="Clic para ampliar el gráfico TradingView"
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
        <div className="border-t border-border px-1 pb-1 pt-0.5" aria-hidden={isError || isLoading}>
          <TradingViewEmbed kind="mini" height={120} symbol={tvSymbol} />
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
              aria-label="Gráfico dólar USD/COP TradingView"
              className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-paper-lg border-2 border-border bg-surface-panel shadow-paper-lg"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <div>
                  <p className="text-[12px] font-extrabold uppercase tracking-wide text-ink">
                    Dólar USD / COP
                  </p>
                  {data && (
                    <p className="text-[11px] text-muted">
                      TRM BanRep ${fmtCop(data.valor)}
                      {data.trm_fecha ? ` · ${data.trm_fecha}` : ""} · gráfico TradingView (hora)
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {tvSymbol !== TV_SYMBOL_FALLBACK && (
                    <button
                      type="button"
                      onClick={() => setTvSymbol(TV_SYMBOL_FALLBACK)}
                      className="rounded-lg px-2 py-0.5 text-[10px] font-semibold text-muted hover:bg-surface-hover hover:text-ink"
                      title="Probar símbolo FX:USDCOP"
                    >
                      Alt. FX
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setAmpliado(false)}
                    className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
                    aria-label="Cerrar"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="min-h-[420px] flex-1 p-2 sm:min-h-[520px]">
                <TradingViewEmbed kind="advanced" height={520} symbol={tvSymbol} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
