/** Captura la pestaña del listado MeLi que el operador acaba de abrir. */

export async function capturarPestanaComoJpeg(esperaMs = 2800): Promise<Blob> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Este navegador no permite capturar pestaña. Pegá el pantallazo (Ctrl+V).");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 5 },
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    if (esperaMs > 0) {
      await new Promise((r) => window.setTimeout(r, esperaMs));
    }
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const scale = Math.min(1, 1400 / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No pude dibujar la captura.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("No se pudo armar el JPEG."))),
        "image/jpeg",
        0.72,
      );
    });
    return blob;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function esCancelacionCaptura(err: unknown): boolean {
  return (
    (err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "AbortError")) ||
    (err instanceof Error && /notallowed|abort|permission/i.test(err.name + err.message))
  );
}
