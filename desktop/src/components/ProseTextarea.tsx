import { forwardRef, useCallback, type ChangeEvent, type TextareaHTMLAttributes } from "react";
import { applySentenceCapitals, PROSE_TEXTAREA_ATTRS } from "../lib/proseText";

export interface ProseTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Corrección ortográfica y mayúsculas tras punto (default: true). */
  prose?: boolean;
}

/**
 * Textarea con corrector ortográfico del navegador (es-CO) y mayúscula automática
 * después de punto, signo de cierre o salto de línea.
 */
export const ProseTextarea = forwardRef<HTMLTextAreaElement, ProseTextareaProps>(
  function ProseTextarea({ prose = true, onChange, className, ...rest }, ref) {
    const handleChange = useCallback(
      (e: ChangeEvent<HTMLTextAreaElement>) => {
        if (!prose || !onChange) {
          onChange?.(e);
          return;
        }
        const raw = e.target.value;
        const next = applySentenceCapitals(raw);
        if (next === raw) {
          onChange(e);
          return;
        }
        const el = e.target;
        const start = el.selectionStart ?? next.length;
        const end = el.selectionEnd ?? next.length;
        el.value = next;
        el.setSelectionRange(start, end);
        onChange({ ...e, target: el, currentTarget: el } as ChangeEvent<HTMLTextAreaElement>);
      },
      [onChange, prose],
    );

    const proseProps = prose ? PROSE_TEXTAREA_ATTRS : { spellCheck: false as const };

    return (
      <textarea
        ref={ref}
        {...rest}
        {...proseProps}
        className={className}
        onChange={handleChange}
      />
    );
  },
);
