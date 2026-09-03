import { ACCENT_PRESETS } from "../theme/presets";
import { hexToRgb, rgbToHex } from "../theme/applyTheme";

export const CUENTA_COBRO_ACCENT_LS_KEY = "mck-cuenta-cobro-accent-rgb";

/** Lee el último acento elegido para PDF de cuenta de cobro (o fallback). */
export function leerAccentCuentaCobro(fallbackRgb: string): string {
  try {
    const saved = localStorage.getItem(CUENTA_COBRO_ACCENT_LS_KEY)?.trim();
    if (saved && /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(saved)) return saved;
  } catch {
    /* ignore */
  }
  return fallbackRgb;
}

export function guardarAccentCuentaCobro(rgb: string): void {
  try {
    localStorage.setItem(CUENTA_COBRO_ACCENT_LS_KEY, rgb.trim());
  } catch {
    /* ignore */
  }
}

type Props = {
  value: string;
  onChange: (rgb: string) => void;
  disabled?: boolean;
  /** compact = solo swatches, sin título */
  compact?: boolean;
  /** Título encima de los swatches */
  label?: string;
  /** Texto de ayuda debajo */
  hint?: string;
};

/**
 * Selector de color de acento para el PDF de cuenta de cobro (compras exterior).
 * Por defecto se sincroniza con el tema del emisor (p. ej. Armando).
 */
export default function CuentaCobroAccentPicker({
  value,
  onChange,
  disabled,
  compact,
  label = "Color del PDF",
  hint,
}: Props) {
  const hex = rgbToHex(value);
  const set = (rgb: string) => {
    const next = rgb.trim();
    onChange(next);
    guardarAccentCuentaCobro(next);
  };

  return (
    <div className={compact ? "" : "space-y-1.5"}>
      {!compact && (
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
          {label}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {ACCENT_PRESETS.map((p) => {
          const selected = value === p.rgb;
          return (
            <button
              key={p.id}
              type="button"
              title={p.label}
              disabled={disabled}
              onClick={() => set(p.rgb)}
              className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-40"
              style={{
                backgroundColor: p.hex,
                borderColor: selected ? "#fff" : p.hex,
                outline: selected ? `2px solid ${p.hex}` : "none",
                outlineOffset: selected ? 1 : 0,
              }}
            />
          );
        })}
        <label
          className="flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border"
          title="Color personalizado"
        >
          <input
            type="color"
            value={hex}
            disabled={disabled}
            onChange={(e) => set(hexToRgb(e.target.value))}
            className="h-8 w-8 cursor-pointer border-0 bg-transparent p-0 disabled:opacity-40"
            aria-label="Color personalizado del PDF"
          />
        </label>
        <span className="font-mono text-[10px] text-muted">{hex}</span>
      </div>
      {!compact && hint ? (
        <p className="text-[10px] text-muted leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}
