import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useTicketsAuth } from "../stores/ticketsAuth";

type Canal = "meli" | "web" | "whatsapp" | "";

interface VentaItem {
  nombre?: string;
  name?: string;
  title?: string;
  sku?: string;
  cantidad?: number;
  qty?: number;
  quantity?: number;
  precio?: number;
}

interface Venta {
  canal: "meli" | "web" | "whatsapp";
  id: string;
  fecha: string;
  cliente: string;
  telefono?: string;
  total?: number | null;
  estado: string;
  items: VentaItem[];
  items_resumen?: string;
  notas?: string;
  evidencias_count: number;
  origen?: string;
}

interface VentasResp {
  ventas: Venta[];
  total: number;
  dias: number;
  resumen: { meli: number; web: number; whatsapp: number; sin_evidencia: number };
  errores?: string[];
}

interface Evidencia {
  id: number;
  archivo: string;
  url: string;
  nota: string;
  subido_por: string;
  creado_en: string;
}

const CANAL_META: Record<string, { label: string; cls: string }> = {
  meli: { label: "Mercado Libre", cls: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30 dark:text-yellow-300" },
  web: { label: "Página web", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" },
  whatsapp: { label: "WhatsApp", cls: "bg-lime-500/15 text-lime-700 border-lime-500/30 dark:text-lime-300" },
};

function fmtCOP(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtDate(s: string) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("es-CO", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function evidenciaImgUrl(url: string, token: string | null) {
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/** Modal cámara: vista previa + disparo → File JPEG listo para subir. */
function CamaraEvidenciaModal({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    let cancelled = false;
    setError(null);
    setReady(false);

    (async () => {
      if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia == null) {
        setError("Este dispositivo no permite cámara en el navegador. Usa «Elegir de galería».");
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
    if (!video || !ready) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("No se pudo capturar la imagen.");
          return;
        }
        const file = new File([blob], `empaque_${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  }, [ready, onCapture, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <p className="text-sm font-bold">Evidencia de empaque</p>
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
          disabled={!ready}
          onClick={disparar}
          className="h-16 w-16 rounded-full border-4 border-white bg-accent shadow-lg disabled:opacity-40"
          aria-label="Tomar foto"
          title="Tomar foto"
        />
        <span className="w-14 text-center text-[10px] text-white/50">Disparar</span>
      </div>
    </div>
  );
}

export default function EmpaquePanel() {
  const qc = useQueryClient();
  const token = useTicketsAuth((s) => s.apiToken || s.token);
  const [canal, setCanal] = useState<Canal>("");
  const [dias, setDias] = useState(7);
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [soloSin, setSoloSin] = useState(false);
  const [sel, setSel] = useState<Venta | null>(null);
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [showWaForm, setShowWaForm] = useState(false);
  const [waCliente, setWaCliente] = useState("");
  const [waTel, setWaTel] = useState("");
  const [waProds, setWaProds] = useState("");
  const [waTotal, setWaTotal] = useState("");
  const [camaraOpen, setCamaraOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const queryKey = useMemo(
    () => ["empaque-ventas", canal, dias, q, soloSin] as const,
    [canal, dias, q, soloSin],
  );

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("dias", String(dias));
      if (canal) params.set("canal", canal);
      if (q) params.set("q", q);
      if (soloSin) params.set("solo_sin_evidencia", "1");
      return api.get<VentasResp>(`/api/empaque/ventas?${params}`);
    },
    refetchInterval: 60_000,
  });

  const evidenciasQ = useQuery({
    queryKey: ["empaque-evidencias", sel?.canal, sel?.id],
    enabled: Boolean(sel?.canal && sel?.id),
    queryFn: () =>
      api.get<{ evidencias: Evidencia[] }>(
        `/api/empaque/ventas/${sel!.canal}/${encodeURIComponent(sel!.id)}/evidencias`,
      ),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      if (!sel) throw new Error("Selecciona una venta");
      // Algunos móviles envían File sin nombre → el API lo rechazaba.
      const named =
        file.name && file.name.trim()
          ? file
          : new File([file], `empaque_${Date.now()}.jpg`, {
              type: file.type || "image/jpeg",
            });
      const fd = new FormData();
      fd.append("foto", named, named.name);
      if (nota.trim()) fd.append("nota", nota.trim());
      return api.upload<{ ok: boolean; evidencia: Evidencia }>(
        `/api/empaque/ventas/${sel.canal}/${encodeURIComponent(sel.id)}/evidencias`,
        fd,
      );
    },
    onSuccess: () => {
      setNota("");
      setMsg("Foto guardada. Queda como evidencia del empaque.");
      qc.invalidateQueries({ queryKey: ["empaque-evidencias", sel?.canal, sel?.id] });
      qc.invalidateQueries({ queryKey: ["empaque-ventas"] });
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    },
    onError: (e: Error) =>
      setMsg(e.message || "No se pudo guardar la foto. Revisa conexión y permisos."),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => api.delete<{ ok: boolean }>(`/api/empaque/evidencias/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empaque-evidencias", sel?.canal, sel?.id] });
      qc.invalidateQueries({ queryKey: ["empaque-ventas"] });
    },
  });

  const crearWaMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; venta: Venta }>("/api/empaque/whatsapp", {
        cliente: waCliente,
        telefono: waTel,
        productos: waProds,
        total: waTotal ? Number(waTotal.replace(/\D/g, "")) : null,
      }),
    onSuccess: (r) => {
      setShowWaForm(false);
      setWaCliente("");
      setWaTel("");
      setWaProds("");
      setWaTotal("");
      setMsg("Pedido WhatsApp registrado. Ya puedes subir fotos.");
      setCanal("whatsapp");
      setSel(r.venta);
      qc.invalidateQueries({ queryKey: ["empaque-ventas"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const subirArchivo = useCallback(
    (file: File) => {
      setMsg(null);
      uploadMut.mutate(file);
    },
    [uploadMut],
  );

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      subirArchivo(f);
    },
    [subirArchivo],
  );

  const abrirCamara = useCallback(() => {
    setMsg(null);
    // En móvil: cámara nativa del sistema. En escritorio: modal getUserMedia.
    const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (isTouch && cameraInputRef.current) {
      cameraInputRef.current.click();
      return;
    }
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia != null) {
      setCamaraOpen(true);
      return;
    }
    cameraInputRef.current?.click();
  }, []);

  const ventas = data?.ventas ?? [];
  const resumen = data?.resumen;

  const detalleEvidencia = sel ? (
    <>
      <div>
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${
            CANAL_META[sel.canal]?.cls ?? ""
          }`}
        >
          {CANAL_META[sel.canal]?.label}
        </span>
        <h2 className="mt-1 text-sm font-bold text-ink break-words [overflow-wrap:anywhere]">
          {sel.cliente || "Sin nombre"}
        </h2>
        <p className="font-mono text-xs text-muted break-all">{sel.id}</p>
        <p className="mt-1 text-sm text-muted">
          {fmtDate(sel.fecha)} · {fmtCOP(sel.total)} · {sel.estado}
        </p>
        {sel.telefono && <p className="text-sm text-ink">Tel: {sel.telefono}</p>}
        {sel.notas && <p className="mt-1 text-xs text-muted break-words">{sel.notas}</p>}
      </div>

      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Productos</p>
        <ul className="space-y-1 text-sm text-ink">
          {(sel.items || []).length === 0 && (
            <li className="text-muted break-words">{sel.items_resumen || "—"}</li>
          )}
          {(sel.items || []).map((it, i) => {
            const nom = it.nombre || it.name || it.title || "?";
            const cant = it.cantidad ?? it.qty ?? it.quantity ?? 1;
            return (
              <li
                key={i}
                className="flex justify-between gap-2 border-b border-border/40 py-1.5"
              >
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">{nom}</span>
                <span className="shrink-0 font-semibold">×{cant}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-lg border border-dashed border-accent/40 bg-accent/5 p-3">
        <p className="mb-2 text-sm font-bold text-ink">Evidencia fotográfica</p>
        <p className="mb-2 text-xs text-muted">
          Abre la cámara, fotografía el contenido del paquete y se sube al instante.
        </p>
        {msg && (
          <p
            className={`mb-2 rounded-lg border px-3 py-2 text-sm ${
              /guardada|registrado/i.test(msg)
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                : "border-danger/40 bg-danger/10 text-danger"
            }`}
          >
            {msg}
          </p>
        )}
        {uploadMut.isPending && (
          <p className="mb-2 text-sm font-semibold text-accent">Subiendo foto…</p>
        )}
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Nota opcional (ej. 3 frascos + 2 sobres)"
          className="mb-3 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-ink sm:text-sm"
        />

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={onPickFile}
          disabled={uploadMut.isPending}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onPickFile}
          disabled={uploadMut.isPending}
        />

        <button
          type="button"
          disabled={uploadMut.isPending}
          onClick={abrirCamara}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-paper bg-accent px-4 py-3.5 text-base font-extrabold text-white shadow-[0_3px_0_#045159] active:translate-y-0.5 disabled:opacity-50"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          {uploadMut.isPending ? "Subiendo…" : "Tomar foto y cargar"}
        </button>

        <button
          type="button"
          disabled={uploadMut.isPending}
          onClick={() => galleryInputRef.current?.click()}
          className="mt-2 min-h-11 w-full rounded-paper border-2 border-border bg-surface-panel px-3 py-2.5 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
        >
          Elegir de galería
        </button>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          Evidencias ({evidenciasQ.data?.evidencias?.length ?? 0})
        </p>
        {evidenciasQ.isLoading && <p className="text-xs text-muted">Cargando…</p>}
        <div className="grid grid-cols-2 gap-2">
          {(evidenciasQ.data?.evidencias ?? []).map((ev) => (
            <figure key={ev.id} className="relative overflow-hidden rounded-lg border border-border">
              <a href={evidenciaImgUrl(ev.url, token)} target="_blank" rel="noreferrer">
                <img
                  src={evidenciaImgUrl(ev.url, token)}
                  alt={ev.nota || "Evidencia"}
                  className="aspect-square w-full object-cover"
                />
              </a>
              <figcaption className="truncate px-1.5 py-1 text-[10px] text-muted">
                {ev.subido_por || "—"} · {fmtDate(ev.creado_en)}
              </figcaption>
              <button
                type="button"
                title="Eliminar"
                onClick={() => delMut.mutate(ev.id)}
                className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white"
              >
                ✕
              </button>
            </figure>
          ))}
        </div>
        {!evidenciasQ.isLoading && (evidenciasQ.data?.evidencias?.length ?? 0) === 0 && (
          <p className="text-xs text-orange-600 dark:text-orange-300">
            Sin fotos todavía — tómalas antes de despachar.
          </p>
        )}
      </div>
    </>
  ) : null;

  const seleccionarVenta = (v: Venta) => {
    setSel(v);
    setMsg(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 sm:gap-2.5 sm:p-3">
      <CamaraEvidenciaModal
        open={camaraOpen}
        onClose={() => setCamaraOpen(false)}
        onCapture={subirArchivo}
      />

      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-bold text-ink dark:text-white">
            Empaque · Evidencia
          </h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setShowWaForm((v) => !v)}
            className="min-h-8 rounded-paper border border-border bg-surface-panel px-2.5 py-1 text-xs font-semibold text-ink hover:border-accent"
          >
            + Pedido WhatsApp
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            className="min-h-8 rounded-paper border border-accent bg-accent px-2.5 py-1 text-xs font-semibold text-white"
          >
            {isFetching ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </header>

      {showWaForm && (
        <div className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper">
          <p className="mb-3 text-sm font-bold text-ink">Registrar venta WhatsApp para empaque</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-muted">
              Cliente *
              <input
                value={waCliente}
                onChange={(e) => setWaCliente(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
                placeholder="Nombre del cliente"
              />
            </label>
            <label className="text-xs font-semibold text-muted">
              Teléfono
              <input
                value={waTel}
                onChange={(e) => setWaTel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
                placeholder="300…"
              />
            </label>
            <label className="text-xs font-semibold text-muted md:col-span-2">
              Productos (uno por línea)
              <textarea
                value={waProds}
                onChange={(e) => setWaProds(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
                placeholder={"Niacinamida 100g\nÁcido hialurónico 50g"}
              />
            </label>
            <label className="text-xs font-semibold text-muted">
              Total (COP, opcional)
              <input
                value={waTotal}
                onChange={(e) => setWaTotal(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
                placeholder="85000"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!waCliente.trim() || crearWaMut.isPending}
              onClick={() => crearWaMut.mutate()}
              className="min-h-11 rounded-paper bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {crearWaMut.isPending ? "Guardando…" : "Guardar pedido"}
            </button>
            <button
              type="button"
              onClick={() => setShowWaForm(false)}
              className="min-h-11 rounded-paper border border-border px-4 py-2 text-sm text-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filtros: ocultos en móvil cuando ya hay pedido seleccionado (más espacio para cámara) */}
      <div className={`flex flex-wrap items-end gap-2 ${sel ? "hidden lg:flex" : ""}`}>
        <label className="text-xs font-semibold text-muted">
          Canal
          <select
            value={canal}
            onChange={(e) => setCanal(e.target.value as Canal)}
            className="mt-1 block min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
          >
            <option value="">Todos</option>
            <option value="meli">Mercado Libre</option>
            <option value="web">Página web</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">
          Días
          <select
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            className="mt-1 block min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
          >
            {[3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                Últimos {d}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 basis-full text-xs font-semibold text-muted sm:basis-auto sm:min-w-[12rem]">
          Buscar
          <div className="mt-1 flex gap-1">
            <input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setQ(qDraft.trim());
              }}
              className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-ink sm:text-sm"
              placeholder="Cliente, ID, teléfono…"
            />
            <button
              type="button"
              onClick={() => setQ(qDraft.trim())}
              className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-ink"
            >
              Ir
            </button>
          </div>
        </label>
        <label className="flex min-h-10 items-center gap-2 pb-1 text-sm text-ink">
          <input
            type="checkbox"
            checked={soloSin}
            onChange={(e) => setSoloSin(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent,#0d9488)]"
          />
          Solo sin foto
        </label>
      </div>

      {resumen && (
        <div className={`flex flex-wrap gap-2 text-xs font-semibold ${sel ? "hidden lg:flex" : ""}`}>
          <span className="rounded-full border border-border px-3 py-1 text-muted">
            Total {data?.total ?? 0}
          </span>
          <span className={`rounded-full border px-3 py-1 ${CANAL_META.meli.cls}`}>
            MeLi {resumen.meli}
          </span>
          <span className={`rounded-full border px-3 py-1 ${CANAL_META.web.cls}`}>
            Web {resumen.web}
          </span>
          <span className={`rounded-full border px-3 py-1 ${CANAL_META.whatsapp.cls}`}>
            WA {resumen.whatsapp}
          </span>
          <span className="rounded-full border border-orange-400/40 bg-orange-500/10 px-3 py-1 text-orange-700 dark:text-orange-300">
            Sin evidencia {resumen.sin_evidencia}
          </span>
        </div>
      )}

      {msg && (
        <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink">
          {msg}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {(error as Error).message}
        </p>
      )}
      {(data?.errores?.length ?? 0) > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Aviso: {data!.errores!.join(" · ")}
        </p>
      )}

      {/* ── Móvil: lista de pedidos O detalle+cámara (no ambos a la vez) ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
        {!sel ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-4">
            {isLoading && (
              <p className="py-8 text-center text-sm text-muted">Cargando ventas…</p>
            )}
            {!isLoading && ventas.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">No hay ventas en este filtro.</p>
            )}
            {ventas.map((v) => {
              const meta = CANAL_META[v.canal] ?? CANAL_META.web;
              return (
                <button
                  key={`${v.canal}-${v.id}`}
                  type="button"
                  onClick={() => seleccionarVenta(v)}
                  className="flex w-full flex-col gap-1.5 rounded-xl border-2 border-border bg-surface-panel p-3 text-left shadow-paper active:border-accent active:bg-accent/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                    {v.evidencias_count > 0 ? (
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {v.evidencias_count} foto{v.evidencias_count !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-sm font-bold text-orange-600 dark:text-orange-400">
                        Sin foto
                      </span>
                    )}
                  </div>
                  <p className="text-base font-bold text-ink break-words [overflow-wrap:anywhere]">
                    {v.cliente || "—"}
                  </p>
                  <p className="font-mono text-[11px] text-muted break-all">{v.id}</p>
                  <p className="text-sm text-muted break-words [overflow-wrap:anywhere] line-clamp-2">
                    {v.items_resumen || "Sin productos"}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted">{fmtDate(v.fecha)}</span>
                    <span className="font-semibold text-ink">{fmtCOP(v.total)}</span>
                  </div>
                  <span className="mt-1 text-center text-xs font-semibold text-accent">
                    Tocar para evidenciar →
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-6">
            <button
              type="button"
              onClick={() => setSel(null)}
              className="sticky top-0 z-10 flex min-h-11 items-center gap-2 rounded-xl border-2 border-border bg-surface-panel px-3 py-2 text-sm font-bold text-ink shadow-paper"
            >
              ← Volver a pedidos
            </button>
            {detalleEvidencia}
          </div>
        )}
      </div>

      {/* ── Escritorio: tabla + aside ── */}
      <div className="hidden min-h-0 flex-1 gap-3 lg:grid lg:grid-cols-[1fr_300px]">
        <div className="mck-table-wrap min-h-0 overflow-auto rounded-paper border-2 border-border bg-surface-panel shadow-paper">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface-panel text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-1.5 font-bold">Canal</th>
                <th className="px-2 py-1.5 font-bold">Fecha</th>
                <th className="px-2 py-1.5 font-bold">Cliente / ID</th>
                <th className="px-2 py-1.5 font-bold">Productos</th>
                <th className="px-2 py-1.5 font-bold">Total</th>
                <th className="px-2 py-1.5 font-bold">Fotos</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-center text-muted">
                    Cargando ventas…
                  </td>
                </tr>
              )}
              {!isLoading && ventas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-center text-muted">
                    No hay ventas en este filtro.
                  </td>
                </tr>
              )}
              {ventas.map((v) => {
                const meta = CANAL_META[v.canal] ?? CANAL_META.web;
                const active = sel?.canal === v.canal && sel?.id === v.id;
                return (
                  <tr
                    key={`${v.canal}-${v.id}`}
                    onClick={() => seleccionarVenta(v)}
                    className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-hover ${
                      active ? "bg-accent/10" : ""
                    }`}
                  >
                    <td className="px-2 py-1">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-muted">{fmtDate(v.fecha)}</td>
                    <td className="px-2 py-1">
                      <div className="text-[13px] font-semibold leading-tight text-ink">{v.cliente || "—"}</div>
                      <div className="font-mono text-[10px] text-muted">{v.id}</div>
                    </td>
                    <td
                      className="max-w-[14rem] truncate px-2 py-1 text-muted"
                      title={v.items_resumen}
                    >
                      {v.items_resumen || "—"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-semibold text-ink">
                      {fmtCOP(v.total)}
                    </td>
                    <td className="px-2 py-1">
                      {v.evidencias_count > 0 ? (
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          {v.evidencias_count} ✓
                        </span>
                      ) : (
                        <span className="font-bold text-orange-600 dark:text-orange-400">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="flex min-h-0 flex-col gap-2 overflow-auto rounded-paper border border-border bg-surface-panel p-2.5">
          {sel ? detalleEvidencia : null}
        </aside>
      </div>
    </div>
  );
}
