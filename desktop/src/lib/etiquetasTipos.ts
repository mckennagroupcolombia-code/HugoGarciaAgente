import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface TipoEtiqueta {
  nombre: string;
  ancho_mm: number;
  alto_mm: number;
}

export const TIPOS_ETIQUETA_DEFAULT: TipoEtiqueta[] = [
  { nombre: "30 mL", ancho_mm: 102, alto_mm: 38 },
  { nombre: "5 mL", ancho_mm: 66, alto_mm: 22 },
  { nombre: "100 g", ancho_mm: 69, alto_mm: 51 },
  { nombre: "125 g", ancho_mm: 70, alto_mm: 70 },
  { nombre: "250 g", ancho_mm: 76, alto_mm: 66 },
  { nombre: "500 g", ancho_mm: 76, alto_mm: 66 },
  { nombre: "1000 g", ancho_mm: 102, alto_mm: 76 },
  { nombre: "1 kg", ancho_mm: 102, alto_mm: 76 },
  { nombre: "1 Lt", ancho_mm: 108, alto_mm: 76 },
  { nombre: "Lactato", ancho_mm: 38, alto_mm: 140 },
  { nombre: "Circular", ancho_mm: 55, alto_mm: 55 },
  { nombre: "Circular 50", ancho_mm: 50, alto_mm: 50 },
  { nombre: "Circle 50", ancho_mm: 50, alto_mm: 50 },
  { nombre: "CIRCLE", ancho_mm: 53.9, alto_mm: 53.9 },
  { nombre: "Circular 70", ancho_mm: 70, alto_mm: 70 },
  { nombre: "5 g", ancho_mm: 50, alto_mm: 42 },
  { nombre: "54mm", ancho_mm: 54, alto_mm: 58 },
];

export function mergeTiposEtiqueta(apiTipos?: TipoEtiqueta[]): TipoEtiqueta[] {
  const map = new Map<string, TipoEtiqueta>();
  for (const t of TIPOS_ETIQUETA_DEFAULT) {
    map.set(t.nombre, { ...t });
  }
  for (const t of apiTipos ?? []) {
    const nombre = (t.nombre || "").trim();
    if (!nombre) continue;
    map.set(nombre, {
      nombre,
      ancho_mm: Number(t.ancho_mm) || map.get(nombre)?.ancho_mm || 0,
      alto_mm: Number(t.alto_mm) || map.get(nombre)?.alto_mm || 0,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function tiposEtiquetaMap(tipos: TipoEtiqueta[]): Record<string, [number, number]> {
  const m: Record<string, [number, number]> = {};
  for (const t of tipos) {
    if (t.nombre.trim()) m[t.nombre] = [t.ancho_mm, t.alto_mm];
  }
  return m;
}

export function mmParaTipoEtiqueta(nombre: string, tipos: TipoEtiqueta[]): [number, number] {
  const found = tipos.find((t) => t.nombre === nombre);
  if (found) return [found.ancho_mm, found.alto_mm];
  const fb = TIPOS_ETIQUETA_DEFAULT.find((t) => t.nombre === nombre);
  return fb ? [fb.ancho_mm, fb.alto_mm] : [76, 66];
}

/** mm → pulgadas para UI (2 decimales, legible). */
export function mmAPulgadasDisplay(mm: number): number {
  if (!Number.isFinite(mm) || mm <= 0) return 0;
  return Math.round((mm / 25.4) * 100) / 100;
}

/** pulgadas → mm (1 decimal, compatible con catálogo / impresora). */
export function pulgadasAMm(pulg: number): number {
  if (!Number.isFinite(pulg) || pulg <= 0) return 0;
  return Math.round(pulg * 25.4 * 10) / 10;
}

/** Texto principal de medidas: `4.02×1.50 in`. */
export function formatoMedidasEtiqueta(anchoMm: number, altoMm: number): string {
  if (!(anchoMm > 0 && altoMm > 0)) return "";
  return `${mmAPulgadasDisplay(anchoMm)}×${mmAPulgadasDisplay(altoMm)} in`;
}

/** Tooltip con pulgadas + mm de referencia. */
export function formatoMedidasEtiquetaTitle(anchoMm: number, altoMm: number): string {
  if (!(anchoMm > 0 && altoMm > 0)) return "";
  return `${formatoMedidasEtiqueta(anchoMm, altoMm)} · ${anchoMm}×${altoMm} mm`;
}

export function useTiposEtiqueta() {
  return useQuery({
    queryKey: ["etiquetas-tipos"],
    queryFn: async () => {
      const data = await api.get<{ tipos: TipoEtiqueta[] }>("/api/etiquetas/tipos");
      return { tipos: mergeTiposEtiqueta(data.tipos) };
    },
    staleTime: 60_000,
  });
}

export function useGuardarTiposEtiqueta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tipos: TipoEtiqueta[]) =>
      api.put<{ ok: boolean; tipos: TipoEtiqueta[] }>("/api/etiquetas/tipos", { tipos }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["etiquetas-tipos"] }),
  });
}
