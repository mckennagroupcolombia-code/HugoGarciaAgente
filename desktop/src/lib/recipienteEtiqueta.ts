import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * CONSERVACIÓN dice «envase» o «empaque» según la receta del combo de la etiqueta: frasco,
 * pote, farma, gotero… → «envase»; solo bolsa → «empaque» (las bolsas de seguridad del envío
 * no cuentan). Lo decide el servidor (`mapa_producto.recipientes`), que también lo corrige al
 * guardar; aquí se aplica en pantalla para que el PNG salga igual que lo guardado.
 */
export type Recipiente = "envase" | "empaque";

type Mapa = { por_barcode: Record<string, Recipiente>; por_etiqueta: Record<string, Recipiente> };

export function useRecipientes() {
  return useQuery({
    queryKey: ["recipientes-etiqueta"],
    queryFn: () => api.get<Mapa>("/api/mapa-sistema/recipientes"),
    staleTime: 60_000,
  });
}

/** Manda el código de barras (dice cuál es el combo); si no, el enlace ya conocido. */
export function recipientePara(m: Mapa | undefined, barcode?: string | null, fichaId?: string | null): Recipiente | "" {
  if (!m) return "";
  return m.por_barcode[(barcode || "").trim()] || (fichaId ? m.por_etiqueta[fichaId] : undefined) || "";
}

/** Cambia «envase»/«empaque» por la palabra del combo, respetando plural y mayúsculas. */
export function palabraRecipiente(texto: string, r: Recipiente | ""): string {
  if (!texto || !r) return texto;
  return texto.replace(/\b(envase|empaque)(s?)\b/gi, (orig, _w: string, plural: string) => {
    const w = r + plural;
    if (orig === orig.toUpperCase()) return w.toUpperCase();
    return orig[0] === orig[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w;
  });
}
