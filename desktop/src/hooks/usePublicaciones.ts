import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface SyncStatus {
  status: "ok" | "incomplete" | "no_listing" | "linked" | "unknown";
  mensaje: string;
  tiene_foto?: boolean;
  tiene_descripcion?: boolean;
  tiene_override?: boolean;
  updated_at?: string | null;
  item_id?: string;
}

export interface MeliComplianceReemplazo {
  item_id: string;
  permalink?: string;
  url_meli: string;
  estado_actual: string;
  sub_status?: string[];
  item_origen_id?: string;
  sku?: string;
  nombre?: string;
  ultima_revision?: string | null;
  creado_en?: string;
  nivel_riesgo?: string | null;
}

export interface PresentacionItem {
  sku: string;
  nombre: string;
  presentacion_label: string;
  precio_lista: number;
  precio_web: number;
  meli_id: string;
  meli_url?: string;
  stock: number | null;
  buyable: boolean;
}

export interface VistaMeliSitio {
  item_id: string;
  titulo: string;
  estado: string;
  precio: number | null;
  stock: number | null;
  permalink: string;
  foto: string;
  condicion?: string;
  listing_type_id?: string;
  categoria_meli?: string;
}

export interface PresentacionSitio {
  sku: string;
  nombre: string;
  presentacion_label: string;
  precio_web: number;
  precio_lista: number;
  foto_web: string;
  slug: string;
  meli_id: string;
  oculto_web: boolean;
  buyable: boolean;
  aparece_en_web: boolean;
  web: {
    nombre: string;
    label: string;
    precio: number;
    visible: boolean;
    vitrina: boolean;
    url: string;
  };
  meli: VistaMeliSitio;
}

export interface VistaSitios {
  web: {
    nombre: string;
    categoria: string;
    linea: string;
    linea_id: string;
    linea_color: string;
    slug: string;
    url: string;
    url_catalogo: string;
    precio: number;
    precio_str: string;
    foto: string;
    descripcion: string;
    visible: boolean;
    vitrina: boolean;
    buyable: boolean;
    es_familia: boolean;
    n_presentaciones: number;
    motivo_oculto: string;
  };
  meli: VistaMeliSitio;
  presentaciones: PresentacionSitio[];
}

export interface PublicacionItem {
  sku: string;
  nombre: string;
  categoria: string;
  cat_color: string;
  linea?: string;
  linea_id?: string;
  slug: string;
  url_web?: string;
  url_catalogo?: string;
  precio_lista: number;
  precio_web: number;
  foto_efectiva: string;
  meli_id: string;
  meli_url?: string;
  meli_compliance_reemplazo?: MeliComplianceReemplazo | null;
  tiene_override: boolean;
  oculto_web?: boolean;
  visible_web?: boolean;
  n_presentaciones?: number;
  sync_web: SyncStatus;
  sync_meli: SyncStatus;
  presentaciones?: PresentacionItem[];
}

export interface PublicacionDetalle extends PublicacionItem {
  es_presentacion_de?: string;
  precio_str: string;
  precio_meli_str: string;
  foto_url_cache: string;
  foto_url_override: string;
  desc_cache: string;
  desc_override: string;
  descripcion_efectiva: string;
  ficha: Record<string, unknown>;
  caracteristicas: { titulo: string; valor: string }[];
  meli_item_id_cache: string;
  meli_item_id_override: string;
  meli_id_efectivo: string;
  meli_live: Record<string, unknown> | null;
  en_vitrina: boolean;
  buyable: boolean;
  is_combo: boolean;
  oculto_web: boolean;
  visible_web?: boolean;
  tiene_override: boolean;
  override_updated_at: string | null;
  vista_sitios?: VistaSitios;
}

export interface ListaPublicaciones {
  items: PublicacionItem[];
  total: number;
  categorias: string[];
  resumen?: {
    total: number;
    listos: number;
    falta_web: number;
    sin_meli: number;
    no_en_tienda: number;
  };
}

export function usePublicaciones(buscar = "", categoria = "", canal = "") {
  return useQuery<ListaPublicaciones>({
    queryKey: ["publicaciones", buscar, categoria, canal],
    queryFn: () => {
      const params = new URLSearchParams();
      if (buscar) params.set("buscar", buscar);
      if (categoria) params.set("categoria", categoria);
      if (canal) params.set("canal", canal);
      return api.get<ListaPublicaciones>(`/api/publicaciones?${params}`);
    },
    staleTime: 30_000,
  });
}

export interface GaleriaImagen {
  filename: string;
  path: string;
  url: string;
  principal?: boolean;
  size_bytes?: number;
  width?: number;
  height?: number;
  cumple_estandar?: boolean;
}

export interface GaleriaSkuItem {
  sku: string;
  nombre: string;
  total: number;
  principal: string;
  principal_url: string;
  imagenes: GaleriaImagen[];
}

export interface GaleriaPublicaciones {
  items: GaleriaSkuItem[];
  total_skus: number;
  total_imagenes: number;
  buscar?: string;
}

export interface PrecioCanalItem {
  sku: string;
  nombre: string;
  meli_id: string;
  meli_estado: string | null;
  precio_meli: number | null;
  precio_siigo: number | null;
  precio_web: number | null;
  web_esperado: number | null;
  siigo_sincronizado: boolean | null;
  web_sincronizado: boolean | null;
}

export interface PreciosCanalesResp {
  items: PrecioCanalItem[];
  total: number;
  desincronizados: number;
  desincronizados_activos: number;
  actualizado_en?: string | null;
  cache_hit?: boolean;
}

export function usePreciosCanales(buscar = "") {
  return useQuery<PreciosCanalesResp>({
    queryKey: ["publicaciones-precios-canales", buscar],
    queryFn: () => {
      const params = new URLSearchParams();
      if (buscar) params.set("buscar", buscar);
      const qs = params.toString();
      return api.get<PreciosCanalesResp>(
        `/api/publicaciones/precios-canales${qs ? `?${qs}` : ""}`,
        { timeoutMs: 60_000 },
      );
    },
    staleTime: 30_000,
  });
}

export function useGaleriaPublicaciones(buscar = "") {
  return useQuery<GaleriaPublicaciones>({
    queryKey: ["publicaciones-galeria", buscar],
    queryFn: () => {
      const params = new URLSearchParams();
      if (buscar) params.set("buscar", buscar);
      const qs = params.toString();
      return api.get<GaleriaPublicaciones>(
        `/api/publicaciones/galeria${qs ? `?${qs}` : ""}`,
      );
    },
    staleTime: 30_000,
  });
}

export function usePublicacionDetalle(sku: string | null, liveMeli = false) {
  return useQuery<PublicacionDetalle>({
    queryKey: ["publicacion", sku, liveMeli],
    queryFn: () =>
      api.get<PublicacionDetalle>(
        `/api/publicaciones/${sku}${liveMeli ? "?live_meli=1" : ""}`,
      ),
    enabled: !!sku,
    staleTime: 15_000,
  });
}

export function useGuardarPublicacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sku,
      campos,
    }: {
      sku: string;
      campos: Partial<{
        descripcion: string;
        foto_url: string;
        meli_item_id: string;
        caracteristicas: { titulo: string; valor: string }[];
        oculto_web: boolean;
      }>;
    }) => api.put<{ ok: boolean }>(`/api/publicaciones/${sku}`, campos),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      qc.invalidateQueries({ queryKey: ["publicacion", vars.sku] });
    },
  });
}

export function useSyncWeb(sku?: string) {
  const qc = useQueryClient();
  const endpoint = sku
    ? `/api/publicaciones/${sku}/sync-web`
    : "/api/publicaciones/sync-web-all";
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; cache: unknown; web: unknown }>(endpoint),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      if (sku) qc.invalidateQueries({ queryKey: ["publicacion", sku] });
    },
  });
}

export function useSyncMeli(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stock: number) =>
      api.post<{ ok: boolean; resultado?: string }>(
        `/api/publicaciones/${sku}/sync-meli`,
        { stock },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publicacion", sku] });
    },
  });
}

export function useEstadoMeli() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sku, estado }: { sku: string; estado: "active" | "paused" }) =>
      api.post<{
        ok: boolean;
        estado?: string;
        estado_anterior?: string;
        mensaje?: string;
        error?: string;
        meli_id?: string;
      }>(`/api/publicaciones/${sku}/estado-meli`, { estado }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["publicacion", vars.sku] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
    },
  });
}

export function usePrecioMeli(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      precio,
      meli_item_id,
    }: {
      precio: number;
      meli_item_id?: string;
    }) =>
      api.post<{
        ok: boolean;
        msg?: string;
        error?: string;
        items?: Array<{ item_id: string; ok: boolean; error?: string | null }>;
      }>(`/api/publicaciones/${sku}/precio-meli`, {
        precio,
        meli_item_id: meli_item_id || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publicacion", sku] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      qc.invalidateQueries({ queryKey: ["publicaciones-precios-canales"] });
    },
  });
}

export function useRefreshWeb() {
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/publicaciones/refresh-web"),
  });
}

export interface ImagenWeb {
  filename: string;
  path: string;
  url: string;
  principal: boolean;
  size_bytes: number;
  width?: number;
  height?: number;
  cumple_estandar?: boolean;
}

export interface NormalizarImagenesResult {
  ok: boolean;
  estandar?: string;
  fondo?: string;
  total: number;
  normalizadas: number;
  omitidas: number;
  errores: number;
  resultados?: Array<{
    ok: boolean;
    filename: string;
    skipped?: boolean;
    width?: number;
    height?: number;
    error?: string;
  }>;
  error?: string;
}

export function useNormalizarImagenesCatalogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: {
      sku?: string;
      filenames?: string[];
      solo_no_cumplen?: boolean;
      limit?: number;
    }) =>
      api.post<NormalizarImagenesResult>(
        "/api/publicaciones/galeria/normalizar",
        body || { solo_no_cumplen: true },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["publicaciones-galeria"] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      if (vars?.sku) {
        qc.invalidateQueries({ queryKey: ["fotos-actuales", vars.sku] });
        qc.invalidateQueries({ queryKey: ["publicacion", vars.sku] });
      } else {
        qc.invalidateQueries({ queryKey: ["fotos-actuales"] });
      }
    },
  });
}

export interface ImagenMeli {
  id: string;
  url: string;
  principal: boolean;
}

export interface FotosActuales {
  web: { imagenes: ImagenWeb[]; total: number; principal: string };
  meli: { imagenes: ImagenMeli[]; total: number; error: string };
}

export function useFotosActuales(sku: string | null, meliItemId: string = "") {
  return useQuery<FotosActuales>({
    queryKey: ["fotos-actuales", sku, meliItemId],
    queryFn: () => {
      const params = meliItemId ? `?meli_item_id=${encodeURIComponent(meliItemId)}` : "";
      return api.get<FotosActuales>(`/api/publicaciones/${sku}/fotos${params}`);
    },
    enabled: !!sku,
    staleTime: 0,
  });
}

export interface SubirImagenResult {
  ok: boolean;
  sku: string;
  archivos: {
    filename: string;
    web?: { ok: boolean; path?: string; filename?: string; error?: string };
    meli?: { ok: boolean; picture_id?: string; url?: string; pictures?: ImagenMeli[]; error?: string };
  }[];
}

export function useSubirImagen(sku: string = "") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      files,
      targets,
      meliItemId,
      sku: skuArg,
    }: {
      files: File[];
      targets: ("web" | "meli")[];
      meliItemId?: string;
      sku?: string;
    }) => {
      const destSku = (skuArg || sku).trim();
      if (!destSku) throw new Error("Indica el SKU al que pertenecen las fotos");
      // Una petición por archivo: subir todo junto superaba el timeout
      // del túnel Cloudflare (~100s) y el gateway respondía 504.
      const archivos: SubirImagenResult["archivos"] = [];
      for (const f of files) {
        const form = new FormData();
        form.append("files[]", f);
        form.append("targets", targets.join(","));
        if (meliItemId) form.append("meli_item_id", meliItemId);
        const res = await api.upload<SubirImagenResult>(
          `/api/publicaciones/${encodeURIComponent(destSku)}/imagen`,
          form,
        );
        archivos.push(...(res.archivos || []));
      }
      const ok = archivos.some((a) => a.web?.ok || a.meli?.ok);
      return { ok, sku: destSku, archivos } satisfies SubirImagenResult;
    },
    onSuccess: (_data, vars) => {
      const destSku = (vars.sku || sku).trim();
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      qc.invalidateQueries({ queryKey: ["publicacion", destSku] });
      qc.invalidateQueries({ queryKey: ["fotos-actuales", destSku] });
      qc.invalidateQueries({ queryKey: ["publicaciones-galeria"] });
    },
  });
}

export function useReordenarImagenesWeb(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orden: string[]) =>
      api.put<{ ok: boolean; principal: string | null }>(`/api/publicaciones/${sku}/imagenes/web`, { orden }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fotos-actuales", sku] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
    },
  });
}

export function useReordenarImagenesMeli(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ picture_ids, meli_item_id }: { picture_ids: string[]; meli_item_id: string }) =>
      api.put<{ ok: boolean; total_pictures: number }>(
        `/api/publicaciones/${sku}/imagenes/meli`,
        { picture_ids, meli_item_id },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fotos-actuales", sku] });
    },
  });
}

export function useEliminarImagenes(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      plataforma,
      filename,
      picture_id,
      meli_item_id,
    }: {
      plataforma: "web" | "meli";
      filename?: string;
      picture_id?: string;
      meli_item_id?: string;
    }) => {
      const skuEnc = encodeURIComponent(sku);
      const path =
        plataforma === "web"
          ? `/api/publicaciones/${skuEnc}/imagen/web`
          : `/api/publicaciones/${skuEnc}/imagen/meli`;
      const body =
        plataforma === "web" ? { filename } : { picture_id, meli_item_id };
      const res = await api.post<{ ok?: boolean; error?: string }>(path, body);
      if (!res?.ok) {
        throw new Error(res?.error || "No se pudo eliminar la foto");
      }
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fotos-actuales", sku] });
      qc.invalidateQueries({ queryKey: ["publicacion", sku] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      qc.invalidateQueries({ queryKey: ["publicaciones-galeria"] });
    },
  });
}

export function useCopiarImagenSitio(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      origen: "web" | "meli";
      destino: "web" | "meli";
      imagen_id: string;
      url?: string;
      meli_item_id?: string;
    }) =>
      api.post<{
        ok: boolean;
        mensaje?: string;
        error?: string;
        destino?: string;
      }>(`/api/publicaciones/${sku}/imagenes/copiar`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fotos-actuales", sku] });
      qc.invalidateQueries({ queryKey: ["publicacion", sku] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      qc.invalidateQueries({ queryKey: ["publicaciones-galeria"] });
    },
  });
}

export interface AdjuntarDesdeGaleriaResult {
  ok: boolean;
  sku: string;
  copiadas?: number;
  mensaje?: string;
  error?: string;
  archivos: Array<{
    filename: string;
    error?: string;
    origen?: string;
    web?: { ok?: boolean; skipped?: boolean; filename?: string; error?: string };
    meli?: { ok?: boolean; picture_id?: string; error?: string };
  }>;
}

export function useAdjuntarDesdeGaleria(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      filenames?: string[];
      recursos?: string[];
      targets: Array<"web" | "meli">;
      meli_item_id?: string;
    }) =>
      api.post<AdjuntarDesdeGaleriaResult>(
        `/api/publicaciones/${encodeURIComponent(sku)}/imagenes/desde-galeria`,
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fotos-actuales", sku] });
      qc.invalidateQueries({ queryKey: ["publicacion", sku] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      qc.invalidateQueries({ queryKey: ["publicaciones-galeria"] });
    },
  });
}
