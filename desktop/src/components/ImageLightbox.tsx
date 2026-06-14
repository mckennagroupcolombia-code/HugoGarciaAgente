import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-sm font-bold text-ink shadow-lg hover:text-accent"
        >
          ✕
        </button>
        <img src={url} alt="" className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 right-2 rounded bg-black/50 px-2 py-0.5 text-[10px] text-white/70 transition-colors hover:text-white"
        >
          Abrir original ↗
        </a>
      </div>
    </div>,
    document.body,
  );
}
