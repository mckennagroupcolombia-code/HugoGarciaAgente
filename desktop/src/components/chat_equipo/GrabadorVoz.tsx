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

/**
 * Nota de voz del chat: 🎤 empieza a grabar; mientras graba muestra el tiempo, ✕ descarta y
 * «Enviar» la entrega como archivo (`onListo`), que viaja igual que una foto o un PDF.
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
      <div className="flex min-h-[40px] flex-1 items-center gap-2 rounded-lg border border-accent-rose/50 bg-surface-input px-2 py-1">
        <button onClick={() => terminar(false)} className="rounded px-2 py-1 text-[13px] text-muted hover:text-ink" title="Descartar la nota de voz" aria-label="Descartar">✕</button>
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent-rose" aria-hidden />
        <span className="flex-1 font-mono text-[13px] text-ink">Grabando {reloj(segundos)}</span>
        <button onClick={() => terminar(true)} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-bold text-white" title="Terminar y enviar la nota de voz">Enviar 🎤</button>
      </div>
    );
  }

  return (
    <button onClick={() => void empezar()} disabled={deshabilitado}
      className="rounded-lg border border-border bg-surface-input px-2.5 py-2 text-[15px] disabled:opacity-50"
      title="Grabar una nota de voz" aria-label="Nota de voz">🎤</button>
  );
}
