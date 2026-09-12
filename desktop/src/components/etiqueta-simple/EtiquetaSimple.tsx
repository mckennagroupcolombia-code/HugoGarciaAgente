import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import BuscadorFichaTecnica from "../etiqueta-ficha/BuscadorFichaTecnica";
import { EditableLabel } from "../etiqueta-ficha/EditableField";
import MenuLogoCorporativo from "../etiqueta-ficha/MenuLogoCorporativo";
import { EJEMPLO_ETIQUETA, normalizarHex, type ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import { IconoCorreo, IconoTelefono, IconoUbicacion } from "../etiqueta-ficha/iconosLineales";
import type { IconoKey } from "../etiqueta-ficha/ProductAttributeGrid";
import GaleriaIconosQuimicosModal from "../plantillas-visuales/GaleriaIconosQuimicosModal";
import { IconoCelda } from "../etiqueta-30ml/TechnicalCell";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import CampoEtiqueta from "../etiqueta-30ml/CampoEtiqueta";
import BarcodeSection from "../etiqueta-30ml/BarcodeSection";
import ContactFooter from "../etiqueta-30ml/ContactFooter";
import { GradoInsumo } from "../etiqueta-30ml/CenterProductPanel";
import { PREFIJO_SUBTITULO, textoContenidoNeto } from "../etiqueta-30ml/etiqueta30mlTypes";
import { useAjusteTexto } from "../etiqueta-30ml/useAjusteTexto";
import { GRADO_SIMPLE_POR_DEFECTO, TAM_SIMPLE, variablesSimple, type ReticulaSimple } from "./etiquetaSimpleTypes";
import "../etiqueta-30ml/etiqueta30ml.css";
import "./etiquetaSimple.css";

interface Props {
  data: ProductLabelData;
  reticula: ReticulaSimple;
  /** Edición en el sitio, como las demás etiquetas; en vista, la terminada. */
  editMode: boolean;
  guias?: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
  /** Íconos elegidos en la galería para conservación y alérgenos. */
  attributeIcons?: Partial<Record<IconoKey, string>>;
  onIconChange?: (campo: IconoKey, svgDataUrl: string) => void;
}

/**
 * Etiqueta 69 × 51 mm de diagramación simple (Semillas & Frutos Secos).
 *
 *   ┌───────────────────────┬──────────────┐
 *   │ NOMBRE DEL PRODUCTO   │    LOGO      │
 *   │                       ├──────────────┤  ┐
 *   │                       │ INF. TÉCNICA │  │ banda
 *   │ ███ INSUMO GRADO ███  │ ███ www… ███ │  │ «cabeza»
 *   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┼──────────────┤  ┘  ← guía compartida
 *   │ CONTENIDO NETO: 500 g │  ▌▌▐▌▌▐▐▌▌   │
 *   │ origen · conservación │              │
 *   │ alérgenos             │  ┌────────┐  │  ← timbre
 *   ├───────────────────────┴──────────────┤
 *   │ ubicación · teléfono · correo        │
 *   └──────────────────────────────────────┘
 *
 * La primera fila del panel («cabeza») es común a las dos columnas: las dos
 * barras del acento van pegadas a su borde inferior con el mismo respiro, así
 * terminan en la misma línea mida lo que mida el nombre o el logo.
 *
 * Es el nodo que se rasteriza para el PNG y la impresión (a su tamaño de
 * diseño); quien la muestra la escala desde afuera.
 */
const EtiquetaSimple = forwardRef<HTMLDivElement, Props>(function EtiquetaSimple(
  { data, reticula, editMode, guias, onChange, onElegirCodigo, attributeIcons = {}, onIconChange },
  ref,
) {
  /** La banda del nombre: el nombre se encoge solo si el bloque entero
   *  (nombre y recuadro del grado) no cabe en ella. La fila del nombre mide lo
   *  que su texto, así que medir contra su propia caja siempre daba "no cabe"
   *  (la tinta de las letras sobresale 2 px) y lo dejaba al mínimo. */
  const cabezaRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const [menuLogo, setMenuLogo] = useState(false);
  /** Celda cuyo ícono se está cambiando en la galería (una sola instancia). */
  const [iconoAbierto, setIconoAbierto] = useState<IconoKey | null>(null);
  const editable = editMode && Boolean(onChange);

  // ── El recuadro «INSUMO GRADO …» mide lo mismo que el nombre ─────────────
  // Se mide el renglón más ancho del nombre con una copia invisible del texto
  // (misma letra y mismo ancho de caja, así corta los renglones igual) y el
  // recuadro toma ese ancho. En edición el nombre es un textarea, por eso la
  // copia y no el propio elemento.
  const cajaNombreRef = useRef<HTMLDivElement>(null);
  const espejoRef = useRef<HTMLSpanElement>(null);
  const subtituloRef = useRef<HTMLSpanElement>(null);
  const [anchoNombre, setAnchoNombre] = useState<number | null>(null);
  const textoNombre = (data.productName || "").trim()
    ? data.productName
    : editMode
      ? EJEMPLO_ETIQUETA.productName
      : "";
  useLayoutEffect(() => {
    const caja = cajaNombreRef.current;
    const espejo = espejoRef.current;
    const nombre = caja?.querySelector<HTMLElement>(".es-nombre:not(.es-nombre-copia)");
    if (!caja || !espejo || !nombre) return;
    const medir = () => {
      const cs = getComputedStyle(nombre);
      const envoltura = espejo.parentElement as HTMLElement;
      envoltura.style.width = `${nombre.clientWidth}px`;
      espejo.style.fontSize = cs.fontSize;
      espejo.style.fontFamily = cs.fontFamily;
      // Medidas en px de diseño: el marco escala la etiqueta con transform.
      const escala = caja.getBoundingClientRect().width / (caja.offsetWidth || 1) || 1;
      const ancho = textoNombre.trim() ? Math.ceil(espejo.getBoundingClientRect().width / escala) : 0;
      setAnchoNombre((prev) => (prev === ancho ? prev : ancho));
    };
    medir();
    // El nombre cambia de tamaño de letra al ajustarse, y el ancho del texto
    // al llegar la fuente web: se vuelve a medir en los dos casos.
    const ro = new ResizeObserver(medir);
    ro.observe(nombre);
    const fuentes = typeof document !== "undefined" ? document.fonts : undefined;
    fuentes?.addEventListener("loadingdone", medir);
    return () => {
      ro.disconnect();
      fuentes?.removeEventListener("loadingdone", medir);
    };
  }, [textoNombre, editMode]);
  const grado = data.gradoInsumo || GRADO_SIMPLE_POR_DEFECTO;
  // Si el nombre es corto, el texto del recuadro pasa a dos renglones
  // («INSUMO GRADO / ALIMENTARIO») y se achica lo necesario para caber.
  useAjusteTexto(subtituloRef, `${grado}|${anchoNombre ?? ""}|${editable}`, {
    max: TAM_SIMPLE.subtitulo[0],
    min: TAM_SIMPLE.subtitulo[1],
    maxLineas: 2,
  });
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  return (
    <div
      ref={ref}
      lang="es"
      className={`es-etiqueta${guias ? " es-guias" : ""}${editMode ? " e30-editando" : ""}`}
      style={{ width: reticula.ancho, height: reticula.alto, ...variablesSimple(reticula, data.accentColor) }}
    >
      <section className="es-panel">
        {/* Banda superior · producto: nombre y recuadro del grado */}
        <div ref={cabezaRef} className="es-cabeza es-cabeza-izq">
          {/* Lupa de fichas técnicas: en la esquina de la columna (solo en
              edición), para no correr el nombre y desalinearlo del recuadro. */}
          {editable && onChange && (
            <div className="es-lupa">
              <BuscadorFichaTecnica onAplicar={onChange} consultaInicial={data.barcodeTitle || ""} />
            </div>
          )}
          <div ref={cajaNombreRef} className="es-nombre-caja">
            <CampoEtiqueta
              as="h1"
              valor={data.productName || ""}
              onChange={cambio("productName")}
              editMode={editMode}
              styleKey="es_productName"
              ejemplo={EJEMPLO_ETIQUETA.productName}
              tam={TAM_SIMPLE.nombre}
              maxLineas={3}
              cajaRef={cabezaRef}
              multilinea
              className="es-nombre"
            />
            <div className="es-nombre-espejo" aria-hidden="true">
              <span ref={espejoRef} className="es-nombre es-nombre-copia">
                {textoNombre}
              </span>
            </div>
          </div>
          <p className="es-subtitulo" style={anchoNombre ? { width: anchoNombre } : undefined}>
            <span ref={subtituloRef} className="es-subtitulo-texto">
              {PREFIJO_SUBTITULO}{" "}
              <GradoInsumo
                valor={grado}
                editMode={editable}
                onElegir={(v) => onChange?.({ gradoInsumo: v })}
              />
            </span>
          </p>
        </div>

        {/* Banda superior · marca: logo e información técnica. La barra de la
            web la cierra, a la altura del recuadro del grado. */}
        <div className="es-cabeza es-cabeza-der">
          <div ref={logoRef} className="es-logo">
            <button
              type="button"
              disabled={!editable}
              onClick={() => setMenuLogo((v) => !v)}
              title={editable ? "Elegir logo (carpeta DISEÑO CORPORATIVO)" : undefined}
              className="e30-logo-caja es-logo-caja mck-btn-no-fx"
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
              />
            )}
          </div>
          <div className="es-info">
            <EditableLabel
              texto="Información técnica:"
              editMode={editMode}
              styleKey="es_infoTitulo"
              defaultFontSize={15}
              as="p"
              className="es-info-titulo"
            />
            <CampoEtiqueta
              valor={data.technicalDocuments || ""}
              onChange={cambio("technicalDocuments")}
              editMode={editMode}
              styleKey="es_technicalDocuments"
              ejemplo={EJEMPLO_ETIQUETA.technicalDocuments}
              tam={TAM_SIMPLE.info}
              maxLineas={1}
              className="es-info-docs"
            />
            <EditableLabel
              texto="Disponible en:"
              editMode={editMode}
              styleKey="es_disponibleEn"
              defaultFontSize={14}
              as="p"
              className="es-info-disp"
            />
            <div className="es-web">
              <CampoEtiqueta
                as="span"
                valor={data.website || ""}
                onChange={cambio("website")}
                editMode={editMode}
                styleKey="es_website"
                ejemplo={EJEMPLO_ETIQUETA.website}
                tam={TAM_SIMPLE.info}
                maxLineas={1}
                oscuro
                className="es-web-texto"
              />
            </div>
          </div>
        </div>

        {/* Bajo la guía · producto: contenido neto y datos */}
        <div className="es-cuerpo-izq">
          <div className="es-neto">
            <EditableLabel
              texto="Contenido neto:"
              editMode={editMode}
              styleKey="es_netoTitulo"
              defaultFontSize={17}
              as="p"
              className="es-neto-titulo"
            />
            <CampoEtiqueta
              valor={data.netContent || ""}
              onChange={cambio("netContent")}
              editMode={editMode}
              styleKey="es_netContent"
              ejemplo={EJEMPLO_ETIQUETA.netContent}
              mostrar={textoContenidoNeto}
              tam={TAM_SIMPLE.neto}
              maxLineas={1}
              className="es-neto-valor"
            />
          </div>

          <div className="es-datos">
            <div className="es-dato">
              <button
                type="button"
                className="e30-celda-icono es-dato-icono mck-btn-no-fx"
                disabled={!editable || !onIconChange}
                onClick={() => setIconoAbierto("origin")}
                title={editable ? "Cambiar ícono de origen" : undefined}
              >
                <IconoCelda elegido={attributeIcons.origin} porDefecto="origen_globo_meridianos" />
              </button>
              <div className="es-dato-cuerpo">
                <span className="es-dato-rotulo">ORIGEN:</span>
                <CampoEtiqueta
                  valor={data.origin || ""}
                  onChange={cambio("origin")}
                  editMode={editMode}
                  styleKey="es_origin"
                  ejemplo={EJEMPLO_ETIQUETA.origin}
                  tam={TAM_SIMPLE.dato}
                  maxLineas={1}
                  className="es-dato-texto"
                />
              </div>
            </div>
            <div className="es-dato">
              <button
                type="button"
                className="e30-celda-icono es-dato-icono mck-btn-no-fx"
                disabled={!editable || !onIconChange}
                onClick={() => setIconoAbierto("storage")}
                title={editable ? "Cambiar ícono de conservación" : undefined}
              >
                <IconoCelda elegido={attributeIcons.storage} porDefecto="conservacion_termometro" />
              </button>
              <div className="es-dato-cuerpo">
                <CampoEtiqueta
                  valor={data.storage || ""}
                  onChange={cambio("storage")}
                  editMode={editMode}
                  styleKey="es_storage"
                  ejemplo="Consérvese en lugar fresco y seco."
                  tam={TAM_SIMPLE.dato}
                  maxLineas={2}
                  multilinea
                  className="es-dato-texto"
                />
              </div>
            </div>
            <div className="es-dato">
              <button
                type="button"
                className="e30-celda-icono es-dato-icono mck-btn-no-fx"
                disabled={!editable || !onIconChange}
                onClick={() => setIconoAbierto("alergenos")}
                title={editable ? "Cambiar ícono de alérgenos" : undefined}
              >
                <IconoCelda elegido={attributeIcons.alergenos} porDefecto="seguridad_atencion" />
              </button>
              <div className="es-dato-cuerpo">
                <CampoEtiqueta
                  valor={data.alergenos || ""}
                  onChange={cambio("alergenos")}
                  editMode={editMode}
                  styleKey="es_alergenos"
                  ejemplo={EJEMPLO_ETIQUETA.alergenos}
                  tam={TAM_SIMPLE.dato}
                  maxLineas={2}
                  multilinea
                  className="es-dato-texto es-alergenos"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bajo la guía · marca: código de barras y timbre */}
        <div className="es-cuerpo-der">
          <BarcodeSection
            value={data.barcode}
            editMode={editable}
            onChange={(v) => onChange?.({ barcode: v })}
            onElegirCodigo={onElegirCodigo}
          />
          {/* Espacio reservado para el timbre físico (lote, fecha…): un
              recuadro vacío de 10 mm de alto con borde del acento. */}
          <div className="es-timbre">
            <div className="es-timbre-caja">{editMode && <span className="es-timbre-nota">Timbre</span>}</div>
          </div>
        </div>

        {onIconChange && (
          <GaleriaIconosQuimicosModal
            abierta={iconoAbierto !== null}
            colorTinta={normalizarHex(data.accentColor)}
            onCerrar={() => setIconoAbierto(null)}
            onElegir={(svgDataUrl) => {
              if (iconoAbierto) onIconChange(iconoAbierto, svgDataUrl);
              setIconoAbierto(null);
            }}
          />
        )}

        <ContactFooter
          editMode={editMode}
          tam={TAM_SIMPLE.franja}
          datos={[
            { clave: "city", icono: <IconoUbicacion />, texto: data.city || "", ejemplo: EJEMPLO_ETIQUETA.city, onChange: cambio("city") },
            { clave: "phone", icono: <IconoTelefono />, texto: data.phone || "", ejemplo: EJEMPLO_ETIQUETA.phone, onChange: cambio("phone") },
            { clave: "email", icono: <IconoCorreo />, texto: data.email || "", ejemplo: EJEMPLO_ETIQUETA.email, onChange: cambio("email") },
          ]}
        />
      </section>
    </div>
  );
});

export default EtiquetaSimple;
