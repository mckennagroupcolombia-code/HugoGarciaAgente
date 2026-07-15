import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface CodigoEan {
  id: string;
  sku: string;
  nombre_producto: string;
  numero_producto: number;
  presentacion: string;
  anio: number;
  bimestre: number;
  codigo: string;
  creado_at: string;
}

export interface NuevoCodigoEan {
  sku: string;
  nombre_producto?: string;
  numero_producto: number;
  presentacion?: string;
  anio?: number;
  mes: number;
}

export const BIMESTRE_LABEL: Record<number, string> = {
  0: "Ene-Feb",
  1: "Mar-Abr",
  2: "May-Jun",
  3: "Jul-Ago",
  4: "Sep-Oct",
  5: "Nov-Dic",
};

export function mesABimestre(mes: number): number {
  return Math.max(0, Math.min(5, Math.floor((mes - 1) / 2)));
}

/**
 * Menor número de producto libre en 1..900 (rellena huecos de EAN borrados).
 * Antes se usaba max+1 y los consecutivos liberados quedaban inaccesibles.
 */
export function siguienteNumeroProductoDisponible(
  codigos: Array<{ numero_producto?: number } | null | undefined>,
  minimo = 1,
  maximo = 900,
): number | null {
  const usados = new Set<number>();
  for (const c of codigos) {
    const n = Number(c?.numero_producto);
    if (Number.isFinite(n) && n >= minimo && n <= maximo) usados.add(n);
  }
  for (let n = minimo; n <= maximo; n++) {
    if (!usados.has(n)) return n;
  }
  return null;
}

/** Arma los 12 dígitos de datos (sin el verificador) para previsualizar el código. */
export function construirCodigo12(
  numeroProducto: number,
  presentacion: string,
  anio: number,
  bimestre: number,
): string {
  const prod = String(Math.max(1, Math.min(900, Math.round(numeroProducto) || 0))).padStart(3, "0");
  const pres = (presentacion || "000").replace(/\D/g, "").padStart(3, "0").slice(0, 3);
  const yy = String(((Math.round(anio) % 100) + 100) % 100).padStart(2, "0");
  const b = Math.max(0, Math.min(5, Math.round(bimestre) || 0));
  return `770${prod}${pres}${yy}${b}`;
}

/** Tamaños habituales; en SKUs compuestos (SHA70550mL) se toma el del final. */
const PRESENTACIONES_CONOCIDAS = [
  1000, 500, 400, 250, 150, 125, 120, 100, 60, 50, 40, 30, 20, 15, 10, 5,
] as const;

function codigoPresentacionDesdeNumero(n: number): string {
  if (n <= 0) return "000";
  if (n === 1000) return "001";
  if (n > 999) return String(n).slice(-3);
  return String(n).padStart(3, "0");
}

function numeroPresentacionDesdeCola(digitos: string): number | null {
  const raw = (digitos || "").replace(/\D/g, "");
  if (!raw) return null;
  if (raw.length <= 3) return Number(raw);
  for (const cand of PRESENTACIONES_CONOCIDAS) {
    const suf = String(cand);
    if (raw.endsWith(suf) && raw.length > suf.length) return cand;
  }
  return Number(raw.slice(-3));
}

/**
 * Infiere el código de presentación (3 dígitos) desde SKU/nombre.
 * kg / kilo / 1.000g / 1000g → 001; 50g → 050; 100g → 100; etc.
 */
export function sugerirPresentacionEan(sku: string, nombre = ""): string {
  const skuTrim = (sku || "").trim();
  const nombreTrim = (nombre || "").trim();
  const blob = `${skuTrim} ${nombreTrim}`.trim();

  if (/(?:1[.,]000|1000)\s*g\b/i.test(blob)) return "001";
  if (/kg\s*$/i.test(skuTrim) || /\b(?:kg|kilos?)\b/i.test(blob)) return "001";

  const colaSku = skuTrim.includes("-") ? skuTrim.slice(skuTrim.lastIndexOf("-") + 1) : skuTrim;
  if (
    /^(?:lt|l)$/i.test(colaSku) ||
    (/\b(?:lt|litro|litros)\b/i.test(blob) && !/\d+(?:[.,]\d+)?\s*(?:ml|lt|l)\b/i.test(blob))
  ) {
    return "001";
  }

  let m = skuTrim.match(/(\d+(?:[.,]\d+)?)\s*(g|ml|lt|l)\s*$/i);
  if (!m) m = blob.match(/(\d+(?:[.,]\d+)?)\s*(g|ml|lt|l)\b/i);
  if (!m) return "000";

  let unit = m[2].toLowerCase();
  if (unit === "l") unit = "lt";
  const digitos = String(m[1]).replace(",", ".").split(".")[0];
  if (unit === "kg") return "001";
  if (unit === "lt" && digitos === "1") return "001";

  const n = numeroPresentacionDesdeCola(digitos);
  if (n == null) return "000";
  if (unit === "g" && n === 1000) return "001";
  return codigoPresentacionDesdeNumero(n);
}

const QUERY_KEY = ["etiquetas-codigos-ean"];

export function useCodigosEan() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const data = await api.get<{ codigos: CodigoEan[] }>("/api/etiquetas/codigos-ean");
      return data.codigos ?? [];
    },
    staleTime: 30_000,
  });
}

export function useCrearCodigoEan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nuevo: NuevoCodigoEan) =>
      api.post<CodigoEan & { ok: boolean }>("/api/etiquetas/codigos-ean", nuevo),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useActualizarCodigoEan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: NuevoCodigoEan }) =>
      api.put<CodigoEan & { ok: boolean }>(`/api/etiquetas/codigos-ean/${id}`, datos),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useEliminarCodigoEan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/etiquetas/codigos-ean/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export interface ResultadoImportacionEan {
  ok: boolean;
  creados: number;
  omitidos: number;
  errores: string[];
  siguiente_numero?: number;
}

/** Registra en bloque los combos SIIGO activos que aún no tienen EAN. */
export function useImportarCombosEanSiigo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ResultadoImportacionEan>("/api/etiquetas/codigos-ean/importar-siigo", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export interface ResultadoSyncBarcodeSiigo {
  ok: boolean;
  actualizados: number;
  omitidos: number;
  errores: string[];
  procesados?: number;
  en_planilla?: number;
}

/** Empuja los EAN de la planilla al campo código de barras en SIIGO. */
export function useSincronizarBarcodesEanSiigo() {
  return useMutation({
    mutationFn: (opts?: { solo_vacios?: boolean }) =>
      api.post<ResultadoSyncBarcodeSiigo>("/api/etiquetas/codigos-ean/sincronizar-siigo", {
        solo_vacios: opts?.solo_vacios ?? true,
      }),
  });
}
