import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode, type RefObject } from "react";
import GrabadorVoz, { CLASE_BOTON_REDONDO, IconoEnviar } from "./GrabadorVoz";

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
  texto, onTexto, onEnviar, onVoz, hayAdjunto, enviando, iconos, iconosSinTexto, onPaste, onError,
  placeholder = "Mensaje", textareaRef,
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
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onError?: (mensaje: string) => void;
  placeholder?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [grabando, setGrabando] = useState(false);
  const propio = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? propio;
  const hayAlgo = Boolean(texto.trim()) || Boolean(hayAdjunto);

  // Crece con el texto (hasta ~6 líneas) y vuelve a una línea al enviar.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [texto, ref]);

  return (
    <div className="flex items-end gap-2">
      {!grabando && (
        <div className="flex min-h-[48px] min-w-0 flex-1 items-end rounded-[24px] border border-border bg-surface-input pl-4 pr-1 shadow-sm focus-within:border-accent/60">
          <textarea
            ref={ref}
            value={texto}
            onChange={(e) => onTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (hayAlgo && !enviando) onEnviar(); } }}
            onPaste={onPaste}
            rows={1}
            placeholder={placeholder}
            className="mck-field-lg !m-0 min-w-0 flex-1 resize-none !rounded-none !border-0 !bg-transparent !px-0 !py-3 !text-[16px] !leading-snug text-ink !shadow-none !outline-none placeholder:text-muted"
            style={{ minHeight: 46, maxHeight: 150 }}
          />
          <div className="flex shrink-0 items-center self-end pb-[3px]">
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
