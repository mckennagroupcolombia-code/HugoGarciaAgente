import type { ReactNode } from "react";
import { Ico } from "./Ico";
import { resolveTopicIcon } from "./emojiMap";

const INICIAL = /^((?:[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]|[☀-➿⬀-⯿]️?)️?)\s*/u;

/**
 * Para textos que llegan como CADENA («🎫 Generar ticket», el `label` de una tabla de estados):
 * si empiezan por un emoji con icono asignado, lo dibuja como icono lineal y deja el resto igual.
 * Lo que no empieza por emoji —o no tiene icono— se devuelve tal cual.
 */
export function ico(texto: string | null | undefined): ReactNode {
  const t = texto ?? "";
  const m = t.match(INICIAL);
  if (!m || !resolveTopicIcon(m[1])) return t;
  const resto = t.slice(m[0].length);
  return (
    <>
      <Ico e={m[1]} />
      {resto ? ` ${resto}` : null}
    </>
  );
}
