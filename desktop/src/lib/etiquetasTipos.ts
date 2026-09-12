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
  { nombre: "250 / 500 g", ancho_mm: 76, alto_mm: 66 },
  { nombre: "1 kg", ancho_mm: 102, alto_mm: 76 },
  { nombre: "1 Lt", ancho_mm: 108, alto_mm: 76 },
  { nombre: "Lactato", ancho_mm: 38, alto_mm: 140 },
  { nombre: "Circular", ancho_mm: 55, alto_mm: 55 },
  { nombre: "Circular 50", ancho_mm: 50, alto_mm: 50 },
  { nombre: "CIRCLE", ancho_mm: 53.9, alto_mm: 53.9 },
  { nombre: "Circular 70", ancho_mm: 70, alto_mm: 70 },
  { nombre: "5 g", ancho_mm: 50, alto_mm: 42 },
  { nombre: "Pastillero", ancho_mm: 54, alto_mm: 58 },
];

/**
 * Nombres viejos de formatos con las mismas medidas, fusionados en uno solo
 * (mismo mapa que `_ETIQUETAS_ALIAS` en routes.py). 125 g y Circular 70 miden
 * igual pero no se fusionan: Circular es troquel redondo.
 */
const ALIAS_TIPOS_ETIQUETA: Record<string, string> = {
  "250 g": "250 / 500 g",
  "500 g": "250 / 500 g",
  "54mm": "Pastillero",
  "1000 g": "1 kg",
  "Circle 50": "Circular 50",
};

/** Nombre vigente de un formato (resuelve los nombres viejos ya fusionados). */
export function nombreTipoEtiquetaCanonico(nombre?: string | null): string {
  const n = (nombre || "").trim();
  return ALIAS_TIPOS_ETIQUETA[n] ?? n;
}

/**
 * Normaliza la lista de formatos que devuelve el servidor.
 *
 * Los `TIPOS_ETIQUETA_DEFAULT` son solo respaldo para cuando el endpoint no
 * responde: el servidor ya completa los formatos de fábrica que falten. Antes
 * se mezclaban SIEMPRE aquí, y por eso borrar un formato de fábrica (Circular,
 * CIRCLE, 54mm…) no servía de nada: desaparecía del servidor pero el panel lo
 * volvía a insertar en la misma lista que acababa de recibir.
 */
export function mergeTiposEtiqueta(apiTipos?: TipoEtiqueta[]): TipoEtiqueta[] {
  const map = new Map<string, TipoEtiqueta>();
  for (const t of apiTipos ?? []) {
    const nombre = nombreTipoEtiquetaCanonico(t.nombre);
    if (!nombre) continue;
    map.set(nombre, {
      nombre,
      ancho_mm: Number(t.ancho_mm) || 0,
      alto_mm: Number(t.alto_mm) || 0,
    });
  }
  if (map.size === 0) {
    for (const t of TIPOS_ETIQUETA_DEFAULT) map.set(t.nombre, { ...t });
  }
  // Los formatos se reconocen por su tamaño, así que el menú va de menor a mayor.
  return Array.from(map.values()).sort(
    (a, b) => a.ancho_mm - b.ancho_mm || a.alto_mm - b.alto_mm || a.nombre.localeCompare(b.nombre, "es"),
  );
}

export function tiposEtiquetaMap(tipos: TipoEtiqueta[]): Record<string, [number, number]> {
  const m: Record<string, [number, number]> = {};
  for (const t of tipos) {
    if (t.nombre.trim()) m[t.nombre] = [t.ancho_mm, t.alto_mm];
  }
  return m;
}

export function mmParaTipoEtiqueta(nombre: string, tipos: TipoEtiqueta[]): [number, number] {
  nombre = nombreTipoEtiquetaCanonico(nombre);
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

/** mm para UI (máx. 1 decimal, sin ".0"). */
function mmDisplay(mm: number): number {
  return Math.round(mm * 10) / 10;
}

/** Texto principal de medidas: `4.02×1.50 in · 102×38 mm`. */
export function formatoMedidasEtiqueta(anchoMm: number, altoMm: number): string {
  if (!(anchoMm > 0 && altoMm > 0)) return "";
  return `${mmAPulgadasDisplay(anchoMm)}×${mmAPulgadasDisplay(altoMm)} in · ${mmDisplay(anchoMm)}×${mmDisplay(altoMm)} mm`;
}

/** Tooltip de medidas (pulgadas + mm). */
export function formatoMedidasEtiquetaTitle(anchoMm: number, altoMm: number): string {
  return formatoMedidasEtiqueta(anchoMm, altoMm);
}

/** Troquel redondo: se reconoce por el nombre interno (Circular…, CIRCLE). */
export function esTipoEtiquetaCircular(nombre?: string | null): boolean {
  return /circ(?:ular|le)/i.test(nombre || "");
}

/**
 * Cómo se muestra un formato: solo su tamaño (in · mm). El nombre interno
 * ("250 / 500 g", "30 mL"…) no se enseña: una misma presentación puede ir en
 * etiquetas distintas, así que el nombre engañaba. Lo único que se añade es
 * «redonda», porque 125 g y Circular 70 miden igual y solo cambia el troquel.
 */
export function etiquetaTamanoFormato(
  nombre: string | null | undefined,
  anchoMm: number,
  altoMm: number,
): string {
  const med = formatoMedidasEtiqueta(anchoMm, altoMm);
  if (!med) return "";
  return esTipoEtiquetaCircular(nombre) ? `${med} · redonda` : med;
}

/** Tamaño a mostrar para un formato guardado por su nombre interno. */
export function etiquetaTamanoTipoNombre(
  nombre: string | null | undefined,
  tipos: TipoEtiqueta[],
): string {
  const n = nombreTipoEtiquetaCanonico(nombre);
  if (!n) return "";
  const t = tipos.find((x) => x.nombre === n) ?? TIPOS_ETIQUETA_DEFAULT.find((x) => x.nombre === n);
  return t ? etiquetaTamanoFormato(t.nombre, t.ancho_mm, t.alto_mm) : "";
}

/** Nombre interno de un formato nuevo: su propio tamaño. */
export function nombreTipoPorMedidas(anchoMm: number, altoMm: number, redonda = false): string {
  const base = `${mmDisplay(anchoMm)}×${mmDisplay(altoMm)} mm`;
  return redonda ? `Circular ${base}` : base;
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
