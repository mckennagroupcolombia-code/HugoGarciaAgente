import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ProductLabelData } from "../components/etiqueta-ficha/productLabelTypes";
import type { IconoKey } from "../components/etiqueta-ficha/ProductAttributeGrid";
import type { TextStyleOverride } from "../components/etiqueta-ficha/TextStyleContext";

export interface FichaEtiquetaGuardada {
  id: string;
  /** Nombre elegido a mano por el operador — nunca derivado de data.productName. */
  nombre: string;
  data: ProductLabelData;
  tipo_nombre?: string;
  /** Id de CATEGORIAS_ETIQUETA (lib/categoriasEtiqueta.ts). */
  categoria?: string;
  /** Esta etiqueta es la plantilla de su categoría: el formato ajustado que se
   *  despliega sobre todos los productos de esa familia. */
  es_plantilla_categoria?: boolean;
  /** Plantilla de la que salió esta etiqueta (vacío en las del catálogo viejo). */
  plantilla_id?: string;
  attribute_icons?: Partial<Record<IconoKey, string>>;
  text_styles?: Record<string, TextStyleOverride>;
  creado: string;
  actualizado: string;
}

export interface GuardarFichaEtiquetaBody {
  id?: string;
  nombre: string;
  data: ProductLabelData;
  tipo_nombre?: string;
  categoria?: string;
  es_plantilla_categoria?: boolean;
  plantilla_id?: string;
  attribute_icons?: Partial<Record<IconoKey, string>>;
  text_styles?: Record<string, TextStyleOverride>;
}

const QK = ["etiquetas-fichas"] as const;

export function useFichasEtiquetaGuardadas(q: string = "") {
  return useQuery({
    queryKey: [...QK, q],
    queryFn: async () => {
      // logos_aparte: cada logo (data URL de ~150 KB) viaja una sola vez y no
      // repetido en cada etiqueta — la lista pasó de 47 MB a unos 2 MB.
      const params = `?logos_aparte=1${q ? `&q=${encodeURIComponent(q)}` : ""}`;
      const res = await api.get<{ fichas: FichaEtiquetaGuardada[]; logos?: Record<string, string> }>(
        `/api/etiquetas/fichas${params}`,
      );
      const logos = res.logos ?? {};
      return res.fichas.map((f) => {
        const ref = f.data?.logoUrl;
        if (typeof ref !== "string" || !ref.startsWith("logo:")) return f;
        return { ...f, data: { ...f.data, logoUrl: logos[ref.slice(5)] ?? "" } };
      });
    },
    staleTime: 15_000,
  });
}

export function useGuardarFichaEtiqueta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GuardarFichaEtiquetaBody) =>
      api.post<{ ok: boolean; ficha: FichaEtiquetaGuardada }>("/api/etiquetas/fichas", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useEliminarFichaEtiqueta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/etiquetas/fichas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}
