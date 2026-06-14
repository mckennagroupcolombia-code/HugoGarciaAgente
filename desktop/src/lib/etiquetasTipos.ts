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
  { nombre: "125 g", ancho_mm: 70, alto_mm: 70 },
  { nombre: "250 g", ancho_mm: 76, alto_mm: 66 },
  { nombre: "1 Lt", ancho_mm: 108, alto_mm: 76 },
  { nombre: "100 g", ancho_mm: 69, alto_mm: 51 },
  { nombre: "Lactato", ancho_mm: 38, alto_mm: 140 },
  { nombre: "Circular", ancho_mm: 55, alto_mm: 55 },
  { nombre: "Circular 70", ancho_mm: 70, alto_mm: 70 },
  { nombre: "5 g", ancho_mm: 50, alto_mm: 42 },
  { nombre: "54mm", ancho_mm: 54, alto_mm: 58 },
];

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

export function useTiposEtiqueta() {
  return useQuery({
    queryKey: ["etiquetas-tipos"],
    queryFn: () => api.get<{ tipos: TipoEtiqueta[] }>("/api/etiquetas/tipos"),
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
