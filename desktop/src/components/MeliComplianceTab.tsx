import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

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
  publicacion?: {
    ok: boolean;
    item_id?: string;
    permalink?: string;
    status?: string;
    error?: string;
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
  estado_actual: string;
  sub_status?: string[];
  nivel_riesgo?: string;
  ultima_revision?: string;
  creado_en?: string;
  categoria_catalogo?: string;
  seguimiento_activo?: boolean;
};

const PERFILES = [
  { value: "materia_prima_alimentaria", label: "Materia prima alimentaria", emoji: "🌾" },
  { value: "insumo_cosmetico", label: "Insumo cosmético", emoji: "🧴" },
  { value: "insumo_tecnico", label: "Insumo técnico / industrial", emoji: "⚙️" },
];

// ── Badge de nivel de riesgo ───────────────────────────────────────────────

function RiskBadge({ nivel, score }: { nivel: string; score: number }) {
  const cfg = {
    bajo:  { bg: "bg-green-100 border-green-300",  text: "text-green-800",  dot: "bg-green-500",  label: "Bajo" },
    medio: { bg: "bg-yellow-100 border-yellow-300", text: "text-yellow-800", dot: "bg-yellow-500", label: "Medio" },
    alto:  { bg: "bg-red-100 border-red-300",       text: "text-red-800",    dot: "bg-red-500",    label: "Alto" },
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
          <div key={k} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold ${v ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
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
        <span className={`rounded-full bg-teal-50 font-semibold text-teal-800 ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10px]"}`}>
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
  const [tituloEditado, setTituloEditado] = useState("");
  const [descEditada, setDescEditada] = useState("");
  const [step, setStep] = useState<"idle" | "generando" | "listo" | "publicando" | "creando_nueva" | "done" | "done_nueva">("idle");
  const [resultado, setResultado] = useState<ResultadoRepublicacion | null>(null);
  const [resultadoNueva, setResultadoNueva] = useState<CrearNuevaResult | null>(null);

  // Diagnóstico inicial (automático al montar)
  const { data: diag } = useQuery<Diagnostico>({
    queryKey: ["compliance-diag", item.item_id],
    queryFn: () =>
      api.post("/api/meli/compliance/diagnosticar", {
        sku: item.sku,
        nombre: nombreProducto(item),
        titulo_meli: item.title,
        atributos_meli: { domain_id: item.domain_id, LINE: item.line ?? "" },
      }),
    staleTime: Infinity,
  });

  const generarMut = useMutation({
    mutationFn: () =>
      api.post<ContenidoGenerado>(
        "/api/meli/compliance/generar",
        {
          sku: item.sku,
          nombre: nombreProducto(item),
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
          nombre: nombreProducto(item),
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
          nombre: nombreProducto(item),
          presentacion,
          precio: parseFloat(precio) || item.price || 0,
          perfil,
          ficha_tecnica: fichaTecnica,
          titulo_actual: item.title,
          item_origen_id: item.item_id,
          categoria_catalogo: item.categoria_catalogo ?? "",
          referencia: "citrato_magnesio",
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

  const precioValido = parseFloat(precio) > 0 || item.price > 0 || esProhibida(item);

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
                <p key={i} className="rounded-lg bg-orange-50 px-3 py-1.5 text-[11px] text-orange-800">
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

      {/* Aviso publicación prohibida */}
      {esProhibida(item) && step !== "done" && step !== "done_nueva" && (
        <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 space-y-1.5">
          <p className="text-xs font-bold text-orange-900">Publicación prohibida — crear una nueva</p>
          <p className="text-[11px] leading-relaxed text-orange-800">
            MeLi no deja corregir título, foto ni reactivar esta publicación por API.
            El camino recomendado es <strong>crear una publicación nueva</strong> (modelo competidor activo:
            nombre químico, MCO8830, LINE materias primas) y dejarla en <strong>seguimiento diario</strong>.
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

          {/* Ficha técnica */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">
              Ficha técnica (opcional — la IA filtra claims de salud automáticamente)
            </label>
            <textarea
              value={fichaTecnica}
              onChange={(e) => setFichaTecnica(e.target.value)}
              rows={3}
              placeholder="Pega aquí datos de la ficha técnica. Claude eliminará frases de riesgo antes de usarlos."
              className="w-full resize-y rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
            />
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
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {generarMut.error instanceof Error ? generarMut.error.message : "Error al generar"}
            </p>
          )}
          {generarMut.data?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {generarMut.data.error}
            </p>
          )}
        </div>
      )}

      {/* Contenido generado — editable */}
      {(step === "listo" || step === "publicando" || step === "creando_nueva") && generarMut.data && !generarMut.data.error && (
        <div className="space-y-4 rounded-xl border border-green-200 bg-green-50/50 p-4">
          <p className="text-xs font-bold text-green-800">Contenido generado — revisa antes de publicar</p>

          {/* Título */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Título MeLi (máx. 60 chars)</label>
            <input
              value={tituloEditado}
              onChange={(e) => setTituloEditado(e.target.value)}
              maxLength={80}
              className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-accent"
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
              className="w-full resize-y rounded-lg border border-green-300 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-accent"
            />
          </div>

          {/* Atributos */}
          {generarMut.data.atributos && (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {Object.entries(generarMut.data.atributos).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-green-200 bg-white px-2.5 py-1.5">
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
            <details className="rounded-xl border border-green-200 bg-white">
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
              || (!precio && !esProhibida(item))
            }
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-40"
          >
            {republicarMut.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Aplicando correcciones en MeLi…
              </span>
            ) : !precio && !esProhibida(item) ? (
              "Ingresa el precio para continuar"
            ) : esProhibida(item) ? (
              "Aplicar correcciones permitidas por API"
            ) : (
              "🚀 Corregir y republicar en MeLi"
            )}
          </button>

          {republicarMut.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {republicarMut.error instanceof Error ? republicarMut.error.message : "Error al republicar"}
            </p>
          )}

          {/* Crear publicación nueva (recomendado si prohibida) */}
          <div className="rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/60 p-3 space-y-2">
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
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {crearNuevaMut.error instanceof Error ? crearNuevaMut.error.message : "Error al crear"}
              </p>
            )}
            {crearNuevaMut.data?.paso_fallido && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
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
            ? "border-green-300 bg-green-50"
            : resultado.republicacion?.ok && resultado.republicacion?.parcial
              ? "border-yellow-300 bg-yellow-50"
              : "border-red-300 bg-red-50"
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
                <ul className="space-y-1.5 rounded-lg border border-yellow-200 bg-white px-3 py-2">
                  {resultado.republicacion.acciones_manuales?.map((a, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-yellow-900">
                      → {a}
                    </li>
                  ))}
                </ul>
              )}
              {resultado.republicacion.descripcion_para_pegar && (
                <details className="rounded-xl border border-yellow-200 bg-white" open>
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
              {resultado.republicacion.parcial && esProhibida(item) && (
                <p className="text-[11px] font-semibold text-yellow-900">
                  Siguiente paso: usa «Crear publicación nueva» (arriba) para publicar desde cero con seguimiento diario.
                </p>
              )}
              <button
                onClick={onDone}
                className="mt-2 w-full rounded-lg border border-border bg-white py-2 text-sm font-semibold text-ink transition hover:bg-surface-hover"
              >
                Volver a la lista
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-red-800">Error al republicar</p>
              <p className="text-xs text-red-700">
                {resultado.paso_fallido ?? resultado.republicacion?.error ?? "Error desconocido"}
              </p>
              <button
                onClick={() => setStep("listo")}
                className="w-full rounded-lg border border-red-300 bg-white py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100"
              >
                Reintentar
              </button>
            </>
          )}
        </div>
      )}

      {/* Publicación nueva creada */}
      {step === "done_nueva" && resultadoNueva && (
        <div className={`rounded-xl border p-4 space-y-3 ${
          resultadoNueva.publicacion?.ok ? "border-teal-300 bg-teal-50" : "border-red-300 bg-red-50"
        }`}>
          {resultadoNueva.publicacion?.ok ? (
            <>
              <p className="text-sm font-bold text-teal-900">✅ Publicación nueva creada en MeLi</p>
              <p className="text-xs text-teal-800">
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
              <p className="text-[11px] text-teal-800">
                Estado inicial: {resultadoNueva.revision_inicial?.revision?.status ?? resultadoNueva.publicacion.status ?? "—"}
                {resultadoNueva.revision_inicial?.revision?.nivel_riesgo && (
                  <> · Riesgo {resultadoNueva.revision_inicial.revision.nivel_riesgo}</>
                )}
              </p>
              <p className="text-[11px] leading-relaxed text-teal-900">
                Quedó en <strong>seguimiento diario</strong> (cron 8:30 + alerta WhatsApp si MeLi la bloquea).
                Sube la <strong>foto de etiqueta alternativa</strong> en MeLi lo antes posible.
              </p>
              {(resultadoNueva.advertencias ?? []).length > 0 && (
                <ul className="space-y-1 text-[11px] text-orange-800">
                  {(resultadoNueva.advertencias ?? []).map((a, i) => (
                    <li key={i}>⚠ {a}</li>
                  ))}
                </ul>
              )}
              <button onClick={onDone} className="w-full rounded-lg border border-teal-400 bg-white py-2 text-sm font-semibold text-teal-900 hover:bg-teal-100">
                Volver a la lista
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-red-800">Error al crear publicación</p>
              <p className="text-xs text-red-700">
                {resultadoNueva.paso_fallido ?? resultadoNueva.publicacion?.error ?? "Error desconocido"}
              </p>
              <button onClick={() => setStep("listo")} className="w-full rounded-lg border border-red-300 bg-white py-2 text-sm font-semibold text-red-800">
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
    <div className="shrink-0 rounded-xl border border-teal-200 bg-teal-50/50 p-4 space-y-3">
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
              className="rounded-xl border border-teal-200 bg-white px-3 py-2.5 space-y-2"
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

export default function MeliComplianceTab() {
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<ItemPausado | null>(null);
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
    refetch();
    queryClient.invalidateQueries({ queryKey: ["meli-compliance-watchlist"] });
    queryClient.invalidateQueries({ queryKey: ["meli-compliance-reemplazos"] });
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
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 space-y-1">
        <p className="text-sm font-bold text-blue-900">
          Republicar productos bajados en MeLi — Compliance McKenna
        </p>
        <p className="text-xs text-blue-800 leading-relaxed">
          Por defecto muestra publicaciones <strong>prohibidas por política MeLi</strong> (las bajas
          urgentes). Diagnostica señales de riesgo, genera contenido corregido según materia prima
          reenvasada <strong>(Res. 2674/2013 Art. 37-3)</strong>. Si la publicación está prohibida,
          usa <strong>Crear publicación nueva</strong> (modelo competidor activo) con seguimiento diario.
        </p>
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
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
            <p className="text-xl font-black text-red-700">
              {conteos?.forbidden ?? data.items.filter((i) => esProhibida(i)).length}
            </p>
            <p className="text-[11px] font-semibold text-red-600">Prohibidas</p>
          </div>
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-center">
            <p className="text-xl font-black text-teal-700">
              {conteos?.sales_minerales ?? data.items.filter((i) => i.categoria_catalogo === "Sales Minerales").length}
            </p>
            <p className="text-[11px] font-semibold text-teal-600">Sales Minerales</p>
          </div>
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-center">
            <p className="text-xl font-black text-yellow-700">
              {conteos?.paused ?? data.items.filter((i) => i.status === "paused").length}
            </p>
            <p className="text-[11px] font-semibold text-yellow-600">Pausadas</p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-center">
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
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
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
