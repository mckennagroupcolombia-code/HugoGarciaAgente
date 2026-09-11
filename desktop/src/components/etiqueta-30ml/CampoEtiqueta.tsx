/**
 * Casilla de texto de la etiqueta 30 mL, editable en el sitio — el mismo
 * manejo que `EditableField` de la ficha de 76 × 66: en vista es el texto
 * terminado; en edición, el mismo texto se vuelve casilla (borde punteado al
 * pasar/enfocar) y al enfocarla se abre el menú flotante de tamaño/fuente
 * (`MenuTamanoFuente`, guardado en `text_styles` de la ficha).
 *
 * Diferencia: aquí la retícula es fija, así que el tamaño elegido es el
 * MÁXIMO y el texto se encoge solo si no cabe (`useAjusteTexto`). Si ni al
 * mínimo cabe, la casilla se marca en rojo en edición.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { MenuTamanoFuente } from "../etiqueta-ficha/EditableField";
import { useTextStyleCtx } from "../etiqueta-ficha/TextStyleContext";
import { useAjusteTexto } from "./useAjusteTexto";

const ATTR_MENU_TAMANO = "data-menu-tamano-fuente";

export default function CampoEtiqueta({
  valor,
  onChange,
  editMode,
  styleKey,
  tam,
  maxLineas,
  cajaRef,
  ejemplo = "",
  mostrar,
  multilinea = false,
  oscuro = false,
  className = "",
  as: Tag = "p",
}: {
  valor: string;
  /** Sin `onChange` el texto no se edita (solo se ajusta a su casilla). */
  onChange?: (v: string) => void;
  editMode: boolean;
  /** Clave de la casilla en el menú de tamaño/fuente (`text_styles`). */
  styleKey: string;
  /** Tamaño por defecto (máximo) y mínimo del ajuste, en px de diseño. */
  tam: readonly [number, number];
  maxLineas?: number;
  cajaRef?: RefObject<HTMLElement | null>;
  /** Ejemplo gris mientras la casilla está vacía (solo en edición). */
  ejemplo?: string;
  /** Formato del texto terminado (p. ej. "500g" → "500 g"). */
  mostrar?: (v: string) => string;
  /** Casilla de varios renglones (Enter = salto de línea). */
  multilinea?: boolean;
  /** Sobre fondo de color (franjas, barra web): foco en blanco. */
  oscuro?: boolean;
  className?: string;
  as?: "p" | "span" | "h1";
}) {
  const { estilos, abierto, setAbierto } = useTextStyleCtx();
  const override = estilos[styleKey];
  const max = override?.fontSize ?? tam[0];
  const min = Math.min(tam[1], max);
  const editable = editMode && Boolean(onChange);
  const menuAbierto = editable && abierto === styleKey;

  const wrapRef = useRef<HTMLDivElement>(null);
  const textoRef = useRef<HTMLElement>(null);
  const [desborda, setDesborda] = useState(false);

  const vacio = !valor.trim();
  const visible = editable ? valor : vacio ? (editMode ? ejemplo : "") : mostrar ? mostrar(valor) : valor;
  // Casilla vacía en edición: se mide el ejemplo (es lo que se ve en gris).
  const medido = editable && vacio ? ejemplo : visible;

  useAjusteTexto(textoRef, medido, {
    max,
    min,
    maxLineas,
    cajaRef,
    autoAlto: editable && multilinea,
    clave: `${editable}|${override?.fontFamily ?? ""}`,
    onDesborde: setDesborda,
  });

  useEffect(() => {
    if (!menuAbierto) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest(`[${ATTR_MENU_TAMANO}]`)) return;
      setAbierto(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuAbierto, setAbierto]);

  const fuente = override?.fontFamily ? { fontFamily: override.fontFamily } : undefined;
  const marcaDesborde = editMode && desborda && !vacio;

  if (!editable) {
    return (
      <Tag
        ref={textoRef as RefObject<never>}
        className={`${className}${vacio ? " e30-ejemplo" : ""}${marcaDesborde ? " e30-desborde" : ""}`}
        style={fuente}
        title={marcaDesborde ? "No cabe completo en su casilla: acórtalo" : undefined}
      >
        {visible}
      </Tag>
    );
  }

  // mck-field-lg: se salta la regla global que fuerza el tamaño de letra de
  // todos los inputs de la app (con !important), igual que EditableField.
  const clases = `${className} e30-campo mck-field-lg${oscuro ? " e30-campo-oscuro" : ""}${
    marcaDesborde ? " e30-desborde" : ""
  }`;
  const comun = {
    value: valor,
    placeholder: ejemplo,
    onChange: (e: { target: { value: string } }) => onChange?.(e.target.value),
    onFocus: () => setAbierto(styleKey),
    className: clases,
    style: fuente,
    title: marcaDesborde ? "No cabe completo en su casilla: acórtalo" : undefined,
    spellCheck: false,
  };

  return (
    <div ref={wrapRef} className="e30-campo-wrap">
      {multilinea ? (
        <textarea ref={textoRef as RefObject<HTMLTextAreaElement>} rows={1} {...comun} />
      ) : (
        <input ref={textoRef as RefObject<HTMLInputElement>} type="text" {...comun} />
      )}
      {menuAbierto && <MenuTamanoFuente styleKey={styleKey} fontSize={max} anchorRef={wrapRef} />}
    </div>
  );
}
