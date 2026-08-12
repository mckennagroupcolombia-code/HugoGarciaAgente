import { useCallback, useEffect, useRef, useState } from "react";

export function abrirCamaraCaptura(opts: {
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  setCamaraOpen: (open: boolean) => void;
}) {
  const isTouch =
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (isTouch && opts.cameraInputRef.current) {
    opts.cameraInputRef.current.click();
    return;
  }
  if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia != null) {
    opts.setCamaraOpen(true);
    return;
  }
  opts.cameraInputRef.current?.click();
}

interface CamaraCapturaModalProps {
  open: boolean;
  titulo?: string;
  onClose: () => void;
  onCapture: (file: File) => void;
  /** Si true, no cierra el modal tras disparar (útil para varias fotos seguidas). */
  mantenerAbierto?: boolean;
}

export default function CamaraCapturaModal({
  open,
  titulo = "Tomar foto",
  onClose,
  onCapture,
  mantenerAbierto = false,
}: CamaraCapturaModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [capturando, setCapturando] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      setCapturando(false);
      return;
    }
    let cancelled = false;
    setError(null);
    setReady(false);

    (async () => {
      if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia == null) {
        setError("Este dispositivo no permite cámara en el navegador. Usa «Adjuntar archivo».");
        return;
      }
      try {
        stop();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /NotAllowed|Permission/i.test(msg)
            ? "Permiso de cámara denegado. Actívalo en el navegador y reintenta."
            : `No se pudo abrir la cámara: ${msg}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facing, stop]);

  const disparar = useCallback(() => {
    const video = videoRef.current;
    if (!video || !ready || capturando) return;
    setCapturando(true);
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCapturando(false);
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        setCapturando(false);
        if (!blob) {
          setError("No se pudo capturar la imagen.");
          return;
        }
        const file = new File([blob], `doc_tecnico_${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        if (!mantenerAbierto) onClose();
      },
      "image/jpeg",
      0.92,
    );
  }, [ready, capturando, onCapture, onClose, mantenerAbierto]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <p className="text-sm font-bold">{titulo}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/10"
        >
          Cerrar
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-contain"
        />
        {error && (
          <div className="absolute inset-x-4 top-4 rounded-lg bg-red-600/90 px-3 py-2 text-sm text-white">
            {error}
          </div>
        )}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Abriendo cámara…
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-6 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          className="rounded-full border border-white/30 px-3 py-2 text-xs font-semibold text-white"
        >
          Girar
        </button>
        <button
          type="button"
          disabled={!ready || capturando}
          onClick={disparar}
          className="h-16 w-16 rounded-full border-4 border-white bg-accent shadow-lg disabled:opacity-40"
          aria-label="Tomar foto"
          title="Tomar foto"
        />
        <span className="w-14 text-center text-[10px] text-white/50">
          {capturando ? "Procesando…" : mantenerAbierto ? "Otra foto" : "Disparar"}
        </span>
      </div>
    </div>
  );
}
