import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { imagenDesdePortapapeles } from "../../lib/clipboardImage";
import { Cara } from "../../lib/fotoPersona";
import GrabadorVoz, { CLASE_BOTON_REDONDO, IconoEnviar } from "./GrabadorVoz";
import { consultaEnCurso, sugerencias, type Persona } from "../../lib/menciones";
import { colorDePersona } from "../../lib/personaColor";
import { SelectorEmojiPixel } from "./emojiPixel";

export function IconoClip() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
    </svg>
  );
}

export function IconoCamara() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

export function IconoEnlace() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  );
}

/** Ícono dentro de la caja de texto (📎, 📷, 🔗). */
export function BotonCaja({ onClick, titulo, activo, children }: { onClick: () => void; titulo: string; activo?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-label={titulo} aria-pressed={activo}
      className={`mck-btn-no-fx flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-accent/10 ${activo ? "text-accent" : "text-muted hover:text-ink"}`}>
      {children}
    </button>
  );
}

/**
 * Barra de escritura al estilo WhatsApp: caja redondeada ancha con los íconos adentro a la
 * derecha y un botón redondo afuera que es 🎤 con la caja vacía y ➤ cuando hay algo que mandar.
 */
export default function BarraEscritura({
  texto, onTexto, onEnviar, onVoz, hayAdjunto, enviando, iconos, iconosSinTexto, onImagenPegada, onError,
  placeholder = "Mensaje", textareaRef, personas,
}: {
  texto: string;
  onTexto: (t: string) => void;
  onEnviar: () => void;
  onVoz: (archivo: File) => void;
  /** Hay foto, archivo o vínculo listo: el botón pasa a ➤ aunque no haya texto. */
  hayAdjunto?: boolean;
  enviando?: boolean;
  /** Íconos siempre visibles dentro de la caja (📎, 🔗). */
  iconos?: ReactNode;
  /** Íconos que se esconden al escribir, como la cámara de WhatsApp. */
  iconosSinTexto?: ReactNode;
  /** Ctrl+V de una captura de pantalla o imagen copiada: llega como archivo listo para adjuntar. */
  onImagenPegada?: (archivo: File) => void;
  onError?: (mensaje: string) => void;
  placeholder?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Quién se puede nombrar con @: al escribir «@» aparece la lista para elegir. */
  personas?: Persona[];
}) {
  const [grabando, setGrabando] = useState(false);
  const propio = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? propio;
  const hayAlgo = Boolean(texto.trim()) || Boolean(hayAdjunto);
  // Autocompletar de @: lo que va escrito tras el @ junto al cursor.
  const [cursor, setCursor] = useState(0);
  const consulta = personas?.length ? consultaEnCurso(texto, cursor) : null;
  const opciones = consulta ? sugerencias(personas ?? [], consulta.q) : [];
  const [cerrada, setCerrada] = useState<number | null>(null);
  const abierta = Boolean(consulta && opciones.length && cerrada !== consulta.inicio);
  const elegir = (p: Persona) => {
    if (!consulta) return;
    const nuevo = `${texto.slice(0, consulta.inicio)}@${p.nombre} ${texto.slice(cursor)}`;
    const pos = consulta.inicio + p.nombre.length + 2;
    onTexto(nuevo);
    setCursor(pos);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); });
  };

  // Emoji pixel: entra donde está el cursor (se envía como el emoji Unicode de siempre).
  const insertarEmoji = (e: string) => {
    const pos = Math.min(cursor, texto.length);
    onTexto(`${texto.slice(0, pos)}${e}${texto.slice(pos)}`);
    const nueva = pos + e.length;
    setCursor(nueva);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(nueva, nueva); });
  };

  // Crece con el texto (hasta ~6 líneas) y vuelve a una línea al enviar.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [texto, ref]);

  return (
    <div className="relative flex items-end gap-2">
      {abierta && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(100%,20rem)] overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-paper-lg"
             role="listbox" aria-label="Nombrar a alguien">
          <p className="border-b border-border px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted">Nombrar a… (le llega el aviso)</p>
          {opciones.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === 0}
                    onMouseDown={(e) => { e.preventDefault(); elegir(p); }}
                    className={`mck-btn-no-fx flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/10 ${i === 0 ? "bg-accent/5" : ""}`}>
              <Cara uid={p.id} nombre={p.nombre} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-black text-white"
                    style={{ background: colorDePersona(p.nombre) }} fallback={p.nombre.slice(0, 1).toUpperCase()} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{p.nombre}</span>
            </button>
          ))}
        </div>
      )}
      {!grabando && (
        <div className="flex min-h-[48px] min-w-0 flex-1 items-end rounded-[24px] border border-border bg-surface-input pl-4 pr-1 shadow-sm focus-within:border-accent/60">
          <textarea
            ref={ref}
            value={texto}
            onChange={(e) => { onTexto(e.target.value); setCursor(e.target.selectionStart ?? e.target.value.length); }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              // Con la lista de @ abierta, Enter/Tab eligen a la primera persona y Esc la cierra.
              if (abierta && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); elegir(opciones[0]); return; }
              if (abierta && e.key === "Escape") { e.preventDefault(); setCerrada(consulta?.inicio ?? null); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (hayAlgo && !enviando) onEnviar(); }
            }}
            onPaste={(e) => {
              if (!onImagenPegada) return;
              const img = imagenDesdePortapapeles(e.clipboardData);
              if (!img) return; // texto: se pega normal
              e.preventDefault();
              onImagenPegada(new File([img], `captura-${Date.now()}.${(img.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: img.type || "image/png" }));
            }}
            rows={1}
            placeholder={placeholder}
            className="mck-field-lg !m-0 min-w-0 flex-1 resize-none !rounded-none !border-0 !bg-transparent !px-0 !py-3 !text-[16px] !leading-snug text-ink !shadow-none !outline-none placeholder:text-muted"
            style={{ minHeight: 46, maxHeight: 150 }}
          />
          <div className="flex shrink-0 items-center self-end pb-[3px]">
            <SelectorEmojiPixel onElegir={insertarEmoji} />
            {iconos}
            {!texto.trim() && iconosSinTexto}
          </div>
        </div>
      )}
      {hayAlgo && !grabando ? (
        <button type="button" onClick={onEnviar} disabled={enviando} className={CLASE_BOTON_REDONDO} title="Enviar" aria-label="Enviar">
          <IconoEnviar />
        </button>
      ) : (
        <GrabadorVoz onListo={onVoz} onGrabando={setGrabando} onError={onError} deshabilitado={enviando} />
      )}
    </div>
  );
}
