import { forwardRef, useRef, useState, type CSSProperties } from "react";
import BuscadorFichaTecnica from "../etiqueta-ficha/BuscadorFichaTecnica";
import { EditableLabel } from "../etiqueta-ficha/EditableField";
import GaleriaGhsModal from "../etiqueta-ficha/GaleriaGhsModal";
import MenuLogoCorporativo from "../etiqueta-ficha/MenuLogoCorporativo";
import { IconoCorreo, IconoContacto, IconoUbicacion } from "../etiqueta-ficha/iconosLineales";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import { useTextStyleCtx } from "../etiqueta-ficha/TextStyleContext";
import {
  EJEMPLO_ETIQUETA,
  TITULOS_CAS,
  TITULOS_CUCHARA,
  TITULOS_GRADO,
  tituloGrado,
  UNIDADES_CUCHARA,
  normalizarHex,
  type ProductLabelData,
} from "../etiqueta-ficha/productLabelTypes";
import GaleriaIconosQuimicosModal from "../plantillas-visuales/GaleriaIconosQuimicosModal";
import BarcodeSection from "../etiqueta-30ml/BarcodeSection";
import CampoEtiqueta from "../etiqueta-30ml/CampoEtiqueta";
import ContactFooter from "../etiqueta-30ml/ContactFooter";
import LemaLogo from "../etiqueta-30ml/LemaLogo";
import TechnicalCell from "../etiqueta-30ml/TechnicalCell";
import {
  TAM_30ML,
  TITULOS_FORMULA_30ML,
  esPeligrosoGhs,
  pictogramasGhs,
  textoCirculoGhs,
  textoContenidoNeto,
  tituloFormula30ml,
} from "../etiqueta-30ml/etiqueta30mlTypes";
import { ALTO_FRANJA_SIMPLE } from "../etiqueta-simple/etiquetaSimpleTypes";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import {
  BANDA_ADITIVOS_POR_DEFECTO,
  CELDAS_ADITIVOS,
  TAM_ADITIVOS,
  variablesAditivos,
  type ReticulaAditivos,
} from "./etiquetaAditivosTypes";
import "../etiqueta-30ml/etiqueta30ml.css";
import "../etiqueta-simple/etiquetaSimple.css";
import "./etiquetaAditivos.css";

interface Props {
  data: ProductLabelData;
  reticula: ReticulaAditivos;
  /** Edición en el sitio, como las demás etiquetas; en vista, la terminada. */
  editMode: boolean;
  guias?: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
  attributeIcons?: Partial<Record<AttributeKey, string>>;
  onIconChange?: (campo: AttributeKey, svgDataUrl: string) => void;
}

/**
 * Etiqueta 69 × 51 mm de Aditivos alimentarios.
 *
 *   ┌──────────────────────────────┬──────────────────┐
 *   │          ALULOSA             │   LOGO + lema    │
 *   │ ███ MATERIA PRIMA GRADO … ███├──────────────────┤
 *   ├──────────────┬───────────────┤   ◇ NO GHS       │
 *   │ ORIGEN       │ APARIENCIA    ├──────────────────┤
 *   ├──────────────┼───────────────┤ Información téc. │
 *   │ AROMA        │ FÓRMULA MOL.  │ ███ www… ███     │
 *   ├──────────────┼───────────────┤ PUREZA │ 99 %    │
 *   │ GRADO        │ CONSERVACIÓN  │ CAS    │ …       │
 *   ├──────────────┴───────────────┤ [cuchara 5 g]    │
 *   │ CONTENIDO NETO · 250 g       │ ▌▌▐▌▌▐▐▌▌        │
 *   ├──────────────────────────────┴──────────────────┤
 *   │ ubicación │ NIT │ correo                        │
 *   └─────────────────────────────────────────────────┘
 *
 * Todo es CSS Grid con pistas `minmax(0, …)`: el contenido no mueve las
 * líneas; el texto se parte en renglones y, si aún no cabe, se encoge
 * (`useAjusteTexto`). Es el nodo que se rasteriza para el PNG y la impresión
 * (a su tamaño de diseño); quien la muestra la escala desde afuera.
 */
const EtiquetaAditivos = forwardRef<HTMLDivElement, Props>(function EtiquetaAditivos(
  { data, reticula, editMode, guias, onChange, onElegirCodigo, attributeIcons = {}, onIconChange },
  ref,
) {
  const cabezaRef = useRef<HTMLDivElement>(null);
  const netoRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const [menuLogo, setMenuLogo] = useState(false);
  const [ghsAbierto, setGhsAbierto] = useState(false);
  const [iconoAbierto, setIconoAbierto] = useState<AttributeKey | null>(null);
  const editable = editMode && Boolean(onChange);
  const { estilos } = useTextStyleCtx();
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  // Grado alimentos: la banda ya dice el grado, así que la casilla muestra el
  // sabor (se puede volver a «Grado» desde el menú del título).
  const tituloCeldaGrado = tituloGrado(data, true);
  const conSabor = tituloCeldaGrado === TITULOS_GRADO[1];

  const peligroso = esPeligrosoGhs(data.ghs);
  const pictogramas = peligroso ? pictogramasGhs(data) : [];

  // Pureza / CAS: en vista una fila sin dato no se dibuja (una casilla en
  // blanco parece un error de impresión); sin ninguna, la tabla desaparece.
  const rotuloCas = data.casTitulo || TITULOS_CAS[0];
  const filasTabla = [
    { clave: "concentration" as const, titulo: "PUREZA:", valor: data.concentration || "" },
    { clave: "cas" as const, titulo: `${rotuloCas}:`, valor: data.cas || "" },
  ].filter((f) => editMode || f.valor.trim());

  // Cuchara: sin cantidad no se imprime; en edición se ve para poder llenarla.
  const cantidadCuchara = (data.cucharaCantidad || "").trim();
  const unidadCuchara = data.cucharaUnidad || UNIDADES_CUCHARA[0];
  const rotuloCuchara =
    data.cucharaUtensilio && (TITULOS_CUCHARA as readonly string[]).includes(data.cucharaUtensilio)
      ? data.cucharaUtensilio
      : TITULOS_CUCHARA[0];
  const conCuchara = !data.sinCuchara;
  const verCuchara = conCuchara && (editMode || Boolean(cantidadCuchara));
  const nMedios = 1 + (filasTabla.length > 0 ? 1 : 0) + (verCuchara || (editable && !conCuchara) ? 1 : 0);
  const tamUnidad = estilos.ead_cucharaCantidad?.fontSize ?? TAM_ADITIVOS.cucharaCantidad[0];

  return (
    <div
      ref={ref}
      lang="es"
      className={`es-etiqueta ead-etiqueta${guias ? " ead-guias" : ""}${editMode ? " e30-editando" : ""}`}
      style={{ width: reticula.ancho, height: reticula.alto, ...variablesAditivos(reticula, data.accentColor) }}
    >
      {/* ── Panel izquierdo (60 %): producto ─────────────────────────────── */}
      <section className="ead-panel ead-panel-izq">
        <div ref={cabezaRef} className="ead-cabeza">
          {editable && onChange && (
            <div className="ead-lupa">
              <BuscadorFichaTecnica onAplicar={onChange} consultaInicial={data.barcodeTitle || ""} />
            </div>
          )}
          <div className="ead-nombre-caja">
            <CampoEtiqueta
              as="h1"
              valor={data.productName || ""}
              onChange={cambio("productName")}
              editMode={editMode}
              styleKey="ead_productName"
              ejemplo="ALULOSA"
              tam={TAM_ADITIVOS.nombre}
              maxLineas={2}
              cajaRef={cabezaRef}
              multilinea
              className="ead-nombre"
            />
          </div>
          <div className="ead-banda">
            <CampoEtiqueta
              as="span"
              valor={data.classification || (editable ? "" : BANDA_ADITIVOS_POR_DEFECTO)}
              onChange={cambio("classification")}
              editMode={editMode}
              styleKey="ead_classification"
              ejemplo={BANDA_ADITIVOS_POR_DEFECTO}
              tam={TAM_ADITIVOS.banda}
              maxLineas={1}
              oscuro
              className="ead-banda-texto"
            />
          </div>
        </div>

        <div className="ead-matriz">
          {CELDAS_ADITIVOS.map((c, i) => {
            // La casilla de Grado guarda el sabor en su propio campo e ícono;
            // `c.campo` sigue siendo la clave de tamaños (es la misma casilla).
            const dato: AttributeKey = c.campo === "grade" && conSabor ? "sabor" : c.campo;
            return (
              <TechnicalCell
                key={c.campo}
                campo={c.campo}
                titulo={
                  c.campo === "composition" ? tituloFormula30ml(data) : c.campo === "grade" ? tituloCeldaGrado : c.titulo
                }
                {...(c.campo === "composition" && onChange
                  ? {
                      tituloOpciones: TITULOS_FORMULA_30ML,
                      onTituloChange: (v: string) => onChange({ compositionTitulo: v }),
                    }
                  : c.campo === "grade" && onChange
                    ? {
                        tituloOpciones: TITULOS_GRADO,
                        onTituloChange: (v: string) => onChange({ gradeTitulo: v }),
                      }
                    : {})}
                valor={data[dato] || ""}
                ejemplo={(c.campo === "storage" && data.storageSugerido) || (dato === "sabor" ? "Muy dulce" : c.ejemplo)}
                iconoElegido={attributeIcons[dato]}
                iconoPorDefecto={dato === "sabor" ? "sabor_lengua" : c.icono}
                editMode={editMode}
                lineas={`${i % 2 === 0 ? "e30-linea-der" : ""} ${i < CELDAS_ADITIVOS.length - 2 ? "e30-linea-inf" : ""}`}
                onChange={cambio(dato)}
                onEditarIcono={onIconChange ? () => setIconoAbierto(dato) : undefined}
                prefijoEstilo="ead"
                tamValor={TAM_ADITIVOS.valorCelda}
                tamTitulo={TAM_ADITIVOS.tituloCelda}
              />
            );
          })}
        </div>

        <div className="ead-neto-fila">
        <div ref={netoRef} className="ead-neto">
          <EditableLabel
            texto="CONTENIDO NETO"
            editMode={editMode}
            styleKey="ead_netoTitulo"
            defaultFontSize={TAM_ADITIVOS.netoTitulo}
            as="p"
            className="ead-neto-titulo"
          />
          <CampoEtiqueta
            valor={data.netContent || ""}
            onChange={cambio("netContent")}
            editMode={editMode}
            styleKey="ead_netContent"
            ejemplo="250 g"
            mostrar={textoContenidoNeto}
            tam={TAM_ADITIVOS.neto}
            maxLineas={1}
            cajaRef={netoRef}
            className="ead-neto-valor"
          />
        </div>
        {/* Recuadro en blanco para el timbre (lote / vencimiento). */}
        <div className="ead-timbre" aria-label="Espacio para timbre" />
        </div>
      </section>

      {/* ── Panel derecho (40 %): marca e información técnica ────────────── */}
      <section
        className="ead-panel ead-panel-der"
        style={{ "--ead-medios": nMedios } as CSSProperties}
      >
        <div ref={logoRef} className="ead-logo">
          <button
            type="button"
            disabled={!editable}
            onClick={() => setMenuLogo((v) => !v)}
            title={editable ? "Elegir logo (carpeta DISEÑO CORPORATIVO)" : undefined}
            className="e30-logo-caja ead-logo-caja mck-btn-no-fx"
          >
            {data.logoUrl ? (
              <img src={data.logoUrl} alt="Logotipo" />
            ) : editMode ? (
              <span className="e30-logo-vacio">McKenna Group</span>
            ) : null}
          </button>
          <LemaLogo logoRef={logoRef} logoUrl={data.logoUrl} className="ead-lema" />
          {onChange && (
            <MenuLogoCorporativo
              data={data}
              onChange={onChange}
              anchorRef={logoRef}
              abierto={editable && menuLogo}
              onCerrar={() => setMenuLogo(false)}
            />
          )}
        </div>

        <div className="ead-clasif">
          <button
            type="button"
            disabled={!editable}
            onClick={() => setGhsAbierto(true)}
            title={editable ? "Cambiar pictograma GHS" : undefined}
            className="e30-ghs-boton ead-ghs-boton mck-btn-no-fx"
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
                  styleKey="ead_ghs"
                  tam={TAM_30ML.ghs}
                  maxLineas={2}
                  className="e30-ghs-texto"
                />
              </span>
            )}
          </button>
        </div>

        <div className="ead-info">
          <EditableLabel
            texto="Información técnica:"
            editMode={editMode}
            styleKey="ead_infoTitulo"
            defaultFontSize={15}
            as="p"
            className="ead-info-titulo"
          />
          <CampoEtiqueta
            valor={data.technicalDocuments || ""}
            onChange={cambio("technicalDocuments")}
            editMode={editMode}
            styleKey="ead_technicalDocuments"
            ejemplo="TDS - COA - SDS"
            tam={TAM_ADITIVOS.info}
            maxLineas={1}
            className="ead-info-docs"
          />
          <EditableLabel
            texto="Disponible en:"
            editMode={editMode}
            styleKey="ead_disponibleEn"
            defaultFontSize={14}
            as="p"
            className="ead-info-disp"
          />
          <div className="ead-web">
            <CampoEtiqueta
              as="span"
              valor={data.website || ""}
              onChange={cambio("website")}
              editMode={editMode}
              styleKey="ead_website"
              ejemplo={EJEMPLO_ETIQUETA.website}
              tam={TAM_ADITIVOS.info}
              maxLineas={1}
              oscuro
              className="ead-web-texto"
            />
          </div>
        </div>

        {filasTabla.length > 0 && (
          <div className="ead-tabla">
            {filasTabla.map((f) => (
              <div key={f.clave} className="ead-tabla-fila">
                <div className="ead-tabla-titulo">
                  <EditableLabel
                    texto={f.titulo}
                    editMode={editMode}
                    styleKey={`ead_${f.clave}Titulo`}
                    defaultFontSize={TAM_ADITIVOS.tabla[0]}
                    as="p"
                    {...(f.clave === "cas" && onChange
                      ? {
                          opciones: TITULOS_CAS,
                          valorOpcion: rotuloCas,
                          onElegirOpcion: (v: string) => onChange({ casTitulo: v }),
                        }
                      : {})}
                  />
                </div>
                <div className="ead-tabla-valor">
                  <CampoEtiqueta
                    valor={f.valor}
                    onChange={cambio(f.clave)}
                    editMode={editMode}
                    styleKey={`ead_${f.clave}`}
                    ejemplo={f.clave === "cas" ? "551-68-8" : "99%"}
                    tam={TAM_ADITIVOS.tabla}
                    maxLineas={1}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {editable && !conCuchara && (
          <button
            type="button"
            className="ead-cuchara-activar"
            title="Volver a mostrar la cuchara o copa"
            onClick={() => onChange?.({ sinCuchara: false })}
          >
            + Cuchara o copa
          </button>
        )}
        {verCuchara && (
          <div className="ead-cuchara">
            {editable && (
              <button
                type="button"
                className="ead-cuchara-quitar"
                title="Quitar la cuchara o copa de esta etiqueta"
                onClick={() => onChange?.({ sinCuchara: true })}
              >
                ×
              </button>
            )}
            <EditableLabel
              texto={rotuloCuchara}
              editMode={editMode}
              styleKey="ead_cucharaTitulo"
              defaultFontSize={TAM_ADITIVOS.cuchara[0]}
              as="p"
              className="ead-cuchara-titulo"
              opciones={onChange ? TITULOS_CUCHARA : undefined}
              valorOpcion={rotuloCuchara}
              onElegirOpcion={(v) => onChange?.({ cucharaUtensilio: v })}
            />
            <div className="ead-cuchara-medida">
              <span className="ead-cuchara-cantidad">
                <CampoEtiqueta
                  as="span"
                  valor={data.cucharaCantidad || ""}
                  onChange={cambio("cucharaCantidad")}
                  editMode={editMode}
                  styleKey="ead_cucharaCantidad"
                  ejemplo="5"
                  tam={TAM_ADITIVOS.cucharaCantidad}
                  maxLineas={1}
                />
              </span>
              {/* La unidad se ve al tamaño de la cantidad; el menú, invisible
                  encima y con letra chica (`mck-field-lg`: fuera del
                  font-size !important de los select del panel). */}
              <span className="ead-cuchara-unidad" style={{ fontSize: tamUnidad }}>
                {unidadCuchara}
                {editable && (
                  <select
                    value={unidadCuchara}
                    onChange={(e) => onChange?.({ cucharaUnidad: e.target.value })}
                    title="Unidad de la medida"
                    style={{ fontSize: 14 }}
                    className="mck-field-lg ead-cuchara-select"
                  >
                    {UNIDADES_CUCHARA.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                )}
              </span>
              <span className="ead-cuchara-aprox" style={{ fontSize: tamUnidad }}>aprox.</span>
            </div>
          </div>
        )}

        <div className="ead-barras">
          <BarcodeSection
            value={data.barcode}
            editMode={editable}
            franja={{ alto: ALTO_FRANJA_SIMPLE }}
            onChange={(v) => onChange?.({ barcode: v })}
            onElegirCodigo={onElegirCodigo}
          />
        </div>
      </section>

      {/* ── Franja de contacto, a todo el ancho ──────────────────────────── */}
      <ContactFooter
        editMode={editMode}
        tam={TAM_ADITIVOS.franja}
        prefijoEstilo="ead"
        datos={[
          { clave: "city", icono: <IconoUbicacion />, texto: data.city || "", ejemplo: "Bogotá · Colombia", onChange: cambio("city") },
          { clave: "phone", icono: <IconoContacto texto={data.phone || ""} />, texto: data.phone || "", ejemplo: "NIT: 901310616-3", onChange: cambio("phone") },
          { clave: "email", icono: <IconoCorreo />, texto: data.email || "", ejemplo: EJEMPLO_ETIQUETA.email, onChange: cambio("email") },
        ]}
      />

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
      {onChange && (
        <GaleriaGhsModal
          abierta={ghsAbierto}
          codigoActual={data.ghs}
          circuloNoGhs
          onCerrar={() => setGhsAbierto(false)}
          onElegir={(svgDataUrl, codigo) => onChange({ ghs: codigo, ghsIconSvg: svgDataUrl })}
        />
      )}
    </div>
  );
});

export default EtiquetaAditivos;
