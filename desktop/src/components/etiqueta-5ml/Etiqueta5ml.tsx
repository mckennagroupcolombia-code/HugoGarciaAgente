import { forwardRef, useRef, useState } from "react";
import BuscadorFichaTecnica from "../etiqueta-ficha/BuscadorFichaTecnica";
import { EditableLabel } from "../etiqueta-ficha/EditableField";
import GaleriaGhsModal from "../etiqueta-ficha/GaleriaGhsModal";
import MenuLogoCorporativo from "../etiqueta-ficha/MenuLogoCorporativo";
import GaleriaIconosQuimicosModal from "../plantillas-visuales/GaleriaIconosQuimicosModal";
import { IconoContacto, IconoUbicacion } from "../etiqueta-ficha/iconosLineales";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import {
  TITULOS_CAS,
  normalizarHex,
  type ProductLabelData,
} from "../etiqueta-ficha/productLabelTypes";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import BarcodeSection from "../etiqueta-30ml/BarcodeSection";
import CampoEtiqueta from "../etiqueta-30ml/CampoEtiqueta";
import ContactFooter from "../etiqueta-30ml/ContactFooter";
import TechnicalCell from "../etiqueta-30ml/TechnicalCell";
import { GradoInsumo } from "../etiqueta-30ml/CenterProductPanel";
import {
  GRADO_INSUMO_POR_DEFECTO,
  PREFIJO_SUBTITULO,
  TITULOS_FORMULA_30ML,
  esPeligrosoGhs,
  pictogramasGhs,
  textoCirculoGhs,
  textoContenidoNeto,
  tituloFormula30ml,
} from "../etiqueta-30ml/etiqueta30mlTypes";
import {
  ALTO_FRANJA_5ML,
  CELDAS_5ML,
  EJEMPLO_5ML,
  TAM_5ML,
  variables5ml,
  type Reticula5ml,
} from "./etiqueta5mlTypes";
import "../etiqueta-30ml/etiqueta30ml.css";
import "./etiqueta5ml.css";

interface Props {
  data: ProductLabelData;
  reticula: Reticula5ml;
  /** Edición en el sitio (como la ficha de 76 × 66); en vista es la etiqueta
   *  terminada, tal como sale en el PNG y en la impresión. */
  editMode: boolean;
  attributeIcons: Partial<Record<AttributeKey, string>>;
  /** Muestra las pistas de la retícula (líneas punteadas) para verificarla. */
  guias?: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onIconChange?: (campo: AttributeKey, svgDataUrl: string) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
}

/** Etiqueta de 66 × 22 mm a su tamaño de diseño (ANCHO_5ML × el alto del
 *  formato). Es el nodo que se rasteriza para el PNG y la impresión: quien la
 *  muestra la escala desde afuera, nunca por dentro. */
const Etiqueta5ml = forwardRef<HTMLDivElement, Props>(function Etiqueta5ml(
  { data, reticula, editMode, attributeIcons, guias, onChange, onIconChange, onElegirCodigo },
  ref,
) {
  return (
    <div
      ref={ref}
      lang="es"
      className={`e5-etiqueta${guias ? " e30-guias" : ""}${editMode ? " e30-editando" : ""}`}
      style={{ width: reticula.ancho, height: reticula.alto, ...variables5ml(reticula, data.accentColor) }}
    >
      <PanelTecnico
        data={data}
        editMode={editMode}
        onChange={onChange}
        attributeIcons={attributeIcons}
        onIconChange={onIconChange}
      />
      <PanelProducto data={data} editMode={editMode} onChange={onChange} />
      <PanelDocumentacion
        data={data}
        editMode={editMode}
        onChange={onChange}
        onElegirCodigo={onElegirCodigo}
      />
    </div>
  );
});

export default Etiqueta5ml;

/** Panel izquierdo: matriz de 2 × 2 (CSS Grid) y la franja de ubicación +
 *  teléfono. Las líneas son bordes de las celdas: la vertical va en la
 *  columna 1 y la horizontal en la fila 1. Una sola galería de íconos
 *  compartida por las cuatro celdas, como en el 30 mL. */
function PanelTecnico({
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
    <section className="e5-panel e5-panel-izq">
      {CELDAS_5ML.map((c, i) => (
        <TechnicalCell
          key={c.campo}
          campo={c.campo}
          prefijoEstilo="e5"
          tamValor={TAM_5ML.valorCelda}
          tamTitulo={TAM_5ML.tituloCelda}
          titulo={c.campo === "composition" ? tituloFormula30ml(data) : c.titulo}
          {...(c.campo === "composition" && onChange
            ? {
                tituloOpciones: TITULOS_FORMULA_30ML,
                onTituloChange: (v: string) => onChange({ compositionTitulo: v }),
              }
            : {})}
          valor={data[c.campo] || ""}
          ejemplo={EJEMPLO_5ML[c.campo]}
          iconoElegido={attributeIcons[c.campo]}
          iconoPorDefecto={c.icono}
          editMode={editMode}
          lineas={`${i % 2 === 0 ? "e30-linea-der" : ""} ${i < CELDAS_5ML.length - 2 ? "e30-linea-inf" : ""}`}
          onChange={cambio(c.campo)}
          onEditarIcono={onIconChange ? () => setCampoAbierto(c.campo) : undefined}
        />
      ))}
      <ContactFooter
        editMode={editMode}
        prefijoEstilo="e5"
        tam={TAM_5ML.franja}
        datos={[
          { clave: "city", icono: <IconoUbicacion />, texto: data.city || "", ejemplo: EJEMPLO_5ML.city, onChange: cambio("city") },
          { clave: "phone", icono: <IconoContacto texto={data.phone || ""} />, texto: data.phone || "", ejemplo: EJEMPLO_5ML.phone, onChange: cambio("phone") },
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

/** Panel central, de arriba abajo: logo · nombre + subtítulo · contenido
 *  neto. La fila del logo mide lo mismo que una fila del panel izquierdo, así
 *  la línea bajo el logo cae a la misma altura que la de la matriz.
 *
 *  A diferencia del 30 mL, aquí no va la tabla Pureza/CAS: en los 6,4 mm que
 *  quedan entre el logo y el contenido neto solo caben el nombre y el
 *  subtítulo del grado. La tabla se pasó al panel derecho. */
function PanelProducto({
  data,
  editMode,
  onChange,
}: {
  data: ProductLabelData;
  editMode: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
}) {
  const nombreCajaRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const [menuLogo, setMenuLogo] = useState(false);
  const editable = editMode && Boolean(onChange);
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  return (
    <section className="e5-panel e5-panel-centro">
      <div ref={logoRef} className="e30-logo e30-linea-inf">
        <button
          type="button"
          disabled={!editable}
          onClick={() => setMenuLogo((v) => !v)}
          title={editable ? "Elegir logo (carpeta DISEÑO CORPORATIVO)" : undefined}
          className="e30-logo-caja mck-btn-no-fx"
        >
          {data.logoUrl ? (
            <img src={data.logoUrl} alt="Logotipo" />
          ) : editMode ? (
            <span className="e30-logo-vacio">McKenna Group</span>
          ) : null}
        </button>
        {onChange && (
          <MenuLogoCorporativo
            data={data}
            onChange={onChange}
            anchorRef={logoRef}
            abierto={editable && menuLogo}
            onCerrar={() => setMenuLogo(false)}
            alinear="centro"
          />
        )}
      </div>

      <div className="e30-identidad e5-identidad">
        <div ref={nombreCajaRef} className="e30-nombre-caja">
          <CampoEtiqueta
            as="h1"
            valor={data.productName || ""}
            onChange={cambio("productName")}
            editMode={editMode}
            styleKey="e5_productName"
            ejemplo={EJEMPLO_5ML.productName}
            tam={TAM_5ML.nombre}
            maxLineas={2}
            cajaRef={nombreCajaRef}
            multilinea
            className="e30-nombre"
          />
          {editable && onChange && (
            <div className="e30-lupa">
              <BuscadorFichaTecnica onAplicar={onChange} consultaInicial={data.barcodeTitle || ""} />
            </div>
          )}
        </div>
        <p className="e30-subtitulo e5-subtitulo">
          {PREFIJO_SUBTITULO}{" "}
          <GradoInsumo
            valor={data.gradoInsumo || GRADO_INSUMO_POR_DEFECTO}
            editMode={editable}
            onElegir={(v) => onChange?.({ gradoInsumo: v })}
          />
        </p>
      </div>

      <div className="e30-neto e5-neto e30-linea-sup">
        <EditableLabel
          texto="Contenido neto:"
          editMode={editMode}
          styleKey="e5_netoTitulo"
          defaultFontSize={TAM_5ML.tituloNeto}
          as="p"
          className="e30-neto-titulo"
        />
        <CampoEtiqueta
          valor={data.netContent || ""}
          onChange={cambio("netContent")}
          editMode={editMode}
          styleKey="e5_netContent"
          ejemplo={EJEMPLO_5ML.netContent}
          mostrar={textoContenidoNeto}
          tam={TAM_5ML.neto}
          maxLineas={1}
          className="e30-neto-valor"
        />
      </div>
    </section>
  );
}

/** Panel derecho: pictograma GHS + tabla Pureza/CAS · código de barras ·
 *  franja con la dirección web. Mismas 2 filas + franja que el panel
 *  izquierdo: sus líneas horizontales caen exactamente a la misma altura.
 *
 *  El código ocupa la fila entera —sin el hueco del timbre que sí lleva el
 *  30 mL—: es lo único que le da algo de ancho a los 21 mm del panel. Aun
 *  así queda por debajo de la magnificación que pide GS1, así que hay que
 *  probarlo con el escáner antes de mandar a imprimir.
 *
 *  En edición: el pictograma GHS abre la galería y el código, el buscador de
 *  SKU, como en la ficha de 76 × 66. */
function PanelDocumentacion({
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
  const [ghsAbierto, setGhsAbierto] = useState(false);
  const editable = editMode && Boolean(onChange);
  const peligroso = esPeligrosoGhs(data.ghs);
  const pictogramas = peligroso ? pictogramasGhs(data) : [];
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  return (
    <section className="e5-panel e5-panel-der">
      <div className="e5-ficha e30-linea-inf">
        <div className="e5-ghs">
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
                  styleKey="e5_ghs"
                  tam={TAM_5ML.tabla}
                  maxLineas={2}
                  className="e30-ghs-texto"
                />
              </span>
            )}
          </button>
        </div>
        <div className="e30-tabla e5-tabla">
          <div className="e30-tabla-campo e30-tabla-fila1">
            <EditableLabel
              texto="PUREZA:"
              editMode={editMode}
              styleKey="e5_concentrationTitulo"
              defaultFontSize={TAM_5ML.tituloTabla}
            />
          </div>
          <div className="e30-tabla-valor e30-tabla-fila1">
            <CampoEtiqueta
              as="span"
              valor={data.concentration || ""}
              onChange={cambio("concentration")}
              editMode={editMode}
              styleKey="e5_concentration"
              ejemplo={EJEMPLO_5ML.concentration}
              tam={TAM_5ML.tabla}
              maxLineas={1}
            />
          </div>
          <div className="e30-tabla-campo">
            <EditableLabel
              texto={`${data.casTitulo || TITULOS_CAS[0]}:`}
              editMode={editMode}
              styleKey="e5_casTitulo"
              defaultFontSize={TAM_5ML.tituloTabla}
              opciones={TITULOS_CAS}
              valorOpcion={data.casTitulo || TITULOS_CAS[0]}
              onElegirOpcion={(v) => onChange?.({ casTitulo: v })}
            />
          </div>
          <div className="e30-tabla-valor">
            <CampoEtiqueta
              as="span"
              valor={data.cas || ""}
              onChange={cambio("cas")}
              editMode={editMode}
              styleKey="e5_cas"
              ejemplo={EJEMPLO_5ML.cas}
              tam={TAM_5ML.tabla}
              maxLineas={1}
            />
          </div>
        </div>
      </div>

      <BarcodeSection
        value={data.barcode}
        editMode={editable}
        onChange={(v) => onChange?.({ barcode: v })}
        onElegirCodigo={onElegirCodigo}
        franja={{ alto: ALTO_FRANJA_5ML }}
      />

      <ContactFooter
        editMode={editMode}
        prefijoEstilo="e5"
        tam={TAM_5ML.web}
        datos={[
          {
            clave: "website",
            icono: null,
            texto: data.website || "",
            ejemplo: EJEMPLO_5ML.website,
            onChange: cambio("website"),
          },
        ]}
      />

      {onChange && (
        <GaleriaGhsModal
          abierta={ghsAbierto}
          codigoActual={data.ghs}
          circuloNoGhs
          onCerrar={() => setGhsAbierto(false)}
          onElegir={(svgDataUrl, codigo) => onChange({ ghs: codigo, ghsIconSvg: svgDataUrl })}
        />
      )}
    </section>
  );
}
