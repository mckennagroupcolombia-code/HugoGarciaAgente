/** Captura la pestaña del listado MeLi. Hay que llamarla desde un clic directo. */

export async function capturarPestanaComoJpeg(esperaMs = 400): Promise<Blob> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Este navegador no permite capturar pestaña. Pegá el pantallazo (Ctrl+V).");
  }
  // getDisplayMedia exige gesto de usuario en el mismo turno. No abrir pestañas
  // ni await-ear nada antes: window.open consume la activación transitoria.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 5, displaySurface: "browser" },
    audio: false,
  } as DisplayMediaStreamOptions);
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

export function puedeCapturarPestana(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

export function esCancelacionCaptura(err: unknown): boolean {
  const texto = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/transient activation|user gesture/i.test(texto)) return false;
  return (
    (err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "AbortError")) ||
    /notallowed|abort|permission/i.test(texto)
  );
}

export function mensajeErrorCaptura(err: unknown): string {
  const raw = err instanceof Error ? err.message : "No pude capturar la pestaña.";
  if (/transient activation|user gesture/i.test(raw)) {
    return "El navegador pide un clic directo. Tocá otra vez «Capturar pestaña».";
  }
  return raw;
}
