import { useRef, useState } from "react";
import EditableField, { EditableLabel } from "./EditableField";
import ProductClassification from "./ProductClassification";
import BuscadorFichaTecnica from "./BuscadorFichaTecnica";
import MenuLogoCorporativo from "./MenuLogoCorporativo";
import { RETICULA_MAESTRA, type ProductLabelData } from "./productLabelTypes";

/** Caja del logo: 210×65 a escala 1, siempre al 130 % (273×84.5). Ya no se
 *  escala a mano (los botones －/＋ se quitaron): a menos el logo se pierde
 *  impreso, y 1.3 es lo máximo que cabe en el ancho útil de la columna 3
 *  (~288px con el padding del header) sin invadir la columna 2. El dato
 *  `logoScale` de las fichas guardadas se ignora. */
const LOGO_ANCHO = 210 * 1.3;
const LOGO_ALTO = 65 * 1.3;
/** Eslogan fijo bajo el logo. */
const ESLOGAN = "Proveemos a tus ideas";

/** Tamaño del nombre según su longitud — nunca por debajo de 22px. Sin
 *  clamp() (nada de responsive aquí): la escala se resuelve en JS contra
 *  el contenido real, no contra el viewport. */
function tamanoNombre(nombre: string): number {
  const lineas = (nombre || "").split("\n").filter(Boolean);
  const masLarga = Math.max(0, ...lineas.map((l) => l.length));
  const total = lineas.reduce((acc, l) => acc + l.length, 0);
  if (lineas.length <= 1 && masLarga <= 12) return 30;
  if (total <= 24) return 28;
  if (total <= 34) return 25;
  return 22;
}

/** Cabecera: nombre del producto + banda de clasificación (columnas 1+2)
 *  y logotipo (columna 3) — la identidad técnica (Pureza/CAS) vive ahora
 *  en la columna técnica del cuerpo, debajo de "Disponible en".
 *
 *  El botón del logo abre el menú de logos corporativos (`MenuLogoCorporativo`,
 *  el mismo de la etiqueta de 30 mL). */
export default function ProductHeader({
  data,
  onChange,
  editMode,
}: {
  data: ProductLabelData;
  onChange: (patch: Partial<ProductLabelData>) => void;
  editMode: boolean;
}) {
  const logoWrapRef = useRef<HTMLDivElement>(null);
  const [menuLogo, setMenuLogo] = useState(false);

  return (
    // Misma retícula de 3 columnas que el resto de la ficha — sin padding
    // ni gap en el contenedor del grid (eso desalinearía sus divisiones
    // respecto a las del cuerpo); el respiro visual va dentro de cada
    // columna, que no afecta el ancho de las pistas del grid.
    <div className={`${RETICULA_MAESTRA} items-center pb-2 pt-3`}>
      <div className="col-span-2 flex flex-col items-center justify-center gap-1.5 px-6">
        <div className="flex w-full items-start justify-center gap-1.5">
          <div className="min-w-0 flex-1">
            <EditableField
              value={data.productName}
              onChange={(v) => onChange({ productName: v })}
              editMode={editMode}
              multiline
              styleKey="productName"
              defaultFontSize={tamanoNombre(data.productName)}
              className="whitespace-pre-line text-center font-extrabold uppercase leading-[1.02] tracking-[-0.4px] text-[color:var(--acento)]"
            />
          </div>
          {editMode && (
            <div className="pt-1">
              <BuscadorFichaTecnica onAplicar={onChange} consultaInicial={data.barcodeTitle || ""} />
            </div>
          )}
        </div>
        <ProductClassification
          value={data.classification}
          onChange={(v) => onChange({ classification: v })}
          editMode={editMode}
        />
      </div>

      <div ref={logoWrapRef} className="relative flex flex-col items-center gap-2 px-4">
        <button
          type="button"
          disabled={!editMode}
          onClick={() => setMenuLogo((v) => !v)}
          title={editMode ? "Elegir logo (carpeta DISEÑO CORPORATIVO)" : undefined}
          style={{
            // Ancho Y alto explícitos (no solo un `max-height` con el alto
            // en "auto"): con solo `max-height`, el alto real de la caja
            // quedaba indeterminado y el navegador no podía calcular un
            // `object-contain` correcto — el logo terminaba recortado por
            // el `overflow-hidden` en vez de escalado completo dentro de
            // la caja. Con las dos medidas fijas, `object-contain` sí
            // aprovecha el 100% del espacio disponible sin recortar nada.
            width: LOGO_ANCHO,
            height: LOGO_ALTO,
          }}
          // Sin logo: el marco punteado con "McKenna Group" solo se ve en
          // edición (es una invitación a elegirlo); en vista y en el PNG
          // impreso la caja queda en blanco para no imprimir un placeholder.
          className={`relative flex items-center justify-center overflow-hidden rounded-[3px] text-[11px] font-bold uppercase tracking-wider text-[#111111]/50 ${
            data.logoUrl || !editMode ? "" : "border border-dashed border-[#111111]/20"
          } ${editMode ? "cursor-pointer hover:border-[color:var(--acento)] hover:text-[color:var(--acento)]" : "cursor-default"}`}
        >
          {data.logoUrl ? (
            <img
              src={data.logoUrl}
              alt="Logo"
              className="h-full w-full object-contain"
            />
          ) : editMode ? (
            "McKenna Group"
          ) : null}
        </button>
        <EditableLabel
          texto={ESLOGAN}
          editMode={editMode}
          styleKey="esloganLogo"
          defaultFontSize={15}
          as="p"
          className="text-center font-semibold tracking-wide text-[color:var(--acento)]"
        />

        <MenuLogoCorporativo
          data={data}
          onChange={onChange}
          anchorRef={logoWrapRef}
          abierto={editMode && menuLogo}
          onCerrar={() => setMenuLogo(false)}
        />
      </div>
    </div>
  );
}
