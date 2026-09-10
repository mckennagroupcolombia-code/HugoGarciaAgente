import { useMemo, useRef, useState } from "react";
import { generarEAN13, svgToDataUrl } from "../../lib/ean13";
import { useCodigosEan, type CodigoEan } from "../../lib/etiquetasCodigosEan";
import { filtrarCodigosEanPorTexto } from "../../lib/fichaTecnicaCampos";
import PopoverFlotante from "./PopoverFlotante";

/** Código de barras EAN-13 — usa el generador SVG propio del repo (sin
 *  dependencia externa tipo JsBarcode). El SVG ya imprime los dígitos
 *  debajo de las barras (como cualquier EAN-13 real), así que no hay una
 *  casilla de número aparte: clic sobre el código (en edición) abre un
 *  buscador de SKU ya registrados (mismo catálogo que usa el Formulario
 *  de etiqueta física), con opción de escribir el código a mano si no
 *  está en la lista.
 *
 *  Al elegir un SKU del catálogo (o escribir un código que exista en él)
 *  se avisa con `onElegirCodigo` el registro completo — el formulario usa
 *  su título para nombrar el archivo y enlazar la ficha técnica. */
export default function BarcodeBlock({
  value,
  onChange,
  onElegirCodigo,
  editMode,
}: {
  value: string;
  onChange: (v: string) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
  editMode: boolean;
}) {
  const ean = useMemo(() => generarEAN13(value), [value]);

  const { data: codigos } = useCodigosEan();
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [q, setQ] = useState("");
  const sugeridos = useMemo(() => filtrarCodigosEanPorTexto(codigos ?? [], q, 10), [codigos, q]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const qDigitos = q.replace(/\D/g, "");
  const qEsCodigoValido = qDigitos.length === 12 || qDigitos.length === 13;

  const elegir = (codigo: string, registro?: CodigoEan) => {
    const digitos = codigo.replace(/\D/g, "").slice(0, 13);
    onChange(digitos);
    // Código escrito a mano: si existe en el catálogo, se trata igual que
    // si se hubiera elegido de la lista (mismo título para el archivo).
    const item =
      registro ??
      (codigos ?? []).find((c) => c.codigo.replace(/\D/g, "").slice(0, 13) === digitos);
    if (item) onElegirCodigo?.(item);
    setBuscadorAbierto(false);
    setQ("");
  };

  return (
    <div ref={wrapRef} className="relative flex flex-col items-center justify-center gap-1.5 px-4 py-2.5">
      {ean ? (
        <button
          type="button"
          disabled={!editMode}
          onClick={() => setBuscadorAbierto((v) => !v)}
          title={editMode ? "Buscar por SKU" : undefined}
          className={`rounded-sm ${editMode ? "cursor-pointer hover:ring-2 hover:ring-[color:var(--acento-50)]" : "cursor-default"}`}
        >
          <img
            src={svgToDataUrl(ean.svg)}
            alt={`Código de barras ${ean.digits}`}
            className="h-auto w-full max-w-[280px]"
          />
        </button>
      ) : editMode ? (
        <button
          type="button"
          onClick={() => setBuscadorAbierto(true)}
          className="rounded border border-dashed border-[#111111]/25 px-3 py-2 text-[13px] text-[#111111]/50 hover:border-[color:var(--acento)] hover:text-[color:var(--acento)]"
        >
          Elegir código de barras…
        </button>
      ) : (
        <p className="text-center text-[13px] text-[#111111]/50">Sin código de barras.</p>
      )}

      <PopoverFlotante
        anchorRef={wrapRef}
        abierto={buscadorAbierto}
        onCerrar={() => setBuscadorAbierto(false)}
        alinear="centro"
        ancho={300}
      >
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-ink">Buscar SKU</p>
            <button type="button" onClick={() => setBuscadorAbierto(false)} className="text-muted hover:text-ink">
              ✕
            </button>
          </div>
          <p className="mb-1.5 text-[11px] text-muted">
            El título del SKU elegido nombra el PNG y la ficha guardada, y busca la ficha técnica que coincida.
          </p>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre, SKU o código de 12-13 dígitos…"
            className="mb-2 w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs"
          />
          {qEsCodigoValido && (
            <button
              type="button"
              onClick={() => elegir(qDigitos)}
              className="mb-2 w-full rounded-lg border border-dashed border-accent/40 px-2.5 py-1.5 text-left text-xs text-accent hover:bg-accent/5"
            >
              Usar código escrito: <span className="font-mono">{qDigitos}</span>
            </button>
          )}
          <ul className="space-y-1">
            {sugeridos.length === 0 && <li className="px-1 py-1 text-xs text-muted">Sin resultados.</li>}
            {sugeridos.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => elegir(c.codigo, c)}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-accent/10"
                >
                  <span className="font-mono text-[11px] text-muted">{c.codigo}</span>
                  <span className="ml-1.5 font-medium">{c.nombre_producto || c.sku}</span>
                </button>
              </li>
            ))}
          </ul>
      </PopoverFlotante>
    </div>
  );
}
