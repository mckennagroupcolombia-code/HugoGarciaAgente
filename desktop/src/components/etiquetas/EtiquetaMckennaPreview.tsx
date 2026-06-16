import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";

interface Props {
  datos: EtiquetaStudioDatos;
  className?: string;
}

/** Vista previa desde plantilla SVG real McKenna (render Inkscape en backend). */
export function EtiquetaMckennaPreview({ datos, className = "" }: Props) {
  const [debounced, setDebounced] = useState(datos);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(datos), 450);
    return () => window.clearTimeout(t);
  }, [datos]);

  const payloadKey = useMemo(() => JSON.stringify(debounced), [debounced]);

  const { data, isFetching, error } = useQuery({
    queryKey: ["etiquetas-studio-preview", payloadKey],
    queryFn: () =>
      api.post<{ imagen?: string; mime?: string; error?: string; meta?: { fuente?: string; archivo?: string; codigo_barras?: string; bloque_legal?: boolean; lote_vencimiento?: string[] } }>(
        "/api/etiquetas/studio/preview",
        debounced,
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
        <img
          src={src}
          alt={`Etiqueta ${debounced.nombre_producto}`}
          className="mx-auto h-auto w-full max-w-[360px] drop-shadow-md"
        />
      )}
    </div>
  );
}
