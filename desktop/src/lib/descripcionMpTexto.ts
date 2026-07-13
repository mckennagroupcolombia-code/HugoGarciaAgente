/** Parseo / formato del bloque Descripción MP (intro + Propiedades + viñetas). */

export interface DescripcionMpPartes {
  intro: string;
  bullets: string[];
  /** true si el texto ya traía el encabezado Propiedades: */
  estructurado: boolean;
}

const RE_PROPIEDADES = /(?:^|\n)\s*Propiedades\s*:\s*/i;

export function partirDescripcionMp(texto: string): DescripcionMpPartes {
  const t = (texto || "").replace(/\r\n/g, "\n").trim();
  if (!t) return { intro: "", bullets: [], estructurado: false };

  const m = RE_PROPIEDADES.exec(t);
  if (!m || m.index === undefined) {
    return { intro: t, bullets: [], estructurado: false };
  }

  const intro = t.slice(0, m.index).trim();
  const resto = t.slice(m.index + m[0].length).trim();
  const bullets: string[] = [];
  for (const ln of resto.split("\n")) {
    const limpio = ln.replace(/^[\u2022•\-\*·\.]\s*/, "").trim();
    if (limpio) bullets.push(limpio);
  }
  return { intro, bullets, estructurado: true };
}

export function formatearDescripcionMp(intro: string, bullets: string[]): string {
  const i = (intro || "").replace(/\s+\n/g, "\n").trim();
  const limpios = bullets
    .map((b) => b.replace(/^[\u2022•\-\*·\.]\s*/, "").trim())
    .filter(Boolean)
    .map((b) => (/[.!?]$/.test(b) ? b : `${b}.`));

  if (limpios.length === 0) return i;

  const bloque = ["Propiedades:", ...limpios.map((b) => `• ${b}`)].join("\n");
  return i ? `${i}\n\n${bloque}` : bloque;
}

export function esTextoDescripcionMpEstructurado(texto: string): boolean {
  return RE_PROPIEDADES.test(texto || "");
}
