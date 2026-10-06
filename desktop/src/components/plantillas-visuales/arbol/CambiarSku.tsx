/**
 * Botón mini (✎) para corregir el SKU de un combo desde el árbol. Solo se puede si Alegra no
 * reporta movimientos del ítem (la misma regla del emergente de Catálogo Alegra): con ventas o
 * facturas el código queda fijo y hay que duplicar el combo.
 *
 * Escribe por el mismo `PATCH /api/alegra/catalogo/<sku>` con `nuevo_codigo`; no nace otra forma
 * de escribir en Alegra. Es un <span role="button"> por la misma razón que CopiarSku.
 */
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../api/client";

type Revision = { estado: "cargando" } | { estado: "libre"; dudoso: boolean } | { estado: "bloqueado" };

export function CambiarSku({ sku, onCambiado, className = "" }: {
  sku: string;
  onCambiado: (nuevo: string) => void | Promise<void>;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  if (!sku) return null;
  const abrir = (ev: MouseEvent | KeyboardEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    setAbierto(true);
  };
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title={`Cambiar el código ${sku}`}
        aria-label={`Cambiar SKU ${sku}`}
        onClick={abrir}
        onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && abrir(ev)}
        className={`inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-[11px] leading-none opacity-60 hover:bg-ink/10 hover:opacity-100 ${className}`}
      >
        ✎
      </span>
      {abierto && createPortal(
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <VentanaCambiarSku sku={sku} onCerrar={() => setAbierto(false)} onCambiado={onCambiado} />,
        </span>,
        document.body,
      )}
    </>
  );
}

function VentanaCambiarSku({ sku, onCerrar, onCambiado }: {
  sku: string;
  onCerrar: () => void;
  onCambiado: (nuevo: string) => void | Promise<void>;
}) {
  const [revision, setRevision] = useState<Revision>({ estado: "cargando" });
  const [codigo, setCodigo] = useState(sku);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    api.get<{ ok: boolean; tiene_movimientos?: boolean | null }>(`/api/siigo/productos/detalle?codigo=${encodeURIComponent(sku)}`)
      .then((r) => {
        if (cancel) return;
        if (r.ok && r.tiene_movimientos === true) setRevision({ estado: "bloqueado" });
        else setRevision({ estado: "libre", dudoso: !r.ok });
      })
      .catch(() => { if (!cancel) setRevision({ estado: "libre", dudoso: true }); });
    return () => { cancel = true; };
  }, [sku]);

  const nuevo = codigo.trim();
  const cambia = Boolean(nuevo) && nuevo.toUpperCase() !== sku.toUpperCase();
  const cerrar = () => { if (!ocupado) onCerrar(); };

  const guardar = async () => {
    if (!cambia || ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await api.patch<{ ok: boolean; error?: string; item?: { reference?: string } }>(
        `/api/alegra/catalogo/${encodeURIComponent(sku)}`,
        { nuevo_codigo: nuevo },
      );
      if (!r.ok) throw new Error(r.error || "Alegra no aceptó el cambio");
      await onCambiado(r.item?.reference || nuevo);
      onCerrar();
    } catch (e) {
      setError((e as Error)?.message || "No se pudo cambiar el código en Alegra");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Cambiar el código de ${sku}`}
      className="colab-pixel arbol-pixel fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={cerrar}>
      <div className="ap-carta w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="ap-cab ap-cab-navy">
          <span className="min-w-0 flex-1">Cambiar el código</span>
          <code className="shrink-0 normal-case">{sku}</code>
        </div>
        <div className="flex flex-col gap-2 p-3 text-[12px]">
          {revision.estado === "cargando" && <p className="ap-mensaje">Revisando movimientos en Alegra…</p>}
          {revision.estado === "bloqueado" && (
            <p className="ap-nota ap-falta">Este combo ya tiene movimientos en Alegra (ventas o facturas): su código no se puede cambiar. Para otro código, duplica el combo.</p>
          )}
          {revision.estado === "libre" && (
            <>
              <label className="ap-t" htmlFor="cambiar-sku-nuevo">Código nuevo</label>
              <input
                id="cambiar-sku-nuevo"
                autoFocus
                value={codigo}
                disabled={ocupado}
                onChange={(e) => setCodigo(e.target.value.replace(/[^A-Za-z0-9._-]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && void guardar()}
                className="w-full border-[3px] border-ink bg-white px-2 py-1.5 font-mono text-[13px] text-ink outline-none"
              />
              {revision.dudoso
                ? <p className="ap-nota ap-aviso">No se pudo confirmar en Alegra si tiene movimientos; si ya tiene ventas, Alegra rechazará el cambio.</p>
                : <p className="text-[11px] text-ink-secondary">Sin movimientos en Alegra: el código se puede corregir.</p>}
              <p className="text-[11px] text-ink-secondary">Solo cambia en Alegra. Si ya hay publicación en MeLi o en la web con el código viejo, hay que cambiarlo allá también.</p>
            </>
          )}
          {error && <p className="ap-nota ap-falta">{error}</p>}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" className="ap-btn ap-btn-sec" disabled={ocupado} onClick={cerrar}>Cancelar</button>
            {revision.estado === "libre" && (
              <button type="button" className="ap-btn" disabled={ocupado || !cambia} onClick={() => void guardar()}>
                {ocupado ? "Guardando…" : "Guardar código"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
