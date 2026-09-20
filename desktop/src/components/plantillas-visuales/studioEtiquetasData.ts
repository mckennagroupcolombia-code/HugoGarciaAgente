/**
 * Etiquetas finales de Studio: los PNG de la subcarpeta ETIQUETAS STUDIO de la
 * biblioteca (`/api/etiquetas/recursos-png`). La raíz de esa biblioteca guarda
 * logos e imágenes sueltas, que ahora viven en la pestaña "Recursos".
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export const CARPETA_ETIQUETAS_STUDIO = "ETIQUETAS STUDIO";

/** Versiones desenfocadas de las etiquetas (casilla "Desenfoque" de la ficha).
 *  Carpeta hermana de ETIQUETAS STUDIO a propósito: Diseño → Imprimir solo
 *  lista aquella, así estas nunca se confunden con la de impresión. Se ven en
 *  Studio → «Etiquetas para publicaciones». */
export const CARPETA_PUBLICACIONES_DIGITALES = "PUBLICACIONES DIGITALES";

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

export const QK_ETIQUETAS_PUBLICACIONES = [
  "etiquetas-recursos-png",
  CARPETA_PUBLICACIONES_DIGITALES,
  "lista",
] as const;

export async function fetchEtiquetasPublicaciones(): Promise<EtiquetaStudioPng[]> {
  const res = await api.get<{ recursos: EtiquetaStudioPng[] }>(
    `/api/etiquetas/recursos-png?carpeta=${encodeURIComponent(CARPETA_PUBLICACIONES_DIGITALES)}&recursivo=1`,
  );
  return res.recursos ?? [];
}

/** Categoría de una etiqueta por su ruta: solo las que viven en una subcarpeta
 *  `ETIQUETAS STUDIO/<Categoría>/…`, que son las generadas desde una plantilla.
 *  Las 90 sueltas en la raíz son el catálogo viejo y devuelven null a propósito.
 *  `raiz` permite usar la misma regla con PUBLICACIONES DIGITALES/<Categoría>/. */
export function categoriaDeRutaEtiqueta(
  nombre: string,
  cats: { id: string; etiqueta: string }[],
  raiz: string = CARPETA_ETIQUETAS_STUDIO,
): string | null {
  const partes = (nombre || "").replace(/\\/g, "/").split("/");
  if (partes.length < 3) return null;
  if (partes[0].trim().toUpperCase() !== raiz.toUpperCase()) return null;
  const carpeta = partes[1].trim().toLowerCase();
  const cat = cats.find(
    (c) => c.etiqueta.trim().toLowerCase() === carpeta || c.id === carpeta,
  );
  return cat?.id ?? null;
}

export function useEtiquetasStudio() {
  return useQuery({
    queryKey: QK_ETIQUETAS_STUDIO,
    queryFn: fetchEtiquetasStudio,
    staleTime: 15_000,
    gcTime: 60 * 60 * 1000,
  });
}

export function useEtiquetasPublicaciones() {
  return useQuery({
    queryKey: QK_ETIQUETAS_PUBLICACIONES,
    queryFn: fetchEtiquetasPublicaciones,
    staleTime: 15_000,
    gcTime: 60 * 60 * 1000,
  });
}

/** Texto comparable para el buscador de Studio: sin tildes ni mayúsculas, para
 *  que «mani» encuentre «MANÍ 500g». */
export function normalizarBusqueda(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** ¿`texto` contiene todas las palabras de la búsqueda (ya normalizada)? */
export function coincideBusqueda(texto: string, q: string): boolean {
  if (!q) return true;
  const t = normalizarBusqueda(texto);
  return q.split(/\s+/).every((palabra) => t.includes(palabra));
}
