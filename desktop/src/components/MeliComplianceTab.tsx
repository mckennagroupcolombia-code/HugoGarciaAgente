import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCodigosEan, type CodigoEan } from "../lib/etiquetasCodigosEan";

type FotoNueva = {
  id: string;
  url: string;
  filename?: string;
  adjuntada?: boolean;
  nota?: string;
};

/** URLs en orden de galería: principal primero, sin duplicados. */
function ordenarFotoUrls(fotos: FotoNueva[], principalUrl: string): string[] {
  const urls = fotos.map((f) => f.url).filter(Boolean);
  const principal = (principalUrl || "").trim();
  if (!principal) return [...new Set(urls)];
  return [principal, ...urls.filter((u) => u !== principal)];
}

// ── Biblioteca de docs técnicos (fichas) ───────────────────────────────────

interface ArchivoBiblioteca {
  nombre: string;
  tipo: string;
  tamano: number;
  fecha: number;
}

interface BibliotecaDatosResult {
  tipo: string;
  titulo: string;
  datos: Record<string, unknown>;
  tiene_datos: boolean;
}

function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tituloDesdeArchivoBiblioteca(nombre: string): string {
  return nombre
    .replace(/^FT\s+COA\s+SDS\s+/i, "")
    .replace(/^COMPLETO\s+FT\s+/i, "")
    .replace(/^FT\s+/i, "")
    .replace(/\.(pdf|docx)$/i, "")
    .trim();
}

function coincideFichaBiblioteca(producto: string, archivo: string): boolean {
  const p = normalizarTexto(producto);
  const a = normalizarTexto(tituloDesdeArchivoBiblioteca(archivo));
  if (!p || !a) return false;
  if (a.includes(p) || p.includes(a)) return true;
  const palabras = p.split(" ").filter((w) => w.length >= 4);
  if (palabras.length >= 2 && palabras.every((w) => a.includes(w))) return true;
  if (palabras.length === 1 && a.includes(palabras[0])) return true;
  return false;
}

function datosFichaATexto(datos: Record<string, unknown>): string {
  const lines: string[] = [];
  const titulo = String(datos.titulo || datos.nombre_producto || "").trim();
  if (titulo) lines.push(`Producto: ${titulo}`);
  if (datos.sinonimos) lines.push(`Sinónimos: ${String(datos.sinonimos)}`);
  if (datos.cas) lines.push(`CAS: ${String(datos.cas)}`);
  if (datos.descripcion) lines.push(`Descripción: ${String(datos.descripcion)}`);
  const cf = datos.caracteristicas_fisicas;
  if (cf && typeof cf === "object") {
    const parts = Object.entries(cf as Record<string, unknown>)
      .filter(([, v]) => String(v || "").trim())
      .map(([k, v]) => `${k}: ${v}`);
    if (parts.length) lines.push(`Características: ${parts.join("; ")}`);
  }
  const apps = datos.aplicaciones;
  if (Array.isArray(apps) && apps.length) {
    lines.push(`Aplicaciones: ${apps.slice(0, 8).map(String).join("; ")}`);
  }
  return lines.join("\n").slice(0, 1500);
}

// ── Helpers MeLi ───────────────────────────────────────────────────────────

function meliUrl(permalink?: string, itemId?: string): string {
  if (permalink) {
    const u = permalink.trim();
    if (u.startsWith("http://")) return "https://" + u.slice(7);
    if (!u.startsWith("https://")) return "https://" + u;
    return u;
  }
  if (itemId) return `https://articulo.mercadolibre.com.co/${itemId}`;
  return "";
}

function estadoMeliBadge(estado: string, subStatus?: string[]) {
  const sub = subStatus ?? [];
  if (sub.includes("forbidden")) {
    return { cls: "bg-red-100 text-red-800", label: "prohibida" };
  }
  if (estado === "active") {
    return { cls: "bg-green-100 text-green-800", label: "activa" };
  }
  if (estado === "paused") {
    return { cls: "bg-yellow-100 text-yellow-800", label: "pausada" };
  }
  if (estado === "under_review") {
    return { cls: "bg-orange-100 text-orange-800", label: "en revisión" };
  }
  return { cls: "bg-gray-100 text-gray-700", label: estado || "?" };
}

function MeliLinkButton({
  url,
  label = "Ver en MeLi",
  compact = false,
}: {
  url: string;
  label?: string;
  compact?: boolean;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 font-semibold text-blue-800 transition hover:bg-blue-100 ${
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      }`}
    >
      ↗ {label}
    </a>
  );
}

// ── Tipos ──────────────────────────────────────────────────────────────────

type ItemPausado = {
  item_id: string;
  title: string;
  status: string;
  sub_status?: string[];
  sku: string;
  line?: string;
  price: number;
  permalink: string;
  category_id: string;
  domain_id: string;
  nombre_catalogo?: string;
  categoria_catalogo?: string;
};

type Diagnostico = {
  nivel: "bajo" | "medio" | "alto";
  score: number;
  señales: string[];
  advertencias_taxonomia: string[];
  recomendaciones: string[];
};

type ContenidoGenerado = {
  titulo: string;
  descripcion: string;
  subtitulo_etiqueta: string;
  bloque_etiqueta: string;
  atributos: {
    LINE: string;
    INGREDIENTS: string;
    domain_id: string;
    category_id: string;
  };
  checklist: Record<string, boolean>;
  error?: string;
};

type ResultadoRepublicacion = {
  ok?: boolean;
  item_id?: string;
  resultado?: Record<string, unknown>;
  error?: string;
  paso_fallido?: string;
  diagnostico?: Diagnostico;
  contenido_generado?: ContenidoGenerado;
  republicacion?: {
    ok: boolean;
    parcial?: boolean;
    item_id?: string;
    error?: string;
    aplicado?: string[];
    omitido?: Array<{ campo: string; razon: string }>;
    acciones_manuales?: string[];
    descripcion_para_pegar?: string | null;
    resultado?: Record<string, unknown>;
  };
  restricciones?: {
    forbidden?: boolean;
    con_ventas?: boolean;
    sold_quantity?: number;
    puede_titulo?: boolean;
    puede_status?: boolean;
  };
};

type CrearNuevaResult = {
  paso_fallido?: string;
  advertencias?: string[];
  category_id_usado?: string;
  domain_id_usado?: string;
  line_usada?: string;
  taxonomia_desde?: string;
  model_usado?: string;
  prediccion_categoria?: {
    ok?: boolean;
    category_id?: string;
    category_name?: string;
    domain_id?: string;
    line?: string;
  };
  publicacion?: {
    ok: boolean;
    item_id?: string;
    permalink?: string;
    status?: string;
    error?: string;
    fotos_enviadas?: number;
    fotos_en_item?: number;
  };
  seguimiento?: {
    item_id: string;
    sku: string;
    nombre: string;
    permalink?: string;
  };
  revision_inicial?: {
    alerta?: boolean;
    revision?: { status: string; nivel_riesgo: string };
  };
  contenido_generado?: ContenidoGenerado;
};

type WatchEntry = {
  id: string;
  item_id: string;
  sku: string;
  nombre: string;
  permalink?: string;
  url_meli?: string;
  item_origen_id?: string;
  origen?: "desde_cero" | "reemplazo" | string;
  estado_actual: string;
  sub_status?: string[];
  nivel_riesgo?: string;
  ultima_revision?: string;
  creado_en?: string;
  categoria_catalogo?: string;
  seguimiento_activo?: boolean;
  precio?: number;
  presentacion?: string;
  perfil?: string;
  notas?: string;
};

function formatFechaCorta(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Historial de publicaciones creadas desde cero (watchlist origen=desde_cero). */
function HistorialCrearDesdeCero({
  onDuplicar,
  duplicandoId,
}: {
  onDuplicar?: (entry: WatchEntry) => void;
  duplicandoId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { data, refetch, isFetching } = useQuery<{
    publicaciones: WatchEntry[];
    total: number;
    ultima_revision_global?: string;
  }>({
    queryKey: ["meli-compliance-watchlist", "desde_cero"],
    queryFn: () => api.get("/api/meli/compliance/watchlist?activos=0&origen=desde_cero"),
    staleTime: 15_000,
  });

  const revisarMut = useMutation({
    mutationFn: () =>
      api.post("/api/meli/compliance/watchlist/revisar", { whatsapp: false }, { timeoutMs: 120_000 }),
    onSuccess: () => {
      void refetch();
    },
  });

  const eliminarMut = useMutation({
    mutationFn: (entry: WatchEntry) =>
      api.post<{ ok: boolean; error?: string; nota?: string; item_id?: string }>(
        "/api/meli/compliance/watchlist/eliminar",
        { item_id: entry.item_id, id: entry.id },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meli-compliance-watchlist"] });
      void queryClient.invalidateQueries({ queryKey: ["meli-compliance-reemplazos"] });
    },
  });

  const pubs = data?.publicaciones ?? [];
  const eliminandoKey =
    eliminarMut.isPending && eliminarMut.variables
      ? eliminarMut.variables.id || eliminarMut.variables.item_id
      : null;

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-ink">Historial · creadas desde cero</p>
          <p className="mt-0.5 text-[10px] text-muted">
            Publicaciones generadas en este panel. «Eliminar» solo quita del historial (no cierra en MeLi).
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="text-[11px] font-semibold text-muted underline disabled:opacity-40"
          >
            {isFetching ? "…" : "Actualizar"}
          </button>
          <button
            type="button"
            onClick={() => revisarMut.mutate()}
            disabled={revisarMut.isPending}
            className="text-[11px] font-semibold text-teal-800 underline disabled:opacity-40"
          >
            {revisarMut.isPending ? "Revisando…" : "Revisar estados"}
          </button>
        </div>
      </div>

      {eliminarMut.isError && (
        <p className="text-[11px] text-red-700">
          {eliminarMut.error instanceof Error ? eliminarMut.error.message : "No se pudo eliminar"}
        </p>
      )}

      {pubs.length === 0 ? (
        <p className="text-[11px] text-muted">
          Aún no hay creaciones desde cero. Al publicar aquí, aparecerán en esta lista.
        </p>
      ) : (
        <div className="space-y-2">
          {pubs.map((p) => {
            const url = p.url_meli || meliUrl(p.permalink, p.item_id);
            const badge = estadoMeliBadge(p.estado_actual, p.sub_status);
            const cargando = duplicandoId === p.item_id;
            const key = p.id || p.item_id;
            const eliminando = eliminandoKey === key || eliminandoKey === p.item_id;
            return (
              <div
                key={key}
                className="rounded-xl border border-border bg-surface-input px-3 py-2.5 space-y-1.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{p.nombre}</p>
                    <p className="font-mono text-[10px] text-muted">
                      {(p.sku || "sin-sku") + " · " + p.item_id}
                      {p.presentacion ? ` · ${p.presentacion}` : ""}
                    </p>
                    <p className="text-[10px] text-muted">
                      Creada: {formatFechaCorta(p.creado_en)}
                      {p.precio && p.precio > 0
                        ? ` · $${Number(p.precio).toLocaleString("es-CO")}`
                        : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <MeliLinkButton url={url} label="Abrir en MeLi" compact />
                  {onDuplicar && (
                    <button
                      type="button"
                      disabled={Boolean(duplicandoId) || eliminarMut.isPending}
                      onClick={() => onDuplicar(p)}
                      className="inline-flex items-center rounded-lg border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-900 hover:bg-teal-100 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-950/60 disabled:opacity-40"
                    >
                      {cargando ? "Duplicando…" : "⎘ Duplicar"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={eliminarMut.isPending}
                    onClick={() => {
                      const ok = window.confirm(
                        `¿Quitar «${p.nombre}» (${p.item_id}) del historial?\n\nEsto no cierra la publicación en Mercado Libre.`,
                      );
                      if (ok) eliminarMut.mutate(p);
                    }}
                    className="inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-800 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60 disabled:opacity-40"
                  >
                    {eliminando ? "Eliminando…" : "Eliminar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PERFILES = [
  { value: "materia_prima_alimentaria", label: "Materia prima alimentaria", emoji: "🌾" },
  { value: "insumo_cosmetico", label: "Insumo cosmético", emoji: "🧴" },
  { value: "insumo_tecnico", label: "Insumo técnico / industrial", emoji: "⚙️" },
];

// ── Badge de nivel de riesgo ───────────────────────────────────────────────

function RiskBadge({ nivel, score }: { nivel: string; score: number }) {
  const cfg = {
    bajo:  { bg: "bg-green-100 border-green-300 dark:bg-green-950/50 dark:border-green-700",  text: "text-green-800 dark:text-green-300",  dot: "bg-green-500",  label: "Bajo" },
    medio: { bg: "bg-yellow-100 border-yellow-300 dark:bg-yellow-950/45 dark:border-yellow-700", text: "text-yellow-800 dark:text-yellow-200", dot: "bg-yellow-500", label: "Medio" },
    alto:  { bg: "bg-red-100 border-red-300 dark:bg-red-950/50 dark:border-red-700",       text: "text-red-800 dark:text-red-300",    dot: "bg-red-500",    label: "Alto" },
  }[nivel] ?? { bg: "bg-gray-100 border-gray-300", text: "text-gray-700", dot: "bg-gray-400", label: nivel };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${cfg.bg} ${cfg.text}`}>
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      Riesgo {cfg.label} · {score}/10
    </span>
  );
}

// ── Checklist ─────────────────────────────────────────────────────────────

function ChecklistGrid({ checklist }: { checklist: Record<string, boolean> }) {
  const labels: Record<string, string> = {
    titulo_nombre_quimico_correcto: "Nombre químico correcto",
    titulo_incluye_materia_prima:   "Título incluye 'Materia Prima'",
    sin_claims_salud:               "Sin claims de salud",
    incluye_res_2674:               "Incluye Res. 2674",
    domain_correcto:                "Domain MCO-SUPPLEMENTS",
    line_correcto:                  "LINE ≠ Sal",
    sin_farma:                      "Sin grado farmacológico",
    sin_dosis:                      "Sin lenguaje de dosis/consumo",
    pie_legal_presente:             "Pie legal McKenna",
    una_publicacion_sku:            "Una publicación por SKU",
  };
  const entries = Object.entries(checklist);
  const ok = entries.filter(([, v]) => v).length;

  return (
    <div>
      <p className="mb-2 text-xs font-bold text-ink">
        Checklist de compliance — {ok}/{entries.length} ítems ✓
      </p>
      <div className="grid grid-cols-2 gap-1">
        {entries.map(([k, v]) => (
          <div key={k} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold ${v ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"}`}>
            <span>{v ? "✓" : "✗"}</span>
            <span className="truncate">{labels[k] ?? k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function esProhibida(item: ItemPausado) {
  return (item.sub_status ?? []).includes("forbidden");
}

function esEnRevision(item: ItemPausado) {
  return item.status === "under_review";
}

/** MeLi bloquea edición por API: hay que crear publicación nueva. */
function requierePublicacionNueva(item: ItemPausado) {
  return esProhibida(item) || esEnRevision(item);
}

function tituloLista(item: ItemPausado) {
  return item.nombre_catalogo || item.title;
}

function ItemBadges({ item, compact = false }: { item: ItemPausado; compact?: boolean }) {
  const statusColor: Record<string, string> = {
    paused:       compact ? "bg-yellow-100 text-yellow-800" : "text-yellow-700 bg-yellow-100",
    closed:       compact ? "bg-gray-100 text-gray-700" : "text-gray-600 bg-gray-100",
    under_review: compact ? "bg-orange-100 text-orange-800" : "text-orange-700 bg-orange-100",
  };
  const statusLabel: Record<string, string> = {
    paused:       "Pausado",
    closed:       "Cerrado",
    under_review: "En revisión",
  };

  return (
    <div className={`flex flex-wrap items-center gap-${compact ? "1.5" : "2"} ${compact ? "mt-1" : "mt-1.5"}`}>
      {esProhibida(item) && (
        <span className={`rounded-full bg-red-100 font-bold text-red-800 ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10px]"}`}>
          Prohibida · política MeLi
        </span>
      )}
      <span className={`rounded-full font-bold ${statusColor[item.status] ?? "bg-gray-100 text-gray-600"} ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10px]"}`}>
        {statusLabel[item.status] ?? item.status}
      </span>
      {item.categoria_catalogo && (
        <span className={`rounded-full bg-teal-50 font-semibold text-teal-800 dark:bg-teal-950/45 dark:text-teal-200 ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10px]"}`}>
          {item.categoria_catalogo}
        </span>
      )}
      {item.sku && (
        <span className={`font-mono text-muted ${compact ? "text-[10px]" : "text-[11px]"}`}>{item.sku}</span>
      )}
      {!compact && (
        <>
          <span className="text-[11px] font-mono text-muted">{item.item_id}</span>
          {item.domain_id && (
            <span className="text-[11px] text-muted">{item.domain_id}</span>
          )}
        </>
      )}
    </div>
  );
}

function inferirPresentacion(item: ItemPausado): string {
  for (const src of [item.nombre_catalogo, item.title, item.sku]) {
    if (!src) continue;
    const m = src.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
    if (m) return `${m[1].replace(",", ".")}${m[2].toLowerCase()}`;
  }
  const skuEnd = item.sku?.match(/(\d+)g$/i);
  if (skuEnd) return `${skuEnd[1]}g`;
  return "250g";
}

function nombreProducto(item: ItemPausado): string {
  return item.nombre_catalogo || item.title;
}

// ── Panel de item pausado (derecha) ────────────────────────────────────────

function ItemWorkspace({ item, onDone }: { item: ItemPausado; onDone: () => void }) {
  const [perfil, setPerfil] = useState("materia_prima_alimentaria");
  const [presentacion, setPresentacion] = useState(() => inferirPresentacion(item));
  const [precio, setPrecio] = useState(() => {
    if (item.price > 0) return String(item.price);
    // Publicaciones prohibidas a veces llegan sin precio en el listado
    return "";
  });
  const [fichaTecnica, setFichaTecnica] = useState("");
  const [usarFichaBiblioteca, setUsarFichaBiblioteca] = useState(true);
  const [archivoFicha, setArchivoFicha] = useState("");
  const [fichaAutoOk, setFichaAutoOk] = useState(false);
  const [fotoUrlNueva, setFotoUrlNueva] = useState("");
  const [fotosNuevas, setFotosNuevas] = useState<FotoNueva[]>([]);
  const [subiendoFotos, setSubiendoFotos] = useState(false);
  const [errorFotos, setErrorFotos] = useState<string | null>(null);
  const [dropFotosActivo, setDropFotosActivo] = useState(false);
  const [dragFotoId, setDragFotoId] = useState<string | null>(null);
  const [tituloEditado, setTituloEditado] = useState("");
  const [descEditada, setDescEditada] = useState("");
  const [step, setStep] = useState<"idle" | "generando" | "listo" | "publicando" | "creando_nueva" | "done" | "done_nueva">("idle");
  const [resultado, setResultado] = useState<ResultadoRepublicacion | null>(null);
  const [resultadoNueva, setResultadoNueva] = useState<CrearNuevaResult | null>(null);

  const productoNombre = nombreProducto(item);

  // Diagnóstico inicial (automático al montar)
  const { data: diag } = useQuery<Diagnostico>({
    queryKey: ["compliance-diag", item.item_id],
    queryFn: () =>
      api.post("/api/meli/compliance/diagnosticar", {
        sku: item.sku,
        nombre: productoNombre,
        titulo_meli: item.title,
        atributos_meli: { domain_id: item.domain_id, LINE: item.line ?? "" },
      }),
    staleTime: Infinity,
  });

  const { data: fotosItem } = useQuery({
    queryKey: ["compliance-fotos", item.item_id],
    queryFn: () =>
      api.get<{
        ok: boolean;
        puede_fotos: boolean;
        imagenes: { id: string; url: string; principal: boolean }[];
        error?: string;
      }>(`/api/meli/compliance/fotos?item_id=${encodeURIComponent(item.item_id)}`),
    staleTime: 30_000,
  });

  // Si hay fotos actuales y aún no eligió renovada, usar la principal como default
  useEffect(() => {
    if (fotoUrlNueva) return;
    const principal = fotosItem?.imagenes?.find((i) => i.principal)?.url
      || fotosItem?.imagenes?.[0]?.url;
    if (principal) setFotoUrlNueva(principal);
  }, [fotosItem, fotoUrlNueva]);

  const { data: bibliotecaData, isLoading: cargandoBiblioteca } = useQuery({
    queryKey: ["fichas-biblioteca"],
    queryFn: () => api.get<{ archivos: ArchivoBiblioteca[] }>("/api/fichas/biblioteca"),
    staleTime: 60_000,
  });

  const fichasBiblioteca = useMemo(() => {
    const archivos = (bibliotecaData?.archivos ?? []).filter((a) => a.tipo === "pdf");
    const coincidentes = archivos.filter((a) =>
      coincideFichaBiblioteca(productoNombre, a.nombre)
      || (item.sku ? coincideFichaBiblioteca(item.sku, a.nombre) : false),
    );
    return coincidentes.length > 0 ? coincidentes : archivos;
  }, [bibliotecaData, productoNombre, item.sku]);

  const hayCoincidenciaExacta = useMemo(() => {
    return (bibliotecaData?.archivos ?? []).some(
      (a) =>
        a.tipo === "pdf" &&
        (coincideFichaBiblioteca(productoNombre, a.nombre)
          || (item.sku ? coincideFichaBiblioteca(item.sku, a.nombre) : false)),
    );
  }, [bibliotecaData, productoNombre, item.sku]);

  // Auto-seleccionar ficha coincidente de la biblioteca
  useEffect(() => {
    if (!usarFichaBiblioteca || archivoFicha || !fichasBiblioteca.length) return;
    const match = fichasBiblioteca.find(
      (a) =>
        coincideFichaBiblioteca(productoNombre, a.nombre)
        || (item.sku ? coincideFichaBiblioteca(item.sku, a.nombre) : false),
    );
    if (match) setArchivoFicha(match.nombre);
  }, [usarFichaBiblioteca, fichasBiblioteca, archivoFicha, productoNombre, item.sku]);

  // Cargar datos de la ficha seleccionada → texto para la IA
  useEffect(() => {
    if (!usarFichaBiblioteca || !archivoFicha) {
      if (!usarFichaBiblioteca) {
        setFichaAutoOk(false);
      }
      return;
    }
    let cancelado = false;
    setFichaAutoOk(false);
    void (async () => {
      try {
        const r = await api.get<BibliotecaDatosResult>(
          `/api/fichas/biblioteca/datos?archivo=${encodeURIComponent(archivoFicha)}`,
        );
        if (cancelado) return;
        const texto = datosFichaATexto(r.datos || { titulo: r.titulo });
        setFichaTecnica(texto);
        setFichaAutoOk(Boolean(texto.trim()));
      } catch {
        if (!cancelado) setFichaAutoOk(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [usarFichaBiblioteca, archivoFicha]);

  const generarMut = useMutation({
    mutationFn: () =>
      api.post<ContenidoGenerado>(
        "/api/meli/compliance/generar",
        {
          sku: item.sku,
          nombre: productoNombre,
          presentacion,
          perfil,
          ficha_tecnica: fichaTecnica,
          titulo_actual: item.title,
          descripcion_actual: "",
        },
        { timeoutMs: 120_000 },
      ),
    onSuccess: (data) => {
      if (!data.error) {
        setTituloEditado(data.titulo ?? "");
        setDescEditada(data.descripcion ?? "");
        setStep("listo");
      }
    },
  });

  const republicarMut = useMutation({
    mutationFn: () =>
      api.post<ResultadoRepublicacion>(
        "/api/meli/compliance/republicar",
        {
          item_id: item.item_id,
          sku: item.sku,
          nombre: productoNombre,
          presentacion,
          precio: parseFloat(precio) || 0,
          perfil,
          ficha_tecnica: fichaTecnica,
        },
        { timeoutMs: 120_000 },
      ),
    onSuccess: (data) => {
      setResultado(data);
      setStep("done");
    },
  });

  const crearNuevaMut = useMutation({
    mutationFn: () =>
      api.post<CrearNuevaResult>(
        "/api/meli/compliance/crear-nueva",
        {
          sku: item.sku,
          nombre: productoNombre,
          presentacion,
          precio: parseFloat(precio) || item.price || 0,
          perfil,
          ficha_tecnica: fichaTecnica,
          titulo_actual: item.title,
          item_origen_id: item.item_id,
          categoria_catalogo: item.categoria_catalogo ?? "",
          referencia: "citrato_magnesio",
          foto_url: fotoUrlNueva || undefined,
          foto_urls: ordenarFotoUrls(fotosNuevas, fotoUrlNueva),
          contenido_generado:
            generarMut.data && !generarMut.data.error ? generarMut.data : undefined,
        },
        { timeoutMs: 120_000 },
      ),
    onSuccess: (data) => {
      setResultadoNueva(data);
      setStep("done_nueva");
    },
  });

  async function handleSubirFotos(files: FileList | File[] | null) {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;
    const lista = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (lista.length === 0) {
      setErrorFotos("Solo se aceptan imágenes (JPEG, PNG, WebP)");
      return;
    }
    setSubiendoFotos(true);
    setErrorFotos(null);
    try {
      const form = new FormData();
      for (const f of lista) form.append("files[]", f);
      form.append("item_id", item.item_id);
      // Si MeLi bloquea pictures, solo CDN; si permite, intenta adjuntar
      if (fotosItem && fotosItem.puede_fotos === false) {
        form.append("solo_cdn", "1");
      }
      const r = await api.upload<{
        ok: boolean;
        urls: string[];
        archivos: {
          filename?: string;
          ok?: boolean;
          url?: string;
          adjuntada?: boolean;
          nota?: string;
          error?: string;
          error_adjuntar?: string;
        }[];
      }>("/api/meli/compliance/subir-foto", form);

      const okOnes = (r.archivos || []).filter((a) => a.ok && a.url);
      if (okOnes.length === 0) {
        const err = r.archivos?.[0]?.error || "No se pudo subir la foto";
        setErrorFotos(err);
        return;
      }
      const nuevas: FotoNueva[] = okOnes.map((a, i) => ({
        id: `up-${Date.now()}-${i}-${a.url}`,
        url: a.url!,
        filename: a.filename,
        adjuntada: a.adjuntada,
        nota: a.nota || a.error_adjuntar,
      }));
      setFotosNuevas((prev) => [...nuevas, ...prev]);
      // La primera subida pasa a ser la foto principal para crear nueva
      if (nuevas[0]?.url) setFotoUrlNueva(nuevas[0].url);
    } catch (e) {
      setErrorFotos(e instanceof Error ? e.message : "Error al subir fotos");
    } finally {
      setSubiendoFotos(false);
    }
  }

  function eliminarFotoNueva(id: string) {
    setFotosNuevas((prev) => {
      const next = prev.filter((f) => f.id !== id);
      const eliminada = prev.find((f) => f.id === id);
      if (eliminada && fotoUrlNueva === eliminada.url) {
        setFotoUrlNueva(next[0]?.url || fotosItem?.imagenes?.[0]?.url || "");
      }
      return next;
    });
  }

  function reordenarFotoNueva(fromId: string, toId: string) {
    if (fromId === toId) return;
    setFotosNuevas((prev) => {
      const from = prev.findIndex((f) => f.id === fromId);
      const to = prev.findIndex((f) => f.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // La primera del orden es la principal para la publicación nueva
      if (next[0]?.url) setFotoUrlNueva(next[0].url);
      return next;
    });
  }

  function handleGenerar() {
    setStep("generando");
    generarMut.mutate();
  }

  function handleRepublicar() {
    setStep("publicando");
    republicarMut.mutate();
  }

  function handleCrearNueva() {
    setStep("creando_nueva");
    crearNuevaMut.mutate();
  }

  const precioValido = parseFloat(precio) > 0 || item.price > 0 || requierePublicacionNueva(item);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink leading-tight">{tituloLista(item)}</p>
          {item.nombre_catalogo && item.title !== item.nombre_catalogo && (
            <p className="mt-0.5 truncate text-[11px] text-muted">MeLi: {item.title}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ItemBadges item={item} compact />
            {item.permalink && (
              <a href={item.permalink} target="_blank" rel="noopener noreferrer"
                className="text-[11px] font-semibold text-blue-600 underline">
                Ver en MeLi ↗
              </a>
            )}
          </div>
        </div>
        <button onClick={onDone}
          className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-ink">
          ✕
        </button>
      </div>

      {/* Diagnóstico */}
      {diag && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-ink">Diagnóstico de riesgo</p>
            <RiskBadge nivel={diag.nivel} score={diag.score} />
          </div>

          {diag.señales.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-muted">
                Palabras/frases de riesgo detectadas ({diag.señales.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {diag.señales.map((s) => (
                  <span key={s} className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {diag.advertencias_taxonomia.length > 0 && (
            <div className="space-y-1">
              {diag.advertencias_taxonomia.map((a, i) => (
                <p key={i} className="rounded-lg bg-orange-50 px-3 py-1.5 text-[11px] text-orange-800 dark:text-orange-300">
                  ⚠ {a}
                </p>
              ))}
            </div>
          )}

          {diag.recomendaciones.length > 0 && (
            <ul className="space-y-1">
              {diag.recomendaciones.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] text-ink-secondary">
                  <span className="mt-0.5 shrink-0 text-accent">→</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Aviso publicación bloqueada (prohibida o en revisión) */}
      {requierePublicacionNueva(item) && step !== "done" && step !== "done_nueva" && (
        <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 space-y-1.5 dark:border-orange-700 dark:bg-orange-950/35">
          <p className="text-xs font-bold text-orange-900">
            {esEnRevision(item)
              ? "Publicación en revisión — MeLi bloquea ediciones por API"
              : "Publicación prohibida — crear una nueva"}
          </p>
          <p className="text-[11px] leading-relaxed text-orange-800">
            {esEnRevision(item) ? (
              <>
                Mientras el ítem está <strong>under_review</strong>, MeLi no deja cambiar título,
                atributos, precio ni reactivar por API. El camino recomendado es{" "}
                <strong>crear una publicación nueva</strong> compliant y dejarla en{" "}
                <strong>seguimiento diario</strong>.
              </>
            ) : (
              <>
                MeLi no deja corregir título, foto ni reactivar esta publicación por API.
                El camino recomendado es <strong>crear una publicación nueva</strong> (modelo competidor activo:
                nombre químico, MCO8830, LINE materias primas) y dejarla en <strong>seguimiento diario</strong>.
              </>
            )}
          </p>
        </div>
      )}

      {/* Formulario de corrección */}
      {step !== "done" && (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-bold text-ink">Configuración para republicar</p>

          {/* Perfil */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted">Perfil del producto</label>
            <div className="grid grid-cols-3 gap-2">
              {PERFILES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPerfil(p.value)}
                  className={`rounded-xl border-2 px-2 py-2.5 text-center text-[11px] font-semibold transition ${
                    perfil === p.value
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted hover:border-accent/30 hover:text-ink"
                  }`}
                >
                  <span className="block text-lg">{p.emoji}</span>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Presentación y precio */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted">Presentación</label>
              <input
                value={presentacion}
                onChange={(e) => setPresentacion(e.target.value)}
                placeholder="250g, 500g, 1kg…"
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted">Precio MeLi (COP)</label>
              <input
                type="number"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="25000"
                min={0}
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Ficha técnica — conectada a biblioteca de docs técnicos */}
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface-input/60 px-3 py-2.5">
              <input
                type="checkbox"
                checked={usarFichaBiblioteca}
                onChange={(e) => {
                  const on = e.target.checked;
                  setUsarFichaBiblioteca(on);
                  if (!on) {
                    setArchivoFicha("");
                    setFichaTecnica("");
                    setFichaAutoOk(false);
                  }
                }}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold text-ink">
                  Ficha técnica de la biblioteca de docs técnicos
                </span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                  Usa el documento ya generado en Docs técnicos. La IA filtra claims de salud automáticamente.
                </span>
              </span>
            </label>

            {usarFichaBiblioteca ? (
              <div className="space-y-2">
                <select
                  value={archivoFicha}
                  onChange={(e) => setArchivoFicha(e.target.value)}
                  disabled={cargandoBiblioteca || fichasBiblioteca.length === 0}
                  className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
                >
                  <option value="">
                    {cargandoBiblioteca
                      ? "Cargando biblioteca…"
                      : fichasBiblioteca.length === 0
                        ? "No hay fichas en la biblioteca"
                        : "Selecciona una ficha…"}
                  </option>
                  {fichasBiblioteca.map((a) => (
                    <option key={a.nombre} value={a.nombre}>
                      {tituloDesdeArchivoBiblioteca(a.nombre)}
                      {hayCoincidenciaExacta
                      && (coincideFichaBiblioteca(productoNombre, a.nombre)
                        || (item.sku ? coincideFichaBiblioteca(item.sku, a.nombre) : false))
                        ? " · coincidencia"
                        : ""}
                    </option>
                  ))}
                </select>
                {fichaAutoOk && (
                  <p className="rounded-lg bg-green-50 px-3 py-1.5 text-[11px] text-green-800 dark:bg-green-950/40 dark:text-green-300">
                    ✓ Datos cargados desde la biblioteca
                    {archivoFicha ? ` · ${tituloDesdeArchivoBiblioteca(archivoFicha)}` : ""}
                  </p>
                )}
                {!hayCoincidenciaExacta && fichasBiblioteca.length > 0 && (
                  <p className="text-[10px] text-muted">
                    No hay coincidencia automática con «{productoNombre}». Elige la ficha manualmente o genérala en Docs técnicos.
                  </p>
                )}
                {fichaTecnica && (
                  <textarea
                    value={fichaTecnica}
                    onChange={(e) => setFichaTecnica(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-border bg-surface-input px-3 py-2 text-xs text-ink outline-none focus:border-accent"
                  />
                )}
              </div>
            ) : (
              <textarea
                value={fichaTecnica}
                onChange={(e) => setFichaTecnica(e.target.value)}
                rows={3}
                placeholder="Pega aquí datos de la ficha técnica (opcional)."
                className="w-full resize-y rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
              />
            )}
          </div>

          {/* Renovar fotos */}
          <div className="space-y-2 rounded-xl border border-border bg-surface-input/40 p-3">
            <div>
              <p className="text-[11px] font-bold text-ink">Renovar fotos</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
                {fotosItem?.puede_fotos === false
                  ? "Este ítem no deja cambiar fotos por API. Arrastra la etiqueta alternativa aquí (CDN) y úsala al crear la publicación nueva."
                  : "Arrastra fotos aquí o elígelas. La primera es la principal para la publicación nueva."}
              </p>
            </div>

            {/* Zona drag & drop */}
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer.types.includes("Files")) setDropFotosActivo(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer.types.includes("Files")) {
                  e.dataTransfer.dropEffect = "copy";
                  setDropFotosActivo(true);
                }
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDropFotosActivo(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropFotosActivo(false);
                const files = e.dataTransfer.files;
                if (files?.length) void handleSubirFotos(files);
              }}
              className={`rounded-xl border-2 border-dashed px-3 py-5 text-center transition ${
                dropFotosActivo
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface hover:border-accent/40"
              } ${subiendoFotos ? "opacity-60" : ""}`}
            >
              {subiendoFotos ? (
                <p className="text-[11px] font-semibold text-ink">Subiendo fotos…</p>
              ) : (
                <>
                  <p className="text-[11px] font-semibold text-ink">
                    Arrastra imágenes aquí
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted">JPEG, PNG o WebP · varias a la vez</p>
                  <label className="mt-2 inline-block cursor-pointer rounded-lg bg-ink px-3 py-1.5 text-[11px] font-bold text-white hover:bg-ink/90">
                    Elegir archivos
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      disabled={subiendoFotos}
                      className="hidden"
                      onChange={(e) => {
                        void handleSubirFotos(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </>
              )}
            </div>

            {errorFotos && (
              <p className="rounded-lg bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">{errorFotos}</p>
            )}

            {fotosNuevas.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted">
                  Fotos nuevas · arrastra para reordenar · ✕ para quitar
                </p>
                <div className="flex flex-wrap gap-2">
                  {fotosNuevas.map((f, i) => (
                    <div
                      key={f.id}
                      draggable
                      onDragStart={(e) => {
                        setDragFotoId(f.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/foto-id", f.id);
                      }}
                      onDragEnd={() => setDragFotoId(null)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const fromId = e.dataTransfer.getData("text/foto-id") || dragFotoId;
                        if (fromId) reordenarFotoNueva(fromId, f.id);
                        setDragFotoId(null);
                      }}
                      className={`group relative overflow-hidden rounded-lg border-2 ${
                        fotoUrlNueva === f.url ? "border-accent" : "border-border"
                      } ${dragFotoId === f.id ? "opacity-50" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => setFotoUrlNueva(f.url)}
                        className="block"
                        title={f.nota || f.filename || "Usar como principal"}
                      >
                        <img src={f.url} alt="" className="h-16 w-16 object-cover" draggable={false} />
                        <span className="absolute bottom-0 left-0 right-0 bg-teal-700/90 px-1 py-0.5 text-[8px] font-bold text-white">
                          {i === 0 ? "★ principal" : f.adjuntada ? "en ítem" : `#${i + 1}`}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          eliminarFotoNueva(f.id);
                        }}
                        title="Quitar de la lista"
                        className="absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] font-bold text-white opacity-80 hover:bg-danger hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(fotosItem?.imagenes?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted">Fotos actuales del ítem</p>
                <div className="flex flex-wrap gap-2">
                  {(fotosItem?.imagenes ?? []).map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setFotoUrlNueva(img.url)}
                      className={`relative overflow-hidden rounded-lg border-2 ${
                        fotoUrlNueva === img.url ? "border-accent" : "border-border"
                      }`}
                      title={img.principal ? "Principal actual" : img.id}
                    >
                      <img src={img.url} alt="" className="h-16 w-16 object-cover" />
                      {img.principal && (
                        <span className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5 text-[8px] font-bold text-white">
                          actual
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {fotoUrlNueva && (
              <p className="truncate text-[10px] text-muted">
                Foto para publicación nueva:{" "}
                <span className="font-mono text-ink">{fotoUrlNueva.slice(0, 72)}…</span>
              </p>
            )}
          </div>

          {/* Botón generar */}
          <button
            onClick={handleGenerar}
            disabled={step === "generando" || generarMut.isPending}
            className="w-full rounded-lg bg-accent py-3 text-sm font-bold text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            {generarMut.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Generando contenido compliant…
              </span>
            ) : (
              "✦ Generar contenido compliant con IA"
            )}
          </button>

          {generarMut.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {generarMut.error instanceof Error ? generarMut.error.message : "Error al generar"}
            </p>
          )}
          {generarMut.data?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {generarMut.data.error}
            </p>
          )}
        </div>
      )}

      {/* Contenido generado — editable */}
      {(step === "listo" || step === "publicando" || step === "creando_nueva") && generarMut.data && !generarMut.data.error && (
        <div className="space-y-4 rounded-xl border border-green-200 bg-green-50/50 p-4 dark:border-green-800/60 dark:bg-green-950/35">
          <p className="text-xs font-bold text-green-800 dark:text-green-300">Contenido generado — revisa antes de publicar</p>

          {/* Título */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Título MeLi (máx. 60 chars)</label>
            <input
              value={tituloEditado}
              onChange={(e) => setTituloEditado(e.target.value)}
              maxLength={80}
              className="w-full rounded-lg border border-green-300 dark:border-green-700 bg-surface-input px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-accent"
            />
            <p className={`mt-0.5 text-right text-[11px] ${tituloEditado.length > 60 ? "text-warning font-semibold" : "text-muted"}`}>
              {tituloEditado.length}/60 caracteres
            </p>
          </div>

          {/* Descripción */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Descripción MeLi</label>
            <textarea
              value={descEditada}
              onChange={(e) => setDescEditada(e.target.value)}
              rows={8}
              className="w-full resize-y rounded-lg border border-green-300 dark:border-green-700 bg-surface-input px-3 py-2 text-xs text-ink outline-none focus:border-accent"
            />
          </div>

          {/* Atributos */}
          {generarMut.data.atributos && (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {Object.entries(generarMut.data.atributos).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-green-200 dark:border-green-800/50 bg-surface-input px-2.5 py-1.5">
                  <span className="font-bold text-muted">{k}: </span>
                  <span className="text-ink">{v as string}</span>
                </div>
              ))}
            </div>
          )}

          {/* Checklist */}
          {generarMut.data.checklist && (
            <ChecklistGrid checklist={generarMut.data.checklist} />
          )}

          {/* Bloque etiqueta */}
          {generarMut.data.bloque_etiqueta && (
            <details className="rounded-xl border border-green-200 dark:border-green-800/50 bg-surface-input">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-ink">
                Ver texto de etiqueta alternativa →
              </summary>
              <pre className="whitespace-pre-wrap px-3 pb-3 text-[11px] leading-relaxed text-ink-secondary">
                {generarMut.data.bloque_etiqueta}
              </pre>
            </details>
          )}

          {/* Botón republicar */}
          <button
            onClick={handleRepublicar}
            disabled={
              step === "publicando"
              || republicarMut.isPending
              || (!precio && !requierePublicacionNueva(item))
            }
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-40"
          >
            {republicarMut.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Aplicando correcciones en MeLi…
              </span>
            ) : !precio && !requierePublicacionNueva(item) ? (
              "Ingresa el precio para continuar"
            ) : requierePublicacionNueva(item) ? (
              "Intentar correcciones permitidas por API (limitado)"
            ) : (
              "🚀 Corregir y republicar en MeLi"
            )}
          </button>

          {republicarMut.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {republicarMut.error instanceof Error ? republicarMut.error.message : "Error al republicar"}
            </p>
          )}

          {/* Crear publicación nueva (recomendado si prohibida) */}
          <div className="rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/60 p-3 space-y-2 dark:border-teal-700 dark:bg-teal-950/30">
            <p className="text-xs font-bold text-teal-900">
              Publicación nueva desde cero
            </p>
            <p className="text-[11px] leading-relaxed text-teal-800">
              Crea un ítem nuevo en MeLi (User Product, family_name compliant) y lo registra para
              revisión automática cada día. Sube la foto de etiqueta alternativa en MeLi tras crear.
            </p>
            <button
              onClick={handleCrearNueva}
              disabled={
                step === "creando_nueva"
                || crearNuevaMut.isPending
                || !precioValido
                || step === "publicando"
              }
              className="w-full rounded-lg bg-teal-600 py-3 text-sm font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
            >
              {crearNuevaMut.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Creando publicación nueva en MeLi…
                </span>
              ) : !precioValido ? (
                "Ingresa el precio para publicar"
              ) : (
                "✦ Crear publicación nueva + seguimiento diario"
              )}
            </button>
            {crearNuevaMut.isError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {crearNuevaMut.error instanceof Error ? crearNuevaMut.error.message : "Error al crear"}
              </p>
            )}
            {crearNuevaMut.data?.paso_fallido && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {crearNuevaMut.data.paso_fallido}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Resultado final */}
      {step === "done" && resultado && (
        <div className={`rounded-xl border p-4 space-y-3 ${
          resultado.republicacion?.ok && !resultado.republicacion?.parcial
            ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/35"
            : resultado.republicacion?.ok && resultado.republicacion?.parcial
              ? "border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/35"
              : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/35"
        }`}>
          {resultado.republicacion?.ok ? (
            <>
              <p className={`text-sm font-bold ${
                resultado.republicacion.parcial ? "text-yellow-900" : "text-green-800"
              }`}>
                {resultado.republicacion.parcial
                  ? "⚠ Correcciones parciales aplicadas"
                  : "✅ Publicación corregida y reactivada"}
              </p>
              <p className="text-xs text-ink-secondary">
                Item ID: <span className="font-mono">{resultado.republicacion.item_id}</span>
              </p>
              {(resultado.republicacion.aplicado?.length ?? 0) > 0 && (
                <p className="text-xs text-green-800">
                  Actualizado por API: {resultado.republicacion.aplicado?.join(", ")}
                </p>
              )}
              {(resultado.republicacion.acciones_manuales?.length ?? 0) > 0 && (
                <ul className="space-y-1.5 rounded-lg border border-yellow-200 dark:border-yellow-800/50 bg-surface-input px-3 py-2">
                  {resultado.republicacion.acciones_manuales?.map((a, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-yellow-900">
                      → {a}
                    </li>
                  ))}
                </ul>
              )}
              {resultado.republicacion.descripcion_para_pegar && (
                <details className="rounded-xl border border-yellow-200 dark:border-yellow-800/50 bg-surface-input" open>
                  <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-ink">
                    Descripción para pegar en MeLi →
                  </summary>
                  <pre className="whitespace-pre-wrap px-3 pb-3 text-[11px] leading-relaxed text-ink-secondary">
                    {resultado.republicacion.descripcion_para_pegar}
                  </pre>
                </details>
              )}
              {resultado.contenido_generado?.checklist && (
                <ChecklistGrid checklist={resultado.contenido_generado.checklist} />
              )}
              {resultado.republicacion.parcial && requierePublicacionNueva(item) && (
                <p className="text-[11px] font-semibold text-yellow-900">
                  Siguiente paso: usa «Crear publicación nueva» (arriba) para publicar desde cero con seguimiento diario.
                </p>
              )}
              <button
                onClick={onDone}
                className="mt-2 w-full rounded-lg border border-border bg-surface-input py-2 text-sm font-semibold text-ink transition hover:bg-surface-hover"
              >
                Volver a la lista
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-red-800">No se pudo editar este ítem por API</p>
              <p className="text-xs text-red-700">
                {resultado.paso_fallido ?? resultado.republicacion?.error ?? "Error desconocido"}
              </p>
              {(resultado.republicacion?.acciones_manuales?.length ?? 0) > 0 && (
                <ul className="space-y-1 rounded-lg bg-orange-50 px-3 py-2 dark:bg-orange-950/35">
                  {resultado.republicacion!.acciones_manuales!.map((a, i) => (
                    <li key={i} className="text-[11px] text-orange-900 dark:text-orange-200">→ {a}</li>
                  ))}
                </ul>
              )}
              {requierePublicacionNueva(item) && (
                <p className="text-[11px] font-semibold text-teal-800">
                  Usa el botón «Crear publicación nueva + seguimiento diario» (vuelve a Generar si hace falta).
                </p>
              )}
              <button
                onClick={() => setStep("listo")}
                className="w-full rounded-lg border border-red-300 dark:border-red-800/50 bg-surface-input py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                Volver al contenido generado
              </button>
            </>
          )}
        </div>
      )}

      {/* Publicación nueva creada */}
      {step === "done_nueva" && resultadoNueva && (
        <div className={`rounded-xl border p-4 space-y-3 ${
          resultadoNueva.publicacion?.ok ? "border-teal-300 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/35" : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/35"
        }`}>
          {resultadoNueva.publicacion?.ok ? (
            <>
              <p className="text-sm font-bold text-teal-900 dark:text-teal-200">✅ Publicación nueva creada en MeLi</p>
              <p className="text-xs text-teal-800 dark:text-teal-300">
                Item ID: <span className="font-mono">{resultadoNueva.publicacion.item_id}</span>
              </p>
              {resultadoNueva.publicacion.permalink && (
                <a
                  href={meliUrl(resultadoNueva.publicacion.permalink, resultadoNueva.publicacion.item_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-teal-500 bg-teal-600 py-2.5 text-sm font-bold text-white hover:bg-teal-700"
                >
                  ↗ Abrir publicación en MeLi para verificar
                </a>
              )}
              <p className="text-[11px] text-teal-800 dark:text-teal-300">
                Estado inicial: {resultadoNueva.revision_inicial?.revision?.status ?? resultadoNueva.publicacion.status ?? "—"}
                {resultadoNueva.revision_inicial?.revision?.nivel_riesgo && (
                  <> · Riesgo {resultadoNueva.revision_inicial.revision.nivel_riesgo}</>
                )}
              </p>
              <p className="text-[11px] leading-relaxed text-teal-900 dark:text-teal-100">
                Quedó en <strong>seguimiento diario</strong> (cron 8:30 + alerta WhatsApp si MeLi la bloquea).
                Sube la <strong>foto de etiqueta alternativa</strong> en MeLi lo antes posible.
              </p>
              {(resultadoNueva.advertencias ?? []).length > 0 && (
                <ul className="space-y-1 text-[11px] text-orange-800 dark:text-orange-300">
                  {(resultadoNueva.advertencias ?? []).map((a, i) => (
                    <li key={i}>⚠ {a}</li>
                  ))}
                </ul>
              )}
              <button onClick={onDone} className="w-full rounded-lg border border-teal-400 dark:border-teal-700 bg-surface-input py-2 text-sm font-semibold text-teal-900 hover:bg-teal-100 dark:text-teal-200 dark:hover:bg-teal-950/40">
                Volver a la lista
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-red-800">Error al crear publicación</p>
              <p className="text-xs text-red-700">
                {resultadoNueva.paso_fallido ?? resultadoNueva.publicacion?.error ?? "Error desconocido"}
              </p>
              <button onClick={() => setStep("listo")} className="w-full rounded-lg border border-red-300 dark:border-red-800/50 bg-surface-input py-2 text-sm font-semibold text-red-800 dark:text-red-300">
                Reintentar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ComplianceWatchlist() {
  const { data, refetch, isFetching } = useQuery<{
    publicaciones: WatchEntry[];
    total: number;
    ultima_revision_global?: string;
  }>({
    queryKey: ["meli-compliance-watchlist"],
    queryFn: () => api.get("/api/meli/compliance/watchlist?activos=0"),
    staleTime: 30_000,
  });

  const revisarMut = useMutation({
    mutationFn: () =>
      api.post("/api/meli/compliance/watchlist/revisar", { whatsapp: false }, { timeoutMs: 120_000 }),
    onSuccess: () => refetch(),
  });

  const pubs = data?.publicaciones ?? [];

  if (pubs.length === 0) {
    return (
      <div className="shrink-0 rounded-xl border border-dashed border-border bg-surface px-4 py-3">
        <p className="text-xs font-bold text-ink">Publicaciones de reemplazo</p>
        <p className="mt-1 text-[11px] text-muted">
          Aún no hay publicaciones nuevas en seguimiento. Al crear una con «Crear publicación nueva»,
          aparecerá aquí con enlace directo a MeLi.
        </p>
      </div>
    );
  }

  return (
    <div className="shrink-0 rounded-xl border border-teal-200 bg-teal-50/50 p-4 space-y-3 dark:border-teal-800/50 dark:bg-teal-950/30">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-teal-900">
            Publicaciones de reemplazo creadas ({pubs.length})
          </p>
          <p className="text-[10px] text-teal-800">
            Enlaces directos para verificar en MeLi si siguen activas o las bajaron.
          </p>
        </div>
        <button
          onClick={() => revisarMut.mutate()}
          disabled={revisarMut.isPending || isFetching}
          className="shrink-0 text-[11px] font-semibold text-teal-800 underline disabled:opacity-40"
        >
          {revisarMut.isPending ? "Revisando…" : "Revisar ahora"}
        </button>
      </div>
      {data?.ultima_revision_global && (
        <p className="text-[10px] text-teal-700">Última revisión: {data.ultima_revision_global}</p>
      )}
      <div className="space-y-2">
        {pubs.map((p) => {
          const url = p.url_meli || meliUrl(p.permalink, p.item_id);
          const badge = estadoMeliBadge(p.estado_actual, p.sub_status);
          return (
            <div
              key={p.id}
              className="rounded-xl border border-teal-200 dark:border-teal-800/50 bg-surface-input px-3 py-2.5 space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{p.nombre}</p>
                  <p className="font-mono text-[10px] text-muted">
                    {p.sku} · {p.item_id}
                  </p>
                  {p.item_origen_id && (
                    <p className="text-[10px] text-muted">
                      Reemplaza prohibida:{" "}
                      <span className="font-mono">{p.item_origen_id}</span>
                    </p>
                  )}
                  {p.ultima_revision && (
                    <p className="text-[10px] text-muted">Revisada: {p.ultima_revision}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <MeliLinkButton url={url} label="Abrir publicación en MeLi" />
                {p.item_origen_id && (
                  <MeliLinkButton
                    url={meliUrl(undefined, p.item_origen_id)}
                    label="Ver publicación vieja"
                    compact
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Panel principal de compliance ──────────────────────────────────────────

function presentacionDesdeEan(c: CodigoEan): string {
  const p = (c.presentacion || "").replace(/\D/g, "");
  if (!p || p === "000") {
    const m = (c.sku || c.nombre_producto || "").match(/(\d+)\s*(g|kg|ml|l)\b/i);
    if (m) return `${m[1]}${m[2].toLowerCase()}`;
    return "250g";
  }
  return `${parseInt(p, 10)}g`;
}

function coincideCodigoEan(c: CodigoEan, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return (
    c.sku.toLowerCase().includes(t) ||
    (c.nombre_producto || "").toLowerCase().includes(t) ||
    c.codigo.includes(t) ||
    String(c.numero_producto).includes(t)
  );
}

/** Selector de SKU conectado al módulo Códigos EAN. */
function SkuEanCombobox({
  value,
  onChange,
  onSelectCodigo,
}: {
  value: string;
  onChange: (sku: string) => void;
  onSelectCodigo: (c: CodigoEan) => void;
}) {
  const { data: codigos, isLoading } = useCodigosEan();
  const [abierto, setAbierto] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const coincidencias = useMemo(() => {
    const list = (codigos ?? []).filter((c) => coincideCodigoEan(c, value));
    return list.slice(0, 40);
  }, [codigos, value]);

  const seleccionadoExacto = useMemo(
    () => (codigos ?? []).find((c) => c.sku.toLowerCase() === value.trim().toLowerCase()) ?? null,
    [codigos, value],
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <label className="mb-1 block text-[11px] font-semibold text-muted">
        SKU <span className="font-normal text-muted">(Códigos EAN)</span>
      </label>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        placeholder={isLoading ? "Cargando SKUs…" : "Buscar SKU o producto…"}
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
      {seleccionadoExacto && (
        <p className="mt-1 truncate text-[10px] text-teal-700">
          ✓ EAN {seleccionadoExacto.codigo}
          {seleccionadoExacto.nombre_producto ? ` · ${seleccionadoExacto.nombre_producto}` : ""}
        </p>
      )}
      {abierto && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-surface-panel shadow-paper-lg">
          {isLoading && (
            <p className="px-3 py-2 text-[11px] text-muted">Cargando códigos EAN…</p>
          )}
          {!isLoading && coincidencias.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted">
              Sin coincidencias en Códigos EAN. Puedes escribir el SKU manualmente.
            </p>
          )}
          {coincidencias.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onSelectCodigo(c);
                setAbierto(false);
              }}
              className={`flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface-hover ${
                c.sku === value ? "bg-accent/5" : ""
              }`}
            >
              <span className="font-mono text-xs font-bold text-ink">{c.sku}</span>
              <span className="truncate text-[10px] text-muted">
                {c.nombre_producto || "Sin nombre"} · EAN {c.codigo} · #{c.numero_producto}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Crear publicación desde cero (sin ítem origen) ─────────────────────────

export function CrearDesdeCeroPanel({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const formTopRef = useRef<HTMLDivElement>(null);
  const [nombre, setNombre] = useState("");
  const [sku, setSku] = useState("");
  const [presentacion, setPresentacion] = useState("250g");
  const [precio, setPrecio] = useState("");
  const [perfil, setPerfil] = useState("materia_prima_alimentaria");
  const [fichaTecnica, setFichaTecnica] = useState("");
  const [usarFichaBiblioteca, setUsarFichaBiblioteca] = useState(true);
  const [archivoFicha, setArchivoFicha] = useState("");
  const [fichaAutoOk, setFichaAutoOk] = useState(false);
  const [fotoUrlNueva, setFotoUrlNueva] = useState("");
  const [fotosNuevas, setFotosNuevas] = useState<FotoNueva[]>([]);
  const [subiendoFotos, setSubiendoFotos] = useState(false);
  const [errorFotos, setErrorFotos] = useState<string | null>(null);
  const [dropFotosActivo, setDropFotosActivo] = useState(false);
  const [dragFotoId, setDragFotoId] = useState<string | null>(null);
  const [tituloEditado, setTituloEditado] = useState("");
  const [descEditada, setDescEditada] = useState("");
  const [step, setStep] = useState<"idle" | "generando" | "listo" | "creando" | "done">("idle");
  const [resultado, setResultado] = useState<CrearNuevaResult | null>(null);
  const [eanSeleccionado, setEanSeleccionado] = useState<CodigoEan | null>(null);
  const [duplicandoId, setDuplicandoId] = useState<string | null>(null);
  const [avisoDuplicado, setAvisoDuplicado] = useState<string | null>(null);
  const [errorDuplicar, setErrorDuplicar] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [lineMeli, setLineMeli] = useState("");
  const [taxonomiaItemId, setTaxonomiaItemId] = useState("");

  const { data: bibliotecaData, isLoading: cargandoBiblioteca } = useQuery({
    queryKey: ["fichas-biblioteca"],
    queryFn: () => api.get<{ archivos: ArchivoBiblioteca[] }>("/api/fichas/biblioteca"),
    staleTime: 60_000,
  });

  const fichasBiblioteca = useMemo(() => {
    const archivos = (bibliotecaData?.archivos ?? []).filter((a) => a.tipo === "pdf");
    if (!nombre.trim()) return archivos;
    const coincidentes = archivos.filter(
      (a) =>
        coincideFichaBiblioteca(nombre, a.nombre)
        || (sku ? coincideFichaBiblioteca(sku, a.nombre) : false),
    );
    return coincidentes.length > 0 ? coincidentes : archivos;
  }, [bibliotecaData, nombre, sku]);

  const hayCoincidenciaExacta = useMemo(() => {
    if (!nombre.trim()) return false;
    return (bibliotecaData?.archivos ?? []).some(
      (a) =>
        a.tipo === "pdf" &&
        (coincideFichaBiblioteca(nombre, a.nombre)
          || (sku ? coincideFichaBiblioteca(sku, a.nombre) : false)),
    );
  }, [bibliotecaData, nombre, sku]);

  useEffect(() => {
    if (!usarFichaBiblioteca || archivoFicha || !fichasBiblioteca.length || !nombre.trim()) return;
    const match = fichasBiblioteca.find(
      (a) =>
        coincideFichaBiblioteca(nombre, a.nombre)
        || (sku ? coincideFichaBiblioteca(sku, a.nombre) : false),
    );
    if (match) setArchivoFicha(match.nombre);
  }, [usarFichaBiblioteca, fichasBiblioteca, archivoFicha, nombre, sku]);

  useEffect(() => {
    if (!usarFichaBiblioteca || !archivoFicha) {
      if (!usarFichaBiblioteca) setFichaAutoOk(false);
      return;
    }
    let cancelado = false;
    setFichaAutoOk(false);
    void (async () => {
      try {
        const r = await api.get<BibliotecaDatosResult>(
          `/api/fichas/biblioteca/datos?archivo=${encodeURIComponent(archivoFicha)}`,
        );
        if (cancelado) return;
        const texto = datosFichaATexto(r.datos || { titulo: r.titulo });
        setFichaTecnica(texto);
        setFichaAutoOk(Boolean(texto.trim()));
      } catch {
        if (!cancelado) setFichaAutoOk(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [usarFichaBiblioteca, archivoFicha]);

  const generarMut = useMutation({
    mutationFn: () =>
      api.post<ContenidoGenerado>(
        "/api/meli/compliance/generar",
        {
          sku,
          nombre: nombre.trim(),
          presentacion,
          perfil,
          ficha_tecnica: fichaTecnica,
          titulo_actual: "",
          descripcion_actual: "",
        },
        { timeoutMs: 120_000 },
      ),
    onSuccess: (data) => {
      if (!data.error) {
        setTituloEditado(data.titulo ?? "");
        setDescEditada(data.descripcion ?? "");
        setStep("listo");
        // Sin duplicado: predecir categoría MeLi (evitar forzar suplementos)
        if (!taxonomiaItemId) {
          const q = (data.titulo || `${nombre.trim()} ${presentacion}`).trim();
          void (async () => {
            try {
              const pred = await api.get<{
                ok: boolean;
                category_id?: string;
                domain_id?: string;
                category_name?: string;
                line?: string;
                model?: string;
              }>(
                `/api/meli/compliance/predecir-categoria?q=${encodeURIComponent(q)}&presentacion=${encodeURIComponent(presentacion)}&perfil=${encodeURIComponent(perfil)}`,
                { timeoutMs: 20_000 },
              );
              if (pred.ok && pred.category_id && /^[A-Z]{3}\d+$/i.test(pred.category_id)) {
                setCategoryId(pred.category_id);
                if (pred.domain_id) setDomainId(pred.domain_id);
                if (pred.line) setLineMeli(pred.line);
                setAvisoDuplicado(
                  `Categoría MeLi sugerida: ${pred.category_id}`
                    + (pred.category_name ? ` · ${pred.category_name}` : "")
                    + (pred.line ? ` · LINE ${pred.line}` : "")
                    + ". Se usará al publicar (puedes quitarla si no aplica).",
                );
              }
            } catch {
              /* si falla la predicción, el backend igual predice al crear */
            }
          })();
        }
      }
    },
  });

  const crearMut = useMutation({
    mutationFn: () =>
      api.post<CrearNuevaResult>(
        "/api/meli/compliance/crear-nueva",
        {
          sku: sku.trim(),
          nombre: nombre.trim(),
          presentacion,
          precio: parseFloat(precio) || 0,
          perfil,
          ficha_tecnica: fichaTecnica,
          foto_url: fotoUrlNueva || undefined,
          foto_urls: ordenarFotoUrls(fotosNuevas, fotoUrlNueva),
          referencia: "citrato_magnesio",
          category_id: categoryId || undefined,
          domain_id: domainId || undefined,
          line: lineMeli || undefined,
          taxonomia_item_id: taxonomiaItemId || undefined,
          contenido_generado:
            generarMut.data && !generarMut.data.error
              ? {
                  ...generarMut.data,
                  titulo: tituloEditado,
                  descripcion: descEditada,
                  // No dejar que la IA pise la categoría de la referencia
                  atributos: {
                    ...(generarMut.data.atributos || {}),
                    ...(categoryId ? { category_id: categoryId } : {}),
                    ...(domainId ? { domain_id: domainId } : {}),
                    ...(lineMeli ? { LINE: lineMeli } : {}),
                  },
                }
              : undefined,
        },
        { timeoutMs: 120_000 },
      ),
    onSuccess: (data) => {
      setResultado(data);
      setStep("done");
      void queryClient.invalidateQueries({ queryKey: ["meli-compliance-watchlist"] });
      void queryClient.invalidateQueries({ queryKey: ["meli-compliance-reemplazos"] });
    },
  });

  async function handleDuplicarDesdeHistorial(entry: WatchEntry) {
    if (!entry.item_id || duplicandoId) return;
    setDuplicandoId(entry.item_id);
    setErrorDuplicar(null);
    setAvisoDuplicado(null);
    try {
      const r = await api.get<{
        ok: boolean;
        error?: string;
        sku?: string;
        nombre?: string;
        presentacion?: string;
        precio?: number;
        perfil?: string;
        category_id?: string;
        domain_id?: string;
        line?: string;
        titulo?: string;
        descripcion?: string;
        fotos?: { picture_id?: string; url: string }[];
      }>(`/api/meli/compliance/duplicar-datos?item_id=${encodeURIComponent(entry.item_id)}`, {
        timeoutMs: 30_000,
      });

      if (!r.ok) {
        // Fallback mínimo con datos del historial
        setNombre(entry.nombre || "");
        setSku(entry.sku || "");
        setPresentacion(entry.presentacion || "250g");
        setPrecio(entry.precio && entry.precio > 0 ? String(entry.precio) : "");
        if (entry.perfil) setPerfil(entry.perfil);
        setCategoryId("");
        setDomainId("");
        setLineMeli("");
        setTaxonomiaItemId("");
        setFotosNuevas([]);
        setFotoUrlNueva("");
        setErrorDuplicar(
          r.error
            || "No se pudieron cargar fotos desde MeLi; completa SKU/nombre y sube fotos de nuevo.",
        );
      } else {
        setNombre(r.nombre || entry.nombre || "");
        setSku(r.sku || entry.sku || "");
        setPresentacion(r.presentacion || entry.presentacion || "250g");
        const p = r.precio && r.precio > 0 ? r.precio : entry.precio;
        setPrecio(p && p > 0 ? String(p) : "");
        if (r.perfil) setPerfil(r.perfil);
        else if (entry.perfil) setPerfil(entry.perfil);
        const catOk = r.category_id && /^[A-Z]{3}\d+$/i.test(r.category_id) ? r.category_id : "";
        setCategoryId(catOk);
        setDomainId(
          r.domain_id && /^[A-Z]{3}-[A-Z0-9_]+$/i.test(r.domain_id)
            ? r.domain_id
            : "",
        );
        setLineMeli(r.line || "");
        setTaxonomiaItemId(entry.item_id);
        const fotos: FotoNueva[] = (r.fotos || [])
          .filter((f) => f.url)
          .map((f, i) => ({
            id: f.picture_id || `dup-${entry.item_id}-${i}`,
            url: f.url,
            filename: f.picture_id,
            adjuntada: false,
            nota: `De ${entry.item_id}`,
          }));
        setFotosNuevas(fotos);
        setFotoUrlNueva(fotos[0]?.url || "");
        const catInfo = catOk
          ? ` · categoría ${catOk}${r.line ? ` (${r.line})` : ""}${r.domain_id ? ` · ${r.domain_id}` : ""}`
          : " · ⚠ sin category_id válido — revisa en MeLi";
        setAvisoDuplicado(
          `Borrador desde ${entry.item_id}`
            + (fotos.length ? ` · ${fotos.length} foto(s)` : "")
            + catInfo
            + ". Al publicar se relee la categoría en vivo desde esa publicación.",
        );
      }

      setEanSeleccionado(null);
      setTituloEditado("");
      setDescEditada("");
      setResultado(null);
      setStep("idle");
      generarMut.reset();
      crearMut.reset();
      setArchivoFicha("");
      window.setTimeout(() => {
        formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    } catch (e) {
      setErrorDuplicar(e instanceof Error ? e.message : "Error al duplicar");
    } finally {
      setDuplicandoId(null);
    }
  }

  async function handleSubirFotos(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    const lista = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (lista.length === 0) {
      setErrorFotos("Solo se aceptan imágenes (JPEG, PNG, WebP)");
      return;
    }
    setSubiendoFotos(true);
    setErrorFotos(null);
    try {
      const form = new FormData();
      for (const f of lista) form.append("files[]", f);
      form.append("solo_cdn", "1");
      const r = await api.upload<{
        ok: boolean;
        urls: string[];
        archivos: {
          filename?: string;
          ok?: boolean;
          url?: string;
          adjuntada?: boolean;
          nota?: string;
          error?: string;
        }[];
      }>("/api/meli/compliance/subir-foto", form);
      const okOnes = (r.archivos || []).filter((a) => a.ok && a.url);
      if (okOnes.length === 0) {
        setErrorFotos(r.archivos?.[0]?.error || "No se pudo subir la foto");
        return;
      }
      const nuevas: FotoNueva[] = okOnes.map((a, i) => ({
        id: `up-${Date.now()}-${i}-${a.url}`,
        url: a.url!,
        filename: a.filename,
        adjuntada: false,
        nota: a.nota,
      }));
      setFotosNuevas((prev) => [...nuevas, ...prev]);
      if (nuevas[0]?.url) setFotoUrlNueva(nuevas[0].url);
    } catch (e) {
      setErrorFotos(e instanceof Error ? e.message : "Error al subir fotos");
    } finally {
      setSubiendoFotos(false);
    }
  }

  function eliminarFotoNueva(id: string) {
    setFotosNuevas((prev) => {
      const next = prev.filter((f) => f.id !== id);
      const eliminada = prev.find((f) => f.id === id);
      if (eliminada && fotoUrlNueva === eliminada.url) {
        setFotoUrlNueva(next[0]?.url || "");
      }
      return next;
    });
  }

  function reordenarFotoNueva(fromId: string, toId: string) {
    if (fromId === toId) return;
    setFotosNuevas((prev) => {
      const from = prev.findIndex((f) => f.id === fromId);
      const to = prev.findIndex((f) => f.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      if (next[0]?.url) setFotoUrlNueva(next[0].url);
      return next;
    });
  }

  const precioValido = parseFloat(precio) > 0;
  const nombreOk = nombre.trim().length >= 3;
  const fotoOk = Boolean(fotoUrlNueva);
  const puedeCrear = nombreOk && precioValido && fotoOk && step === "listo";

  if (step === "done" && resultado) {
    const pub = resultado.publicacion;
    const ok = pub?.ok && !resultado.paso_fallido;
    return (
      <div className="space-y-4">
        <div className={`rounded-xl border p-4 space-y-2 ${ok ? "border-teal-200 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/35" : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/35"}`}>
          <p className={`text-sm font-bold ${ok ? "text-teal-900" : "text-red-800"}`}>
            {ok ? "✅ Publicación creada en MeLi" : "No se pudo crear la publicación"}
          </p>
          {resultado.paso_fallido && (
            <p className="text-xs text-red-700">{resultado.paso_fallido}</p>
          )}
          {pub?.error && <p className="text-xs text-red-700">{pub.error}</p>}
          {pub?.item_id && (
            <p className="text-xs text-ink">
              ID: <span className="font-mono font-semibold">{pub.item_id}</span>
              {pub.status ? ` · ${pub.status}` : ""}
            </p>
          )}
          {(resultado.category_id_usado || resultado.taxonomia_desde || resultado.prediccion_categoria) && (
            <p className="text-[11px] text-teal-900">
              Categoría publicada:{" "}
              <span className="font-mono font-semibold">{resultado.category_id_usado || "—"}</span>
              {resultado.prediccion_categoria?.category_name
                ? ` · ${resultado.prediccion_categoria.category_name}`
                : ""}
              {resultado.line_usada ? ` · ${resultado.line_usada}` : ""}
              {resultado.domain_id_usado ? ` · ${resultado.domain_id_usado}` : ""}
              {resultado.model_usado ? ` · Modelo: ${resultado.model_usado}` : ""}
              {resultado.taxonomia_desde
                ? ` (desde ${resultado.taxonomia_desde})`
                : resultado.prediccion_categoria?.ok
                  ? " (predicción MeLi)"
                  : ""}
            </p>
          )}
          {pub?.permalink && (
            <a href={meliUrl(pub.permalink, pub.item_id)} target="_blank" rel="noopener noreferrer"
              className="inline-block text-xs font-semibold text-blue-600 underline">
              Ver en MeLi ↗
            </a>
          )}
          {(resultado.advertencias?.length ?? 0) > 0 && (
            <ul className="space-y-1">
              {resultado.advertencias!.map((a, i) => (
                <li key={i} className="text-[11px] text-orange-800 dark:text-orange-300">⚠ {a}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setStep("idle");
            setResultado(null);
            setTituloEditado("");
            setDescEditada("");
            setCategoryId("");
            setDomainId("");
            setLineMeli("");
            setTaxonomiaItemId("");
            setAvisoDuplicado(null);
            setErrorDuplicar(null);
            generarMut.reset();
            crearMut.reset();
          }}
          className="w-full rounded-lg border border-border bg-surface-input py-2 text-sm font-semibold text-ink hover:bg-surface-hover"
        >
          Crear otra
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="w-full rounded-lg bg-accent py-2 text-sm font-bold text-white hover:bg-accent-hover"
          >
            Volver
          </button>
        )}
        <HistorialCrearDesdeCero
          onDuplicar={(e) => void handleDuplicarDesdeHistorial(e)}
          duplicandoId={duplicandoId}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5" ref={formTopRef}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">Crear publicación desde cero</p>
          <p className="mt-0.5 text-[11px] text-muted leading-relaxed">
            Alta nueva en MeLi (User Product, compliant). No usa un ítem prohibido como base.
          </p>
        </div>
        {onDone && (
          <button type="button" onClick={onDone}
            className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-ink">
            ✕
          </button>
        )}
      </div>

      {avisoDuplicado && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-[11px] text-teal-900 dark:border-teal-700 dark:bg-teal-950/35 dark:text-teal-100">
          {avisoDuplicado}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setAvisoDuplicado(null)}
          >
            ocultar
          </button>
        </div>
      )}
      {errorDuplicar && (
        <p className="rounded-lg bg-orange-50 px-3 py-2 text-[11px] text-orange-800 dark:bg-orange-950/35 dark:text-orange-300">{errorDuplicar}</p>
      )}

      <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
        <SkuEanCombobox
          value={sku}
          onChange={(v) => {
            setSku(v);
            setEanSeleccionado(null);
          }}
          onSelectCodigo={(c) => {
            setSku(c.sku);
            setEanSeleccionado(c);
            if (c.nombre_producto?.trim()) {
              // Quitar presentación del nombre si viene al final (ej. "ALMENDRA 500g")
              const nom = c.nombre_producto.replace(/\s+\d+\s*(g|kg|ml|l)\s*$/i, "").trim();
              setNombre(nom || c.nombre_producto.trim());
            }
            setPresentacion(presentacionDesdeEan(c));
          }}
        />
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-muted">Nombre del producto *</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. Lactato de calcio"
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Presentación</label>
            <input
              value={presentacion}
              onChange={(e) => setPresentacion(e.target.value)}
              placeholder="250g"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">
              Precio MeLi (COP) *
            </label>
            <input
              type="number"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="25000"
              min={0}
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
        </div>
        {eanSeleccionado && (
          <p className="rounded-lg bg-teal-50 px-3 py-1.5 text-[11px] text-teal-800 dark:bg-teal-950/35 dark:text-teal-300">
            Producto EAN #{eanSeleccionado.numero_producto} · código{" "}
            <span className="font-mono font-semibold">{eanSeleccionado.codigo}</span>
          </p>
        )}

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-muted">Perfil del producto</label>
          <div className="grid grid-cols-3 gap-2">
            {PERFILES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPerfil(p.value)}
                className={`rounded-xl border-2 px-2 py-2.5 text-center text-[11px] font-semibold transition ${
                  perfil === p.value
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted hover:border-accent/30 hover:text-ink"
                }`}
              >
                <span className="block text-lg">{p.emoji}</span>
                {p.label}
              </button>
            ))}
          </div>
          {categoryId || taxonomiaItemId ? (
            <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50/80 px-3 py-1.5 text-[10px] text-teal-900 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-100">
              Categoría MeLi (desde referencia
              {taxonomiaItemId ? ` ${taxonomiaItemId}` : ""}):{" "}
              <span className="font-mono font-semibold">{categoryId || "se leerá al publicar"}</span>
              {lineMeli ? ` · LINE: ${lineMeli}` : ""}
              {domainId ? ` · ${domainId}` : ""}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => {
                  setCategoryId("");
                  setDomainId("");
                  setLineMeli("");
                  setTaxonomiaItemId("");
                }}
              >
                quitar
              </button>
            </p>
          ) : (
            <p className="mt-1.5 text-[10px] text-muted">
              Sin categoría de referencia: se predice con MeLi (nunca suplementos).
              Si no hay mejor opción, se usa Almacén › Otros (MCO441116).
            </p>
          )}
        </div>

        {/* Ficha técnica biblioteca */}
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface-input/60 px-3 py-2.5">
            <input
              type="checkbox"
              checked={usarFichaBiblioteca}
              onChange={(e) => {
                const on = e.target.checked;
                setUsarFichaBiblioteca(on);
                if (!on) {
                  setArchivoFicha("");
                  setFichaTecnica("");
                  setFichaAutoOk(false);
                }
              }}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-ink">
                Ficha técnica de la biblioteca de docs técnicos
              </span>
            </span>
          </label>
          {usarFichaBiblioteca ? (
            <div className="space-y-2">
              <select
                value={archivoFicha}
                onChange={(e) => setArchivoFicha(e.target.value)}
                disabled={cargandoBiblioteca || fichasBiblioteca.length === 0}
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">
                  {cargandoBiblioteca ? "Cargando…" : "Selecciona una ficha…"}
                </option>
                {fichasBiblioteca.map((a) => (
                  <option key={a.nombre} value={a.nombre}>
                    {tituloDesdeArchivoBiblioteca(a.nombre)}
                    {hayCoincidenciaExacta
                    && (coincideFichaBiblioteca(nombre, a.nombre)
                      || (sku ? coincideFichaBiblioteca(sku, a.nombre) : false))
                      ? " · coincidencia"
                      : ""}
                  </option>
                ))}
              </select>
              {fichaAutoOk && (
                <p className="rounded-lg bg-green-50 px-3 py-1.5 text-[11px] text-green-800 dark:bg-green-950/40 dark:text-green-300">
                  ✓ Datos cargados desde la biblioteca
                </p>
              )}
              {fichaTecnica && (
                <textarea
                  value={fichaTecnica}
                  onChange={(e) => setFichaTecnica(e.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-border bg-surface-input px-3 py-2 text-xs text-ink outline-none focus:border-accent"
                />
              )}
            </div>
          ) : (
            <textarea
              value={fichaTecnica}
              onChange={(e) => setFichaTecnica(e.target.value)}
              rows={3}
              placeholder="Pega datos de ficha (opcional)"
              className="w-full resize-y rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          )}
        </div>

        {/* Fotos */}
        <div className="space-y-2 rounded-xl border border-border bg-surface-input/40 p-3">
          <p className="text-[11px] font-bold text-ink">Fotos *</p>
          <p className="text-[10px] text-muted">Obligatoria para publicar. Arrastra o elige archivos.</p>
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              if (e.dataTransfer.types.includes("Files")) setDropFotosActivo(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (e.dataTransfer.types.includes("Files")) {
                e.dataTransfer.dropEffect = "copy";
                setDropFotosActivo(true);
              }
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDropFotosActivo(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDropFotosActivo(false);
              if (e.dataTransfer.files?.length) void handleSubirFotos(e.dataTransfer.files);
            }}
            className={`rounded-xl border-2 border-dashed px-3 py-5 text-center transition ${
              dropFotosActivo ? "border-accent bg-accent/10" : "border-border bg-surface"
            }`}
          >
            {subiendoFotos ? (
              <p className="text-[11px] font-semibold">Subiendo…</p>
            ) : (
              <>
                <p className="text-[11px] font-semibold text-ink">Arrastra imágenes aquí</p>
                <label className="mt-2 inline-block cursor-pointer rounded-lg bg-ink px-3 py-1.5 text-[11px] font-bold text-white">
                  Elegir archivos
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void handleSubirFotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </>
            )}
          </div>
          {errorFotos && <p className="text-[11px] text-red-700">{errorFotos}</p>}
          {fotosNuevas.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {fotosNuevas.map((f, i) => (
                <div
                  key={f.id}
                  draggable
                  onDragStart={(e) => {
                    setDragFotoId(f.id);
                    e.dataTransfer.setData("text/foto-id", f.id);
                  }}
                  onDragEnd={() => setDragFotoId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromId = e.dataTransfer.getData("text/foto-id") || dragFotoId;
                    if (fromId) reordenarFotoNueva(fromId, f.id);
                    setDragFotoId(null);
                  }}
                  className={`group relative overflow-hidden rounded-lg border-2 ${
                    fotoUrlNueva === f.url ? "border-accent" : "border-border"
                  }`}
                >
                  <button type="button" onClick={() => setFotoUrlNueva(f.url)}>
                    <img src={f.url} alt="" className="h-16 w-16 object-cover" draggable={false} />
                    <span className="absolute bottom-0 left-0 right-0 bg-teal-700/90 px-1 py-0.5 text-[8px] font-bold text-white">
                      {i === 0 ? "★ principal" : `#${i + 1}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => eliminarFotoNueva(f.id)}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] font-bold text-white hover:bg-danger"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setStep("generando");
            generarMut.mutate();
          }}
          disabled={!nombreOk || step === "generando" || generarMut.isPending}
          className="w-full rounded-lg bg-accent py-3 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {generarMut.isPending ? "Generando…" : "✦ Generar contenido compliant con IA"}
        </button>
        {!nombreOk && (
          <p className="text-[10px] text-muted">Escribe el nombre del producto (mín. 3 caracteres).</p>
        )}
        {generarMut.isError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {generarMut.error instanceof Error ? generarMut.error.message : "Error"}
          </p>
        )}
        {generarMut.data?.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{generarMut.data.error}</p>
        )}
      </div>

      {(step === "listo" || step === "creando") && generarMut.data && !generarMut.data.error && (
        <div className="space-y-4 rounded-xl border border-green-200 bg-green-50/50 p-4 dark:border-green-800/60 dark:bg-green-950/35">
          <p className="text-xs font-bold text-green-800 dark:text-green-300">Contenido generado — revisa antes de publicar</p>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Título MeLi</label>
            <input
              value={tituloEditado}
              onChange={(e) => setTituloEditado(e.target.value)}
              maxLength={80}
              className="w-full rounded-lg border border-green-300 dark:border-green-700 bg-surface-input px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Descripción</label>
            <textarea
              value={descEditada}
              onChange={(e) => setDescEditada(e.target.value)}
              rows={8}
              className="w-full resize-y rounded-lg border border-green-300 dark:border-green-700 bg-surface-input px-3 py-2 text-xs text-ink outline-none focus:border-accent"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setStep("creando");
              crearMut.mutate();
            }}
            disabled={!puedeCrear || crearMut.isPending}
            className="w-full rounded-lg bg-teal-600 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {crearMut.isPending
              ? "Creando en MeLi…"
              : !precioValido
                ? "Ingresa el precio"
                : !fotoOk
                  ? "Sube al menos una foto"
                  : "✦ Crear publicación en MeLi + seguimiento"}
          </button>
          {crearMut.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {crearMut.error instanceof Error ? crearMut.error.message : "Error"}
            </p>
          )}
        </div>
      )}

      <HistorialCrearDesdeCero
        onDuplicar={(e) => void handleDuplicarDesdeHistorial(e)}
        duplicandoId={duplicandoId}
      />
    </div>
  );
}

export default function MeliComplianceTab() {
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<ItemPausado | null>(null);
  const [modoCrear, setModoCrear] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [incluirPausadas, setIncluirPausadas] = useState(false);

  const { data: reemplazosData } = useQuery<{
    by_origen: Record<string, string>;
    publicaciones: WatchEntry[];
  }>({
    queryKey: ["meli-compliance-reemplazos"],
    queryFn: () => api.get("/api/meli/compliance/reemplazos"),
    staleTime: 30_000,
  });

  const reemplazoPorOrigen = reemplazosData?.publicaciones?.reduce(
    (acc, p) => {
      if (p.item_origen_id) acc[p.item_origen_id] = p;
      return acc;
    },
    {} as Record<string, WatchEntry>,
  ) ?? {};

  const { data, isLoading, error, refetch, isFetching } = useQuery<{
    ok: boolean;
    items: ItemPausado[];
    total: number;
    incluye_pausadas?: boolean;
    conteos?: {
      forbidden?: number;
      paused?: number;
      under_review?: number;
      closed?: number;
      sales_minerales?: number;
    };
    error?: string;
  }>({
    queryKey: ["meli-pausadas", incluirPausadas],
    queryFn: () =>
      api.get(
        `/api/meli/compliance/pausadas?pausadas=${incluirPausadas ? "1" : "0"}`,
        { timeoutMs: incluirPausadas ? 120_000 : 45_000 },
      ),
    staleTime: 60_000,
    retry: 1,
  });

  const items = (data?.items ?? []).filter((it) => {
    if (!buscar) return true;
    const q = buscar.toLowerCase();
    return (
      it.title.toLowerCase().includes(q) ||
      (it.nombre_catalogo ?? "").toLowerCase().includes(q) ||
      (it.categoria_catalogo ?? "").toLowerCase().includes(q) ||
      it.item_id.toLowerCase().includes(q) ||
      it.sku.toLowerCase().includes(q)
    );
  });

  const conteos = data?.conteos;

  function cerrarWorkspace() {
    setSelectedItem(null);
    setModoCrear(false);
    refetch();
    queryClient.invalidateQueries({ queryKey: ["meli-compliance-watchlist"] });
    queryClient.invalidateQueries({ queryKey: ["meli-compliance-reemplazos"] });
  }

  if (modoCrear) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto rounded-xl border border-border bg-surface-panel p-5">
        <CrearDesdeCeroPanel onDone={cerrarWorkspace} />
      </div>
    );
  }

  if (selectedItem) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
        {/* Lista colapsada en mobile */}
        <div className="hidden lg:flex lg:w-[360px] lg:shrink-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-ink">
              {data?.total ?? 0} publicación(es) bajadas/pausadas
            </p>
            <button onClick={() => refetch()} disabled={isFetching}
              className="text-[11px] text-muted underline hover:text-ink disabled:opacity-40">
              {isFetching ? "…" : "↺ Actualizar"}
            </button>
          </div>
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar…"
            className="rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <div className="flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {items.map((it) => (
              <button
                key={it.item_id}
                onClick={() => setSelectedItem(it)}
                className={`w-full rounded-xl border-2 p-3 text-left text-sm transition ${
                  selectedItem.item_id === it.item_id
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/30 hover:bg-surface-hover"
                }`}
              >
                <p className="truncate font-semibold text-ink leading-tight">{tituloLista(it)}</p>
                {it.nombre_catalogo && it.title !== it.nombre_catalogo && (
                  <p className="truncate text-[10px] text-muted">MeLi: {it.title}</p>
                )}
                <ItemBadges item={it} compact />
              </button>
            ))}
          </div>
        </div>

        {/* Workspace */}
        <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-surface-panel p-5">
          <ItemWorkspace
            key={selectedItem.item_id}
            item={selectedItem}
            onDone={cerrarWorkspace}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header explicativo */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 space-y-2">
        <p className="text-sm font-bold text-blue-900">
          Republicar productos bajados en MeLi — Compliance McKenna
        </p>
        <p className="text-xs text-blue-800 leading-relaxed">
          Por defecto muestra publicaciones <strong>prohibidas por política MeLi</strong> (las bajas
          urgentes). Diagnostica señales de riesgo, genera contenido corregido según materia prima
          reenvasada <strong>(Res. 2674/2013 Art. 37-3)</strong>. Si la publicación está prohibida,
          usa <strong>Crear publicación nueva</strong> (modelo competidor activo) con seguimiento diario.
        </p>
        <button
          type="button"
          onClick={() => setModoCrear(true)}
          className="rounded-lg bg-teal-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-teal-700"
        >
          ✦ Crear publicación desde cero
        </button>
      </div>

      <ComplianceWatchlist />

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <input
          type="checkbox"
          checked={incluirPausadas}
          onChange={(e) => {
            setSelectedItem(null);
            setIncluirPausadas(e.target.checked);
          }}
          className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
        />
        <span className="text-xs leading-relaxed text-ink-secondary">
          <span className="font-semibold text-ink">Incluir también pausadas manualmente</span>
          {" "}— carga más lenta (~270+ publicaciones). Deja desmarcado para ver solo las bajas por política.
        </span>
      </label>

      {/* Stats */}
      {data && data.ok && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center dark:border-red-800 dark:bg-red-950/35">
            <p className="text-xl font-black text-red-700">
              {conteos?.forbidden ?? data.items.filter((i) => esProhibida(i)).length}
            </p>
            <p className="text-[11px] font-semibold text-red-600">Prohibidas</p>
          </div>
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-center dark:border-teal-700 dark:bg-teal-950/35">
            <p className="text-xl font-black text-teal-700">
              {conteos?.sales_minerales ?? data.items.filter((i) => i.categoria_catalogo === "Sales Minerales").length}
            </p>
            <p className="text-[11px] font-semibold text-teal-600">Sales Minerales</p>
          </div>
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-center dark:border-yellow-700 dark:bg-yellow-950/35">
            <p className="text-xl font-black text-yellow-700">
              {conteos?.paused ?? data.items.filter((i) => i.status === "paused").length}
            </p>
            <p className="text-[11px] font-semibold text-yellow-600">Pausadas</p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-center dark:border-orange-700 dark:bg-orange-950/35">
            <p className="text-xl font-black text-orange-700">
              {conteos?.under_review ?? data.items.filter((i) => i.status === "under_review").length}
            </p>
            <p className="text-[11px] font-semibold text-orange-600">En revisión</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex gap-2">
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar por título, SKU o ID…"
          className="flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          onClick={() => refetch()}
          disabled={isLoading || isFetching}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-muted transition hover:border-accent/30 hover:text-ink disabled:opacity-40"
        >
          {isFetching ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent inline-block" />
          ) : (
            "↺ Actualizar"
          )}
        </button>
      </div>

      {/* Estados */}
      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-3">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="text-sm text-muted">
              {incluirPausadas
                ? "Consultando prohibidas y pausadas en MeLi…"
                : "Consultando publicaciones prohibidas por política…"}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger space-y-2">
          <p>
            {error instanceof Error ? error.message : "Error al consultar MeLi."}
          </p>
          <p className="text-xs text-danger/80">
            Si marcó “pausadas manualmente”, desmárquelo para una carga más rápida (solo prohibidas).
          </p>
          <button onClick={() => refetch()} className="underline font-semibold">Reintentar</button>
        </div>
      )}

      {data && !data.ok && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/35 dark:text-yellow-200">
          {data.error ?? "No se pudo conectar con MeLi. Verifica que el token esté activo."}
        </div>
      )}

      {/* Lista de ítems pausados */}
      {data?.ok && !isLoading && (
        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
          {items.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <p className="text-4xl opacity-20">✅</p>
              <p className="mt-3 text-sm font-semibold text-ink">
                {buscar ? "Sin resultados para esa búsqueda" : "No hay publicaciones pausadas o bajadas"}
              </p>
              {!buscar && (
                <p className="mt-1 text-xs text-muted">
                  Todas las publicaciones están activas en MercadoLibre.
                </p>
              )}
            </div>
          ) : (
            items.map((it) => (
              <button
                key={it.item_id}
                onClick={() => setSelectedItem(it)}
                className="w-full rounded-xl border-2 border-border p-4 text-left transition hover:border-accent/40 hover:bg-surface-hover group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink text-sm leading-tight truncate group-hover:text-accent">
                      {tituloLista(it)}
                    </p>
                    {it.nombre_catalogo && it.title !== it.nombre_catalogo && (
                      <p className="truncate text-[11px] text-muted">MeLi: {it.title}</p>
                    )}
                    <ItemBadges item={it} />
                    {reemplazoPorOrigen[it.item_id] && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800">
                          ✓ Reemplazo creado
                        </span>
                        <MeliLinkButton
                          url={
                            reemplazoPorOrigen[it.item_id].url_meli
                            || meliUrl(
                              reemplazoPorOrigen[it.item_id].permalink,
                              reemplazoPorOrigen[it.item_id].item_id,
                            )
                          }
                          label={`Ver ${reemplazoPorOrigen[it.item_id].item_id}`}
                          compact
                        />
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          estadoMeliBadge(
                            reemplazoPorOrigen[it.item_id].estado_actual,
                            reemplazoPorOrigen[it.item_id].sub_status,
                          ).cls
                        }`}>
                          {estadoMeliBadge(
                            reemplazoPorOrigen[it.item_id].estado_actual,
                            reemplazoPorOrigen[it.item_id].sub_status,
                          ).label}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {it.price > 0 && (
                      <p className="text-sm font-bold text-ink">
                        ${it.price.toLocaleString("es-CO")}
                      </p>
                    )}
                    <span className="mt-1 inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">
                      Corregir →
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
