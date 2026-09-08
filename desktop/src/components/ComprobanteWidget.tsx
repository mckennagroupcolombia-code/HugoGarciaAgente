import { useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";

/**
 * Adjuntar/ver/quitar el comprobante de sustento de un asiento del Libro
 * Mayor propio (app/services/contabilidad_core.py::guardar_comprobante) —
 * clave cuando la operación (p.ej. compra courier de un socio) no tiene
 * factura fiscal. Usado en LibroMayorPanel.tsx y PrestamosPanel.tsx.
 */
export default function ComprobanteWidget({
  movimientoId,
  soportePath,
  soporteNombre,
  onUpdated,
}: {
  movimientoId: number;
  soportePath?: string;
  soporteNombre?: string;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subir = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      const r = await api.upload<{ ok?: boolean; error?: string }>(
        `/api/contabilidad/cc/movimientos/${movimientoId}/comprobante`,
        fd,
        { timeoutMs: 60_000 },
      );
      if (r.error) throw new Error(r.error);
      onUpdated();
    } catch (e) {
      setErr((e as Error).message || "No se pudo subir el comprobante");
    } finally {
      setBusy(false);
    }
  };

  const ver = async () => {
    const url = await fetchAuthBlobUrl(`/api/contabilidad/cc/movimientos/${movimientoId}/comprobante`);
    if (url) window.open(url, "_blank", "noopener");
    else setErr("No se pudo abrir el comprobante");
  };

  const quitar = async () => {
    if (!confirm("¿Quitar el comprobante adjunto?")) return;
    setBusy(true);
    setErr(null);
    try {
      await api.delete(`/api/contabilidad/cc/movimientos/${movimientoId}/comprobante`);
      onUpdated();
    } catch (e) {
      setErr((e as Error).message || "No se pudo quitar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]" onClick={(e) => e.stopPropagation()}>
      {soportePath ? (
        <>
          <button type="button" onClick={() => void ver()} className="font-bold text-accent hover:underline">
            📎 Ver comprobante{soporteNombre ? ` (${soporteNombre})` : ""}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void quitar()}
            className="text-muted hover:text-danger disabled:opacity-40"
          >
            Quitar
          </button>
        </>
      ) : (
        <label className={`cursor-pointer font-bold text-muted hover:text-accent ${busy ? "opacity-40" : ""}`}>
          {busy ? "Subiendo…" : "📎 Adjuntar comprobante"}
          <input
            type="file"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {err && <span className="text-danger">{err}</span>}
    </div>
  );
}
