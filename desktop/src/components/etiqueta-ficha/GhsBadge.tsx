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
/** Paso y tope del ajuste de altura del rombo (en % de la caja). */
const DESPLAZAMIENTO_PASO = 5;
const DESPLAZAMIENTO_MAX = 50;

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
  desplazamiento = 0,
  onDesplazamientoChange,
  editMode,
}: {
  value: string;
  onChange: (v: string) => void;
  iconSvg?: string;
  onIconChange: (svgDataUrl: string) => void;
  /** % de la caja que se sube (negativo) o baja el rombo. */
  desplazamiento?: number;
  onDesplazamientoChange?: (v: number) => void;
  editMode: boolean;
}) {
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const src = useMemo(() => iconSvg || pictogramaPorDefecto(value), [iconSvg, value]);
  const mover = (delta: number) =>
    onDesplazamientoChange?.(
      Math.max(-DESPLAZAMIENTO_MAX, Math.min(DESPLAZAMIENTO_MAX, desplazamiento + delta)),
    );

  return (
    <>
      {/* El desplazamiento va con `transform` sobre el rombo: lo mueve sin
          cambiar el alto de la caja, así el resto de la columna no se corre. */}
      <div className="relative shrink-0" style={{ width: TAMANO_CAJA, height: TAMANO_CAJA }}>
        <button
          type="button"
          disabled={!editMode}
          onClick={() => setGaleriaAbierta(true)}
          title={editMode ? "Cambiar pictograma GHS" : undefined}
          style={{ width: TAMANO_CAJA, height: TAMANO_CAJA, transform: `translateY(${desplazamiento}%)` }}
          className={`flex items-center justify-center rounded-md border-0 bg-transparent p-0 ${
            editMode ? "cursor-pointer hover:bg-[color:var(--acento-08)]" : "cursor-default"
          }`}
        >
          <img
            src={src}
            alt={value || "Pictograma GHS"}
            style={{ width: TAMANO_ROMBO, height: TAMANO_ROMBO }}
            className="object-contain"
          />
        </button>
        {editMode && onDesplazamientoChange && (
          <div className="absolute left-full top-1/2 ml-1.5 flex -translate-y-1/2 flex-col items-center gap-0.5 text-[11px] text-[#111111]/50">
            <button
              type="button"
              onClick={() => mover(-DESPLAZAMIENTO_PASO)}
              disabled={desplazamiento <= -DESPLAZAMIENTO_MAX}
              title="Subir pictograma"
              className="flex h-5 w-5 items-center justify-center rounded border border-[#111111]/20 hover:border-[color:var(--acento)] hover:text-[color:var(--acento)] disabled:opacity-30"
            >
              ▲
            </button>
            <span className="tabular-nums">{desplazamiento > 0 ? `+${desplazamiento}` : desplazamiento}%</span>
            <button
              type="button"
              onClick={() => mover(DESPLAZAMIENTO_PASO)}
              disabled={desplazamiento >= DESPLAZAMIENTO_MAX}
              title="Bajar pictograma"
              className="flex h-5 w-5 items-center justify-center rounded border border-[#111111]/20 hover:border-[color:var(--acento)] hover:text-[color:var(--acento)] disabled:opacity-30"
            >
              ▼
            </button>
          </div>
        )}
      </div>

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
