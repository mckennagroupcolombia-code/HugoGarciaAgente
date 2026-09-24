import EditableField, { EditableLabel } from "./EditableField";
import { useTextStyleCtx } from "./TextStyleContext";
import { TITULOS_CUCHARA, UNIDADES_CUCHARA } from "./productLabelTypes";

/** Casilla "Incluye cuchara medidora de: N g/mL aprox." — el rótulo se
 *  escoge en su menú entre cuchara y copa (`TITULOS_CUCHARA`). Va debajo del
 *  cuadro Pureza/CAS con su mismo trazo, radio y ancho, para no crear
 *  ninguna línea nueva en la retícula. Sin cantidad no se imprime (vista y
 *  PNG); en edición se ve siempre para poder llenarla. */
export default function CucharaMedidora({
  cantidad,
  unidad,
  titulo,
  onCantidadChange,
  onUnidadChange,
  onTituloChange,
  editMode,
}: {
  cantidad: string;
  unidad: string;
  titulo?: string;
  onCantidadChange: (v: string) => void;
  onUnidadChange: (v: string) => void;
  onTituloChange?: (v: string) => void;
  editMode: boolean;
}) {
  const rotulo =
    titulo && (TITULOS_CUCHARA as readonly string[]).includes(titulo)
      ? titulo
      : TITULOS_CUCHARA[0];

  // En la etiqueta la unidad (g / mL) va al mismo tamaño que la cantidad; el
  // menú desplegable no: el <select> va invisible encima del texto con su letra
  // chica (`mck-field-lg` lo saca del font-size !important de los select del panel).
  const { estilos } = useTextStyleCtx();
  const tamanoUnidad = estilos.cucharaCantidad?.fontSize ?? 17;

  if (!editMode && !cantidad.trim()) return null;

  return (
    <div className="w-full overflow-hidden rounded-[4px] border-[1.5px] border-[color:var(--acento)] text-center">
      <div className="flex min-h-[34px] items-center justify-center px-3">
        <EditableLabel
          texto={rotulo}
          editMode={editMode}
          styleKey="cucharaTitulo"
          defaultFontSize={15}
          className="font-bold text-[#111111]"
          opciones={TITULOS_CUCHARA}
          valorOpcion={rotulo}
          onElegirOpcion={onTituloChange}
        />
      </div>
      <div className="flex min-h-[34px] items-center justify-center gap-1.5 border-t-[1.5px] border-[color:var(--acento)] px-3">
        {editMode ? (
          <>
            <div className="w-[72px]">
              <EditableField
                value={cantidad}
                onChange={onCantidadChange}
                editMode
                styleKey="cucharaCantidad"
                defaultFontSize={17}
                placeholder="—"
                className="text-center font-bold tabular-nums text-[color:var(--acento)]"
              />
            </div>
            <span className="relative inline-flex items-center rounded-sm border border-dashed border-[color:var(--acento-50)] px-1 focus-within:border-[color:var(--acento)]">
              <span
                aria-hidden
                style={{ fontSize: tamanoUnidad }}
                className="font-bold leading-none text-[color:var(--acento)]"
              >
                {unidad} ▾
              </span>
              <select
                value={unidad}
                onChange={(e) => onUnidadChange(e.target.value)}
                title="Unidad de la medida"
                style={{ fontSize: 14 }}
                className="mck-field-lg absolute inset-0 h-full w-full cursor-pointer opacity-0"
              >
                {UNIDADES_CUCHARA.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </span>
          </>
        ) : (
          <EditableField
            value={`${cantidad.trim()} ${unidad}`}
            onChange={() => {}}
            editMode={false}
            styleKey="cucharaCantidad"
            defaultFontSize={17}
            className="font-bold tabular-nums text-[color:var(--acento)]"
          />
        )}
        <span className="text-[17px] font-medium text-[#111111]/70">aprox.</span>
      </div>
    </div>
  );
}
