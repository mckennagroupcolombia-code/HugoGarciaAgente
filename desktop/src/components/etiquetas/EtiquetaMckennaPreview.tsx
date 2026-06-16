import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";

interface Props {
  datos: EtiquetaStudioDatos;
  className?: string;
  /** Marco con proporción del formato de papel (mm). */
  marcoFormato?: boolean;
}

/** Vista previa desde plantilla SVG real McKenna (render Inkscape en backend). */
export function EtiquetaMckennaPreview({ datos, className = "", marcoFormato = false }: Props) {
  const [debounced, setDebounced] = useState(datos);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(datos), 450);
    return () => window.clearTimeout(t);
  }, [datos]);

  const anchoPx = useMemo(() => {
    const w = debounced.ancho_mm || 76;
    const h = debounced.alto_mm || 66;
    const lado = Math.max(w, h);
    return Math.round(720 * (w / lado));
  }, [debounced.ancho_mm, debounced.alto_mm]);

  const payloadKey = useMemo(
    () => JSON.stringify({ ...debounced, ancho_px: anchoPx }),
    [debounced, anchoPx],
  );

  const { data, isFetching, error } = useQuery({
    queryKey: ["etiquetas-studio-preview", payloadKey],
    queryFn: () =>
      api.post<{ imagen?: string; mime?: string; error?: string; meta?: { fuente?: string; archivo?: string; codigo_barras?: string; bloque_legal?: boolean; lote_vencimiento?: string[] } }>(
        "/api/etiquetas/studio/preview",
        { ...debounced, ancho_px: anchoPx },
      ),
    enabled: !!debounced.nombre_producto.trim(),
    staleTime: 5_000,
  });

  const src = data?.imagen ? `data:${data.mime || "image/png"};base64,${data.imagen}` : null;
  const errMsg = error instanceof Error ? error.message : data?.error;

  return (
    <div className={className}>
      {!debounced.nombre_producto.trim() && (
        <p className="py-8 text-center text-xs text-muted">Ingresa nombre de producto para ver la etiqueta</p>
      )}
      {isFetching && debounced.nombre_producto.trim() && (
        <p className="py-2 text-center text-[10px] text-muted">Renderizando etiqueta…</p>
      )}
      {errMsg && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-900">
          {errMsg}
        </p>
      )}
      {src && (
        marcoFormato && debounced.ancho_mm && debounced.alto_mm ? (
          <div
            className="mx-auto w-full max-w-[400px] rounded-sm border border-border/80 bg-white p-1 shadow-md"
            style={{ aspectRatio: `${debounced.ancho_mm} / ${debounced.alto_mm}` }}
          >
            <img
              src={src}
              alt={`Etiqueta ${debounced.nombre_producto}`}
              className="h-full w-full object-contain"
            />
          </div>
        ) : (
          <img
            src={src}
            alt={`Etiqueta ${debounced.nombre_producto}`}
            className="mx-auto h-auto w-full max-w-[360px] drop-shadow-md"
          />
        )
      )}
      {marcoFormato && debounced.ancho_mm && debounced.alto_mm && (
        <p className="mt-2 text-center text-[10px] text-muted">
          {debounced.ancho_mm}×{debounced.alto_mm} mm · {debounced.tipo_etiqueta}
          {debounced.archivo_ai ? ` · ${debounced.archivo_ai}` : ""}
        </p>
      )}
    </div>
  );
}
