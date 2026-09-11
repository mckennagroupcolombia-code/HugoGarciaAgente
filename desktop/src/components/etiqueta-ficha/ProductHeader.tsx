import { useRef, useState } from "react";
import EditableField from "./EditableField";
import ProductClassification from "./ProductClassification";
import BuscadorFichaTecnica from "./BuscadorFichaTecnica";
import { ACENTO_POR_DEFECTO, RETICULA_MAESTRA, normalizarHex, type ProductLabelData } from "./productLabelTypes";
import PopoverFlotante from "./PopoverFlotante";
import { colorAcentoDesdeImagen } from "../../lib/colorDominante";
import {
  cargarLogoCorporativoComoDataUrl,
  useLogosCorporativos,
  useSubirLogosCorporativos,
  type LogoCorporativo,
} from "../../lib/logosCorporativos";
import GaleriaLogosCorporativosModal from "./GaleriaLogosCorporativosModal";

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
/** Escala con la que entra todo logo (y la de una ficha sin dato): el
 *  máximo, 130 % — a menos, el logo se pierde impreso. El operador puede
 *  bajarla con －. */
const LOGO_ESCALA_DEFECTO = LOGO_ESCALA_MAX;

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
 *  en la columna técnica del cuerpo, debajo de "Disponible en".
 *
 *  El botón del logo abre la carpeta DISEÑO CORPORATIVO del servidor
 *  (`/api/etiquetas/logos-corporativos`): al elegir un logo, su color
 *  dominante pasa a ser el acento de toda la ficha (bandas, bordes,
 *  títulos, íconos) de una vez. También se puede subir un archivo propio
 *  (mismo cálculo de acento) o ajustar el color a mano. */
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
  const logoWrapRef = useRef<HTMLDivElement>(null);
  const [menuLogo, setMenuLogo] = useState(false);
  const [cargandoLogo, setCargandoLogo] = useState<string | null>(null);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const agregarInputRef = useRef<HTMLInputElement>(null);
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const { subir: agregarACarpeta, progreso: agregando, error: errorAgregar } = useSubirLogosCorporativos();
  const { data: logosData, isLoading: logosCargando, error: logosError } = useLogosCorporativos(
    editMode && menuLogo,
  );

  /** Pone el logo al 130 % y, si la imagen tiene color, cambia el acento de la ficha. */
  const aplicarLogo = async (dataUrl: string, nombre: string) => {
    const acento = await colorAcentoDesdeImagen(dataUrl);
    onChange({
      logoUrl: dataUrl,
      logoNombre: nombre,
      logoScale: LOGO_ESCALA_DEFECTO,
      ...(acento ? { accentColor: acento } : {}),
    });
  };

  const adjuntarLogo = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => void aplicarLogo(String(reader.result || ""), file.name);
    reader.readAsDataURL(file);
  };

  const elegirLogoCorporativo = async (logo: LogoCorporativo) => {
    setCargandoLogo(logo.nombre);
    setErrorLogo(null);
    try {
      const dataUrl = await cargarLogoCorporativoComoDataUrl(logo.nombre);
      await aplicarLogo(dataUrl, logo.nombre);
      setMenuLogo(false);
      setGaleriaAbierta(false);
    } catch (e) {
      setErrorLogo(e instanceof Error ? e.message : "No se pudo cargar el logo");
    } finally {
      setCargandoLogo(null);
    }
  };

  const escalaLogo = clampEscalaLogo(data.logoScale ?? LOGO_ESCALA_DEFECTO);
  const ajustarEscalaLogo = (delta: number) =>
    onChange({ logoScale: clampEscalaLogo(escalaLogo + delta) });
  const acentoActual = normalizarHex(data.accentColor);
  const logos = logosData?.logos ?? [];

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
            width: LOGO_ANCHO_BASE * escalaLogo,
            height: LOGO_ALTO_BASE * escalaLogo,
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
        {editMode && data.logoUrl && (
          <div className="flex items-center gap-1.5 text-[11px] text-[#111111]/50">
            <button
              type="button"
              onClick={() => ajustarEscalaLogo(-LOGO_ESCALA_PASO)}
              disabled={escalaLogo <= LOGO_ESCALA_MIN}
              title="Reducir logo"
              className="flex h-5 w-5 items-center justify-center rounded border border-[#111111]/20 hover:border-[color:var(--acento)] hover:text-[color:var(--acento)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              －
            </button>
            <span className="w-9 text-center tabular-nums">{Math.round(escalaLogo * 100)}%</span>
            <button
              type="button"
              onClick={() => ajustarEscalaLogo(LOGO_ESCALA_PASO)}
              disabled={escalaLogo >= LOGO_ESCALA_MAX}
              title="Aumentar logo"
              className="flex h-5 w-5 items-center justify-center rounded border border-[#111111]/20 hover:border-[color:var(--acento)] hover:text-[color:var(--acento)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              ＋
            </button>
          </div>
        )}

        <PopoverFlotante
          anchorRef={logoWrapRef}
          abierto={editMode && menuLogo}
          onCerrar={() => setMenuLogo(false)}
          alinear="derecha"
          ancho={330}
        >
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold text-ink">Logos · DISEÑO CORPORATIVO</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMenuLogo(false);
                    setGaleriaAbierta(true);
                  }}
                  title="Abrir la galería en ventana para subir y eliminar logos"
                  className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-ink-secondary hover:bg-surface-hover"
                >
                  ⤢ Galería
                </button>
                <button type="button" onClick={() => setMenuLogo(false)} className="text-muted hover:text-ink">
                  ✕
                </button>
              </div>
            </div>
            <p className="mb-2 text-[11px] text-muted">
              Al elegir un logo, su color pasa a ser el acento de toda la ficha.
            </p>
            {logosCargando && <p className="px-1 py-1 text-xs text-muted">Cargando…</p>}
            {logosError && (
              <p className="mb-1.5 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">
                {logosError instanceof Error ? logosError.message : "No se pudo leer la carpeta de logos"}
              </p>
            )}
            {errorLogo && <p className="mb-1.5 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">{errorLogo}</p>}
            {errorAgregar && <p className="mb-1.5 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">{errorAgregar}</p>}
            {!logosCargando && !logosError && logos.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted">La carpeta no tiene imágenes.</p>
            )}
            {logos.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5 pr-0.5">
                {logos.map((logo) => {
                  const activo = data.logoNombre === logo.nombre;
                  const cargando = cargandoLogo === logo.nombre;
                  return (
                    <button
                      key={logo.nombre}
                      type="button"
                      disabled={cargandoLogo !== null}
                      onClick={() => void elegirLogoCorporativo(logo)}
                      title={logo.nombre}
                      className={`flex flex-col items-center gap-1 rounded-md border p-1.5 text-center transition hover:border-accent hover:bg-accent/5 disabled:opacity-60 ${
                        activo ? "border-accent bg-accent/10" : "border-border bg-white"
                      }`}
                    >
                      <span className="flex h-14 w-full items-center justify-center overflow-hidden rounded bg-white">
                        {logo.thumb ? (
                          <img src={logo.thumb} alt="" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <span className="text-[10px] text-muted">sin vista previa</span>
                        )}
                      </span>
                      <span className="line-clamp-2 w-full text-[10px] leading-tight text-ink">
                        {cargando ? "Cargando…" : logo.nombre.replace(/\.[a-z0-9]+$/i, "")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <input
              ref={agregarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length > 0) void agregarACarpeta(files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => agregarInputRef.current?.click()}
              disabled={!!agregando}
              title="Guarda imágenes (PNG, JPG o WEBP) en la carpeta DISEÑO CORPORATIVO — en el explorador, mantén Shift o Ctrl para elegir varias"
              className="mt-2 w-full rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {agregando ? `Agregando ${agregando.done}/${agregando.total}…` : "+ Agregar imágenes a la carpeta"}
            </button>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                title="Pone una imagen del ordenador solo en esta ficha, sin guardarla en la carpeta"
                className="rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-surface-hover"
              >
                Usar sin guardar…
              </button>
              <label className="flex items-center gap-1.5 text-[11px] text-muted" title="Ajustar el acento a mano">
                Acento
                <input
                  type="color"
                  value={acentoActual}
                  onChange={(e) => onChange({ accentColor: e.target.value })}
                  className="h-5 w-7 cursor-pointer rounded border border-border p-0"
                />
                <button
                  type="button"
                  onClick={() => onChange({ accentColor: ACENTO_POR_DEFECTO })}
                  disabled={acentoActual === ACENTO_POR_DEFECTO}
                  title="Volver al naranja corporativo"
                  className="text-[11px] text-muted hover:text-ink disabled:opacity-30"
                >
                  ↺
                </button>
              </label>
            </div>
        </PopoverFlotante>
        <GaleriaLogosCorporativosModal
          abierta={editMode && galeriaAbierta}
          logoActivo={data.logoNombre}
          cargandoNombre={cargandoLogo}
          onCerrar={() => setGaleriaAbierta(false)}
          onElegir={(logo) => void elegirLogoCorporativo(logo)}
        />
      </div>
    </div>
  );
}
