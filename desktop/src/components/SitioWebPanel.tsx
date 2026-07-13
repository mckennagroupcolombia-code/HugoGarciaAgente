import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import PanelHelp from "./PanelHelp";

/**
 * Panel "Sitio Web": controla el tema visual de mckennagroup.co
 * (Clásico vs Pureza & Trazabilidad) y edita el contenido del tema Pureza.
 * Backend: GET/PUT /api/web/tema → PAGINA_WEB/site/data/tema_web.json.
 */

type TemaId = "clasico" | "pureza";

interface MetricaItem {
  valor: string;
  etiqueta: string;
}

interface PasoItem {
  titulo: string;
  texto: string;
  icono?: string;
}

interface TemaWebConfig {
  tema_activo: TemaId;
  actualizado?: string | null;
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

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── Mini vistas previas de cada tema (puro CSS) ─────────────────────────────

function MiniPreviewClasico() {
  return (
    <div className="pointer-events-none h-28 w-full overflow-hidden rounded-lg border border-border" aria-hidden>
      <div className="h-2 w-full bg-[#0c6069]" />
      <div className="flex h-full">
        <div className="flex w-1/2 flex-col justify-center gap-1.5 bg-[#022D33] p-3">
          <div className="h-2 w-3/4 rounded bg-white/80" />
          <div className="h-2 w-1/2 rounded bg-[#6aacb3]" />
          <div className="mt-1 h-3 w-14 rounded-sm bg-[#0c6069]" />
        </div>
        <div className="flex w-1/2 flex-col gap-1.5 bg-[#e3fcff] p-3">
          <div className="h-3 w-full rounded-sm border border-[#0c6069]/30 bg-white" />
          <div className="h-3 w-full rounded-sm border border-[#0c6069]/30 bg-white" />
          <div className="h-3 w-full rounded-sm border border-[#0c6069]/30 bg-white" />
        </div>
      </div>
    </div>
  );
}

function MiniPreviewPureza({ colores }: { colores: Record<string, string> }) {
  const acento = colores.acento || "#0c6069";
  const fondo = colores.fondo || "#f8f6f1";
  const tinta = colores.tinta || "#1c2b2a";
  const oro = colores.destacado || "#b9862f";
  return (
    <div className="pointer-events-none h-28 w-full overflow-hidden rounded-lg border border-border" aria-hidden>
      <div className="h-2 w-full" style={{ background: tinta }} />
      <div className="flex h-full" style={{ background: fondo }}>
        <div className="flex w-3/5 flex-col justify-center gap-1.5 p-3">
          <div className="h-1.5 w-10 rounded" style={{ background: oro }} />
          <div className="h-2.5 w-11/12 rounded" style={{ background: tinta, fontFamily: "serif" }} />
          <div className="h-1.5 w-2/3 rounded bg-black/20" />
          <div className="mt-1 flex gap-1">
            <div className="h-3 w-14 rounded-full" style={{ background: acento }} />
            <div className="h-3 w-12 rounded-full border" style={{ borderColor: tinta }} />
          </div>
        </div>
        <div className="flex w-2/5 items-center p-2">
          <div className="w-full rotate-2 rounded-md border border-black/10 bg-white p-1.5 shadow-sm">
            <div className="mb-1 h-1.5 w-2/3 rounded" style={{ background: acento }} />
            <div className="mb-0.5 h-1 w-full rounded bg-black/10" />
            <div className="mb-0.5 h-1 w-full rounded bg-black/10" />
            <div className="h-1.5 w-1/2 rounded-full border" style={{ borderColor: oro }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Controles reutilizables ─────────────────────────────────────────────────

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

// ── Panel principal ─────────────────────────────────────────────────────────

export default function SitioWebPanel() {
  const [config, setConfig] = useState<TemaWebConfig | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [siteUrl, setSiteUrl] = useState("https://mckennagroup.co");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await api.get<TemaResponse>("/api/web/tema");
      setConfig(res.config);
      setOriginal(JSON.stringify(res.config));
      if (res.site_url) setSiteUrl(res.site_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la configuración del tema");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

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
        setConfig(res.config);
        setOriginal(JSON.stringify(res.config));
        setAviso(res.mensaje || "Cambios publicados en el sitio.");
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
      void guardar(draft);
    },
    [config, guardar],
  );

  const restaurar = useCallback(async () => {
    if (!window.confirm("¿Restaurar todos los textos y colores del tema Pureza a los valores recomendados? Se pierden las ediciones."))
      return;
    setGuardando(true);
    setError("");
    try {
      const res = await api.put<TemaResponse>("/api/web/tema", { accion: "restaurar" });
      setConfig(res.config);
      setOriginal(JSON.stringify(res.config));
      setAviso(res.mensaje || "Contenido restaurado.");
      window.setTimeout(() => setAviso(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar");
    } finally {
      setGuardando(false);
    }
  }, []);

  const abrirPreview = (tema: TemaId) => {
    window.open(`${siteUrl}/?vista_tema=${tema}`, "_blank", "noopener");
  };

  if (cargando) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-muted">
        Cargando configuración del sitio…
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

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <PanelHelp panelId="sitioweb" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Sitio Web — Apariencia</h1>
          <p className="text-sm text-muted">
            Tema activo: <strong className="text-ink">{config.tema_activo === "pureza" ? "Pureza & Trazabilidad" : "Clásico"}</strong>
            {config.actualizado && <> · último cambio {config.actualizado.replace("T", " ")}</>}
          </p>
        </div>
        <a
          href={siteUrl}
          target="_blank"
          rel="noopener"
          className="rounded-full border border-border bg-surface-panel px-4 py-1.5 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent"
        >
          Abrir mckennagroup.co ↗
        </a>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {aviso && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">✓ {aviso}</div>
      )}

      {/* ── Selector de tema ─────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        {(["clasico", "pureza"] as TemaId[]).map((tema) => {
          const activo = config.tema_activo === tema;
          return (
            <div
              key={tema}
              className={`mck-card space-y-3 p-4 transition ${activo ? "border-accent ring-1 ring-accent" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-ink">
                  {tema === "pureza" ? "Pureza & Trazabilidad" : "Clásico"}
                  {tema === "pureza" && (
                    <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                      Recomendado
                    </span>
                  )}
                </div>
                {activo && (
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-bold text-green-700">
                    ● Publicado
                  </span>
                )}
              </div>

              {tema === "pureza" ? <MiniPreviewPureza colores={pz.colores} /> : <MiniPreviewClasico />}

              <p className="text-xs leading-relaxed text-muted">
                {tema === "pureza"
                  ? "Fondo claro, tipografía editorial y foco en el valor agregado: COA por lote, importación VUCE y ruta de trazabilidad visible."
                  : "El diseño original: hero oscuro sobre paleta verde-aqua, secciones numeradas y catálogo tipo e-commerce."}
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => abrirPreview(tema)}
                  className="flex-1 rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold text-ink transition hover:border-accent hover:text-accent"
                >
                  👁 Vista previa
                </button>
                <button
                  type="button"
                  disabled={activo || guardando}
                  onClick={() => publicarTema(tema)}
                  className="flex-1 rounded-full bg-accent px-3 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {activo ? "Tema en uso" : "Publicar este tema"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Editor de contenido (tema Pureza) ────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <h2 className="text-base font-extrabold text-ink">Contenido del tema Pureza</h2>
        <button
          type="button"
          onClick={() => void restaurar()}
          disabled={guardando}
          className="text-xs font-semibold text-muted underline transition hover:text-accent"
        >
          Restaurar textos recomendados
        </button>
      </div>

      <div className="space-y-3">
        <Seccion titulo="Barra de anuncio" hint="franja superior en todas las páginas" defaultOpen>
          <Campo label="Texto del anuncio" value={pz.anuncio} onChange={(v) => mutar((d) => { d.pureza.anuncio = v; })} />
        </Seccion>

        <Seccion titulo="Hero del home" hint="primer bloque que ve el cliente" defaultOpen>
          <Campo label="Eyebrow (texto pequeño superior)" value={pz.hero.eyebrow} onChange={(v) => mutar((d) => { d.pureza.hero.eyebrow = v; })} />
          <div className="grid gap-4 md:grid-cols-2">
            <Campo label="Título" value={pz.hero.titulo} onChange={(v) => mutar((d) => { d.pureza.hero.titulo = v; })} />
            <Campo label="Palabra destacada (cursiva dorada)" value={pz.hero.titulo_em} onChange={(v) => mutar((d) => { d.pureza.hero.titulo_em = v; })} />
          </div>
          <Campo label="Subtítulo" textarea value={pz.hero.subtitulo} onChange={(v) => mutar((d) => { d.pureza.hero.subtitulo = v; })} />
          <div className="grid gap-4 md:grid-cols-2">
            <Campo label="Botón principal" value={pz.hero.cta_principal} onChange={(v) => mutar((d) => { d.pureza.hero.cta_principal = v; })} />
            <Campo label="Botón secundario" value={pz.hero.cta_secundario} onChange={(v) => mutar((d) => { d.pureza.hero.cta_secundario = v; })} />
          </div>
        </Seccion>

        <Seccion titulo="Métricas de confianza" hint={`${pz.metricas.length} cifras bajo el hero`}>
          {pz.metricas.map((m, i) => (
            <div key={i} className="grid grid-cols-[110px_1fr] gap-3">
              <Campo label="Cifra" value={m.valor} onChange={(v) => mutar((d) => { d.pureza.metricas[i].valor = v; })} />
              <Campo label="Etiqueta" value={m.etiqueta} onChange={(v) => mutar((d) => { d.pureza.metricas[i].etiqueta = v; })} />
            </div>
          ))}
        </Seccion>

        <Seccion titulo="Ruta de trazabilidad" hint="el corazón del valor agregado">
          <Campo label="Eyebrow" value={pz.trazabilidad.eyebrow} onChange={(v) => mutar((d) => { d.pureza.trazabilidad.eyebrow = v; })} />
          <Campo label="Título" value={pz.trazabilidad.titulo} onChange={(v) => mutar((d) => { d.pureza.trazabilidad.titulo = v; })} />
          <Campo label="Texto introductorio" textarea value={pz.trazabilidad.texto} onChange={(v) => mutar((d) => { d.pureza.trazabilidad.texto = v; })} />
          {pz.trazabilidad.pasos.map((paso, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">Paso {i + 1}</div>
              <div className="space-y-3">
                <Campo label="Título" value={paso.titulo} onChange={(v) => mutar((d) => { d.pureza.trazabilidad.pasos[i].titulo = v; })} />
                <Campo label="Descripción" textarea value={paso.texto} onChange={(v) => mutar((d) => { d.pureza.trazabilidad.pasos[i].texto = v; })} />
              </div>
            </div>
          ))}
        </Seccion>

        <Seccion titulo="Pilares de la marca" hint={`${pz.pilares.length} bloques`}>
          {pz.pilares.map((pilar, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">Pilar {i + 1}</div>
              <div className="space-y-3">
                <Campo label="Título" value={pilar.titulo} onChange={(v) => mutar((d) => { d.pureza.pilares[i].titulo = v; })} />
                <Campo label="Texto" textarea value={pilar.texto} onChange={(v) => mutar((d) => { d.pureza.pilares[i].texto = v; })} />
              </div>
            </div>
          ))}
        </Seccion>

        <Seccion titulo="Distintivos de producto" hint="chips en tarjetas y página de producto">
          <Campo
            label="Distintivos (separados por coma)"
            value={pz.badges_producto.join(", ")}
            onChange={(v) =>
              mutar((d) => {
                d.pureza.badges_producto = v.split(",").map((s) => s.trim()).filter(Boolean);
              })
            }
          />
        </Seccion>

        <Seccion titulo="Llamado a la acción final">
          <Campo label="Título" value={pz.cta.titulo} onChange={(v) => mutar((d) => { d.pureza.cta.titulo = v; })} />
          <Campo label="Texto" textarea value={pz.cta.texto} onChange={(v) => mutar((d) => { d.pureza.cta.texto = v; })} />
          <Campo label="Texto del botón" value={pz.cta.boton} onChange={(v) => mutar((d) => { d.pureza.cta.boton = v; })} />
        </Seccion>

        <Seccion titulo="Colores">
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(COLOR_LABEL).map(([key, label]) => (
              <label key={key} className="flex items-center gap-3">
                <input
                  type="color"
                  value={pz.colores[key] || "#0c6069"}
                  onChange={(e) => mutar((d) => { d.pureza.colores[key] = e.target.value; })}
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-surface"
                />
                <span className="text-sm text-ink">{label}</span>
                <code className="ml-auto text-xs text-muted">{pz.colores[key]}</code>
              </label>
            ))}
          </div>
        </Seccion>

        <Seccion titulo="Secciones visibles del home">
          <div className="grid gap-2 md:grid-cols-2">
            {Object.entries(SECCION_LABEL).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={pz.secciones[key] !== false}
                  onChange={(e) => mutar((d) => { d.pureza.secciones[key] = e.target.checked; })}
                  className="accent-current"
                />
                {label}
              </label>
            ))}
          </div>
        </Seccion>
      </div>

      {/* ── Barra de guardado ─────────────────────────────────────────── */}
      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-paper border-2 border-border bg-surface-panel px-4 py-3 shadow-paper">
        <span className="text-xs text-muted">
          {dirty ? "Hay cambios sin guardar." : "Todo guardado."}
          {config.tema_activo !== "pureza" &&
            " El tema Pureza no está publicado: tras guardar, revísalo con Vista previa."}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => abrirPreview("pureza")}
            className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-ink transition hover:border-accent hover:text-accent"
          >
            👁 Vista previa Pureza
          </button>
          <button
            type="button"
            disabled={!dirty || guardando}
            onClick={() => void guardar()}
            className="rounded-full bg-accent px-5 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Guardar y publicar"}
          </button>
        </div>
      </div>
    </div>
  );
}
