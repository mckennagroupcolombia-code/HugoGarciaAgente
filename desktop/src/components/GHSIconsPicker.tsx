import { useEffect, useRef, useState } from "react";
import { GHS_ICONOS, type GHSIcono } from "../lib/ghsIconos";

export function ghsSvgADataUrl(svg: string): string {
  try {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  } catch {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
}

function marcoGhsSvg(digitos: string, noMode = false): string {
  const FRAME = `<polygon points="50,4 96,50 50,96 4,50" fill="white" stroke="#DA291C" stroke-width="6.5" stroke-linejoin="miter"/>`;
  if (noMode) {
    const centro =
      `<text x="50" y="37" text-anchor="middle" dominant-baseline="central" font-size="22" font-weight="900" fill="#DA291C" font-family="Arial Black, Arial, sans-serif">NO</text>` +
      `<text x="50" y="63" text-anchor="middle" dominant-baseline="central" font-size="16" font-weight="900" fill="#1a1a1a" font-family="Arial Black, Arial, sans-serif">GHS</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${FRAME}${centro}</svg>`;
  }
  const tieneContenido = digitos.trim().length > 0;
  const centro = tieneContenido
    ? `<text x="50" y="40" text-anchor="middle" dominant-baseline="central" font-size="16" font-weight="900" fill="#1a1a1a" font-family="Arial Black, Arial, sans-serif">GHS</text>` +
      `<text x="50" y="62" text-anchor="middle" dominant-baseline="central" font-size="22" font-weight="900" fill="#1a1a1a" font-family="Arial Black, Arial, sans-serif">${digitos.padStart(3, "0")}</text>`
    : `<text x="50" y="40" text-anchor="middle" dominant-baseline="central" font-size="16" font-weight="900" fill="#cccccc" font-family="Arial Black, Arial, sans-serif">GHS</text>` +
      `<text x="50" y="62" text-anchor="middle" dominant-baseline="central" font-size="22" font-weight="900" fill="#cccccc" font-family="Arial Black, Arial, sans-serif">___</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${FRAME}${centro}</svg>`;
}

function SelectorMarcoGHS({
  compact,
  onDragStart,
  onInsertar,
}: {
  compact?: boolean;
  onDragStart: (e: React.DragEvent, svg: string) => void;
  onInsertar?: (svgDataUrl: string) => void;
}) {
  const [digitos, setDigitos] = useState("");
  const [noMode, setNoMode] = useState(false);

  const listo = noMode || digitos.trim().length === 3;
  const svg = marcoGhsSvg(digitos, noMode);
  const labelCodigo = noMode ? "NO GHS" : `GHS${digitos}`;
  const nombreArchivo = noMode ? "NO_GHS.svg" : `GHS${digitos}.svg`;

  function handleDigitos(val: string) {
    setDigitos(val.replace(/\D/g, "").slice(0, 3));
  }

  return (
    <div className={`rounded-xl border-2 border-dashed border-red-300 bg-red-50/40 p-3 dark:border-red-900/50 dark:bg-red-950/20 ${compact ? "mt-2" : "mt-4"}`}>
      <p className={`mb-2 font-bold text-red-700 dark:text-red-400 ${compact ? "text-[10px]" : "text-xs"}`}>
        Marco GHS con código
      </p>

      <div className="flex items-center gap-3">
        {/* Preview rombo */}
        <div
          draggable={listo}
          onDragStart={(e) => {
            if (!listo) return;
            onDragStart(e, svg);
          }}
          title={listo ? "Arrastrar al lienzo" : "Escribe 3 dígitos primero"}
          className={`shrink-0 ${compact ? "h-14 w-14" : "h-20 w-20"} ${listo ? "cursor-grab active:cursor-grabbing" : "opacity-60"}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />

        {/* Controles */}
        <div className="flex flex-col gap-2">
          {/* Checkbox NO */}
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={noMode}
              onChange={(e) => {
                setNoMode(e.target.checked);
                if (e.target.checked) setDigitos("");
              }}
              className="h-4 w-4 accent-red-600 cursor-pointer"
            />
            <span className={`font-black text-red-600 dark:text-red-400 ${compact ? "text-xs" : "text-sm"}`}>
              NO
            </span>
            <span className={`text-muted ${compact ? "text-[9px]" : "text-[10px]"}`}>
              (sin número)
            </span>
          </label>

          {/* Input de 3 dígitos — deshabilitado en modo NO */}
          <div className={`flex items-center gap-1 rounded-lg border-2 px-2 py-1.5 transition ${
            noMode
              ? "border-border bg-surface-hover opacity-40"
              : "border-red-300 bg-surface-input dark:border-red-700"
          }`}>
            <span className={`select-none font-black ${noMode ? "text-muted" : "text-red-700 dark:text-red-400"}`} style={{ fontSize: compact ? 12 : 14 }}>
              GHS
            </span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={3}
              placeholder="000"
              disabled={noMode}
              value={digitos}
              onChange={(e) => handleDigitos(e.target.value)}
              className={`w-12 bg-transparent font-black tracking-widest outline-none placeholder:text-muted/50 ${
                compact ? "text-sm" : "text-base"
              } ${noMode ? "cursor-not-allowed text-muted" : "text-ink"}`}
            />
          </div>

          <p className={`text-muted ${compact ? "text-[9px]" : "text-[10px]"}`}>
            {listo ? `Código: ${labelCodigo}` : "Digita 3 números"}
          </p>
        </div>
      </div>

      {listo && (
        <div className={`flex gap-1.5 ${compact ? "mt-2" : "mt-3"}`}>
          {onInsertar && (
            <button
              type="button"
              onClick={() => onInsertar(ghsSvgADataUrl(svg))}
              className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-bold text-white hover:bg-red-700"
            >
              ↳ Insertar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const a = document.createElement("a");
              a.href = ghsSvgADataUrl(svg);
              a.download = nombreArchivo;
              a.click();
            }}
            className="flex-1 rounded-lg border border-red-300 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
          >
            Descargar
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  onCerrar: () => void;
  /** Modo panel compacto flotante (no cubre el lienzo — permite arrastrar al canvas). */
  compact?: boolean;
  /** Callback para insertar icon en el lienzo directamente. */
  onInsertar?: (svgDataUrl: string) => void;
}

async function copiarSvgAlPortapapeles(svg: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(svg);
    return true;
  } catch {
    return false;
  }
}

function descargarSvg(icono: GHSIcono) {
  const url = ghsSvgADataUrl(icono.svg);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${icono.codigo}_${icono.nombre.replace(/\s+/g, "_")}.svg`;
  a.click();
}

function GHSIconCard({
  icono,
  seleccionado,
  compact,
  onClick,
  onDragStart,
}: {
  icono: GHSIcono;
  seleccionado: boolean;
  compact?: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const sz = compact ? "h-11 w-11" : "h-16 w-16";
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      title={`${icono.codigo} — ${icono.nombre}`}
      className={`group flex cursor-grab flex-col items-center gap-1.5 rounded-xl border-2 p-2 text-center transition active:cursor-grabbing hover:shadow-md ${
        seleccionado
          ? "border-accent bg-accent/5 shadow-md"
          : "border-border bg-surface hover:border-accent/50"
      }`}
    >
      <div
        className={`shrink-0 ${sz}`}
        dangerouslySetInnerHTML={{ __html: icono.svg }}
      />
      <span className={`font-bold uppercase tracking-wide text-accent ${compact ? "text-[8px]" : "text-[10px]"}`}>
        {icono.codigo}
      </span>
      {!compact && (
        <span className="text-xs font-semibold leading-tight text-ink">{icono.nombre}</span>
      )}
    </button>
  );
}

function DetalleLateral({
  icono,
  onCopiarSvg,
  copiado,
  onDescargar,
  onCopiarCodigo,
  onInsertar,
  compact,
}: {
  icono: GHSIcono;
  onCopiarSvg: () => void;
  copiado: boolean;
  onDescargar: () => void;
  onCopiarCodigo: () => void;
  onInsertar?: () => void;
  compact?: boolean;
}) {
  const sz = compact ? "h-20 w-20" : "h-28 w-28";
  return (
    <div className={compact ? "border-t border-border pt-3" : "w-60 shrink-0 overflow-y-auto border-l border-border bg-surface-panel p-4"}>
      <div
        className={`mx-auto mb-3 ${sz}`}
        dangerouslySetInnerHTML={{ __html: icono.svg }}
      />
      <p className="text-center text-[10px] font-bold uppercase tracking-widest text-accent">
        {icono.codigo}
      </p>
      <p className="mt-0.5 text-center text-xs font-bold text-ink">{icono.nombre}</p>
      {!compact && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{icono.descripcion}</p>
      )}

      <div className="mt-3 space-y-1.5">
        {onInsertar && (
          <button
            type="button"
            onClick={onInsertar}
            className="w-full rounded-lg bg-accent py-1.5 text-xs font-bold text-white hover:opacity-90"
          >
            ↳ Insertar en lienzo
          </button>
        )}
        <button
          type="button"
          onClick={onCopiarSvg}
          className={`w-full rounded-lg py-1.5 text-xs font-semibold transition ${
            copiado ? "bg-green-500 text-white" : "border border-border text-ink-secondary hover:bg-surface-hover"
          }`}
        >
          {copiado ? "¡Copiado!" : "Copiar SVG"}
        </button>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onDescargar}
            className="flex-1 rounded-lg border border-border py-1.5 text-xs text-ink-secondary hover:bg-surface-hover"
          >
            Descargar
          </button>
          <button
            type="button"
            onClick={onCopiarCodigo}
            className="flex-1 rounded-lg border border-border py-1.5 text-xs text-ink-secondary hover:bg-surface-hover"
          >
            Código
          </button>
        </div>
      </div>

      {!compact && (
        <div className="mt-4 rounded-lg bg-surface p-2 text-[9px] text-muted">
          <p className="font-semibold">Norma</p>
          <p>GHS Rev.9 / NTC 4435 / Res. 773/2021 CO</p>
        </div>
      )}
    </div>
  );
}

export function GHSIconsPicker({ onCerrar, compact = false, onInsertar }: Props) {
  const [seleccionado, setSeleccionado] = useState<GHSIcono | null>(null);
  const [copiado, setCopiado] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  async function handleCopiarSvg() {
    if (!seleccionado) return;
    const ok = await copiarSvgAlPortapapeles(seleccionado.svg);
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  }

  function handleDescargar() {
    if (!seleccionado) return;
    descargarSvg(seleccionado);
  }

  function handleCopiarCodigo() {
    if (!seleccionado) return;
    navigator.clipboard.writeText(seleccionado.codigo).catch(() => {});
  }

  function handleInsertar() {
    if (!seleccionado || !onInsertar) return;
    onInsertar(ghsSvgADataUrl(seleccionado.svg));
  }

  function onDragStartSvg(e: React.DragEvent, svg: string, label = "") {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/ghs-icon", svg);
    e.dataTransfer.setData("text/plain", label);
    const ghost = document.createElement("div");
    ghost.innerHTML = svg;
    ghost.style.cssText = "position:fixed;top:-200px;left:-200px;width:64px;height:64px;opacity:0.85;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 32, 32);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }

  const cols = compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5";

  const gridIconos = (
    <div className={`grid gap-2 ${cols}`}>
      {GHS_ICONOS.map((icono) => (
        <GHSIconCard
          key={icono.codigo}
          icono={icono}
          seleccionado={seleccionado?.codigo === icono.codigo}
          compact={compact}
          onClick={() =>
            setSeleccionado((prev) =>
              prev?.codigo === icono.codigo ? null : icono,
            )
          }
          onDragStart={(e) => onDragStartSvg(e, icono.svg, icono.codigo)}
        />
      ))}
    </div>
  );

  // ── Modo compacto: panel flotante (no bloquea el lienzo) ──────────────────
  if (compact) {
    return (
      <div
        className="fixed right-4 top-20 z-40 flex max-h-[80vh] w-72 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div>
            <span className="text-xs font-bold text-ink">Pictogramas GHS / SGA</span>
            <span className="ml-1.5 text-[9px] text-muted">arrastra al lienzo</span>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded p-1 text-muted hover:bg-surface-hover hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {gridIconos}
          <SelectorMarcoGHS
            compact
            onDragStart={(e, svg) => onDragStartSvg(e, svg, "Marco GHS")}
            onInsertar={onInsertar}
          />
          {seleccionado && (
            <DetalleLateral
              icono={seleccionado}
              compact
              onCopiarSvg={handleCopiarSvg}
              copiado={copiado}
              onDescargar={handleDescargar}
              onCopiarCodigo={handleCopiarCodigo}
              onInsertar={onInsertar ? handleInsertar : undefined}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Modo modal completo (vista lista / Studio Etiquetas) ──────────────────
  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCerrar();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-ink">Pictogramas GHS / SGA</h2>
            <p className="mt-0.5 text-xs text-muted">
              Sistema Globalmente Armonizado · UNECE Rev.9 · Haz clic para ver detalle
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-ink"
            aria-label="Cerrar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            {gridIconos}
            <SelectorMarcoGHS
              onDragStart={(e, svg) => onDragStartSvg(e, svg, "Marco GHS")}
            />
            <p className="mt-4 text-center text-[10px] leading-relaxed text-muted">
              Pictogramas de dominio público (UNECE GHS). Para uso en SDS y etiquetado de productos químicos y materias primas.
            </p>
          </div>

          {seleccionado && (
            <DetalleLateral
              icono={seleccionado}
              onCopiarSvg={handleCopiarSvg}
              copiado={copiado}
              onDescargar={handleDescargar}
              onCopiarCodigo={handleCopiarCodigo}
            />
          )}
        </div>
      </div>
    </div>
  );
}
