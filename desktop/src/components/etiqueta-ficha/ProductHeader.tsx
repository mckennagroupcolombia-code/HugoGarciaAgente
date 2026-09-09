import { useRef } from "react";
import EditableField from "./EditableField";
import ProductClassification from "./ProductClassification";
import BuscadorFichaTecnica from "./BuscadorFichaTecnica";
import { RETICULA_MAESTRA, type ProductLabelData } from "./productLabelTypes";

/** Caja del logo a escala 1 (tamaño por defecto) — el operador la escala
 *  manualmente con los botones －/＋. Tope máximo (1.3) elegido para que a
 *  esa escala la caja (273px) siga cabiendo dentro del ancho útil de la
 *  columna 3 (~288px con el padding del header) sin invadir la columna 2.
 *  Alto subido a 65px (antes 55) — mismo presupuesto vertical del header,
 *  que hoy lo define la columna del título, no el logo (ver comprobación
 *  visual: incluso a escala 1.3 el logo queda muy por debajo de esa
 *  altura). */
const LOGO_ANCHO_BASE = 210;
const LOGO_ALTO_BASE = 65;
const LOGO_ESCALA_MIN = 0.6;
const LOGO_ESCALA_MAX = 1.3;
const LOGO_ESCALA_PASO = 0.1;

function clampEscalaLogo(v: number): number {
  return Math.min(LOGO_ESCALA_MAX, Math.max(LOGO_ESCALA_MIN, Math.round(v * 10) / 10));
}

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
 *  en la columna técnica del cuerpo, debajo de "Disponible en". */
export default function ProductHeader({
  data,
  onChange,
  editMode,
}: {
  data: ProductLabelData;
  onChange: (patch: Partial<ProductLabelData>) => void;
  editMode: boolean;
}) {
  const logoInputRef = useRef<HTMLInputElement>(null);

  const adjuntarLogo = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => onChange({ logoUrl: String(reader.result || "") });
    reader.readAsDataURL(file);
  };

  const escalaLogo = clampEscalaLogo(data.logoScale ?? 1);
  const ajustarEscalaLogo = (delta: number) =>
    onChange({ logoScale: clampEscalaLogo(escalaLogo + delta) });

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
              className="whitespace-pre-line text-center font-extrabold uppercase leading-[1.02] tracking-[-0.4px] text-[#FFA500]"
            />
          </div>
          {editMode && (
            <div className="pt-1">
              <BuscadorFichaTecnica onAplicar={onChange} />
            </div>
          )}
        </div>
        <ProductClassification
          value={data.classification}
          onChange={(v) => onChange({ classification: v })}
          editMode={editMode}
        />
      </div>

      <div className="flex flex-col items-center gap-2 px-4">
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) adjuntarLogo(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={!editMode}
          onClick={() => logoInputRef.current?.click()}
          title={editMode ? "Adjuntar logo" : undefined}
          style={{
            // Ancho Y alto explícitos (no solo un `max-height` con el alto
            // en "auto"): con solo `max-height`, el alto real de la caja
            // quedaba indeterminado y el navegador no podía calcular un
            // `object-contain` correcto — el logo terminaba recortado por
            // el `overflow-hidden` en vez de escalado completo dentro de
            // la caja. Con las dos medidas fijas, `object-contain` sí
            // aprovecha el 100% del espacio disponible sin recortar nada.
            width: LOGO_ANCHO_BASE * escalaLogo,
            height: LOGO_ALTO_BASE * escalaLogo,
          }}
          className={`relative flex items-center justify-center overflow-hidden rounded-[3px] text-[11px] font-bold uppercase tracking-wider text-[#111111]/50 ${
            data.logoUrl ? "" : "border border-dashed border-[#111111]/20"
          } ${editMode ? "cursor-pointer hover:border-[#FFA500] hover:text-[#FFA500]" : "cursor-default"}`}
        >
          {data.logoUrl ? (
            <img
              src={data.logoUrl}
              alt="Logo"
              className="h-full w-full object-contain"
            />
          ) : (
            "McKenna Group"
          )}
        </button>
        {editMode && data.logoUrl && (
          <div className="flex items-center gap-1.5 text-[11px] text-[#111111]/50">
            <button
              type="button"
              onClick={() => ajustarEscalaLogo(-LOGO_ESCALA_PASO)}
              disabled={escalaLogo <= LOGO_ESCALA_MIN}
              title="Reducir logo"
              className="flex h-5 w-5 items-center justify-center rounded border border-[#111111]/20 hover:border-[#FFA500] hover:text-[#FFA500] disabled:cursor-not-allowed disabled:opacity-30"
            >
              －
            </button>
            <span className="w-9 text-center tabular-nums">{Math.round(escalaLogo * 100)}%</span>
            <button
              type="button"
              onClick={() => ajustarEscalaLogo(LOGO_ESCALA_PASO)}
              disabled={escalaLogo >= LOGO_ESCALA_MAX}
              title="Aumentar logo"
              className="flex h-5 w-5 items-center justify-center rounded border border-[#111111]/20 hover:border-[#FFA500] hover:text-[#FFA500] disabled:cursor-not-allowed disabled:opacity-30"
            >
              ＋
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
