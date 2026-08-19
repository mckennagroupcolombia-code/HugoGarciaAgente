import { useEffect, useState } from "react";
import { miniaturaLienzoPx, esLienzoCircular, type PlantillaVisualDoc } from "../../lib/plantillasVisuales";
import { renderPlantillaToCanvas } from "../../lib/plantillasVisualesExport";

const cache = new Map<string, string>();

function cacheKey(doc: PlantillaVisualDoc): string {
  return `${doc.id}:${doc.updated_at ?? ""}:${doc.elementos.length}:${doc.fondo}`;
}

function escalaRenderMiniatura(
  anchoPx: number,
  altoPx: number,
  maxAncho: number,
  maxAlto: number,
): number {
  const s = Math.min(
    (maxAncho * 2) / Math.max(anchoPx, 1),
    (maxAlto * 2) / Math.max(altoPx, 1),
  );
  return Math.max(0.05, Math.min(s, 1));
}

interface Props {
  doc: PlantillaVisualDoc;
  maxAncho?: number;
  maxAlto?: number;
  className?: string;
}

export default function PlantillaVisualMiniatura({
  doc,
  maxAncho = 140,
  maxAlto = 100,
  className = "",
}: Props) {
  const thumb = miniaturaLienzoPx(doc.formato.ancho_px, doc.formato.alto_px, maxAncho, maxAlto);
  const [src, setSrc] = useState<string | null>(() => cache.get(cacheKey(doc)) ?? null);
  const [loading, setLoading] = useState(!src);

  useEffect(() => {
    const key = cacheKey(doc);
    const cached = cache.get(key);
    if (cached) {
      setSrc(cached);
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    const escala = escalaRenderMiniatura(
      doc.formato.ancho_px,
      doc.formato.alto_px,
      maxAncho,
      maxAlto,
    );

    void renderPlantillaToCanvas(doc, { escala, forzarFondoOpaco: true })
      .then((canvas) => {
        if (!alive) return;
        const url = canvas.toDataURL("image/jpeg", 0.88);
        cache.set(key, url);
        setSrc(url);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [doc, maxAncho, maxAlto]);

  const circular = esLienzoCircular(doc);
  return (
    <div
      className={`overflow-hidden shadow-lg ring-1 ring-black/20 transition group-hover:ring-accent/40 ${
        circular ? "rounded-full" : "rounded-sm"
      } ${className}`}
      style={{
        width: thumb.width,
        height: thumb.height,
        background: doc.fondo || "#fff",
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="block h-full w-full object-contain"
        />
      ) : loading ? (
        <div className="h-full w-full animate-pulse bg-white/10" aria-hidden />
      ) : null}
    </div>
  );
}
