import { useState, useRef, useEffect, useCallback, MutableRefObject } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";

function _getApiToken(): string {
  return useTicketsAuth.getState().apiToken || _getApiToken() || "";
}
import { useModelos, CATEGORIA_COLOR, type Modelo } from "../hooks/useModelos";
import { usePanelChatMutation } from "../hooks/useChat";

// ── Types ──────────────────────────────────────────────────────────────────

interface VozConfig {
  engine: "qwen3" | "voicebox" | "elevenlabs" | "browser";
  language: string;
  speaker: string;
  clone_enabled: boolean;
  ref_text: string;
  ref_audio_path: string;
  qwen3_disponible: boolean;
  qwen3_clonacion: boolean;
  qwen3_voces: string[];
  idiomas: string[];
  wake_word: string;
  listen_memory: boolean;
  voicebox_profile: string;
  voicebox_engine: string;
  voicebox_disponible?: boolean;
  voicebox_perfiles?: Array<{ id: string; name: string }>;
  voicebox_engines?: string[];
}

interface VozStatus {
  elevenlabs: boolean;
  qwen3_local: boolean;
  voicebox_local: boolean;
  motor_activo: string;
  config: Partial<VozConfig>;
}

interface Notificacion {
  id: string;
  texto: string;
  nivel: "info" | "alerta" | "urgente";
  timestamp: string;
}

interface TurnMessage {
  role: "user" | "agent";
  text: string;
  time: string;
  modelo?: string;
  fromMemory?: boolean;
}

type ConvStatus = "idle" | "recording" | "transcribing" | "thinking" | "generating" | "speaking";

function formatTime(d: Date) {
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

const SESSION_VOZ = "voz_" + Math.random().toString(36).slice(2, 8);

// ── Progress stages hook ───────────────────────────────────────────────────

function useProgressStages() {
  const [pct, setPct]     = useState(0);
  const [label, setLabel] = useState("");
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);

  const advance = useCallback((from: number, to: number, ms: number, lbl: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setLabel(lbl);
    let cur = from;
    setPct(from);
    const step = (to - from) / (ms / 40);
    timerRef.current = setInterval(() => {
      cur = Math.min(cur + step, to - 1);
      setPct(cur);
    }, 40);
  }, []);

  const complete = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPct(100);
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPct(0);
    setLabel("");
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return { pct, label, advance, complete, reset };
}

// ── TTS hook ───────────────────────────────────────────────────────────────

function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const speak = useCallback(async (texto: string, onPlayStart?: () => void) => {
    if (!texto.trim()) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    setPlaying(true);
    const token = _getApiToken();
    try {
      const res = await fetch("/api/voz/sintetizar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ texto }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
        audio.onerror = () => { setPlaying(false); URL.revokeObjectURL(url); };
        onPlayStart?.();
        await audio.play();
        return;
      }
    } catch { /* fall through */ }
    if ("speechSynthesis" in window) {
      const utt = new SpeechSynthesisUtterance(texto);
      utt.lang = "es-CO"; utt.rate = 0.95;
      utt.onend   = () => setPlaying(false);
      utt.onerror = () => setPlaying(false);
      onPlayStart?.();
      window.speechSynthesis.speak(utt);
    } else { setPlaying(false); }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }, []);

  return { speak, stop, playing };
}

// ── MediaRecorder STT hook ─────────────────────────────────────────────────

function useRecorder(
  onTranscriptRef: MutableRefObject<(text: string) => void>,
  onTranscribingStart?: () => void,
) {
  const mrRef        = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const cleanupRef   = useRef<(() => void) | null>(null);
  const [recording, setRecording]       = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const transcribir = useCallback(async (blob: Blob) => {
    onTranscribingStart?.();
    setTranscribing(true);
    const token = _getApiToken();
    try {
      const ext  = blob.type.split("/")[1]?.split(";")[0] || "webm";
      const form = new FormData();
      form.append("audio", blob, `audio.${ext}`);
      const res  = await fetch("/api/voz/transcribir", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      const texto = data.texto?.trim() ?? "";
      onTranscriptRef.current(texto); // siempre llama: el handler decide qué hacer con silencio
      if (!texto) setError("No se detectó audio.");
    } catch {
      setError("Error al transcribir. Verifica la conexión.");
      onTranscriptRef.current(""); // permite al handler limpiar el estado
    } finally {
      setTranscribing(false);
    }
  }, [onTranscriptRef, onTranscribingStart]);

  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (mrRef.current?.state === "recording") mrRef.current.stop();
    setRecording(false);
  }, []);

  // silenceMs: auto-stop after N ms of silence (0 = disabled)
  // maxMs: hard stop after N ms (0 = disabled, for fixed passive chunks)
  const start = useCallback(async (silenceMs = 0, maxMs = 0) => {
    if (mrRef.current?.state === "recording") return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const fns: Array<() => void> = [];

      // Silence detection via AudioContext analyser
      if (silenceMs > 0) {
        try {
          const ctx      = new AudioContext();
          const source   = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          const data      = new Uint8Array(analyser.frequencyBinCount);
          let lastSound   = Date.now();
          let active      = true;
          const THRESHOLD = 10;

          const timer = setInterval(() => {
            if (!active) return;
            analyser.getByteFrequencyData(data);
            const half = data.length >> 1;
            let sum = 0;
            for (let i = 0; i < half; i++) sum += data[i];
            if (sum / half > THRESHOLD) lastSound = Date.now();
            if (Date.now() - lastSound > silenceMs) {
              active = false;
              clearInterval(timer);
              ctx.close().catch(() => {});
              if (mrRef.current?.state === "recording") { mrRef.current.stop(); setRecording(false); }
            }
          }, 100);

          fns.push(() => { active = false; clearInterval(timer); ctx.close().catch(() => {}); });
        } catch { /* AudioContext unavailable */ }
      }

      // Hard max-duration stop
      if (maxMs > 0) {
        const t = setTimeout(() => {
          if (mrRef.current?.state === "recording") { mrRef.current.stop(); setRecording(false); }
        }, maxMs);
        fns.push(() => clearTimeout(t));
      }

      cleanupRef.current = () => fns.forEach((f) => { try { f(); } catch {} });

      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        if (blob.size > 0) transcribir(blob);
      };
      mrRef.current = mr;
      mr.start(250);
      setRecording(true);
    } catch (e: any) {
      setError(e.name === "NotAllowedError"
        ? "Permiso de micrófono denegado."
        : `Error micrófono: ${e.message}`);
    }
  }, [transcribir]);

  return { start, stop, recording, transcribing, error };
}

// ── Mic button ─────────────────────────────────────────────────────────────

function MicButton({ state, onMouseDown, onMouseUp, onClick, listenMode }: {
  state: ConvStatus | "listening";
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onClick?: () => void;
  listenMode?: boolean;
}) {
  const label = {
    idle:        "Mantén 0 ó pulsa",
    recording:   "Suelta 0 ó pulsa para detener",
    transcribing:"Transcribiendo…",
    thinking:    "Procesando con IA…",
    generating:  "Generando audio…",
    speaking:    "Pulsa para detener",
    listening:   "Escucha activa",
  }[state] ?? "";

  const active = state === "recording" || state === "speaking";
  const busy   = state === "transcribing" || state === "thinking" || state === "generating";

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <button
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onClick={onClick}
        disabled={busy}
        className={`relative flex h-20 w-20 items-center justify-center rounded-full border-4 transition-all duration-200 disabled:opacity-50 ${
          listenMode
            ? "border-emerald-400 bg-emerald-500/15 text-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.3)]"
            : active
            ? "border-red-400 bg-red-500/20 text-red-400 shadow-[0_0_24px_rgba(239,68,68,0.4)]"
            : busy
            ? "border-yellow-400/60 bg-yellow-500/10 text-yellow-400"
            : "border-accent bg-accent/10 text-accent hover:bg-accent/20"
        }`}
      >
        {(active || listenMode) && (
          <span className={`absolute inset-0 rounded-full border-4 animate-ping opacity-25 ${
            listenMode ? "border-emerald-400" : "border-red-400"
          }`} />
        )}
        {busy ? (
          <span className="h-7 w-7 rounded-full border-[3px] border-current border-t-transparent animate-spin" />
        ) : (
          <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            {active ? (
              <rect x="6" y="6" width="12" height="12" rx="2" strokeLinejoin="round" />
            ) : (
              <>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
              </>
            )}
          </svg>
        )}
      </button>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────

function ProgressBar({ pct, label }: { pct: number; label: string }) {
  if (pct <= 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label || "Procesando…"}</span>
        <span className="text-xs font-mono text-accent">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── NIVEL colores ──────────────────────────────────────────────────────────

const NIVEL_CLS: Record<string, string> = {
  info:    "border-blue-500/30  bg-blue-500/10  text-blue-400",
  alerta:  "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  urgente: "border-red-500/30   bg-red-500/10   text-red-400",
};

// ── Voz Config Panel ───────────────────────────────────────────────────────

const ENGINE_LABELS: Record<string, string> = {
  qwen3:      "Qwen3 TTS",
  voicebox:   "Voicebox",
  elevenlabs: "ElevenLabs",
  browser:    "Navegador",
};

const ENGINE_COLORS: Record<string, string> = {
  qwen3:      "border-emerald-500/60 bg-emerald-500/10 text-emerald-400",
  voicebox:   "border-violet-500/60  bg-violet-500/10  text-violet-400",
  elevenlabs: "border-blue-500/60    bg-blue-500/10    text-blue-400",
  browser:    "border-border         bg-surface-hover  text-muted",
};

const IDIOMA_LABELS: Record<string, string> = {
  Spanish:  "Español", English: "English", Chinese: "中文", Japanese: "日本語",
  Korean: "한국어", German: "Deutsch", French: "Français", Italian: "Italiano", Russian: "Русский",
};

function VozConfigPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();

  const { data: cfg, isLoading } = useQuery<VozConfig>({
    queryKey: ["voz-config"],
    queryFn:  () => api.get("/api/voz/config"),
    staleTime: 5_000,
  });

  const saveMut = useMutation({
    mutationFn: (body: Partial<VozConfig>) => api.post("/api/voz/config", body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["voz-config"] }),
  });

  const uploadMut = useMutation({
    mutationFn: ({ file, refText }: { file: File; refText: string }) => {
      const token = _getApiToken();
      const form  = new FormData();
      form.append("audio", file);
      form.append("ref_text", refText);
      return fetch("/api/voz/config/referencia", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }).then((r) => r.json());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voz-config"] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => {
      const token = _getApiToken();
      return fetch("/api/voz/config/referencia", {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voz-config"] }),
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const token = _getApiToken();
      const res = await fetch("/api/voz/config/referencia/preview", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Sin audio");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play();
    },
  });

  const crearPerfilMut = useMutation({
    mutationFn: (nombre: string) =>
      api.post("/api/voz/voicebox/perfiles", { nombre }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voz-config"] }),
  });

  const subirMuestraMut = useMutation({
    mutationFn: ({ profileId, file, refText }: { profileId: string; file: File; refText: string }) => {
      const token = _getApiToken();
      const form  = new FormData();
      form.append("audio", file);
      if (refText) form.append("ref_text", refText);
      return fetch(`/api/voz/voicebox/perfiles/${profileId}/muestras`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }).then((r) => r.json());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voz-config"] }),
  });

  const [refText, setRefText]           = useState("");
  const [dragOver, setDragOver]         = useState(false);
  const [wakeWordLocal, setWakeWordLocal] = useState("");
  const [newPerfilNombre, setNewPerfilNombre] = useState("");
  const [vbRefText, setVbRefText]       = useState("");
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const vbFileInputRef  = useRef<HTMLInputElement>(null);

  // ── Mini-grabador para muestras de Voicebox ──────────────────────────────
  type RecPhase = "idle" | "recording" | "preview" | "uploading";
  const [recState, setRecState]   = useState<RecPhase>("idle");
  const [recSecs, setRecSecs]     = useState(0);
  const [recError, setRecError]   = useState<string | null>(null);
  const [recBlobUrl, setRecBlobUrl] = useState<string | null>(null);
  const recFileRef  = useRef<File | null>(null);
  const vbMrRef     = useRef<MediaRecorder | null>(null);
  const vbChunksRef = useRef<Blob[]>([]);
  const vbTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Limpiar object URL al desmontar
  useEffect(() => () => { if (recBlobUrl) URL.revokeObjectURL(recBlobUrl); }, [recBlobUrl]);

  const discardRec = () => {
    if (recBlobUrl) { URL.revokeObjectURL(recBlobUrl); setRecBlobUrl(null); }
    recFileRef.current = null;
    setRecState("idle");
    setRecSecs(0);
    setRecError(null);
  };

  const startVbRec = async () => {
    discardRec();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      vbChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) vbChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (vbTimerRef.current) clearInterval(vbTimerRef.current);
        const blob = new Blob(vbChunksRef.current, { type: mr.mimeType });
        if (blob.size === 0) { setRecState("idle"); setRecSecs(0); return; }
        const ext  = mr.mimeType.split("/")[1]?.split(";")[0] || "webm";
        recFileRef.current = new File([blob], `muestra.${ext}`, { type: mr.mimeType });
        setRecBlobUrl(URL.createObjectURL(blob));
        setRecState("preview");
      };
      vbMrRef.current = mr;
      mr.start(250);
      setRecState("recording");
      setRecSecs(0);
      vbTimerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch (e: any) {
      setRecError(e.name === "NotAllowedError" ? "Permiso de micrófono denegado." : e.message);
    }
  };

  const stopVbRec = () => {
    if (vbTimerRef.current) clearInterval(vbTimerRef.current);
    if (recSecs < 2) {
      setRecError("Graba al menos 2 segundos de audio.");
      if (vbMrRef.current) vbMrRef.current.onstop = () => { setRecState("idle"); setRecSecs(0); };
    }
    vbMrRef.current?.stop();
  };

  const guardarMuestra = (afterSave?: () => void) => {
    const file = recFileRef.current;
    if (!file || !cfg?.voicebox_profile) return;
    setRecState("uploading");
    subirMuestraMut.mutate(
      { profileId: cfg.voicebox_profile, file, refText: vbRefText },
      {
        onSuccess: () => {
          if (recBlobUrl) URL.revokeObjectURL(recBlobUrl);
          setRecBlobUrl(null);
          recFileRef.current = null;
          setRecState("idle");
          setRecSecs(0);
          setVbRefText("");
          setRecError(null);
          afterSave?.();
        },
        onError: () => {
          setRecError("Error al guardar. Intenta de nuevo.");
          setRecState("preview");
        },
      },
    );
  };

  const handleClose = () => {
    if (recState === "preview" && recFileRef.current) {
      guardarMuestra(onClose);
      return;
    }
    if (recState === "recording") {
      stopVbRec();
      return;
    }
    onClose();
  };

  useEffect(() => { if (cfg?.ref_text)  setRefText(cfg.ref_text); },     [cfg?.ref_text]);
  useEffect(() => { if (cfg?.wake_word) setWakeWordLocal(cfg.wake_word); }, [cfg?.wake_word]);

  if (isLoading) return (
    <div className="rounded-xl border border-border bg-surface-panel p-6 text-center text-sm text-muted">
      Cargando configuración…
    </div>
  );
  if (!cfg) return null;

  const engines: Array<VozConfig["engine"]> = ["qwen3", "voicebox", "elevenlabs", "browser"];
  const cloneCapableQwen3 = cfg.engine === "qwen3" && cfg.qwen3_clonacion;

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-5 space-y-5 max-h-[80vh] overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Configuración de Voz</h3>
        <button onClick={handleClose} className="text-muted hover:text-ink text-lg leading-none">×</button>
      </div>

      {/* ── Motor TTS ── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted uppercase tracking-wider">Motor TTS</p>
        <div className="flex flex-wrap gap-2">
          {engines.map((eng) => {
            const disp =
              eng === "qwen3"      ? cfg.qwen3_disponible :
              eng === "voicebox"   ? cfg.voicebox_disponible :
              true;
            return (
              <button key={eng} disabled={!disp}
                onClick={() => saveMut.mutate({ engine: eng })}
                title={!disp ? "No instalado" : undefined}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  cfg.engine === eng
                    ? ENGINE_COLORS[eng]
                    : "border-border text-muted hover:text-ink hover:border-accent/40"
                }`}
              >
                {ENGINE_LABELS[eng]}
                {!disp && <span className="ml-1 text-[10px] opacity-60">(no instalado)</span>}
                {disp && eng !== "browser" && eng !== "elevenlabs" &&
                  <span className="ml-1 text-[10px] opacity-50">GPU</span>}
              </button>
            );
          })}
        </div>
        {!cfg.voicebox_disponible && (
          <p className="text-[11px] text-muted">
            Para instalar Voicebox (mejor clonación):{" "}
            <code className="text-violet-400">bash scripts/instalar_voicebox.sh</code>
          </p>
        )}
      </div>

      {/* ── Idioma ── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted uppercase tracking-wider">Idioma</p>
        <div className="flex flex-wrap gap-2">
          {cfg.idiomas.map((lang) => (
            <button key={lang} onClick={() => saveMut.mutate({ language: lang })}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                cfg.language === lang
                  ? "border-accent bg-accent/10 text-accent font-semibold"
                  : "border-border text-muted hover:text-ink hover:border-accent/40"
              }`}>
              {IDIOMA_LABELS[lang] ?? lang}
            </button>
          ))}
        </div>
      </div>

      {/* ── Voz predefinida Qwen3 ── */}
      {cfg.engine === "qwen3" && !cfg.clone_enabled && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wider">Voz predefinida (Qwen3)</p>
          <div className="flex flex-wrap gap-2">
            {cfg.qwen3_voces.map((v) => (
              <button key={v} onClick={() => saveMut.mutate({ speaker: v })}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-all ${
                  cfg.speaker === v
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400 font-semibold"
                    : "border-border text-muted hover:text-ink hover:border-emerald-500/30"
                }`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Clonación Qwen3 ── */}
      {cloneCapableQwen3 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted uppercase tracking-wider">
              Clonación de voz (Qwen3)
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                cfg.clone_enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-border/40 text-muted"
              }`}>{cfg.clone_enabled ? "Activa" : "Inactiva"}</span>
            </p>
            {cfg.clone_enabled && (
              <div className="flex gap-2">
                <button onClick={() => previewMut.mutate()} disabled={previewMut.isPending}
                  className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-ink transition">
                  {previewMut.isPending ? "…" : "▶ Ref."}
                </button>
                <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
                  className="rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-400 hover:bg-red-500/10 transition">
                  Eliminar
                </button>
              </div>
            )}
          </div>
          <textarea value={refText} onChange={(e) => setRefText(e.target.value)}
            onBlur={() => saveMut.mutate({ ref_text: refText })}
            placeholder="Transcripción exacta del audio de referencia…" rows={2}
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs text-ink placeholder-muted resize-none focus:outline-none focus:border-accent/60" />
          <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) uploadMut.mutate({ file: f, refText }); }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 cursor-pointer transition-all ${
              dragOver ? "border-accent bg-accent/10 text-accent"
              : cfg.clone_enabled ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10"
              : "border-border text-muted hover:border-accent/40 hover:text-ink"
            }`}>
            <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate({ file: f, refText }); }} />
            {uploadMut.isPending
              ? <span className="h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              : <span className="text-xs">{cfg.clone_enabled ? "Reemplazar ref." : "Subir audio ref."}</span>}
            <p className="text-[11px] opacity-60">WAV · MP3 · ≥3s</p>
          </div>
        </div>
      )}

      {/* ── Voicebox: clonación de voz ── siempre visible cuando disponible */}
      {cfg.voicebox_disponible && (
        <div className="space-y-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-violet-400" />
            <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">
              Voicebox — Clonación de voz
            </p>
          </div>

          {/* Perfil activo */}
          <div className="space-y-1">
            <p className="text-[11px] text-muted">Perfil activo (se usa al generar con Voicebox)</p>
            <select value={cfg.voicebox_profile}
              onChange={(e) => saveMut.mutate({ voicebox_profile: e.target.value })}
              className="w-full rounded-lg border border-violet-500/30 bg-surface-hover px-3 py-2 text-sm text-ink focus:outline-none focus:border-violet-500/60">
              <option value="">Sin perfil (voz base)</option>
              {(cfg.voicebox_perfiles ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Motor interno */}
          <div className="space-y-1">
            <p className="text-[11px] text-muted">Modelo de síntesis</p>
            <div className="flex flex-wrap gap-2">
              {(cfg.voicebox_engines ?? ["qwen3","qwen3-0.6b","chatterbox","kokoro"]).map((e) => {
                const labels: Record<string,string> = {
                  "qwen3": "Qwen3 1.7B (clonación)",
                  "qwen3-0.6b": "Qwen3 0.6B (rápido)",
                  "chatterbox": "Chatterbox",
                  "chatterbox_turbo": "Chatterbox Turbo",
                  "kokoro": "Kokoro 82M",
                  "luxtts": "LuxTTS (CPU)",
                };
                return (
                  <button key={e} onClick={() => saveMut.mutate({ voicebox_engine: e })}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${
                      cfg.voicebox_engine === e
                        ? "border-violet-500/60 bg-violet-500/10 text-violet-400 font-semibold"
                        : "border-border text-muted hover:text-ink"
                    }`}>
                    {labels[e] ?? e}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted/60">
              qwen3 1.7B = mejor clonación (modelo ya descargado ✓)
            </p>
          </div>

          {/* Crear perfil */}
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted">Crear nuevo perfil de voz</p>
            <div className="flex gap-2">
              <input type="text" value={newPerfilNombre}
                onChange={(e) => setNewPerfilNombre(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newPerfilNombre.trim()) { crearPerfilMut.mutate(newPerfilNombre.trim()); setNewPerfilNombre(""); } }}
                placeholder="Nombre (ej: Hugo García)…"
                className="flex-1 rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-ink placeholder-muted focus:outline-none focus:border-violet-500/60" />
              <button onClick={() => { if (newPerfilNombre.trim()) { crearPerfilMut.mutate(newPerfilNombre.trim()); setNewPerfilNombre(""); } }}
                disabled={crearPerfilMut.isPending || !newPerfilNombre.trim()}
                className="rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs text-violet-400 hover:bg-violet-500/10 transition disabled:opacity-40">
                {crearPerfilMut.isPending ? "…" : "+ Crear"}
              </button>
            </div>
          </div>

          {/* Agregar muestras al perfil seleccionado */}
          {cfg.voicebox_profile ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted">
                Agregar muestra a «{(cfg.voicebox_perfiles ?? []).find((p) => p.id === cfg.voicebox_profile)?.name ?? cfg.voicebox_profile}»
              </p>
              <p className="text-[10px] text-muted/60">
                3-10 clips de 5-30 s · cuantos más, mejor calidad de clonación
              </p>

              {/* ── Fase: grabar / previsualizar / guardar ── */}

              {/* Botón grabar (idle) */}
              {recState === "idle" && (
                <div className="flex gap-2">
                  <button onClick={startVbRec}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-violet-500/40 py-3 text-xs font-semibold text-violet-400 hover:bg-violet-500/10 transition">
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zm0 14a7 7 0 01-7-7H3a9 9 0 0018 0h-2a7 7 0 01-7 7zm-1 4h2v3h-2z"/>
                    </svg>
                    Grabar muestra
                  </button>
                  <button onClick={() => vbFileInputRef.current?.click()}
                    title="Subir archivo de audio"
                    className="rounded-xl border border-border px-3 text-muted hover:text-ink hover:border-violet-500/40 transition text-xs">
                    📎
                  </button>
                </div>
              )}

              {/* Grabando */}
              {recState === "recording" && (
                <button onClick={stopVbRec}
                  className="w-full flex items-center justify-center gap-3 rounded-xl border-2 border-red-500/60 bg-red-500/10 py-3 text-xs font-semibold text-red-400 hover:bg-red-500/15 transition">
                  <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse" />
                  {String(Math.floor(recSecs / 60)).padStart(2, "0")}:{String(recSecs % 60).padStart(2, "0")}
                  <span className="opacity-70">— Detener grabación</span>
                </button>
              )}

              {/* Previsualización — escuchar antes de guardar */}
              {recState === "preview" && recBlobUrl && (
                <div className="space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
                  <p className="text-[11px] text-violet-400 font-medium">
                    Grabación lista · {String(Math.floor(recSecs / 60)).padStart(2,"0")}:{String(recSecs % 60).padStart(2,"0")} s — escucha antes de guardar
                  </p>
                  {/* Reproductor nativo */}
                  <audio src={recBlobUrl} controls className="w-full h-8 rounded-lg" />
                  {/* Transcripción — aquí sí tiene sentido escribirla */}
                  <input type="text" value={vbRefText} onChange={(e) => setVbRefText(e.target.value)}
                    placeholder="Transcripción exacta de lo que dijiste (mejora calidad)…"
                    className="w-full rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-ink placeholder-muted focus:outline-none focus:border-violet-500/60" />
                  <div className="flex gap-2">
                    <button onClick={() => guardarMuestra()}
                      className="flex-1 rounded-xl border border-violet-500/60 bg-violet-500/10 py-2 text-xs font-semibold text-violet-400 hover:bg-violet-500/20 transition">
                      ✓ Guardar muestra
                    </button>
                    <button onClick={startVbRec}
                      className="rounded-xl border border-border px-3 py-2 text-xs text-muted hover:text-ink transition"
                      title="Volver a grabar">
                      ↺
                    </button>
                    <button onClick={discardRec}
                      className="rounded-xl border border-red-500/30 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition"
                      title="Descartar">
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Subiendo */}
              {recState === "uploading" && (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-violet-500/30 py-3 text-xs text-violet-400">
                  <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Guardando muestra en el perfil…
                </div>
              )}

              {/* Transcripción (solo cuando idle — para archivos subidos) */}
              {recState === "idle" && (
                <input type="text" value={vbRefText} onChange={(e) => setVbRefText(e.target.value)}
                  placeholder="Transcripción del archivo a subir (opcional)…"
                  className="w-full rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-ink placeholder-muted focus:outline-none focus:border-violet-500/60" />
              )}

              <input ref={vbFileInputRef} type="file" accept="audio/*" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { subirMuestraMut.mutate({ profileId: cfg.voicebox_profile, file: f, refText: vbRefText }); setVbRefText(""); }
                  e.target.value = "";
                }} />

              {recError && <p className="text-[11px] text-red-400">{recError}</p>}
              {subirMuestraMut.isSuccess && recState === "idle" && (
                <p className="text-[11px] text-emerald-400">✓ Muestra guardada en el perfil</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-violet-400/60 italic">
              Crea o selecciona un perfil para agregar muestras de voz
            </p>
          )}
        </div>
      )}

      {/* ── Palabra de activación (modo escucha) ── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted uppercase tracking-wider">
          Modo escucha — Palabra de activación
        </p>
        <input type="text" value={wakeWordLocal}
          onChange={(e) => setWakeWordLocal(e.target.value.toLowerCase())}
          onBlur={() => saveMut.mutate({ wake_word: wakeWordLocal })}
          placeholder="ej: hugo"
          className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink placeholder-muted focus:outline-none focus:border-accent/60" />
        <div className="flex items-center gap-2">
          <button onClick={() => saveMut.mutate({ listen_memory: !cfg.listen_memory })}
            className={`relative flex h-4 w-8 cursor-pointer rounded-full transition-colors ${
              cfg.listen_memory ? "bg-accent" : "bg-border"
            }`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
              cfg.listen_memory ? "translate-x-4" : "translate-x-0.5"
            }`} />
          </button>
          <span className="text-[11px] text-muted">
            Guardar en memoria lo que escucho (sin palabra de activación)
          </span>
        </div>
      </div>

      {saveMut.isPending && (
        <p className="text-[11px] text-muted text-center animate-pulse">Guardando…</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function VozIA() {
  const { data: modelos = [] } = useModelos();
  const { data: vozStatus }    = useQuery<VozStatus>({
    queryKey: ["voz-status"],
    queryFn:  () => api.get("/api/voz/status"),
    refetchInterval: 30_000,
  });
  const { data: notifData, refetch: refetchNotif } = useQuery<{ notificaciones: Notificacion[]; total: number }>({
    queryKey: ["voz-notificaciones"],
    queryFn:  () => api.get("/api/voz/notificaciones"),
    refetchInterval: 8_000,
  });

  const { speak, stop: stopTTS } = useTTS();
  const chat                     = usePanelChatMutation();
  const progress                 = useProgressStages();

  // ── Config state ──────────────────────────────────────────────────────────
  const { data: vozCfg } = useQuery<VozConfig>({
    queryKey: ["voz-config"],
    queryFn:  () => api.get("/api/voz/config"),
    staleTime: 10_000,
  });

  const [modeloId, setModeloId]       = useState("claude-sonnet-4-6");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [configOpen, setConfigOpen]   = useState(false);
  const [notifOpen, setNotifOpen]     = useState(false);
  const modeloActual = modelos.find((m) => m.id === modeloId);

  useEffect(() => {
    if (modelos.length && !modelos.find((m) => m.id === modeloId))
      setModeloId(modelos[0].id);
  }, [modelos]);

  // ── Conversation state ────────────────────────────────────────────────────
  const [messages, setMessages]       = useState<TurnMessage[]>([]);
  const [convStatus, setConvStatus]   = useState<ConvStatus>("idle");
  const [lastTranscript, setLastTranscript] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // ── Listen mode state ─────────────────────────────────────────────────────
  const [listenMode, setListenMode]   = useState(false);
  const listenModeRef                 = useRef(false);
  const wakeWordRef                   = useRef("hugo");
  const listenChunkTimer              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeActivatedRef              = useRef(false);
  const partialQueryRef               = useRef(""); // fragmento de pregunta del chunk pasivo
  const passiveListenRef              = useRef(false); // chunk pasivo: no mostrar estado en UI
  const convStatusRef                 = useRef<ConvStatus>("idle");

  useEffect(() => { listenModeRef.current = listenMode; }, [listenMode]);
  useEffect(() => {
    if (vozCfg?.wake_word) wakeWordRef.current = vozCfg.wake_word;
  }, [vozCfg?.wake_word]);

  const addMemoryMut = useMutation({
    mutationFn: (texto: string) =>
      api.post("/api/voz/memoria", { texto, fuente: "voz_escucha" }),
  });

  // ── sendToAgent (needs stable ref to avoid stale closures) ───────────────
  const sendToAgentRef = useRef<(text: string) => void>(() => {});

  const sessionId = `${SESSION_VOZ}_${modeloId.replace(/[^a-z0-9]/gi, "_")}`;

  const scheduleNextChunk = useCallback(() => {
    if (!listenModeRef.current) return;
    if (listenChunkTimer.current) clearTimeout(listenChunkTimer.current);
    listenChunkTimer.current = setTimeout(() => {
      if (!listenModeRef.current || convStatusRef.current !== "idle") return;
      passiveListenRef.current = true; // chunk pasivo: la UI no cambia de estado
      recorderRef.current?.start(0, 4000); // 4 s fijo para detección de wake word
    }, 700);
  }, []);

  // ── Transcript handler ref — swapped by mode ──────────────────────────────
  const transcriptHandlerRef = useRef<(text: string) => void>(() => {});

  const normalHandler = useCallback((text: string) => {
    setLastTranscript(text);
    sendToAgentRef.current(text);
  }, []);

  const listenHandler = useCallback((text: string) => {
    // Fin del chunk pasivo — siempre resetear passiveListenRef
    const wasPasive = passiveListenRef.current;
    passiveListenRef.current = false;

    // Silencio o transcripción vacía — siempre resetear wakeActivatedRef
    if (!text.trim()) {
      wakeActivatedRef.current = false;
      if (wasPasive) {
        scheduleNextChunk(); // sigue esperando la palabra mágica
      } else {
        // Grabación activa (pregunta) no detectó audio → volver a escucha pasiva
        setConvStatus("idle");
        scheduleNextChunk();
      }
      return;
    }

    const lower = text.toLowerCase().trim();
    const wake  = wakeWordRef.current.toLowerCase().trim();

    // Stage 2: ya se activó la palabra mágica → combinar con fragmento parcial del chunk pasivo
    if (wakeActivatedRef.current) {
      wakeActivatedRef.current = false;
      const partial = partialQueryRef.current;
      partialQueryRef.current = "";
      // Combinar: fragmento previo + lo que capturó la grabación activa
      const combined = partial
        ? partial + (text.trim() ? " " + text.trim() : "")
        : text;
      if (combined.trim()) {
        setLastTranscript(combined);
        sendToAgentRef.current(combined);
      } else {
        // Nada capturado → volver a escucha pasiva
        setConvStatus("idle");
        scheduleNextChunk();
      }
      return;
    }

    // Stage 1: chunk pasivo — buscar palabra mágica
    const wakeIdx = wake ? lower.indexOf(wake) : -1;
    if (wakeIdx >= 0) {
      // Siempre iniciar grabación activa aunque haya texto después del wake word.
      // El chunk de 4 s puede haber cortado la frase a la mitad; la grabación
      // activa con silencio captura el resto y combina con el fragmento parcial.
      const query = text.slice(wakeIdx + wake.length).trim();
      setConvStatus("idle");
      partialQueryRef.current = query; // guardar fragmento (puede estar incompleto)
      wakeActivatedRef.current = true;
      setTimeout(() => {
        if (listenModeRef.current && convStatusRef.current === "idle") {
          recorderRef.current?.start(1500, 10000); // 1.5 s silencio o máx 10 s
        } else {
          wakeActivatedRef.current = false;
          partialQueryRef.current = "";
        }
      }, 200);
    } else {
      // Sin palabra mágica — guardar en memoria y seguir escuchando
      if (vozCfg?.listen_memory !== false) {
        addMemoryMut.mutate(text);
        setMessages((m) => [...m, {
          role: "user", text: `[escucha] ${text}`, time: formatTime(new Date()), fromMemory: true,
        }]);
      }
      scheduleNextChunk();
    }
  }, [vozCfg?.listen_memory, scheduleNextChunk]);

  useEffect(() => {
    transcriptHandlerRef.current = listenMode ? listenHandler : normalHandler;
  }, [listenMode, listenHandler, normalHandler]);

  // ── Recorder ──────────────────────────────────────────────────────────────
  const handleTranscribingStart = useCallback(() => {
    if (passiveListenRef.current) return; // escucha pasiva: sin cambio de UI
    setConvStatus("transcribing");
    progress.advance(5, 33, 3000, "Transcribiendo audio…");
  }, [progress]);

  const recorder = useRecorder(transcriptHandlerRef, handleTranscribingStart);
  // Store ref so scheduleNextChunk can access start()
  const recorderRef = useRef(recorder);
  useEffect(() => { recorderRef.current = recorder; }, [recorder]);

  // ── sendToAgent ───────────────────────────────────────────────────────────
  const sendToAgent = useCallback((text: string) => {
    if (!text.trim()) return;
    const cs = convStatusRef.current;
    if (cs === "thinking" || cs === "generating" || cs === "speaking") return;
    setConvStatus("thinking");
    setLastTranscript("");
    setMessages((m) => [...m, { role: "user", text, time: formatTime(new Date()) }]);
    progress.advance(35, 70, 8000, "Procesando con IA…");

    chat.mutate(
      { mensaje: text, session_id: sessionId, modelo_id: modeloId },
      {
        onSuccess: async (data) => {
          const agentText = data.respuesta;
          setMessages((m) => [...m, {
            role: "agent", text: agentText, time: formatTime(new Date()), modelo: data.modelo_id,
          }]);
          // "generating" = TTS fetch in progress, audio not yet playing
          setConvStatus("generating");
          progress.advance(70, 92, 5000, "Generando audio…");
          await speak(agentText, () => {
            // called right before audio.play() — only now show "speaking"
            setConvStatus("speaking");
            progress.advance(92, 100, 800, "Reproduciendo…");
          });
          progress.complete();
          setTimeout(() => { progress.reset(); setConvStatus("idle"); }, 600);
          if (listenModeRef.current) setTimeout(scheduleNextChunk, 1200);
        },
        onError: (err) => {
          setMessages((m) => [...m, {
            role: "agent", text: `Error: ${err.message}`, time: formatTime(new Date()),
          }]);
          progress.reset();
          setConvStatus("idle");
          if (listenModeRef.current) setTimeout(scheduleNextChunk, 1000);
        },
      },
    );
  }, [chat, modeloId, sessionId, speak, progress, scheduleNextChunk]);

  // Keep ref in sync
  useEffect(() => { sendToAgentRef.current = sendToAgent; }, [sendToAgent]);

  // ── Sync convStatus with recorder state ───────────────────────────────────
  useEffect(() => {
    // Chunks pasivos de escucha no cambian el estado visual
    if (!passiveListenRef.current) {
      if (recorder.recording && convStatusRef.current === "idle")      setConvStatus("recording");
      if (!recorder.recording && convStatusRef.current === "recording") setConvStatus("transcribing");
    }
  }, [recorder.recording]);

  // ── Sync convStatusRef ────────────────────────────────────────────────────
  useEffect(() => { convStatusRef.current = convStatus; }, [convStatus]);

  // ── Listen mode lifecycle ─────────────────────────────────────────────────
  useEffect(() => {
    if (listenMode) {
      if (!recorder.recording && convStatus === "idle") {
        passiveListenRef.current = true;
        recorder.start(0, 4000);
      }
    } else {
      if (listenChunkTimer.current) clearTimeout(listenChunkTimer.current);
      wakeActivatedRef.current = false;
      passiveListenRef.current = false;
    }
    return () => { if (listenChunkTimer.current) clearTimeout(listenChunkTimer.current); };
  }, [listenMode]);

  // ── Push-to-talk: key "0" (no silence detection — key release controls stop) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") && !e.repeat) {
        if (convStatusRef.current === "idle" && !listenModeRef.current) {
          e.preventDefault();
          recorder.start(0, 0);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") {
        if (recorder.recording) {
          e.preventDefault();
          recorder.stop();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [recorder]);

  // ── Notifications auto-speak ───────────────────────────────────────────────
  const prevNotifCount = useRef(0);
  const notificaciones = notifData?.notificaciones ?? [];
  useEffect(() => {
    const cur = notificaciones.length;
    if (cur > prevNotifCount.current && prevNotifCount.current > 0)
      notificaciones.slice(0, cur - prevNotifCount.current).forEach((n) => speak(n.texto));
    prevNotifCount.current = cur;
  }, [notificaciones.length]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Mic button handlers ───────────────────────────────────────────────────
  const handleMic = () => {
    const cs = convStatusRef.current;
    if (cs === "speaking" || cs === "generating") { stopTTS(); setConvStatus("idle"); progress.reset(); return; }
    if (cs === "recording") { recorder.stop(); return; }
    if (cs === "idle" && !listenMode) { recorder.start(5000, 0); return; } // 5s silence auto-stop
  };

  const dismissNotif = async (id: string) => {
    await api.post("/api/voz/notificaciones/marcar", { ids: [id] });
    refetchNotif();
  };

  // ── Motor label/color ──────────────────────────────────────────────────────
  const motorLabel = {
    "qwen3":          "Qwen3 TTS (GPU)",
    "qwen3-clone":    "Qwen3 TTS · voz clonada",
    "voicebox":       "Voicebox (GPU)",
    "voicebox-clone": "Voicebox · perfil",
    "elevenlabs":     "ElevenLabs API",
    "browser":        "Navegador (fallback)",
  }[vozStatus?.motor_activo ?? "browser"] ?? vozStatus?.motor_activo ?? "–";

  const motorColor =
    vozStatus?.motor_activo?.startsWith("voicebox") ? "text-violet-400"  :
    vozStatus?.motor_activo?.startsWith("qwen3")    ? "text-emerald-400" :
    vozStatus?.motor_activo === "elevenlabs"         ? "text-blue-400"    :
    "text-muted";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative mx-auto flex h-full max-w-2xl flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Voz IA</h2>
          <p className="text-xs text-muted mt-0.5">
            STT: <span className="text-ink font-medium">Whisper (GPU)</span>
            {" · "}
            TTS: <span className={`font-medium ${motorColor}`}>{motorLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Listen mode toggle */}
          <button
            onClick={() => setListenMode((l) => !l)}
            title="Modo escucha continua"
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              listenMode
                ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.2)]"
                : "border-border text-muted hover:text-ink"
            }`}
          >
            {listenMode ? "🟢 Escuchando" : "👂 Escucha"}
          </button>

          {/* Notificaciones */}
          <button onClick={() => setNotifOpen((o) => !o)}
            className={`relative rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              notificaciones.length > 0
                ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
                : "border-border text-muted hover:text-ink"
            }`}>
            🔔
            {notificaciones.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {notificaciones.length}
              </span>
            )}
          </button>

          {/* Config voz */}
          <button onClick={() => setConfigOpen((o) => !o)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              configOpen
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:text-ink"
            }`} title="Configuración de voz">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Modelo */}
          <button onClick={() => setSelectorOpen((o) => !o)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              CATEGORIA_COLOR[modeloActual?.categoria ?? "claude"]
            } border-current`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {modeloActual?.nombre ?? modeloId}
          </button>
        </div>
      </div>

      {/* Model selector — dropdown absoluto */}
      {selectorOpen && (
        <div className="absolute right-0 top-12 z-30 w-72 rounded-xl border border-border bg-surface-panel p-3 flex flex-wrap gap-2 shadow-xl">
          {modelos.map((m: Modelo) => (
            <button key={m.id}
              onClick={() => { setModeloId(m.id); setSelectorOpen(false); }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                m.id === modeloId
                  ? `${CATEGORIA_COLOR[m.categoria]} border-current font-bold`
                  : "text-muted border-border hover:text-ink hover:border-accent/50"
              }`}>
              {m.nombre}
              {m.categoria === "ollama" && <span className="ml-1 opacity-50 text-[10px]">+memoria</span>}
            </button>
          ))}
        </div>
      )}

      {/* Config voz — overlay flotante, siempre montado para no perder estado de grabación */}
      <div className={`absolute inset-0 z-40 flex flex-col ${configOpen ? "" : "hidden"}`}>
        {/* Click fuera cierra — el panel maneja auto-guardar si hay grabación pendiente */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          onClick={() => setConfigOpen(false)} />
        <div className="relative z-10 m-3 mt-14 overflow-y-auto rounded-xl max-h-[calc(100%-4rem)]">
          <VozConfigPanel onClose={() => setConfigOpen(false)} />
        </div>
      </div>

      {/* Listen mode info */}
      {listenMode && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-emerald-400">Modo escucha activo</p>
            <p className="text-[11px] text-muted">
              Activación: "<span className="text-emerald-400 font-medium">{vozCfg?.wake_word ?? "hugo"}</span>"
              {vozCfg?.listen_memory !== false && " · Guardando en memoria"}
            </p>
          </div>
          <button onClick={() => setListenMode(false)}
            className="text-xs text-emerald-400/60 hover:text-emerald-400 transition">Detener</button>
        </div>
      )}

      {/* Notificaciones */}
      {notifOpen && (
        <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Notificaciones</h3>
            {notificaciones.length > 0 && (
              <button onClick={async () => { await api.post("/api/voz/notificaciones/marcar", {}); refetchNotif(); }}
                className="text-xs text-muted hover:text-ink transition">Descartar todas</button>
            )}
          </div>
          {notificaciones.length === 0
            ? <p className="text-xs text-muted py-2 text-center">Sin notificaciones</p>
            : notificaciones.map((n) => (
              <div key={n.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${NIVEL_CLS[n.nivel] ?? NIVEL_CLS.info}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-relaxed">{n.texto}</p>
                  <p className="text-[10px] opacity-60 mt-0.5">{new Date(n.timestamp).toLocaleTimeString("es-CO")}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => speak(n.texto)} className="rounded-lg border border-current/30 px-2 py-1 text-[11px] hover:bg-current/10 transition">▶</button>
                  <button onClick={() => dismissNotif(n.id)} className="rounded-lg border border-current/30 px-2 py-1 text-[11px] hover:bg-current/10 transition">✕</button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Conversation */}
      <div className="flex-1 overflow-auto rounded-xl border border-border bg-surface-panel p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
            <p className="text-sm text-muted text-center">
              {listenMode
                ? `Escuchando… habla "${vozCfg?.wake_word ?? "hugo"}" para activar`
                : "Mantén 0 presionado para hablar · o pulsa el micrófono"}
            </p>
            <p className="text-xs text-muted/60 text-center max-w-xs">
              STT: Whisper · TTS: {motorLabel}
              {modeloActual?.categoria === "ollama" && " · Con memoria vectorial"}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === "user"
                ? m.fromMemory
                  ? "rounded-br-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                  : "rounded-br-md bg-accent text-white"
                : "rounded-bl-md bg-surface-hover text-ink"
            }`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              <div className={`mt-1 flex items-center gap-1.5 ${m.role === "user" ? "justify-end" : ""}`}>
                <span className={`text-[10px] ${m.role === "user" ? "text-white/60" : "text-muted"}`}>{m.time}</span>
                {m.fromMemory && <span className="text-[10px] text-emerald-400/60">→ memoria</span>}
                {m.role === "agent" && m.modelo && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono ${
                    CATEGORIA_COLOR[modelos.find((x) => x.id === m.modelo)?.categoria ?? "claude"]
                  }`}>
                    {m.modelo.length > 20 ? m.modelo.slice(0, 18) + "…" : m.modelo}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {convStatus === "thinking" && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-surface-hover px-4 py-3 flex gap-1.5">
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:150ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:300ms]" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Transcript preview */}
      {lastTranscript && (
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-2 flex items-center gap-2">
          <span className="text-xs text-muted shrink-0">Transcripción:</span>
          <span className="text-sm text-ink truncate">{lastTranscript}</span>
        </div>
      )}

      {/* Progress bar */}
      <ProgressBar pct={progress.pct} label={progress.label} />

      {recorder.error && (
        <p className="text-xs text-red-400 text-center">{recorder.error}</p>
      )}

      {/* Mic */}
      <div className="flex flex-col items-center gap-2 py-2">
        <MicButton
          state={listenMode ? "listening" : convStatus}
          onClick={handleMic}
          listenMode={listenMode}
        />
        <p className="text-[11px] text-muted/50">
          {listenMode ? `Palabra activa: "${vozCfg?.wake_word ?? "hugo"}"` : "Mantén ⌨️ 0 presionado para hablar"}
        </p>
      </div>
    </div>
  );
}
