/**
 * Logos de la carpeta DISENO CORPORATIVO del repo (servidos por
 * `/api/etiquetas/logos-corporativos`, ver app/tools/logos_corporativos.py)
 * — usados por el botón del logo de la Ficha de etiqueta.
 */
import { useQuery } from "@tanstack/react-query";
import { api, panelBearerToken, resolvePanelApiUrl, ticketsSessionHeaders } from "../api/client";

export interface LogoCorporativo {
  nombre: string;
  mime: string;
  bytes: number;
  modificado: string;
  /** Miniatura (data URL PNG de 160 px) o null si no se pudo generar. */
  thumb: string | null;
}

export function useLogosCorporativos(habilitado = true) {
  return useQuery({
    queryKey: ["etiquetas", "logos-corporativos"],
    queryFn: () =>
      api.get<{ logos: LogoCorporativo[]; carpeta: string | null; total: number }>(
        "/api/etiquetas/logos-corporativos",
      ),
    staleTime: 60_000,
    enabled: habilitado,
  });
}

/** Descarga el logo completo (con el Bearer del panel — un <img src> plano
 *  no lo lleva) y lo devuelve como data URL: así queda embebido en la ficha
 *  guardada y html-to-image lo pinta sin pedirlo otra vez. */
export async function cargarLogoCorporativoComoDataUrl(nombre: string): Promise<string> {
  const path = `/api/etiquetas/logos-corporativos/archivo/${encodeURIComponent(nombre)}`;
  const token = panelBearerToken(path);
  const res = await fetch(resolvePanelApiUrl(path, "GET"), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...ticketsSessionHeaders(),
    },
  });
  if (!res.ok) throw new Error(`No se pudo cargar el logo "${nombre}" (HTTP ${res.status})`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el logo descargado"));
    reader.readAsDataURL(blob);
  });
}
