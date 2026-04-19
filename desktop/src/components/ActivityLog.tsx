import { useEffect, useRef, useState } from "react";
import { usePanelLogs, useClearPanelLogs } from "../hooks/usePanelLogs";

export default function ActivityLog() {
  const [open, setOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { data, isFetching, isError, error } = usePanelLogs(open);
  const clear = useClearPanelLogs();

  useEffect(() => {
    if (open && data?.lines?.length) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.lines, open]);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-sm font-medium text-accent hover:underline"
        >
          {open ? "Ocultar" : "Mostrar"} actividad del servidor
        </button>
        <div className="flex items-center gap-2">
          {isFetching && open && (
            <span className="text-xs text-muted">actualizando…</span>
          )}
          <button
            type="button"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
            className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-danger"
          >
            Limpiar log
          </button>
        </div>
      </div>

      {open && (
        <div className="rounded-paper border border-border-strong bg-surface-panel p-3 font-mono text-[11px] leading-relaxed text-ink-secondary shadow-paper-sm">
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
