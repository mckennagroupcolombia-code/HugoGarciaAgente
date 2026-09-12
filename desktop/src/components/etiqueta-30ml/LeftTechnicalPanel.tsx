import { useState } from "react";
import GaleriaIconosQuimicosModal from "../plantillas-visuales/GaleriaIconosQuimicosModal";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import { normalizarHex, type ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import { IconoTelefono, IconoUbicacion } from "../etiqueta-ficha/iconosLineales";
import TechnicalCell from "./TechnicalCell";
import ContactFooter from "./ContactFooter";
import { CELDAS_30ML, EJEMPLO_30ML, TITULOS_FORMULA_30ML, tituloFormula30ml } from "./etiqueta30mlTypes";

/** Panel izquierdo: matriz exacta de 2 columnas × 3 filas (CSS Grid) y la
 *  franja de ubicación + teléfono. Las líneas son bordes de las celdas: la
 *  vertical va en la columna 1 y las horizontales en las filas 1 y 2.
 *  Una sola galería de íconos compartida por las seis celdas, como en la
 *  ficha de 76 × 66. */
export default function LeftTechnicalPanel({
  data,
  editMode,
  onChange,
  attributeIcons,
  onIconChange,
}: {
  data: ProductLabelData;
  editMode: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  attributeIcons: Partial<Record<AttributeKey, string>>;
  onIconChange?: (campo: AttributeKey, svgDataUrl: string) => void;
}) {
  const [campoAbierto, setCampoAbierto] = useState<AttributeKey | null>(null);
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  return (
    <section className="e30-panel e30-panel-izq">
      {CELDAS_30ML.map((c, i) => (
        <TechnicalCell
          key={c.campo}
          campo={c.campo}
          titulo={c.campo === "composition" ? tituloFormula30ml(data) : c.titulo}
          {...(c.campo === "composition" && onChange
            ? {
                tituloOpciones: TITULOS_FORMULA_30ML,
                onTituloChange: (v: string) => onChange({ compositionTitulo: v }),
              }
            : {})}
          valor={data[c.campo] || ""}
          ejemplo={EJEMPLO_30ML[c.campo]}
          iconoElegido={attributeIcons[c.campo]}
          iconoPorDefecto={c.icono}
          editMode={editMode}
          lineas={`${i % 2 === 0 ? "e30-linea-der" : ""} ${i < CELDAS_30ML.length - 2 ? "e30-linea-inf" : ""}`}
          onChange={cambio(c.campo)}
          onEditarIcono={onIconChange ? () => setCampoAbierto(c.campo) : undefined}
        />
      ))}
      <ContactFooter
        editMode={editMode}
        datos={[
          { clave: "city", icono: <IconoUbicacion />, texto: data.city || "", ejemplo: EJEMPLO_30ML.city, onChange: cambio("city") },
          { clave: "phone", icono: <IconoTelefono />, texto: data.phone || "", ejemplo: EJEMPLO_30ML.phone, onChange: cambio("phone") },
        ]}
      />
      {onIconChange && (
        <GaleriaIconosQuimicosModal
          abierta={campoAbierto !== null}
          colorTinta={normalizarHex(data.accentColor)}
          onCerrar={() => setCampoAbierto(null)}
          onElegir={(svgDataUrl) => {
            if (campoAbierto) onIconChange(campoAbierto, svgDataUrl);
            setCampoAbierto(null);
          }}
        />
      )}
    </section>
  );
}
