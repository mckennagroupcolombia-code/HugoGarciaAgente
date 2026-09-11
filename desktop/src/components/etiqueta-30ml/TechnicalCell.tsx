import { useRef } from "react";
import { EditableLabel } from "../etiqueta-ficha/EditableField";
import { svgElegidoConAcento } from "../etiqueta-ficha/ProductAttribute";
import { ICONOS_QUIMICA_CIRCULARES, quitarCirculoExterior } from "../../lib/iconosQuimicaCirculares";
import CampoEtiqueta from "./CampoEtiqueta";
import { TAM_30ML } from "./etiqueta30mlTypes";

/** Ícono de una celda: el elegido en la galería (con el acento de la
 *  etiqueta) o el de la galería asignado por defecto. Siempre SVG en línea,
 *  para que tome el color del logo y el grosor uniforme de la retícula. */
export function IconoCelda({ elegido, porDefecto }: { elegido?: string; porDefecto: string }) {
  const svgElegido = svgElegidoConAcento(elegido);
  if (svgElegido) return <span className="e30-svg" dangerouslySetInnerHTML={{ __html: svgElegido }} />;
  if (elegido) return <img src={elegido} alt="" className="e30-svg" />;
  const icono = ICONOS_QUIMICA_CIRCULARES.find((i) => i.id === porDefecto);
  if (!icono) return null;
  return (
    <span className="e30-svg" dangerouslySetInnerHTML={{ __html: quitarCirculoExterior(icono.svg) }} />
  );
}

/** Celda de la matriz técnica: ícono + título + valor, centrados como una
 *  sola unidad — igual que `ProductAttribute` de la ficha: el ícono abre la
 *  galería, el título abre el menú de tamaño/fuente y el valor se escribe en
 *  el sitio. El alto lo pone la fila de la retícula; el valor se encoge para
 *  caber (hasta 3 renglones) en vez de estirar la celda. */
export default function TechnicalCell({
  campo,
  titulo,
  valor,
  ejemplo,
  iconoElegido,
  iconoPorDefecto,
  editMode,
  lineas = "",
  onChange,
  onEditarIcono,
  tituloOpciones,
  onTituloChange,
}: {
  campo: string;
  titulo: string;
  /** Títulos entre los que se escoge desde el menú del título. */
  tituloOpciones?: readonly string[];
  onTituloChange?: (v: string) => void;
  valor: string;
  ejemplo: string;
  iconoElegido?: string;
  iconoPorDefecto: string;
  editMode: boolean;
  /** Clases de líneas divisorias de esta celda. */
  lineas?: string;
  onChange?: (v: string) => void;
  onEditarIcono?: () => void;
}) {
  const cajaRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={cajaRef} className={`e30-celda ${lineas}`}>
      <button
        type="button"
        className="e30-celda-icono mck-btn-no-fx"
        disabled={!editMode || !onEditarIcono}
        onClick={onEditarIcono}
        title={editMode ? "Cambiar ícono" : undefined}
      >
        <IconoCelda elegido={iconoElegido} porDefecto={iconoPorDefecto} />
      </button>
      <EditableLabel
        texto={titulo}
        editMode={editMode}
        styleKey={`e30_${campo}Titulo`}
        defaultFontSize={12.5}
        as="p"
        className="e30-celda-titulo"
        opciones={onTituloChange ? tituloOpciones : undefined}
        valorOpcion={titulo}
        onElegirOpcion={onTituloChange}
      />
      <CampoEtiqueta
        valor={valor}
        onChange={onChange}
        editMode={editMode}
        styleKey={`e30_${campo}`}
        ejemplo={ejemplo}
        tam={TAM_30ML.valorCelda}
        maxLineas={3}
        cajaRef={cajaRef}
        multilinea
        className="e30-celda-valor"
      />
    </div>
  );
}
