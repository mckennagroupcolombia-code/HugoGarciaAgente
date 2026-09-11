/**
 * Logos de la carpeta DISENO CORPORATIVO del repo (servidos por
 * `/api/etiquetas/logos-corporativos`, ver app/tools/logos_corporativos.py)
 * — usados por el botón del logo de la Ficha de etiqueta.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, panelBearerToken, resolvePanelApiUrl, ticketsSessionHeaders } from "../api/client";

export interface LogoCorporativo {
  nombre: string;
  mime: string;
  bytes: number;
  modificado: string;
  /** Miniatura (data URL PNG de 160 px) o null si no se pudo generar. */
  thumb: string | null;
}

const QUERY_KEY_LOGOS = ["etiquetas", "logos-corporativos"] as const;

export function useLogosCorporativos(habilitado = true) {
  return useQuery({
    queryKey: QUERY_KEY_LOGOS,
    queryFn: () =>
      api.get<{ logos: LogoCorporativo[]; carpeta: string | null; total: number }>(
        "/api/etiquetas/logos-corporativos",
      ),
    staleTime: 60_000,
    enabled: habilitado,
  });
}

/** Sube una imagen del ordenador a la carpeta DISEÑO CORPORATIVO del
 *  servidor. Si el nombre ya existe, el servidor le agrega _2, _3… */
export function subirLogoCorporativo(file: File) {
  const fd = new FormData();
  fd.append("archivo", file);
  return api.upload<{ ok: boolean; logo: LogoCorporativo }>("/api/etiquetas/logos-corporativos", fd);
}

/** Quita logos de la galería: el servidor los mueve a `.papelera/` dentro
 *  de la carpeta, no los borra. */
export function eliminarLogosCorporativos(nombres: string[]) {
  return api.post<{ ok: boolean; eliminados: string[]; errores: Record<string, string> }>(
    "/api/etiquetas/logos-corporativos/eliminar",
    { nombres },
  );
}

/** Subida en masa (una por una, con progreso) — la usan el menú del logo y
 *  la galería en ventana. */
export function useSubirLogosCorporativos() {
  const qc = useQueryClient();
  const [progreso, setProgreso] = useState<{ total: number; done: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subir = async (files: File[]) => {
    const validos = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name) || /^image\/(png|jpeg|webp)$/.test(f.type));
    const ignorados = files.length - validos.length;
    setError(null);
    if (validos.length === 0) {
      setError("Solo se pueden agregar imágenes PNG, JPG o WEBP.");
      return;
    }
    setProgreso({ total: validos.length, done: 0 });
    const errores: string[] = [];
    for (let i = 0; i < validos.length; i++) {
      try {
        await subirLogoCorporativo(validos[i]);
      } catch (e) {
        errores.push(`${validos[i].name}: ${e instanceof Error ? e.message : "error de subida"}`);
      }
      setProgreso({ total: validos.length, done: i + 1 });
    }
    await qc.invalidateQueries({ queryKey: QUERY_KEY_LOGOS });
    setProgreso(null);
    const avisos: string[] = [];
    if (errores.length > 0) avisos.push(`No se pudieron agregar: ${errores.join("; ")}`);
    if (ignorados > 0) avisos.push(`${ignorados} archivo(s) ignorado(s): solo PNG, JPG o WEBP.`);
    if (avisos.length > 0) setError(avisos.join(" "));
  };

  return { subir, progreso, error, setError };
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
