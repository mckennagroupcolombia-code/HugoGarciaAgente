import { useState } from "react";
import { useAlertasSistema } from "../hooks/useAlertasSistema";
import { Icon } from "../icons";

function minutosDesde(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

/**
 * Banner global de alertas operativas — visible arriba del header en TODAS las
 * secciones de /app (a diferencia de WhatsApp, que puede estar caído justo
 * cuando más se necesita avisar). Ver app/tools/alertas_sistema.py.
 */
export default function SystemAlertsBanner() {
  const { data } = useAlertasSistema();
  const [descartadas, setDescartadas] = useState<Set<string>>(new Set());

  const alertas = (data?.alertas ?? []).filter((a) => !descartadas.has(a.id));
  if (alertas.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 border-b border-danger/30 bg-danger/10 px-3 py-2 sm:px-4">
      {alertas.map((a) => (
        <div key={a.id} className="flex items-start gap-2 text-xs">
          <Icon
            name="warning"
            size={16}
            weight="bold"
            className="mt-0.5 shrink-0 text-danger"
          />
          <div className="min-w-0 flex-1">
            <span className="font-bold text-danger">{a.titulo}</span>
            <span className="text-danger/90"> — {a.detalle}</span>
            {a.accion_sugerida && (
              <code className="ml-1 rounded bg-danger/15 px-1 py-0.5 text-[10px] text-danger">
                {a.accion_sugerida}
              </code>
            )}
            <span className="ml-1 text-[10px] text-danger/70">
              (hace {minutosDesde(a.desde)} min)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDescartadas((prev) => new Set(prev).add(a.id))}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-danger/70 hover:bg-danger/15 hover:text-danger"
            title="Descartar hasta que recargues la página"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
