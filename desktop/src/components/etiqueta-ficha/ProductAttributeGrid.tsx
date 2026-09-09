import { useState, type ReactNode } from "react";
import ProductAttribute from "./ProductAttribute";
import GaleriaIconosQuimicosModal from "../plantillas-visuales/GaleriaIconosQuimicosModal";
import {
  IconoApariencia,
  IconoComposicion,
  IconoConservacion,
  IconoGrado,
  IconoOlor,
  IconoOrigen,
} from "./iconosLineales";
import type { ProductLabelData } from "./productLabelTypes";

export type AttributeKey = "origin" | "appearance" | "odor" | "composition" | "grade" | "storage";

/** Cuadrícula 2 columnas × 3 filas de atributos del producto, con
 *  divisores naranja horizontales entre filas y uno vertical entre
 *  columnas — tabla editorial abierta, no seis cards independientes. Filas
 *  compactas (95px mínimo, alto según contenido si hace falta más — nunca
 *  se recorta). Cada ícono es clicable y reutiliza la galería de íconos
 *  químicos ya existente en Studio Visual (una sola instancia del modal
 *  compartida por los 6 módulos). */
export default function ProductAttributeGrid({
  data,
  onChange,
  editMode,
  attributeIcons,
  onIconChange,
}: {
  data: ProductLabelData;
  onChange: (patch: Partial<ProductLabelData>) => void;
  editMode: boolean;
  attributeIcons: Partial<Record<AttributeKey, string>>;
  onIconChange: (campo: AttributeKey, svgDataUrl: string) => void;
}) {
  const [campoAbierto, setCampoAbierto] = useState<AttributeKey | null>(null);

  // size={52} = el doble del tamaño por defecto (26) del set de íconos
  // lineales — la caja del botón en ProductAttribute también se agrandó
  // (h-14 w-14) para que quepan sin recortarse.
  const celdas: { icon: ReactNode; title: string; campo: AttributeKey }[] = [
    { icon: <IconoOrigen size={52} />, title: "Origen", campo: "origin" },
    { icon: <IconoApariencia size={52} />, title: "Apariencia", campo: "appearance" },
    { icon: <IconoOlor size={52} />, title: "Olor", campo: "odor" },
    { icon: <IconoComposicion size={52} />, title: "Composición", campo: "composition" },
    { icon: <IconoGrado size={52} />, title: "Grado", campo: "grade" },
    { icon: <IconoConservacion size={52} />, title: "Conservación", campo: "storage" },
  ];

  return (
    <div
      className="col-span-2 grid grid-cols-2 border-y-[1.5px] border-[#FFA500]"
      style={{ gridTemplateRows: "repeat(3, minmax(95px, auto))" }}
    >
      {celdas.map((c, i) => {
        const esColIzq = i % 2 === 0;
        const esFilaUltima = i >= celdas.length - 2;
        return (
          <div
            key={c.campo}
            className={`${esColIzq ? "border-r-[1.5px] border-[#FFA500]" : ""} ${
              esFilaUltima ? "" : "border-b-[1.5px] border-[#FFA500]"
            }`}
          >
            <ProductAttribute
              icon={c.icon}
              iconSrc={attributeIcons[c.campo]}
              title={c.title}
              value={data[c.campo]}
              onChange={(v) => onChange({ [c.campo]: v })}
              editMode={editMode}
              onEditarIcono={() => setCampoAbierto(c.campo)}
              styleKey={c.campo}
            />
          </div>
        );
      })}

      <GaleriaIconosQuimicosModal
        abierta={campoAbierto !== null}
        onCerrar={() => setCampoAbierto(null)}
        onElegir={(svgDataUrl) => {
          if (campoAbierto) onIconChange(campoAbierto, svgDataUrl);
          setCampoAbierto(null);
        }}
      />
    </div>
  );
}
