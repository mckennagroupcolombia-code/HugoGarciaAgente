import { useState } from "react";
import {
  useTelemetriaResumen,
  useTelemetriaErrores,
  type TelemetriaError,
} from "../hooks/useTelemetria";

const SERVICIO_LABEL: Record<string, string> = {
  "webhook-meli": "Webhook MeLi (:8080)",
  "agente-pro": "Agente Pro (:8081)",
  "whatsapp-bridge": "Puente WhatsApp (:3000)",
};

function fechaRelativa(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

function ServiciosEstado({ servicios }: { servicios: Record<string, boolean> }) {
  const entradas = Object.entries(servicios);
  if (!entradas.length) return <p className="text-sm text-muted">Sin datos de servicios.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {entradas.map(([nombre, ok]) => (
        <span
          key={nombre}
          className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border ${
            ok
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/30"
          }`}
        >
          {ok ? "●" : "○"} {SERVICIO_LABEL[nombre] ?? nombre}
        </span>
      ))}
    </div>
  );
}

function ContadoresEventos({
  contadores,
}: {
  contadores: Record<string, number> | undefined;
}) {
  const entradas = Object.entries(contadores ?? {}).sort((a, b) => b[1] - a[1]);
  if (!entradas.length) {
    return <p className="text-sm text-muted py-2">Sin eventos registrados hoy.</p>;
  }
  return (
    <div className="space-y-1.5">
      {entradas.map(([nombre, n]) => (
        <div key={nombre} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink/90 font-mono text-xs">{nombre}</span>
          <span className="text-muted font-semibold tabular-nums">{n}</span>
        </div>
      ))}
    </div>
  );
}

function FilaError({ err }: { err: TelemetriaError }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="rounded-lg border border-border/70 bg-surface/40">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink truncate">{err.event}</p>
          <p className="text-xs text-muted truncate">
            {err.origen || "—"} · {fechaRelativa(err.iso)}
          </p>
        </div>
        <span className="text-xs text-muted shrink-0">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && (
        <div className="px-3 pb-3 space-y-2">
          {err.mensaje && (
            <p className="text-xs text-red-400 font-mono break-words">{err.mensaje}</p>
          )}
          {err.contexto && (
            <pre className="text-[11px] text-muted whitespace-pre-wrap break-words bg-surface-input rounded-md p-2 max-h-40 overflow-auto">
              {err.contexto}
            </pre>
          )}
          {err.traceback && (
            <pre className="text-[11px] text-muted whitespace-pre-wrap break-words bg-surface-input rounded-md p-2 max-h-60 overflow-auto">
              {err.traceback}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function TelemetriaPanel() {
  const { data: resumen, isLoading, error } = useTelemetriaResumen();
  const { data: errData } = useTelemetriaErrores(50);

  if (isLoading) {
    return <p className="text-sm text-muted py-4">Cargando telemetría…</p>;
  }
  if (error || resumen?.error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        No se pudo cargar la telemetría: {String((error as Error)?.message ?? resumen?.error)}
      </div>
    );
  }

  const errores = errData?.errores ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Estado de servicios</h3>
        <ServiciosEstado servicios={resumen?.servicios ?? {}} />
      </section>

      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Eventos de hoy</h3>
          <span className="text-xs text-muted">
            {resumen?.errores_resumen?.total ?? 0} errores en los últimos {resumen?.errores_resumen?.dias ?? 7} días
          </span>
        </div>
        <ContadoresEventos contadores={resumen?.metricas?.hoy?.contadores} />
      </section>

      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Errores recientes</h3>
        {errores.length === 0 ? (
          <p className="text-sm text-muted py-2">Sin errores registrados. 🎉</p>
        ) : (
          <div className="space-y-2">
            {errores.map((e, i) => (
              <FilaError key={`${e.ts}-${i}`} err={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
