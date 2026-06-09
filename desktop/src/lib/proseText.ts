export function applySentenceCapitals(text: string): string {
  if (!text) return text;

  const up = (ch: string) => ch.toLocaleUpperCase("es");

  let out = text.replace(/^(\s*)([a-záéíóúñü])/u, (_, sp, ch) => sp + up(ch));

  out = out.replace(
    /([.!?…][)"»']*)([\s\n]+)([a-záéíóúñü])/gu,
    (_, end, gap, ch) => end + gap + up(ch),
  );

  return out;
}

/** Aplica reglas de redacción (p. ej. texto dictado por voz). */
export function proseText(text: string): string {
  return applySentenceCapitals(text);
}

export const PROSE_TEXTAREA_ATTRS = {
  spellCheck: true,
  lang: "es-CO",
  autoCorrect: "on",
  autoCapitalize: "sentences",
} as const;
