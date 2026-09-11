import { useRef, useState, type RefObject } from "react";
import PopoverFlotante from "./PopoverFlotante";
import GaleriaLogosCorporativosModal from "./GaleriaLogosCorporativosModal";
import { ACENTO_POR_DEFECTO, normalizarHex, type ProductLabelData } from "./productLabelTypes";
import { colorAcentoDesdeImagen } from "../../lib/colorDominante";
import {
  cargarLogoCorporativoComoDataUrl,
  useLogosCorporativos,
  useSubirLogosCorporativos,
  type LogoCorporativo,
} from "../../lib/logosCorporativos";

/** Menú del logo de la etiqueta, compartido por todos los formatos (ficha de
 *  76 × 66 y etiqueta de 30 mL): abre la carpeta DISEÑO CORPORATIVO del
 *  servidor (`/api/etiquetas/logos-corporativos`); al elegir un logo, su
 *  color dominante pasa a ser el acento de toda la etiqueta (bandas, bordes,
 *  títulos, íconos) de una vez. También se puede subir un archivo propio
 *  (mismo cálculo de acento) o ajustar el color a mano. */
export default function MenuLogoCorporativo({
  data,
  onChange,
  anchorRef,
  abierto,
  onCerrar,
  alinear = "derecha",
}: {
  data: ProductLabelData;
  onChange: (patch: Partial<ProductLabelData>) => void;
  anchorRef: RefObject<HTMLElement | null>;
  abierto: boolean;
  onCerrar: () => void;
  alinear?: "centro" | "izquierda" | "derecha";
}) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const agregarInputRef = useRef<HTMLInputElement>(null);
  const [cargandoLogo, setCargandoLogo] = useState<string | null>(null);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const { subir: agregarACarpeta, progreso: agregando, error: errorAgregar } = useSubirLogosCorporativos();
  const { data: logosData, isLoading: logosCargando, error: logosError } = useLogosCorporativos(abierto);

  /** Pone el logo y, si la imagen tiene color, cambia el acento de la ficha. */
  const aplicarLogo = async (dataUrl: string, nombre: string) => {
    const acento = await colorAcentoDesdeImagen(dataUrl);
    onChange({
      logoUrl: dataUrl,
      logoNombre: nombre,
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
      onCerrar();
      setGaleriaAbierta(false);
    } catch (e) {
      setErrorLogo(e instanceof Error ? e.message : "No se pudo cargar el logo");
    } finally {
      setCargandoLogo(null);
    }
  };

  const acentoActual = normalizarHex(data.accentColor);
  const logos = logosData?.logos ?? [];

  return (
    <>
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
      <PopoverFlotante anchorRef={anchorRef} abierto={abierto} onCerrar={onCerrar} alinear={alinear} ancho={330}>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold text-ink">Logos · DISEÑO CORPORATIVO</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onCerrar();
                setGaleriaAbierta(true);
              }}
              title="Abrir la galería en ventana para subir y eliminar logos"
              className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-ink-secondary hover:bg-surface-hover"
            >
              ⤢ Galería
            </button>
            <button type="button" onClick={onCerrar} className="text-muted hover:text-ink">
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
        abierta={galeriaAbierta}
        logoActivo={data.logoNombre}
        cargandoNombre={cargandoLogo}
        onCerrar={() => setGaleriaAbierta(false)}
        onElegir={(logo) => void elegirLogoCorporativo(logo)}
      />
    </>
  );
}
