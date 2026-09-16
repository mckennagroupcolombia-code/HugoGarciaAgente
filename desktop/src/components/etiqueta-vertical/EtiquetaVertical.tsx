/**
 * Etiqueta 38 × 102 mm vertical. Siete bloques apilados cuyas alturas salen
 * de la retícula (mm exactos convertidos a px de diseño), así que la suma es
 * siempre el alto de la etiqueta: nada se estira ni se recorta. Dentro de
 * cada bloque el texto se encoge para caber (`CampoEtiqueta`), que la
 * retícula no se mueve.
 *
 * Se edita en el sitio, como los demás formatos: clic en el texto para
 * escribir, en el ícono para abrir la galería y en el código para buscar el
 * SKU. Es el nodo que se rasteriza para el PNG y la impresión, a su tamaño
 * de diseño; quien la muestra la escala desde afuera.
 */
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { EditableLabel } from "../etiqueta-ficha/EditableField";
import MenuLogoCorporativo from "../etiqueta-ficha/MenuLogoCorporativo";
import { variablesAcento, type ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import { ESLOGAN } from "../etiqueta-ficha/ProductHeader";
import BarcodeBlock from "../etiqueta-ficha/BarcodeBlock";
import type { IconoKey } from "../etiqueta-ficha/ProductAttributeGrid";
import GaleriaIconosQuimicosModal from "../plantillas-visuales/GaleriaIconosQuimicosModal";
import { IconoCelda } from "../etiqueta-30ml/TechnicalCell";
import CampoEtiqueta from "../etiqueta-30ml/CampoEtiqueta";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import {
  AZUL_VERTICAL,
  EJEMPLO_VERTICAL,
  ICONOS_VERTICAL,
  type ReticulaVertical,
} from "./etiquetaVerticalTypes";
import "../etiqueta-30ml/etiqueta30ml.css";
import "./etiquetaVertical.css";

/* ── Íconos que no existen en la galería, dibujados aquí ───────────────── */
const TRAZO = { fill: "none", stroke: "currentColor", strokeWidth: 5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function IconoGota({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path d="M32 7c9 11 15 19 15 27a15 15 0 0 1-30 0c0-8 6-16 15-27Z" {...TRAZO} />
    </svg>
  );
}

function IconoCopoNieve({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <g {...TRAZO}>
        <path d="M32 6v52M10 19l44 26M54 19L10 45" />
        <path d="M32 15l-6-5m6 5 6-5M32 49l-6 5m6-5 6 5" />
        <path d="M17 26l-8-1m8 1-1-8M47 38l8 1m-8-1 1 8" />
        <path d="M17 38l-1 8m1-8-8 1M47 26l1-8m-1 8 8-1" />
      </g>
    </svg>
  );
}

function IconoRostroHoja({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <g {...TRAZO}>
        <path d="M45 13a24 24 0 1 0 7 17" />
        <path d="M24 28h.02M38 28h.02" />
        <path d="M24 40a11 11 0 0 0 14 0" />
        <path d="M55 8c1 9-3 15-11 16 0-9 4-14 11-16Z" />
      </g>
    </svg>
  );
}

function IconoUbicacionPie({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <g {...TRAZO}>
        <path d="M32 58s18-18 18-32a18 18 0 1 0-36 0c0 14 18 32 18 32Z" />
        <circle cx="32" cy="25" r="7" />
      </g>
    </svg>
  );
}

function IconoGlobo({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <g {...TRAZO}>
        <circle cx="32" cy="32" r="25" />
        <path d="M7 32h50M32 7c7 8 10 16 10 25s-3 17-10 25c-7-8-10-16-10-25s3-17 10-25Z" />
      </g>
    </svg>
  );
}

const ICONOS_BENEFICIO = [IconoGota, IconoCopoNieve, IconoRostroHoja] as const;

interface Props {
  data: ProductLabelData;
  reticula: ReticulaVertical;
  editMode: boolean;
  guias?: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
  attributeIcons?: Partial<Record<IconoKey, string>>;
  onIconChange?: (campo: IconoKey, svgDataUrl: string) => void;
}

/** Tamaños [máximo, mínimo] en px de diseño de cada casilla. */
const TAM = {
  nombre: [37, 24] as const,
  grado: [22, 15] as const,
  titulo: [19, 14] as const,
  valor: [17, 12] as const,
  beneficio: [16, 11] as const,
  netoTitulo: [18, 13] as const,
  netoValor: [42, 26] as const,
  lema: [15, 11] as const,
  pie: [16, 11] as const,
};

const EtiquetaVertical = forwardRef<HTMLDivElement, Props>(function EtiquetaVertical(
  { data, reticula, editMode, guias, onChange, onElegirCodigo, attributeIcons = {}, onIconChange },
  ref,
) {
  const [iconoAbierto, setIconoAbierto] = useState<IconoKey | null>(null);
  const [menuLogo, setMenuLogo] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);

  // ── El lema mide exactamente lo que el logo ───────────────────────────
  // Se mide el texto una sola vez a un tamaño de referencia con una copia
  // invisible (`espejoLema`) y de ahí sale la regla de tres. Medir el propio
  // lema no serviría: cambiarle el tamaño cambiaría la medida y el cálculo
  // oscilaría. Sin logo cargado, el lema vuelve a su tamaño por defecto.
  const TAM_ESPEJO = 100;
  const espejoLema = useRef<HTMLSpanElement>(null);
  const [tamLema, setTamLema] = useState<number>(TAM.lema[0]);
  useLayoutEffect(() => {
    const caja = logoRef.current;
    const img = caja?.querySelector("img");
    const espejo = espejoLema.current;
    if (!caja || !img || !espejo) {
      setTamLema(TAM.lema[0]);
      return;
    }
    const medir = () => {
      const anchoLogo = img.getBoundingClientRect().width;
      const anchoTexto = espejo.getBoundingClientRect().width;
      if (!anchoLogo || !anchoTexto) return;
      setTamLema((TAM_ESPEJO * anchoLogo) / anchoTexto);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(img);
    ro.observe(espejo);
    return () => ro.disconnect();
  }, [data.logoUrl, data.logoScale, reticula.ancho, reticula.bloques.marca]);
  const editable = editMode && Boolean(onChange);
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  const { bloques, linea } = reticula;
  const ladoIcono = Math.round(reticula.pxPorMm * 3.6);

  const casilla = (
    campo: "appearance" | "odor" | "composition" | "storage",
    titulo: string,
  ) => (
    <div className="ev-col" style={{ borderLeftWidth: linea }}>
      <span
        className="ev-icono"
        style={{ width: ladoIcono, height: ladoIcono, cursor: editable && onIconChange ? "pointer" : undefined }}
        onClick={editable && onIconChange ? () => setIconoAbierto(campo) : undefined}
      >
        <IconoCelda elegido={attributeIcons[campo]} porDefecto={ICONOS_VERTICAL[campo]} />
      </span>
      <EditableLabel
        texto={titulo}
        editMode={editMode}
        styleKey={`ev-titulo-${campo}`}
        defaultFontSize={TAM.titulo[0]}
        className="ev-titulo"
      />
      <div className="ev-valor">
        <CampoEtiqueta
          valor={data[campo] || ""}
          onChange={cambio(campo)}
          editMode={editMode}
          styleKey={`ev-valor-${campo}`}
          tam={TAM.valor}
          maxLineas={4}
          multilinea
          ejemplo={EJEMPLO_VERTICAL[campo]}
          className="ev-valor-texto"
        />
      </div>
    </div>
  );

  return (
    <div
      ref={ref}
      // `e30-editando` marca en rojo el texto que no cabe: lo usan todos los
      // formatos que comparten `CampoEtiqueta`, y este se lo estaba perdiendo.
      className={`ev-etiqueta ${guias ? "ev-guias" : ""}${editMode ? " e30-editando" : ""}`}
      style={{
        // El color lo pone el acento de la plantilla (el que se escoge con el
        // logo); `AZUL_VERTICAL` solo entra si la plantilla no trae ninguno.
        ...variablesAcento(data.accentColor || AZUL_VERTICAL),
        width: reticula.ancho,
        height: reticula.alto,
        ["--ev-linea" as string]: `${linea}px`,
      }}
    >
      {/* 1. Cabecera */}
      <div className="ev-bloque ev-cabecera" style={{ height: bloques.cabecera }}>
        <CampoEtiqueta
          valor={data.productName || ""}
          onChange={cambio("productName")}
          editMode={editMode}
          styleKey="ev-nombre"
          tam={TAM.nombre}
          maxLineas={1}
          ejemplo={EJEMPLO_VERTICAL.productName}
          className="ev-nombre"
        />
        <div className="ev-grado">
          <CampoEtiqueta
            valor={data.gradoInsumo ? `GRADO ${data.gradoInsumo}` : ""}
            onChange={onChange ? (v) => onChange({ gradoInsumo: v.replace(/^\s*GRADO\s+/i, "") }) : undefined}
            editMode={editMode}
            styleKey="ev-grado"
            tam={TAM.grado}
            maxLineas={1}
            ejemplo={`GRADO ${EJEMPLO_VERTICAL.gradoInsumo}`}
            oscuro
            className="ev-grado-texto"
          />
        </div>
      </div>

      {/* 2. Apariencia · Aroma */}
      <div className="ev-bloque ev-fila" style={{ height: bloques.filaUno }}>
        {casilla("appearance", "Apariencia")}
        {casilla("odor", "Aroma")}
      </div>

      {/* 3. Composición · Conservación */}
      <div className="ev-bloque ev-fila" style={{ height: bloques.filaDos }}>
        {casilla("composition", "Composición")}
        {casilla("storage", "Conservación")}
      </div>

      {/* 4. Beneficios */}
      <div className="ev-bloque ev-beneficios" style={{ height: bloques.beneficios }}>
        <EditableLabel
          texto="Beneficios"
          editMode={editMode}
          styleKey="ev-beneficios-titulo"
          defaultFontSize={TAM.titulo[0]}
          className="ev-beneficios-titulo"
          as="div"
        />
        <div className="ev-beneficios-cols">
          {([1, 2, 3] as const).map((n) => {
            const Icono = ICONOS_BENEFICIO[n - 1];
            const campo = `beneficio${n}` as "beneficio1" | "beneficio2" | "beneficio3";
            return (
              <div key={n} className="ev-beneficio" style={{ borderLeftWidth: linea }}>
                <span className="ev-icono" style={{ width: ladoIcono, height: ladoIcono }}>
                  <Icono size={ladoIcono} />
                </span>
                <CampoEtiqueta
                  valor={data[campo] || ""}
                  onChange={cambio(campo)}
                  editMode={editMode}
                  styleKey={`ev-${campo}`}
                  tam={TAM.beneficio}
                  maxLineas={3}
                  multilinea
                  ejemplo={EJEMPLO_VERTICAL[campo]}
                  className="ev-beneficio-texto"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Contenido neto */}
      <div className="ev-bloque ev-neto" style={{ height: bloques.neto }}>
        <EditableLabel
          texto="Contenido neto"
          editMode={editMode}
          styleKey="ev-neto-titulo"
          defaultFontSize={TAM.netoTitulo[0]}
          className="ev-neto-titulo"
        />
        <CampoEtiqueta
          valor={data.netContent || ""}
          onChange={cambio("netContent")}
          editMode={editMode}
          styleKey="ev-neto-valor"
          tam={TAM.netoValor}
          maxLineas={1}
          ejemplo={EJEMPLO_VERTICAL.netContent}
          className="ev-neto-valor"
        />
      </div>

      {/* 6. Logo, lema y código de barras — el código SIEMPRE debajo */}
      <div className="ev-bloque ev-marca" style={{ height: bloques.marca }}>
        <div
          ref={logoRef}
          className="ev-logo"
          style={{ height: Math.round(bloques.marca * 0.3), cursor: editable ? "pointer" : undefined }}
          onClick={editable ? () => setMenuLogo(true) : undefined}
        >
          {data.logoUrl ? (
            <img src={data.logoUrl} alt={data.logoNombre || "Logo"} />
          ) : editMode ? (
            <span className="ev-lema ev-ejemplo">Logo</span>
          ) : null}
        </div>
        {/* El lema es el mismo de la casa (constante, como en ProductHeader):
            no es un dato de producto, así que no se edita, solo su tamaño y
            su letra. Si el logo cargado ya lo trae dibujado, se apaga desde
            el menú del logo para no repetirlo. */}
        {/* Copia invisible a tamaño de referencia: solo sirve para medir. */}
        <span ref={espejoLema} className="ev-lema-espejo" aria-hidden="true">
          {ESLOGAN}
        </span>
        <p className="ev-lema" style={{ fontSize: tamLema }}>
          {ESLOGAN}
        </p>
        <div className="ev-codigo">
          <BarcodeBlock
            value={data.barcode || ""}
            onChange={cambio("barcode") ?? (() => {})}
            onElegirCodigo={onElegirCodigo}
            editMode={editMode}
            franja={{ alto: 11 }}
            className="flex w-full flex-col items-center justify-end"
            claseImagen="h-auto w-full max-w-full"
          />
        </div>
      </div>

      {/* 7. Pie de contacto */}
      <div className="ev-bloque ev-pie" style={{ height: bloques.pie }}>
        <div className="ev-pie-linea">
          <IconoUbicacionPie />
          <CampoEtiqueta
            valor={data.city || ""}
            onChange={cambio("city")}
            editMode={editMode}
            styleKey="ev-pie-ciudad"
            tam={TAM.pie}
            maxLineas={1}
            ejemplo={EJEMPLO_VERTICAL.city}
            oscuro
          />
        </div>
        <div className="ev-pie-linea">
          <IconoGlobo />
          <CampoEtiqueta
            valor={data.website || ""}
            onChange={cambio("website")}
            editMode={editMode}
            styleKey="ev-pie-web"
            tam={TAM.pie}
            maxLineas={1}
            ejemplo={EJEMPLO_VERTICAL.website}
            oscuro
          />
        </div>
      </div>

      {onIconChange && (
        <GaleriaIconosQuimicosModal
          abierta={iconoAbierto !== null}
          onCerrar={() => setIconoAbierto(null)}
          onElegir={(svgDataUrl) => {
            if (iconoAbierto) onIconChange(iconoAbierto, svgDataUrl);
            setIconoAbierto(null);
          }}
        />
      )}
      {editable && onChange && (
        <MenuLogoCorporativo
          anchorRef={logoRef}
          abierto={menuLogo}
          onCerrar={() => setMenuLogo(false)}
          data={data}
          onChange={onChange}
        />
      )}
    </div>
  );
});

export default EtiquetaVertical;
