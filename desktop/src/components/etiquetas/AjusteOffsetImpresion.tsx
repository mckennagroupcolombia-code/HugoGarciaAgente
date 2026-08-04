import type { ReactNode } from "react";

/** Controles de offset compactos — desplazamiento de la etiqueta en mm. */

const RIB_INP =
  "h-6 w-11 rounded border border-border bg-surface px-1 text-center text-[10px] text-ink outline-none focus:border-accent";

function IconoEtiquetaBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 44 52" className="h-6 w-5 shrink-0 text-accent/80" aria-hidden>
      <rect
        x="5"
        y="3"
        width="34"
        height="46"
        rx="2.5"
        fill="currentColor"
        opacity="0.07"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="12"
        y="16"
        width="20"
        height="14"
        rx="1.5"
        fill="currentColor"
        opacity="0.32"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeOpacity="0.5"
      />
      {children}
    </svg>
  );
}

function IconoOffsetVertical() {
  return (
    <IconoEtiquetaBase>
      <path d="M22 8 L19 11 H25 Z" fill="currentColor" opacity="0.85" />
      <line x1="22" y1="11" x2="22" y2="5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M22 44 L19 41 H25 Z" fill="currentColor" opacity="0.85" />
      <line x1="22" y1="41" x2="22" y2="47" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </IconoEtiquetaBase>
  );
}

function IconoOffsetHorizontal() {
  return (
    <IconoEtiquetaBase>
      <path d="M8 26 L11 23 V29 Z" fill="currentColor" opacity="0.85" />
      <line x1="11" y1="26" x2="5" y2="26" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M36 26 L33 23 V29 Z" fill="currentColor" opacity="0.85" />
      <line x1="33" y1="26" x2="39" y2="26" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </IconoEtiquetaBase>
  );
}

function CeldaOffset({
  icono,
  titulo,
  value,
  onChange,
  step = 0.1,
}: {
  icono: ReactNode;
  titulo: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  const ajustar = (delta: number) => {
    const next = Math.round((value + delta) * 10) / 10;
    onChange(next);
  };

  return (
    <div className="flex items-center gap-1" title={`${titulo} (mm)`}>
      {icono}
      <button
        type="button"
        aria-label={`Menos ${titulo.toLowerCase()}`}
        onClick={() => ajustar(-step)}
        className="flex h-6 w-5 items-center justify-center rounded border border-border text-[11px] font-semibold text-ink-secondary hover:bg-surface-hover"
      >
        −
      </button>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={RIB_INP}
        title={`${titulo} en milímetros`}
        aria-label={titulo}
      />
      <span className="text-[8px] text-muted">mm</span>
      <button
        type="button"
        aria-label={`Más ${titulo.toLowerCase()}`}
        onClick={() => ajustar(step)}
        className="flex h-6 w-5 items-center justify-center rounded border border-border text-[11px] font-semibold text-ink-secondary hover:bg-surface-hover"
      >
        +
      </button>
    </div>
  );
}

export function AjusteOffsetImpresion({
  offsetV,
  offsetH,
  onOffsetVChange,
  onOffsetHChange,
}: {
  offsetV: number;
  offsetH: number;
  onOffsetVChange: (v: number) => void;
  onOffsetHChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CeldaOffset
        icono={<IconoOffsetVertical />}
        titulo="Arriba / Abajo"
        value={offsetV}
        onChange={onOffsetVChange}
      />
      <CeldaOffset
        icono={<IconoOffsetHorizontal />}
        titulo="Izquierda / Derecha"
        value={offsetH}
        onChange={onOffsetHChange}
      />
    </div>
  );
}
