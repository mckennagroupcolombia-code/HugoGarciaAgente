import { useEffect, useRef, useState } from "react";

/** Formato que el navegador sabe grabar: Opus en WebM (Chrome/Android/Firefox) o AAC en MP4 (Safari/iPhone). */
function formatoGrabacion(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const opciones = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  return opciones.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? { mime: "", ext: "webm" };
}

const MAX_SEGUNDOS = 10 * 60;

function reloj(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function IconoMic() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
    </svg>
  );
}

export function IconoEnviar() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <path d="M3.4 20.4 21 12 3.4 3.6 3.39 10.1 15 12 3.39 13.9Z" />
    </svg>
  );
}

function IconoBasura() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <path d="M9 3h6l1 1h4v2H4V4h4l1-1Zm-3 5h12l-1 13H7L6 8Zm4 2v9h1.5v-9H10Zm3.5 0v9H15v-9h-1.5Z" />
    </svg>
  );
}

/** Botón redondo de la derecha (🎤 / ➤), como en WhatsApp. */
export const CLASE_BOTON_REDONDO =
  "mck-btn-no-fx flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-md disabled:opacity-50";

/**
 * Nota de voz del chat: el botón 🎤 empieza a grabar y la barra de escritura se vuelve
 * «🗑 ● 0:12 Grabando…  ➤»; la papelera descarta y ➤ la entrega como archivo (`onListo`).
 */
export default function GrabadorVoz({ onListo, onGrabando, onError, deshabilitado }: {
  onListo: (archivo: File) => void;
  onGrabando?: (grabando: boolean) => void;
  onError?: (mensaje: string) => void;
  deshabilitado?: boolean;
}) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const grabador = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  const descartar = useRef(false);
  const reloj_ = useRef<number | null>(null);

  const soltarMicrofono = () => {
    grabador.current?.stream.getTracks().forEach((t) => t.stop());
    grabador.current = null;
    if (reloj_.current) window.clearInterval(reloj_.current);
    reloj_.current = null;
    setGrabando(false);
    onGrabando?.(false);
  };

  useEffect(() => () => { descartar.current = true; if (grabador.current?.state === "recording") grabador.current.stop(); soltarMicrofono(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const empezar = async () => {
    const formato = formatoGrabacion();
    if (!formato || !navigator.mediaDevices?.getUserMedia) {
      onError?.("Este navegador no permite grabar audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError?.("No hay permiso para usar el micrófono: actívalo en el candado de la barra de direcciones o en los ajustes del teléfono.");
      return;
    }
    const rec = formato.mime ? new MediaRecorder(stream, { mimeType: formato.mime }) : new MediaRecorder(stream);
    trozos.current = [];
    descartar.current = false;
    rec.ondataavailable = (e) => { if (e.data.size) trozos.current.push(e.data); };
    rec.onstop = () => {
      const tipo = (rec.mimeType || formato.mime || "audio/webm").split(";")[0];
      const blob = new Blob(trozos.current, { type: tipo });
      soltarMicrofono();
      if (descartar.current || !blob.size) return;
      const ext = tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : formato.ext;
      onListo(new File([blob], `Nota de voz.${ext}`, { type: tipo }));
    };
    grabador.current = rec;
    rec.start(1000);
    setSegundos(0);
    setGrabando(true);
    onGrabando?.(true);
    reloj_.current = window.setInterval(() => {
      setSegundos((s) => {
        if (s + 1 >= MAX_SEGUNDOS && grabador.current?.state === "recording") grabador.current.stop();
        return s + 1;
      });
    }, 1000);
  };

  const terminar = (enviar: boolean) => {
    descartar.current = !enviar;
    if (grabador.current?.state === "recording") grabador.current.stop();
    else soltarMicrofono();
  };

  if (grabando) {
    return (
      <>
        <div className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 rounded-[24px] border border-border bg-surface-input px-2 shadow-sm">
          <button onClick={() => terminar(false)} className="mck-btn-no-fx flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:text-accent-rose"
            title="Descartar la nota de voz" aria-label="Descartar"><IconoBasura /></button>
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-accent-rose" aria-hidden />
          <span className="font-mono text-[15px] text-ink">{reloj(segundos)}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">Grabando…</span>
        </div>
        <button onClick={() => terminar(true)} className={CLASE_BOTON_REDONDO} title="Enviar la nota de voz" aria-label="Enviar nota de voz"><IconoEnviar /></button>
      </>
    );
  }

  return (
    <button onClick={() => void empezar()} disabled={deshabilitado} className={CLASE_BOTON_REDONDO}
      title="Grabar una nota de voz" aria-label="Nota de voz"><IconoMic /></button>
  );
}
