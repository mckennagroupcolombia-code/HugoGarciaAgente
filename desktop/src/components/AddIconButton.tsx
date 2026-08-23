import type { ButtonHTMLAttributes } from "react";
import { Icon } from "../icons";

const BASE =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-[0_2px_0_rgb(var(--mck-accent-hover))] hover:brightness-110 active:translate-y-px active:shadow-none disabled:opacity-40 disabled:pointer-events-none";

type Props = {
  /** Nombre de lo que se crea. Al pasar el mouse. Si `open`, muestra Cancelar. */
  title: string;
  /** Formulario ya abierto: el icono pasa a cerrar. */
  open?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "children" | "type">;

export function AddIconButton({ title, open = false, className = "", ...rest }: Props) {
  const label = open ? "Cancelar" : title;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`${BASE} ${className}`}
      {...rest}
    >
      <Icon name={open ? "close" : "plus"} size={18} weight="bold" />
    </button>
  );
}
