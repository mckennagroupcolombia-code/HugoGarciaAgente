/**
 * Campo editable compartido por toda la ficha: en VIEW MODE se ve como
 * texto terminado (sin caja de input); en EDIT MODE se convierte en
 * input/textarea sin borde propio, integrado en la misma retícula — nunca
 * cambia el tamaño del bloque al alternar de modo.
 *
 * Al enfocar una casilla en modo edición se abre un menú flotante de
 * tamaño/fuente para esa casilla puntual — evita seguir describiendo
 * tamaños en píxeles por chat; el operador los ajusta directamente.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { FUENTES_DISPONIBLES, useTextStyleCtx } from "./TextStyleContext";

interface Props {
  value: string;
  onChange: (v: string) => void;
  editMode: boolean;
  /** Identificador único de esta casilla (ej. "origin", "productName") —
   *  guarda su override de tamaño/fuente y qué menú está abierto. */
  styleKey: string;
  /** Tamaño base (px) si el operador no ha elegido uno propio. */
  defaultFontSize: number;
  /** textarea autoexpandible en vez de input de una línea. */
  multiline?: boolean;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  /** "dark" = sobre fondo naranja sólido (banda de clasificación, banda web):
   *  el foco/hover se marca en blanco en vez de en naranja, que quedaría
   *  invisible sobre su propio color. */
  variant?: "light" | "dark";
  /** Se dispara al entrar en edición de este campo (ej. el nombre del
   *  producto abre el panel de fichas técnicas relacionadas). */
  onFocus?: () => void;
  /** No abrir el menú de tamaño/fuente al enfocar — para campos cuyo
   *  `onFocus` ya abre otra cosa a pantalla completa (el panel de fichas
   *  técnicas del nombre del producto): el menú flotante, con más z-index,
   *  quedaba encima de ese panel y bloqueaba los clics sobre él. */
  sinMenuTamano?: boolean;
}

/** Menú flotante de tamaño/fuente compartido por `EditableField` (valores
 *  editables) y `EditableLabel` (títulos fijos, ej. "ORIGEN") — misma
 *  casilla de override en `TextStyleContext` para ambos. */
export function MenuTamanoFuente({
  styleKey,
  fontSize,
}: {
  styleKey: string;
  fontSize: number;
}) {
  const { estilos, setEstilo, setAbierto } = useTextStyleCtx();
  const override = estilos[styleKey];
  return (
    <div
      className="absolute left-1/2 top-full z-[300] mt-1 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface-panel px-2.5 py-1.5 text-xs text-ink shadow-2xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1">
        <span className="text-muted">Tamaño</span>
        <input
          type="number"
          min={8}
          max={160}
          value={Math.round(fontSize)}
          onChange={(e) => setEstilo(styleKey, { fontSize: Number(e.target.value) || undefined })}
          className="w-14 rounded border border-border bg-surface-input px-1 py-0.5 text-xs"
        />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Fuente</span>
        <select
          value={override?.fontFamily ?? ""}
          onChange={(e) => setEstilo(styleKey, { fontFamily: e.target.value || undefined })}
          className="rounded border border-border bg-surface-input px-1 py-0.5 text-xs"
        >
          {FUENTES_DISPONIBLES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => setAbierto(null)} className="ml-1 text-muted hover:text-ink">
        ✕
      </button>
    </div>
  );
}

/** Título fijo (no editable como texto) que igual puede cambiar de
 *  tamaño/fuente — ej. "ORIGEN", "CONTENIDO NETO", "PUREZA:". A diferencia
 *  de `EditableField`, el texto nunca se convierte en input: solo abre el
 *  mismo menú flotante al hacer clic. */
export function EditableLabel({
  texto,
  editMode,
  styleKey,
  defaultFontSize,
  className = "",
  as = "span",
}: {
  texto: string;
  editMode: boolean;
  styleKey: string;
  defaultFontSize: number;
  className?: string;
  as?: "span" | "p" | "div";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { estilos, abierto, setAbierto } = useTextStyleCtx();
  const override = estilos[styleKey];
  const menuAbierto = abierto === styleKey;

  useEffect(() => {
    if (!menuAbierto) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAbierto(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuAbierto, setAbierto]);

  const fontSize = override?.fontSize ?? defaultFontSize;
  const estiloFinal: CSSProperties = {
    fontSize,
    ...(override?.fontFamily ? { fontFamily: override.fontFamily } : {}),
  };

  if (!editMode) {
    const Tag = as;
    return <Tag className={className} style={estiloFinal}>{texto}</Tag>;
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setAbierto(menuAbierto ? null : styleKey)}
        title="Cambiar tamaño/fuente"
        className={`${className} inline-block cursor-pointer rounded-sm border border-dashed border-transparent bg-transparent p-0 hover:border-[#FFA500]/50`}
        style={estiloFinal}
      >
        {texto}
      </button>
      {menuAbierto && <MenuTamanoFuente styleKey={styleKey} fontSize={fontSize} />}
    </div>
  );
}

export default function EditableField({
  value,
  onChange,
  editMode,
  styleKey,
  defaultFontSize,
  multiline,
  className = "",
  style,
  placeholder,
  variant = "light",
  onFocus,
  sinMenuTamano,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { estilos, abierto, setAbierto } = useTextStyleCtx();
  const override = estilos[styleKey];
  const menuAbierto = !sinMenuTamano && abierto === styleKey;

  useEffect(() => {
    if (!multiline || !taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = `${taRef.current.scrollHeight}px`;
  }, [value, multiline, editMode, override?.fontSize, override?.fontFamily]);

  useEffect(() => {
    if (!menuAbierto) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAbierto(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuAbierto, setAbierto]);

  const estiloFinal: CSSProperties = {
    ...style,
    fontSize: override?.fontSize ?? style?.fontSize ?? defaultFontSize,
    ...(override?.fontFamily ? { fontFamily: override.fontFamily } : {}),
  };

  const abrirMenu = () => {
    if (!sinMenuTamano) setAbierto(styleKey);
    onFocus?.();
  };

  if (!editMode) {
    return multiline ? (
      <p className={className} style={estiloFinal}>{value || placeholder}</p>
    ) : (
      <span className={className} style={estiloFinal}>{value || placeholder}</span>
    );
  }

  // "mck-field-lg" es la clase de escape que ya existe en index.css para
  // salirse de la regla global `#root input/textarea { font-size: var(
  // --mck-field-fs) !important; }` que compacta todos los campos de la
  // app — sin ella, ningún tamaño elegido en el menú se ve: el !important
  // le gana siempre al `style` en línea.
  const editCls =
    variant === "dark"
      ? `${className} mck-field-lg w-full resize-none rounded-sm bg-transparent outline-none transition-colors `
        + `border border-dashed border-transparent hover:border-white/60 focus:border-white focus:bg-white/10`
      : `${className} mck-field-lg w-full resize-none rounded-sm bg-transparent outline-none transition-colors `
        + `border border-dashed border-transparent hover:border-[#FFA500]/50 focus:border-[#FFA500] focus:bg-[#FFA500]/5`;

  return (
    <div ref={wrapRef} className="relative w-full">
      {multiline ? (
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={abrirMenu}
          className={editCls}
          style={estiloFinal}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={abrirMenu}
          className={editCls}
          style={estiloFinal}
        />
      )}
      {menuAbierto && (
        <MenuTamanoFuente styleKey={styleKey} fontSize={estiloFinal.fontSize as number} />
      )}
    </div>
  );
}
