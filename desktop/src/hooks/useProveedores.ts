import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface ProveedorResumen {
  proveedores: number;
  productos: number;
  lineas_producto: number;
  precios: number;
  publicables: number;
  catalogos: number;
  catalogos_pendientes: number;
  cotizaciones_nuevas: number;
  paises: string[];
  oferta_web_publicada: boolean;
}

export interface Proveedor {
  id: number;
  nombre: string;
  nit: string;
  pais: string;
  ciudad: string;
  email: string;
  telefono: string;
  sitio_web: string;
  tipo: string;
  incoterm: string;
  moneda: string;
  condiciones_pago: string;
  notas: string;
  activo: number;
  n_productos?: number;
  n_precios?: number;
  ultima_compra?: string | null;
  n_catalogos?: number;
}

export interface ProductoProveedor {
  id: number;
  proveedor_id: number;
  nombre: string;
  clave: string;
  cas: string;
  presentacion: string;
  unidad: string;
  sku_siigo: string;
  linea: string;
  origen_pais: string;
  publicar_web: number;
  fuente: string;
  referencia: string;
  notas?: string;
  ultimo_precio?: number | null;
  ultima_moneda?: string | null;
  ultima_fecha?: string | null;
}

export interface PrecioHistorico {
  id: number;
  proveedor_id: number;
  proveedor?: string;
  nombre: string;
  clave: string;
  fecha: string;
  precio_unitario: number;
  moneda: string;
  cantidad: number;
  unidad: string;
  total: number;
  fuente: string;
  documento: string;
}

export interface CatalogoCorreo {
  id: number;
  msg_id: string;
  proveedor_id: number | null;
  proveedor_nombre?: string | null;
  remitente: string;
  remitente_email: string;
  asunto: string;
  fecha: string;
  adjuntos: { filename: string; att_id: string; size: number; mime: string }[];
  estado: "detectado" | "importado" | "omitido";
  n_lineas: number;
}

export interface ProveedorDetalle extends Proveedor {
  productos: ProductoProveedor[];
  precios: PrecioHistorico[];
  catalogos: CatalogoCorreo[];
}

export interface FuenteProducto {
  proveedor_id: number;
  proveedor: string;
  pais: string;
  tipo: string;
  producto_id: number;
  nombre_en_proveedor: string;
  ultimo_precio: number | null;
  moneda: string;
  ultima_fecha: string;
  precio_min: number | null;
  n_compras: number;
  fuente: string;
}

export interface ProductoAgrupado {
  clave: string;
  nombre: string;
  cas: string;
  linea: string;
  origen_paises: string[];
  publicar_web: boolean;
  presentaciones: string[];
  skus_siigo: string[];
  proveedores: FuenteProducto[];
  mejor_precio: number | null;
  mejor_proveedor: string;
}

export interface LineaCandidata {
  nombre: string;
  precio: number | null;
  cas: string;
  fila: string;
  archivo?: string;
}

export interface SolicitudCotizacion {
  id: number;
  created_at: string;
  nombre: string;
  empresa: string;
  email: string;
  telefono: string;
  ciudad: string;
  producto: string;
  clave: string;
  presentacion: string;
  cantidad: string;
  mensaje: string;
  origen: string;
  estado: "nueva" | "en_proceso" | "enviada" | "cerrada";
  respuesta: string;
  respondido_at: string;
  proveedores_posibles: { id: number; nombre: string; pais: string; ultimo_precio: number | null }[];
}

const KEY = ["proveedores"] as const;

export function useProveedoresResumen() {
  return useQuery({
    queryKey: [...KEY, "resumen"],
    queryFn: () => api.get<ProveedorResumen>("/api/proveedores/resumen"),
    refetchInterval: 60_000,
  });
}

export function useProveedores(q = "") {
  return useQuery({
    queryKey: [...KEY, "lista", q],
    queryFn: () =>
      api.get<{ proveedores: Proveedor[] }>(`/api/proveedores?q=${encodeURIComponent(q)}`),
  });
}

export function useProveedorDetalle(id: number | null) {
  return useQuery({
    queryKey: [...KEY, "detalle", id],
    queryFn: () => api.get<ProveedorDetalle>(`/api/proveedores/${id}`),
    enabled: id != null,
  });
}

export function useGuardarProveedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: number; datos: Partial<Proveedor> }) =>
      id != null
        ? api.put<ProveedorDetalle>(`/api/proveedores/${id}`, datos)
        : api.post<ProveedorDetalle>("/api/proveedores", datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useBuscarProductos(q: string, opts?: { publicables?: boolean; linea?: string }) {
  const params = new URLSearchParams({ q });
  if (opts?.publicables) params.set("publicables", "1");
  if (opts?.linea) params.set("linea", opts.linea);
  return useQuery({
    queryKey: [...KEY, "productos", q, opts?.publicables ?? false, opts?.linea ?? ""],
    queryFn: () => api.get<{ productos: ProductoAgrupado[] }>(`/api/proveedores/productos?${params}`),
  });
}

export function useHistorialPrecios(clave: string | null) {
  return useQuery({
    queryKey: [...KEY, "precios", clave],
    queryFn: () =>
      api.get<{ clave: string; precios: PrecioHistorico[] }>(
        `/api/proveedores/precios?clave=${encodeURIComponent(clave ?? "")}`,
      ),
    enabled: !!clave,
  });
}

export function useActualizarProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: Partial<ProductoProveedor> & { aplicar_a_clave?: boolean } }) =>
      api.put<ProductoProveedor>(`/api/proveedores/productos/${id}`, datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useEliminarProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: boolean }>(`/api/proveedores/productos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAgregarProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ proveedorId, datos }: { proveedorId: number; datos: Record<string, unknown> }) =>
      api.post<ProductoProveedor>(`/api/proveedores/${proveedorId}/productos`, datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export interface ResultadoImportacion {
  ok: boolean;
  error?: string;
  fuente?: string;
  lineas?: number;
  precios_nuevos?: number;
  facturas?: number;
  facturas_proveedor?: number;
  compras?: number;
  historial?: ResultadoImportacion;
  compras_exterior?: ResultadoImportacion;
  siigo?: ResultadoImportacion;
  resumen?: ProveedorResumen;
}

export function useImportarFuentes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fuente: "todo" | "historial" | "compras_exterior" | "siigo"; incluir_siigo?: boolean; fecha_desde?: string }) =>
      api.post<ResultadoImportacion>("/api/proveedores/importar", body, { timeoutMs: 240_000 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCatalogos(estado = "") {
  return useQuery({
    queryKey: [...KEY, "catalogos", estado],
    queryFn: () => api.get<{ catalogos: CatalogoCorreo[] }>(`/api/proveedores/catalogos?estado=${estado}`),
  });
}

export function useEscanearCatalogos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { dias: number }) =>
      api.post<{ ok: boolean; error?: string; correos_revisados?: number; catalogos_nuevos?: number }>(
        "/api/proveedores/catalogos/escanear",
        body,
        { timeoutMs: 240_000 },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useActualizarCatalogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: { estado?: string; proveedor_id?: number | null } }) =>
      api.put<CatalogoCorreo>(`/api/proveedores/catalogos/${id}`, datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export interface ExtraccionCatalogo {
  ok: boolean;
  error?: string;
  lineas: LineaCandidata[];
  detalle: { archivo: string; lineas?: number; error?: string }[];
  truncado?: boolean;
}

export function useExtraerCatalogo() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post<ExtraccionCatalogo>(`/api/proveedores/catalogos/${id}/extraer`, undefined, { timeoutMs: 180_000 }),
  });
}

export function useExtraerUrl() {
  return useMutation({
    mutationFn: (url: string) =>
      api.post<ExtraccionCatalogo & { url?: string }>("/api/proveedores/extraer-url", { url }, { timeoutMs: 90_000 }),
  });
}

export interface ImportarLineasBody {
  proveedor_id?: number;
  proveedor_nombre?: string;
  lineas: LineaCandidata[];
  moneda?: string;
  publicar_web?: boolean;
  linea?: string;
  origen_pais?: string;
}

export function useImportarLineasCatalogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ catalogoId, body }: { catalogoId: number | null; body: ImportarLineasBody }) =>
      catalogoId != null
        ? api.post<{ ok: boolean; lineas: number; precios_nuevos: number }>(`/api/proveedores/catalogos/${catalogoId}/importar`, body)
        : api.post<{ ok: boolean; lineas: number; precios_nuevos: number }>("/api/proveedores/importar-lineas", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function usePublicarOfertaWeb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; n_productos: number; n_paises: number }>("/api/proveedores/publicar-web"),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCatalogoPaises() {
  return useQuery({
    queryKey: [...KEY, "paises"],
    queryFn: () => api.get<{ paises: string[]; lineas: string[]; tipos: string[] }>("/api/proveedores/paises"),
    staleTime: Infinity,
  });
}

export function useSolicitudesCotizacion(estado = "") {
  return useQuery({
    queryKey: [...KEY, "cotizaciones", estado],
    queryFn: () => api.get<{ solicitudes: SolicitudCotizacion[] }>(`/api/proveedores/cotizaciones?estado=${estado}`),
    refetchInterval: 60_000,
  });
}

export function useActualizarSolicitud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: { estado?: string; respuesta?: string; enviar_respuesta?: boolean } }) =>
      api.put<SolicitudCotizacion & { envio_correo?: string }>(`/api/proveedores/cotizaciones/${id}`, datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const LINEA_LABEL: Record<string, string> = {
  "aceites-ceras-grasas": "Aceites, ceras y grasas",
  agro: "Agro",
  alimentario: "Alimentario",
  cosmetica: "Cosmética",
  industria: "Industria",
  laboratorio: "Laboratorio",
};

export const FUENTE_LABEL: Record<string, string> = {
  factura_compra: "Factura de compra",
  siigo: "Alegra",
  compra_exterior: "Compra exterior",
  catalogo: "Catálogo",
  manual: "Manual",
};

export function fmtPrecio(v: number | null | undefined, moneda = "COP"): string {
  if (v == null) return "—";
  const m = moneda || "COP";
  const num = v.toLocaleString("es-CO", { maximumFractionDigits: m === "COP" ? 0 : 2 });
  return m === "COP" ? `$${num}` : `${m} ${num}`;
}

export function useAutoclasificar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { todos?: boolean; proveedor_id?: number }) =>
      api.post<{ ok: boolean; actualizados: number }>("/api/proveedores/autoclasificar", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function usePublicarMasivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { proveedor_ids: number[]; despublicar?: boolean }) =>
      api.post<{ ok: boolean; productos: number }>("/api/proveedores/publicar-masivo", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export interface CeldaComparador {
  producto_id: number;
  nombre: string;
  ultimo_precio: number | null;
  moneda: string;
  fecha: string;
  n_compras: number;
}
export interface FilaComparador {
  clave: string;
  nombre: string;
  linea: string;
  cas: string;
  celdas: Record<string, CeldaComparador>;
  n_proveedores: number;
  mejor_pid: number | null;
}
export interface Comparador {
  proveedores: { id: number; nombre: string; pais: string; n_productos: number }[];
  filas: FilaComparador[];
  total_filas: number;
}
export function useComparador(ids: number[], q: string, minimo: number) {
  const params = new URLSearchParams({ ids: ids.join(","), q, minimo: String(minimo) });
  return useQuery({
    queryKey: [...KEY, "comparador", ids.join(","), q, minimo],
    queryFn: () => api.get<Comparador>(`/api/proveedores/comparador?${params}`),
  });
}
export interface Coincidencias {
  proveedores: { id: number; nombre: string; n_productos: number }[];
  pares: { a: number; b: number; a_nombre: string; b_nombre: string; n: number }[];
  matriz: Record<string, Record<string, number>>;
}
export function useCoincidencias() {
  return useQuery({ queryKey: [...KEY, "coincidencias"], queryFn: () => api.get<Coincidencias>("/api/proveedores/coincidencias") });
}
export function useCatalogoWeb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; proveedor_id?: number; solo_extraer?: boolean; publicar_web?: boolean }) =>
      api.post<ExtraccionCatalogo & { metodo?: string; n?: number; extraidas?: number; lineas_guardadas?: number }>("/api/proveedores/catalogo-web", body, { timeoutMs: 240_000 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
