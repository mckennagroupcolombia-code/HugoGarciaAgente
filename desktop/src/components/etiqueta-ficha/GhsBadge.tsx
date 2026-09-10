import { useMemo, useState } from "react";
import GaleriaGhsModal from "./GaleriaGhsModal";
import { ghsSvgADataUrl, marcoGhsSvg } from "../GHSIconsPicker";

/** Estado GHS — mismo patrón que los íconos de atributo: el pictograma es
 *  un botón; en edición, clic abre la galería GHS y un clic allí lo
 *  reemplaza. Sin botones auxiliares (▾ / ×) alrededor: la galería ya
 *  ofrece "NO GHS" para volver al estado sin peligro, así el rombo queda
 *  exactamente centrado en la columna. Mientras no se elija uno, se ve el
 *  rombo que corresponde al texto `value` ("NO GHS" o "GHS0xx").
 *
 *  Caja de 136 px (el doble de los 68 px originales): a 68 px el rombo se
 *  perdía al imprimir la etiqueta a tamaño real. */
const TAMANO_CAJA = 136;
const TAMANO_ROMBO = 124;

function pictogramaPorDefecto(value: string): string {
  const m = /GHS\s*0*(\d{1,3})/i.exec(value || "");
  const svg = m ? marcoGhsSvg(m[1].padStart(3, "0"), false) : marcoGhsSvg("", true);
  return ghsSvgADataUrl(svg);
}

export default function GhsBadge({
  value,
  onChange,
  iconSvg,
  onIconChange,
  editMode,
}: {
  value: string;
  onChange: (v: string) => void;
  iconSvg?: string;
  onIconChange: (svgDataUrl: string) => void;
  editMode: boolean;
}) {
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const src = useMemo(() => iconSvg || pictogramaPorDefecto(value), [iconSvg, value]);

  return (
    <>
      <button
        type="button"
        disabled={!editMode}
        onClick={() => setGaleriaAbierta(true)}
        title={editMode ? "Cambiar pictograma GHS" : undefined}
        style={{ width: TAMANO_CAJA, height: TAMANO_CAJA }}
        className={`flex shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 transition-transform duration-150 ${
          editMode ? "cursor-pointer hover:scale-[1.04] hover:bg-[color:var(--acento-08)]" : "cursor-default"
        }`}
      >
        <img
          src={src}
          alt={value || "Pictograma GHS"}
          style={{ width: TAMANO_ROMBO, height: TAMANO_ROMBO }}
          className="object-contain"
        />
      </button>

      <GaleriaGhsModal
        abierta={galeriaAbierta}
        codigoActual={value}
        onCerrar={() => setGaleriaAbierta(false)}
        onElegir={(svgDataUrl, codigo) => {
          onIconChange(svgDataUrl);
          onChange(codigo);
        }}
      />
    </>
  );
}
