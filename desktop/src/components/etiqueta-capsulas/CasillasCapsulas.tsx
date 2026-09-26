/**
 * Casillas reutilizables de la etiqueta de cápsulas. Por dentro son las
 * mismas piezas de la etiqueta 30 mL: `CampoEtiqueta` (se edita en el sitio,
 * con el menú de tamaño/fuente y el ajuste automático) y `EditableLabel` para
 * los títulos; el ícono es el de la galería, con el acento del logo.
 */
import { useRef, type ReactNode } from "react";
import { EditableLabel } from "../etiqueta-ficha/EditableField";
import CampoEtiqueta from "../etiqueta-30ml/CampoEtiqueta";
import { IconoCelda } from "../etiqueta-30ml/TechnicalCell";
import { TAM_CAPSULAS } from "./etiquetaCapsulasTypes";

/** Ícono a la izquierda y, a su derecha, título + valor (Composición,
 *  Color, Conservación). El ícono abre la galería en edición. */
export function CasillaConIcono({
  campo,
  titulo,
  valor,
  ejemplo,
  iconoElegido,
  iconoPorDefecto,
  editMode,
  tam,
  maxLineas,
  multilinea = false,
  lineas = "",
  onChange,
  onEditarIcono,
}: {
  /** Clave del dato: también la de `text_styles` (`ecap_<campo>`). */
  campo: string;
  titulo: string;
  valor: string;
  ejemplo: string;
  iconoElegido?: string;
  iconoPorDefecto: string;
  editMode: boolean;
  tam: readonly [number, number];
  maxLineas: number;
  multilinea?: boolean;
  lineas?: string;
  onChange?: (v: string) => void;
  onEditarIcono?: () => void;
}) {
  const cajaRef = useRef<HTMLDivElement>(null);
  return (
    <div className={`ecap-casilla ${lineas}`}>
      <button
        type="button"
        className="ecap-icono e30-celda-icono mck-btn-no-fx"
        disabled={!editMode || !onEditarIcono}
        onClick={onEditarIcono}
        title={editMode ? "Cambiar ícono" : undefined}
        aria-label={`Ícono de ${titulo.toLowerCase()}`}
      >
        <IconoCelda elegido={iconoElegido} porDefecto={iconoPorDefecto} />
      </button>
      <div ref={cajaRef} className="ecap-casilla-texto">
        <EditableLabel
          texto={titulo}
          editMode={editMode}
          styleKey={`ecap_${campo}Titulo`}
          defaultFontSize={TAM_CAPSULAS.tituloCasilla}
          as="p"
          className="ecap-titulo"
        />
        <CampoEtiqueta
          valor={valor}
          onChange={onChange}
          editMode={editMode}
          styleKey={`ecap_${campo}`}
          ejemplo={ejemplo}
          tam={tam}
          maxLineas={maxLineas}
          cajaRef={cajaRef}
          multilinea={multilinea}
          className="ecap-valor"
        />
      </div>
    </div>
  );
}

/** Título y valor sin ícono (Tamaño, Contenido, Lote, Vencimiento). Con
 *  `enLinea`, el valor va a la derecha del título sobre una línea discreta,
 *  para escribir o timbrar; si no, debajo. `sufijo` se dibuja fijo tras el
 *  valor (p. ej. «UNIDADES»). */
export function CasillaDato({
  campo,
  titulo,
  valor,
  ejemplo,
  editMode,
  tam,
  enLinea = false,
  destacado = false,
  sufijo,
  lineas = "",
  onChange,
}: {
  campo: string;
  titulo: string;
  valor: string;
  ejemplo: string;
  editMode: boolean;
  tam: readonly [number, number];
  enLinea?: boolean;
  destacado?: boolean;
  sufijo?: ReactNode;
  lineas?: string;
  onChange?: (v: string) => void;
}) {
  const cajaRef = useRef<HTMLDivElement>(null);
  return (
    <div className={`ecap-dato${enLinea ? " ecap-dato-linea" : ""} ${lineas}`}>
      <EditableLabel
        texto={titulo}
        editMode={editMode}
        styleKey={`ecap_${campo}Titulo`}
        defaultFontSize={TAM_CAPSULAS.tituloDato}
        as="p"
        className="ecap-titulo"
      />
      <div ref={cajaRef} className={`ecap-dato-valor${enLinea ? " ecap-subrayado" : ""}`}>
        <CampoEtiqueta
          as="span"
          valor={valor}
          onChange={onChange}
          editMode={editMode}
          styleKey={`ecap_${campo}`}
          ejemplo={ejemplo}
          tam={tam}
          maxLineas={1}
          cajaRef={sufijo ? undefined : cajaRef}
          className={`ecap-valor${destacado ? " ecap-valor-destacado" : ""}`}
        />
        {sufijo && <span className="ecap-sufijo">{sufijo}</span>}
      </div>
    </div>
  );
}
