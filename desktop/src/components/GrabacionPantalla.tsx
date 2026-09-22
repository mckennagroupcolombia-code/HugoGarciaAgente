import { Ico } from "../icons/Ico";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { SelectorDestino, useDestinoSupervisor } from "./SupervisorDestino";

/**
 * Grabar pantalla (video + audio) → cortar fragmentos → enviarlos por WhatsApp
 * desde el bridge supervisor, igual que la nota de voz TTS.
 *
 * La grabación se sube por trozos MIENTRAS se graba (MediaRecorder con timeslice):
 * si la pestaña se cierra, lo grabado ya está en el servidor, y no hay una subida
 * gigante al final. La «sección de la pantalla» es un recorte en píxeles del video
 * que se aplica al cortar cada clip (ffmpeg en el backend), así que se puede
 * cambiar después de grabar. Backend: app/tools/grabacion_pantalla.py.
 */

// ── Tipos ──────────────────────────────────────────────────────────────────

interface Recorte { x: number; y: number; w: number; h: number }

interface Clip {
  id: string;
  nombre: string;
  inicio: number;
  fin: number;
  duracion: number;
  recorte: Recorte | null;
  estado: "procesando" | "listo" | "error";
  bytes: number;
  error: string | null;
  enviado_a: { destino: string; ts: string }[];
}

interface Grabacion {
  id: string;
  titulo: string;
  creado: string;
  estado: "grabando" | "lista";
  bytes: number;
  duracion: number;
  ancho: number;
  alto: number;
  tiene_audio: boolean;
  recorte: Recorte | null;
  clips: Clip[];
}

type Fase = "inicio" | "preview" | "grabando" | "cerrando";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTiempo(seg: number, decimas = true): string {
  if (!Number.isFinite(seg) || seg < 0) seg = 0;
  const m = Math.floor(seg / 60);
  const s = seg - m * 60;
  const ss = decimas ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return `${m}:${ss}`;
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function elegirMime(): string {
  const opciones = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return opciones.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

// ── Recorte sobre un <video> ───────────────────────────────────────────────

/** Capa encima del video: oscurece lo que queda fuera del recorte y, en modo
 *  edición, deja dibujar un rectángulo nuevo arrastrando. Coordenadas en
 *  píxeles reales del video (videoW × videoH), no de la pantalla. */
function CapaRecorte({
  videoW, videoH, recorte, editando, onCambio,
}: {
  videoW: number;
  videoH: number;
  recorte: Recorte | null;
  editando: boolean;
  onCambio: (r: Recorte | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const [borrador, setBorrador] = useState<Recorte | null>(null);

  const aVideo = (e: React.PointerEvent): { x: number; y: number } => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    const y = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    return { x: (x / r.width) * videoW, y: (y / r.height) * videoH };
  };

  const rectDe = (a: { x: number; y: number }, b: { x: number; y: number }): Recorte => ({
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    w: Math.round(Math.abs(a.x - b.x)),
    h: Math.round(Math.abs(a.y - b.y)),
  });

  const visible = borrador ?? recorte;
  if (!videoW || !videoH) return null;

  return (
    <div
      ref={ref}
      className={`absolute inset-0 overflow-hidden ${editando ? "cursor-crosshair" : "pointer-events-none"}`}
      onPointerDown={(e) => {
        if (!editando) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        inicio.current = aVideo(e);
        setBorrador(null);
      }}
      onPointerMove={(e) => {
        if (!editando || !inicio.current) return;
        setBorrador(rectDe(inicio.current, aVideo(e)));
      }}
      onPointerUp={(e) => {
        if (!editando || !inicio.current) return;
        const r = rectDe(inicio.current, aVideo(e));
        inicio.current = null;
        setBorrador(null);
        // Un clic sin arrastre no es un recorte
        if (r.w >= 16 && r.h >= 16) onCambio(r);
      }}
    >
      {editando && !visible && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
          <span className="rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white">
            Arrastra para marcar la sección que quieres enviar
          </span>
        </div>
      )}
      {visible && (
        <div
          className={`absolute border-2 ${editando ? "border-accent" : "border-accent/70"}`}
          style={{
            left: `${(visible.x / videoW) * 100}%`,
            top: `${(visible.y / videoH) * 100}%`,
            width: `${(visible.w / videoW) * 100}%`,
            height: `${(visible.h / videoH) * 100}%`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        >
          <span className="absolute -top-5 left-0 rounded bg-accent px-1.5 text-[10px] font-mono text-white whitespace-nowrap">
            {visible.w}×{visible.h}
          </span>
        </div>
      )}
    </div>
  );
}

function BotonesRecorte({
  editando, setEditando, recorte, onQuitar,
}: {
  editando: boolean;
  setEditando: (v: boolean) => void;
  recorte: Recorte | null;
  onQuitar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => setEditando(!editando)}
        className={`rounded-lg border px-3 py-1.5 font-medium transition ${
          editando
            ? "border-accent bg-accent text-white"
            : "border-border bg-surface-hover text-ink hover:border-accent"
        }`}
      >
        {editando ? "✓ Listo" : recorte ? "✂️ Cambiar sección" : "✂️ Elegir sección de la pantalla"}
      </button>
      {recorte && (
        <button
          type="button"
          onClick={onQuitar}
          className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-ink"
        >
          Usar pantalla completa
        </button>
      )}
      <span className="text-muted">
        {recorte ? `Sección ${recorte.w}×${recorte.h} px` : "Pantalla completa"}
      </span>
    </div>
  );
}

// ── Grabador ───────────────────────────────────────────────────────────────

function Grabador({ onLista }: { onLista: (g: Grabacion) => void }) {
  const [fase, setFase] = useState<Fase>("inicio");
  const [conAudioSistema, setConAudioSistema] = useState(true);
  const [conMicrofono, setConMicrofono] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recorte, setRecorte] = useState<Recorte | null>(null);
  const [editandoRecorte, setEditandoRecorte] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [transcurrido, setTranscurrido] = useState(0);
  const [subido, setSubido] = useState(0);
  const [pendientes, setPendientes] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pantallaRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const idRef = useRef<string | null>(null);
  const colaRef = useRef<Promise<void>>(Promise.resolve());
  const seqRef = useRef(0);
  const errorSubidaRef = useRef<string | null>(null);
  const inicioRef = useRef(0);
  const detenerRef = useRef<() => void>(() => {});

  const soportado =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof MediaRecorder !== "undefined";

  const liberar = useCallback(() => {
    pantallaRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    pantallaRef.current = null;
    micRef.current = null;
    audioCtxRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => {
    // Al salir de la pestaña: si estaba grabando, detener (lo subido queda en el servidor)
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    liberar();
  }, [liberar]);

  useEffect(() => {
    if (fase !== "grabando") return;
    const t = window.setInterval(() => setTranscurrido((Date.now() - inicioRef.current) / 1000), 250);
    return () => window.clearInterval(t);
  }, [fase]);

  async function elegirPantalla() {
    setError(null);
    setAviso(null);
    try {
      const pantalla = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: conAudioSistema,
      });
      pantallaRef.current = pantalla;
      if (conMicrofono) {
        try {
          micRef.current = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        } catch {
          setAviso("No se pudo abrir el micrófono; se grabará sin tu voz.");
        }
      }
      if (conAudioSistema && pantalla.getAudioTracks().length === 0) {
        setAviso((a) => a ?? (
          "El navegador no entregó audio de la pantalla. En Chrome, comparte una PESTAÑA y marca "
          + "«Compartir audio de la pestaña»; en Linux el audio de la pantalla completa no siempre está disponible."
        ));
      }
      // Si el usuario corta desde la barra del navegador («Dejar de compartir»)
      pantalla.getVideoTracks()[0].addEventListener("ended", () => detenerRef.current());
      setFase("preview");
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = pantalla;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/denied|abort|cancel/i.test(msg)) setError(`No se pudo capturar la pantalla: ${msg}`);
      liberar();
    }
  }

  function subirTrozo(blob: Blob) {
    const seq = seqRef.current++;
    setPendientes((n) => n + 1);
    colaRef.current = colaRef.current.then(async () => {
      if (errorSubidaRef.current || !idRef.current) return;
      for (let intento = 1; intento <= 3; intento++) {
        try {
          const form = new FormData();
          form.append("seq", String(seq));
          form.append("trozo", blob, `t${seq}.webm`);
          const r = await api.upload<{ bytes: number }>(
            `/api/grabaciones/${idRef.current}/trozo`, form, { timeoutMs: 120_000 },
          );
          setSubido(r.bytes);
          break;
        } catch (e) {
          if (intento === 3) {
            errorSubidaRef.current = e instanceof Error ? e.message : String(e);
            setError(`Falló la subida de la grabación: ${errorSubidaRef.current}`);
          } else {
            await new Promise((res) => setTimeout(res, 1000 * intento));
          }
        }
      }
    }).finally(() => setPendientes((n) => n - 1));
  }

  async function grabar() {
    const pantalla = pantallaRef.current;
    if (!pantalla) return;
    setError(null);
    setEditandoRecorte(false);
    try {
      const g = await api.post<Grabacion>("/api/grabaciones", { titulo, recorte });
      idRef.current = g.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    // Mezcla audio de la pantalla + micrófono en una sola pista
    const pistas: MediaStreamTrack[] = [...pantalla.getVideoTracks()];
    const fuentesAudio = [pantalla, micRef.current].filter(
      (s): s is MediaStream => !!s && s.getAudioTracks().length > 0,
    );
    if (fuentesAudio.length > 0) {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      await ctx.resume().catch(() => {});
      const destino = ctx.createMediaStreamDestination();
      for (const s of fuentesAudio) {
        ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(destino);
      }
      pistas.push(...destino.stream.getAudioTracks());
    }

    const mime = elegirMime();
    const rec = new MediaRecorder(new MediaStream(pistas), {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    recorderRef.current = rec;
    seqRef.current = 0;
    errorSubidaRef.current = null;
    setSubido(0);
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) subirTrozo(e.data); };
    rec.onstop = () => { void cerrar(); };
    rec.start(2000);
    inicioRef.current = Date.now();
    setTranscurrido(0);
    setFase("grabando");
  }

  function detener() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop(); // dispara el último ondataavailable y luego onstop → cerrar()
    } else if (!rec) {
      liberar();
      setFase("inicio");
    }
  }
  detenerRef.current = detener;

  async function cerrar() {
    setFase("cerrando");
    liberar();
    recorderRef.current = null;
    await colaRef.current;
    const id = idRef.current;
    idRef.current = null;
    if (!id) return;
    if (errorSubidaRef.current) {
      setFase("inicio");
      return;
    }
    try {
      const g = await api.post<Grabacion>(`/api/grabaciones/${id}/finalizar`, {}, { timeoutMs: 600_000 });
      setFase("inicio");
      setTitulo("");
      setRecorte(null);
      onLista(g);
    } catch (e) {
      setError(`La grabación se subió pero no se pudo cerrar: ${e instanceof Error ? e.message : e}`);
      setFase("inicio");
    }
  }

  function cancelarPreview() {
    liberar();
    setRecorte(null);
    setEditandoRecorte(false);
    setFase("inicio");
  }

  if (!soportado) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        Este navegador no permite grabar la pantalla. Usa Chrome o Edge de escritorio, abriendo el panel
        por <strong>https://</strong> o <strong>localhost</strong> (por IP de la red local el navegador lo bloquea).
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
      {fase === "inicio" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-hover px-3 py-2.5 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={conAudioSistema} onChange={(e) => setConAudioSistema(e.target.checked)} className="mt-0.5" />
              <span>
                Audio de la pantalla
                <span className="block text-[11px] text-muted">Lo que suena en la pestaña o ventana compartida</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-hover px-3 py-2.5 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={conMicrofono} onChange={(e) => setConMicrofono(e.target.checked)} className="mt-0.5" />
              <span>
                Micrófono
                <span className="block text-[11px] text-muted">Tu voz narrando mientras grabas</span>
              </span>
            </label>
          </div>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título (opcional) — ej. Cómo pedir en la tienda web"
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={elegirPantalla}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
          >
            <Ico e="🖥️" /> Elegir pantalla, ventana o pestaña
          </button>
        </>
      )}

      {fase !== "inicio" && (
        <>
          <div className="relative overflow-hidden rounded-lg border border-border bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="block w-full h-auto"
              onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
              onResize={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            />
            <CapaRecorte
              videoW={dims.w}
              videoH={dims.h}
              recorte={recorte}
              editando={editandoRecorte && fase === "preview"}
              onCambio={setRecorte}
            />
            {fase === "grabando" && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs font-mono text-white">
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                {fmtTiempo(transcurrido, false)} · {fmtMB(subido)} subidos
              </div>
            )}
          </div>

          {fase === "preview" && (
            <>
              <BotonesRecorte
                editando={editandoRecorte}
                setEditando={setEditandoRecorte}
                recorte={recorte}
                onQuitar={() => setRecorte(null)}
              />
              <p className="text-[11px] text-muted">
                La sección se puede cambiar también después de grabar: se graba la pantalla completa y el
                recorte se aplica al sacar cada fragmento.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelarPreview}
                  className="flex-1 rounded-lg border border-border py-2.5 text-sm text-muted hover:text-ink"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={grabar}
                  className="flex-[2] rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
                >
                  ● Empezar a grabar
                </button>
              </div>
            </>
          )}

          {fase === "grabando" && (
            <button
              type="button"
              onClick={detener}
              className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
            >
              ■ Detener grabación
            </button>
          )}

          {fase === "cerrando" && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              {pendientes > 0 ? `Terminando de subir (${pendientes} trozos)…` : "Preparando la grabación para editar…"}
            </div>
          )}
        </>
      )}

      {aviso && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{aviso}</p>}
      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ── Editor: marcar fragmentos, sacar clips y enviarlos ─────────────────────

function Editor({
  grabacion, onActualizar, onCerrar,
}: {
  grabacion: Grabacion;
  onActualizar: (g: Grabacion) => void;
  onCerrar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const finPreviewRef = useRef<number | null>(null);
  const dur = grabacion.duracion || 0;
  const [actual, setActual] = useState(0);
  const [inicio, setInicio] = useState(0);
  const [fin, setFin] = useState(Math.min(dur, 30));
  const [nombre, setNombre] = useState("");
  const [recorte, setRecorte] = useState<Recorte | null>(grabacion.recorte);
  const [editandoRecorte, setEditandoRecorte] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destino = useDestinoSupervisor();

  // Refrescar mientras haya clips procesándose
  const procesando = grabacion.clips.some((c) => c.estado === "procesando");
  useEffect(() => {
    if (!procesando) return;
    const t = window.setInterval(() => {
      api.get<Grabacion>(`/api/grabaciones/${grabacion.id}`).then(onActualizar).catch(() => {});
    }, 1500);
    return () => window.clearInterval(t);
  }, [procesando, grabacion.id, onActualizar]);

  const ir = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = Math.min(Math.max(t, 0), dur);
  };

  const marcarInicio = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    setInicio(t);
    setFin((f) => (f <= t + 0.5 ? Math.min(dur, t + 10) : f));
  }, [dur]);

  const marcarFin = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    setFin(t);
    setInicio((i) => (i >= t - 0.5 ? Math.max(0, t - 10) : i));
  }, []);

  // Atajos: I = inicio, O = fin, espacio = play/pausa (fuera de los campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "i" || e.key === "I") { e.preventDefault(); marcarInicio(); }
      else if (e.key === "o" || e.key === "O") { e.preventDefault(); marcarFin(); }
      else if (e.key === " " && videoRef.current) {
        e.preventDefault();
        if (videoRef.current.paused) videoRef.current.play(); else videoRef.current.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marcarInicio, marcarFin]);

  function verFragmento() {
    const v = videoRef.current;
    if (!v) return;
    finPreviewRef.current = fin;
    v.currentTime = inicio;
    v.play().catch(() => {});
  }

  async function guardarRecorte(r: Recorte | null) {
    setRecorte(r);
    try {
      onActualizar(await api.patch<Grabacion>(`/api/grabaciones/${grabacion.id}`, { recorte: r }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function crearClip() {
    setCreando(true);
    setError(null);
    try {
      await api.post<Clip>(`/api/grabaciones/${grabacion.id}/clips`, { inicio, fin, nombre, recorte });
      setNombre("");
      onActualizar(await api.get<Grabacion>(`/api/grabaciones/${grabacion.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreando(false);
    }
  }

  const pct = (t: number) => (dur > 0 ? `${(t / dur) * 100}%` : "0%");
  const largo = Math.max(0, fin - inicio);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">{grabacion.titulo}</h3>
            <p className="text-[11px] text-muted">
              {fmtTiempo(dur, false)} · {grabacion.ancho}×{grabacion.alto} · {fmtMB(grabacion.bytes)}
              {grabacion.tiene_audio ? " · con audio" : " · sin audio"}
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="text-xs text-muted hover:text-ink">
            ← Volver
          </button>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-border bg-black">
          <video
            ref={videoRef}
            src={`/api/grabaciones/${grabacion.id}/video`}
            controls={!editandoRecorte}
            playsInline
            preload="auto"
            className="block w-full h-auto"
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime;
              setActual(t);
              if (finPreviewRef.current != null && t >= finPreviewRef.current) {
                e.currentTarget.pause();
                finPreviewRef.current = null;
              }
            }}
            onPause={() => { finPreviewRef.current = null; }}
          />
          <CapaRecorte
            videoW={grabacion.ancho}
            videoH={grabacion.alto}
            recorte={recorte}
            editando={editandoRecorte}
            onCambio={(r) => void guardarRecorte(r)}
          />
        </div>

        <BotonesRecorte
          editando={editandoRecorte}
          setEditando={setEditandoRecorte}
          recorte={recorte}
          onQuitar={() => void guardarRecorte(null)}
        />

        {/* Línea de tiempo: fragmento seleccionado + cabezal */}
        <div className="space-y-2">
          <div
            ref={barraRef}
            className="relative h-9 cursor-pointer rounded-lg bg-surface-hover"
            onClick={(e) => {
              const r = barraRef.current!.getBoundingClientRect();
              ir(((e.clientX - r.left) / r.width) * dur);
            }}
          >
            <div
              className="absolute top-0 bottom-0 rounded bg-accent/30 border-x-2 border-accent"
              style={{ left: pct(inicio), width: pct(largo) }}
            />
            {grabacion.clips.map((c) => (
              <div
                key={c.id}
                title={c.nombre}
                className="absolute bottom-0 h-1 bg-emerald-400/70"
                style={{ left: pct(c.inicio), width: pct(c.duracion) }}
              />
            ))}
            <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: pct(actual) }} />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-muted">
            <span>0:00</span>
            <span className="text-ink">{fmtTiempo(actual)}</span>
            <span>{fmtTiempo(dur, false)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={marcarInicio} className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-ink hover:border-accent">
            ⟦ Inicio aquí <kbd className="ml-1 text-muted">I</kbd>
          </button>
          <button type="button" onClick={marcarFin} className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-ink hover:border-accent">
            Fin aquí ⟧ <kbd className="ml-1 text-muted">O</kbd>
          </button>
          <button type="button" onClick={verFragmento} className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-ink hover:border-accent">
            ▶ Ver fragmento
          </button>
          <span className="font-mono text-muted">
            <button type="button" className="hover:text-ink" onClick={() => ir(inicio)}>{fmtTiempo(inicio)}</button>
            {" → "}
            <button type="button" className="hover:text-ink" onClick={() => ir(fin)}>{fmtTiempo(fin)}</button>
            {"  "}({fmtTiempo(largo)})
          </span>
        </div>

        <div className="flex gap-2">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del fragmento (opcional)"
            className="flex-1 rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={crearClip}
            disabled={creando || largo < 0.5}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40"
          >
            {creando ? "Creando…" : "✂️ Sacar fragmento"}
          </button>
        </div>
        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
      </div>

      {grabacion.clips.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Fragmentos</h3>
            <span className="text-[11px] text-muted">MP4 listo para WhatsApp (máx. ~15 MB)</span>
          </div>
          <SelectorDestino destino={destino} />
          <div className="grid gap-3 sm:grid-cols-2">
            {grabacion.clips.map((c) => (
              <TarjetaClip
                key={c.id}
                grabacionId={grabacion.id}
                clip={c}
                destino={destino}
                onCambio={() => api.get<Grabacion>(`/api/grabaciones/${grabacion.id}`).then(onActualizar).catch(() => {})}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TarjetaClip({
  grabacionId, clip, destino, onCambio,
}: {
  grabacionId: string;
  clip: Clip;
  destino: ReturnType<typeof useDestinoSupervisor>;
  onCambio: () => void;
}) {
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);
  const archivo = `/api/grabaciones/${grabacionId}/clips/${clip.id}/archivo`;

  async function enviar() {
    if (!destino.numero) return;
    setEnviando(true);
    setResultado(null);
    try {
      await api.post(`/api/grabaciones/${grabacionId}/clips/${clip.id}/enviar`,
        { numero: destino.numero, mensaje }, { timeoutMs: 180_000 });
      setResultado({ ok: true, msg: `✅ Enviado a ${destino.etiqueta}` });
      onCambio();
    } catch (e) {
      setResultado({ ok: false, msg: `❌ ${e instanceof Error ? e.message : "Error"}` });
    } finally {
      setEnviando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar el fragmento «${clip.nombre}»?`)) return;
    await api.delete(`/api/grabaciones/${grabacionId}/clips/${clip.id}`).catch(() => {});
    onCambio();
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-hover/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{clip.nombre}</p>
          <p className="text-[11px] font-mono text-muted">
            {fmtTiempo(clip.inicio)} → {fmtTiempo(clip.fin)} · {fmtTiempo(clip.duracion)}
            {clip.estado === "listo" && ` · ${fmtMB(clip.bytes)}`}
            {clip.recorte && ` · ${clip.recorte.w}×${clip.recorte.h}`}
          </p>
        </div>
        <button type="button" onClick={eliminar} title="Eliminar" className="text-xs text-muted hover:text-red-400">✕</button>
      </div>

      {clip.estado === "procesando" && (
        <div className="flex items-center gap-2 py-6 justify-center text-xs text-muted">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Cortando y comprimiendo…
        </div>
      )}
      {clip.estado === "error" && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">{clip.error}</p>
      )}
      {clip.estado === "listo" && (
        <>
          <video src={archivo} controls playsInline preload="metadata" className="w-full rounded border border-border bg-black" />
          <input
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="Mensaje que acompaña el video (opcional)"
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-ink placeholder:text-muted focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || !destino.numero}
              className="flex-1 rounded-lg bg-accent py-2 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40"
            >
              {enviando ? "Enviando…" : "Enviar por WhatsApp"}
            </button>
            <a
              href={`${archivo}?descargar=1`}
              className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-ink"
            >
              Descargar
            </a>
          </div>
          {resultado && (
            <p className={`text-[11px] ${resultado.ok ? "text-emerald-400" : "text-red-400"}`}>{resultado.msg}</p>
          )}
          {clip.enviado_a.length > 0 && (
            <p className="text-[10px] text-muted">
              Enviado {clip.enviado_a.length} {clip.enviado_a.length === 1 ? "vez" : "veces"} · último{" "}
              {new Date(clip.enviado_a[clip.enviado_a.length - 1].ts).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Contenedor ─────────────────────────────────────────────────────────────

export default function GrabacionPantalla() {
  const [grabaciones, setGrabaciones] = useState<Grabacion[]>([]);
  const [abierta, setAbierta] = useState<Grabacion | null>(null);

  const cargar = useCallback(() => {
    api.get<{ grabaciones: Grabacion[] }>("/api/grabaciones")
      .then((d) => setGrabaciones(d.grabaciones))
      .catch(() => {});
  }, []);
  useEffect(cargar, [cargar]);

  const actualizar = useCallback((g: Grabacion) => {
    setAbierta(g);
    setGrabaciones((lista) => lista.map((x) => (x.id === g.id ? g : x)));
  }, []);

  async function eliminar(g: Grabacion) {
    if (!window.confirm(`¿Eliminar «${g.titulo}» y sus ${g.clips.length} fragmentos?`)) return;
    await api.delete(`/api/grabaciones/${g.id}`).catch(() => {});
    cargar();
  }

  if (abierta) {
    return (
      <Editor
        key={abierta.id}
        grabacion={abierta}
        onActualizar={actualizar}
        onCerrar={() => { setAbierta(null); cargar(); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Graba una sección de la pantalla con su audio, saca fragmentos y envíalos como video desde tu
        número supervisor.
      </p>

      <Grabador onLista={(g) => { setAbierta(g); cargar(); }} />

      {grabaciones.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-panel p-5 space-y-2">
          <h3 className="text-sm font-semibold text-ink">Grabaciones</h3>
          {grabaciones.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{g.titulo}</p>
                <p className="text-[11px] text-muted">
                  {new Date(g.creado).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
                  {" · "}
                  {g.estado === "lista"
                    ? `${fmtTiempo(g.duracion, false)} · ${fmtMB(g.bytes)} · ${g.clips.length} fragmentos`
                    : "sin cerrar (grabación interrumpida)"}
                </p>
              </div>
              {g.estado === "lista" ? (
                <button type="button" onClick={() => setAbierta(g)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink hover:border-accent">
                  Abrir
                </button>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setAbierta(await api.post<Grabacion>(`/api/grabaciones/${g.id}/finalizar`, {}, { timeoutMs: 600_000 }));
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink hover:border-accent"
                >
                  Recuperar
                </button>
              )}
              <button type="button" onClick={() => eliminar(g)} title="Eliminar" className="text-xs text-muted hover:text-red-400">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
