/**
 * Etiquetas finales de Studio: los PNG de la subcarpeta ETIQUETAS STUDIO de la
 * biblioteca (`/api/etiquetas/recursos-png`). La raíz de esa biblioteca guarda
 * logos e imágenes sueltas, que ahora viven en la pestaña "Recursos".
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export const CARPETA_ETIQUETAS_STUDIO = "ETIQUETAS STUDIO";

export interface EtiquetaStudioPng {
  id: string | null;
  nombre: string;
  subido_at?: string;
  bytes?: number;
  thumb_b64?: string | null;
  thumb_mime?: string | null;
  tipo_etiqueta?: string | null;
  ancho_mm?: number | null;
  alto_mm?: number | null;
  dpi?: number | null;
}

export function useEtiquetasStudio() {
  return useQuery({
    queryKey: ["etiquetas-recursos-png", CARPETA_ETIQUETAS_STUDIO],
    queryFn: async () => {
      const res = await api.get<{ recursos: EtiquetaStudioPng[] }>(
        `/api/etiquetas/recursos-png?carpeta=${encodeURIComponent(CARPETA_ETIQUETAS_STUDIO)}`,
      );
      return res.recursos ?? [];
    },
    staleTime: 15_000,
    gcTime: 60 * 60 * 1000,
  });
}
