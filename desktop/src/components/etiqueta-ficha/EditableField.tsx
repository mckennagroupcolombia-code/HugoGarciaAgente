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
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FUENTES_DISPONIBLES, useTextStyleCtx } from "./TextStyleContext";

/** Atributo para reconocer el menú (ya portado a `document.body`) como
 *  "dentro" del campo al detectar clics afuera — ver uso en los
 *  `mousedown` listeners de `EditableField`/`EditableLabel`. */
const ATTR_MENU_TAMANO = "data-menu-tamano-fuente";

/** Posición en pantalla (coords. de viewport) del punto de anclaje del
 *  menú — se recalcula si cambia scroll/resize mientras está abierto. El
 *  lienzo puede estar dentro de un contenedor con `overflow-hidden` (o
 *  escalado por el marco de formato), así que el menú se porta a
 *  `document.body` y se posiciona con estas coordenadas absolutas en vez
 *  de `position: absolute` relativo a un ancestro — si no, quedaba
 *  recortado por ese `overflow-hidden` en vez de superponerse al lienzo. */
function usePosicionAnclaje(anchorEl: HTMLElement | null): { top: number; left: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchorEl) {
      setPos(null);
      return;
    }
    const actualizar = () => {
      const r = anchorEl.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
    };
    actualizar();
    window.addEventListener("scroll", actualizar, true);
    window.addEventListener("resize", actualizar);
    return () => {
      window.removeEventListener("scroll", actualizar, true);
      window.removeEventListener("resize", actualizar);
    };
  }, [anchorEl]);
  return pos;
}

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
  /** En edición, el marco punteado se ve SIEMPRE (no solo al pasar el
   *  ratón): delimita el tamaño real del cuadro — p. ej. los 3 renglones
   *  reservados de los textos descriptivos, que con texto corto quedan en
   *  blanco y no se distinguen. No afecta la vista ni el PNG. */
  marcoVisible?: boolean;
}

/** Menú flotante de tamaño/fuente compartido por `EditableField` (valores
 *  editables) y `EditableLabel` (títulos fijos, ej. "ORIGEN") — misma
 *  casilla de override en `TextStyleContext` para ambos.
 *
 *  Se porta a `document.body` (en vez de vivir como hijo `absolute` del
 *  campo) para poder superponerse al lienzo aunque este tenga
 *  `overflow-hidden` (esquinas redondeadas, patrón de retícula) o esté
 *  escalado dentro del marco de formato — si no, quedaba recortado justo
 *  en el borde del lienzo en vez de flotar sobre él. */
export function MenuTamanoFuente({
  styleKey,
  fontSize,
  anchorRef,
  opcionesTexto,
}: {
  styleKey: string;
  fontSize: number;
  anchorRef: RefObject<HTMLElement | null>;
  /** Títulos alternativos entre los que se puede escoger (ej. "Composición"
   *  o "Fórmula molecular"). */
  opcionesTexto?: { opciones: readonly string[]; actual: string; onElegir: (v: string) => void };
}) {
  const { estilos, setEstilo, setAbierto } = useTextStyleCtx();
  const override = estilos[styleKey];
  const pos = usePosicionAnclaje(anchorRef.current);
  if (typeof document === "undefined" || !pos) return null;

  return createPortal(
    <div
      {...{ [ATTR_MENU_TAMANO]: true }}
      style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
      className="z-[300] flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface-panel px-2.5 py-1.5 text-xs text-ink shadow-2xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {opcionesTexto && (
        <label className="flex items-center gap-1">
          <span className="text-muted">Título</span>
          <select
            value={opcionesTexto.actual}
            onChange={(e) => opcionesTexto.onElegir(e.target.value)}
            className="rounded border border-border bg-surface-input px-1 py-0.5 text-xs font-semibold"
          >
            {opcionesTexto.opciones.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )}
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
    </div>,
    document.body,
  );
}

/** Un clic cae "adentro" del campo si toca el propio wrapper o el menú ya
 *  portado a `document.body` (que dejó de ser descendiente del wrapper en
 *  el DOM real). */
function clicAdentro(wrap: HTMLElement | null, target: Node): boolean {
  if (wrap && wrap.contains(target)) return true;
  return target instanceof Element ? Boolean(target.closest(`[${ATTR_MENU_TAMANO}]`)) : false;
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
  opciones,
  valorOpcion,
  onElegirOpcion,
}: {
  texto: string;
  editMode: boolean;
  styleKey: string;
  defaultFontSize: number;
  className?: string;
  as?: "span" | "p" | "div";
  /** Títulos entre los que se puede escoger desde el menú (con `valorOpcion`
   *  y `onElegirOpcion`); `texto` es lo que se muestra. */
  opciones?: readonly string[];
  valorOpcion?: string;
  onElegirOpcion?: (v: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { estilos, abierto, setAbierto } = useTextStyleCtx();
  const override = estilos[styleKey];
  const menuAbierto = abierto === styleKey;

  useEffect(() => {
    if (!menuAbierto) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!clicAdentro(wrapRef.current, e.target as Node)) setAbierto(null);
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
        title={opciones ? "Cambiar título/tamaño/fuente" : "Cambiar tamaño/fuente"}
        className={`${className} inline-block cursor-pointer rounded-sm border border-dashed border-transparent bg-transparent p-0 hover:border-[color:var(--acento-50)]`}
        style={estiloFinal}
      >
        {texto}
      </button>
      {menuAbierto && (
        <MenuTamanoFuente
          styleKey={styleKey}
          fontSize={fontSize}
          anchorRef={wrapRef}
          opcionesTexto={
            opciones && onElegirOpcion
              ? { opciones, actual: valorOpcion ?? opciones[0], onElegir: onElegirOpcion }
              : undefined
          }
        />
      )}
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
  marcoVisible,
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
      if (!clicAdentro(wrapRef.current, e.target as Node)) setAbierto(null);
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
  const bordeReposo = marcoVisible
    ? variant === "dark" ? "border-white/50" : "border-[color:var(--acento-50)]"
    : "border-transparent";
  const editCls =
    variant === "dark"
      ? `${className} mck-field-lg w-full resize-none rounded-sm bg-transparent outline-none transition-colors `
        + `border border-dashed ${bordeReposo} hover:border-white/60 focus:border-white focus:bg-white/10`
      : `${className} mck-field-lg w-full resize-none rounded-sm bg-transparent outline-none transition-colors `
        + `border border-dashed ${bordeReposo} hover:border-[color:var(--acento-50)] focus:border-[color:var(--acento)] focus:bg-[color:var(--acento-05)]`;

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
        <MenuTamanoFuente
          styleKey={styleKey}
          fontSize={estiloFinal.fontSize as number}
          anchorRef={wrapRef}
        />
      )}
    </div>
  );
}
