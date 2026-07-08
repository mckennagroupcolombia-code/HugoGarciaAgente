import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";

interface ModalProps {
  onClose: () => void;
  title?: ReactNode;
  /** Contenido extra en la cabecera (botones de acción), a la derecha del título. */
  headerExtra?: ReactNode;
  /** "accent" replica la barra de título estilo Word del editor de diagramación. */
  headerTone?: "neutral" | "accent";
  variant?: "dialog" | "fullscreen";
  maxWidthClassName?: string;
  /** Dialog: usa h-[90vh] fija en vez de max-h-[90vh] — para contenido que debe llenar todo el alto (editores con canvas). */
  fixedHeight?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({
  onClose,
  title,
  headerExtra,
  headerTone = "neutral",
  variant = "dialog",
  maxWidthClassName = "max-w-4xl",
  fixedHeight = false,
  footer,
  children,
}: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const headerCls =
    headerTone === "accent"
      ? "border-b border-accent/30 bg-accent px-4 py-2 text-white"
      : "border-b border-border px-4 py-2.5 text-ink";

  const panel =
    variant === "fullscreen" ? (
      <div className="fixed inset-0 z-40 flex flex-col bg-black/40">
        <div
          className={`mx-auto flex h-full w-full ${maxWidthClassName} flex-col overflow-hidden border-x border-border bg-surface-panel shadow-paper-lg`}
        >
          {(title || headerExtra) && (
            <div className={`flex flex-shrink-0 items-center gap-3 ${headerCls}`}>
              {title && <div className="min-w-0 flex-1 truncate text-sm font-bold">{title}</div>}
              {headerExtra}
              <IconButton
                icon="close"
                label="Cerrar"
                size="sm"
                className={headerTone === "accent" ? "text-white hover:bg-white/15" : ""}
                onClick={onClose}
              />
            </div>
          )}
          <div className="flex-1 overflow-auto">{children}</div>
          {footer && <div className="flex-shrink-0 border-t border-border px-4 py-2.5">{footer}</div>}
        </div>
      </div>
    ) : (
      <div
        className="fixed inset-0 z-[700] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className={`flex ${fixedHeight ? "h-[90vh]" : "max-h-[90vh]"} w-full ${maxWidthClassName} flex-col overflow-hidden rounded-paper-lg border border-border bg-surface-panel shadow-paper-lg`}
          onClick={(e) => e.stopPropagation()}
        >
          {(title || headerExtra) && (
            <div className={`flex items-center justify-between gap-3 ${headerCls}`}>
              {title && <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>}
              <div className="flex shrink-0 items-center gap-1.5">
                {headerExtra}
                <IconButton
                  icon="close"
                  label="Cerrar"
                  size="sm"
                  className={headerTone === "accent" ? "text-white hover:bg-white/15" : ""}
                  onClick={onClose}
                />
              </div>
            </div>
          )}
          <div className="flex-1 overflow-auto">{children}</div>
          {footer && <div className="flex-shrink-0 border-t border-border px-4 py-2.5">{footer}</div>}
        </div>
      </div>
    );

  return createPortal(panel, document.body);
}
