import { useCallback, useEffect, useRef, useState } from "react";
import {
  desenfocarBlobPlantilla,
  dataUrlABlob,
  type RegionDesenfoque,
} from "../../lib/plantillasVisualesExport";

type Props = {
  open: boolean;
  onClose: () => void;
  /** PNG/JPG original ya exportado del lienzo (sin desenfoque previo). */
  blobOriginal: Blob;
  /** Object URL de `blobOriginal`, ya creado por el llamador. */
  imageUrl: string;
  formato: "png" | "jpeg";
  /** Se llama con el Blob resultante cuando el usuario confirma "Usar esta versión". */
  onAplicado: (blob: Blob) => void;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function regionPie(pct: number): RegionDesenfoque {
  const h = Math.max(0.05, Math.min(0.5, pct));
  return { x: 0, y: 1 - h, w: 1, h };
}

/**
 * Marca rectángulos sobre la etiqueta ya exportada (teléfono, web, "McKenna
 * Group"…) y aplica GaussianBlur del lado del servidor antes de descargar/subir
 * a la biblioteca — así la imagen queda apta para MeLi, que rechaza fotos con
 * datos de contacto o de empresa impresos.
 */
export default function DesenfoquePlantillaModal({
  open,
  onClose,
  blobOriginal,
  imageUrl,
  formato,
  onAplicado,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x0: number; y0: number } | null>(null);

  const [regiones, setRegiones] = useState<RegionDesenfoque[]>([]);
  const [piePct, setPiePct] = useState(0.15);
  const [radio, setRadio] = useState(28);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [msg, setMsg] = useState("");
  const [imgReady, setImgReady] = useState(false);
  const [cargando, setCargando] = useState(false);

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
    setRegiones([]);
    setPiePct(0.15);
    setRadio(28);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setMsg("");
    setImgReady(false);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
    img.onerror = () => {
      setMsg("No se pudo cargar la imagen para marcar zonas.");
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
    setPreviewBlob(null);
  }

  async function handlePreview() {
    setMsg("");
    if (regiones.length === 0) {
      setMsg("Agrega el pie o dibuja al menos un rectángulo.");
      return;
    }
    setCargando(true);
    try {
      const res = await desenfocarBlobPlantilla(blobOriginal, regiones, { radio, formato });
      if (!res.ok || !res.preview_base64) {
        setMsg(res.error || "No se pudo generar el preview");
        return;
      }
      setPreviewUrl(res.preview_base64);
      setPreviewBlob(dataUrlABlob(res.preview_base64));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al desenfocar");
    } finally {
      setCargando(false);
    }
  }

  function usarEstaVersion() {
    if (!previewBlob) return;
    onAplicado(previewBlob);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[800] flex items-center justify-center bg-ink/60 p-3"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface-panel p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-ink">Desenfocar datos de contacto</h3>
            <p className="text-[11px] text-muted">
              Marca teléfono, web o datos de empresa antes de subir a MeLi · radio {radio}
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
            disabled={cargando}
            onClick={() => {
              setRegiones([regionPie(piePct)]);
              setPreviewUrl(null);
              setPreviewBlob(null);
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
                setPreviewBlob(null);
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
                setPreviewBlob(null);
              }}
            />
            <span className="font-mono text-ink">{radio}</span>
          </label>
          <button
            type="button"
            disabled={cargando || regiones.length === 0}
            onClick={() => {
              setRegiones([]);
              setPreviewUrl(null);
              setPreviewBlob(null);
            }}
            className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink"
          >
            Limpiar zonas
          </button>
        </div>

        <p className="text-[11px] text-muted">
          Arrastra sobre la imagen para marcar otra zona (ej. teléfono o página web fuera del pie).
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
                Cargando imagen…
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
            disabled={cargando || regiones.length === 0}
            onClick={() => void handlePreview()}
            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900 disabled:opacity-40"
          >
            {cargando ? "Generando…" : "Ver preview"}
          </button>
          <button
            type="button"
            disabled={cargando || !previewBlob}
            onClick={usarEstaVersion}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            Usar esta versión
          </button>
        </div>

        {msg && <p className="text-xs text-danger">{msg}</p>}
      </div>
    </div>
  );
}
