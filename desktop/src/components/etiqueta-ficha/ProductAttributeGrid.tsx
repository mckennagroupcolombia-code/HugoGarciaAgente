import { useState, type ReactNode } from "react";
import ProductAttribute from "./ProductAttribute";
import GaleriaIconosQuimicosModal from "../plantillas-visuales/GaleriaIconosQuimicosModal";
import { ICONOS_QUIMICA_CIRCULARES, quitarCirculoExterior } from "../../lib/iconosQuimicaCirculares";
import { TITULOS_COMPOSICION, type ProductLabelData } from "./productLabelTypes";

export type AttributeKey = "origin" | "appearance" | "odor" | "composition" | "grade" | "storage";

/** Ícono por defecto de cada atributo = un ícono de la galería (misma
 *  familia visual que los que el operador puede elegir después, en vez de
 *  un set lineal aparte). Se dibuja en línea (no como data URL) para que
 *  herede el color de acento vía `currentColor`. */
const ICONO_GALERIA_POR_DEFECTO: Record<AttributeKey, string> = {
  origin: "origen_globo_meridianos",
  appearance: "apariencia_ojo",
  odor: "aroma_ondas_gota",
  composition: "composicion_molecula_enlazada",
  grade: "calidad_escudo_sello",
  storage: "conservacion_envase_sellado",
};

const TAMANO_ICONO = 58;

function IconoGaleriaInline({ id, size = TAMANO_ICONO }: { id: string; size?: number }) {
  const icono = ICONOS_QUIMICA_CIRCULARES.find((i) => i.id === id);
  if (!icono) return null;
  // Sin el círculo exterior y acercado ×1.3 — exactamente como la galería
  // inserta los íconos elegidos, para que defecto y elegido midan igual.
  return (
    <span
      aria-hidden="true"
      className="block [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: quitarCirculoExterior(icono.svg) }}
    />
  );
}

/** Cuadrícula 2 columnas × 3 filas de atributos del producto, con
 *  divisores en color de acento horizontales entre filas y uno vertical
 *  entre columnas — tabla editorial abierta, no seis cards independientes.
 *  Filas compactas (95px mínimo, alto según contenido si hace falta más —
 *  nunca se recorta). Cada ícono es clicable y reutiliza la galería de
 *  íconos químicos (una sola instancia del modal compartida por los 6
 *  módulos); mientras no se elija uno, se ve el de la galería asignado por
 *  defecto a ese atributo. */
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

  const celdas: { icon: ReactNode; title: string; campo: AttributeKey }[] = (
    [
      ["Origen", "origin"],
      ["Apariencia", "appearance"],
      ["Olor", "odor"],
      [data.compositionTitulo || TITULOS_COMPOSICION[0], "composition"],
      ["Grado", "grade"],
      ["Conservación", "storage"],
    ] as [string, AttributeKey][]
  ).map(([title, campo]) => ({
    title,
    campo,
    icon: <IconoGaleriaInline id={ICONO_GALERIA_POR_DEFECTO[campo]} />,
  }));

  return (
    <div
      className="col-span-2 grid grid-cols-2 border-y-[1.5px] border-[color:var(--acento)]"
      // Las 3 filas las define el cuerpo de la ficha (FILAS_CUERPO en
      // ProductLabelForm) y aquí se heredan con `subgrid`: así la columna
      // derecha comparte exactamente las mismas líneas de fila.
      style={{ gridRow: "span 3", gridTemplateRows: "subgrid" }}
    >
      {celdas.map((c, i) => {
        const esColIzq = i % 2 === 0;
        const esFilaUltima = i >= celdas.length - 2;
        return (
          <div
            key={c.campo}
            className={`${esColIzq ? "border-r-[1.5px] border-[color:var(--acento)]" : ""} ${
              esFilaUltima ? "" : "border-b-[1.5px] border-[color:var(--acento)]"
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
              {...(c.campo === "composition"
                ? {
                    tituloOpciones: TITULOS_COMPOSICION,
                    onTituloChange: (v: string) => onChange({ compositionTitulo: v }),
                  }
                : {})}
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
