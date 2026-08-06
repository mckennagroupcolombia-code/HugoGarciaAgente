import { useEffect, useRef, useState } from "react";
import { usePanelLogs, useClearPanelLogs } from "../hooks/usePanelLogs";

type Props = {
  /** Barra compacta en una sola fila (sin márgenes extra). */
  compact?: boolean;
};

export default function ActivityLog({ compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { data, isFetching, isError, error } = usePanelLogs(open);
  const clear = useClearPanelLogs();

  useEffect(() => {
    if (open && data?.lines?.length) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.lines, open]);

  return (
    <div className={compact ? "min-w-0" : "mt-4 border-t border-border pt-3"}>
      <div className={`flex items-center gap-2 ${compact ? "" : "mb-2 justify-between"}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={
            compact
              ? "whitespace-nowrap text-[11px] font-semibold text-accent hover:underline"
              : "text-sm font-medium text-accent hover:underline"
          }
        >
          {open ? "Ocultar" : "Mostrar"} actividad
          {!compact && " del servidor"}
        </button>
        {isFetching && open && (
          <span className="text-[10px] text-muted">actualizando…</span>
        )}
        <button
          type="button"
          disabled={clear.isPending}
          onClick={() => clear.mutate()}
          className={
            compact
              ? "rounded border border-border px-2 py-1 text-[10px] font-semibold text-muted hover:text-danger"
              : "rounded border border-border px-2 py-1 text-xs text-muted hover:text-danger"
          }
        >
          Limpiar log
        </button>
      </div>

      {open && (
        <div
          className={`overflow-y-auto rounded-paper border border-border-strong bg-surface-panel p-3 font-mono text-[11px] leading-relaxed text-ink-secondary shadow-paper-sm ${
            compact ? "absolute bottom-full left-0 right-0 z-30 mb-1 max-h-40" : "max-h-44"
          }`}
        >
          {isError && (
            <p className="text-danger">
              No se pudo leer el log: {(error as Error)?.message}
            </p>
          )}
          {!isError && (!data?.lines || data.lines.length === 0) && (
            <p className="text-muted">
              Sin líneas aún. Al pulsar Ejecutar en Sincronización o Stock aparecerá el
              seguimiento aquí (también revisa journalctl del servicio agente-pro).
            </p>
          )}
          {data?.lines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
