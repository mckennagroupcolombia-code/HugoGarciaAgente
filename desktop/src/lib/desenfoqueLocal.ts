import type { RegionDesenfoque } from "./plantillasVisualesExport";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Desenfoca zonas (fracción 0–1 del ancho/alto) de un PNG/JPG en el propio
 * navegador, con el filtro `blur()` del canvas. No pasa por el servidor: la
 * ficha de etiqueta lo usa para la versión de publicaciones digitales, así
 * no depende del permiso de Studio Visual del endpoint de desenfoque.
 */
export async function desenfocarBlobLocal(
  blob: Blob,
  regiones: RegionDesenfoque[],
  opts: { radio: number; formato: "png" | "jpeg" },
): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la imagen a desenfocar"));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("La imagen a desenfocar está vacía");
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo preparar el lienzo de desenfoque");
    if (typeof ctx.filter !== "string") {
      throw new Error("Este navegador no soporta el desenfoque en el lienzo");
    }
    ctx.drawImage(img, 0, 0);
    const radio = clamp(Math.round(opts.radio), 1, 200);
    for (const r of regiones) {
      const rx = clamp(Math.round(r.x * w), 0, w);
      const ry = clamp(Math.round(r.y * h), 0, h);
      const rw = clamp(Math.round(r.w * w), 0, w - rx);
      const rh = clamp(Math.round(r.h * h), 0, h - ry);
      if (rw <= 0 || rh <= 0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.filter = `blur(${radio}px)`;
      // Dos pasadas: en los bordes de la imagen el blur queda semitransparente
      // y dejaría ver el texto nítido de abajo.
      ctx.drawImage(img, 0, 0);
      ctx.drawImage(img, 0, 0);
      ctx.filter = "none";
      ctx.restore();
    }
    const mime = opts.formato === "jpeg" ? "image/jpeg" : "image/png";
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen desenfocada"))),
        mime,
        0.92,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
