import { resolvePanelApiUrl } from "../api/client";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";

const blobCache = new Map<string, string>();

export function panelBearerToken(): string | null {
  const tickets = useTicketsAuth.getState();
  return tickets.apiToken || tickets.token || useAuthStore.getState().token || null;
}

export function esSrcImagenApi(src: string): boolean {
  const s = (src || "").trim();
  return (
    s.startsWith("/api/etiquetas/recursos-png/") ||
    s.startsWith("/api/plantillas-visuales/assets/") ||
    s.startsWith("/app/api/plantillas-visuales/assets/")
  );
}

/** Resuelve URL de imagen del lienzo (blob/data para rutas API con auth). */
export async function resolverUrlImagenCanvas(src: string): Promise<string> {
  const raw = (src || "").trim();
  if (!raw) return raw;
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return raw;

  if (!esSrcImagenApi(raw)) {
    return resolvePanelApiUrl(raw);
  }

  const cached = blobCache.get(raw);
  if (cached) return cached;

  const token = panelBearerToken();
  const url = resolvePanelApiUrl(raw);
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Imagen no disponible (${res.status})`);

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  blobCache.set(raw, objectUrl);
  return objectUrl;
}

export function obtenerDimensionesImagen(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
    img.src = url;
  });
}

/** Escala la imagen al lienzo sin marco vacío (respeta proporción). */
export async function dimensionesImagenParaLienzo(
  src: string,
  maxLado = 240,
): Promise<{ width: number; height: number }> {
  const url = await resolverUrlImagenCanvas(src);
  const { width: w, height: h } = await obtenerDimensionesImagen(url);
  if (w <= 0 || h <= 0) return { width: 160, height: 160 };
  const scale = Math.min(maxLado / w, maxLado / h, 1);
  return {
    width: Math.max(24, Math.round(w * scale)),
    height: Math.max(24, Math.round(h * scale)),
  };
}

export function liberarCacheImagenCanvas(src?: string): void {
  if (src) {
    const u = blobCache.get(src);
    if (u) URL.revokeObjectURL(u);
    blobCache.delete(src);
    return;
  }
  for (const u of blobCache.values()) URL.revokeObjectURL(u);
  blobCache.clear();
}
