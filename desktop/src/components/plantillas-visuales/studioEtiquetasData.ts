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

/** Clave con un tercer segmento a propósito: la biblioteca de "Recursos" usa
 *  `["etiquetas-recursos-png", carpetaActual]` y guarda la respuesta completa
 *  `{recursos, carpetas, …}`. Al navegar a la carpeta ETIQUETAS STUDIO las dos
 *  claves habrían sido idénticas con formas de dato distintas. Sigue empezando
 *  por "etiquetas-recursos-png" para que las invalidaciones por prefijo (subir o
 *  borrar un PNG) también refresquen esta lista. */
export const QK_ETIQUETAS_STUDIO = [
  "etiquetas-recursos-png",
  CARPETA_ETIQUETAS_STUDIO,
  "lista",
] as const;

export async function fetchEtiquetasStudio(): Promise<EtiquetaStudioPng[]> {
  const res = await api.get<{ recursos: EtiquetaStudioPng[] }>(
    `/api/etiquetas/recursos-png?carpeta=${encodeURIComponent(CARPETA_ETIQUETAS_STUDIO)}`,
  );
  return res.recursos ?? [];
}

export function useEtiquetasStudio() {
  return useQuery({
    queryKey: QK_ETIQUETAS_STUDIO,
    queryFn: fetchEtiquetasStudio,
    staleTime: 15_000,
    gcTime: 60 * 60 * 1000,
  });
}
