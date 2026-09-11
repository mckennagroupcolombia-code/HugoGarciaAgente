import { useRef, useState } from "react";
import { EditableLabel } from "../etiqueta-ficha/EditableField";
import GaleriaGhsModal from "../etiqueta-ficha/GaleriaGhsModal";
import type { ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import { IconoCorreo } from "../etiqueta-ficha/iconosLineales";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import CampoEtiqueta from "./CampoEtiqueta";
import BarcodeSection from "./BarcodeSection";
import ContactFooter from "./ContactFooter";
import {
  CLASIFICACION_NO_PELIGROSO,
  EJEMPLO_30ML,
  TAM_30ML,
  esPeligrosoGhs,
  pictogramasGhs,
  textoCirculoGhs,
  textoClasificacion,
} from "./etiqueta30mlTypes";

/** Panel derecho: información técnica + web · clasificación · código de
 *  barras · franja de correo. Mismas 3 filas + franja que el panel izquierdo:
 *  sus líneas horizontales caen exactamente a la misma altura.
 *
 *  En edición: el círculo GHS abre la galería de pictogramas y el código de
 *  barras el buscador de SKU, como en la ficha de 76 × 66. */
export default function RightDocumentationPanel({
  data,
  editMode,
  onChange,
  onElegirCodigo,
}: {
  data: ProductLabelData;
  editMode: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
}) {
  const clasifRef = useRef<HTMLDivElement>(null);
  const [ghsAbierto, setGhsAbierto] = useState(false);
  const editable = editMode && Boolean(onChange);
  const peligroso = esPeligrosoGhs(data.ghs);
  const pictogramas = peligroso ? pictogramasGhs(data) : [];
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  // En edición se ve lo escrito (vacío = la frase por defecto, en gris); en
  // vista, el texto que se imprime (ver `textoClasificacion`).
  const clasificacion = editable ? data.clasificacionTexto || "" : textoClasificacion(data);

  return (
    <section className="e30-panel e30-panel-der">
      <div className="e30-info e30-linea-inf">
        <EditableLabel
          texto="Información técnica:"
          editMode={editMode}
          styleKey="e30_infoTitulo"
          defaultFontSize={14}
          as="p"
          className="e30-info-titulo"
        />
        <CampoEtiqueta
          valor={data.technicalDocuments || ""}
          onChange={cambio("technicalDocuments")}
          editMode={editMode}
          styleKey="e30_technicalDocuments"
          ejemplo={EJEMPLO_30ML.technicalDocuments}
          tam={[14, 10]}
          maxLineas={1}
          className="e30-info-docs"
        />
        <EditableLabel
          texto="Disponible en:"
          editMode={editMode}
          styleKey="e30_disponibleEn"
          defaultFontSize={12.5}
          as="p"
          className="e30-info-disp"
        />
        <div className="e30-web">
          <CampoEtiqueta
            as="span"
            valor={data.website || ""}
            onChange={cambio("website")}
            editMode={editMode}
            styleKey="e30_website"
            ejemplo={EJEMPLO_30ML.website}
            tam={TAM_30ML.web}
            maxLineas={1}
            oscuro
            className="e30-web-texto"
          />
        </div>
      </div>

      <div className="e30-clasif e30-linea-inf">
        <div className="e30-clasif-icono">
          <button
            type="button"
            disabled={!editable}
            onClick={() => setGhsAbierto(true)}
            title={editable ? "Cambiar pictograma GHS" : undefined}
            className="e30-ghs-boton mck-btn-no-fx"
          >
            {!peligroso && data.ghsIconSvg ? (
              <img src={data.ghsIconSvg} alt={data.ghs} className="e30-ghs-pictograma" />
            ) : peligroso ? (
              <span className={`e30-ghs-pictogramas e30-ghs-n${pictogramas.length}`}>
                {pictogramas.map((src, i) => (
                  <img key={i} src={src} alt={data.ghs} className="e30-ghs-pictograma" />
                ))}
              </span>
            ) : (
              <span className="e30-ghs-circulo">
                <CampoEtiqueta
                  as="span"
                  valor={textoCirculoGhs(data.ghs)}
                  editMode={editMode}
                  styleKey="e30_ghs"
                  tam={TAM_30ML.ghs}
                  maxLineas={2}
                  className="e30-ghs-texto"
                />
              </span>
            )}
          </button>
        </div>
        <div ref={clasifRef} className="e30-clasif-texto">
          <EditableLabel
            texto="Clasificación:"
            editMode={editMode}
            styleKey="e30_clasificacionTitulo"
            defaultFontSize={14}
            as="p"
            className="e30-clasif-titulo"
          />
          <CampoEtiqueta
            valor={clasificacion}
            onChange={cambio("clasificacionTexto")}
            editMode={editMode}
            styleKey="e30_clasificacionTexto"
            ejemplo={peligroso ? "Escribe la clasificación de peligro" : CLASIFICACION_NO_PELIGROSO}
            tam={TAM_30ML.clasificacion}
            maxLineas={3}
            cajaRef={clasifRef}
            multilinea
            className="e30-clasif-valor"
          />
        </div>
      </div>

      <BarcodeSection
        value={data.barcode}
        editMode={editable}
        onChange={(v) => onChange?.({ barcode: v })}
        onElegirCodigo={onElegirCodigo}
      />

      <ContactFooter
        editMode={editMode}
        datos={[
          {
            clave: "email",
            icono: <IconoCorreo />,
            texto: data.email || "",
            ejemplo: EJEMPLO_30ML.email,
            onChange: cambio("email"),
          },
        ]}
      />

      {onChange && (
        <GaleriaGhsModal
          abierta={ghsAbierto}
          codigoActual={data.ghs}
          circuloNoGhs
          onCerrar={() => setGhsAbierto(false)}
          // Se ve lo que se elige: un pictograma, el rombo «NO GHS» o, con la
          // tarjeta «Círculo» (svg vacío), el círculo «¡NO GHS».
          onElegir={(svgDataUrl, codigo) => onChange({ ghs: codigo, ghsIconSvg: svgDataUrl })}
        />
      )}
    </section>
  );
}
