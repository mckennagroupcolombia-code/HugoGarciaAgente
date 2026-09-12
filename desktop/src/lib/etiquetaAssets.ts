/**
 * Subir/descargar imágenes de etiquetas — extraído de `plantillasVisualesExport.tsx`
 * (que pertenecía al viejo Estudio Visual, ya removido) porque estas dos
 * funciones no dependen de nada de ese sistema: solo hablan con el endpoint
 * genérico `/api/etiquetas/recursos-png` y con el DOM del navegador.
 * Usadas por "Ficha de etiqueta" (guardar PNG para imprimir) y por el
 * catálogo de Diseño → Imprimir (descargar un recurso ya guardado).
 */

export type MetaFormatoPngEtiqueta = {
  carpeta?: string;
  tipo_etiqueta?: string;
  ancho_mm?: number;
  alto_mm?: number;
  dpi?: number;
  escala?: number;
};

/** Sube un blob de imagen (PNG o JPG) ya renderizado a la biblioteca de etiquetas. */
export async function subirImagenBlobAEtiquetas(
  blob: Blob,
  nombreSugerido: string,
  meta?: MetaFormatoPngEtiqueta,
): Promise<{
  nombre: string;
  tipo_etiqueta?: string;
  ancho_mm?: number;
  alto_mm?: number;
}> {
  const { api } = await import("../api/client");
  const fd = new FormData();
  fd.append("archivo", new File([blob], nombreSugerido, { type: blob.type || "image/png" }));
  if (meta?.carpeta) fd.append("carpeta", meta.carpeta);
  if (meta?.tipo_etiqueta) fd.append("tipo_etiqueta", meta.tipo_etiqueta);
  if (meta?.ancho_mm != null && meta.ancho_mm > 0) fd.append("ancho_mm", String(meta.ancho_mm));
  if (meta?.alto_mm != null && meta.alto_mm > 0) fd.append("alto_mm", String(meta.alto_mm));
  if (meta?.dpi != null && meta.dpi > 0) fd.append("dpi", String(meta.dpi));
  if (meta?.escala != null && meta.escala > 0) fd.append("escala", String(meta.escala));
  const res = await api.upload<{
    ok: boolean;
    nombre: string;
    tipo_etiqueta?: string;
    ancho_mm?: number;
    alto_mm?: number;
  }>("/api/etiquetas/recursos-png", fd);
  return {
    nombre: res.nombre,
    tipo_etiqueta: res.tipo_etiqueta,
    ancho_mm: res.ancho_mm,
    alto_mm: res.alto_mm,
  };
}

export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
