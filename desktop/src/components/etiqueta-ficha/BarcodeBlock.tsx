import { useMemo, useRef, useState } from "react";
import { generarEAN13, svgToDataUrl } from "../../lib/ean13";
import { useCodigosEan } from "../../lib/etiquetasCodigosEan";
import { filtrarCodigosEanPorTexto } from "../../lib/etiquetaFormulario";
import EditableField from "./EditableField";

/** Código de barras EAN-13 — usa el generador SVG propio del repo (sin
 *  dependencia externa tipo JsBarcode). Clic sobre el código (en edición)
 *  abre un buscador de SKU ya registrados (mismo catálogo que usa el
 *  Formulario de etiqueta física). */
export default function BarcodeBlock({
  value,
  onChange,
  editMode,
}: {
  value: string;
  onChange: (v: string) => void;
  editMode: boolean;
}) {
  const ean = useMemo(() => generarEAN13(value), [value]);
  const grupos = ean ? `${ean.digits[0]} ${ean.digits.slice(1, 7)} ${ean.digits.slice(7)}` : "";

  const { data: codigos } = useCodigosEan();
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [q, setQ] = useState("");
  const sugeridos = useMemo(() => filtrarCodigosEanPorTexto(codigos ?? [], q, 10), [codigos, q]);
  const wrapRef = useRef<HTMLDivElement>(null);

  const elegir = (codigo: string) => {
    onChange(codigo.replace(/\D/g, "").slice(0, 13));
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
          className={`rounded-sm ${editMode ? "cursor-pointer hover:ring-2 hover:ring-[#FFA500]/50" : "cursor-default"}`}
        >
          <img
            src={svgToDataUrl(ean.svg)}
            alt={`Código de barras ${ean.digits}`}
            className="h-[54px] w-1/2 max-w-[200px] object-contain"
          />
        </button>
      ) : (
        <p className="text-center text-[13px] text-[#111111]/50">Código inválido — usa 12 o 13 dígitos.</p>
      )}
      {editMode ? (
        <EditableField
          value={value}
          onChange={(v) => onChange(v.replace(/\D/g, "").slice(0, 13))}
          editMode
          styleKey="barcodeNumber"
          defaultFontSize={12.5}
          className="w-full max-w-[240px] text-center font-mono text-[#111111]"
          placeholder="EAN-13 (12-13 dígitos)"
        />
      ) : (
        grupos && <p className="text-center text-[12.5px] font-mono tracking-widest text-[#111111]/70">{grupos}</p>
      )}

      {buscadorAbierto && (
        <div className="absolute left-1/2 top-full z-[150] mt-1.5 w-72 -translate-x-1/2 rounded-lg border border-border bg-surface-panel p-2.5 text-left shadow-2xl">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-ink">Buscar SKU</p>
            <button type="button" onClick={() => setBuscadorAbierto(false)} className="text-muted hover:text-ink">
              ✕
            </button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre, SKU o código…"
            className="mb-2 w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs"
          />
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {sugeridos.length === 0 && <li className="px-1 py-1 text-xs text-muted">Sin resultados.</li>}
            {sugeridos.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => elegir(c.codigo)}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-accent/10"
                >
                  <span className="font-mono text-[11px] text-muted">{c.codigo}</span>
                  <span className="ml-1.5 font-medium">{c.nombre_producto || c.sku}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
