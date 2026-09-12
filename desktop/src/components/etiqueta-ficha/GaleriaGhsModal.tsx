/**
 * Galería de pictogramas GHS para la Ficha de etiqueta — mismo patrón que
 * `GaleriaIconosQuimicosModal` (modal portado a document.body, un clic
 * inserta y cierra). Reemplaza al `GHSIconsPicker` compacto, que era un
 * panel `position: fixed`: dentro del marco de formato (que lleva
 * `transform: scale`) un `fixed` se posiciona respecto al marco y se
 * escala con él, y además pedía dos clics (elegir + "Insertar").
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { GHS_ICONOS } from "../../lib/ghsIconos";
import { ghsSvgADataUrl, marcoGhsSvg } from "../GHSIconsPicker";

export default function GaleriaGhsModal({
  abierta,
  codigoActual,
  onCerrar,
  onElegir,
  circuloNoGhs = false,
}: {
  /** Etiqueta 30 mL: ofrece también el círculo «¡NO GHS» (su marca sin
   *  peligro por defecto); al elegirlo llega `onElegir("", "NO GHS")`. */
  circuloNoGhs?: boolean;
  abierta: boolean;
  /** Código ya puesto en la ficha ("GHS07", "NO GHS") para resaltarlo. */
  codigoActual?: string;
  onCerrar: () => void;
  /** Data URL del pictograma + código a mostrar en el dato `ghs`. */
  onElegir: (svgDataUrl: string, codigo: string) => void;
}) {
  const [digitos, setDigitos] = useState("");
  if (!abierta || typeof document === "undefined") return null;

  const elegirSvg = (svg: string, codigo: string) => {
    onElegir(ghsSvgADataUrl(svg), codigo);
    onCerrar();
  };
  const svgNoGhs = marcoGhsSvg("", true);
  const svgMarco = marcoGhsSvg(digitos, false);
  const marcoListo = digitos.length === 3;
  const actual = (codigoActual || "").trim().toUpperCase();

  const tarjeta = "flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 text-center transition hover:border-accent hover:bg-accent/5 hover:shadow-md";
  const tarjetaActiva = "border-accent bg-accent/10";
  const tarjetaNormal = "border-border bg-surface";

  return createPortal(
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center bg-ink/50 p-2 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-[min(90vh,640px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-ink">Pictograma GHS / SGA</h3>
            <p className="text-[11px] text-muted">Haz clic sobre un rombo para ponerlo en la etiqueta.</p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:bg-surface-hover hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {circuloNoGhs && (
              <button
                type="button"
                onClick={() => {
                  onElegir("", "NO GHS");
                  onCerrar();
                }}
                title="Sin clasificación GHS — círculo de la etiqueta"
                className={`${tarjeta} ${tarjetaNormal}`}
              >
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-[3px] border-accent text-[13px] font-extrabold leading-none text-ink">
                  ¡NO
                  <br />
                  GHS
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide text-accent">NO GHS</span>
                <span className="text-[11px] font-semibold leading-tight text-ink">Círculo</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => elegirSvg(svgNoGhs, "NO GHS")}
              title="Sin clasificación GHS"
              className={`${tarjeta} ${actual === "NO GHS" ? tarjetaActiva : tarjetaNormal}`}
            >
              <div className="h-16 w-16 shrink-0" dangerouslySetInnerHTML={{ __html: svgNoGhs }} />
              <span className="text-[10px] font-bold uppercase tracking-wide text-accent">NO GHS</span>
              <span className="text-[11px] font-semibold leading-tight text-ink">Sin peligro</span>
            </button>
            {GHS_ICONOS.map((icono) => (
              <button
                key={icono.codigo}
                type="button"
                onClick={() => elegirSvg(icono.svg, icono.codigo)}
                title={`${icono.codigo} — ${icono.descripcion}`}
                className={`${tarjeta} ${actual === icono.codigo.toUpperCase() ? tarjetaActiva : tarjetaNormal}`}
              >
                <div className="h-16 w-16 shrink-0" dangerouslySetInnerHTML={{ __html: icono.svg }} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-accent">{icono.codigo}</span>
                <span className="text-[11px] font-semibold leading-tight text-ink">{icono.nombre}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-dashed border-red-300 bg-red-50/40 p-3">
            <div
              className={`h-16 w-16 shrink-0 ${marcoListo ? "" : "opacity-50"}`}
              dangerouslySetInnerHTML={{ __html: svgMarco }}
            />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-bold text-red-700">Marco GHS con código</p>
              <div className="flex items-center gap-1 rounded-lg border-2 border-red-300 bg-surface-input px-2 py-1">
                <span className="select-none text-sm font-black text-red-700">GHS</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="000"
                  value={digitos}
                  onChange={(e) => setDigitos(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  className="w-12 bg-transparent text-sm font-black tracking-widest text-ink outline-none placeholder:text-muted/50"
                />
              </div>
              <button
                type="button"
                disabled={!marcoListo}
                onClick={() => elegirSvg(svgMarco, `GHS${digitos}`)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {marcoListo ? `Usar GHS${digitos}` : "Digita 3 números"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
