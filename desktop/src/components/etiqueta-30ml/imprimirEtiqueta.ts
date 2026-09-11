/**
 * Imprime SOLO la etiqueta: el PNG ya rasterizado va a un iframe oculto con
 * `@page` del tamaño real del formato (sin márgenes), así el diálogo de
 * impresión no trae el formulario, la barra lateral ni nada de la app.
 */
export async function imprimirImagenEtiqueta(blob: Blob, anchoMm: number, altoMm: number): Promise<void> {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  let limpio = false;
  const limpiar = () => {
    if (limpio) return;
    limpio = true;
    iframe.remove();
    URL.revokeObjectURL(url);
  };

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    limpiar();
    throw new Error("El navegador no permitió preparar la impresión");
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta</title><style>` +
      `@page{size:${anchoMm}mm ${altoMm}mm;margin:0}` +
      `html,body{margin:0;padding:0;background:#fff}` +
      `img{display:block;width:${anchoMm}mm;height:${altoMm}mm}` +
      `</style></head><body><img id="etiqueta" alt=""></body></html>`,
  );
  doc.close();

  const img = doc.getElementById("etiqueta") as HTMLImageElement;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("No se pudo cargar la imagen de la etiqueta"));
    img.src = url;
  }).catch((e) => {
    limpiar();
    throw e;
  });

  win.addEventListener("afterprint", () => setTimeout(limpiar, 200));
  // Respaldo: hay navegadores que no disparan afterprint en un iframe.
  setTimeout(limpiar, 5 * 60_000);
  win.focus();
  win.print();
}
