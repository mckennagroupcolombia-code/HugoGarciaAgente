import { forwardRef, useCallback, type ChangeEvent, type InputHTMLAttributes } from "react";
import { applySentenceCapitals, PROSE_TEXTAREA_ATTRS } from "../lib/proseText";

export interface ProseInputProps extends InputHTMLAttributes<HTMLInputElement> {
  prose?: boolean;
}

/** Input de una línea con corrector ortográfico y mayúscula tras punto. */
export const ProseInput = forwardRef<HTMLInputElement, ProseInputProps>(
  function ProseInput({ prose = true, onChange, className, ...rest }, ref) {
    const handleChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        if (!prose || !onChange) {
          onChange?.(e);
          return;
        }
        const next = applySentenceCapitals(e.target.value);
        if (next === e.target.value) {
          onChange(e);
          return;
        }
        const el = e.target;
        const start = el.selectionStart ?? next.length;
        const end = el.selectionEnd ?? next.length;
        el.value = next;
        el.setSelectionRange(start, end);
        onChange({ ...e, target: el, currentTarget: el } as ChangeEvent<HTMLInputElement>);
      },
      [onChange, prose],
    );

    const proseProps = prose ? PROSE_TEXTAREA_ATTRS : { spellCheck: false as const };

    return (
      <input
        ref={ref}
        {...rest}
        {...proseProps}
        className={className}
        onChange={handleChange}
      />
    );
  },
);
