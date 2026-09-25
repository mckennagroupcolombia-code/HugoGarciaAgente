import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { useTicketsAuth } from "../../stores/ticketsAuth";

/**
 * Foto de referencia de un producto de inventario (insumo), por SKU.
 *
 * Existe para que quien compra o recibe reconozca el producto REAL y no el código
 * parecido: el catálogo tenía «PASTILLERO 180mL BLANCO» y «PASTILLERO BLANCO 180mL».
 * Se ve en el buscador de productos del wizard de pagos, en Recepción de mercancía y
 * en la vista de insumos. Si falta, se toma con la cámara ahí mismo.
 * Backend: /api/insumos/<sku>/foto (app/services/insumos.py).
 */
export function urlFotoInsumo(sku: string, token: string, version = ""): string {
  return `/api/insumos/${encodeURIComponent(sku)}/foto?token=${encodeURIComponent(token)}${version ? `&v=${encodeURIComponent(version)}` : ""}`;
}

export default function FotoInsumo({
  sku, tiene, version = "", tam = 40, subir = true, onCambio,
}: {
  sku: string;
  /** Si el backend ya dijo que hay foto. Sin el dato se intenta cargar igual. */
  tiene?: boolean;
  version?: string;
  tam?: number;
  subir?: boolean;
  onCambio?: () => void;
}) {
  const token = useTicketsAuth((s) => s.token) || "";
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState("");
  const [grande, setGrande] = useState(false);
  const [v, setV] = useState(version);
  const hay = tiene !== false && !error;

  async function elegido(f: File | undefined) {
    if (!f) return;
    setSubiendo(true); setAviso("");
    try {
      const form = new FormData();
      form.append("foto", f);
      const r = await api.upload<{ subida_en?: string; error?: string }>(
        `/api/insumos/${encodeURIComponent(sku)}/foto`, form, { timeoutMs: 120_000 });
      if (r.error) throw new Error(r.error);
      setError(false);
      setV(r.subida_en || String(Date.now()));
      void qc.invalidateQueries({ queryKey: ["insumos"] });
      void qc.invalidateQueries({ queryKey: ["pagos-productos"] });
      onCambio?.();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  }

  const caja = { width: tam, height: tam };
  return (
    <span className="relative inline-flex shrink-0 flex-col items-center" onClick={(e) => e.stopPropagation()}>
      {hay ? (
        <span role="button" tabIndex={0} title={`Ver la foto de ${sku}`} onClick={() => setGrande(true)}
          onKeyDown={(e) => { if (e.key === "Enter") setGrande(true); }}
          className="block cursor-zoom-in overflow-hidden rounded-md border border-border bg-white" style={caja}>
          <img src={urlFotoInsumo(sku, token, v)} alt={sku} loading="lazy" onError={() => setError(true)}
            className="h-full w-full object-cover" />
        </span>
      ) : subir ? (
        <span role="button" tabIndex={0} title="Sin foto de referencia: tomarla o subirla"
          onClick={() => input.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter") input.current?.click(); }}
          className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-amber-500/70 bg-amber-500/5 text-center text-[9px] font-bold leading-tight text-amber-700 dark:text-amber-300"
          style={caja}>
          {subiendo ? "…" : "+ foto"}
        </span>
      ) : (
        <span className="flex items-center justify-center rounded-md border border-dashed border-border text-[9px] text-muted" style={caja}>
          sin foto
        </span>
      )}
      {subir && (
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => void elegido(e.target.files?.[0])} />
      )}
      {aviso && <span className="absolute top-full z-10 mt-0.5 w-40 rounded bg-red-500/10 px-1 text-[10px] text-red-600">{aviso}</span>}
      {grande && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setGrande(false)}>
          <div className="max-h-full max-w-[min(90vw,720px)] rounded-xl bg-surface-panel p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <img src={urlFotoInsumo(sku, token, v)} alt={sku} className="max-h-[70vh] w-full rounded-lg object-contain" />
            <div className="mt-2 flex items-center gap-2">
              <code className="font-bold text-accent">{sku}</code>
              {subir && (
                <button type="button" onClick={() => input.current?.click()} disabled={subiendo}
                  className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-ink">
                  {subiendo ? "Subiendo…" : "Cambiar foto"}
                </button>
              )}
              <button type="button" onClick={() => setGrande(false)}
                className={`${subir ? "" : "ml-auto "}rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white`}>Cerrar</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
