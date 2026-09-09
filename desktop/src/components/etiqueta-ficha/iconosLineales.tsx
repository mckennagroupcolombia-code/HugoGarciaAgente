/**
 * Íconos lineales propios (SVG, sin librería externa) — outline, sin
 * relleno, `stroke="currentColor"` para heredar el color naranja/blanco
 * desde el className del padre (ver especificación: "SVG propios").
 */
interface Props {
  size?: number;
  className?: string;
}

// strokeWidth subido de 2 a 2.6 — a 2 se veía muy delgado para imprimir
// (el trazo tiende a desaparecer o verse borroso a tamaños de etiqueta).
const base = { fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function IconoOrigen({ size = 26, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M4.5 7.5h15M4.5 16.5h15" />
    </svg>
  );
}

export function IconoApariencia({ size = 26, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3c3 3.2 6 6.8 6 10.2A6 6 0 1 1 6 13.2C6 9.8 9 6.2 12 3z" />
    </svg>
  );
}

export function IconoOlor({ size = 26, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M10 3v8a4 4 0 0 0 8 0v-2" />
      <path d="M14 13v3a5 5 0 0 1-10 0" />
      <path d="M6.5 20.5h4" />
    </svg>
  );
}

export function IconoComposicion({ size = 26, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9.5 3h5M10 3v6.2L5.6 18a1.5 1.5 0 0 0 1.3 2.2h10.2a1.5 1.5 0 0 0 1.3-2.2L14 9.2V3" />
      <path d="M7.8 15.5h8.4" />
    </svg>
  );
}

export function IconoGrado({ size = 26, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="9" r="5.5" />
      <path d="m9 13.5-1.8 7 4.8-2.6 4.8 2.6-1.8-7" />
    </svg>
  );
}

export function IconoConservacion({ size = 26, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M13 14.8V5.5a1.5 1.5 0 0 0-3 0v9.3a3.5 3.5 0 1 0 3 0z" />
      <path d="M11.5 8h1M11.5 10.5h1M11.5 13h1" />
    </svg>
  );
}

export function IconoUbicacion({ size = 16, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 21s-6.5-5.8-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.2-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

export function IconoTelefono({ size = 16, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 4.5h3.2l1.3 4-2 1.3a11 11 0 0 0 5 5l1.3-2 4 1.3V17.5a1.5 1.5 0 0 1-1.6 1.5A15 15 0 0 1 3.5 6.1 1.5 1.5 0 0 1 5 4.5z" />
    </svg>
  );
}

export function IconoCorreo({ size = 16, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="m4 6.5 8 6.5 8-6.5" />
    </svg>
  );
}
