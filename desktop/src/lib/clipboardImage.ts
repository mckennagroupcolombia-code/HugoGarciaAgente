/** Extrae el primer archivo de imagen del portapapeles (Ctrl+V / captura). */
export function imagenDesdePortapapeles(cd: DataTransfer | null | undefined): File | null {
  if (!cd) return null;
  for (const item of Array.from(cd.items)) {
    if (!item.type.startsWith("image/")) continue;
    const f = item.getAsFile();
    if (f) return normalizarNombreImagen(f);
  }
  for (const f of Array.from(cd.files)) {
    if (f.type.startsWith("image/")) return normalizarNombreImagen(f);
  }
  return null;
}

/** Variante React: consume el evento si hay imagen. */
export function clipboardPastedImageFile(e: {
  clipboardData: DataTransfer | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}): File | null {
  const file = imagenDesdePortapapeles(e.clipboardData);
  if (!file) return null;
  e.preventDefault();
  e.stopPropagation();
  return file;
}

function normalizarNombreImagen(f: File): File {
  if (f.name && f.name !== "image.png" && f.name !== "blob") return f;
  const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
  return new File([f], `firma-pegada.${ext}`, { type: f.type || "image/png" });
}
