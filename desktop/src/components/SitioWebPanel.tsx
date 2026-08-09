import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import ClasicoLayoutCanvas, {
  WebLayoutInspector,
  type ClasicoCanvas,
  SECTION_LABEL_CLASICO,
} from "./studio-web/ClasicoLayoutCanvas";
import WebLayoutCanvas, {
  SECTION_LABEL,
  usePhosphorIcons,
  type PurezaCanvas,
} from "./studio-web/WebLayoutCanvas";
import { LienzoToolbar } from "./studio-web/StudioDesplegables";
import {
  ensureLayout,
  ensureLayoutClasico,
  estructuraPreviewKey,
  layoutClasicoDefault,
  layoutDefault,
  studioLivePayload,
  type WebLayout,
} from "../lib/webLayoutStudio";
import {
  aplicarSeleccionNodo,
  medirNodosEnRaiz,
  seleccionarSimilaresPorTamanoYForma,
  type StudioSelectOpts,
} from "../lib/studioSelectSimilar";
import { useUndoStack } from "../lib/studioUndo";

/**
 * Studio web — lienzo visual + tokens + contenido de mckennagroup.co
 * Backend: GET/PUT /api/web/tema → PAGINA_WEB/site/data/tema_web.json
 */

type TemaId = "clasico" | "pureza";
type StudioTab = "lienzo" | "diseno" | "contenido" | "publicar";
type FuenteDisplay = "montserrat";
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

interface KitItem {
  titulo: string;
  texto: string;
  valor: string;
  icono?: string;
}

interface TemaWebConfig {
  tema_activo: TemaId;
  actualizado?: string | null;
  diseno: DisenoTokens;
  layout: WebLayout;
  layout_clasico: WebLayout;
  clasico: {
    anuncio: string;
    hero: {
      badge: string;
      titulo_l1: string;
      titulo_em: string;
      titulo_l2: string;
      subtitulo: string;
      cta_principal: string;
      cta_secundario: string;
      kit_label: string;
      kit: KitItem[];
    };
    features: { titulo: string; texto: string; icono?: string }[];
    categorias: {
      eyebrow: string;
      titulo: string;
      titulo_em: string;
      texto: string;
    };
    destacados: {
      eyebrow: string;
      titulo: string;
      titulo_em: string;
      texto: string;
    };
    cta: {
      eyebrow: string;
      titulo: string;
      titulo_em: string;
      texto: string;
      boton_wa: string;
      boton_contacto: string;
    };
    secciones: Record<string, boolean>;
  };
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

const SECCION_LABEL_CLASICO: Record<string, string> = {
  features: "Franja de features",
  categorias: "Categorías del catálogo",
  destacados: "Productos destacados",
  cta: "Llamado a la acción final",
};

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
  cfg.layout_clasico = ensureLayoutClasico(cfg.layout_clasico);
  cfg.clasico = ensureClasicoContent(cfg.clasico);
  return cfg;
}

/** Defaults del home Clásico (mismo copy que el sitio publicado). */
const CLASICO_DEFAULTS: TemaWebConfig["clasico"] = {
  anuncio:
    "Materias primas farmacéuticas y cosméticas certificadas | Bogotá, Colombia · Lun–Vie 8:00–17:30",
  hero: {
    badge: "Materias Primas Certificadas · Colombia",
    titulo_l1: "Materias primas",
    titulo_em: "certificadas",
    titulo_l2: "para tu industria",
    subtitulo:
      "Farmacéuticas, cosméticas y nutracéuticas. Importadas con visto bueno INVIMA, COA y ficha técnica por lote. Despachos a todo Colombia.",
    cta_principal: "Comprar ahora",
    cta_secundario: "Pedir cotización",
    kit_label: "Por qué elegirnos",
    kit: [
      {
        titulo: "Importación 100% Legal",
        texto: "Visto Bueno de Importación (VUCE) + COA de laboratorio + Ficha Técnica por lote",
        valor: "COA/TDS",
        icono: "certificate",
      },
      {
        titulo: "Despacho Nacional",
        texto: "Envíos a todo Colombia con trazabilidad",
        valor: "48h",
        icono: "package",
      },
      {
        titulo: "Portafolio Completo",
        texto: "+80 referencias disponibles en stock",
        valor: "+200",
        icono: "flask",
      },
      {
        titulo: "Asesoría Técnica",
        texto: "Equipo especializado en formulación",
        valor: "B2B",
        icono: "headset",
      },
    ],
  },
  features: [
    {
      titulo: "Importación 100% Legal",
      texto: "VUCE + COA de laboratorio + Ficha Técnica",
      icono: "certificate",
    },
    { titulo: "Despacho Nacional", texto: "A todo Colombia", icono: "package" },
    { titulo: "Asesoría Técnica", texto: "Equipo especializado", icono: "headset" },
    { titulo: "Stock Permanente", texto: "Disponibilidad inmediata", icono: "clock" },
  ],
  categorias: {
    eyebrow: "Nuestro Portafolio",
    titulo: "Explora por",
    titulo_em: "Categoría",
    texto:
      "Materias primas para la industria farmacéutica, cosmética y alimentaria. Todo con calidad certificada y stock permanente.",
  },
  destacados: {
    eyebrow: "Productos",
    titulo: "Selección",
    titulo_em: "Destacada",
    texto: "Una muestra de nuestro portafolio con 10% de descuento frente al precio de catálogo.",
  },
  cta: {
    eyebrow: "Atención Personalizada",
    titulo: "¿Necesitas una",
    titulo_em: "cotización",
    texto:
      "Nuestro equipo técnico está listo para asesorarte en la selección de materias primas para tu formulación específica.",
    boton_wa: "Cotizar por WhatsApp",
    boton_contacto: "Formulario de Contacto",
  },
  secciones: {
    features: true,
    categorias: true,
    destacados: true,
    cta: true,
  },
};

function ensureClasicoContent(raw: TemaWebConfig["clasico"] | undefined): TemaWebConfig["clasico"] {
  const base = clone(CLASICO_DEFAULTS);
  if (!raw || typeof raw !== "object") return base;
  const out = clone(base);
  if (typeof raw.anuncio === "string" && raw.anuncio.trim()) out.anuncio = raw.anuncio;
  if (raw.hero && typeof raw.hero === "object") {
    for (const k of [
      "badge",
      "titulo_l1",
      "titulo_em",
      "titulo_l2",
      "subtitulo",
      "cta_principal",
      "cta_secundario",
      "kit_label",
    ] as const) {
      const v = raw.hero[k];
      if (typeof v === "string" && v.trim()) out.hero[k] = v;
    }
    if (Array.isArray(raw.hero.kit) && raw.hero.kit.length > 0) {
      out.hero.kit = raw.hero.kit.map((item, i) => ({
        titulo: item?.titulo || base.hero.kit[i]?.titulo || "",
        texto: item?.texto || base.hero.kit[i]?.texto || "",
        valor: item?.valor || base.hero.kit[i]?.valor || "",
        icono: item?.icono || base.hero.kit[i]?.icono,
      }));
    }
  }
  if (Array.isArray(raw.features) && raw.features.length > 0) {
    out.features = raw.features.map((f, i) => ({
      titulo: f?.titulo || base.features[i]?.titulo || "",
      texto: f?.texto || base.features[i]?.texto || "",
      icono: f?.icono || base.features[i]?.icono,
    }));
  }
  if (raw.categorias && typeof raw.categorias === "object") {
    for (const k of ["eyebrow", "titulo", "titulo_em", "texto"] as const) {
      const v = raw.categorias[k];
      if (typeof v === "string" && v.trim()) out.categorias[k] = v;
    }
  }
  if (raw.destacados && typeof raw.destacados === "object") {
    for (const k of ["eyebrow", "titulo", "titulo_em", "texto"] as const) {
      const v = raw.destacados[k];
      if (typeof v === "string" && v.trim()) out.destacados[k] = v;
    }
  }
  if (raw.cta && typeof raw.cta === "object") {
    for (const k of [
      "eyebrow",
      "titulo",
      "titulo_em",
      "texto",
      "boton_wa",
      "boton_contacto",
    ] as const) {
      const v = raw.cta[k];
      if (typeof v === "string" && v.trim()) out.cta[k] = v;
    }
  }
  if (raw.secciones && typeof raw.secciones === "object") {
    out.secciones = { ...base.secciones, ...raw.secciones };
  }
  return out;
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
  const font = "Montserrat, system-ui, sans-serif";
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
  const [editTema, setEditTema] = useState<TemaId>("clasico");
  const [previewTema, setPreviewTema] = useState<TemaId>("clasico");
  const [previewKey, setPreviewKey] = useState(0);
  const [previewDraftOk, setPreviewDraftOk] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastEstructura = useRef("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(0.72);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const historial = useUndoStack<TemaWebConfig>({ max: 80, coalesceMs: 450 });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await api.get<TemaResponse>("/api/web/tema");
      const cfg = ensureDiseno(res.config);
      setConfig(cfg);
      setOriginal(JSON.stringify(cfg));
      historial.reset();
      setEditTema(cfg.tema_activo);
      setPreviewTema(cfg.tema_activo);
      if (res.site_url) setSiteUrl(res.site_url);
      if (res.preview_url) setPreviewBase(res.preview_url.replace(/\/$/, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la configuración del tema");
    } finally {
      setCargando(false);
    }
  }, [historial.reset]);

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
      historial.remember(prev);
      const draft = clone(prev);
      fn(draft);
      return draft;
    });
  }, [historial.remember]);

  const deshacer = useCallback(() => {
    if (!config) return;
    const prev = historial.undo(config);
    if (!prev) return;
    setConfig(ensureDiseno(prev));
  }, [config, historial.undo]);

  const rehacer = useCallback(() => {
    if (!config) return;
    const next = historial.redo(config);
    if (!next) return;
    setConfig(ensureDiseno(next));
  }, [config, historial.redo]);

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
      historial.remember(config);
      const draft = clone(config);
      draft.tema_activo = tema;
      setConfig(draft);
      setEditTema(tema);
      setPreviewTema(tema);
      void guardar(draft);
    },
    [config, guardar, historial],
  );

  const restaurarContenido = useCallback(async () => {
    const esClasico = editTema === "clasico";
    const msg = esClasico
      ? "¿Restaurar textos del tema Clásico a los valores recomendados?"
      : "¿Restaurar textos y colores Pureza a los valores recomendados?";
    if (!window.confirm(msg)) return;
    setGuardando(true);
    setError("");
    try {
      const res = await api.put<TemaResponse>("/api/web/tema", {
        accion: esClasico ? "restaurar_clasico" : "restaurar",
      });
      const next = ensureDiseno(res.config);
      if (config) historial.remember(config);
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
  }, [editTema, config, historial]);

  const restaurarDiseno = useCallback(async () => {
    if (!window.confirm("¿Restaurar tipografía, radio, densidad y tagline a los valores por defecto?")) return;
    setGuardando(true);
    setError("");
    try {
      const res = await api.put<TemaResponse>("/api/web/tema", { accion: "restaurar_diseno" });
      const next = ensureDiseno(res.config);
      if (config) historial.remember(config);
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
  }, [config, historial]);

  const restaurarLayout = useCallback(async () => {
    if (!window.confirm("¿Restaurar el lienzo (posiciones, escalas y orden de secciones)?")) return;
    setGuardando(true);
    setError("");
    try {
      const res = await api.put<TemaResponse>("/api/web/tema", {
        accion: editTema === "clasico" ? "restaurar_layout_clasico" : "restaurar_layout",
      });
      const next = ensureDiseno(res.config);
      if (config) historial.remember(config);
      setConfig(next);
      setOriginal(JSON.stringify(next));
      setSelectedIds([]);
      setAviso(res.mensaje || "Lienzo restaurado.");
      window.setTimeout(() => setAviso(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar");
    } finally {
      setGuardando(false);
    }
  }, [editTema, config, historial]);

  const patchPureza = useCallback((mutator: (draft: PurezaCanvas) => void) => {
    mutar((d) => {
      mutator(d.pureza as PurezaCanvas);
    });
  }, [mutar]);

  const patchClasico = useCallback((mutator: (draft: ClasicoCanvas) => void) => {
    mutar((d) => {
      mutator(d.clasico as ClasicoCanvas);
    });
  }, [mutar]);

  const handleSelect = useCallback((id: string | null, opts?: StudioSelectOpts) => {
    setSelectedIds((prev) => aplicarSeleccionNodo(prev, id, opts));
  }, []);

  const seleccionarSimilares = useCallback(() => {
    setSelectedIds((prev) => {
      const seed = prev[prev.length - 1];
      if (!seed) {
        setAviso("Selecciona un objeto primero.");
        window.setTimeout(() => setAviso(""), 2500);
        return prev;
      }
      const root = document.querySelector("[data-studio-stage]");
      if (!root) return prev;
      const next = seleccionarSimilaresPorTamanoYForma(seed, medirNodosEnRaiz(root));
      if (next.length <= 1) {
        setAviso("No hay otros objetos con tamaño y forma similares.");
      } else {
        setAviso(`${next.length} objetos similares seleccionados.`);
      }
      window.setTimeout(() => setAviso(""), 3000);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t?.closest("input, textarea, select, [contenteditable=true]");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (inField && !e.shiftKey) return;
        e.preventDefault();
        if (e.shiftKey) rehacer();
        else deshacer();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        if (inField) return;
        e.preventDefault();
        rehacer();
        return;
      }
      if (tab !== "lienzo" || inField) return;
      if (mod && e.shiftKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        seleccionarSimilares();
      }
      if (e.key === "Escape") setSelectedIds([]);
    };
    const onPointerUp = () => historial.breakCoalesce();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [tab, seleccionarSimilares, deshacer, rehacer, historial.breakCoalesce]);

  const basePreview = useLocalPreview ? previewBase : siteUrl;
  const iframeSrc = `${basePreview}/?vista_tema=${previewTema}&_studio=${previewKey}&studio_preview=${previewDraftOk ? "1" : "0"}`;

  const pushLiveTokens = useCallback(() => {
    if (!config) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    let origin = "*";
    try {
      origin = new URL(basePreview).origin;
    } catch {
      origin = "*";
    }
    win.postMessage(studioLivePayload(config.diseno, config.pureza.colores || {}), origin);
  }, [config, basePreview]);

  useEffect(() => {
    pushLiveTokens();
  }, [pushLiveTokens]);

  useEffect(() => {
    if (!config || cargando) return;
    if (!dirty) {
      setPreviewDraftOk(false);
      lastEstructura.current = estructuraPreviewKey(config);
      return;
    }
    const est = estructuraPreviewKey(config);
    const estructuraCambio = est !== lastEstructura.current;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          await api.put("/api/web/tema/preview", { config });
          lastEstructura.current = est;
          setPreviewDraftOk(true);
          if (estructuraCambio) setPreviewKey((k) => k + 1);
        } catch {
          /* tokens siguen por postMessage aunque falle el borrador */
        }
      })();
    }, 280);
    return () => window.clearTimeout(t);
  }, [config, dirty, cargando]);

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
  const cl = config.clasico;
  const diseno = config.diseno;
  const layoutActivo = editTema === "clasico" ? config.layout_clasico : config.layout;

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
            <div className="flex rounded-full border border-border bg-surface p-0.5 text-[11px]">
              {(["clasico", "pureza"] as TemaId[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setEditTema(t);
                    setPreviewTema(t);
                    setSelectedIds([]);
                  }}
                  className={`rounded-full px-2.5 py-1 font-semibold transition ${
                    editTema === t ? "bg-ink text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {t === "clasico" ? "Clásico" : "Pureza"}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!historial.canUndo}
              onClick={deshacer}
              title="Deshacer (Ctrl+Z)"
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Deshacer
            </button>
            <button
              type="button"
              disabled={!historial.canRedo}
              onClick={rehacer}
              title="Rehacer (Ctrl+Shift+Z)"
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Rehacer
            </button>
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
        <div className="mt-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-ink">
          {editTema === config.tema_activo ? (
            <>
              Editando tema publicado:{" "}
              <strong>{editTema === "clasico" ? "Clásico" : "Pureza"}</strong>
            </>
          ) : (
            <>
              Editando borrador:{" "}
              <strong>{editTema === "clasico" ? "Clásico" : "Pureza"}</strong>
              <span className="ml-2 text-muted">
                · publicado: {config.tema_activo === "clasico" ? "Clásico" : "Pureza"}
              </span>
            </>
          )}
        </div>
      </div>

      {tab === "lienzo" ? (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-0 min-w-0 flex-col">
            <LienzoToolbar
              zoom={zoom}
              onZoom={setZoom}
              sectionIds={(layoutActivo || (editTema === "clasico" ? layoutClasicoDefault() : layoutDefault())).orden}
              sectionLabels={editTema === "clasico" ? SECTION_LABEL_CLASICO : SECTION_LABEL}
              selectedIds={selectedIds}
              onSelect={(id) => handleSelect(id)}
              onSeleccionarSimilares={seleccionarSimilares}
              onResetLayout={() => void restaurarLayout()}
              guardando={guardando}
              capitulo={editTema === "clasico" ? "Clásico" : "Pureza"}
            />
            <div className="min-h-0 flex-1">
            {editTema === "clasico" ? (
              <ClasicoLayoutCanvas
                clasico={cl as ClasicoCanvas}
                layout={layoutActivo || layoutClasicoDefault()}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onLayoutChange={(next) =>
                  mutar((d) => {
                    d.layout_clasico = next;
                  })
                }
                onClasicoPatch={patchClasico}
                zoom={zoom}
              />
            ) : (
              <WebLayoutCanvas
                pureza={pz as PurezaCanvas}
                layout={layoutActivo || layoutDefault()}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onLayoutChange={(next) =>
                  mutar((d) => {
                    d.layout = next;
                  })
                }
                onPurezaPatch={patchPureza}
                zoom={zoom}
              />
            )}
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto border-l border-border bg-surface-panel">
            <WebLayoutInspector
              selectedIds={selectedIds}
              onSeleccionarSimilares={seleccionarSimilares}
              onSelect={(id) => handleSelect(id)}
              layout={layoutActivo || (editTema === "clasico" ? layoutClasicoDefault() : layoutDefault())}
              onLayoutChange={(next) =>
                mutar((d) => {
                  if (editTema === "clasico") d.layout_clasico = next;
                  else d.layout = next;
                })
              }
              onContentPatch={
                editTema === "clasico"
                  ? (fn) => patchClasico((d) => fn(d as unknown as Record<string, unknown>))
                  : (fn) => patchPureza((d) => fn(d as unknown as Record<string, unknown>))
              }
              sectionLabels={editTema === "clasico" ? SECTION_LABEL_CLASICO : SECTION_LABEL}
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

              <Seccion titulo="Tipografía" hint="Montserrat (única)" defaultOpen>
                <div className="space-y-3">
                  <div
                    className="rounded-lg border border-border bg-surface px-4 py-3"
                    style={{ fontFamily: "'Montserrat', system-ui, sans-serif" }}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Familia de marca
                    </div>
                    <div className="mt-1 text-lg font-extrabold text-ink">Montserrat</div>
                    <p className="mt-1 text-xs text-muted">
                      La tipografía del sitio es solo Montserrat. El peso y la cursiva se
                      ajustan por elemento en el Lienzo (Light → Black + itálicas).
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {[
                      { label: "Light", w: 300 },
                      { label: "Regular", w: 400 },
                      { label: "Medium", w: 500 },
                      { label: "SemiBold", w: 600 },
                      { label: "Bold", w: 700 },
                      { label: "ExtraBold", w: 800 },
                      { label: "Black", w: 900 },
                      { label: "Italic", w: 400, italic: true },
                    ].map((v) => (
                      <div
                        key={v.label}
                        className="rounded-md border border-border px-2 py-2 text-center text-[11px] text-ink"
                        style={{
                          fontFamily: "'Montserrat', system-ui, sans-serif",
                          fontWeight: v.w,
                          fontStyle: v.italic ? "italic" : "normal",
                        }}
                      >
                        {v.label}
                        <div className="text-[9px] text-muted">{v.w}</div>
                      </div>
                    ))}
                  </div>
                </div>
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
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">
                  Contenido {editTema === "clasico" ? "Clásico" : "Pureza"}
                </h2>
                <button
                  type="button"
                  onClick={() => void restaurarContenido()}
                  disabled={guardando}
                  className="text-xs font-semibold text-muted underline hover:text-accent"
                >
                  Restaurar textos
                </button>
              </div>

              {editTema === "clasico" ? (
                <>
                  <Seccion titulo="Barra de anuncio" defaultOpen>
                    <Campo
                      label="Texto del anuncio"
                      value={cl.anuncio}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.anuncio = v;
                        })
                      }
                    />
                  </Seccion>

                  <Seccion titulo="Hero del home" defaultOpen>
                    <Campo
                      label="Badge"
                      value={cl.hero.badge}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.hero.badge = v;
                        })
                      }
                    />
                    <div className="grid gap-4 md:grid-cols-3">
                      <Campo
                        label="Título línea 1"
                        value={cl.hero.titulo_l1}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.hero.titulo_l1 = v;
                          })
                        }
                      />
                      <Campo
                        label="Palabra destacada"
                        value={cl.hero.titulo_em}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.hero.titulo_em = v;
                          })
                        }
                      />
                      <Campo
                        label="Título línea 2"
                        value={cl.hero.titulo_l2}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.hero.titulo_l2 = v;
                          })
                        }
                      />
                    </div>
                    <Campo
                      label="Subtítulo"
                      textarea
                      value={cl.hero.subtitulo}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.hero.subtitulo = v;
                        })
                      }
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <Campo
                        label="Botón principal"
                        value={cl.hero.cta_principal}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.hero.cta_principal = v;
                          })
                        }
                      />
                      <Campo
                        label="Botón secundario"
                        value={cl.hero.cta_secundario}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.hero.cta_secundario = v;
                          })
                        }
                      />
                    </div>
                    <Campo
                      label="Etiqueta panel derecho"
                      value={cl.hero.kit_label}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.hero.kit_label = v;
                        })
                      }
                    />
                    {cl.hero.kit.map((item, i) => (
                      <div key={i} className="rounded-lg border border-border bg-surface p-3">
                        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">
                          Kit {i + 1}
                        </div>
                        <div className="space-y-3">
                          <Campo
                            label="Título"
                            value={item.titulo}
                            onChange={(v) =>
                              mutar((d) => {
                                d.clasico.hero.kit[i].titulo = v;
                              })
                            }
                          />
                          <Campo
                            label="Descripción"
                            textarea
                            value={item.texto}
                            onChange={(v) =>
                              mutar((d) => {
                                d.clasico.hero.kit[i].texto = v;
                              })
                            }
                          />
                          <Campo
                            label="Valor"
                            value={item.valor}
                            onChange={(v) =>
                              mutar((d) => {
                                d.clasico.hero.kit[i].valor = v;
                              })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </Seccion>

                  <Seccion titulo="Features">
                    {cl.features.map((f, i) => (
                      <div key={i} className="rounded-lg border border-border bg-surface p-3">
                        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">
                          Feature {i + 1}
                        </div>
                        <div className="space-y-3">
                          <Campo
                            label="Título"
                            value={f.titulo}
                            onChange={(v) =>
                              mutar((d) => {
                                d.clasico.features[i].titulo = v;
                              })
                            }
                          />
                          <Campo
                            label="Texto"
                            value={f.texto}
                            onChange={(v) =>
                              mutar((d) => {
                                d.clasico.features[i].texto = v;
                              })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </Seccion>

                  <Seccion titulo="Categorías">
                    <Campo
                      label="Eyebrow"
                      value={cl.categorias.eyebrow}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.categorias.eyebrow = v;
                        })
                      }
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <Campo
                        label="Título"
                        value={cl.categorias.titulo}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.categorias.titulo = v;
                          })
                        }
                      />
                      <Campo
                        label="Palabra destacada"
                        value={cl.categorias.titulo_em}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.categorias.titulo_em = v;
                          })
                        }
                      />
                    </div>
                    <Campo
                      label="Texto"
                      textarea
                      value={cl.categorias.texto}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.categorias.texto = v;
                        })
                      }
                    />
                  </Seccion>

                  <Seccion titulo="Destacados">
                    <Campo
                      label="Eyebrow"
                      value={cl.destacados.eyebrow}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.destacados.eyebrow = v;
                        })
                      }
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <Campo
                        label="Título"
                        value={cl.destacados.titulo}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.destacados.titulo = v;
                          })
                        }
                      />
                      <Campo
                        label="Palabra destacada"
                        value={cl.destacados.titulo_em}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.destacados.titulo_em = v;
                          })
                        }
                      />
                    </div>
                    <Campo
                      label="Texto"
                      textarea
                      value={cl.destacados.texto}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.destacados.texto = v;
                        })
                      }
                    />
                  </Seccion>

                  <Seccion titulo="CTA final">
                    <Campo
                      label="Eyebrow"
                      value={cl.cta.eyebrow}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.cta.eyebrow = v;
                        })
                      }
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <Campo
                        label="Título"
                        value={cl.cta.titulo}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.cta.titulo = v;
                          })
                        }
                      />
                      <Campo
                        label="Palabra destacada"
                        value={cl.cta.titulo_em}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.cta.titulo_em = v;
                          })
                        }
                      />
                    </div>
                    <Campo
                      label="Texto"
                      textarea
                      value={cl.cta.texto}
                      onChange={(v) =>
                        mutar((d) => {
                          d.clasico.cta.texto = v;
                        })
                      }
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <Campo
                        label="Botón WhatsApp"
                        value={cl.cta.boton_wa}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.cta.boton_wa = v;
                          })
                        }
                      />
                      <Campo
                        label="Botón contacto"
                        value={cl.cta.boton_contacto}
                        onChange={(v) =>
                          mutar((d) => {
                            d.clasico.cta.boton_contacto = v;
                          })
                        }
                      />
                    </div>
                  </Seccion>

                  <Seccion titulo="Secciones visibles">
                    <div className="grid gap-2 md:grid-cols-2">
                      {Object.entries(SECCION_LABEL_CLASICO).map(([key, label]) => (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        >
                          <input
                            type="checkbox"
                            checked={cl.secciones[key] !== false}
                            onChange={(e) =>
                              mutar((d) => {
                                d.clasico.secciones[key] = e.target.checked;
                              })
                            }
                            className="accent-current"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </Seccion>
                </>
              ) : (
                <>
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
                </>
              )}
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
                    previewTema === t ? "bg-white text-[#022D33]" : "text-white/60"
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
            ref={iframeRef}
            key={previewKey}
            title="Vista previa sitio"
            src={iframeSrc}
            onLoad={pushLiveTokens}
            className="min-h-[420px] w-full flex-1 bg-white mck-paper-white"
          />
          <p className="px-3 py-1.5 text-[10px] text-white/40">
            Colores, botones y densidad se ven al instante. Textos y lienzo, en ~0,3 s (borrador local, no publica).
            {useLocalPreview ? " Usa Local :8083." : " Marca Local :8083 para el borrador en vivo."}
          </p>
        </div>
      </div>
      )}
    </div>
  );
}
