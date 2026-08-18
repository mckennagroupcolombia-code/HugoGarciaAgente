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

export interface PublicacionItem {
  sku: string;
  nombre: string;
  categoria: string;
  cat_color: string;
  slug: string;
  precio_lista: number;
  precio_web: number;
  foto_efectiva: string;
  meli_id: string;
  meli_url?: string;
  meli_compliance_reemplazo?: MeliComplianceReemplazo | null;
  tiene_override: boolean;
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
  tiene_override: boolean;
  override_updated_at: string | null;
}

export interface ListaPublicaciones {
  items: PublicacionItem[];
  total: number;
  categorias: string[];
}

export function usePublicaciones(buscar = "", categoria = "") {
  return useQuery<ListaPublicaciones>({
    queryKey: ["publicaciones", buscar, categoria],
    queryFn: () => {
      const params = new URLSearchParams();
      if (buscar) params.set("buscar", buscar);
      if (categoria) params.set("categoria", categoria);
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

export function useSubirImagen(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      files,
      targets,
      meliItemId,
    }: {
      files: File[];
      targets: ("web" | "meli")[];
      meliItemId?: string;
    }) => {
      // Una petición por archivo: subir todo junto superaba el timeout
      // del túnel Cloudflare (~100s) y el gateway respondía 504.
      const archivos: SubirImagenResult["archivos"] = [];
      for (const f of files) {
        const form = new FormData();
        form.append("files[]", f);
        form.append("targets", targets.join(","));
        if (meliItemId) form.append("meli_item_id", meliItemId);
        const res = await api.upload<SubirImagenResult>(`/api/publicaciones/${sku}/imagen`, form);
        archivos.push(...(res.archivos || []));
      }
      const ok = archivos.some((a) => a.web?.ok || a.meli?.ok);
      return { ok, sku, archivos } satisfies SubirImagenResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
      qc.invalidateQueries({ queryKey: ["publicacion", sku] });
      qc.invalidateQueries({ queryKey: ["fotos-actuales", sku] });
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

export function useEliminarImagenWeb(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) =>
      api.delete<{ ok: boolean }>(`/api/publicaciones/${sku}/imagen/web`),
    // NOTE: api.delete doesn't support body; use post-with-method workaround
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fotos-actuales", sku] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
    },
  });
}

// DELETE con body requiere fetch directo ya que api.delete no lo soporta
async function deleteWithBody(path: string, body: unknown): Promise<{ ok: boolean }> {
  const form = new FormData();
  // Use POST with _method=DELETE convention isn't available; use direct fetch
  const { useTicketsAuth } = await import("../stores/ticketsAuth");
  const { useAuthStore } = await import("../stores/auth");
  const token = useTicketsAuth.getState().apiToken
    || useTicketsAuth.getState().token
    || useAuthStore.getState().token
    || "";
  const r = await fetch(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

export function useEliminarImagenes(sku: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
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
      if (plataforma === "web") {
        return deleteWithBody(`/api/publicaciones/${sku}/imagen/web`, { filename });
      }
      return deleteWithBody(`/api/publicaciones/${sku}/imagen/meli`, { picture_id, meli_item_id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fotos-actuales", sku] });
      qc.invalidateQueries({ queryKey: ["publicaciones"] });
    },
  });
}
