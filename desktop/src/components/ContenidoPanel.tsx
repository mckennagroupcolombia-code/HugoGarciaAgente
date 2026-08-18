import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ticketsSessionHeaders } from "../api/client";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";

type Vista = "video" | "audio";
type ModoZona = "franja" | "region";
type AudioModo = "original" | "sin_audio" | "archivo" | "voz_clonada";

const VOICEBOX_ENGINES = ["qwen3", "qwen3-0.6b", "chatterbox", "kokoro"] as const;
const TEXTO_VOZ_MAX = 1200;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface VideoDims {
  w: number;
  h: number;
}

type Drag =
  | { kind: "franja" }
  | { kind: "new"; startX: number; startY: number }
  | { kind: "move"; startX: number; startY: number; orig: Rect }
  | { kind: "resize"; orig: Rect };

interface IniciarJobResp {
  ok: boolean;
  status: string;
  job_id: string;
  error?: string;
}

interface EstadoJobResp {
  ok: boolean;
  status: "pending" | "processing" | "done" | "error";
  frame_actual: number;
  total_frames: number;
  video_url?: string;
  error?: string;
}

interface Perfil {
  id: string;
  name: string;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function bearerToken(): string | null {
  const tickets = useTicketsAuth.getState();
  return tickets.apiToken || tickets.token || useAuthStore.getState().token || null;
}

async function authedBlobFetch(path: string, body: BodyInit, extraHeaders: Record<string, string> = {}): Promise<Blob> {
  // Ruta relativa directa (sin pasar por resolvePanelApiUrl): /api/voz/sintetizar
  // no tiene gemela /app/api/..., y /app/<path> en el backend solo acepta GET
  // (catch-all del SPA) — reescribir el POST hacia /app/api/... daría 405.
  // Mismo patrón que VozIA.tsx (fetch directo a "/api/voz/sintetizar").
  const token = bearerToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...ticketsSessionHeaders(),
      ...extraHeaders,
    },
    body,
  });
  if (!res.ok) {
    const clon = await res.clone().json().catch(() => ({}));
    throw new Error(clon.error || `HTTP ${res.status}`);
  }
  return res.blob();
}

/** /api/voz/sintetizar devuelve audio binario, no JSON — no puede pasar por api.post(). */
function sintetizarVozBlob(texto: string, profileId: string, engine: string): Promise<Blob> {
  return authedBlobFetch(
    "/api/voz/sintetizar",
    JSON.stringify({ texto, motor: "voicebox", voicebox_profile: profileId, voicebox_engine: engine }),
    { "Content-Type": "application/json" },
  );
}

function convertirAMp3(audio: Blob): Promise<Blob> {
  const fd = new FormData();
  fd.append("audio", audio, "voz.wav");
  return authedBlobFetch("/api/contenido/audio/mp3", fd);
}

function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Estado + mutaciones de generación de voz clonada (voicebox) — una instancia
 * independiente por cada lugar donde se usa <GeneradorVoz>, para que el tab
 * "Generar audio" y el paso de Audio del video no compartan progreso. */
function useVozClonada() {
  const queryClient = useQueryClient();
  const [perfilId, setPerfilId] = useState("");
  const [engine, setEngine] = useState<string>(VOICEBOX_ENGINES[0]);
  const [texto, setTexto] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mostrarNuevaVoz, setMostrarNuevaVoz] = useState(false);
  const [nuevaVozNombre, setNuevaVozNombre] = useState("");
  const [nuevaVozArchivo, setNuevaVozArchivo] = useState<File | null>(null);

  const perfilesQuery = useQuery({
    queryKey: ["voicebox-perfiles"],
    queryFn: () => api.get<{ perfiles: Perfil[] }>("/api/voz/voicebox/perfiles"),
  });

  const crearVozMutation = useMutation({
    mutationFn: async () => {
      if (!nuevaVozNombre.trim()) throw new Error("Ponle un nombre a la voz");
      if (!nuevaVozArchivo) throw new Error("Sube una muestra de audio de referencia");
      const creado = await api.post<{ ok: boolean; perfil: Perfil }>("/api/voz/voicebox/perfiles", {
        nombre: nuevaVozNombre.trim(),
      });
      const fd = new FormData();
      fd.append("audio", nuevaVozArchivo);
      await api.upload(`/api/voz/voicebox/perfiles/${creado.perfil.id}/muestras`, fd);
      return creado.perfil;
    },
    onSuccess: (perfil) => {
      setPerfilId(perfil.id);
      setNuevaVozNombre("");
      setNuevaVozArchivo(null);
      setMostrarNuevaVoz(false);
      queryClient.invalidateQueries({ queryKey: ["voicebox-perfiles"] });
    },
  });

  const sintetizarMutation = useMutation({
    mutationFn: () => {
      if (!perfilId) throw new Error("Elige una voz primero");
      if (!texto.trim()) throw new Error("Escribe el texto a convertir en voz");
      return sintetizarVozBlob(texto.trim(), perfilId, engine);
    },
    onSuccess: (nuevoBlob) => {
      setBlob(nuevoBlob);
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(nuevoBlob);
      });
    },
  });

  function reset() {
    setTexto("");
    setBlob(null);
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  return {
    perfiles: perfilesQuery.data?.perfiles ?? [],
    perfilesLoading: perfilesQuery.isLoading,
    perfilId, setPerfilId,
    engine, setEngine,
    texto, setTexto,
    blob, blobUrl,
    mostrarNuevaVoz, setMostrarNuevaVoz,
    nuevaVozNombre, setNuevaVozNombre,
    nuevaVozArchivo, setNuevaVozArchivo,
    crearVozMutation,
    sintetizarMutation,
    reset,
  };
}

type VozClonadaState = ReturnType<typeof useVozClonada>;

function GeneradorVoz({ voz, disabled }: { voz: VozClonadaState; disabled?: boolean }) {
  const [mp3Pending, setMp3Pending] = useState(false);
  const [mp3Error, setMp3Error] = useState<string | null>(null);

  async function handleDescargarMp3() {
    if (!voz.blob) return;
    setMp3Pending(true);
    setMp3Error(null);
    try {
      const mp3 = await convertirAMp3(voz.blob);
      descargarBlob(mp3, "voz.mp3");
    } catch (e) {
      setMp3Error((e as Error).message);
    } finally {
      setMp3Pending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[180px] space-y-1">
          <span className="text-xs font-medium text-muted">Voz</span>
          <select
            disabled={disabled || voz.perfilesLoading}
            value={voz.perfilId}
            onChange={(e) => voz.setPerfilId(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">
              {voz.perfilesLoading ? "Cargando…" : "Elige una voz…"}
            </option>
            {voz.perfiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => voz.setMostrarNuevaVoz(!voz.mostrarNuevaVoz)}
          className="rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-ink hover:border-accent/50 disabled:opacity-50"
        >
          {voz.mostrarNuevaVoz ? "Cancelar" : "+ Nueva voz"}
        </button>
      </div>

      {voz.mostrarNuevaVoz && (
        <div className="rounded-lg border border-border bg-surface-input/40 p-3 space-y-2">
          <input
            type="text"
            placeholder="Nombre de la voz"
            disabled={voz.crearVozMutation.isPending}
            value={voz.nuevaVozNombre}
            onChange={(e) => voz.setNuevaVozNombre(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          />
          <input
            type="file"
            accept="audio/*"
            disabled={voz.crearVozMutation.isPending}
            onChange={(e) => voz.setNuevaVozArchivo(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white disabled:opacity-50"
          />
          <p className="text-xs text-muted">Sube una muestra de audio limpia de la voz a clonar (10-30 seg).</p>
          <button
            type="button"
            disabled={voz.crearVozMutation.isPending}
            onClick={() => voz.crearVozMutation.mutate()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {voz.crearVozMutation.isPending ? "Creando…" : "Crear voz"}
          </button>
          {voz.crearVozMutation.isError && (
            <p className="text-xs text-red-600 dark:text-red-400">{(voz.crearVozMutation.error as Error).message}</p>
          )}
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">Motor</span>
        <div className="flex flex-wrap gap-2">
          {VOICEBOX_ENGINES.map((e) => (
            <button
              key={e}
              type="button"
              disabled={disabled}
              onClick={() => voz.setEngine(e)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
                voz.engine === e
                  ? "border-accent bg-accent/8 text-ink"
                  : "border-border text-muted hover:border-accent/50"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">Texto a convertir en voz ({voz.texto.length}/{TEXTO_VOZ_MAX})</span>
        <textarea
          rows={3}
          maxLength={TEXTO_VOZ_MAX}
          disabled={disabled}
          value={voz.texto}
          onChange={(e) => voz.setTexto(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          placeholder="Lo que va a decir la voz…"
        />
      </label>

      <button
        type="button"
        disabled={disabled || voz.sintetizarMutation.isPending || !voz.perfilId || !voz.texto.trim()}
        onClick={() => voz.sintetizarMutation.mutate()}
        className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {voz.sintetizarMutation.isPending ? "Generando voz…" : "Generar voz"}
      </button>
      {voz.sintetizarMutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">{(voz.sintetizarMutation.error as Error).message}</p>
      )}

      {voz.blobUrl && voz.blob && (
        <div className="space-y-2">
          <p className="text-xs text-ink">✓ Audio generado</p>
          <audio controls src={voz.blobUrl} className="w-full" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => descargarBlob(voz.blob!, "voz.wav")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent/50"
            >
              Descargar .wav
            </button>
            <button
              type="button"
              disabled={mp3Pending}
              onClick={handleDescargarMp3}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent/50 disabled:opacity-50"
            >
              {mp3Pending ? "Convirtiendo…" : "Descargar .mp3"}
            </button>
          </div>
          {mp3Error && <p className="text-xs text-red-600 dark:text-red-400">{mp3Error}</p>}
        </div>
      )}
    </div>
  );
}

const ALTO_MARCA_INICIAL = "80";
const REGION_INICIAL: Rect = { x: 0, y: 0, w: 300, h: 80 };

export default function ContenidoPanel() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const frameCapturadoRef = useRef(false);

  const [vista, setVista] = useState<Vista>("video");

  const [archivo, setArchivo] = useState<File | null>(null);
  const [quitarMarcaAgua, setQuitarMarcaAgua] = useState(true);
  const [modoZona, setModoZona] = useState<ModoZona>("franja");
  const [altoMarca, setAltoMarca] = useState(ALTO_MARCA_INICIAL);
  const [regionX, setRegionX] = useState(String(REGION_INICIAL.x));
  const [regionY, setRegionY] = useState(String(REGION_INICIAL.y));
  const [regionW, setRegionW] = useState(String(REGION_INICIAL.w));
  const [regionH, setRegionH] = useState(String(REGION_INICIAL.h));
  const [jobId, setJobId] = useState<string | null>(null);

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [videoDims, setVideoDims] = useState<VideoDims | null>(null);

  const [audioModo, setAudioModo] = useState<AudioModo>("original");
  const [audioArchivo, setAudioArchivo] = useState<File | null>(null);
  const vozParaVideo = useVozClonada();
  const vozStandalone = useVozClonada();

  const estadoQuery = useQuery({
    queryKey: ["contenido-video-job", jobId],
    queryFn: () => api.get<EstadoJobResp>(`/api/contenido/procesar-video/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "done" || s === "error" ? false : 2000;
    },
  });

  const audioListo =
    audioModo === "original" ||
    audioModo === "sin_audio" ||
    (audioModo === "archivo" && !!audioArchivo) ||
    (audioModo === "voz_clonada" && !!vozParaVideo.blob);
  const hayAccion = quitarMarcaAgua || audioModo !== "original";

  const iniciarMutation = useMutation({
    mutationFn: async () => {
      if (!archivo) throw new Error("Selecciona un video primero");
      if (!hayAccion) throw new Error("Elige quitar la marca de agua y/o cambiar el audio");
      if (!audioListo) throw new Error("Termina de preparar el audio antes de procesar");

      const fd = new FormData();
      fd.append("video", archivo);
      fd.append("quitar_marca_agua", quitarMarcaAgua ? "1" : "0");
      if (quitarMarcaAgua) {
        if (modoZona === "franja") {
          fd.append("alto_marca", altoMarca || "80");
        } else {
          fd.append("region", `${regionX || 0},${regionY || 0},${regionW || 0},${regionH || 0}`);
        }
      }

      const backendAudioModo = audioModo === "archivo" || audioModo === "voz_clonada" ? "externo" : audioModo;
      fd.append("audio_modo", backendAudioModo);
      if (backendAudioModo === "externo") {
        if (audioModo === "archivo" && audioArchivo) {
          fd.append("audio", audioArchivo, audioArchivo.name);
        } else if (audioModo === "voz_clonada" && vozParaVideo.blob) {
          fd.append("audio", vozParaVideo.blob, "voz.wav");
        }
      }

      return api.upload<IniciarJobResp>("/api/contenido/procesar-video", fd);
    },
    onSuccess: (data) => {
      setJobId(data.job_id);
    },
  });

  const job = estadoQuery.data;
  const procesando = !!jobId && job?.status !== "done" && job?.status !== "error";
  const progresoPct = useMemo(() => {
    if (!job?.total_frames) return null;
    return Math.min(100, Math.round((job.frame_actual / job.total_frames) * 100));
  }, [job]);

  // Rectángulo actual en píxeles nativos del video, según el modo.
  const currentRect: Rect = useMemo(() => {
    if (!videoDims) return { x: 0, y: 0, w: 0, h: 0 };
    if (modoZona === "franja") {
      const h = clamp(Number(altoMarca) || 0, 0, videoDims.h);
      return { x: 0, y: videoDims.h - h, w: videoDims.w, h };
    }
    return {
      x: clamp(Number(regionX) || 0, 0, videoDims.w),
      y: clamp(Number(regionY) || 0, 0, videoDims.h),
      w: Math.max(0, Number(regionW) || 0),
      h: Math.max(0, Number(regionH) || 0),
    };
  }, [modoZona, altoMarca, regionX, regionY, regionW, regionH, videoDims]);

  function aplicarRect(next: Rect) {
    if (modoZona === "franja") {
      const alto = Math.round(clamp(videoDims!.h - next.y, 1, videoDims!.h));
      setAltoMarca(String(alto));
      return;
    }
    setRegionX(String(Math.round(next.x)));
    setRegionY(String(Math.round(next.y)));
    setRegionW(String(Math.round(next.w)));
    setRegionH(String(Math.round(next.h)));
  }

  function capturarFrame(video: HTMLVideoElement) {
    if (frameCapturadoRef.current) return;
    frameCapturadoRef.current = true;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      setPreviewError("El navegador no pudo leer este video para previsualizarlo. Puedes seguir ajustando la zona con los campos numéricos.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    setVideoDims({ w, h });
    setPreviewSrc(canvas.toDataURL("image/jpeg", 0.85));
    // Posición inicial sugerida para "Región exacta": esquina inferior derecha,
    // donde suelen ir los watermarks de Gemini/Veo. Solo si el usuario no la tocó aún.
    setRegionX((prev) => (prev === String(REGION_INICIAL.x) ? String(Math.round(w * 0.68)) : prev));
    setRegionY((prev) => (prev === String(REGION_INICIAL.y) ? String(Math.round(h * 0.85)) : prev));
    setRegionW((prev) => (prev === String(REGION_INICIAL.w) ? String(Math.round(w * 0.3)) : prev));
    setRegionH((prev) => (prev === String(REGION_INICIAL.h) ? String(Math.round(h * 0.12)) : prev));
  }

  function extraerPrimerFotograma(file: File) {
    frameCapturadoRef.current = false;
    setPreviewSrc(null);
    setPreviewError(null);
    setVideoDims(null);
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const limpiar = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      try {
        video.currentTime = Math.min(0.15, (video.duration || 1) / 10);
      } catch {
        capturarFrame(video); // algunos navegadores no permiten seek aún; usar frame 0
      }
    };
    video.onseeked = () => {
      capturarFrame(video);
      limpiar();
    };
    video.onloadeddata = () => {
      // Respaldo si `seeked` no dispara en algunos codecs/navegadores.
      window.setTimeout(() => {
        if (!frameCapturadoRef.current) {
          capturarFrame(video);
          limpiar();
        }
      }, 300);
    };
    video.onerror = () => {
      setPreviewError("No se pudo generar la previsualización de este video. Puedes seguir ajustando la zona con los campos numéricos.");
      limpiar();
    };
  }

  function handleFileChange(file: File | null) {
    setArchivo(file);
    if (file) extraerPrimerFotograma(file);
    else {
      setPreviewSrc(null);
      setVideoDims(null);
      setPreviewError(null);
    }
  }

  function nativePoint(e: React.PointerEvent): { x: number; y: number } | null {
    const img = imgRef.current;
    if (!img || !videoDims) return null;
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const scaleX = videoDims.w / r.width;
    const scaleY = videoDims.h / r.height;
    return {
      x: clamp((e.clientX - r.left) * scaleX, 0, videoDims.w),
      y: clamp((e.clientY - r.top) * scaleY, 0, videoDims.h),
    };
  }

  function handleBackgroundPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (modoZona !== "region" || !videoDims || procesando) return;
    const p = nativePoint(e);
    if (!p) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "new", startX: p.x, startY: p.y };
    aplicarRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function handleRectPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (procesando) return;
    const p = nativePoint(e);
    if (!p || !videoDims) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    if (modoZona === "franja") {
      dragRef.current = { kind: "franja" };
      return;
    }
    dragRef.current = { kind: "move", startX: p.x, startY: p.y, orig: currentRect };
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (procesando) return;
    const p = nativePoint(e);
    if (!p) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "resize", orig: currentRect };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !videoDims) return;
    const p = nativePoint(e);
    if (!p) return;
    if (drag.kind === "franja") {
      aplicarRect({ x: 0, y: p.y, w: videoDims.w, h: videoDims.h - p.y });
      return;
    }
    if (drag.kind === "new") {
      aplicarRect({
        x: Math.min(drag.startX, p.x),
        y: Math.min(drag.startY, p.y),
        w: Math.abs(p.x - drag.startX),
        h: Math.abs(p.y - drag.startY),
      });
      return;
    }
    if (drag.kind === "move") {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      aplicarRect({
        x: clamp(drag.orig.x + dx, 0, videoDims.w - drag.orig.w),
        y: clamp(drag.orig.y + dy, 0, videoDims.h - drag.orig.h),
        w: drag.orig.w,
        h: drag.orig.h,
      });
      return;
    }
    if (drag.kind === "resize") {
      aplicarRect({
        x: drag.orig.x,
        y: drag.orig.y,
        w: clamp(p.x - drag.orig.x, 8, videoDims.w - drag.orig.x),
        h: clamp(p.y - drag.orig.y, 8, videoDims.h - drag.orig.y),
      });
    }
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function reiniciar() {
    setArchivo(null);
    setJobId(null);
    setPreviewSrc(null);
    setVideoDims(null);
    setPreviewError(null);
    setAudioModo("original");
    setAudioArchivo(null);
    vozParaVideo.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (audioInputRef.current) audioInputRef.current.value = "";
    if (jobId) {
      api.delete(`/api/contenido/procesar-video/${jobId}`).catch(() => {});
      queryClient.removeQueries({ queryKey: ["contenido-video-job", jobId] });
    }
  }

  const rectPct = videoDims
    ? {
        left: `${(currentRect.x / videoDims.w) * 100}%`,
        top: `${(currentRect.y / videoDims.h) * 100}%`,
        width: `${(currentRect.w / videoDims.w) * 100}%`,
        height: `${(currentRect.h / videoDims.h) * 100}%`,
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-ink">🎬 Contenido</h2>
        <p className="mt-1 text-sm text-muted">
          Quita una marca de agua estática y/o cambia el audio de un video, o genera audio de voz clonada para descargar aparte.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setVista("video")}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
            vista === "video" ? "border-accent bg-accent/8 text-ink" : "border-border text-muted hover:border-accent/50"
          }`}
        >
          🎬 Video
        </button>
        <button
          type="button"
          onClick={() => setVista("audio")}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
            vista === "audio" ? "border-accent bg-accent/8 text-ink" : "border-border text-muted hover:border-accent/50"
          }`}
        >
          🎙️ Generar audio
        </button>
      </div>

      {vista === "audio" ? (
        <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Texto a voz (voicebox)</h3>
            <p className="text-xs text-muted">Pega el texto, elige la voz clonada y descarga el resultado en .wav o .mp3 — sin necesidad de subir ningún video.</p>
          </div>
          <GeneradorVoz voz={vozStandalone} />
        </section>
      ) : (
        <>
          {/* Subir video */}
          <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
            <h3 className="text-sm font-semibold text-ink">1. Video</h3>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              disabled={procesando}
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white disabled:opacity-50"
            />
            {archivo && (
              <p className="text-xs text-muted">
                {archivo.name} · {fmtBytes(archivo.size)}
                {videoDims ? ` · ${videoDims.w}×${videoDims.h}px` : ""}
              </p>
            )}
            {previewError && <p className="text-xs text-amber-600 dark:text-amber-400">{previewError}</p>}
          </section>

          {/* Marca de agua */}
          <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                disabled={procesando}
                checked={quitarMarcaAgua}
                onChange={(e) => setQuitarMarcaAgua(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-accent"
              />
              2. Quitar marca de agua
            </label>

            {quitarMarcaAgua && (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={procesando}
                    onClick={() => setModoZona("franja")}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                      modoZona === "franja"
                        ? "border-accent bg-accent/8 text-ink"
                        : "border-border text-muted hover:border-accent/50"
                    }`}
                  >
                    Franja inferior
                  </button>
                  <button
                    type="button"
                    disabled={procesando}
                    onClick={() => setModoZona("region")}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                      modoZona === "region"
                        ? "border-accent bg-accent/8 text-ink"
                        : "border-border text-muted hover:border-accent/50"
                    }`}
                  >
                    Región exacta
                  </button>
                </div>

                {previewSrc && videoDims ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted">
                      {modoZona === "franja"
                        ? "Arrastra la franja resaltada hasta cubrir la marca de agua."
                        : "Dibuja o arrastra el recuadro sobre la marca de agua; la esquina inferior derecha lo redimensiona."}
                    </p>
                    <div
                      className="relative touch-none select-none overflow-hidden rounded-lg border border-border"
                      onPointerDown={handleBackgroundPointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                    >
                      <img
                        ref={imgRef}
                        src={previewSrc}
                        alt="Primer fotograma del video"
                        draggable={false}
                        className="block h-auto w-full"
                      />
                      {rectPct && (
                        <div
                          className={`absolute border-2 border-accent bg-accent/20 ${modoZona === "franja" ? "cursor-ns-resize" : "cursor-move"}`}
                          style={rectPct}
                          onPointerDown={handleRectPointerDown}
                        >
                          {modoZona === "region" && (
                            <div
                              className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-accent shadow"
                              onPointerDown={handleResizePointerDown}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {modoZona === "franja" ? (
                  <label className="block max-w-[200px] space-y-1">
                    <span className="text-xs font-medium text-muted">Alto de la franja (px, desde abajo)</span>
                    <input
                      type="number"
                      min={1}
                      disabled={procesando}
                      value={altoMarca}
                      onChange={(e) => setAltoMarca(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
                    />
                  </label>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {([
                      ["X", regionX, setRegionX],
                      ["Y", regionY, setRegionY],
                      ["Ancho", regionW, setRegionW],
                      ["Alto", regionH, setRegionH],
                    ] as const).map(([label, value, setter]) => (
                      <label key={label} className="space-y-1">
                        <span className="text-xs font-medium text-muted">{label} (px)</span>
                        <input
                          type="number"
                          min={0}
                          disabled={procesando}
                          value={value}
                          onChange={(e) => setter(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Audio */}
          <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
            <h3 className="text-sm font-semibold text-ink">3. Audio</h3>
            <div className="flex flex-wrap gap-2">
              {([
                ["original", "Original"],
                ["sin_audio", "Sin audio"],
                ["archivo", "Archivo propio"],
                ["voz_clonada", "Voz clonada"],
              ] as const).map(([valor, label]) => (
                <button
                  key={valor}
                  type="button"
                  disabled={procesando}
                  onClick={() => setAudioModo(valor)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                    audioModo === valor
                      ? "border-accent bg-accent/8 text-ink"
                      : "border-border text-muted hover:border-accent/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {audioModo === "original" && (
              <p className="text-xs text-muted">Se usa el audio del video subido (si tiene).</p>
            )}
            {audioModo === "sin_audio" && (
              <p className="text-xs text-muted">El video final queda mudo.</p>
            )}

            {audioModo === "archivo" && (
              <div className="space-y-1.5">
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*"
                  disabled={procesando}
                  onChange={(e) => setAudioArchivo(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white disabled:opacity-50"
                />
                {audioArchivo && (
                  <p className="text-xs text-muted">{audioArchivo.name} · {fmtBytes(audioArchivo.size)}</p>
                )}
                <p className="text-xs text-muted">Reemplaza el audio del video por este archivo (se recorta a lo que dure el más corto de los dos).</p>
              </div>
            )}

            {audioModo === "voz_clonada" && (
              <div className="space-y-2">
                <p className="text-xs text-muted">
                  Usa el mismo motor de clonación de voz de Voz IA (voicebox). Elige una voz ya clonada o crea una nueva.
                </p>
                <GeneradorVoz voz={vozParaVideo} disabled={procesando} />
              </div>
            )}
          </section>

          {/* Acción */}
          <div className="space-y-3">
            <button
              type="button"
              disabled={!archivo || !hayAccion || !audioListo || procesando || iniciarMutation.isPending}
              onClick={() => iniciarMutation.mutate()}
              className="flex w-full items-center justify-center gap-2 rounded-paper bg-accent px-4 py-3 text-sm font-extrabold text-white shadow-[0_3px_0_#045159] active:translate-y-0.5 disabled:opacity-50"
            >
              {procesando ? "Procesando…" : "Procesar video"}
            </button>

            {!hayAccion && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Activa "Quitar marca de agua" y/o elige un modo de audio distinto de "Original".
              </p>
            )}

            {iniciarMutation.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {(iniciarMutation.error as Error).message}
              </p>
            )}

            {procesando && (
              <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-2">
                <p className="text-sm text-ink">
                  {job?.status === "pending" ? "Iniciando…" : "Procesando…"}
                </p>
                {progresoPct !== null && (
                  <>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-input">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{ width: `${progresoPct}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted">
                      {job?.frame_actual} / {job?.total_frames} fotogramas ({progresoPct}%)
                    </p>
                  </>
                )}
              </div>
            )}

            {job?.status === "error" && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                {job.error || "Error al procesar el video"}
                <button
                  type="button"
                  onClick={reiniciar}
                  className="mt-2 block text-xs font-semibold underline"
                >
                  Intentar de nuevo
                </button>
              </div>
            )}

            {job?.status === "done" && job.video_url && (
              <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
                <p className="text-sm font-semibold text-ink">✅ Listo</p>
                <video controls src={job.video_url} className="w-full rounded-lg border border-border" />
                <div className="flex gap-2">
                  <a
                    href={`${job.video_url}?descargar=1`}
                    className="flex-1 rounded-lg bg-accent px-3 py-2 text-center text-sm font-semibold text-white"
                  >
                    Descargar
                  </a>
                  <button
                    type="button"
                    onClick={reiniciar}
                    className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink hover:border-accent/50"
                  >
                    Procesar otro video
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
