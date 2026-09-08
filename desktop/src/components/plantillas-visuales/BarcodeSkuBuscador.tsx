import { useMemo, useState } from "react";
import { useCodigosEan } from "../../lib/etiquetasCodigosEan";
import { filtrarCodigosEanPorTexto } from "../../lib/etiquetaFormulario";

/**
 * Buscador de SKU/EAN que se abre al clicar el código de barras en el
 * lienzo. Solo cambia el `src` del elemento (ver `aplicarBarcodeEan`);
 * tamaño y posición de la caja quedan intactos.
 */
export default function BarcodeSkuBuscador({
  eanActual,
  onElegir,
  onCerrar,
}: {
  eanActual: string;
  onElegir: (codigo: string) => void;
  onCerrar: () => void;
}) {
  const [q, setQ] = useState("");
  const { data: codigosEan, isLoading } = useCodigosEan();
  const resultados = useMemo(
    () => filtrarCodigosEanPorTexto(codigosEan ?? [], q, 12),
    [codigosEan, q],
  );

  return (
    <div className="w-72 space-y-2 text-ink">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Buscar SKU / EAN</p>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface-hover"
          title="Cerrar"
        >
          ✕
        </button>
      </div>
      <input
        autoFocus
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Nombre o SKU del producto…"
        className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-ink"
      />
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {isLoading && <p className="px-1 py-2 text-[11px] text-muted">Cargando…</p>}
        {!isLoading && resultados.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-muted">Sin resultados.</p>
        )}
        {resultados.map((c) => {
          const activo = c.codigo === eanActual;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onElegir(c.codigo)}
              className={`block w-full rounded-lg border px-2 py-1.5 text-left text-[11px] ${
                activo
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-surface hover:bg-surface-hover"
              }`}
            >
              <span className="block truncate font-medium">{c.nombre_producto || c.sku}</span>
              <span className="block truncate font-mono text-[10px] text-muted">
                {c.sku} · {c.codigo}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
