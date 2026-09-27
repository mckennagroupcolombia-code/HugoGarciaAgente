import { useMemo, useState } from "react";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import { COLORES_FRANJA_BARRAS } from "../etiqueta-ficha/franjaBarras";
import { IconoContacto, IconoOrigen, IconoUbicacion } from "../etiqueta-ficha/iconosLineales";
import { normalizarHex, type ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import GaleriaIconosQuimicosModal from "../plantillas-visuales/GaleriaIconosQuimicosModal";
import BarcodeSection from "../etiqueta-30ml/BarcodeSection";
import CampoEtiqueta from "../etiqueta-30ml/CampoEtiqueta";
import { ALTO_FRANJA_5ML } from "../etiqueta-5ml/etiqueta5mlTypes";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import { generarEAN13 } from "../../lib/ean13";
import { CasillaConIcono } from "./CasillasCapsulas";
import { EJEMPLO_CAPSULAS, ICONOS_CAPSULAS, TAM_CAPSULAS } from "./etiquetaCapsulasTypes";

/** Casillas con ícono: la clave con la que se guarda su ícono en
 *  `attribute_icons`. El color de la cápsula usa la de «apariencia». */
type CampoIcono = "composition" | "appearance" | "storage";

/** Panel auxiliar (derecha), cuatro franjas: Color (20 %) · Conservación
 *  (20 %) · timbre en blanco + código de barras (44 %) · pie corporativo
 *  (16 %). Composición, Lote y Vencimiento se quitaron el 2026-09-27
 *  (pedido del usuario); el espacio que dejaron Lote y Vencimiento se unió
 *  a la franja del código de barras, con el timbre a la izquierda. */
export default function PanelAuxiliarCapsulas({
  data,
  editMode,
  attributeIcons,
  onChange,
  onIconChange,
  onElegirCodigo,
}: {
  data: ProductLabelData;
  editMode: boolean;
  attributeIcons: Partial<Record<AttributeKey, string>>;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onIconChange?: (campo: AttributeKey, svgDataUrl: string) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
}) {
  const [iconoAbierto, setIconoAbierto] = useState<CampoIcono | null>(null);
  const editable = editMode && Boolean(onChange);
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;
  const editarIcono = (campo: CampoIcono) => (onIconChange ? () => setIconoAbierto(campo) : undefined);
  // Solo un EAN-13 válido se dibuja: `generarEAN13` comprueba el dígito de control.
  const codigoValido = useMemo(() => Boolean(generarEAN13(data.barcode || "")), [data.barcode]);

  return (
    <section className="ecap-panel ecap-panel-auxiliar" aria-label="Datos del producto">
      {/* Composición se quitó el 2026-09-27 (pedido del usuario): Color pasa a ocupar toda la fila. */}
      <CasillaConIcono
        campo="capsulasColor"
        titulo="COLOR"
        valor={data.capsulasColor || ""}
        ejemplo={EJEMPLO_CAPSULAS.capsulasColor}
        iconoElegido={attributeIcons.appearance}
        iconoPorDefecto={ICONOS_CAPSULAS.appearance}
        editMode={editMode}
        tam={TAM_CAPSULAS.valorCasilla}
        maxLineas={2}
        multilinea
        lineas="e30-linea-inf"
        onChange={cambio("capsulasColor")}
        onEditarIcono={editarIcono("appearance")}
      />

      <CasillaConIcono
        campo="storage"
        titulo="CONSERVACIÓN"
        valor={data.storage || ""}
        ejemplo={EJEMPLO_CAPSULAS.storage}
        iconoElegido={attributeIcons.storage}
        iconoPorDefecto={ICONOS_CAPSULAS.storage}
        editMode={editMode}
        tam={TAM_CAPSULAS.conservacion}
        maxLineas={2}
        multilinea
        lineas="e30-linea-inf"
        onChange={cambio("storage")}
        onEditarIcono={editarIcono("storage")}
      />

      {/* Timbre + código de barras (2026-09-27, pedido del usuario): el timbre es el
          espacio en blanco que dejaron Lote y Vencimiento, unido a esta franja. */}
      <div className="ecap-fila-barras">
        <div className="ecap-timbre" aria-hidden="true">
          TIMBRE
        </div>
        {codigoValido || editable ? (
          <BarcodeSection
            value={data.barcode}
            editMode={editable}
            onChange={(v) => onChange?.({ barcode: v })}
            onElegirCodigo={onElegirCodigo}
            franja={{ alto: ALTO_FRANJA_5ML }}
          />
        ) : (
          <div className="ecap-barras-vacio">
            <span className="ecap-franja-colores" aria-hidden="true">
              {COLORES_FRANJA_BARRAS.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </span>
            <span className="ecap-barras-rotulo">CÓDIGO DE BARRAS</span>
          </div>
        )}
      </div>

      <div className="ecap-pie">
        {[
          { clave: "website" as const, icono: <IconoOrigen /> },
          { clave: "city" as const, icono: <IconoUbicacion /> },
          { clave: "phone" as const, icono: <IconoContacto texto={data.phone || ""} /> },
        ].map(({ clave, icono }) => (
          <div key={clave} className="ecap-pie-dato">
            <span className="ecap-pie-icono" aria-hidden="true">
              {icono}
            </span>
            <CampoEtiqueta
              as="span"
              valor={data[clave] || ""}
              onChange={cambio(clave)}
              editMode={editMode}
              styleKey={`ecap_${clave}`}
              ejemplo={EJEMPLO_CAPSULAS[clave]}
              tam={TAM_CAPSULAS.pie}
              // La web no se parte: un renglón. Ciudad y NIT caben en dos.
              maxLineas={clave === "website" ? 1 : 2}
              multilinea={clave !== "website"}
              oscuro
              className="ecap-pie-texto"
            />
          </div>
        ))}
      </div>

      {onIconChange && (
        <GaleriaIconosQuimicosModal
          abierta={iconoAbierto !== null}
          campo={iconoAbierto}
          colorTinta={normalizarHex(data.accentColor)}
          onCerrar={() => setIconoAbierto(null)}
          onElegir={(svgDataUrl) => {
            if (iconoAbierto) onIconChange(iconoAbierto, svgDataUrl);
            setIconoAbierto(null);
          }}
        />
      )}
    </section>
  );
}
