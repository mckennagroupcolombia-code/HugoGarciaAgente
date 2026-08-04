import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import WebLayoutCanvas, {
  usePhosphorIcons,
  WebLayoutInspector,
  type PurezaCanvas,
} from "./studio-web/WebLayoutCanvas";
import { ensureLayout, layoutDefault, type WebLayout } from "../lib/webLayoutStudio";

/**
 * Studio web — lienzo visual + tokens + contenido de mckennagroup.co
 * Backend: GET/PUT /api/web/tema → PAGINA_WEB/site/data/tema_web.json
 */

type TemaId = "clasico" | "pureza";
type StudioTab = "lienzo" | "diseno" | "contenido" | "publicar";
type FuenteDisplay = "montserrat" | "serif";
type RadioUi = "pill" | "soft" | "sharp";
type Densidad = "compacta" | "normal" | "amplia";

interface MetricaItem {
  valor: string;
  etiqueta: string;
}

interface PasoItem {
  titulo: string;
  texto: string;
  icono?: string;
}

interface DisenoTokens {
  fuente_display: FuenteDisplay;
  radio: RadioUi;
  densidad: Densidad;
  tagline: string;
}

interface TemaWebConfig {
  tema_activo: TemaId;
  actualizado?: string | null;
  diseno: DisenoTokens;
  layout: WebLayout;
  pureza: {
    colores: Record<string, string>;
    anuncio: string;
    hero: {
      eyebrow: string;
      titulo: string;
      titulo_em: string;
      subtitulo: string;
      cta_principal: string;
      cta_secundario: string;
    };
    metricas: MetricaItem[];
    trazabilidad: {
      eyebrow: string;
      titulo: string;
      texto: string;
      pasos: PasoItem[];
    };
    pilares: PasoItem[];
    badges_producto: string[];
    cta: { titulo: string; texto: string; boton: string };
    secciones: Record<string, boolean>;
  };
}

interface TemaResponse {
  config: TemaWebConfig;
  temas: TemaId[];
  site_url: string;
  preview_url?: string;
  mensaje?: string;
}

const SECCION_LABEL: Record<string, string> = {
  metricas: "Métricas de confianza",
  trazabilidad: "Ruta de trazabilidad",
  pilares: "Pilares de la marca",
  categorias: "Categorías del catálogo",
  destacados: "Productos destacados",
  cta: "Llamado a la acción final",
};

const COLOR_LABEL: Record<string, string> = {
  acento: "Acento (botones, enlaces)",
  acento_oscuro: "Acento oscuro (hover)",
  fondo: "Fondo de página",
  tinta: "Texto / footer",
  destacado: "Detalle destacado (dorado)",
};

const FUENTE_OPTS: { id: FuenteDisplay; label: string; sample: string }[] = [
  { id: "montserrat", label: "Montserrat", sample: "sans-serif" },
  { id: "serif", label: "Serif editorial", sample: "Georgia, serif" },
];

const RADIO_OPTS: { id: RadioUi; label: string; hint: string }[] = [
  { id: "pill", label: "Píldora", hint: "Botones redondos" },
  { id: "soft", label: "Suave", hint: "Esquinas 12px" },
  { id: "sharp", label: "Nítido", hint: "Esquinas 4px" },
];

const DENSIDAD_OPTS: { id: Densidad; label: string; hint: string }[] = [
  { id: "compacta", label: "Compacta", hint: "Menos aire" },
  { id: "normal", label: "Normal", hint: "Equilibrada" },
  { id: "amplia", label: "Amplia", hint: "Más respiración" },
];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function ensureDiseno(cfg: TemaWebConfig): TemaWebConfig {
  if (!cfg.diseno) {
    cfg.diseno = {
      fuente_display: "montserrat",
      radio: "pill",
      densidad: "normal",
      tagline: "Proveemos a tus ideas",
    };
  }
  cfg.layout = ensureLayout(cfg.layout);
  return cfg;
}

function ChoiceGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-lg border px-3 py-2.5 text-left transition ${
              on ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-border bg-surface hover:border-accent/50"
            }`}
          >
            <div className="text-sm font-semibold text-ink">{opt.label}</div>
            {opt.hint && <div className="mt-0.5 text-[11px] text-muted">{opt.hint}</div>}
          </button>
        );
      })}
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  textarea = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  const cls =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-accent";
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {textarea ? (
        <textarea rows={3} className={cls} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" className={cls} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function Seccion({
  titulo,
  hint,
  children,
  defaultOpen = false,
}: {
  titulo: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="mck-card group overflow-hidden" open={defaultOpen}>
      <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-bold text-ink transition hover:bg-surface-hover">
        <span>
          {titulo}
          {hint && <span className="ml-2 font-normal text-muted">{hint}</span>}
        </span>
        <span className="text-muted transition group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-4 border-t border-border px-5 py-4">{children}</div>
    </details>
  );
}

function LiveSwatch({ colores, diseno }: { colores: Record<string, string>; diseno: DisenoTokens }) {
  const acento = colores.acento || "#0c6069";
  const fondo = colores.fondo || "#f8f6f1";
  const tinta = colores.tinta || "#1c2b2a";
  const oro = colores.destacado || "#b9862f";
  const font =
    diseno.fuente_display === "serif" ? "Georgia, 'Times New Roman', serif" : "Montserrat, system-ui, sans-serif";
  const radius = diseno.radio === "pill" ? 999 : diseno.radio === "soft" ? 12 : 4;
  const pad = diseno.densidad === "compacta" ? 10 : diseno.densidad === "amplia" ? 22 : 16;

  return (
    <div
      className="overflow-hidden rounded-lg border border-border"
      style={{ background: fondo, fontFamily: font }}
      aria-hidden
    >
      <div className="px-3 py-1.5 text-[10px] tracking-wide text-white/85" style={{ background: tinta }}>
        {diseno.tagline || "Proveemos a tus ideas"}
      </div>
      <div className="p-4" style={{ paddingTop: pad, paddingBottom: pad }}>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: oro }}>
          Materias primas
        </div>
        <div className="mb-2 text-base font-extrabold leading-tight" style={{ color: tinta }}>
          Pureza que puedes <em style={{ color: oro, fontWeight: 300 }}>verificar</em>
        </div>
        <div className="mb-3 text-[11px] leading-relaxed opacity-70" style={{ color: tinta }}>
          Vista previa local de tokens — no sustituye el iframe del sitio.
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className="inline-block px-3 py-1.5 text-[11px] font-bold text-white"
            style={{ background: acento, borderRadius: radius }}
          >
            Explorar catálogo
          </span>
          <span
            className="inline-block border px-3 py-1.5 text-[11px] font-semibold"
            style={{ borderColor: tinta, color: tinta, borderRadius: radius }}
          >
            Hablar con asesor
          </span>
        </div>
      </div>
    </div>
  );
}

export default function SitioWebPanel() {
  const [config, setConfig] = useState<TemaWebConfig | null>(null);
  const [original, setOriginal] = useState("");
  const [siteUrl, setSiteUrl] = useState("https://mckennagroup.co");
  const [previewBase, setPreviewBase] = useState("http://127.0.0.1:8083");
  const [useLocalPreview, setUseLocalPreview] = useState(true);
  const [tab, setTab] = useState<StudioTab>("lienzo");
  const [previewTema, setPreviewTema] = useState<TemaId>("pureza");
  const [previewKey, setPreviewKey] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.72);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await api.get<TemaResponse>("/api/web/tema");
      const cfg = ensureDiseno(res.config);
      setConfig(cfg);
      setOriginal(JSON.stringify(cfg));
      setPreviewTema(cfg.tema_activo === "pureza" ? "pureza" : "clasico");
      if (res.site_url) setSiteUrl(res.site_url);
      if (res.preview_url) setPreviewBase(res.preview_url.replace(/\/$/, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la configuración del tema");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  usePhosphorIcons();

  const dirty = useMemo(
    () => !!config && JSON.stringify(config) !== original,
    [config, original],
  );

  const mutar = useCallback((fn: (draft: TemaWebConfig) => void) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const draft = clone(prev);
      fn(draft);
      return draft;
    });
  }, []);

  const guardar = useCallback(
    async (cfg?: TemaWebConfig) => {
      const aGuardar = cfg ?? config;
      if (!aGuardar) return;
      setGuardando(true);
      setError("");
      setAviso("");
      try {
        const res = await api.put<TemaResponse>("/api/web/tema", { config: aGuardar });
        const next = ensureDiseno(res.config);
        setConfig(next);
        setOriginal(JSON.stringify(next));
        setAviso(res.mensaje || "Cambios publicados en el sitio.");
        setPreviewKey((k) => k + 1);
        window.setTimeout(() => setAviso(""), 4000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar");
      } finally {
        setGuardando(false);
      }
    },
    [config],
  );

  const publicarTema = useCallback(
    (tema: TemaId) => {
      if (!config || config.tema_activo === tema) return;
      const seguro = window.confirm(
        tema === "pureza"
          ? "¿Publicar el tema PUREZA & TRAZABILIDAD para todos los visitantes del sitio?"
          : "¿Volver al tema CLÁSICO para todos los visitantes del sitio?",
      );
      if (!seguro) return;
      const draft = clone(config);
      draft.tema_activo = tema;
      setConfig(draft);
      setPreviewTema(tema);
      void guardar(draft);
    },
    [config, guardar],
  );

  const restaurarContenido = useCallback(async () => {
    if (!window.confirm("¿Restaurar textos y colores Pureza a los valores recomendados?")) return;
    setGuardando(true);
    setError("");
    try {
      const res = await api.put<TemaResponse>("/api/web/tema", { accion: "restaurar" });
      const next = ensureDiseno(res.config);
      setConfig(next);
      setOriginal(JSON.stringify(next));
      setAviso(res.mensaje || "Contenido restaurado.");
      setPreviewKey((k) => k + 1);
      window.setTimeout(() => setAviso(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar");
    } finally {
      setGuardando(false);
    }
  }, []);

  const restaurarDiseno = useCallback(async () => {
    if (!window.confirm("¿Restaurar tipografía, radio, densidad y tagline a los valores por defecto?")) return;
    setGuardando(true);
    setError("");
    try {
      const res = await api.put<TemaResponse>("/api/web/tema", { accion: "restaurar_diseno" });
      const next = ensureDiseno(res.config);
      setConfig(next);
      setOriginal(JSON.stringify(next));
      setAviso(res.mensaje || "Diseño restaurado.");
      setPreviewKey((k) => k + 1);
      window.setTimeout(() => setAviso(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar");
    } finally {
      setGuardando(false);
    }
  }, []);

  const restaurarLayout = useCallback(async () => {
    if (!window.confirm("¿Restaurar el lienzo (posiciones, escalas y orden de secciones)?")) return;
    setGuardando(true);
    setError("");
    try {
      const res = await api.put<TemaResponse>("/api/web/tema", { accion: "restaurar_layout" });
      const next = ensureDiseno(res.config);
      setConfig(next);
      setOriginal(JSON.stringify(next));
      setSelectedNode(null);
      setAviso(res.mensaje || "Lienzo restaurado.");
      window.setTimeout(() => setAviso(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar");
    } finally {
      setGuardando(false);
    }
  }, []);

  const patchPureza = useCallback((mutator: (draft: PurezaCanvas) => void) => {
    mutar((d) => {
      mutator(d.pureza as PurezaCanvas);
    });
  }, [mutar]);

  const basePreview = useLocalPreview ? previewBase : siteUrl;
  const iframeSrc = `${basePreview}/?vista_tema=${previewTema}&_studio=${previewKey}`;

  if (cargando) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-muted">
        Cargando Studio de diseño…
      </div>
    );
  }

  if (!config) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="mck-card border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error || "No se pudo cargar la configuración."}
          <button type="button" onClick={() => void cargar()} className="ml-3 font-semibold underline">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const pz = config.pureza;
  const diseno = config.diseno;

  const tabs: { id: StudioTab; label: string }[] = [
    { id: "lienzo", label: "Lienzo" },
    { id: "diseno", label: "Tokens" },
    { id: "contenido", label: "Contenido" },
    { id: "publicar", label: "Publicar" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-surface-panel px-4 py-3 md:px-5">
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold text-ink">Studio web</h1>
            <p className="text-xs text-muted">
              Se edita solo desde esta app · tema publicado:{" "}
              <strong className="text-ink">{config.tema_activo === "pureza" ? "Pureza" : "Clásico"}</strong>
              {config.actualizado && <> · {config.actualizado.replace("T", " ")}</>}
              {dirty && <span className="ml-2 text-amber-600">· cambios sin guardar</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-border bg-surface p-0.5 text-xs">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-full px-3 py-1.5 font-semibold transition ${
                    tab === t.id ? "bg-accent text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "lienzo" && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  Zoom
                  <input
                    type="range"
                    min={40}
                    max={100}
                    value={Math.round(zoom * 100)}
                    onChange={(e) => setZoom(+e.target.value / 100)}
                    className="w-20"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void restaurarLayout()}
                  disabled={guardando}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:text-accent"
                >
                  Reset lienzo
                </button>
              </>
            )}
            <button
              type="button"
              disabled={!dirty || guardando}
              onClick={() => void guardar()}
              className="rounded-full bg-accent px-4 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {aviso && (
          <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            ✓ {aviso}
          </div>
        )}
      </div>

      {tab === "lienzo" ? (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <WebLayoutCanvas
            pureza={pz as PurezaCanvas}
            layout={config.layout || layoutDefault()}
            selectedId={selectedNode}
            onSelect={setSelectedNode}
            onLayoutChange={(next) =>
              mutar((d) => {
                d.layout = next;
              })
            }
            onPurezaPatch={patchPureza}
            zoom={zoom}
          />
          <div className="min-h-0 overflow-y-auto border-l border-border bg-surface-panel">
            <WebLayoutInspector
              selectedId={selectedNode}
              layout={config.layout || layoutDefault()}
              pureza={pz as PurezaCanvas}
              onLayoutChange={(next) =>
                mutar((d) => {
                  d.layout = next;
                })
              }
              onPurezaPatch={patchPureza}
            />
          </div>
        </div>
      ) : (
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.95fr)]">
        {/* Controles */}
        <div className="min-h-0 overflow-y-auto border-r border-border p-4 md:p-5">
          {tab === "diseno" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">Tokens visuales</h2>
                <button
                  type="button"
                  onClick={() => void restaurarDiseno()}
                  disabled={guardando}
                  className="text-xs font-semibold text-muted underline hover:text-accent"
                >
                  Restaurar diseño
                </button>
              </div>

              <LiveSwatch colores={pz.colores} diseno={diseno} />

              <Seccion titulo="Colores" hint="tema Pureza" defaultOpen>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(COLOR_LABEL).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3">
                      <input
                        type="color"
                        value={pz.colores[key] || "#0c6069"}
                        onChange={(e) =>
                          mutar((d) => {
                            d.pureza.colores[key] = e.target.value;
                          })
                        }
                        className="h-9 w-12 cursor-pointer rounded border border-border bg-surface"
                      />
                      <span className="text-sm text-ink">{label}</span>
                    </label>
                  ))}
                </div>
              </Seccion>

              <Seccion titulo="Tipografía display" hint="títulos del home" defaultOpen>
                <ChoiceGroup
                  options={FUENTE_OPTS}
                  value={diseno.fuente_display}
                  onChange={(v) =>
                    mutar((d) => {
                      d.diseno.fuente_display = v;
                    })
                  }
                />
              </Seccion>

              <Seccion titulo="Forma de botones" defaultOpen>
                <ChoiceGroup
                  options={RADIO_OPTS}
                  value={diseno.radio}
                  onChange={(v) =>
                    mutar((d) => {
                      d.diseno.radio = v;
                    })
                  }
                />
              </Seccion>

              <Seccion titulo="Densidad / espaciado" defaultOpen>
                <ChoiceGroup
                  options={DENSIDAD_OPTS}
                  value={diseno.densidad}
                  onChange={(v) =>
                    mutar((d) => {
                      d.diseno.densidad = v;
                    })
                  }
                />
              </Seccion>

              <Seccion titulo="Tagline del logo" defaultOpen>
                <Campo
                  label="Texto bajo MCKENNA GROUP"
                  value={diseno.tagline}
                  onChange={(v) =>
                    mutar((d) => {
                      d.diseno.tagline = v;
                    })
                  }
                />
              </Seccion>
            </div>
          )}

          {tab === "contenido" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-1">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">Contenido Pureza</h2>
                <button
                  type="button"
                  onClick={() => void restaurarContenido()}
                  disabled={guardando}
                  className="text-xs font-semibold text-muted underline hover:text-accent"
                >
                  Restaurar textos
                </button>
              </div>

              <Seccion titulo="Barra de anuncio" defaultOpen>
                <Campo
                  label="Texto del anuncio"
                  value={pz.anuncio}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.anuncio = v;
                    })
                  }
                />
              </Seccion>

              <Seccion titulo="Hero del home" defaultOpen>
                <Campo
                  label="Eyebrow"
                  value={pz.hero.eyebrow}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.hero.eyebrow = v;
                    })
                  }
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <Campo
                    label="Título"
                    value={pz.hero.titulo}
                    onChange={(v) =>
                      mutar((d) => {
                        d.pureza.hero.titulo = v;
                      })
                    }
                  />
                  <Campo
                    label="Palabra destacada"
                    value={pz.hero.titulo_em}
                    onChange={(v) =>
                      mutar((d) => {
                        d.pureza.hero.titulo_em = v;
                      })
                    }
                  />
                </div>
                <Campo
                  label="Subtítulo"
                  textarea
                  value={pz.hero.subtitulo}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.hero.subtitulo = v;
                    })
                  }
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <Campo
                    label="Botón principal"
                    value={pz.hero.cta_principal}
                    onChange={(v) =>
                      mutar((d) => {
                        d.pureza.hero.cta_principal = v;
                      })
                    }
                  />
                  <Campo
                    label="Botón secundario"
                    value={pz.hero.cta_secundario}
                    onChange={(v) =>
                      mutar((d) => {
                        d.pureza.hero.cta_secundario = v;
                      })
                    }
                  />
                </div>
              </Seccion>

              <Seccion titulo="Métricas">
                {pz.metricas.map((m, i) => (
                  <div key={i} className="grid grid-cols-[110px_1fr] gap-3">
                    <Campo
                      label="Cifra"
                      value={m.valor}
                      onChange={(v) =>
                        mutar((d) => {
                          d.pureza.metricas[i].valor = v;
                        })
                      }
                    />
                    <Campo
                      label="Etiqueta"
                      value={m.etiqueta}
                      onChange={(v) =>
                        mutar((d) => {
                          d.pureza.metricas[i].etiqueta = v;
                        })
                      }
                    />
                  </div>
                ))}
              </Seccion>

              <Seccion titulo="Ruta de trazabilidad">
                <Campo
                  label="Eyebrow"
                  value={pz.trazabilidad.eyebrow}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.trazabilidad.eyebrow = v;
                    })
                  }
                />
                <Campo
                  label="Título"
                  value={pz.trazabilidad.titulo}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.trazabilidad.titulo = v;
                    })
                  }
                />
                <Campo
                  label="Texto"
                  textarea
                  value={pz.trazabilidad.texto}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.trazabilidad.texto = v;
                    })
                  }
                />
                {pz.trazabilidad.pasos.map((paso, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">Paso {i + 1}</div>
                    <div className="space-y-3">
                      <Campo
                        label="Título"
                        value={paso.titulo}
                        onChange={(v) =>
                          mutar((d) => {
                            d.pureza.trazabilidad.pasos[i].titulo = v;
                          })
                        }
                      />
                      <Campo
                        label="Descripción"
                        textarea
                        value={paso.texto}
                        onChange={(v) =>
                          mutar((d) => {
                            d.pureza.trazabilidad.pasos[i].texto = v;
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
              </Seccion>

              <Seccion titulo="Pilares">
                {pz.pilares.map((pilar, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">Pilar {i + 1}</div>
                    <div className="space-y-3">
                      <Campo
                        label="Título"
                        value={pilar.titulo}
                        onChange={(v) =>
                          mutar((d) => {
                            d.pureza.pilares[i].titulo = v;
                          })
                        }
                      />
                      <Campo
                        label="Texto"
                        textarea
                        value={pilar.texto}
                        onChange={(v) =>
                          mutar((d) => {
                            d.pureza.pilares[i].texto = v;
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
              </Seccion>

              <Seccion titulo="Distintivos y CTA">
                <Campo
                  label="Distintivos (coma)"
                  value={pz.badges_producto.join(", ")}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.badges_producto = v
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                    })
                  }
                />
                <Campo
                  label="CTA título"
                  value={pz.cta.titulo}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.cta.titulo = v;
                    })
                  }
                />
                <Campo
                  label="CTA texto"
                  textarea
                  value={pz.cta.texto}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.cta.texto = v;
                    })
                  }
                />
                <Campo
                  label="CTA botón"
                  value={pz.cta.boton}
                  onChange={(v) =>
                    mutar((d) => {
                      d.pureza.cta.boton = v;
                    })
                  }
                />
              </Seccion>

              <Seccion titulo="Secciones visibles">
                <div className="grid gap-2 md:grid-cols-2">
                  {Object.entries(SECCION_LABEL).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={pz.secciones[key] !== false}
                        onChange={(e) =>
                          mutar((d) => {
                            d.pureza.secciones[key] = e.target.checked;
                          })
                        }
                        className="accent-current"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Seccion>
            </div>
          )}

          {tab === "publicar" && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Elige qué tema ven los visitantes. La vista previa del Studio no cambia el sitio público.
              </p>
              {(["clasico", "pureza"] as TemaId[]).map((tema) => {
                const activo = config.tema_activo === tema;
                return (
                  <div
                    key={tema}
                    className={`mck-card space-y-3 p-4 ${activo ? "border-accent ring-1 ring-accent" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-ink">
                        {tema === "pureza" ? "Pureza & Trazabilidad" : "Clásico"}
                      </div>
                      {activo && (
                        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-bold text-green-700">
                          ● Publicado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      {tema === "pureza"
                        ? "Fondo claro, tipografía editable y foco en COA / trazabilidad."
                        : "Hero oscuro y paleta verde-aqua original."}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewTema(tema);
                          setPreviewKey((k) => k + 1);
                        }}
                        className="flex-1 rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold hover:border-accent hover:text-accent"
                      >
                        Previsualizar aquí
                      </button>
                      <button
                        type="button"
                        disabled={activo || guardando}
                        onClick={() => publicarTema(tema)}
                        className="flex-1 rounded-full bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                      >
                        {activo ? "En uso" : "Publicar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="flex min-h-[50vh] flex-col bg-[#1a1f1e] lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Vista previa</span>
            <div className="flex rounded-full bg-white/10 p-0.5 text-[11px]">
              {(["pureza", "clasico"] as TemaId[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setPreviewTema(t);
                    setPreviewKey((k) => k + 1);
                  }}
                  className={`rounded-full px-2.5 py-1 font-semibold ${
                    previewTema === t ? "bg-white text-ink" : "text-white/60"
                  }`}
                >
                  {t === "pureza" ? "Pureza" : "Clásico"}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-white/60">
              <input
                type="checkbox"
                checked={useLocalPreview}
                onChange={(e) => {
                  setUseLocalPreview(e.target.checked);
                  setPreviewKey((k) => k + 1);
                }}
                className="accent-current"
              />
              Local :8083
            </label>
            <button
              type="button"
              onClick={() => setPreviewKey((k) => k + 1)}
              className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10"
            >
              Recargar
            </button>
            <a
              href={iframeSrc}
              target="_blank"
              rel="noopener"
              className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10"
            >
              Abrir ↗
            </a>
          </div>
          <iframe
            key={previewKey}
            title="Vista previa sitio"
            src={iframeSrc}
            className="min-h-[420px] w-full flex-1 bg-white"
          />
          <p className="px-3 py-1.5 text-[10px] text-white/40">
            Guarda para ver colores/tipografía/espaciado en el iframe. El swatch de la izquierda refleja borradores al
            instante.
          </p>
        </div>
      </div>
      )}
    </div>
  );
}
