import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDesenfoqueAplicar,
  useDesenfoquePreview,
  type RegionDesenfoque,
} from "../hooks/usePublicaciones";

type Props = {
  open: boolean;
  onClose: () => void;
  sku: string;
  meliItemId: string;
  pictureId: string;
  imageUrl: string;
  onDone?: () => void;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function regionPie(pct: number): RegionDesenfoque {
  const h = Math.max(0.05, Math.min(0.5, pct));
  return { x: 0, y: 1 - h, w: 1, h };
}

export default function DesenfoqueFotoModal({
  open,
  onClose,
  sku,
  meliItemId,
  pictureId,
  imageUrl,
  onDone,
}: Props) {
  const previewMut = useDesenfoquePreview();
  const aplicarMut = useDesenfoqueAplicar();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x0: number; y0: number } | null>(null);

  const [regiones, setRegiones] = useState<RegionDesenfoque[]>([]);
  const [piePct, setPiePct] = useState(0.15);
  const [radio, setRadio] = useState(28);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [imgReady, setImgReady] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;
    const maxW = 480;
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const r of regiones) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.35)";
      ctx.strokeStyle = "rgba(37, 99, 235, 0.95)";
      ctx.lineWidth = 2;
      const rx = r.x * w;
      const ry = r.y * h;
      const rw = r.w * w;
      const rh = r.h * h;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }, [regiones]);

  useEffect(() => {
    if (!open) return;
    setRegiones([regionPie(0.15)]);
    setPiePct(0.15);
    setRadio(28);
    setPreviewUrl(null);
    setMsg("");
    setImgReady(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
    img.onerror = () => {
      setMsg("No se pudo cargar la foto (CORS o URL). El preview API igual funciona.");
      imgRef.current = null;
      setImgReady(false);
    };
    img.src = imageUrl;
  }, [open, imageUrl]);

  useEffect(() => {
    if (open && imgReady) redraw();
  }, [open, imgReady, redraw]);

  function canvasCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    return { x, y };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const p = canvasCoords(e);
    if (!p) return;
    dragRef.current = { x0: p.x, y0: p.y };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const p = canvasCoords(e);
    if (!p) return;
    const { x0, y0 } = dragRef.current;
    const x = Math.min(x0, p.x);
    const y = Math.min(y0, p.y);
    const w = Math.abs(p.x - x0);
    const h = Math.abs(p.y - y0);
    redraw();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.strokeStyle = "rgba(234, 179, 8, 0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x * canvas.width, y * canvas.height, w * canvas.width, h * canvas.height);
    ctx.setLineDash([]);
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const p = canvasCoords(e);
    const { x0, y0 } = dragRef.current;
    dragRef.current = null;
    if (!p) return;
    const x = Math.min(x0, p.x);
    const y = Math.min(y0, p.y);
    const w = Math.abs(p.x - x0);
    const h = Math.abs(p.y - y0);
    if (w < 0.02 || h < 0.02) {
      redraw();
      return;
    }
    setRegiones((prev) => [...prev, { x, y, w, h }]);
    setPreviewUrl(null);
  }

  async function handlePreview() {
    setMsg("");
    if (regiones.length === 0) {
      setMsg("Agrega el pie o dibuja al menos un rectángulo.");
      return;
    }
    try {
      const res = await previewMut.mutateAsync({
        meli_item_id: meliItemId,
        picture_id: pictureId,
        url: imageUrl,
        modo: "regiones",
        regiones,
        radio,
      });
      if (!res.ok || !res.preview_base64) {
        setMsg(res.error || "No se pudo generar preview");
        return;
      }
      setPreviewUrl(res.preview_base64);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error de preview");
    }
  }

  async function handleAplicar() {
    setMsg("");
    if (regiones.length === 0) {
      setMsg("Agrega el pie o dibuja al menos un rectángulo.");
      return;
    }
    if (!confirm("¿Aplicar desenfoque y reemplazar esta foto en MeLi?")) return;
    try {
      const res = await aplicarMut.mutateAsync({
        sku,
        meli_item_id: meliItemId,
        picture_id: pictureId,
        modo: "regiones",
        regiones,
        radio,
      });
      if (!res.ok) {
        setMsg(res.error || "No se pudo aplicar");
        return;
      }
      if (res.adjuntada === false) {
        setMsg(res.nota || "Subida al CDN pero el listing no permite renovar fotos.");
      } else {
        setMsg("✓ Foto desenfocada y actualizada en MeLi");
      }
      onDone?.();
      setTimeout(() => onClose(), 900);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al aplicar");
    }
  }

  if (!open) return null;

  const busy = previewMut.isPending || aplicarMut.isPending;

  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center bg-ink/60 p-3">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface-panel p-3 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-ink">Desenfocar datos empresa</h3>
            <p className="text-[11px] text-muted">
              {sku} · pie McKenna / NIT o rectángulos libres · radio {radio}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-ink"
          >
            Cerrar
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRegiones([regionPie(piePct)]);
              setPreviewUrl(null);
            }}
            className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Pie McKenna
          </button>
          <label className="flex items-center gap-1 text-[11px] text-muted">
            Altura pie
            <input
              type="range"
              min={8}
              max={35}
              value={Math.round(piePct * 100)}
              onChange={(e) => {
                const p = Number(e.target.value) / 100;
                setPiePct(p);
                setRegiones([regionPie(p)]);
                setPreviewUrl(null);
              }}
            />
            <span className="font-mono text-ink">{Math.round(piePct * 100)}%</span>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted">
            Radio
            <input
              type="range"
              min={8}
              max={60}
              value={radio}
              onChange={(e) => {
                setRadio(Number(e.target.value));
                setPreviewUrl(null);
              }}
            />
            <span className="font-mono text-ink">{radio}</span>
          </label>
          <button
            type="button"
            disabled={busy || regiones.length === 0}
            onClick={() => {
              setRegiones([]);
              setPreviewUrl(null);
            }}
            className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink"
          >
            Limpiar zonas
          </button>
        </div>

        <p className="text-[11px] text-muted">
          Arrastra en la imagen para marcar otra zona (marca “McKenna Group” fuera del pie).
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="overflow-auto rounded-lg border border-border bg-surface p-1">
            {imgReady ? (
              <canvas
                ref={canvasRef}
                className="mx-auto max-w-full cursor-crosshair"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                  dragRef.current = null;
                  redraw();
                }}
              />
            ) : (
              <div className="flex h-48 items-center justify-center text-xs text-muted">
                Cargando foto…
              </div>
            )}
          </div>
          <div className="overflow-auto rounded-lg border border-border bg-surface p-1">
            {previewUrl ? (
              <img src={previewUrl} alt="Preview desenfoque" className="mx-auto max-h-80 object-contain" />
            ) : (
              <div className="flex h-48 items-center justify-center text-xs text-muted">
                Preview del desenfoque
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || regiones.length === 0}
            onClick={() => void handlePreview()}
            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900 disabled:opacity-40"
          >
            {previewMut.isPending ? "Generando…" : "Ver preview"}
          </button>
          <button
            type="button"
            disabled={busy || regiones.length === 0}
            onClick={() => void handleAplicar()}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {aplicarMut.isPending ? "Aplicando en MeLi…" : "Aplicar a MeLi"}
          </button>
        </div>

        {msg && (
          <p
            className={`text-xs ${
              msg.startsWith("✓") ? "text-green-700" : "text-danger"
            }`}
          >
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

/** Diálogo rápido para lote: pie en varias publicaciones. */
export function DesenfoqueLoteDialog({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: Array<{ sku: string; meli_item_id: string }>;
}) {
  const aplicarMut = useDesenfoqueAplicar();
  const [piePct, setPiePct] = useState(0.15);
  const [radio, setRadio] = useState(28);
  const [alcance, setAlcance] = useState<"principal" | "todas">("principal");
  const [resultado, setResultado] = useState("");

  useEffect(() => {
    if (open) {
      setResultado("");
      setPiePct(0.15);
      setRadio(28);
      setAlcance("principal");
    }
  }, [open]);

  async function handleRun() {
    if (items.length === 0) return;
    if (
      !confirm(
        `¿Desenfocar pie (${Math.round(piePct * 100)}%) en ${items.length} publicación(es)? ` +
          `Fotos: ${alcance === "principal" ? "solo principal" : "todas"}.`,
      )
    ) {
      return;
    }
    setResultado("Procesando…");
    try {
      const res = await aplicarMut.mutateAsync({
        items: items.map((it) => ({
          sku: it.sku,
          meli_item_id: it.meli_item_id,
          picture_ids: alcance,
        })),
        modo: "pie",
        pie_pct: piePct,
        radio,
      });
      const ok = res.ok_count ?? 0;
      const err = res.error_count ?? 0;
      const lineas = (res.resultados || [])
        .filter((r) => !r.ok)
        .slice(0, 8)
        .map((r) => `${r.sku || "?"}: ${r.error || "error"}`);
      setResultado(
        `Listo: ${ok} ok · ${err} error` +
          (lineas.length ? `\n${lineas.join("\n")}` : ""),
      );
    } catch (e) {
      setResultado(e instanceof Error ? e.message : "Error en lote");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center bg-ink/60 p-3">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-surface-panel p-4 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-ink">Desenfocar pie (lote)</h3>
            <p className="text-[11px] text-muted">
              {items.length} publicación(es) con MeLi · franja inferior
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs text-muted"
          >
            Cerrar
          </button>
        </div>

        <label className="flex items-center justify-between gap-2 text-xs text-ink">
          Altura del pie
          <span className="font-mono">{Math.round(piePct * 100)}%</span>
        </label>
        <input
          type="range"
          min={8}
          max={35}
          value={Math.round(piePct * 100)}
          onChange={(e) => setPiePct(Number(e.target.value) / 100)}
          className="w-full"
        />

        <label className="flex items-center justify-between gap-2 text-xs text-ink">
          Radio blur
          <span className="font-mono">{radio}</span>
        </label>
        <input
          type="range"
          min={8}
          max={60}
          value={radio}
          onChange={(e) => setRadio(Number(e.target.value))}
          className="w-full"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAlcance("principal")}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${
              alcance === "principal"
                ? "border-blue-500 bg-blue-50 text-blue-900"
                : "border-border text-muted"
            }`}
          >
            Solo principal
          </button>
          <button
            type="button"
            onClick={() => setAlcance("todas")}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${
              alcance === "todas"
                ? "border-blue-500 bg-blue-50 text-blue-900"
                : "border-border text-muted"
            }`}
          >
            Todas las fotos
          </button>
        </div>

        <button
          type="button"
          disabled={aplicarMut.isPending || items.length === 0}
          onClick={() => void handleRun()}
          className="w-full rounded-lg bg-accent py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          {aplicarMut.isPending ? "Aplicando…" : `Desenfocar ${items.length}`}
        </button>

        {resultado && (
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-2 text-[11px] text-ink">
            {resultado}
          </pre>
        )}
      </div>
    </div>
  );
}
